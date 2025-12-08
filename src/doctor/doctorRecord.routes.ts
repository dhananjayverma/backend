import { Router, Request, Response } from "express";
import { requireAuth, requireRole } from "../shared/middleware/auth";
import { DoctorRecord } from "./doctorRecord.model";
import { createActivity } from "../activity/activity.service";

const router = Router();

// Get all doctor records
router.get(
  "/",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { specialization, hospitalId, isActive } = req.query;
      const filter: any = {};

      if (specialization) filter.specialization = specialization;
      if (hospitalId) filter.hospitalId = hospitalId;
      if (isActive !== undefined) filter.isActive = isActive === "true";

      const doctors = await DoctorRecord.find(filter)
        .sort({ name: 1 })
        .lean();

      res.json(doctors);
    } catch (error: any) {
      console.error("Error fetching doctor records:", error);
      res.status(500).json({ message: error.message || "Failed to fetch doctor records" });
    }
  }
);

// Get doctor record by ID
router.get(
  "/:id",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const doctor = await DoctorRecord.findOne({ doctorId: req.params.id }).lean();
      if (!doctor) {
        return res.status(404).json({ message: "Doctor record not found" });
      }
      res.json(doctor);
    } catch (error: any) {
      console.error("Error fetching doctor record:", error);
      res.status(500).json({ message: error.message || "Failed to fetch doctor record" });
    }
  }
);

// Create doctor record
router.post(
  "/",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const {
        doctorId,
        name,
        email,
        phone,
        specialization,
        qualification,
        serviceCharge,
        hospitalId,
        hospitalName,
        experience,
        education,
        languages,
        bio,
        availableDays,
        availableTimeSlots,
        isActive,
        status,
      } = req.body;

      // Validate required fields
      if (!doctorId || !name || !email || !specialization) {
        return res.status(400).json({
          message: "Missing required fields: doctorId, name, email, specialization",
        });
      }

      // Check if doctor record already exists
      const existing = await DoctorRecord.findOne({ doctorId });
      if (existing) {
        return res.status(400).json({ message: "Doctor record already exists for this doctor" });
      }

      const doctorRecord = await DoctorRecord.create({
        doctorId,
        name,
        email,
        phone,
        specialization,
        qualification,
        serviceCharge,
        hospitalId,
        hospitalName,
        experience,
        education: education || [],
        languages: languages || [],
        bio,
        availableDays: availableDays || [],
        availableTimeSlots: availableTimeSlots || [],
        isActive: isActive !== undefined ? isActive : true,
        status: status || "AVAILABLE",
      });

      await createActivity(
        "DOCTOR_RECORD_CREATED",
        "Doctor Record Created",
        `Doctor record created for ${name} (${specialization})`,
        {
          doctorId: doctorRecord.doctorId,
          metadata: { specialization, hospitalId },
        }
      );

      res.status(201).json(doctorRecord);
    } catch (error: any) {
      console.error("Error creating doctor record:", error);
      res.status(400).json({ message: error.message || "Failed to create doctor record" });
    }
  }
);

// Update doctor record
router.patch(
  "/:id",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "DOCTOR"]),
  async (req: Request, res: Response) => {
    try {
      const doctorId = req.params.id;
      const update = req.body;

      // Doctors can only update their own record
      const userRole = req.user?.role;
      if (userRole === "DOCTOR" && req.user?.sub !== doctorId) {
        return res.status(403).json({ message: "You can only update your own record" });
      }

      const doctorRecord = await DoctorRecord.findOneAndUpdate(
        { doctorId },
        { $set: update },
        { new: true, runValidators: true }
      );

      if (!doctorRecord) {
        return res.status(404).json({ message: "Doctor record not found" });
      }

      await createActivity(
        "DOCTOR_RECORD_UPDATED",
        "Doctor Record Updated",
        `Doctor record updated for ${doctorRecord.name}`,
        {
          doctorId: doctorRecord.doctorId,
          metadata: { specialization: doctorRecord.specialization },
        }
      );

      res.json(doctorRecord);
    } catch (error: any) {
      console.error("Error updating doctor record:", error);
      res.status(400).json({ message: error.message || "Failed to update doctor record" });
    }
  }
);

// Delete doctor record
router.delete(
  "/:id",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const doctorId = req.params.id;
      const doctorRecord = await DoctorRecord.findOneAndDelete({ doctorId });

      if (!doctorRecord) {
        return res.status(404).json({ message: "Doctor record not found" });
      }

      await createActivity(
        "DOCTOR_RECORD_DELETED",
        "Doctor Record Deleted",
        `Doctor record deleted for ${doctorRecord.name}`,
        {
          doctorId: doctorRecord.doctorId,
        }
      );

      res.json({ message: "Doctor record deleted successfully" });
    } catch (error: any) {
      console.error("Error deleting doctor record:", error);
      res.status(400).json({ message: error.message || "Failed to delete doctor record" });
    }
  }
);

// Get specializations (unique list)
router.get(
  "/specializations/list",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      // Get all specializations from all doctor records (no isActive filter to show all)
      const specializations = await DoctorRecord.distinct("specialization", {});
      const formatted = specializations
        .filter((spec) => spec && spec.trim())
        .map((spec, index) => ({
          _id: String(index + 1),
          name: spec.trim(),
        }))
        .sort((a, b) => a.name.localeCompare(b.name));

      res.json(formatted);
    } catch (error: any) {
      console.error("Error fetching specializations:", error);
      res.status(500).json({ message: error.message || "Failed to fetch specializations" });
    }
  }
);

export default router;

