import mongoose, { Document, Model, Schema } from "mongoose";

export type ActivityType =
  | "APPOINTMENT_CREATED"
  | "APPOINTMENT_STATUS_UPDATED"
  | "APPOINTMENT_RESCHEDULED"
  | "APPOINTMENT_CANCELLED"
  | "APPOINTMENT_DELETED"
  | "APPOINTMENT_REPORT_UPLOADED"
  | "CONVERSATION_STARTED"
  | "PRESCRIPTION_CREATED"
  | "PRESCRIPTION_UPDATED"
  | "PRESCRIPTION_FORMATTED"
  | "PRESCRIPTION_FINALIZED"
  | "PRESCRIPTION_DELETED"
  | "ORDER_CREATED"
  | "ORDER_STATUS_UPDATED"
  | "INVENTORY_LOW_STOCK"
  | "INVENTORY_UPDATED"
  | "INVENTORY_DELETED"
  | "DISTRIBUTOR_ORDER_CREATED"
  | "DISTRIBUTOR_ORDER_DELIVERED"
  | "FINANCE_ENTRY_CREATED"
  | "USER_CREATED"
  | "USER_UPDATED"
  | "USER_DELETED"
  | "HOSPITAL_CREATED"
  | "HOSPITAL_UPDATED"
  | "HOSPITAL_DELETED"
  | "PHARMACY_CREATED"
  | "PHARMACY_UPDATED"
  | "PHARMACY_DELETED"
  | "DISTRIBUTOR_CREATED"
  | "DISTRIBUTOR_UPDATED"
  | "DISTRIBUTOR_DELETED"
  | "TEMPLATE_CREATED"
  | "TEMPLATE_UPDATED"
  | "TEMPLATE_DELETED"
  | "PRICING_CREATED"
  | "PRICING_UPDATED"
  | "PRICING_DELETED";

export interface IActivity extends Document {
  type: ActivityType;
  title: string;
  description: string;
  userId?: string;
  hospitalId?: string;
  pharmacyId?: string;
  distributorId?: string;
  doctorId?: string;
  patientId?: string;
  metadata?: Record<string, any>;
  createdAt: Date;
}

const ActivitySchema = new Schema<IActivity>(
  {
    type: {
      type: String,
      enum: [
        "APPOINTMENT_CREATED",
        "APPOINTMENT_STATUS_UPDATED",
        "APPOINTMENT_RESCHEDULED",
        "APPOINTMENT_CANCELLED",
        "APPOINTMENT_DELETED",
        "APPOINTMENT_REPORT_UPLOADED",
        "CONVERSATION_STARTED",
        "PRESCRIPTION_CREATED",
        "PRESCRIPTION_UPDATED",
        "PRESCRIPTION_FORMATTED",
        "PRESCRIPTION_FINALIZED",
        "PRESCRIPTION_DELETED",
        "ORDER_CREATED",
        "ORDER_STATUS_UPDATED",
        "INVENTORY_LOW_STOCK",
        "INVENTORY_UPDATED",
        "INVENTORY_DELETED",
        "DISTRIBUTOR_ORDER_CREATED",
        "DISTRIBUTOR_ORDER_DELIVERED",
        "FINANCE_ENTRY_CREATED",
        "USER_CREATED",
        "USER_UPDATED",
        "USER_DELETED",
        "HOSPITAL_CREATED",
        "HOSPITAL_UPDATED",
        "HOSPITAL_DELETED",
        "PHARMACY_CREATED",
        "PHARMACY_UPDATED",
        "PHARMACY_DELETED",
        "DISTRIBUTOR_CREATED",
        "DISTRIBUTOR_UPDATED",
        "DISTRIBUTOR_DELETED",
        "TEMPLATE_CREATED",
        "TEMPLATE_UPDATED",
        "TEMPLATE_DELETED",
        "PRICING_CREATED",
        "PRICING_UPDATED",
        "PRICING_DELETED",
      ],
      required: true,
      index: true,
    },
    title: { type: String, required: true },
    description: { type: String, required: true },
    userId: { type: String, index: true },
    hospitalId: { type: String, index: true },
    pharmacyId: { type: String, index: true },
    distributorId: { type: String, index: true },
    doctorId: { type: String, index: true },
    patientId: { type: String, index: true },
    metadata: { type: Schema.Types.Mixed, default: {} },
  },
  { timestamps: true }
);

export const Activity: Model<IActivity> =
  mongoose.models.Activity || mongoose.model<IActivity>("Activity", ActivitySchema);

