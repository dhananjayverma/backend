import mongoose, { Schema, Document, Model } from "mongoose";

export interface IBillLineItem {
  description: string;
  category: "DOCTOR_CONSULTATION" | "ROOM_RENT" | "BED_CHARGE" | "LAB" | "PHARMACY" | "PROCEDURE" | "SERVICE" | "EMERGENCY" | "REGISTRATION" | "OTHER";
  quantity: number;
  unitPrice: number;
  taxPercent: number;
  taxAmount: number;
  total: number;
}

export interface IPaymentEntry {
  amount: number;
  mode: "CASH" | "CARD" | "UPI" | "INSURANCE";
  referenceNumber?: string;
  receivedAt: Date;
  receivedBy: string;
  notes?: string;
}

export interface IBill extends Document {
  billNumber: string;
  hospitalId: string;
  patientId: mongoose.Types.ObjectId;
  billType: "IP" | "OP" | "SERVICE";
  referenceId: string; // ipId / opId / serviceRegId
  referenceObjectId?: mongoose.Types.ObjectId;
  patientName: string;
  patientContact?: string;
  lineItems: IBillLineItem[];
  subtotal: number;
  taxTotal: number;
  discountPercent: number;
  discountAmount: number;
  discountApprovedBy?: string;
  grandTotal: number;
  paidAmount: number;
  outstandingBalance: number;
  paymentHistory: IPaymentEntry[];
  status: "DRAFT" | "ACTIVE" | "PARTIAL" | "PAID" | "FROZEN" | "CANCELLED";
  isFrozen: boolean;
  frozenAt?: Date;
  notes?: string;
  createdBy: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const BillSchema = new Schema<IBill>(
  {
    billNumber: { type: String, required: true, unique: true },
    hospitalId: { type: String, required: true, index: true },
    patientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    billType: { type: String, enum: ["IP", "OP", "SERVICE"], required: true },
    referenceId: { type: String, required: true },
    referenceObjectId: { type: Schema.Types.ObjectId },
    patientName: { type: String, required: true },
    patientContact: { type: String },
    lineItems: [
      {
        description: { type: String, required: true },
        category: {
          type: String,
          enum: ["DOCTOR_CONSULTATION", "ROOM_RENT", "BED_CHARGE", "LAB", "PHARMACY", "PROCEDURE", "SERVICE", "EMERGENCY", "REGISTRATION", "OTHER"],
        },
        quantity: { type: Number, default: 1 },
        unitPrice: { type: Number, required: true },
        taxPercent: { type: Number, default: 0 },
        taxAmount: { type: Number, default: 0 },
        total: { type: Number, required: true },
      },
    ],
    subtotal: { type: Number, default: 0 },
    taxTotal: { type: Number, default: 0 },
    discountPercent: { type: Number, default: 0 },
    discountAmount: { type: Number, default: 0 },
    discountApprovedBy: { type: String },
    grandTotal: { type: Number, default: 0 },
    paidAmount: { type: Number, default: 0 },
    outstandingBalance: { type: Number, default: 0 },
    paymentHistory: [
      {
        amount: { type: Number, required: true },
        mode: { type: String, enum: ["CASH", "CARD", "UPI", "INSURANCE"] },
        referenceNumber: { type: String },
        receivedAt: { type: Date, default: Date.now },
        receivedBy: { type: String },
        notes: { type: String },
      },
    ],
    status: {
      type: String,
      enum: ["DRAFT", "ACTIVE", "PARTIAL", "PAID", "FROZEN", "CANCELLED"],
      default: "ACTIVE",
    },
    isFrozen: { type: Boolean, default: false },
    frozenAt: { type: Date },
    notes: { type: String },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

export const Bill: Model<IBill> = mongoose.models.Bill || mongoose.model<IBill>("Bill", BillSchema);
