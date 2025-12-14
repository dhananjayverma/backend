import mongoose, { Schema, Document, Model } from "mongoose";

export interface IAuditLog extends Document {
  userId?: string;
  method: string;
  path: string;
  body: any;
}

if (!mongoose.models.AuditLog) {
  const AuditSchema = new Schema<IAuditLog>(
    {
      userId: { type: String },
      method: { type: String, required: true },
      path: { type: String, required: true },
      body: { type: Schema.Types.Mixed },
    },
    { timestamps: true }
  );

  AuditSchema.index({ userId: 1 });
  AuditSchema.index({ path: 1 });

  mongoose.model<IAuditLog>("AuditLog", AuditSchema);
}

export const AuditLog: Model<IAuditLog> = mongoose.models.AuditLog;


