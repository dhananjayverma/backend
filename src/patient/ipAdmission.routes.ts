import { Router } from "express";
import mongoose from "mongoose";
import { IPAdmission } from "./ipAdmission.model";
import { Room } from "../infrastructure/room.model";
import { Bed } from "../infrastructure/bed.model";
import { Bill } from "../billing/bill.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

const STAFF_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "RECEPTIONIST"];

// Generate IP ID
async function generateIpId(hospitalId: string): Promise<string> {
  const today = new Date();
  const prefix = `IP-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const count = await IPAdmission.countDocuments({
    ipId: { $regex: `^${prefix}` },
  });
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

// Generate Bill Number
async function generateBillNumber(hospitalId: string): Promise<string> {
  const count = await Bill.countDocuments({ hospitalId });
  return `BILL-${hospitalId.slice(-4).toUpperCase()}-${String(count + 1).padStart(6, "0")}`;
}

// Create IP Admission
router.post("/", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const {
      patientId, patientName, patientContact,
      admissionDate, expectedDays,
      casualtyFlag, emergencyFlag,
      doctorId, roomId, bedId,
      roomRentPerDay, hospitalId,
    } = req.body;

    // Check bed availability
    const bed = await Bed.findById(bedId).session(session);
    if (!bed) return res.status(404).json({ message: "Bed not found" });
    if (bed.status !== "AVAILABLE") return res.status(400).json({ message: "Bed is not available" });

    const ipId = await generateIpId(hospitalId);

    const admission = await IPAdmission.create(
      [{ ipId, patientId, admissionDate, expectedDays, casualtyFlag, emergencyFlag, doctorId, roomId, bedId, roomRentPerDay, status: "ADMITTED" }],
      { session }
    );

    // Mark bed as occupied
    await Bed.findByIdAndUpdate(bedId, { status: "OCCUPIED", currentPatientId: patientId, currentIpId: ipId }, { session });

    // Update room status
    await Room.findByIdAndUpdate(roomId, { status: "OCCUPIED" }, { session });

    // Create initial bill
    const billNumber = await generateBillNumber(hospitalId);
    const registrationFee = req.body.registrationFee || 0;
    const lineItems = [];

    if (registrationFee > 0) {
      lineItems.push({
        description: "Registration Fee",
        category: "REGISTRATION",
        quantity: 1,
        unitPrice: registrationFee,
        taxPercent: 0,
        taxAmount: 0,
        total: registrationFee,
      });
    }

    if (casualtyFlag || emergencyFlag) {
      const emergencyFee = req.body.emergencyCharges || 0;
      if (emergencyFee > 0) {
        lineItems.push({
          description: "Emergency / Casualty Charges",
          category: "EMERGENCY",
          quantity: 1,
          unitPrice: emergencyFee,
          taxPercent: 0,
          taxAmount: 0,
          total: emergencyFee,
        });
      }
    }

    const subtotal = lineItems.reduce((sum, i) => sum + i.total, 0);
    await Bill.create(
      [
        {
          billNumber,
          hospitalId,
          patientId,
          billType: "IP",
          referenceId: ipId,
          referenceObjectId: admission[0]._id,
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
        },
      ],
      { session }
    );

    await session.commitTransaction();
    res.status(201).json({ admission: admission[0], ipId });
  } catch (error: any) {
    await session.abortTransaction();
    res.status(400).json({ message: error.message });
  } finally {
    session.endSession();
  }
});

// List IP admissions
router.get("/", requireAuth, requireRole([...STAFF_ROLES, "NURSE", "DOCTOR"]), async (req, res) => {
  try {
    const { hospitalId, status, doctorId, from, to } = req.query;
    const filter: any = {};
    if (status) filter.status = status;
    if (doctorId) filter.doctorId = doctorId;
    if (from || to) {
      filter.admissionDate = {};
      if (from) filter.admissionDate.$gte = new Date(from as string);
      if (to) filter.admissionDate.$lte = new Date(to as string);
    }

    const admissions = await IPAdmission.find(filter)
      .populate("patientId", "name phone gender age")
      .populate("doctorId", "name specialization")
      .populate("roomId", "roomNumber floor roomType")
      .populate("bedId", "bedNumber")
      .sort({ createdAt: -1 });

    // Filter by hospitalId via bed/room if needed
    res.json(admissions);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get single IP admission
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const admission = await IPAdmission.findById(req.params.id)
      .populate("patientId", "name phone gender age address bloodGroup")
      .populate("doctorId", "name specialization qualification")
      .populate("roomId", "roomNumber floor roomType rentPerDay")
      .populate("bedId", "bedNumber");
    if (!admission) return res.status(404).json({ message: "Admission not found" });
    res.json(admission);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get by ipId
router.get("/by-ip-id/:ipId", requireAuth, async (req, res) => {
  try {
    const admission = await IPAdmission.findOne({ ipId: req.params.ipId })
      .populate("patientId", "name phone gender age address bloodGroup")
      .populate("doctorId", "name specialization qualification")
      .populate("roomId", "roomNumber floor roomType rentPerDay")
      .populate("bedId", "bedNumber");
    if (!admission) return res.status(404).json({ message: "Admission not found" });

    // Get bill
    const bill = await Bill.findOne({ referenceId: req.params.ipId, billType: "IP" });

    res.json({ admission, bill });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Update status
router.patch("/:id/status", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const admission = await IPAdmission.findByIdAndUpdate(
      req.params.id,
      { status: req.body.status },
      { new: true }
    );
    if (!admission) return res.status(404).json({ message: "Admission not found" });
    res.json(admission);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Add charges to IP bill (room rent, lab, etc.)
router.post("/:ipId/add-charges", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const { lineItems } = req.body;
    const bill = await Bill.findOne({ referenceId: req.params.ipId, billType: "IP" });
    if (!bill) return res.status(404).json({ message: "Bill not found" });
    if (bill.isFrozen) return res.status(400).json({ message: "Bill is frozen for discharge. Cannot add charges." });

    bill.lineItems.push(...lineItems);
    const subtotal = bill.lineItems.reduce((sum: number, i: any) => sum + i.total, 0);
    const taxTotal = bill.lineItems.reduce((sum: number, i: any) => sum + (i.taxAmount || 0), 0);
    bill.subtotal = subtotal;
    bill.taxTotal = taxTotal;
    bill.grandTotal = subtotal + taxTotal - bill.discountAmount;
    bill.outstandingBalance = bill.grandTotal - bill.paidAmount;
    await bill.save();
    res.json(bill);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});
