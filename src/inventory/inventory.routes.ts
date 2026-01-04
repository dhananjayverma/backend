import { Router, Request, Response } from "express";
import { InventoryItem, IInventoryItem } from "./inventory.model";
import { DistributorOrder } from "../distributor/distributorOrder.model";
import { createActivity } from "../activity/activity.service";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

// Helper function to check and send low stock notifications
async function checkAndNotifyLowStock(item: IInventoryItem, isNewItem: boolean = false): Promise<void> {
  // Check if stock is low
  if (item.quantity <= item.threshold && item.distributorId) {
    try {
      const { createNotification } = await import("../notifications/notification.service");
      const { User } = await import("../user/user.model");
      const { Pharmacy } = await import("../master/pharmacy.model");
      
      // Get pharmacy info
      const pharmacy = await Pharmacy.findById(item.pharmacyId);
      const pharmacyName = pharmacy?.name || "Pharmacy";
      
      // Get distributor user
      const distributor = await User.findOne({ 
        role: "DISTRIBUTOR",
        $or: [
          { distributorId: item.distributorId },
          { _id: item.distributorId }
        ]
      });
      
      // Create activity for low stock
      await createActivity(
        "INVENTORY_LOW_STOCK",
        "Low Stock Alert",
        `${item.medicineName} is below threshold (${item.quantity}/${item.threshold}) at ${pharmacyName}.`,
        {
          pharmacyId: item.pharmacyId,
          distributorId: item.distributorId,
          metadata: { 
            medicineName: item.medicineName,
            currentQuantity: item.quantity,
            threshold: item.threshold,
            itemId: String(item._id),
            isNewItem,
          },
        }
      );
      
      // Notify Distributor
      if (distributor) {
        await createNotification({
          userId: String(distributor._id),
          type: "INVENTORY_LOW_STOCK",
          title: "Low Stock Alert",
          message: `${item.medicineName} is below threshold (${item.quantity}/${item.threshold}) at ${pharmacyName}. Please restock.`,
          channel: "PUSH",
          metadata: {
            pharmacyId: item.pharmacyId,
            medicineName: item.medicineName,
            currentQuantity: item.quantity,
            threshold: item.threshold,
            itemId: String(item._id),
          },
        });
      }
      
      // Notify Super Admin
      const superAdmins = await User.find({ role: "SUPER_ADMIN" });
      for (const admin of superAdmins) {
        await createNotification({
          userId: String(admin._id),
          type: "INVENTORY_LOW_STOCK",
          title: "Low Stock Alert",
          message: `${item.medicineName} is below threshold (${item.quantity}/${item.threshold}) at ${pharmacyName}.`,
          channel: "PUSH",
          metadata: {
            pharmacyId: item.pharmacyId,
            distributorId: item.distributorId,
            medicineName: item.medicineName,
            currentQuantity: item.quantity,
            threshold: item.threshold,
            itemId: String(item._id),
          },
        });
      }
    } catch (error) {
      console.error("Failed to send low stock notifications:", error);
    }
  }
}

