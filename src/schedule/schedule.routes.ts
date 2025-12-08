import { Router, Request, Response } from "express";
import { DoctorSchedule, Slot, IDoctorSchedule, ISlot } from "./schedule.model";
import {
  generateSlotsForDate,
  generateSlotsForDateRange,
  getAvailableSlots,
  bookSlot,
  releaseSlot,
  blockSlot,
  unblockSlot,
} from "./schedule.service";
import { validateRequired } from "../shared/middleware/validation";
import { AppError } from "../shared/middleware/errorHandler";
import { Appointment } from "../appointment/appointment.model";

export const router = Router();

// ==================== DOCTOR SCHEDULE ROUTES (Admin) ====================

// Create or update doctor schedule
router.post(
  "/doctor-schedule",
  validateRequired(["doctorId", "dayOfWeek", "startTime", "endTime", "slotDuration"]),
  async (req: Request, res: Response) => {
    try {
      const { doctorId, dayOfWeek, startTime, endTime, slotDuration, isActive, maxAppointmentsPerSlot, hospitalId } = req.body;

      // Validate time format (HH:mm)
      const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
        throw new AppError("Invalid time format. Use HH:mm format (e.g., 09:00)", 400);
      }

      // Validate slot duration
      if (slotDuration < 5 || slotDuration > 120) {
        throw new AppError("Slot duration must be between 5 and 120 minutes", 400);
      }

      // Validate end time is after start time
      const [startH, startM] = startTime.split(":").map(Number);
      const [endH, endM] = endTime.split(":").map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;
      
      if (endMinutes <= startMinutes) {
        throw new AppError("End time must be after start time", 400);
      }

      // Check if schedule already exists
      const existing = await DoctorSchedule.findOne({ doctorId, dayOfWeek });

      let schedule: IDoctorSchedule;
      if (existing) {
        // Update existing
        existing.startTime = startTime;
        existing.endTime = endTime;
        existing.slotDuration = slotDuration;
        existing.isActive = isActive !== undefined ? isActive : existing.isActive;
        existing.maxAppointmentsPerSlot = maxAppointmentsPerSlot || existing.maxAppointmentsPerSlot || 1;
        existing.hospitalId = hospitalId || existing.hospitalId;
        await existing.save();
        schedule = existing;
      } else {
        // Create new
        schedule = await DoctorSchedule.create({
          doctorId,
          dayOfWeek,
          startTime,
          endTime,
          slotDuration,
          isActive: isActive !== undefined ? isActive : true,
          maxAppointmentsPerSlot: maxAppointmentsPerSlot || 1,
          hospitalId,
        });
      }

      res.status(201).json(schedule);
    } catch (error: any) {
      if (error instanceof AppError) {
        res.status(error.status).json({ message: error.message });
      } else {
        res.status(400).json({ message: error.message });
      }
    }
  }
);

// Get doctor schedules
router.get("/doctor-schedule/:doctorId", async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.params;
    const schedules = await DoctorSchedule.find({ doctorId }).sort({ dayOfWeek: 1 });
    res.json(schedules);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get all doctor schedules (Admin)
router.get("/doctor-schedule", async (req: Request, res: Response) => {
  try {
    const { hospitalId } = req.query;
    const filter: any = {};
    if (hospitalId) filter.hospitalId = hospitalId;
    
    const schedules = await DoctorSchedule.find(filter).sort({ doctorId: 1, dayOfWeek: 1 });
    res.json(schedules);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Delete doctor schedule
router.delete("/doctor-schedule/:id", async (req: Request, res: Response) => {
  try {
    const schedule = await DoctorSchedule.findByIdAndDelete(req.params.id);
    if (!schedule) {
      throw new AppError("Schedule not found", 404);
    }
    res.json({ message: "Schedule deleted successfully" });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// ==================== SLOT ROUTES ====================

// Get available slots for a doctor on a specific date
router.get("/slots/available", async (req: Request, res: Response) => {
  try {
    const { doctorId, date, hospitalId } = req.query;

    if (!doctorId || !date) {
      throw new AppError("doctorId and date are required", 400);
    }

    const slotDate = new Date(date as string);
    if (isNaN(slotDate.getTime())) {
      throw new AppError("Invalid date format", 400);
    }

    const slots = await getAvailableSlots(
      doctorId as string,
      slotDate,
      hospitalId as string | undefined
    );

    res.json(slots);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Generate slots for a date range (Admin/Background job)
router.post("/slots/generate", validateRequired(["doctorId", "startDate", "endDate"]), async (req: Request, res: Response) => {
  try {
    const { doctorId, startDate, endDate, hospitalId } = req.body;

    const start = new Date(startDate);
    const end = new Date(endDate);

    if (isNaN(start.getTime()) || isNaN(end.getTime())) {
      throw new AppError("Invalid date format", 400);
    }

    if (start > end) {
      throw new AppError("startDate must be before endDate", 400);
    }

    const slots = await generateSlotsForDateRange(doctorId, start, end, hospitalId);
    res.json({ message: "Slots generated successfully", count: slots.length, slots });
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Block a slot (Doctor/Admin)
router.post("/slots/:id/block", async (req: Request, res: Response) => {
  try {
    const slot = await Slot.findById(req.params.id);
    if (!slot) {
      throw new AppError("Slot not found", 404);
    }

    slot.isBlocked = true;
    await slot.save();

    res.json(slot);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Unblock a slot (Doctor/Admin)
router.post("/slots/:id/unblock", async (req: Request, res: Response) => {
  try {
    const slot = await Slot.findById(req.params.id);
    if (!slot) {
      throw new AppError("Slot not found", 404);
    }

    slot.isBlocked = false;
    await slot.save();

    res.json(slot);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Get slots for a doctor (Doctor app)
router.get("/slots/doctor/:doctorId", async (req: Request, res: Response) => {
  try {
    const { doctorId } = req.params;
    const { date, startDate, endDate } = req.query;

    let slots: ISlot[];

    if (date) {
      const slotDate = new Date(date as string);
      if (isNaN(slotDate.getTime())) {
        throw new AppError("Invalid date format", 400);
      }
      slotDate.setHours(0, 0, 0, 0);
      const nextDay = new Date(slotDate);
      nextDay.setDate(nextDay.getDate() + 1);

      slots = await Slot.find({
        doctorId,
        date: { $gte: slotDate, $lt: nextDay },
      }).sort({ startTime: 1 });
    } else if (startDate && endDate) {
      const start = new Date(startDate as string);
      const end = new Date(endDate as string);
      if (isNaN(start.getTime()) || isNaN(end.getTime())) {
        throw new AppError("Invalid date format", 400);
      }

      slots = await Slot.find({
        doctorId,
        date: { $gte: start, $lte: end },
      }).sort({ startTime: 1 });
    } else {
      // Default: today and next 7 days
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      const nextWeek = new Date(today);
      nextWeek.setDate(nextWeek.getDate() + 7);

      slots = await Slot.find({
        doctorId,
        date: { $gte: today, $lte: nextWeek },
      }).sort({ startTime: 1 });
    }

    // Update booking status from appointments
    const now = new Date();
    for (const slot of slots) {
      const appointments = await Appointment.find({
        doctorId,
        scheduledAt: {
          $gte: slot.startTime,
          $lt: slot.endTime,
        },
        status: { $in: ["PENDING", "CONFIRMED"] },
      });

      slot.bookedCount = appointments.length;
      slot.isBooked = slot.bookedCount >= slot.maxBookings;
      await slot.save();
    }

    res.json(slots);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

