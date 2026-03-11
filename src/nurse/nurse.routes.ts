import { Router } from "express";
import { NurseTimesheet } from "./nurseTimesheet.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

const ADMIN_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN"];
const NURSE_ROLES = ["NURSE", "SUPER_ADMIN", "HOSPITAL_ADMIN"];

// Submit timesheet
router.post("/timesheets", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const sheet = await NurseTimesheet.create({
      ...req.body,
      nurseId: req.user?.sub,
      checkIn: req.body.checkIn || new Date(),
      status: "SUBMITTED",
    });
    res.status(201).json(sheet);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get nurse's own timesheets
router.get("/timesheets/mine", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const { from, to, shiftType } = req.query;
    const filter: any = { nurseId: req.user?.sub };
    if (shiftType) filter.shiftType = shiftType;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from as string);
      if (to) filter.date.$lte = new Date(to as string);
    }
    const sheets = await NurseTimesheet.find(filter).sort({ date: -1 });
    res.json(sheets);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Admin: List all timesheets
router.get("/timesheets", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { hospitalId, nurseId, shiftType, department, from, to } = req.query;
    const filter: any = {};
    if (hospitalId) filter.hospitalId = hospitalId;
    if (nurseId) filter.nurseId = nurseId;
    if (shiftType) filter.shiftType = shiftType;
    if (department) filter.department = department;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from as string);
      if (to) filter.date.$lte = new Date(to as string);
    }
    const sheets = await NurseTimesheet.find(filter)
      .populate("nurseId", "name email department")
      .populate("patientId", "name")
      .populate("handoverTo", "name")
      .sort({ date: -1 });
    res.json(sheets);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Nurse: Get timesheet by id
router.get("/timesheets/:id", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const sheet = await NurseTimesheet.findById(req.params.id)
      .populate("nurseId", "name")
      .populate("handoverTo", "name");
    if (!sheet) return res.status(404).json({ message: "Timesheet not found" });
    res.json(sheet);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Admin: Approve edit request
router.patch("/timesheets/:id/approve-edit", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const sheet = await NurseTimesheet.findByIdAndUpdate(
      req.params.id,
      { status: "EDIT_REQUESTED", editApprovedBy: req.user?.sub },
      { new: true }
    );
    if (!sheet) return res.status(404).json({ message: "Timesheet not found" });
    res.json(sheet);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Nurse: Edit timesheet (only if edit was approved)
router.patch("/timesheets/:id", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const sheet = await NurseTimesheet.findById(req.params.id);
    if (!sheet) return res.status(404).json({ message: "Timesheet not found" });

    // Only nurse who owns it can edit
    if (String(sheet.nurseId) !== req.user?.sub && req.user?.role !== "SUPER_ADMIN" && req.user?.role !== "HOSPITAL_ADMIN") {
      return res.status(403).json({ message: "Forbidden" });
    }

    if (sheet.status !== "EDIT_REQUESTED" && req.user?.role !== "SUPER_ADMIN" && req.user?.role !== "HOSPITAL_ADMIN") {
      return res.status(400).json({ message: "Edit not approved by admin" });
    }

    const updated = await NurseTimesheet.findByIdAndUpdate(
      req.params.id,
      { ...req.body, status: "EDITED", isLate: req.body.isLate || sheet.isLate },
      { new: true }
    );
    res.json(updated);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Nurse dashboard stats
router.get("/dashboard", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const { hospitalId } = req.query;
    const today = new Date();
    const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    const filter: any = { nurseId: req.user?.sub, date: { $gte: start } };
    if (hospitalId) filter.hospitalId = hospitalId;

    const todaySheets = await NurseTimesheet.find(filter).populate("patientId", "name");
    const pending = todaySheets.filter((s) => !s.checkOut).length;
    const emergencies = todaySheets.filter((s) => s.emergencyFlag).length;

    res.json({
      todaySheets,
      totalToday: todaySheets.length,
      pendingHandover: pending,
      emergencies,
    });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get nurse's schedule (shift calendar based on timesheets)
router.get("/schedule", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const { from, to, nurseId } = req.query;
    const isAdmin = (req as any).user?.role === "SUPER_ADMIN" || (req as any).user?.role === "HOSPITAL_ADMIN";
    const filter: any = {};
    if (isAdmin && nurseId) {
      filter.nurseId = nurseId;
    } else if (!isAdmin) {
      filter.nurseId = (req as any).user?.sub;
    }
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from as string);
      if (to) filter.date.$lte = new Date(to as string);
    }
    const sheets = await NurseTimesheet.find(filter)
      .select("date shiftType department emergencyFlag status checkIn checkOut")
      .sort({ date: 1 });
    res.json(sheets);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get handovers for logged-in nurse (timesheets with handoverTo set)
router.get("/handovers", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const isAdmin = (req as any).user?.role === "SUPER_ADMIN" || (req as any).user?.role === "HOSPITAL_ADMIN";
    const filter: any = { handoverTo: { $exists: true, $ne: null } };
    if (!isAdmin) filter.nurseId = (req as any).user?.sub;
    if (req.query.hospitalId) filter.hospitalId = req.query.hospitalId;
    const handovers = await NurseTimesheet.find(filter)
      .populate("nurseId", "name")
      .populate("handoverTo", "name")
      .sort({ date: -1 })
      .limit(50);
    res.json(handovers);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get active nurses list (for handover dropdown)
router.get("/active-nurses", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const { User } = await import("../user/user.model");
    const { hospitalId } = req.query;
    const filter: any = { role: "NURSE", isActive: true };
    if (hospitalId) filter.hospitalId = hospitalId;
    const nurses = await User.find(filter).select("name department shiftEligibility");
    res.json(nurses);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});
