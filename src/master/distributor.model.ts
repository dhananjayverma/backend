import mongoose, { Schema, Document, Model } from "mongoose";

export interface IDistributor extends Document {
  name: string;
  address?: string;
  phone?: string;
  phoneNumber?: string;
  email?: string;
  licenseNumber?: string;
  ownerName?: string;
  isActive: boolean;
}

const DistributorSchema = new Schema<IDistributor>(
  {
    name: { type: String, required: true },
    address: { type: String },
    phone: { type: String },
    phoneNumber: { type: String },
    email: { type: String },
    licenseNumber: { type: String },
    ownerName: { type: String },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Distributor: Model<IDistributor> =
  mongoose.models.Distributor || mongoose.model<IDistributor>("Distributor", DistributorSchema);


