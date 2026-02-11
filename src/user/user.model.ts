import mongoose, { Schema, Document, Model } from "mongoose";

export type UserRole =
  | "SUPER_ADMIN"
  | "HOSPITAL_ADMIN"
  | "DOCTOR"
  | "PHARMACY_STAFF"
  | "DISTRIBUTOR"
  | "PATIENT"
  | "DELIVERY_AGENT";

/** Role within a pharmacy branch (for multi-login per branch) */
export type PharmacyBranchRole = "PHARMACY_MANAGER" | "PHARMACY_CASHIER" | "PHARMACY_STAFF";

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
  /** Role within pharmacy branch (Manager, Cashier, Staff) for permission checks */
  pharmacyBranchRole?: PharmacyBranchRole;
  // Doctor-specific fields
  specialization?: string;
  qualification?: string;
  serviceCharge?: number;
  // MFA fields
  mfaEnabled?: boolean;
  mfaSecret?: string; // TOTP secret for 2FA
  backupCodes?: string[]; // Backup codes for MFA
  createdAt?: Date;
  updatedAt?: Date;
}

const UserSchema = new Schema<IUser>(
  {
    name: { type: String, required: true },
    email: { type: String, required: true, unique: true },
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
    pharmacyBranchRole: {
      type: String,
      enum: ["PHARMACY_MANAGER", "PHARMACY_CASHIER", "PHARMACY_STAFF"],
      default: "PHARMACY_STAFF",
    },
    // Doctor-specific fields
    specialization: { type: String },
    qualification: { type: String },
    serviceCharge: { type: Number },
    // MFA fields
    mfaEnabled: { type: Boolean, default: false },
    mfaSecret: { type: String },
    backupCodes: { type: [String], default: [] },
  },
  { timestamps: true }
);

UserSchema.index({ name: "text" });

export const User: Model<IUser> = mongoose.models.User || mongoose.model<IUser>("User", UserSchema);
