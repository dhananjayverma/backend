import mongoose, { Schema, Document, Model } from "mongoose";

export interface IInventoryItem extends Document {
  pharmacyId?: string; // Optional for warehouse inventory
  medicineName: string;
  batchNumber?: string;
  expiryDate?: Date;
  quantity: number;
  threshold: number;
  price?: number; // Price per unit
  distributorId?: string;
}

const InventorySchema = new Schema<IInventoryItem>(
  {
    pharmacyId: { type: String, index: true }, // Optional for warehouse inventory
    medicineName: { type: String, required: true, index: true },
    batchNumber: { type: String }, // Optional
    expiryDate: { type: Date }, // Optional
    quantity: { type: Number, required: true },
    threshold: { type: Number, required: true, default: 10 },
    price: { type: Number, default: 100 }, // Default price if not specified
    distributorId: { type: String, index: true },
  },
  { timestamps: true }
);

InventorySchema.index({ pharmacyId: 1, medicineName: 1 });
InventorySchema.index({ medicineName: "text", batchNumber: "text" });

export const InventoryItem: Model<IInventoryItem> =
  mongoose.models.InventoryItem || mongoose.model<IInventoryItem>("InventoryItem", InventorySchema);
