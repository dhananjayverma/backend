import { Router } from "express";
import { OPRegistration } from "./opRegistration.model";
import { Bill } from "../billing/bill.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

const STAFF_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "RECEPTIONIST"];

async function generateOpId(hospitalId: string): Promise<string> {
  const today = new Date();
  const prefix = `OP-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const count = await OPRegistration.countDocuments({ opId: { $regex: `^${prefix}` } });
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

async function generateBillNumber(hospitalId: string): Promise<string> {
  const count = await Bill.countDocuments({ hospitalId });
  return `BILL-${hospitalId.slice(-4).toUpperCase()}-${String(count + 1).padStart(6, "0")}`;
}

async function generateToken(doctorId: string): Promise<string> {
  const today = new Date();
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  const count = await OPRegistration.countDocuments({
    doctorId,
    registrationDate: { $gte: start, $lt: end },
  });
  return String(count + 1).padStart(3, "0");
}

// Create OP Registration
router.post("/", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const { patientId, patientName, patientContact, doctorId, consultationFee, hospitalId, registrationFee } = req.body;

    const opId = await generateOpId(hospitalId);
    const tokenNumber = await generateToken(doctorId);

    const op = await OPRegistration.create({
      opId,
      patientId,
      doctorId,
      consultationFee,
      tokenNumber: `${opId}-T${tokenNumber}`,
      consultationStatus: "WAITING",
      status: "ACTIVE",
    });

    // Create bill
    const billNumber = await generateBillNumber(hospitalId);
    const lineItems: any[] = [];

    if (registrationFee > 0) {
      lineItems.push({ description: "Registration Fee", category: "REGISTRATION", quantity: 1, unitPrice: registrationFee, taxPercent: 0, taxAmount: 0, total: registrationFee });
    }

    lineItems.push({ description: "Consultation Fee", category: "DOCTOR_CONSULTATION", quantity: 1, unitPrice: consultationFee, taxPercent: 0, taxAmount: 0, total: consultationFee });

    const subtotal = lineItems.reduce((s, i) => s + i.total, 0);

    const bill = await Bill.create({
      billNumber,
      hospitalId,
      patientId,
      billType: "OP",
      referenceId: opId,
      referenceObjectId: op._id,
      patientName: patientName || "Patient",
      patientContact,
      lineItems,
      subtotal,
      taxTotal: 0,
      discountPercent: 0,
      discountAmount: 0,
      grandTotal: subtotal,
      paidAmount: 0,
      outstandingBalance: subtotal,
      paymentHistory: [],
      status: "ACTIVE",
      isFrozen: false,
      createdBy: req.user?.sub || "system",
    });

    await OPRegistration.findByIdAndUpdate(op._id, { billId: bill._id });

    res.status(201).json({ op, opId, tokenNumber, bill });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// List OP registrations
router.get("/", requireAuth, async (req, res) => {
  try {
    const { doctorId, consultationStatus, from, to } = req.query;
    const filter: any = {};
    if (doctorId) filter.doctorId = doctorId;
    if (consultationStatus) filter.consultationStatus = consultationStatus;
    if (from || to) {
      filter.registrationDate = {};
      if (from) filter.registrationDate.$gte = new Date(from as string);
      if (to) filter.registrationDate.$lte = new Date(to as string);
    }

    const ops = await OPRegistration.find(filter)
      .populate("patientId", "name phone gender age")
      .populate("doctorId", "name specialization")
      .sort({ createdAt: -1 });
    res.json(ops);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get by opId
router.get("/by-op-id/:opId", requireAuth, async (req, res) => {
  try {
    const op = await OPRegistration.findOne({ opId: req.params.opId })
      .populate("patientId", "name phone gender age address")
      .populate("doctorId", "name specialization");
    if (!op) return res.status(404).json({ message: "OP registration not found" });

    const bill = await Bill.findOne({ referenceId: req.params.opId, billType: "OP" });
    res.json({ op, bill });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Update consultation status
router.patch("/:id/status", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const op = await OPRegistration.findByIdAndUpdate(
      req.params.id,
      { consultationStatus: req.body.consultationStatus, status: req.body.status },
      { new: true }
    );
    if (!op) return res.status(404).json({ message: "OP not found" });
    res.json(op);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});
