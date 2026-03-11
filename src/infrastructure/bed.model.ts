import mongoose, { Schema, Document, Model } from "mongoose";

export interface IBed extends Document {
  hospitalId: string;
  roomId: mongoose.Types.ObjectId;
  bedNumber: string;
  status: "AVAILABLE" | "OCCUPIED" | "CLEANING" | "MAINTENANCE";
  currentPatientId?: mongoose.Types.ObjectId;
  currentIpId?: string;
  isActive: boolean;
  createdAt?: Date;
}

const BedSchema = new Schema<IBed>(
  {
    hospitalId: { type: String, required: true, index: true },
    roomId: { type: Schema.Types.ObjectId, ref: "Room", required: true },
    bedNumber: { type: String, required: true },
    status: {
      type: String,
      enum: ["AVAILABLE", "OCCUPIED", "CLEANING", "MAINTENANCE"],
      default: "AVAILABLE",
    },
    currentPatientId: { type: Schema.Types.ObjectId, ref: "User" },
    currentIpId: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

BedSchema.index({ roomId: 1, bedNumber: 1 }, { unique: true });

export const Bed: Model<IBed> = mongoose.models.Bed || mongoose.model<IBed>("Bed", BedSchema);
