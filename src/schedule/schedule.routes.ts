import { Router, Request, Response } from "express";
import { DoctorSchedule, Slot, IDoctorSchedule, ISlot, DayOfWeek } from "./schedule.model";
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
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

// ==================== DOCTOR SCHEDULE ROUTES (Admin) ====================

// Helper function to get days based on schedule type
const getDaysForScheduleType = (scheduleType: string, selectedDays?: string[]): DayOfWeek[] => {
  const allDays: DayOfWeek[] = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"];
  
  switch (scheduleType) {
    case "weekday":
      return ["monday", "tuesday", "wednesday", "thursday", "friday"];
    case "weekend":
      return ["saturday", "sunday"];
    case "daily":
      return allDays;
    case "particular":
      return (selectedDays || []) as DayOfWeek[];
    default:
      return [];
  }
};

// Create or update doctor schedule (single or bulk)
router.post(
  "/doctor-schedule",
  requireAuth,
  requireRole(["DOCTOR", "SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const { 
        doctorId, 
        dayOfWeek, 
        startTime, 
        endTime, 
        slotDuration, 
        isActive, 
        maxAppointmentsPerSlot, 
        hospitalId,
        scheduleType, // "weekday" | "weekend" | "daily" | "particular" | "single"
        selectedDays // Array of days for "particular" type
      } = req.body;

      // Validate required fields
      if (!doctorId || !startTime || !endTime || !slotDuration) {
        throw new AppError("doctorId, startTime, endTime, and slotDuration are required", 400);
      }

      // Validate time format (HH:mm)
      const timeRegex = /^([0-1][0-9]|2[0-3]):[0-5][0-9]$/;
      if (!timeRegex.test(startTime) || !timeRegex.test(endTime)) {
        throw new AppError("Invalid time format. Use HH:mm format (e.g., 09:00)", 400);
      }

      // Validate slot duration (30 minutes to 1 hour)
      if (slotDuration < 30 || slotDuration > 60) {
        throw new AppError("Slot duration must be between 30 and 60 minutes", 400);
      }

      // Validate end time is after start time
      const [startH, startM] = startTime.split(":").map(Number);
      const [endH, endM] = endTime.split(":").map(Number);
      const startMinutes = startH * 60 + startM;
      const endMinutes = endH * 60 + endM;
      
      if (endMinutes <= startMinutes) {
        throw new AppError("End time must be after start time", 400);
      }

      const daysToCreate = scheduleType && scheduleType !== "single" 
        ? getDaysForScheduleType(scheduleType, selectedDays)
        : dayOfWeek 
          ? [dayOfWeek as DayOfWeek]
          : [];

      if (daysToCreate.length === 0) {
        throw new AppError("No days specified for schedule creation", 400);
      }

      const createdSchedules: IDoctorSchedule[] = [];
      const updatedSchedules: IDoctorSchedule[] = [];

      // Create or update schedules for each day
      for (const day of daysToCreate) {
        const existing = await DoctorSchedule.findOne({ doctorId, dayOfWeek: day });

        if (existing) {
          // Update existing
          existing.startTime = startTime;
          existing.endTime = endTime;
          existing.slotDuration = slotDuration;
          existing.isActive = isActive !== undefined ? isActive : existing.isActive;
          existing.maxAppointmentsPerSlot = maxAppointmentsPerSlot || existing.maxAppointmentsPerSlot || 1;
          existing.hospitalId = hospitalId || existing.hospitalId;
          await existing.save();
          updatedSchedules.push(existing);
        } else {
          // Create new
          const schedule = await DoctorSchedule.create({
            doctorId,
            dayOfWeek: day,
            startTime,
            endTime,
            slotDuration,
            isActive: isActive !== undefined ? isActive : true,
            maxAppointmentsPerSlot: maxAppointmentsPerSlot || 1,
            hospitalId,
          });
          createdSchedules.push(schedule);
        }
      }

      res.status(201).json({
        message: `Successfully ${createdSchedules.length > 0 ? 'created' : ''} ${createdSchedules.length} schedule(s) and ${updatedSchedules.length > 0 ? 'updated' : ''} ${updatedSchedules.length} schedule(s)`,
        created: createdSchedules,
        updated: updatedSchedules,
        total: createdSchedules.length + updatedSchedules.length
      });
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
router.delete("/doctor-schedule/:id", requireAuth, requireRole(["DOCTOR", "SUPER_ADMIN", "HOSPITAL_ADMIN"]), async (req: Request, res: Response) => {
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

    // Parse and normalize date
    const slotDate = new Date(date as string);
    if (isNaN(slotDate.getTime())) {
      throw new AppError("Invalid date format", 400);
    }
    
    // Normalize date to start of day
    slotDate.setHours(0, 0, 0, 0);

    console.log(`[Slots] Fetching available slots for doctorId: ${doctorId}, date: ${slotDate.toISOString()}, hospitalId: ${hospitalId || 'none'}`);

    const slots = await getAvailableSlots(
      doctorId as string,
      slotDate,
      hospitalId as string | undefined
    );

    console.log(`[Slots] Found ${slots.length} available slots`);
    res.json(slots);
  } catch (error: any) {
    console.error("[Slots] Error fetching available slots:", error);
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Generate slots for a date range (Admin/Background job)
router.post(
  "/slots/generate",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "DOCTOR"]),
  validateRequired(["doctorId", "startDate", "endDate"]),
  async (req: Request, res: Response) => {
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

      // Check if doctor has any active schedules
      const scheduleFilter: any = {
        doctorId,
        isActive: true,
      };
      if (hospitalId) {
        scheduleFilter.$or = [
          { hospitalId: hospitalId },
          { hospitalId: { $exists: false } },
          { hospitalId: null },
        ];
      }

      const hasSchedule = await DoctorSchedule.findOne(scheduleFilter);
      if (!hasSchedule) {
        throw new AppError(
          `No active schedule found for this doctor. Please create a schedule first before generating slots.`,
          400
        );
      }

      const slots = await generateSlotsForDateRange(doctorId, start, end, hospitalId);
      
      if (slots.length === 0) {
        return res.json({
          message: "No slots generated. The doctor may not have active schedules for the selected date range.",
          count: 0,
          slots: [],
        });
      }

      // Emit real-time update for slot generation
      try {
        const { socketEvents } = await import("../socket/socket.server");
        socketEvents.emitToUser(doctorId, "slots:generated", {
          doctorId,
          count: slots.length,
          startDate: start,
          endDate: end,
        });
        socketEvents.emitToAdmin("slots:generated", {
          doctorId,
          count: slots.length,
          startDate: start,
          endDate: end,
        });
      } catch (error) {
        console.warn("Failed to emit slot generation event:", error);
      }

      res.json({ message: "Slots generated successfully", count: slots.length, slots });
    } catch (error: any) {
      console.error("[Slots Generate] Error:", error);
      if (error instanceof AppError) {
        res.status(error.status).json({ message: error.message });
      } else {
        res.status(400).json({ message: error.message || "Failed to generate slots" });
      }
    }
  }
);

// Block a slot (Doctor/Admin)
router.post("/slots/:id/block", async (req: Request, res: Response) => {
  try {
    const slot = await Slot.findById(req.params.id);
    if (!slot) {
      throw new AppError("Slot not found", 404);
    }

    slot.isBlocked = true;
    await slot.save();

    // Emit real-time update for slot blocking
    try {
      const { socketEvents } = await import("../socket/socket.server");
      socketEvents.emitToUser(slot.doctorId, "slot:updated", {
        slotId: String(slot._id),
        doctorId: slot.doctorId,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isBlocked: slot.isBlocked,
        isBooked: slot.isBooked,
        bookedCount: slot.bookedCount,
      });
      socketEvents.emitToAdmin("slot:updated", {
        slotId: String(slot._id),
        doctorId: slot.doctorId,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isBlocked: slot.isBlocked,
        isBooked: slot.isBooked,
      });
    } catch (error) {
      console.warn("Failed to emit slot update event:", error);
    }

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

    // Emit real-time update for slot unblocking
    try {
      const { socketEvents } = await import("../socket/socket.server");
      socketEvents.emitToUser(slot.doctorId, "slot:updated", {
        slotId: String(slot._id),
        doctorId: slot.doctorId,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isBlocked: slot.isBlocked,
        isBooked: slot.isBooked,
        bookedCount: slot.bookedCount,
      });
      socketEvents.emitToAdmin("slot:updated", {
        slotId: String(slot._id),
        doctorId: slot.doctorId,
        date: slot.date,
        startTime: slot.startTime,
        endTime: slot.endTime,
        isBlocked: slot.isBlocked,
        isBooked: slot.isBooked,
      });
    } catch (error) {
      console.warn("Failed to emit slot update event:", error);
    }

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

