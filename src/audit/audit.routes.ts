import { Router, Request, Response } from "express";
import { StockAudit, IStockAudit } from "./audit.model";
import { InventoryItem } from "../inventory/inventory.model";
import { PharmacyInvoice } from "../invoice/pharmacyInvoice.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";
import { createActivity } from "../activity/activity.service";

export const router = Router();

// Create or initialize daily audit
router.post("/daily", requireAuth, requireRole(["SUPER_ADMIN", "PHARMACY_STAFF"]), async (req: Request, res: Response) => {
  try {
    const { pharmacyId, auditDate } = req.body;
    const userId = (req as any).user?.userId || (req as any).user?.sub;

    console.log("Creating daily audit:", { pharmacyId, auditDate, userId });

    // Validate required fields
    if (!pharmacyId) {
      console.error("Missing pharmacyId in request");
      return res.status(400).json({ message: "pharmacyId is required" });
    }

    // Handle date - if it's a string in YYYY-MM-DD format, parse it correctly
    let auditDateObj: Date;
    if (auditDate) {
      // If it's already a date string in YYYY-MM-DD format
      if (typeof auditDate === 'string' && auditDate.match(/^\d{4}-\d{2}-\d{2}$/)) {
        // Parse as UTC to avoid timezone issues
        const [year, month, day] = auditDate.split('-').map(Number);
        auditDateObj = new Date(Date.UTC(year, month - 1, day));
      } else {
        auditDateObj = new Date(auditDate);
      }
    } else {
      auditDateObj = new Date();
    }
    
    // Validate date
    if (isNaN(auditDateObj.getTime())) {
      console.error("Invalid date:", auditDate);
      return res.status(400).json({ message: `Invalid audit date format: ${auditDate}` });
    }
    
    // Set to start of day in local timezone
    auditDateObj.setHours(0, 0, 0, 0);
    
    console.log("Parsed audit date:", auditDateObj.toISOString());

    // Check if audit already exists (use date range to handle timezone issues)
    const startOfDay = new Date(auditDateObj);
    startOfDay.setHours(0, 0, 0, 0);
    const endOfDay = new Date(auditDateObj);
    endOfDay.setHours(23, 59, 59, 999);

    const existingAudit = await StockAudit.findOne({
      pharmacyId,
      auditDate: { $gte: startOfDay, $lte: endOfDay },
      auditType: "DAILY",
    });

    if (existingAudit) {
      console.log("Audit already exists for date:", auditDateObj.toISOString());
      return res.status(400).json({ message: "Daily audit already exists for this date" });
    }

    // Get all inventory items for the pharmacy
    const inventoryItems = await InventoryItem.find({ pharmacyId });
    console.log(`Found ${inventoryItems.length} inventory items for pharmacy ${pharmacyId}`);
    
    // Check if pharmacyId exists in any inventory items (for debugging)
    if (inventoryItems.length === 0) {
      const allItemsCount = await InventoryItem.countDocuments({});
      const itemsWithDifferentPharmacy = await InventoryItem.distinct("pharmacyId");
      console.log(`Total inventory items in database: ${allItemsCount}`);
      console.log(`Unique pharmacyIds found: ${itemsWithDifferentPharmacy.join(", ")}`);
    }

    // Get system sales for the day (from invoices) - reuse date range from above
    const invoices = await PharmacyInvoice.find({
      pharmacyId,
      billDate: { $gte: startOfDay, $lte: endOfDay },
    });
    console.log(`Found ${invoices.length} invoices for the audit date`);

    // Create audit items
    const filteredItems = inventoryItems.filter((item) => item.medicineName && item.batchNumber);
    console.log(`After filtering (medicineName and batchNumber required): ${filteredItems.length} valid items`);
    
    const auditItems = filteredItems
      .map((item) => {
        // Calculate system sales from invoices
        let systemSales = 0;
        invoices.forEach((invoice) => {
          invoice.items.forEach((invoiceItem) => {
            if (String(invoiceItem.inventoryItemId) === String(item._id)) {
              systemSales += invoiceItem.quantity;
            }
          });
        });

        return {
          inventoryItemId: String(item._id),
          medicineName: item.medicineName,
          composition: item.composition || item.medicineName, // Fallback to medicineName if composition missing
          brandName: item.brandName || undefined,
          batchNumber: item.batchNumber,
          openingStock: item.quantity + systemSales, // Current stock + sales = opening stock
          systemSales,
          manualBills: 0, // To be filled by user
          totalSales: systemSales,
          expectedClosingStock: item.quantity, // Current stock is expected closing
          actualClosingStock: undefined,
          variance: undefined,
        };
      });

    // Ensure we have at least one item
    if (auditItems.length === 0) {
      console.error("No valid inventory items found after filtering");
      let errorMessage = `No inventory items found for pharmacy ${pharmacyId}. `;
      if (inventoryItems.length === 0) {
        errorMessage += "Please add inventory items in the Inventory section first.";
      } else {
        const invalidItems = inventoryItems.filter((item) => !item.medicineName || !item.batchNumber);
        errorMessage += `Found ${inventoryItems.length} items, but ${invalidItems.length} are missing required fields (medicineName or batchNumber).`;
      }
      return res.status(400).json({ message: errorMessage });
    }

    console.log(`Creating audit with ${auditItems.length} items`);
    
    const audit = await StockAudit.create({
      pharmacyId,
      auditDate: auditDateObj,
      auditType: "DAILY",
      items: auditItems,
      totalItems: auditItems.length,
      status: "IN_PROGRESS",
      createdBy: userId || pharmacyId, // Fallback to pharmacyId if userId not available
    } as IStockAudit);
    
    console.log("Audit created successfully:", audit._id);

    await createActivity(
      "AUDIT_CREATED",
      "Daily Audit Created",
      `Daily audit created for ${pharmacyId} on ${auditDateObj.toLocaleDateString()}`,
      {
        pharmacyId,
        metadata: {
          auditId: String(audit._id),
          auditDate: auditDateObj.toISOString(),
        },
      }
    );

    res.status(201).json(audit);
  } catch (error: any) {
    console.error("Error creating daily audit:", error);
    res.status(400).json({ 
      message: error.message || "Failed to create daily audit",
      error: process.env.NODE_ENV === "development" ? error.stack : undefined
    });
  }
});

