import mongoose, { Schema, Document, Model } from "mongoose";

export interface IHospital extends Document {
  name: string;
  registrationNumber: string;
  type: "Clinic" | "Multi-Speciality" | "Diagnostic" | "Government" | "Private";
  
  // Location
  address: string;
  city?: string;
  state?: string;
  pinCode?: string;
  location?: {
    lat: number;
    lng: number;
  };
  
  // Contacts
  contactNumber: string;
  alternateNumber?: string;
  email?: string;
  emergencyContact?: string;
  
  // Additional Info
  establishedYear?: number;
  description?: string;
  registrationCharge?: number; // First time registration charge
  
  // Facilities
  bedCount?: number;
  icuBeds?: number;
  operationTheatres?: number;
  ambulanceAvailable?: boolean;
  pharmacyAvailable?: boolean;
  is24x7?: boolean;
  
  // Admin
  admin?: {
    name?: string;
    email?: string;
    phone?: string;
  };
  
  // Uploads
  logoUrl?: string;
  documents?: string[];
  
  isActive: boolean;
  createdAt?: Date;
}

const HospitalSchema = new Schema<IHospital>(
  {
    name: { type: String, required: true },
    registrationNumber: { type: String, required: true, unique: true },
    type: { 
      type: String, 
      enum: ["Clinic", "Multi-Speciality", "Diagnostic", "Government", "Private"], 
      required: true 
    },
    
    // Location
    address: { type: String, required: true },
    city: { type: String },
    state: { type: String },
    pinCode: { type: String },
    location: {
      lat: { type: Number },
      lng: { type: Number }
    },
    
    // Contacts
    contactNumber: { type: String, required: true },
    alternateNumber: { type: String },
    email: { type: String },
    emergencyContact: { type: String },
    
    // Additional Info
    establishedYear: { type: Number },
    description: { type: String },
    registrationCharge: { type: Number }, // First time registration charge
    
    // Facilities
    bedCount: { type: Number },
    icuBeds: { type: Number },
    operationTheatres: { type: Number },
    ambulanceAvailable: { type: Boolean, default: false },
    pharmacyAvailable: { type: Boolean, default: false },
    is24x7: { type: Boolean, default: false },
    
    // Admin
    admin: {
      name: { type: String },
      email: { type: String },
      phone: { type: String }
    },
    
    // Uploads
    logoUrl: { type: String },
    documents: [{ type: String }],
    
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true }
);

export const Hospital: Model<IHospital> =
  mongoose.models.Hospital || mongoose.model<IHospital>("Hospital", HospitalSchema);