// Create or update inventory item
router.post("/", async (req: Request, res: Response) => {
  try {
    console.log("📦 Creating inventory item, received data:", JSON.stringify(req.body, null, 2));
    
    const { 
      pharmacyId, 
      medicineName, 
      composition,
      brandName,
      batchNumber, 
      expiryDate, 
      quantity, 
      threshold, 
      distributorId, 
      minStockLevel, 
      unitPrice, 
      purchasePrice,
      sellingPrice,
      mrp,
      supplier,
      category,
      imageUrl,
      description,
      prescriptionRequired,
      rackNumber,
      rowNumber,
    } = req.body;

    // Validate required fields
    if (!medicineName) {
      return res.status(400).json({ message: "medicineName is required" });
    }
    if (quantity === undefined || quantity === null) {
      return res.status(400).json({ message: "quantity is required" });
    }

    // Use threshold or minStockLevel (frontend uses minStockLevel)
    const stockThreshold = threshold || minStockLevel || 10;
    
    // Use composition or default to medicineName
    const itemComposition = composition || medicineName;
    
    // Generate batch number if not provided
    const itemBatchNumber = batchNumber || `BATCH-${Date.now()}-${Math.random().toString(36).substr(2, 9).toUpperCase()}`;
    
    // Set expiry date - if not provided, set to 1 year from now
    let itemExpiryDate = expiryDate;
    if (!itemExpiryDate) {
      const futureDate = new Date();
      futureDate.setFullYear(futureDate.getFullYear() + 1);
      itemExpiryDate = futureDate;
    } else if (typeof itemExpiryDate === 'string') {
      // Convert string date to Date object
      itemExpiryDate = new Date(itemExpiryDate);
    }

    const itemData = {
      pharmacyId: pharmacyId || undefined,
      medicineName,
      composition: itemComposition,
      brandName: brandName || undefined,
      batchNumber: itemBatchNumber,
      expiryDate: itemExpiryDate,
      quantity: Number(quantity),
      threshold: stockThreshold,
      distributorId: distributorId || undefined,
      purchasePrice: purchasePrice !== undefined ? Number(purchasePrice) : (unitPrice ? Number(unitPrice) * 0.8 : 0),
      sellingPrice: sellingPrice !== undefined ? Number(sellingPrice) : (unitPrice ? Number(unitPrice) : 0),
      mrp: mrp !== undefined ? Number(mrp) : undefined,
      price: unitPrice, // Legacy field
      category: category || "MEDICINE",
      imageUrl: imageUrl || undefined,
      description: description || undefined,
      prescriptionRequired: prescriptionRequired || false,
      rackNumber: rackNumber || undefined,
      rowNumber: rowNumber || undefined,
    };

    console.log("📦 Creating inventory item with data:", JSON.stringify(itemData, null, 2));
    console.log("  - pharmacyId being saved:", itemData.pharmacyId);
    console.log("  - pharmacyId type:", typeof itemData.pharmacyId);

    // For warehouse inventory (distributor), pharmacyId is optional
    const item = await InventoryItem.create(itemData) as IInventoryItem;

    console.log("✅ Inventory item created successfully:");
    console.log("  - Item ID:", item._id);
    console.log("  - Medicine Name:", item.medicineName);
    console.log("  - Saved pharmacyId:", item.pharmacyId);
    console.log("  - Saved pharmacyId type:", typeof item.pharmacyId);
    console.log("  - Category:", item.category);
    console.log("  - Quantity:", item.quantity);

    // Check for low stock and notify
    setImmediate(() => {
      checkAndNotifyLowStock(item, true);
    });

    await createActivity(
      "INVENTORY_CREATED",
      "Inventory Created",
      `New inventory item ${item.medicineName} added at Pharmacy ${item.pharmacyId}`,
      {
        pharmacyId: item.pharmacyId,
        metadata: { 
          medicineName: item.medicineName,
          quantity: item.quantity,
          threshold: item.threshold,
          itemId: String(item._id),
        },
      }
    );

    res.status(201).json(item);
  } catch (error: any) {
    console.error("❌ Error creating inventory item:", error);
    console.error("Error stack:", error.stack);
    res.status(400).json({ message: error.message || "Failed to create inventory item" });
  }
});

// List all inventory items (with optional filters)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { pharmacyId, distributorId, medicineName, lowStock } = req.query;
    const filter: any = {};
    if (pharmacyId) filter.pharmacyId = pharmacyId;
    if (distributorId) filter.distributorId = distributorId;
    if (medicineName) filter.medicineName = { $regex: medicineName, $options: "i" };
    if (lowStock === "true") {
      const items = await InventoryItem.find(filter)
        .sort({ medicineName: 1 })
        .limit(500);
      const lowStockItems = items.filter(item => item.quantity <= item.threshold);
      return res.json(lowStockItems);
    }

    const items = await InventoryItem.find(filter)
      .sort({ medicineName: 1 })
      .limit(500);
    res.json(items);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// List inventory for a pharmacy
