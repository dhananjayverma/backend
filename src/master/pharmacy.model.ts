import mongoose, { Schema, Document, Model } from "mongoose";

export interface IPharmacy extends Document {
  hospitalId?: string;
  name: string;
  address: string;
  phone?: string;
  isActive: boolean;
  latitude?: number;
  longitude?: number;
  location?: {
    type: "Point";
    coordinates: [number, number]; // [longitude, latitude]
  };
}

const PharmacySchema = new Schema<IPharmacy>(
  {
    hospitalId: { type: String, index: true },
    name: { type: String, required: true },
    address: { type: String, required: true },
    phone: { type: String },
    isActive: { type: Boolean, default: true },
    latitude: { type: Number },
    longitude: { type: Number },
    location: {
      type: {
        type: String,
        enum: ["Point"],
        default: "Point",
      },
      coordinates: {
        type: [Number],
        default: [0, 0],
      },
    },
  },
  { timestamps: true }
);

// Create geospatial index for location-based queries
PharmacySchema.index({ location: "2dsphere" });

export const Pharmacy: Model<IPharmacy> =
  mongoose.models.Pharmacy || mongoose.model<IPharmacy>("Pharmacy", PharmacySchema);


