import { Router } from "express";
import { ServiceRegistration } from "./serviceRegistration.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

const STAFF_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "RECEPTIONIST"];

async function generateServiceRegId(hospitalId: string): Promise<string> {
  const today = new Date();
  const prefix = `SVC-${today.getFullYear()}${String(today.getMonth() + 1).padStart(2, "0")}${String(today.getDate()).padStart(2, "0")}`;
  const count = await ServiceRegistration.countDocuments({ serviceRegId: { $regex: `^${prefix}` } });
  return `${prefix}-${String(count + 1).padStart(4, "0")}`;
}

// Create Service Registration
router.post("/", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const { hospitalId, patientId } = req.body;
    const serviceRegId = await generateServiceRegId(hospitalId);

    const reg = await ServiceRegistration.create({ ...req.body, serviceRegId });
    res.status(201).json({ reg, serviceRegId });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// List service registrations
router.get("/", requireAuth, async (req, res) => {
  try {
    const { hospitalId, patientId, status, from, to } = req.query;
    const filter: any = {};
    if (hospitalId) filter.hospitalId = hospitalId;
    if (patientId) filter.patientId = patientId;
    if (status) filter.status = status;
    if (from || to) {
      filter.registrationDate = {};
      if (from) filter.registrationDate.$gte = new Date(from as string);
      if (to) filter.registrationDate.$lte = new Date(to as string);
    }
    const regs = await ServiceRegistration.find(filter)
      .populate("patientId", "name phone gender age")
      .sort({ createdAt: -1 });
    res.json(regs);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get by serviceRegId
router.get("/by-svc-id/:serviceRegId", requireAuth, async (req, res) => {
  try {
    const reg = await ServiceRegistration.findOne({ serviceRegId: req.params.serviceRegId })
      .populate("patientId", "name phone gender age address");
    if (!reg) return res.status(404).json({ message: "Service registration not found" });
    res.json(reg);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Add payment
router.post("/:id/payment", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const { amount, mode, referenceNumber } = req.body;
    const reg = await ServiceRegistration.findById(req.params.id).populate("patientId", "name phone");
    if (!reg) return res.status(404).json({ message: "Service registration not found" });

    reg.paymentHistory.push({ amount, mode, referenceNumber, date: new Date() });
    reg.paidAmount += amount;
    reg.outstandingBalance = Math.max(0, reg.grandTotal - reg.paidAmount);
    reg.paymentMode = mode;
    if (reg.outstandingBalance <= 0) reg.status = "COMPLETED";
    else if (reg.paidAmount > 0) (reg as any).status = "PARTIAL";
    await reg.save();
    res.json(reg);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});
