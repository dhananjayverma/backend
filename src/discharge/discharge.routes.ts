import { Router } from "express";
import mongoose from "mongoose";
import { Discharge } from "./discharge.model";
import { IPAdmission } from "../patient/ipAdmission.model";
import { Bill } from "../billing/bill.model";
import { Bed } from "../infrastructure/bed.model";
import { Room } from "../infrastructure/room.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

const STAFF_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "RECEPTIONIST"];
const DOCTOR_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "DOCTOR"];

// Initiate discharge
router.post("/", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const {
      ipId, hospitalId, patientId, doctorId,
      admissionDate, dischargeType,
      diagnosisSummary, treatmentSummary,
      medicationsOnDischarge, followUpInstructions,
    } = req.body;

    const admission = await IPAdmission.findOne({ ipId });
    if (!admission) return res.status(404).json({ message: "IP Admission not found" });
    if (admission.status === "DISCHARGED") return res.status(400).json({ message: "Patient already discharged" });

    const dischargeDate = new Date();
    const totalDays = Math.ceil(
      (dischargeDate.getTime() - new Date(admissionDate).getTime()) / (1000 * 60 * 60 * 24)
    ) || 1;

    const discharge = await Discharge.create({
      ipId,
      ipAdmissionId: admission._id,
      hospitalId,
      patientId,
      doctorId: doctorId || admission.doctorId,
      admissionDate,
      dischargeDate,
      totalDays,
      dischargeType: dischargeType || "NORMAL",
      diagnosisSummary,
      treatmentSummary,
      medicationsOnDischarge,
      followUpInstructions,
      doctorApprovalStatus: "PENDING",
      status: "INITIATED",
      createdBy: req.user?.sub || "system",
    });

    // Update admission status
    await IPAdmission.findByIdAndUpdate(admission._id, { status: "READY_FOR_DISCHARGE" });

    res.status(201).json(discharge);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Doctor approves discharge
router.patch("/:id/approve", requireAuth, requireRole(DOCTOR_ROLES), async (req, res) => {
  try {
    const discharge = await Discharge.findByIdAndUpdate(
      req.params.id,
      { doctorApprovalStatus: "APPROVED", doctorApprovedAt: new Date(), approvedBy: req.user?.sub, status: "APPROVED" },
      { new: true }
    );
    if (!discharge) return res.status(404).json({ message: "Discharge record not found" });
    res.json(discharge);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Complete discharge (freeze bill + free bed/room)
router.patch("/:id/complete", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  const session = await mongoose.startSession();
  session.startTransaction();
  try {
    const discharge = await Discharge.findById(req.params.id).session(session);
    if (!discharge) return res.status(404).json({ message: "Discharge not found" });
    if (discharge.doctorApprovalStatus !== "APPROVED") {
      return res.status(400).json({ message: "Doctor approval required before completing discharge" });
    }

    // Add room rent line items to bill
    const admission = await IPAdmission.findOne({ ipId: discharge.ipId }).session(session);
    if (admission) {
      const bill = await Bill.findOne({ referenceId: discharge.ipId, billType: "IP" }).session(session);
      if (bill && !bill.isFrozen) {
        const roomRentTotal = discharge.totalDays * (admission.roomRentPerDay || 0);
        if (roomRentTotal > 0) {
          bill.lineItems.push({
            description: `Room Rent (${discharge.totalDays} days × ₹${admission.roomRentPerDay}/day)`,
            category: "ROOM_RENT",
            quantity: discharge.totalDays,
            unitPrice: admission.roomRentPerDay,
            taxPercent: 0,
            taxAmount: 0,
            total: roomRentTotal,
          });
        }

        const subtotal = bill.lineItems.reduce((s: number, i: any) => s + i.total, 0);
        const taxTotal = bill.lineItems.reduce((s: number, i: any) => s + (i.taxAmount || 0), 0);
        bill.subtotal = subtotal;
        bill.taxTotal = taxTotal;
        bill.discountAmount = Math.round((subtotal * bill.discountPercent) / 100);
        bill.grandTotal = subtotal + taxTotal - bill.discountAmount;
        bill.outstandingBalance = bill.grandTotal - bill.paidAmount;
        bill.isFrozen = true;
        bill.frozenAt = new Date();
        bill.status = "FROZEN";
        await bill.save({ session });

        discharge.billId = bill._id as mongoose.Types.ObjectId;
      }

      // Free bed and update room
      await Bed.findByIdAndUpdate(admission.bedId, { status: "CLEANING", currentPatientId: null, currentIpId: null }, { session });
      await Room.findByIdAndUpdate(admission.roomId, { status: "CLEANING" }, { session });

      // Update admission
      await IPAdmission.findByIdAndUpdate(admission._id, { status: "DISCHARGED", dischargeDate: discharge.dischargeDate }, { session });
    }

    discharge.status = "COMPLETED";
    await discharge.save({ session });

    await session.commitTransaction();
    res.json({ message: "Discharge completed successfully", discharge });
  } catch (error: any) {
    await session.abortTransaction();
    res.status(400).json({ message: error.message });
  } finally {
    session.endSession();
  }
});

// Get discharge record
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const d = await Discharge.findById(req.params.id)
      .populate("patientId", "name phone gender age")
      .populate("doctorId", "name specialization");
    if (!d) return res.status(404).json({ message: "Not found" });
    res.json(d);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get discharge by ipId
router.get("/by-ip/:ipId", requireAuth, async (req, res) => {
  try {
    const d = await Discharge.findOne({ ipId: req.params.ipId })
      .populate("patientId", "name phone gender age")
      .populate("doctorId", "name specialization");
    res.json(d);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});
