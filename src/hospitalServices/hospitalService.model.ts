import mongoose, { Schema, Document, Model } from "mongoose";

export interface IHospitalService extends Document {
  hospitalId: string;
  name: string;
  category: "LAB" | "SCAN" | "PROCEDURE" | "CONSULTATION" | "OTHER";
  description?: string;
  fee: number;
  taxPercent: number;
  isActive: boolean;
  createdAt?: Date;
}

const HospitalServiceSchema = new Schema<IHospitalService>(
  {
    hospitalId: { type: String, required: true, index: true },
    name: { type: String, required: true },
    category: {
      type: String,
      enum: ["LAB", "SCAN", "PROCEDURE", "CONSULTATION", "OTHER"],
      required: true,
    },
    description: { type: String },
    fee: { type: Number, required: true, default: 0 },
    taxPercent: { type: Number, default: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const HospitalService: Model<IHospitalService> =
  mongoose.models.HospitalService || mongoose.model<IHospitalService>("HospitalService", HospitalServiceSchema);
