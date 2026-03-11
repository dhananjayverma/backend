import mongoose, { Schema, Document, Model } from "mongoose";

export interface IDischarge extends Document {
  ipId: string;
  ipAdmissionId: mongoose.Types.ObjectId;
  hospitalId: string;
  patientId: mongoose.Types.ObjectId;
  doctorId: mongoose.Types.ObjectId;
  billId?: mongoose.Types.ObjectId;
  admissionDate: Date;
  dischargeDate: Date;
  totalDays: number;
  dischargeType: "NORMAL" | "AGAINST_MEDICAL_ADVICE" | "REFERRED" | "EXPIRED";
  diagnosisSummary?: string;
  treatmentSummary?: string;
  medicationsOnDischarge?: string;
  followUpInstructions?: string;
  doctorApprovalStatus: "PENDING" | "APPROVED";
  doctorApprovedAt?: Date;
  approvedBy?: string;
  status: "INITIATED" | "APPROVED" | "COMPLETED";
  createdBy: string;
  createdAt?: Date;
}

const DischargeSchema = new Schema<IDischarge>(
  {
    ipId: { type: String, required: true },
    ipAdmissionId: { type: Schema.Types.ObjectId, ref: "IPAdmission", required: true },
    hospitalId: { type: String, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    doctorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    billId: { type: Schema.Types.ObjectId, ref: "Bill" },
    admissionDate: { type: Date, required: true },
    dischargeDate: { type: Date, required: true },
    totalDays: { type: Number, required: true },
    dischargeType: {
      type: String,
      enum: ["NORMAL", "AGAINST_MEDICAL_ADVICE", "REFERRED", "EXPIRED"],
      default: "NORMAL",
    },
    diagnosisSummary: { type: String },
    treatmentSummary: { type: String },
    medicationsOnDischarge: { type: String },
    followUpInstructions: { type: String },
    doctorApprovalStatus: {
      type: String,
      enum: ["PENDING", "APPROVED"],
      default: "PENDING",
    },
    doctorApprovedAt: { type: Date },
    approvedBy: { type: String },
    status: {
      type: String,
      enum: ["INITIATED", "APPROVED", "COMPLETED"],
      default: "INITIATED",
    },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

export const Discharge: Model<IDischarge> =
  mongoose.models.Discharge || mongoose.model<IDischarge>("Discharge", DischargeSchema);
