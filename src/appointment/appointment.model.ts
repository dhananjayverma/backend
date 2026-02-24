import mongoose, { Schema, Document, Model } from "mongoose";

export type AppointmentStatus =
  | "PENDING"
  | "SCHEDULED"
  | "CONFIRMED"
  | "CHECKED_IN"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "CANCELLED";
export type AppointmentChannel = "PHYSICAL" | "VIDEO";

export interface IAppointment extends Document {
  hospitalId: string;
  doctorId: string;
  patientId: string;
  scheduledAt: Date;
  status: AppointmentStatus;
  patientName: string;
  age: number;
  address: string;
  issue: string;
  reportFile?: string;
  reportFileName?: string;
  reason?: string;
  channel: AppointmentChannel;
  slotId?: string; // Reference to the slot that was booked
  cancellationReason?: string; // Reason provided when cancelled by doctor
  rescheduleReason?: string; // Reason provided when rescheduled by doctor
  tokenNumber?: number; // Queue token (reception)
  appointmentType?: string; // e.g. WALK_IN, FOLLOW_UP, EMERGENCY
  isEmergency?: boolean;
  appointmentDate?: Date; // Alias for scheduledAt for aggregation
}

const AppointmentSchema = new Schema<IAppointment>(
  {
    hospitalId: { type: String, required: true, index: true },
    doctorId: { type: String, required: true, index: true },
    patientId: { type: String, required: true, index: true },
    scheduledAt: { type: Date, required: true },
    status: {
      type: String,
      enum: ["PENDING", "SCHEDULED", "CONFIRMED", "CHECKED_IN", "IN_PROGRESS", "COMPLETED", "CANCELLED"],
      default: "PENDING",
      index: true,
    },
    patientName: { type: String, required: true },
    age: { type: Number, required: true },
    address: { type: String, required: true },
    issue: { type: String, required: true },
    reportFile: { type: String },
    reportFileName: { type: String },
    reason: { type: String },
    channel: {
      type: String,
      enum: ["PHYSICAL", "VIDEO"],
      default: "PHYSICAL",
    },
    slotId: { type: String },
    cancellationReason: { type: String },
    rescheduleReason: { type: String },
    tokenNumber: { type: Number },
    appointmentType: { type: String },
    isEmergency: { type: Boolean, default: false },
    appointmentDate: { type: Date },
  },
  { timestamps: true }
);

export const Appointment: Model<IAppointment> =
  mongoose.models.Appointment || mongoose.model<IAppointment>("Appointment", AppointmentSchema);
