import { Router, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { User } from "./user.model";
import { JWT_SECRET } from "../config";
import { ROLE_PERMISSIONS, PharmacyRole } from "./pharmacyRoles";

// In-memory OTP store: phone -> { otp, expiresAt }
const otpStore = new Map<string, { otp: string; expiresAt: number }>();
const OTP_TTL_MS = 10 * 60 * 1000; // 10 minutes
// No SMS service: use fixed OTP for testing only
const TEST_OTP = "1234";
const TEST_OTP_ALTS = ["1234", "123456"]; // accept both for verify
function isTestOtp(otp: string): boolean {
  return TEST_OTP_ALTS.includes(otp.trim());
}

/**
 * Send OTP to phone (for pharmacy multi-login)
 * POST /api/users/otp/send { "phone": "9876543210" }
 */
export const router = Router();

router.post("/send", async (req: Request, res: Response) => {
  try {
    const { phone } = req.body;
    const normalizedPhone = phone ? String(phone).replace(/\D/g, "").slice(-10) : "";

    if (normalizedPhone.length < 10) {
      return res.status(400).json({ message: "Valid 10-digit phone number is required" });
    }

    // Find user with this phone and pharmacy role (phone may be stored with or without country code)
    const user = await User.findOne({
      $or: [
        { phone: normalizedPhone },
        { phone: { $regex: normalizedPhone + "$" } },
      ],
      role: "PHARMACY_STAFF",
      isActive: true,
    });

    if (!user) {
      // Don't reveal that phone doesn't exist - still return success for security
      return res.json({
        message: "If this number is registered, you will receive an OTP shortly",
        expiresIn: OTP_TTL_MS / 1000,
      });
    }

    // No SMS service: store fixed test OTP only
    otpStore.set(normalizedPhone, {
      otp: TEST_OTP,
      expiresAt: Date.now() + OTP_TTL_MS,
    });

    res.json({
      message: "If this number is registered, you will receive an OTP shortly",
      expiresIn: OTP_TTL_MS / 1000,
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to send OTP" });
  }
});

/**
 * Verify OTP and login
 * POST /api/users/otp/verify { "phone": "9876543210", "otp": "123456" }
 */
router.post("/verify", async (req: Request, res: Response) => {
  try {
    const { phone, otp } = req.body;
    const normalizedPhone = phone ? String(phone).replace(/\D/g, "").slice(-10) : "";

    const otpStr = otp != null ? String(otp).trim() : "";
    if (normalizedPhone.length < 10 || !otpStr) {
      return res.status(400).json({ message: "Phone and OTP are required" });
    }

    const stored = otpStore.get(normalizedPhone);
    let otpValid = false;
    if (stored) {
      if (Date.now() > stored.expiresAt) {
        otpStore.delete(normalizedPhone);
        return res.status(400).json({ message: "OTP expired. Please request a new one." });
      }
      otpValid = stored.otp === otpStr || isTestOtp(otpStr);
      if (otpValid) otpStore.delete(normalizedPhone);
    } else if (isTestOtp(otpStr)) {
      // No stored OTP (e.g. send on another server or user not found on send): allow test OTP if user exists
      otpValid = true;
    }
    if (!otpValid) {
      if (!stored) {
        return res.status(400).json({
          message: "No OTP was sent to this number. Click 'Send OTP' first, or ensure this number is registered as pharmacy staff.",
        });
      }
      return res.status(401).json({ message: "Invalid OTP" });
    }

    let user = await User.findOne({
      $or: [
        { phone: normalizedPhone },
        { phone: { $regex: normalizedPhone + "$" } },
      ],
      role: "PHARMACY_STAFF",
      isActive: true,
    }).select("-passwordHash");

    if (!user) {
      const inactiveUser = await User.findOne({
        $or: [
          { phone: normalizedPhone },
          { phone: { $regex: normalizedPhone + "$" } },
        ],
        role: "PHARMACY_STAFF",
      }).select("isActive");
      if (inactiveUser) {
        return res.status(403).json({
          message: "This pharmacy account is inactive. Please contact admin to activate the pharmacy, then try again.",
        });
      }
      return res.status(401).json({ message: "User not found or inactive" });
    }

    const token = jwt.sign(
      {
        sub: String(user._id),
        role: user.role,
      },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    const branchRole = (user as any).pharmacyBranchRole || "PHARMACY_STAFF";
    const permissions = ROLE_PERMISSIONS[branchRole as PharmacyRole] || [];

    res.json({
      token,
      user: {
        id: String(user._id),
        _id: String(user._id),
        name: user.name,
        email: user.email,
        role: user.role,
        pharmacyId: user.pharmacyId,
        phone: user.phone,
        pharmacyBranchRole: branchRole,
        permissions,
        isActive: user.isActive,
      },
    });
  } catch (error: any) {
    res.status(500).json({ message: error.message || "Failed to verify OTP" });
  }
});
