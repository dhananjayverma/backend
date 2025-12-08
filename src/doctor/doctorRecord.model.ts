import mongoose, { Document, Model, Schema } from "mongoose";

export interface IDoctorRecord extends Document {
  doctorId: string; // Reference to User ID
  name: string;
  email: string;
  phone?: string;
  specialization: string;
  qualification?: string;
  serviceCharge?: number;
  hospitalId?: string;
  hospitalName?: string;
  
  // Additional doctor information
  experience?: number; // Years of experience
  education?: string[];
  languages?: string[];
  bio?: string;
  
  // Availability
  availableDays?: string[]; // ["Monday", "Tuesday", etc.]
  availableTimeSlots?: string[]; // ["09:00", "10:00", etc.]
  
  // Status
  isActive: boolean;
  status?: "AVAILABLE" | "BUSY" | "OFFLINE";
  
  // Metadata
  createdAt: Date;
  updatedAt: Date;
}

const DoctorRecordSchema = new Schema<IDoctorRecord>(
  {
    doctorId: { type: String, required: true, unique: true, index: true },
    name: { type: String, required: true },
    email: { type: String, required: true, index: true },
    phone: { type: String },
    specialization: { type: String, required: true, index: true },
    qualification: { type: String },
    serviceCharge: { type: Number },
    hospitalId: { type: String, index: true },
    hospitalName: { type: String },
    experience: { type: Number },
    education: { type: [String], default: [] },
    languages: { type: [String], default: [] },
    bio: { type: String },
    availableDays: { type: [String], default: [] },
    availableTimeSlots: { type: [String], default: [] },
    isActive: { type: Boolean, default: true, index: true },
    status: {
      type: String,
      enum: ["AVAILABLE", "BUSY", "OFFLINE"],
      default: "AVAILABLE",
      index: true,
    },
  },
  { timestamps: true, collection: "doctorrecord" }
);

// Indexes for efficient queries
DoctorRecordSchema.index({ specialization: 1, isActive: 1 });
DoctorRecordSchema.index({ hospitalId: 1, isActive: 1 });
DoctorRecordSchema.index({ email: 1 });

export const DoctorRecord: Model<IDoctorRecord> =
  mongoose.models.DoctorRecord ||
  mongoose.model<IDoctorRecord>("DoctorRecord", DoctorRecordSchema, "doctorrecord");

