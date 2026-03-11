import { Router } from "express";
import { Bill } from "./bill.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

const ADMIN_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN"];
const STAFF_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "RECEPTIONIST"];

// Get bill by referenceId (ipId / opId / serviceRegId)
router.get("/by-ref/:referenceId", requireAuth, async (req, res) => {
  try {
    const bill = await Bill.findOne({ referenceId: req.params.referenceId });
    if (!bill) return res.status(404).json({ message: "Bill not found" });
    res.json(bill);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get bill by id
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id)
      .populate("patientId", "name phone gender age address");
    if (!bill) return res.status(404).json({ message: "Bill not found" });
    res.json(bill);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// List bills
router.get("/", requireAuth, async (req, res) => {
  try {
    const { hospitalId, billType, status, patientId, from, to } = req.query;
    const filter: any = {};
    if (hospitalId) filter.hospitalId = hospitalId;
    if (billType) filter.billType = billType;
    if (status) filter.status = status;
    if (patientId) filter.patientId = patientId;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from as string);
      if (to) {
        const toDate = new Date(to as string);
        toDate.setHours(23, 59, 59, 999);
        filter.createdAt.$lte = toDate;
      }
    }
    const bills = await Bill.find(filter).populate("patientId", "name phone").sort({ createdAt: -1 });
    res.json(bills);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Add payment to bill
router.post("/:id/payment", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const { amount, mode, referenceNumber, notes } = req.body;
    const bill = await Bill.findById(req.params.id);
    if (!bill) return res.status(404).json({ message: "Bill not found" });
    if (bill.isFrozen && bill.status !== "FROZEN") {
      return res.status(400).json({ message: "Bill is frozen" });
    }

    bill.paymentHistory.push({
      amount,
      mode,
      referenceNumber,
      receivedAt: new Date(),
      receivedBy: req.user?.sub || "system",
      notes,
    });
    bill.paidAmount += amount;
    bill.outstandingBalance = bill.grandTotal - bill.paidAmount;

    if (bill.outstandingBalance <= 0) {
      bill.status = "PAID";
    } else if (bill.paidAmount > 0) {
      bill.status = "PARTIAL";
    }

    await bill.save();
    res.json(bill);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Apply discount (admin controlled)
router.post("/:id/discount", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { discountPercent, reason } = req.body;
    const bill = await Bill.findById(req.params.id);
    if (!bill) return res.status(404).json({ message: "Bill not found" });
    if (bill.isFrozen) return res.status(400).json({ message: "Bill is frozen" });

    bill.discountPercent = discountPercent;
    bill.discountAmount = Math.round((bill.subtotal * discountPercent) / 100);
    bill.discountApprovedBy = req.user?.sub;
    bill.grandTotal = bill.subtotal + bill.taxTotal - bill.discountAmount;
    bill.outstandingBalance = bill.grandTotal - bill.paidAmount;
    await bill.save();
    res.json(bill);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Add line item (charges)
router.post("/:id/line-items", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const bill = await Bill.findById(req.params.id);
    if (!bill) return res.status(404).json({ message: "Bill not found" });
    if (bill.isFrozen) return res.status(400).json({ message: "Bill is frozen" });

    const { lineItems } = req.body;
    bill.lineItems.push(...lineItems);

    const subtotal = bill.lineItems.reduce((s: number, i: any) => s + i.total, 0);
    const taxTotal = bill.lineItems.reduce((s: number, i: any) => s + (i.taxAmount || 0), 0);
    bill.subtotal = subtotal;
    bill.taxTotal = taxTotal;
    bill.discountAmount = Math.round((subtotal * bill.discountPercent) / 100);
    bill.grandTotal = subtotal + taxTotal - bill.discountAmount;
    bill.outstandingBalance = bill.grandTotal - bill.paidAmount;
    await bill.save();
    res.json(bill);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Freeze bill (before discharge)
router.post("/:id/freeze", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const bill = await Bill.findByIdAndUpdate(
      req.params.id,
      { isFrozen: true, frozenAt: new Date(), status: "FROZEN" },
      { new: true }
    );
    if (!bill) return res.status(404).json({ message: "Bill not found" });
    res.json(bill);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Consolidated report by IP/OP/SVC ID (admin)
router.get("/consolidated/:referenceId", requireAuth, async (req, res) => {
  try {
    const bill = await Bill.findOne({ referenceId: req.params.referenceId })
      .populate("patientId", "name phone gender age address bloodGroup");
    if (!bill) return res.status(404).json({ message: "No bill found for this ID" });
    res.json(bill);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});
