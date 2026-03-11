import mongoose, { Schema, Document, Model } from "mongoose";

export interface ICertificate extends Document {
  certificateNumber: string;
  hospitalId: string;
  patientId: mongoose.Types.ObjectId;
  patientName: string;
  doctorId: mongoose.Types.ObjectId;
  doctorName: string;
  type: "MEDICAL_FITNESS" | "ADMISSION" | "DISCHARGE_SUMMARY";
  referenceId?: string; // ipId / opId
  issueDate: Date;
  content?: string;
  additionalNotes?: string;
  createdBy: string;
  createdAt?: Date;
}

const CertificateSchema = new Schema<ICertificate>(
  {
    certificateNumber: { type: String, required: true, unique: true },
    hospitalId: { type: String, required: true },
    patientId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    patientName: { type: String, required: true },
    doctorId: { type: Schema.Types.ObjectId, ref: "User", required: true },
    doctorName: { type: String, required: true },
    type: {
      type: String,
      enum: ["MEDICAL_FITNESS", "ADMISSION", "DISCHARGE_SUMMARY"],
      required: true,
    },
    referenceId: { type: String },
    issueDate: { type: Date, default: Date.now },
    content: { type: String },
    additionalNotes: { type: String },
    createdBy: { type: String, required: true },
  },
  { timestamps: true }
);

export const Certificate: Model<ICertificate> =
  mongoose.models.Certificate || mongoose.model<ICertificate>("Certificate", CertificateSchema);
