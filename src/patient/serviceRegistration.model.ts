import mongoose, { Schema, Document, Model } from "mongoose";

export interface IServiceRegistration extends Document {
  serviceRegId: string;
  hospitalId: string;
  patientId: mongoose.Types.ObjectId;
  registrationDate: Date;
  services: Array<{
    serviceId: mongoose.Types.ObjectId;
    serviceName: string;
    category: string;
    fee: number;
    taxPercent: number;
    taxAmount: number;
    total: number;
  }>;
  subtotal: number;
  taxTotal: number;
  discountPercent: number;
  discountAmount: number;
  grandTotal: number;
  paidAmount: number;
  outstandingBalance: number;
  paymentMode: "CASH" | "CARD" | "UPI" | "INSURANCE" | "PENDING";
  paymentHistory: Array<{ amount: number; mode: string; referenceNumber?: string; date: Date }>;
  status: "ACTIVE" | "COMPLETED" | "PARTIAL" | "CANCELLED";
  notes?: string;
  createdAt?: Date;
}

const ServiceRegistrationSchema = new Schema<IServiceRegistration>(
  {
    serviceRegId: { type: String, required: true, unique: true },
    hospitalId: { type: String, required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    registrationDate: { type: Date, default: Date.now },
    services: [
      {
        serviceId: { type: Schema.Types.ObjectId, ref: "HospitalService" },
        serviceName: { type: String, required: true },
        category: { type: String },
        fee: { type: Number, required: true },
        taxPercent: { type: Number, default: 0 },
        taxAmount: { type: Number, default: 0 },
        total: { type: Number, required: true },
      },
    ],
    subtotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    grandTotal: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    outstandingBalance: { type: Number, default: 0 },
    paymentMode: {
      type: String,
      enum: ["CASH", "CARD", "UPI", "INSURANCE", "PENDING"],
      default: "PENDING",
    },
    paymentHistory: [
      {
        amount: { type: Number, required: true },
        mode: { type: String, required: true },
        referenceNumber: { type: String },
        date: { type: Date, default: Date.now },
      },
    ],
    status: { type: String, enum: ["ACTIVE", "COMPLETED", "PARTIAL", "CANCELLED"], default: "ACTIVE" },
    notes: { type: String },
  },
  { timestamps: true }
);

export const ServiceRegistration: Model<IServiceRegistration> =
  mongoose.models.ServiceRegistration ||
  mongoose.model<IServiceRegistration>("ServiceRegistration", ServiceRegistrationSchema);
