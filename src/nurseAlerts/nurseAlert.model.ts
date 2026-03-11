import mongoose, { Schema, Document, Model } from "mongoose";

export type AlertType =
  | "CRITICAL_VITALS"
  | "MEDICATION_DUE"
  | "DISCHARGE_READY"
  | "CALL_BELL"
  | "LAB_RESULT"
  | "GENERAL";

export interface INurseAlert extends Document {
  hospitalId?: string;
  ipId?: string;
  patientId?: mongoose.Types.ObjectId;
  nurseId?: mongoose.Types.ObjectId;
  createdBy?: mongoose.Types.ObjectId;
  type: AlertType;
  priority: "HIGH" | "MEDIUM" | "LOW";
  title: string;
  message: string;
  isRead: boolean;
  isAcknowledged: boolean;
  acknowledgedBy?: mongoose.Types.ObjectId;
  acknowledgedAt?: Date;
  createdAt?: Date;
}

const NurseAlertSchema = new Schema<INurseAlert>(
  {
    hospitalId:       { type: String, index: true },
    ipId:             { type: String, index: true },
    patientId:        { type: Schema.Types.ObjectId, ref: "User" },
    nurseId:          { type: Schema.Types.ObjectId, ref: "User", index: true },
    createdBy:        { type: Schema.Types.ObjectId, ref: "User" },
    type:             { type: String, enum: ["CRITICAL_VITALS","MEDICATION_DUE","DISCHARGE_READY","CALL_BELL","LAB_RESULT","GENERAL"], default: "GENERAL" },
    priority:         { type: String, enum: ["HIGH","MEDIUM","LOW"], default: "MEDIUM" },
    title:            { type: String, required: true },
    message:          { type: String, required: true },
    isRead:           { type: Boolean, default: false },
    isAcknowledged:   { type: Boolean, default: false },
    acknowledgedBy:   { type: Schema.Types.ObjectId, ref: "User" },
    acknowledgedAt:   { type: Date },
  },
  { timestamps: true }
);

export const NurseAlert: Model<INurseAlert> =
  mongoose.models.NurseAlert || mongoose.model<INurseAlert>("NurseAlert", NurseAlertSchema);
