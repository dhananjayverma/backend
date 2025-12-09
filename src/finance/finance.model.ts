import mongoose, { Schema, Document, Model } from "mongoose";

export type FinanceType =
  | "CONSULTATION_REVENUE"
  | "MEDICINE_SALE"
  | "DELIVERY_CHARGE"
  | "DOCTOR_COMMISSION"
  | "DISCOUNT"
  | "STOCK_PURCHASE"
  | "EXPIRED_STOCK_LOSS"
  | "EXTRA_FEE"
  | "TREATMENT_FEE"
  | "PROCEDURE_FEE";

export interface IFinanceEntry extends Document {
  hospitalId?: string;
  pharmacyId?: string;
  distributorId?: string;
  doctorId?: string;
  patientId?: string;
  type: FinanceType;
  amount: number;
  meta?: Record<string, any>;
  occurredAt: Date;
}

const FinanceSchema = new Schema<IFinanceEntry>(
  {
    hospitalId: { type: String, index: true },
    pharmacyId: { type: String, index: true },
    distributorId: { type: String, index: true },
    doctorId: { type: String, index: true },
    patientId: { type: String, index: true },
    type: {
      type: String,
      enum: [
        "CONSULTATION_REVENUE",
        "MEDICINE_SALE",
        "DELIVERY_CHARGE",
        "DOCTOR_COMMISSION",
        "DISCOUNT",
        "STOCK_PURCHASE",
        "EXPIRED_STOCK_LOSS",
        "EXTRA_FEE",
        "TREATMENT_FEE",
        "PROCEDURE_FEE",
      ],
      required: true,
      index: true,
    },
    amount: { type: Number, required: true },
    meta: { type: Schema.Types.Mixed },
    occurredAt: { type: Date, default: Date.now, index: true },
  },
  { timestamps: true }
);

export const FinanceEntry: Model<IFinanceEntry> =
  mongoose.models.FinanceEntry || mongoose.model<IFinanceEntry>("FinanceEntry", FinanceSchema);