// Update audit with actual closing stock
router.patch("/:id/closing-stock", requireAuth, requireRole(["SUPER_ADMIN", "PHARMACY_STAFF"]), async (req: Request, res: Response) => {
  try {
    const { items } = req.body; // Array of { inventoryItemId, actualClosingStock, varianceReason? }

    const audit = await StockAudit.findById(req.params.id);
    if (!audit) {
      return res.status(404).json({ message: "Audit not found" });
    }

    // Update items with actual closing stock
    const itemsMap = new Map(items.map((item: any) => [item.inventoryItemId, item]));

    audit.items = audit.items.map((item) => {
      const update = itemsMap.get(item.inventoryItemId) as any;
      if (update) {
        item.actualClosingStock = update.actualClosingStock;
        if (item.expectedClosingStock !== undefined && update.actualClosingStock !== undefined) {
          item.variance = update.actualClosingStock - item.expectedClosingStock;
        }
        if (update.varianceReason) {
          item.varianceReason = update.varianceReason;
        }
      }
      return item;
    });

    // Recalculate summary
    audit.itemsWithVariance = audit.items.filter((item) => item.variance !== undefined && item.variance !== 0).length;

    // Calculate financial variance (simplified - using average price)
    let totalVarianceValue = 0;
    for (const item of audit.items) {
      if (item.variance !== undefined && item.variance !== 0) {
        const inventoryItem = await InventoryItem.findById(item.inventoryItemId);
        if (inventoryItem) {
          totalVarianceValue += Math.abs(item.variance * inventoryItem.sellingPrice);
        }
      }
    }
    audit.totalVarianceValue = totalVarianceValue;

    audit.status = "COMPLETED";
    await audit.save();

    // Check for mismatches and create alerts
    if (audit.itemsWithVariance > 0) {
      await createActivity(
        "AUDIT_MISMATCH",
        "Audit Mismatch Detected",
        `Audit for ${audit.pharmacyId} has ${audit.itemsWithVariance} items with variance`,
        {
          pharmacyId: audit.pharmacyId,
          metadata: {
            auditId: String(audit._id),
            itemsWithVariance: audit.itemsWithVariance,
            totalVarianceValue,
          },
        }
      );
    }

    res.json(audit);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Update manual bills quantity
router.patch("/:id/manual-bills", requireAuth, requireRole(["SUPER_ADMIN", "PHARMACY_STAFF"]), async (req: Request, res: Response) => {
  try {
    const { items } = req.body; // Array of { inventoryItemId, manualBills }

    const audit = await StockAudit.findById(req.params.id);
    if (!audit) {
      return res.status(404).json({ message: "Audit not found" });
    }

    const itemsMap = new Map(items.map((item: any) => [item.inventoryItemId, item]));

    audit.items = audit.items.map((item) => {
      const update = itemsMap.get(item.inventoryItemId) as any;
      if (update) {
        item.manualBills = update.manualBills || 0;
        item.totalSales = item.systemSales + item.manualBills;
        item.expectedClosingStock = item.openingStock - item.totalSales;
        if (item.actualClosingStock !== undefined) {
          item.variance = item.actualClosingStock - item.expectedClosingStock;
        }
      }
      return item;
    });

    await audit.save();
    res.json(audit);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get audit by ID
router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const audit = await StockAudit.findById(req.params.id);
    if (!audit) {
      return res.status(404).json({ message: "Audit not found" });
    }
    res.json(audit);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// List audits
router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const { pharmacyId, auditType, status, startDate, endDate, limit = 50 } = req.query;
    const filter: any = {};

    if (pharmacyId) filter.pharmacyId = pharmacyId;
    if (auditType) filter.auditType = auditType;
    if (status) filter.status = status;

    if (startDate || endDate) {
      filter.auditDate = {};
      if (startDate) filter.auditDate.$gte = new Date(startDate as string);
      if (endDate) filter.auditDate.$lte = new Date(endDate as string);
    }

    const audits = await StockAudit.find(filter)
      .sort({ auditDate: -1, createdAt: -1 })
      .limit(Number(limit));

    res.json(audits);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Export audit report (CSV download)
router.get("/:id/export", requireAuth, requireRole(["SUPER_ADMIN", "PHARMACY_STAFF"]), async (req: Request, res: Response) => {
  try {
    const { format = "csv" } = req.query;
    const audit = await StockAudit.findById(req.params.id);
    if (!audit) {
      return res.status(404).json({ message: "Audit not found" });
    }

    if (format === "csv") {
      const headers = [
        "Medicine Name",
        "Composition",
        "Brand",
        "Batch",
        "Opening Stock",
        "System Sales",
        "Manual Bills",
        "Total Sales",
        "Expected Closing",
        "Actual Closing",
        "Variance",
        "Variance Reason",
      ];
      const rows = audit.items.map((item) => [
        item.medicineName,
        item.composition,
        item.brandName || "",
        item.batchNumber,
        item.openingStock,
        item.systemSales,
        item.manualBills,
        item.totalSales,
        item.expectedClosingStock,
        item.actualClosingStock ?? "",
        item.variance ?? "",
        item.varianceReason ?? "",
      ]);
      const csv = [headers.join(","), ...rows.map((r) => r.map((c) => `"${String(c).replace(/"/g, '""')}"`).join(","))].join("\r\n");
      res.setHeader("Content-Type", "text/csv; charset=utf-8");
      res.setHeader("Content-Disposition", `attachment; filename="audit-${new Date(audit.auditDate).toISOString().split("T")[0]}-${audit._id}.csv"`);
      return res.send("\uFEFF" + csv); // BOM for Excel
    }

    res.status(400).json({ message: "Unsupported format. Use format=csv" });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Review audit (mark as reviewed)
router.patch("/:id/review", requireAuth, requireRole(["SUPER_ADMIN", "PHARMACY_MANAGER"]), async (req: Request, res: Response) => {
  try {
    const { reviewedNotes } = req.body;
    const userId = (req as any).user?.userId;

    const audit = await StockAudit.findByIdAndUpdate(
      req.params.id,
      {
        $set: {
          status: "REVIEWED",
          reviewedBy: userId,
          reviewedAt: new Date(),
          reviewedNotes,
        },
      },
      { new: true }
    );

    if (!audit) {
      return res.status(404).json({ message: "Audit not found" });
    }

    res.json(audit);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

