import { Router } from "express";
import { Certificate } from "./certificate.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

const ADMIN_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN"];

async function generateCertNumber(hospitalId: string, type: string): Promise<string> {
  const prefix = type === "MEDICAL_FITNESS" ? "MFC" : type === "ADMISSION" ? "ADM" : "DSC";
  const count = await Certificate.countDocuments({ hospitalId, type });
  return `${prefix}-${hospitalId.slice(-4).toUpperCase()}-${String(count + 1).padStart(5, "0")}`;
}

router.post("/", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const certificateNumber = await generateCertNumber(req.body.hospitalId, req.body.type);
    const cert = await Certificate.create({
      ...req.body,
      certificateNumber,
      createdBy: req.user?.sub || "system",
    });
    res.status(201).json(cert);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { hospitalId, type, patientId } = req.query;
    const filter: any = {};
    if (hospitalId) filter.hospitalId = hospitalId;
    if (type) filter.type = type;
    if (patientId) filter.patientId = patientId;
    const certs = await Certificate.find(filter)
      .populate("patientId", "name phone gender age")
      .populate("doctorId", "name specialization")
      .sort({ createdAt: -1 });
    res.json(certs);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/:id", requireAuth, async (req, res) => {
  try {
    const cert = await Certificate.findById(req.params.id)
      .populate("patientId", "name phone gender age address")
      .populate("doctorId", "name specialization qualification");
    if (!cert) return res.status(404).json({ message: "Certificate not found" });
    res.json(cert);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});
