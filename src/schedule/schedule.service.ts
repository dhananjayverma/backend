import { DoctorSchedule, Slot, IDoctorSchedule, ISlot } from "./schedule.model";
import { Appointment } from "../appointment/appointment.model";
import mongoose from "mongoose";

/**
 * Generate slots for a specific date based on doctor's schedule
 */
export async function generateSlotsForDate(
  doctorId: string,
  date: Date,
  hospitalId?: string
): Promise<ISlot[]> {
  // Get day of week (0 = Sunday, 1 = Monday, ..., 6 = Saturday)
  const dayOfWeekNum = date.getDay();
  const dayMap: { [key: number]: string } = {
    0: "sunday",
    1: "monday",
    2: "tuesday",
    3: "wednesday",
    4: "thursday",
    5: "friday",
    6: "saturday",
  };
  const dayOfWeek = dayMap[dayOfWeekNum] as IDoctorSchedule["dayOfWeek"];

  // Find doctor's schedule for this day
  const schedule = await DoctorSchedule.findOne({
    doctorId,
    dayOfWeek,
    isActive: true,
  });

  if (!schedule) {
    return []; // No schedule for this day
  }

  // Parse start and end times
  const [startHour, startMinute] = schedule.startTime.split(":").map(Number);
  const [endHour, endMinute] = schedule.endTime.split(":").map(Number);

  // Create date objects for start and end
  const slotDate = new Date(date);
  slotDate.setHours(0, 0, 0, 0);
  const startDateTime = new Date(slotDate);
  startDateTime.setHours(startHour, startMinute, 0, 0);
  const endDateTime = new Date(slotDate);
  endDateTime.setHours(endHour, endMinute, 0, 0);

  // Generate slots
  const slots: ISlot[] = [];
  let currentTime = new Date(startDateTime);

  while (currentTime < endDateTime) {
    const slotEndTime = new Date(currentTime.getTime() + schedule.slotDuration * 60 * 1000);

    // Don't create slots that exceed end time
    if (slotEndTime > endDateTime) {
      break;
    }

    // Check if slot already exists
    const existingSlot = await Slot.findOne({
      doctorId,
      startTime: currentTime,
    });

    if (!existingSlot) {
      // Create new slot
      const newSlot = await Slot.create({
        doctorId,
        date: slotDate,
        startTime: currentTime,
        endTime: slotEndTime,
        isBooked: false,
        isBlocked: false,
        bookedCount: 0,
        maxBookings: schedule.maxAppointmentsPerSlot || 1,
        hospitalId: hospitalId || schedule.hospitalId,
      });

      slots.push(newSlot);
    } else {
      slots.push(existingSlot);
    }

    // Move to next slot
    currentTime = slotEndTime;
  }

  return slots;
}

/**
 * Generate slots for a date range
 */
export async function generateSlotsForDateRange(
  doctorId: string,
  startDate: Date,
  endDate: Date,
  hospitalId?: string
): Promise<ISlot[]> {
  const allSlots: ISlot[] = [];
  const currentDate = new Date(startDate);
  currentDate.setHours(0, 0, 0, 0);
  const end = new Date(endDate);
  end.setHours(23, 59, 59, 999);

  while (currentDate <= end) {
    const slots = await generateSlotsForDate(doctorId, currentDate, hospitalId);
    allSlots.push(...slots);
    currentDate.setDate(currentDate.getDate() + 1);
  }

  return allSlots;
}

/**
 * Get available slots for a doctor on a specific date
 */
export async function getAvailableSlots(
  doctorId: string,
  date: Date,
  hospitalId?: string
): Promise<ISlot[]> {
  // Ensure slots are generated for this date
  await generateSlotsForDate(doctorId, date, hospitalId);

  // Get all slots for this date
  const slotDate = new Date(date);
  slotDate.setHours(0, 0, 0, 0);
  const nextDay = new Date(slotDate);
  nextDay.setDate(nextDay.getDate() + 1);

  const slots = await Slot.find({
    doctorId,
    date: {
      $gte: slotDate,
      $lt: nextDay,
    },
    isBlocked: false,
    hospitalId: hospitalId || { $exists: false },
  }).sort({ startTime: 1 });

  // Filter out fully booked slots and update booking status
  const now = new Date();
  const availableSlots: ISlot[] = [];

  for (const slot of slots) {
    // Don't show past slots
    if (slot.startTime < now) {
      continue;
    }

    // Check actual bookings for this slot
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

    if (!slot.isBooked) {
      availableSlots.push(slot);
    }
  }

  return availableSlots;
}

/**
 * Book a slot (mark as booked and create appointment)
 */
export async function bookSlot(
  doctorId: string,
  startTime: Date,
  hospitalId?: string
): Promise<ISlot | null> {
  // Find slot that contains this startTime
  const slot = await Slot.findOne({
    doctorId,
    startTime: { $lte: startTime },
    endTime: { $gt: startTime },
    isBlocked: false,
    hospitalId: hospitalId || { $exists: false },
  });

  if (!slot) {
    // Slot doesn't exist - might need to generate it first
    // Try to generate slots for this date
    const slotDate = new Date(normalizedTime);
    slotDate.setHours(0, 0, 0, 0);
    await generateSlotsForDate(doctorId, slotDate, hospitalId);
    
    // Try to find again
    const newSlot = await Slot.findOne({
      doctorId,
      startTime: normalizedTime,
      isBlocked: false,
    });

    if (!newSlot || newSlot.isBooked || newSlot.bookedCount >= newSlot.maxBookings) {
      return null;
    }

    newSlot.bookedCount += 1;
    newSlot.isBooked = newSlot.bookedCount >= newSlot.maxBookings;
    await newSlot.save();
    return newSlot;
  }

  // Check actual bookings to ensure accuracy
  const appointments = await Appointment.find({
    doctorId,
    scheduledAt: {
      $gte: slot.startTime,
      $lt: slot.endTime,
    },
    status: { $in: ["PENDING", "CONFIRMED"] },
  });

  slot.bookedCount = appointments.length;

  // Check if slot is available
  if (slot.isBlocked || slot.bookedCount >= slot.maxBookings) {
    return null;
  }

  // Update slot
  slot.bookedCount += 1;
  slot.isBooked = slot.bookedCount >= slot.maxBookings;
  await slot.save();

  return slot;
}

/**
 * Release a slot (when appointment is cancelled)
 */
export async function releaseSlot(doctorId: string, startTime: Date): Promise<void> {
  const slot = await Slot.findOne({
    doctorId,
    startTime,
  });

  if (slot) {
    slot.bookedCount = Math.max(0, slot.bookedCount - 1);
    slot.isBooked = slot.bookedCount >= slot.maxBookings;
    await slot.save();
  }
}

/**
 * Block a slot (doctor unavailable)
 */
export async function blockSlot(doctorId: string, startTime: Date): Promise<ISlot | null> {
  const slot = await Slot.findOne({
    doctorId,
    startTime,
  });

  if (!slot) {
    return null;
  }

  slot.isBlocked = true;
  await slot.save();

  return slot;
}

/**
 * Unblock a slot
 */
export async function unblockSlot(doctorId: string, startTime: Date): Promise<ISlot | null> {
  const slot = await Slot.findOne({
    doctorId,
    startTime,
  });

  if (!slot) {
    return null;
  }

  slot.isBlocked = false;
  await slot.save();

  return slot;
}

