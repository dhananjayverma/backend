import { Router } from "express";
import { getRecentActivities } from "./activity.service";
import { Activity } from "./activity.model";
import { requireAuth } from "../shared/middleware/auth";

export const router = Router();

// Get recent activities for admin dashboard
router.get("/", async (req, res) => {
  const limit = parseInt(req.query.limit as string) || 50;
  const activities = await getRecentActivities(limit);
  res.json(activities);
});

// Get patient-specific activities/notifications
router.get("/patient/:patientId", requireAuth, async (req, res) => {
  try {
    const { patientId } = req.params;
    const userId = req.user?.sub;
    const userRole = req.user?.role;

    // Patients can only view their own activities
    if (userRole === "PATIENT" && patientId !== userId) {
      return res.status(403).json({ message: "Access denied" });
    }

    const limit = parseInt(req.query.limit as string) || 100;
    
    // Get activities where patientId matches
    const activities = await Activity.find({ patientId })
      .sort({ createdAt: -1 })
      .limit(limit)
      .lean();

    res.json(activities);
  } catch (error: any) {
    console.error("Error fetching patient activities:", error);
    res.status(500).json({ message: error.message || "Failed to fetch activities" });
  }
});

// Delete all activities (admin only)
router.delete("/all", requireAuth, async (req, res) => {
  try {
    const userRole = req.user?.role;
    
    // Only SUPER_ADMIN can delete all activities
    if (userRole !== "SUPER_ADMIN") {
      return res.status(403).json({ message: "Access denied. Only administrators can delete all activities." });
    }

    const result = await Activity.deleteMany({});
    res.json({ 
      message: "All activities deleted successfully",
      deletedCount: result.deletedCount 
    });
  } catch (error: any) {
    console.error("Error deleting all activities:", error);
    res.status(500).json({ message: error.message || "Failed to delete activities" });
  }
});

