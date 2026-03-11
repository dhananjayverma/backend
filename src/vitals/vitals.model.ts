import mongoose, { Schema, Document, Model } from "mongoose";

export interface IVitals extends Document {
  ipId: string;
  hospitalId?: string;
  patientId?: mongoose.Types.ObjectId;
  recordedBy?: mongoose.Types.ObjectId;
  temperature?: number;
  pulse?: number;
  respiratoryRate?: number;
  bloodPressure?: string;
  spo2?: number;
  weight?: number;
  bloodSugar?: number;
  pain?: number;
  notes?: string;
  recordedAt: Date;
  createdAt?: Date;
}

const VitalsSchema = new Schema<IVitals>(
  {
    ipId:           { type: String, required: true, index: true },
    hospitalId:     { type: String, index: true },
    patientId:      { type: Schema.Types.ObjectId, ref: "User" },
    recordedBy:     { type: Schema.Types.ObjectId, ref: "User" },
    temperature:    { type: Number },
    pulse:          { type: Number },
    respiratoryRate:{ type: Number },
    bloodPressure:  { type: String },
    spo2:           { type: Number },
    weight:         { type: Number },
    bloodSugar:     { type: Number },
    pain:           { type: Number, min: 0, max: 10 },
    notes:          { type: String },
    recordedAt:     { type: Date, default: Date.now },
  },
  { timestamps: true }
);

export const Vitals: Model<IVitals> =
  mongoose.models.Vitals || mongoose.model<IVitals>("Vitals", VitalsSchema);
