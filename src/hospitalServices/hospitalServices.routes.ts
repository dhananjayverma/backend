import { Router } from "express";
import { HospitalService } from "./hospitalService.model";
import { HospitalConfig } from "./hospitalConfig.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

const ADMIN_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN"];
const STAFF_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "RECEPTIONIST", "NURSE", "DOCTOR"];

// ─── SERVICES ─────────────────────────────────────────────────────────────────

router.post("/services", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const service = await HospitalService.create(req.body);
    res.status(201).json(service);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/services", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const { hospitalId, category } = req.query;
    const filter: any = { isActive: true };
    if (hospitalId) filter.hospitalId = hospitalId;
    if (category) filter.category = category;
    const services = await HospitalService.find(filter).sort({ category: 1, name: 1 });
    res.json(services);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.patch("/services/:id", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const service = await HospitalService.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!service) return res.status(404).json({ message: "Service not found" });
    res.json(service);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.delete("/services/:id", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    await HospitalService.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: "Service deactivated" });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// ─── HOSPITAL CONFIG ──────────────────────────────────────────────────────────

router.get("/config/:hospitalId", requireAuth, async (req, res) => {
  try {
    let config = await HospitalConfig.findOne({ hospitalId: req.params.hospitalId });
    if (!config) {
      config = await HospitalConfig.create({ hospitalId: req.params.hospitalId });
    }
    res.json(config);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.put("/config/:hospitalId", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const config = await HospitalConfig.findOneAndUpdate(
      { hospitalId: req.params.hospitalId },
      req.body,
      { new: true, upsert: true, runValidators: true }
    );
    res.json(config);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});
