import mongoose, { Schema, Document, Model } from "mongoose";

export type DistributorOrderStatus = "PENDING" | "ACCEPTED" | "DISPATCHED" | "DELIVERED" | "CANCELLED";

export interface IDistributorOrder extends Document {
  pharmacyId: string;
  distributorId: string;
  medicineName: string;
  quantity: number;
  status: DistributorOrderStatus;
  deliveryOtp?: string;
  deliveryProofImageUrl?: string;
  deliveryAgentId?: string;
  deliveryAgentName?: string;
  deliveryAgentPhone?: string;
  pickedAt?: Date;
  outForDeliveryAt?: Date;
  deliveredAt?: Date;
}

const DistributorOrderSchema = new Schema<IDistributorOrder>(
  {
    pharmacyId: { type: String, required: true, index: true },
    distributorId: { type: String, required: true, index: true },
    medicineName: { type: String, required: true },
    quantity: { type: Number, required: true },
    status: {
      type: String,
      enum: ["PENDING", "ACCEPTED", "DISPATCHED", "DELIVERED", "CANCELLED"],
      default: "PENDING",
      index: true,
    },
    deliveryOtp: { type: String },
    deliveryProofImageUrl: { type: String },
    deliveryAgentId: { type: String },
    deliveryAgentName: { type: String },
    deliveryAgentPhone: { type: String },
    pickedAt: { type: Date },
    outForDeliveryAt: { type: Date },
    deliveredAt: { type: Date },
  },
  { timestamps: true }
);

export const DistributorOrder: Model<IDistributorOrder> =
  mongoose.models.DistributorOrder ||
  mongoose.model<IDistributorOrder>("DistributorOrder", DistributorOrderSchema);


