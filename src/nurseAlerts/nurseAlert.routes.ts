import { Router } from "express";
import { NurseAlert } from "./nurseAlert.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

const NURSE_ROLES = ["NURSE", "SUPER_ADMIN", "HOSPITAL_ADMIN", "DOCTOR"];

// GET alerts for the logged-in nurse (or admin: all)
router.get("/", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const { hospitalId, ipId, type, priority, isRead, isAcknowledged } = req.query;
    const filter: any = {};

    // Nurses see only their own alerts; admins/doctors see all
    const isAdmin = req.user?.role === "SUPER_ADMIN" || req.user?.role === "HOSPITAL_ADMIN";
    if (!isAdmin) filter.nurseId = req.user?.sub;

    if (hospitalId) filter.hospitalId = hospitalId;
    if (ipId) filter.ipId = ipId;
    if (type) filter.type = type;
    if (priority) filter.priority = priority;
    if (isRead !== undefined) filter.isRead = isRead === "true";
    if (isAcknowledged !== undefined) filter.isAcknowledged = isAcknowledged === "true";

    const alerts = await NurseAlert.find(filter)
      .populate("nurseId", "name")
      .populate("patientId", "name")
      .populate("createdBy", "name")
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(alerts);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// GET unread count
router.get("/unread-count", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const filter: any = { isRead: false };
    const isAdmin = req.user?.role === "SUPER_ADMIN" || req.user?.role === "HOSPITAL_ADMIN";
    if (!isAdmin) filter.nurseId = req.user?.sub;
    if (req.query.hospitalId) filter.hospitalId = req.query.hospitalId;
    const count = await NurseAlert.countDocuments(filter);
    res.json({ count });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// POST create alert
router.post("/", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const alert = await NurseAlert.create({
      ...req.body,
      createdBy: req.user?.sub,
    });
    res.status(201).json(alert);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// PATCH mark as read
router.patch("/:id/read", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const alert = await NurseAlert.findByIdAndUpdate(
      req.params.id,
      { isRead: true },
      { new: true }
    );
    if (!alert) return res.status(404).json({ message: "Alert not found" });
    res.json(alert);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// PATCH acknowledge alert
router.patch("/:id/acknowledge", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const alert = await NurseAlert.findByIdAndUpdate(
      req.params.id,
      {
        isAcknowledged: true,
        isRead: true,
        acknowledgedBy: req.user?.sub,
        acknowledgedAt: new Date(),
      },
      { new: true }
    );
    if (!alert) return res.status(404).json({ message: "Alert not found" });
    res.json(alert);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// PATCH dismiss (delete) alert
router.delete("/:id", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const alert = await NurseAlert.findByIdAndDelete(req.params.id);
    if (!alert) return res.status(404).json({ message: "Alert not found" });
    res.json({ message: "Dismissed" });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// PATCH mark all as read for the nurse
router.patch("/read-all", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const filter: any = { isRead: false };
    const isAdmin = req.user?.role === "SUPER_ADMIN" || req.user?.role === "HOSPITAL_ADMIN";
    if (!isAdmin) filter.nurseId = req.user?.sub;
    await NurseAlert.updateMany(filter, { isRead: true });
    res.json({ message: "All marked as read" });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});
