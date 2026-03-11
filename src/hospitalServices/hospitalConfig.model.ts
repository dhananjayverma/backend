import mongoose, { Schema, Document, Model } from "mongoose";

export interface IHospitalConfig extends Document {
  hospitalId: string;
  registrationFee: number;
  generalBedRentPerDay: number;
  semiPrivateRentPerDay: number;
  privateRentPerDay: number;
  icuRentPerDay: number;
  emergencyCharges: number;
  defaultConsultationFee: number;
  taxPercent: number;
  discountMaxPercent: number;
  letterheadTitle?: string;
  letterheadAddress?: string;
  letterheadPhone?: string;
  letterheadLogoUrl?: string;
  updatedAt?: Date;
}

const HospitalConfigSchema = new Schema<IHospitalConfig>(
  {
    hospitalId: { type: String, required: true, unique: true },
    registrationFee: { type: Number, default: 0 },
    generalBedRentPerDay: { type: Number, default: 0 },
    semiPrivateRentPerDay: { type: Number, default: 0 },
    privateRentPerDay: { type: Number, default: 0 },
    icuRentPerDay: { type: Number, default: 0 },
    emergencyCharges: { type: Number, default: 0 },
    defaultConsultationFee: { type: Number, default: 0 },
    taxPercent: { type: Number, default: 0 },
    discountMaxPercent: { type: Number, default: 10 },
    letterheadTitle: { type: String },
    letterheadAddress: { type: String },
    letterheadPhone: { type: String },
    letterheadLogoUrl: { type: String },
  },
  { timestamps: true }
);

export const HospitalConfig: Model<IHospitalConfig> =
  mongoose.models.HospitalConfig || mongoose.model<IHospitalConfig>("HospitalConfig", HospitalConfigSchema);