router.get("/by-pharmacy/:pharmacyId", async (req: Request, res: Response) => {
  try {
    const pharmacyId = req.params.pharmacyId;
    console.log(`📋 Fetching inventory for pharmacy: ${pharmacyId}`);
    console.log(`  - pharmacyId type: ${typeof pharmacyId}`);
    console.log(`  - pharmacyId length: ${pharmacyId?.length}`);
    
    // First, check if there are ANY items in the database for debugging
    const totalItems = await InventoryItem.countDocuments({});
    console.log(`  - Total items in database: ${totalItems}`);
    
    // Check if there are any items with this pharmacyId (with type coercion)
    const itemsWithId = await InventoryItem.find({ pharmacyId: pharmacyId })
      .sort({ medicineName: 1 })
      .limit(500);
    
    // Also try string comparison
    const itemsWithStringId = await InventoryItem.find({ pharmacyId: String(pharmacyId) })
      .sort({ medicineName: 1 })
      .limit(500);
    
    // Get all unique pharmacyIds in database for debugging
    const allItems = await InventoryItem.find({}).limit(10).select("pharmacyId medicineName").lean();
    const uniquePharmacyIds = [...new Set(allItems.map((item: any) => String(item.pharmacyId)))];
    console.log(`  - Sample pharmacyIds in database (first 10 items):`, uniquePharmacyIds);
    
    // Use the results that match
    const items = itemsWithId.length > 0 ? itemsWithId : itemsWithStringId;
    
    console.log(`  - Items found with exact match: ${itemsWithId.length}`);
    console.log(`  - Items found with string match: ${itemsWithStringId.length}`);
    console.log(`✅ Found ${items.length} inventory items for pharmacy ${pharmacyId}`);
    
    if (items.length > 0) {
      console.log(`Sample items:`, items.slice(0, 3).map((item: any) => ({ 
        medicineName: item.medicineName, 
        category: item.category, 
        quantity: item.quantity,
        pharmacyId: String(item.pharmacyId),
        pharmacyIdType: typeof item.pharmacyId
      })));
    } else {
      console.warn(`⚠️ No items found for pharmacy ${pharmacyId}`);
      console.warn(`  - Check if pharmacyId in database matches: ${pharmacyId}`);
      console.warn(`  - Available pharmacyIds: ${uniquePharmacyIds.join(", ")}`);
    }
    
    res.json(items);
  } catch (error: any) {
    console.error("❌ Error fetching inventory:", error);
    res.status(400).json({ message: error.message });
  }
});

// Get inventory item by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const item = await InventoryItem.findById(req.params.id) as IInventoryItem | null;
    if (!item) {
      return res.status(404).json({ message: "Inventory item not found" });
    }
    res.json(item);
  } catch (error: any) {
    res.status(400).json({ message: error.message || "Failed to fetch inventory item" });
  }
});

// Decrease stock when pharmacy dispenses medicines (with transaction)
router.post("/:id/consume", async (req: Request, res: Response) => {
  const { quantity } = req.body;
  
  try {
    const { TransactionService } = await import("../shared/services/transaction.service");
    
    // Use transaction to ensure atomicity
    const updatedItem = await TransactionService.executeTransaction(async (session) => {
      const item = await InventoryItem.findById(req.params.id).session(session) as IInventoryItem | null;
      if (!item) {
        throw new Error("Inventory item not found");
      }

      const newQuantity = Math.max(0, item.quantity - quantity);
      item.quantity = newQuantity;
      await item.save({ session });

      // Auto-restock trigger (within same transaction)
      if (newQuantity <= item.threshold && item.distributorId) {
        const [order] = await DistributorOrder.create([{
          pharmacyId: item.pharmacyId,
          distributorId: item.distributorId,
          medicineName: item.medicineName,
          quantity: item.threshold * 3,
          status: "PENDING",
        }], { session });

        // Emit activity for low stock
        await createActivity(
          "INVENTORY_LOW_STOCK",
          "Low Stock Alert",
          `${item.medicineName} is below threshold at Pharmacy ${item.pharmacyId}. Auto-restock order created.`,
          {
            pharmacyId: item.pharmacyId,
            distributorId: item.distributorId,
            metadata: { 
              medicineName: item.medicineName,
              currentQuantity: newQuantity,
              threshold: item.threshold,
              orderId: String(order._id),
            },
          }
        );

        // Send notifications to Distributor and Super Admin (outside transaction)
        // We'll do this after the transaction commits to avoid blocking
        setImmediate(async () => {
          try {
            const { createNotification } = await import("../notifications/notification.service");
            const { User } = await import("../user/user.model");
            const { Pharmacy } = await import("../master/pharmacy.model");
            
            // Get distributor user (check by distributorId field if exists, or by role)
            const distributor = await User.findOne({ 
              role: "DISTRIBUTOR",
              $or: [
                { distributorId: item.distributorId },
                { _id: item.distributorId }
              ]
            });
            
            // Get pharmacy info
            const pharmacy = await Pharmacy.findById(item.pharmacyId);
            
            if (distributor) {
              await createNotification({
                userId: String(distributor._id),
                type: "INVENTORY_LOW_STOCK",
                title: "Low Stock Alert - New Order",
                message: `${item.medicineName} is below threshold at ${pharmacy?.name || "Pharmacy"}. Auto-restock order #${String(order._id).slice(-8)} created.`,
                channel: "PUSH",
                metadata: {
                  orderId: String(order._id),
                  pharmacyId: item.pharmacyId,
                  medicineName: item.medicineName,
                  quantity: order.quantity,
                },
              });
            }
            
            // Notify Super Admin
            const superAdmins = await User.find({ role: "SUPER_ADMIN" });
            for (const admin of superAdmins) {
              await createNotification({
                userId: String(admin._id),
                type: "INVENTORY_LOW_STOCK",
                title: "Low Stock Alert",
                message: `${item.medicineName} is below threshold at ${pharmacy?.name || "Pharmacy"}. Auto-restock order created.`,
                channel: "PUSH",
                metadata: {
                  orderId: String(order._id),
                  pharmacyId: item.pharmacyId,
                  distributorId: item.distributorId,
                  medicineName: item.medicineName,
                },
              });
            }
          } catch (error) {
            console.error("Failed to send low stock notifications:", error);
          }
        });
      }
      
      return item;
    });

    res.json(updatedItem);
  } catch (error: any) {
    res.status(400).json({ message: error.message || "Failed to consume inventory" });
  }
});

