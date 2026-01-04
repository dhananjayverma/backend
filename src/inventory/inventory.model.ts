import mongoose, { Schema, Document, Model } from "mongoose";

export type ProductCategory = "MEDICINE" | "MEDICAL_EQUIPMENT" | "HEALTH_SUPPLEMENT" | "PERSONAL_CARE";

export interface IInventoryItem extends Document {
  pharmacyId?: string; // Optional for warehouse inventory
  medicineName: string;
  composition: string; // Active ingredient/composition (e.g., "Paracetamol 500mg")
  brandName?: string; // Brand name (e.g., "Crocin", "Calpol")
  batchNumber: string; // Required for batch tracking
  expiryDate: Date; // Required for expiry tracking
  quantity: number;
  threshold: number;
  purchasePrice: number; // Cost price per unit
  sellingPrice: number; // MRP/Selling price per unit
  mrp?: number; // Maximum Retail Price (if different from selling price)
  margin?: number; // Calculated margin: (sellingPrice - purchasePrice) / purchasePrice * 100
  discount?: number; // Discount percentage applied
  // Location tracking
  rackNumber?: string; // Rack name/number
  rowNumber?: string; // Row/shelf number
  distributorId?: string;
  // Product display fields
  category?: ProductCategory; // Product category
  imageUrl?: string; // Product image URL
  description?: string; // Product description
  prescriptionRequired?: boolean; // Whether prescription is required
  // Legacy field for backward compatibility
  price?: number; // Deprecated: use sellingPrice instead
  createdAt?: Date;
  updatedAt?: Date;
}

const InventorySchema = new Schema<IInventoryItem>(
  {
    pharmacyId: { type: String, index: true }, // Optional for warehouse inventory
    medicineName: { type: String, required: true, index: true },
    composition: { type: String, required: true, index: true }, // Required for composition-based search
    brandName: { type: String, index: true },
    batchNumber: { type: String, required: true, index: true }, // Required for batch tracking
    expiryDate: { type: Date, required: true, index: true }, // Required for expiry tracking
    quantity: { type: Number, required: true },
    threshold: { type: Number, required: true, default: 10 },
    purchasePrice: { type: Number, required: true, default: 0 }, // Cost price
    sellingPrice: { type: Number, required: true, default: 0 }, // Selling price
    mrp: { type: Number }, // MRP if different
    margin: { type: Number }, // Calculated margin percentage
    discount: { type: Number, default: 0 }, // Discount percentage
    rackNumber: { type: String },
    rowNumber: { type: String },
    distributorId: { type: String, index: true },
    // Product display fields
    category: { 
      type: String, 
      enum: ["MEDICINE", "MEDICAL_EQUIPMENT", "HEALTH_SUPPLEMENT", "PERSONAL_CARE"],
      default: "MEDICINE",
      index: true 
    },
    imageUrl: { type: String },
    description: { type: String },
    prescriptionRequired: { type: Boolean, default: false, index: true },
    // Legacy field
    price: { type: Number }, // Deprecated
  },
  { timestamps: true }
);

// Compound indexes for efficient queries
InventorySchema.index({ pharmacyId: 1, medicineName: 1 });
InventorySchema.index({ pharmacyId: 1, composition: 1 });
InventorySchema.index({ pharmacyId: 1, brandName: 1 });
InventorySchema.index({ pharmacyId: 1, batchNumber: 1 });
InventorySchema.index({ pharmacyId: 1, expiryDate: 1 });
InventorySchema.index({ composition: 1, brandName: 1 });
InventorySchema.index({ pharmacyId: 1, category: 1 });
InventorySchema.index({ category: 1, quantity: 1 });
InventorySchema.index({ medicineName: "text", composition: "text", brandName: "text" });

// Pre-save hook to calculate margin
InventorySchema.pre("save", function (next) {
  if (this.isModified("purchasePrice") || this.isModified("sellingPrice")) {
    if (this.purchasePrice > 0) {
      this.margin = ((this.sellingPrice - this.purchasePrice) / this.purchasePrice) * 100;
    } else {
      this.margin = 0;
    }
  }
  // Backward compatibility: set price from sellingPrice if not set
  if (!this.price && this.sellingPrice) {
    this.price = this.sellingPrice;
  }
  next();
});

export const InventoryItem: Model<IInventoryItem> =
  mongoose.models.InventoryItem || mongoose.model<IInventoryItem>("InventoryItem", InventorySchema);
