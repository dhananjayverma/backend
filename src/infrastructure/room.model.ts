import mongoose, { Schema, Document, Model } from "mongoose";

export interface IRoom extends Document {
  hospitalId: string;
  floor: number;
  roomNumber: string;
  roomType: "GENERAL" | "SEMI_PRIVATE" | "PRIVATE" | "ICU" | "EMERGENCY" | "OPERATION_THEATRE";
  totalBeds: number;
  rentPerDay: number;
  status: "AVAILABLE" | "OCCUPIED" | "CLEANING" | "MAINTENANCE";
  description?: string;
  isActive: boolean;
  createdAt?: Date;
}

const RoomSchema = new Schema<IRoom>(
  {
    hospitalId: { type: String, required: true, index: true },
    floor: { type: Number, required: true },
    roomNumber: { type: String, required: true },
    roomType: {
      type: String,
      enum: ["GENERAL", "SEMI_PRIVATE", "PRIVATE", "ICU", "EMERGENCY", "OPERATION_THEATRE"],
      required: true,
    },
    totalBeds: { type: Number, required: true, default: 1 },
    rentPerDay: { type: Number, required: true, default: 0 },
    status: {
      type: String,
      enum: ["AVAILABLE", "OCCUPIED", "CLEANING", "MAINTENANCE"],
      default: "AVAILABLE",
    },
    description: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

RoomSchema.index({ hospitalId: 1, roomNumber: 1 }, { unique: true });

export const Room: Model<IRoom> = mongoose.models.Room || mongoose.model<IRoom>("Room", RoomSchema);
