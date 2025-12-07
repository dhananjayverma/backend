import { Router, Request, Response } from "express";
import { Settings } from "./settings.model";
import { requireAuth } from "../shared/middleware/auth";

export const router = Router();

// Get settings (user-specific or global)
router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    console.log("Fetching settings for user:", userId);
    
    // Try to find user-specific settings first
    let settings = await Settings.findOne({ userId });
    
    // If no user-specific settings, get or create global settings
    if (!settings) {
      settings = await Settings.findOne({ userId: { $exists: false } });
      
      if (!settings) {
        // Create default global settings
        console.log("Creating default global settings");
        settings = await Settings.create({});
      } else {
        console.log("Using global settings");
      }
    } else {
      console.log("Using user-specific settings");
    }
    
    // Convert to plain object and remove MongoDB internal fields
    const settingsObj = settings.toObject();
    delete settingsObj.__v;
    
    console.log("Returning settings:", settingsObj);
    res.json(settingsObj);
  } catch (error: any) {
    console.error("Error fetching settings:", error);
    res.status(500).json({ message: "Failed to fetch settings", error: error.message });
  }
});

// Update settings
router.put("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    const updateData = req.body;
    
    console.log("Updating settings for user:", userId, "Data:", updateData);
    
    // Remove userId from update data if present
    delete updateData.userId;
    delete updateData._id;
    delete updateData.createdAt;
    delete updateData.updatedAt;
    delete updateData.__v;
    
    // Try to find user-specific settings
    let settings = await Settings.findOne({ userId });
    
    if (settings) {
      // Update existing settings
      Object.assign(settings, updateData);
      await settings.save();
      console.log("Updated existing settings");
    } else {
      // Create new user-specific settings
      settings = await Settings.create({ userId, ...updateData });
      console.log("Created new user-specific settings");
    }
    
    // Convert to plain object and remove MongoDB internal fields
    const settingsObj = settings.toObject();
    delete settingsObj.__v;
    
    res.json(settingsObj);
  } catch (error: any) {
    console.error("Error updating settings:", error);
    res.status(500).json({ message: "Failed to update settings", error: error.message });
  }
});

// Reset settings to default
router.post("/reset", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user?.sub;
    
    // Delete user-specific settings if exists
    await Settings.deleteOne({ userId });
    
    // Get or create default global settings
    let settings = await Settings.findOne({ userId: { $exists: false } });
    
    if (!settings) {
      settings = await Settings.create({});
    }
    
    // Convert to plain object and remove MongoDB internal fields
    const settingsObj = settings.toObject();
    delete settingsObj.__v;
    
    res.json(settingsObj);
  } catch (error: any) {
    console.error("Error resetting settings:", error);
    res.status(500).json({ message: "Failed to reset settings", error: error.message });
  }
});

