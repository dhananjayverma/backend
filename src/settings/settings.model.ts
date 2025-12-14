import mongoose, { Schema, Document, Model } from "mongoose";

export interface ISettings extends Document {
  userId?: string;
  
  // General Settings
  timezone: string;
  language: string;
  dateFormat: string;
  
  // Security Settings
  sessionTimeout: number;
  passwordMinLength: number;
  passwordRequireUppercase: boolean;
  passwordRequireNumbers: boolean;
  
  // Notification Settings
  emailNotifications: boolean;
  orderAlerts: boolean;
  inventoryAlerts: boolean;
  appointmentAlerts: boolean;
  
  // Appearance Settings
  theme: string;
  primaryColor: string;
  secondaryColor: string;
  sidebarCollapsed: boolean;
  
  // System Settings
  autoBackup: boolean;
  backupFrequency: string;
  
  createdAt: Date;
  updatedAt: Date;
}

if (!mongoose.models.Settings) {
  const SettingsSchema = new Schema<ISettings>(
    {
      userId: { type: String },
      
      // General Settings
      timezone: { type: String, default: "Asia/Kolkata" },
      language: { type: String, default: "en" },
      dateFormat: { type: String, default: "DD/MM/YYYY" },
      
      // Security Settings
      sessionTimeout: { type: Number, default: 30 },
      passwordMinLength: { type: Number, default: 8 },
      passwordRequireUppercase: { type: Boolean, default: true },
      passwordRequireNumbers: { type: Boolean, default: true },
      
      // Notification Settings
      emailNotifications: { type: Boolean, default: true },
      orderAlerts: { type: Boolean, default: true },
      inventoryAlerts: { type: Boolean, default: true },
      appointmentAlerts: { type: Boolean, default: true },
      
      // Appearance Settings
      theme: { type: String, default: "light" },
      primaryColor: { type: String, default: "#1e40af" },
      secondaryColor: { type: String, default: "#059669" },
      sidebarCollapsed: { type: Boolean, default: false },
      
      // System Settings
      autoBackup: { type: Boolean, default: true },
      backupFrequency: { type: String, default: "daily" },
    },
    { timestamps: true }
  );

  SettingsSchema.index({ userId: 1 }, { unique: true, sparse: true });

  mongoose.model<ISettings>("Settings", SettingsSchema);
}

export const Settings: Model<ISettings> = mongoose.models.Settings;

