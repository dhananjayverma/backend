import { Router } from "express";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import mongoose from "mongoose";
import { User } from "./user.model";
import { JWT_SECRET } from "../config";
import { requireAuth, requireRole } from "../shared/middleware/auth";
import { createActivity } from "../activity/activity.service";

export const router = Router();

// Contact Support endpoint
router.post(
  "/support/contact",
  requireAuth,
  async (req, res) => {
    try {
      const { subject, message, userId, userEmail, userName } = req.body;
      
      if (!subject || !message) {
        return res.status(400).json({ message: "Subject and message are required" });
      }

      // In a real app, you would:
      // 1. Save to database
      // 2. Send email notification to support team
      // 3. Create a support ticket
      
      // For now, we'll just log it and return success
      console.log("Support Request:", {
        subject,
        message,
        userId,
        userEmail,
        userName,
        timestamp: new Date().toISOString(),
      });

      // You could also create a notification for admins here
      // await createNotification({...});

      res.status(200).json({
        message: "Support request received. We'll get back to you soon.",
        success: true,
      });
    } catch (error: any) {
      console.error("Support request error:", error);
      res.status(500).json({ message: error.message || "Failed to submit support request" });
    }
  }
);

// Basic signup for initial testing (Super Admin can later create all users)
router.post("/signup", async (req, res) => {
  try {
    const { name, email, password, role, hospitalId, pharmacyId, distributorId, phone, specialization, qualification, serviceCharge } = req.body;

    // Validate required fields
    if (!name || !email || !password || !role) {
      return res.status(400).json({ message: "Missing required fields: name, email, password, role" });
    }

    const existing = await User.findOne({ email });
    if (existing) {
      return res.status(400).json({ message: "Email already in use" });
    }

    const passwordHash = await bcrypt.hash(password, 10);

    const userData: any = {
      name,
      email,
      passwordHash,
      role,
    };

    // Add optional fields if provided
    if (phone) userData.phone = phone;
    if (hospitalId) userData.hospitalId = hospitalId;
    if (pharmacyId) userData.pharmacyId = pharmacyId;
    if (distributorId) userData.distributorId = distributorId;
    
    // Doctor-specific fields
    if (specialization) userData.specialization = specialization;
    if (qualification) userData.qualification = qualification;
    if (serviceCharge !== undefined && serviceCharge !== null && serviceCharge !== "") {
      userData.serviceCharge = parseFloat(serviceCharge);
    }

    const user = await User.create(userData);

    // Emit activity for user creation
    await createActivity(
      "USER_CREATED",
      "New User Created",
      `New ${role} user created: ${name} (${email})`,
      {
        userId: String(user._id),
        metadata: { role, email },
      }
    );

    // Return user data with _id to match frontend expectations
    const userResponse: any = {
      _id: String(user._id),
      id: String(user._id),
      name: user.name,
      email: user.email,
      role: user.role,
      isActive: user.isActive,
    };
    if (user.hospitalId) userResponse.hospitalId = user.hospitalId;
    if (user.pharmacyId) userResponse.pharmacyId = user.pharmacyId;
    if (user.distributorId) userResponse.distributorId = user.distributorId;
    if (user.phone) userResponse.phone = user.phone;
    if (user.specialization) userResponse.specialization = user.specialization;
    if (user.qualification) userResponse.qualification = user.qualification;
    if (user.serviceCharge !== undefined) userResponse.serviceCharge = user.serviceCharge;

    res.status(201).json(userResponse);
  } catch (error: any) {
    // Handle MongoDB duplicate key error (race condition)
    if (error.code === 11000 || error.message?.includes("duplicate key")) {
      return res.status(400).json({ message: "Email already in use" });
    }
    console.error("Signup error:", error);
    res.status(400).json({ message: error.message || "Failed to create user" });
  }
});