// Update Inventory Item
router.patch(
  "/:id",
  requireAuth,
  requireRole(["SUPER_ADMIN", "PHARMACY_STAFF"]),
  async (req: Request, res: Response) => {
    try {
      const { medicineName, batchNumber, expiryDate, quantity, threshold, distributorId, minStockLevel, unitPrice, supplier } = req.body;
      const update: any = {};
      
      if (medicineName !== undefined) update.medicineName = medicineName;
      if (batchNumber !== undefined) update.batchNumber = batchNumber;
      if (expiryDate !== undefined) update.expiryDate = expiryDate;
      if (quantity !== undefined) update.quantity = quantity;
      // Support both threshold and minStockLevel (frontend uses minStockLevel)
      if (threshold !== undefined) update.threshold = threshold;
      if (minStockLevel !== undefined) update.threshold = minStockLevel;
      if (distributorId !== undefined) update.distributorId = distributorId;
      if (unitPrice !== undefined) update.price = unitPrice;

      // Get old item to check if quantity changed
      const oldItem = await InventoryItem.findById(req.params.id) as IInventoryItem | null;
      const wasLowStock = oldItem ? oldItem.quantity <= oldItem.threshold : false;

      const item = await InventoryItem.findByIdAndUpdate(
        req.params.id,
        { $set: update },
        { new: true, runValidators: true }
      ) as IInventoryItem | null;
      
      if (!item) {
        return res.status(404).json({ message: "Inventory item not found" });
      }

      // Check if quantity was updated and if it's now low stock
      const isLowStock = item.quantity <= item.threshold;
      const quantityChanged = oldItem && oldItem.quantity !== item.quantity;

      // If quantity changed and is now low (or was already low), send notification
      if (quantityChanged && (isLowStock || wasLowStock)) {
        setImmediate(() => {
          checkAndNotifyLowStock(item, false);
        });
      }

      await createActivity(
        "INVENTORY_UPDATED",
        "Inventory Updated",
        `Inventory item ${item.medicineName} updated at Pharmacy ${item.pharmacyId}`,
        {
          pharmacyId: item.pharmacyId,
          metadata: { 
            medicineName: item.medicineName,
            quantity: item.quantity,
            threshold: item.threshold,
            itemId: String(item._id),
          },
        }
      );

      res.json(item);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Delete Inventory Item
router.delete(
  "/:id",
  requireAuth,
  requireRole(["SUPER_ADMIN", "PHARMACY_STAFF"]),
  async (req: Request, res: Response) => {
    try {
      const itemId = req.params.id;
      const item = await InventoryItem.findById(itemId) as IInventoryItem | null;
      if (!item) {
        return res.status(404).json({ message: "Inventory item not found" });
      }

      // Store item info before deletion
      const itemInfo = {
        medicineName: item.medicineName,
        pharmacyId: item.pharmacyId,
        itemId: String(item._id),
      };

      // Delete the item
      const deleteResult = await InventoryItem.deleteOne({ _id: item._id });
      
      if (deleteResult.deletedCount === 0) {
        return res.status(500).json({ message: "Failed to delete inventory item" });
      }

      await createActivity(
        "INVENTORY_DELETED",
        "Inventory Deleted",
        `Inventory item ${itemInfo.medicineName} deleted from Pharmacy ${itemInfo.pharmacyId}`,
        {
          pharmacyId: itemInfo.pharmacyId,
          metadata: { 
            medicineName: itemInfo.medicineName,
            itemId: itemInfo.itemId,
          },
        }
      );

      res.json({ message: "Inventory item deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);
