import { Router } from "express";
import { Vitals } from "./vitals.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

const NURSE_ROLES = ["NURSE", "SUPER_ADMIN", "HOSPITAL_ADMIN", "DOCTOR"];

// GET vitals for an IP admission
router.get("/", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const { ipId, hospitalId, from, to, limit = "50" } = req.query;
    const filter: any = {};
    if (ipId) filter.ipId = ipId;
    if (hospitalId) filter.hospitalId = hospitalId;
    if (from || to) {
      filter.recordedAt = {};
      if (from) filter.recordedAt.$gte = new Date(from as string);
      if (to) filter.recordedAt.$lte = new Date(to as string);
    }
    const vitals = await Vitals.find(filter)
      .populate("recordedBy", "name")
      .sort({ recordedAt: -1 })
      .limit(parseInt(limit as string));
    res.json(vitals);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// GET single vitals record
router.get("/:id", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const vitals = await Vitals.findById(req.params.id).populate("recordedBy", "name");
    if (!vitals) return res.status(404).json({ message: "Vitals record not found" });
    res.json(vitals);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// POST create vitals record
router.post("/", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const vitals = await Vitals.create({
      ...req.body,
      recordedBy: req.user?.sub,
      recordedAt: req.body.recordedAt || new Date(),
    });
    res.status(201).json(vitals);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// PATCH update vitals record
router.patch("/:id", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const vitals = await Vitals.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!vitals) return res.status(404).json({ message: "Vitals record not found" });
    res.json(vitals);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE vitals record (admin only)
router.delete("/:id", requireAuth, requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]), async (req, res) => {
  try {
    const vitals = await Vitals.findByIdAndDelete(req.params.id);
    if (!vitals) return res.status(404).json({ message: "Vitals record not found" });
    res.json({ message: "Deleted" });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});
