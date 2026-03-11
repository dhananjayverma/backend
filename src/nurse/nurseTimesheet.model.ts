import mongoose, { Schema, Document, Model } from "mongoose";

export interface INurseTimesheet extends Document {
  nurseId: mongoose.Types.ObjectId;
  nurseName: string;
  hospitalId: string;
  patientCategory: "IP" | "OP" | "SERVICES";
  patientCategoryId: string; // ipId / opId / serviceRegId
  patientId: mongoose.Types.ObjectId;
  date: Date;
  shiftType: "DAY" | "NIGHT";
  department: string;
  checkIn: Date;
  checkOut?: Date;
  handoverTo?: mongoose.Types.ObjectId;
  handoverToName?: string;
  handoverNotes?: string;
  handoverChecklist: {
    vitals: boolean;
    medicationPending: boolean;
    labPending: boolean;
    observations: boolean;
    specialInstructions: boolean;
  };
  servicesProvided: string[];
  medicationAdministered?: string;
  vitalsRecorded?: {
    bp?: string;
    pulse?: string;
    temperature?: string;
    spo2?: string;
    notes?: string;
  };
  observations?: string;
  emergencyFlag: boolean;
  emergencyDetails?: string;
  status: "SUBMITTED" | "EDIT_REQUESTED" | "EDITED";
  editApprovedBy?: string;
  isLate: boolean;
  createdAt?: Date;
}

const NurseTimesheetSchema = new Schema<INurseTimesheet>(
  {
    nurseId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    nurseName: { type: String, required: true },
    hospitalId: { type: String, required: true, index: true },
    patientCategory: { type: String, enum: ["IP", "OP", "SERVICES"], required: true },
    patientCategoryId: { type: String, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    date: { type: Date, required: true },
    shiftType: { type: String, enum: ["DAY", "NIGHT"], required: true },
    department: { type: String, required: true },
    checkIn: { type: Date, required: true },
    checkOut: { type: Date },
    handoverTo: { type: Schema.Types.ObjectId, ref: "User" },
    handoverToName: { type: String },
    handoverNotes: { type: String },
    handoverChecklist: {
      vitals: { type: Boolean, default: false },
      medicationPending: { type: Boolean, default: false },
      labPending: { type: Boolean, default: false },
      observations: { type: Boolean, default: false },
      specialInstructions: { type: Boolean, default: false },
    },
    servicesProvided: [{ type: String }],
    medicationAdministered: { type: String },
    vitalsRecorded: {
      bp: { type: String },
      pulse: { type: String },
      temperature: { type: String },
      spo2: { type: String },
      notes: { type: String },
    },
    observations: { type: String },
    emergencyFlag: { type: Boolean, default: false },
    emergencyDetails: { type: String },
    status: {
      type: String,
      enum: ["SUBMITTED", "EDIT_REQUESTED", "EDITED"],
      default: "SUBMITTED",
    },
    editApprovedBy: { type: String },
    isLate: { type: Boolean, default: false },
  },
  { timestamps: true }
);

export const NurseTimesheet: Model<INurseTimesheet> =
  mongoose.models.NurseTimesheet || mongoose.model<INurseTimesheet>("NurseTimesheet", NurseTimesheetSchema);
