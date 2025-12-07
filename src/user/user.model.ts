import mongoose, { Schema, Document, Model } from "mongoose";

export type UserRole =
  | "SUPER_ADMIN"
  | "HOSPITAL_ADMIN"
  | "DOCTOR"
  | "PHARMACY_STAFF"
  | "DISTRIBUTOR"
  | "PATIENT"
  | "DELIVERY_AGENT";

export interface IUser extends Document {
  name: string;
  email: string;
  phone?: string;
  passwordHash: string;
  role: UserRole;
  hospitalId?: string;
  pharmacyId?: string;
  distributorId?: string;
  status?: "AVAILABLE" | "BUSY" | "OFFLINE";
  currentOrderId?: string;
  isActive: boolean;
  // Doctor-specific fields
  specialization?: string;
  qualification?: string;
  serviceCharge?: number;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true, index: true },
    phone: { type: String },
    passwordHash: { type: String, required: true },
    role: {
      type: String,
      enum: ["SUPER_ADMIN", "HOSPITAL_ADMIN", "DOCTOR", "PHARMACY_STAFF", "DISTRIBUTOR", "PATIENT", "DELIVERY_AGENT"],
      required: true,
    },
    hospitalId: { type: String },
    pharmacyId: { type: String },
    distributorId: { type: String },
    status: {
      type: String,
      enum: ["AVAILABLE", "BUSY", "OFFLINE"],
      default: "AVAILABLE",
    },
    currentOrderId: { type: String },
    isActive: { type: Boolean, default: true },
    // Doctor-specific fields
    specialization: { type: String },
    qualification: { type: String },
    serviceCharge: { type: Number },
  },
  { timestamps: true }
);

// Text search index for full-text search
UserSchema.index({ name: "text", email: "text" });

export const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>("User", UserSchema);