router.post("/login", async (req, res) => {
  const { email, password } = req.body;

  const user = await User.findOne({ email });
  if (!user) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return res.status(401).json({ message: "Invalid credentials" });
  }

  const token = jwt.sign(
    {
      sub: String(user._id),
      role: user.role,
    },
    JWT_SECRET
    // No expiration - token never expires
  );

  const userResponse: any = {
    id: String(user._id),
    name: user.name,
    email: user.email,
    role: user.role,
  };
  
  // Include IDs if they exist
  if (user.hospitalId) userResponse.hospitalId = user.hospitalId;
  if (user.pharmacyId) userResponse.pharmacyId = user.pharmacyId;
  if (user.distributorId) userResponse.distributorId = user.distributorId;
  if (user.phone) userResponse.phone = user.phone;

  res.json({
    token,
    user: userResponse,
  });
});

// Public endpoint to check if email is admin/super admin (for login page)
router.get("/check-role/:email", async (req, res) => {
  try {
    const { email } = req.params;
    const user = await User.findOne({ email }).select("role isActive").lean();
    if (!user) {
      return res.json({ isAdmin: false, role: null, exists: false });
    }
    const isAdmin = user.role === "SUPER_ADMIN" || user.role === "HOSPITAL_ADMIN";
    res.json({ 
      isAdmin, 
      role: user.role, 
      exists: true,
      isActive: user.isActive 
    });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Public endpoint to get users by role (for doctor listing, etc.)
router.get("/by-role/:role", async (req, res) => {
  const { role } = req.params;
  const users = await User.find({ role })
    .limit(100)
    .select("_id name email role hospitalId pharmacyId")
    .sort({ name: 1 })
    .lean();
  // Ensure _id is included as string
  const formattedUsers = users.map((user: any) => ({
    _id: user._id.toString(),
    id: user._id.toString(),
    name: user.name,
    email: user.email,
    role: user.role,
    hospitalId: user.hospitalId || undefined,
    pharmacyId: user.pharmacyId || undefined,
  }));
  res.json(formattedUsers);
});

// Admin endpoint to get all users (with optional role and status filters)
router.get(
  "/",
  requireAuth,
  async (req, res) => {
    try {
      const { role, status } = req.query;
      const filter: any = {};
      
      if (role) filter.role = role;
      if (status) filter.status = status;

      // Only admins can see all users, others can only see filtered by role
      const userRole = req.user?.role;
      const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";
      
      if (!isAdmin && !role) {
        return res.status(403).json({ message: "Access denied. Role filter required for non-admin users." });
      }

      const users = await User.find(filter).limit(200).sort({ createdAt: -1 }).select("-passwordHash");
      // Ensure _id is properly formatted
      const formattedUsers = users.map((user: any) => ({
        _id: String(user._id),
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        phone: user.phone || undefined,
        phoneNumber: user.phone || undefined,
        hospitalId: user.hospitalId || undefined,
        pharmacyId: user.pharmacyId || undefined,
        distributorId: user.distributorId || undefined,
        status: user.status || "AVAILABLE",
        currentOrderId: user.currentOrderId || undefined,
        isActive: user.isActive !== undefined ? user.isActive : true,
        specialization: user.specialization || undefined,
        qualification: user.qualification || undefined,
        serviceCharge: user.serviceCharge !== undefined ? user.serviceCharge : undefined,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      }));
      res.json(formattedUsers);
    } catch (error: any) {
      console.error("Error fetching users:", error);
      res.status(500).json({ message: error.message || "Failed to fetch users" });
    }
  }
);

// Get single user by ID
router.get(
  "/:id",
  requireAuth,
  async (req, res) => {
    try {
      if (!req.user) {
        return res.status(401).json({ message: "Unauthenticated" });
      }

      // Check if the route matches a special endpoint first (route order matters)
      if (req.params.id === "check-role" || req.params.id === "by-role") {
        return res.status(404).json({ message: "Invalid endpoint" });
      }

      // Validate ID parameter
      const userId = req.params.id;
      if (!userId || userId === "undefined" || !mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      // Select fields based on user role
      const userRole = req.user.role;
      const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";
      
      // All authenticated users can view basic user info (passwordHash is always excluded)
      const user = await User.findById(userId).select("-passwordHash");
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Return user data for all authenticated users
      // Password hash is already excluded, so it's safe
      return res.json(user);
    } catch (error: any) {
      console.error("Error fetching user:", error);
      res.status(400).json({ message: error.message || "Failed to fetch user" });
    }
  }
);

// Update User
router.patch(
  "/:id",
  requireAuth,
  async (req, res) => {
    try {
      // Validate ID parameter
      const userId = req.params.id;
      if (!userId || userId === "undefined" || !mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      const { name, email, phone, role, hospitalId, pharmacyId, distributorId, isActive, password, status, currentOrderId, specialization, qualification, serviceCharge } = req.body;
      const userRole = req.user?.role;
      const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";
      const isDistributor = userRole === "DISTRIBUTOR";
      
      const update: any = {};
      
      // Get target user to check permissions
      const targetUser = await User.findById(userId);
      if (!targetUser) {
        return res.status(404).json({ message: "User not found" });
      }
      
      // Admins can update all fields
      if (isAdmin) {
      if (name !== undefined) update.name = name;
      if (email !== undefined) update.email = email;
      if (phone !== undefined) update.phone = phone;
      if (role !== undefined) update.role = role;
      if (hospitalId !== undefined) {
        update.hospitalId = hospitalId === "" ? undefined : hospitalId;
      }
      if (pharmacyId !== undefined) {
        update.pharmacyId = pharmacyId === "" ? undefined : pharmacyId;
      }
      if (distributorId !== undefined) {
        update.distributorId = distributorId === "" ? undefined : distributorId;
      }
      if (isActive !== undefined) update.isActive = isActive;
      if (password !== undefined && password !== "") {
        update.passwordHash = await bcrypt.hash(password, 10);
        }
        if (status !== undefined) update.status = status;
        if (currentOrderId !== undefined) {
          update.currentOrderId = currentOrderId === "" ? undefined : currentOrderId;
        }
        // Doctor-specific fields
        if (specialization !== undefined) update.specialization = specialization === "" ? undefined : specialization;
        if (qualification !== undefined) update.qualification = qualification === "" ? undefined : qualification;
        if (serviceCharge !== undefined) {
          update.serviceCharge = serviceCharge === "" || serviceCharge === null ? undefined : parseFloat(serviceCharge);
        }
      }
      // Distributors can update delivery agent status and currentOrderId
      else if (isDistributor) {
        // Only allow updating delivery agents
        if (targetUser.role !== "DELIVERY_AGENT") {
          return res.status(403).json({ message: "Distributors can only update delivery agent status" });
        }
        if (status !== undefined) update.status = status;
        if (currentOrderId !== undefined) {
          update.currentOrderId = currentOrderId === "" ? undefined : currentOrderId;
        }
      }
      // Users can update their own profile
      else {
        if (String(targetUser._id) !== req.user!.sub) {
          return res.status(403).json({ message: "You can only update your own profile" });
        }
        if (name !== undefined) update.name = name;
        if (email !== undefined) update.email = email;
        if (phone !== undefined) update.phone = phone;
      }

      // Check if email is already in use by another user
      if (email !== undefined) {
        const existingUser = await User.findOne({ email, _id: { $ne: userId } });
        if (existingUser) {
          return res.status(400).json({ message: "Email already in use" });
        }
      }

      const user = await User.findByIdAndUpdate(
        userId,
        { $set: update },
        { new: true, runValidators: true }
      ).select("-passwordHash");
      
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      await createActivity(
        "USER_UPDATED",
        "User Updated",
        `User ${user.name} (${user.email}) was updated`,
        {
          userId: String(user._id),
          metadata: { role: user.role },
        }
      );

      // Return formatted user response
      const userResponse: any = {
        _id: String(user._id),
        id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        isActive: user.isActive !== undefined ? user.isActive : true,
        createdAt: user.createdAt,
        updatedAt: user.updatedAt,
      };
      if (user.phone) userResponse.phone = user.phone;
      if (user.hospitalId) userResponse.hospitalId = user.hospitalId;
      if (user.pharmacyId) userResponse.pharmacyId = user.pharmacyId;
      if (user.distributorId) userResponse.distributorId = user.distributorId;
      if (user.status) userResponse.status = user.status;
      if (user.currentOrderId) userResponse.currentOrderId = user.currentOrderId;
      if (user.specialization) userResponse.specialization = user.specialization;
      if (user.qualification) userResponse.qualification = user.qualification;
      if (user.serviceCharge !== undefined) userResponse.serviceCharge = user.serviceCharge;

      res.json(userResponse);
    } catch (error: any) {
      // Handle MongoDB duplicate key error
      if (error.code === 11000 || error.message?.includes("duplicate key")) {
        return res.status(400).json({ message: "Email already in use" });
      }
      // Handle ObjectId cast errors
      if (error.message?.includes("Cast to ObjectId failed")) {
        return res.status(400).json({ message: "Invalid user ID format" });
      }
      res.status(400).json({ message: error.message });
    }
  }
);

// Delete User
router.delete(
  "/:id",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req, res) => {
    try {
      // Validate ID parameter
      const userId = req.params.id;
      if (!userId || userId === "undefined" || !mongoose.Types.ObjectId.isValid(userId)) {
        return res.status(400).json({ message: "Invalid user ID" });
      }

      const user = await User.findById(userId);
      if (!user) {
        return res.status(404).json({ message: "User not found" });
      }

      // Prevent deleting SUPER_ADMIN users
      if (user.role === "SUPER_ADMIN" && req.user?.role !== "SUPER_ADMIN") {
        return res.status(403).json({ message: "Only SUPER_ADMIN can delete SUPER_ADMIN users" });
      }

      // Store user info before deletion
      const userInfo = {
        name: user.name,
        email: user.email,
        role: user.role,
        userId: String(user._id),
      };

      // Delete the user and verify deletion
      const deleteResult = await User.deleteOne({ _id: userId });
      
      if (deleteResult.deletedCount === 0) {
        // Try with ObjectId if string didn't work
        try {
          const objectId = new mongoose.Types.ObjectId(userId);
          const retryResult = await User.deleteOne({ _id: objectId });
          if (retryResult.deletedCount === 0) {
            return res.status(500).json({ message: "Failed to delete user" });
          }
        } catch (e) {
          return res.status(500).json({ message: "Failed to delete user" });
        }
      }

      // Verify deletion
      await new Promise(resolve => setTimeout(resolve, 100)); // Wait for DB sync
      const verifyDelete = await User.findById(userId);
      if (verifyDelete) {
        // Try force delete using collection
        try {
          const objectId = new mongoose.Types.ObjectId(userId);
          await User.collection.deleteOne({ _id: objectId });
          
          // Wait and verify again
          await new Promise(resolve => setTimeout(resolve, 100));
          const verifyAgain = await User.findById(userId);
          if (verifyAgain) {
            return res.status(500).json({ message: "Failed to delete user from database" });
          }
        } catch (error: any) {
          console.error("[DELETE] Force delete failed:", error.message);
          return res.status(500).json({ message: "Failed to delete user from database" });
        }
      }

      await createActivity(
        "USER_DELETED",
        "User Deleted",
        `User ${userInfo.name} (${userInfo.email}) was deleted`,
        {
          userId: userInfo.userId,
          metadata: { role: userInfo.role },
        }
      );

      res.json({ message: "User deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ message: error.message || "Failed to delete user" });
    }
  }
);
