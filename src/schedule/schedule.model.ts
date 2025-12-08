import mongoose, { Schema, Document, Model } from "mongoose";

export type DayOfWeek = "monday" | "tuesday" | "wednesday" | "thursday" | "friday" | "saturday" | "sunday";

export interface IDoctorSchedule extends Document {
  doctorId: string;
  dayOfWeek: DayOfWeek;
  startTime: string; // Format: "HH:mm" (e.g., "09:00")
  endTime: string; // Format: "HH:mm" (e.g., "17:00")
  slotDuration: number; // Duration in minutes (e.g., 15, 30, 45)
  isActive: boolean;
  maxAppointmentsPerSlot?: number; // Default: 1
  hospitalId?: string;
}

export interface ISlot extends Document {
  doctorId: string;
  date: Date; // Date only (without time)
  startTime: Date; // Full datetime
  endTime: Date; // Full datetime
  isBooked: boolean;
  isBlocked: boolean; // Doctor manually blocked
  bookedCount: number; // Current bookings in this slot
  maxBookings: number; // Maximum bookings allowed
  hospitalId?: string;
}

const DoctorScheduleSchema = new Schema<IDoctorSchedule>(
  {
    doctorId: { type: String, required: true, index: true },
    dayOfWeek: {
      type: String,
      enum: ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"],
      required: true,
      index: true,
    },
    startTime: { type: String, required: true }, // "HH:mm" format
    endTime: { type: String, required: true }, // "HH:mm" format
    slotDuration: { type: Number, required: true, default: 15 }, // minutes
    isActive: { type: Boolean, default: true },
    maxAppointmentsPerSlot: { type: Number, default: 1 },
    hospitalId: { type: String, index: true },
  },
  { timestamps: true }
);

// Compound index for efficient queries
DoctorScheduleSchema.index({ doctorId: 1, dayOfWeek: 1 });

const SlotSchema = new Schema<ISlot>(
  {
    doctorId: { type: String, required: true, index: true },
    date: { type: Date, required: true, index: true },
    startTime: { type: Date, required: true, index: true },
    endTime: { type: Date, required: true },
    isBooked: { type: Boolean, default: false, index: true },
    isBlocked: { type: Boolean, default: false, index: true },
    bookedCount: { type: Number, default: 0 },
    maxBookings: { type: Number, default: 1 },
    hospitalId: { type: String, index: true },
  },
  { timestamps: true }
);

// Compound indexes for efficient queries
SlotSchema.index({ doctorId: 1, date: 1, startTime: 1 });
SlotSchema.index({ doctorId: 1, date: 1, isBooked: 1, isBlocked: 1 });
SlotSchema.index({ date: 1, startTime: 1 });

export const DoctorSchedule: Model<IDoctorSchedule> =
  mongoose.models.DoctorSchedule || mongoose.model<IDoctorSchedule>("DoctorSchedule", DoctorScheduleSchema);

export const Slot: Model<ISlot> =
  mongoose.models.Slot || mongoose.model<ISlot>("Slot", SlotSchema);

