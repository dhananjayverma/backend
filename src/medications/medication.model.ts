import mongoose, { Schema, Document, Model } from "mongoose";

export interface IMedication extends Document {
  ipId: string;
  hospitalId?: string;
  patientId?: mongoose.Types.ObjectId;
  orderedBy?: mongoose.Types.ObjectId;
  administeredBy?: mongoose.Types.ObjectId;
  drugName: string;
  dosage: string;
  route: string;
  frequency: string;
  scheduledTime?: string;
  administeredAt?: Date;
  status: "PENDING" | "ADMINISTERED" | "SKIPPED" | "REFUSED" | "CANCELLED";
  notes?: string;
  createdAt?: Date;
  updatedAt?: Date;
}

const MedicationSchema = new Schema<IMedication>(
  {
    ipId:             { type: String, required: true, index: true },
    hospitalId:       { type: String, index: true },
    patientId:        { type: Schema.Types.ObjectId, ref: "User" },
    orderedBy:        { type: Schema.Types.ObjectId, ref: "User" },
    administeredBy:   { type: Schema.Types.ObjectId, ref: "User" },
    drugName:         { type: String, required: true },
    dosage:           { type: String, required: true },
    route:            { type: String, required: true },
    frequency:        { type: String, required: true },
    scheduledTime:    { type: String },
    administeredAt:   { type: Date },
    status:           { type: String, enum: ["PENDING", "ADMINISTERED", "SKIPPED", "REFUSED", "CANCELLED"], default: "PENDING" },
    notes:            { type: String },
  },
  { timestamps: true }
);

export const Medication: Model<IMedication> =
  mongoose.models.Medication || mongoose.model<IMedication>("Medication", MedicationSchema);
