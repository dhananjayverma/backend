import { Router } from "express";
import { Medication } from "./medication.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

const NURSE_ROLES = ["NURSE", "SUPER_ADMIN", "HOSPITAL_ADMIN", "DOCTOR"];

// GET medications for an IP admission
router.get("/", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const { ipId, hospitalId, status } = req.query;
    const filter: any = {};
    if (ipId) filter.ipId = ipId;
    if (hospitalId) filter.hospitalId = hospitalId;
    if (status) filter.status = status;
    const meds = await Medication.find(filter)
      .populate("orderedBy", "name")
      .populate("administeredBy", "name")
      .sort({ createdAt: -1 });
    res.json(meds);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// GET single medication
router.get("/:id", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const med = await Medication.findById(req.params.id)
      .populate("orderedBy", "name")
      .populate("administeredBy", "name");
    if (!med) return res.status(404).json({ message: "Medication not found" });
    res.json(med);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// POST create medication order
router.post("/", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const med = await Medication.create({
      ...req.body,
      orderedBy: req.user?.sub,
      status: "PENDING",
    });
    res.status(201).json(med);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// PATCH update medication status (administer / skip / refuse)
router.patch("/:id/status", requireAuth, requireRole(NURSE_ROLES), async (req, res) => {
  try {
    const { status, notes } = req.body;
    const update: any = { status, notes };
    if (status === "ADMINISTERED") {
      update.administeredBy = req.user?.sub;
      update.administeredAt = new Date();
    }
    const med = await Medication.findByIdAndUpdate(req.params.id, update, { new: true });
    if (!med) return res.status(404).json({ message: "Medication not found" });
    res.json(med);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// PATCH update medication details
router.patch("/:id", requireAuth, requireRole(["DOCTOR", "SUPER_ADMIN", "HOSPITAL_ADMIN"]), async (req, res) => {
  try {
    const med = await Medication.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!med) return res.status(404).json({ message: "Medication not found" });
    res.json(med);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// DELETE medication (admin only)
router.delete("/:id", requireAuth, requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]), async (req, res) => {
  try {
    const med = await Medication.findByIdAndUpdate(req.params.id, { status: "CANCELLED" }, { new: true });
    if (!med) return res.status(404).json({ message: "Medication not found" });
    res.json({ message: "Cancelled", med });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});
