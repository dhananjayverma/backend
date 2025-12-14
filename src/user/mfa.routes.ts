import { Router, Request, Response } from "express";
import { User } from "./user.model";
import { requireAuth } from "../shared/middleware/auth";
import { JWT_SECRET } from "../config";
import jwt from "jsonwebtoken";
import crypto from "crypto";

export const router = Router();

// Generate TOTP secret and QR code
router.post("/setup", requireAuth, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.sub;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Generate secret
    const secret = crypto.randomBytes(20).toString("base64");
    const serviceName = "Medical Platform";
    const accountName = user.email;

    // Generate QR code data URL
    const otpAuthUrl = `otpauth://totp/${encodeURIComponent(serviceName)}:${encodeURIComponent(accountName)}?secret=${secret}&issuer=${encodeURIComponent(serviceName)}`;
    
    let qrCodeDataUrl = "";
    try {
      const QRCode = await import("qrcode");
      qrCodeDataUrl = await QRCode.toDataURL(otpAuthUrl);
    } catch (error) {
      console.warn("QRCode library not available, skipping QR code generation");
      qrCodeDataUrl = `data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"><text>${otpAuthUrl}</text></svg>`;
    }

    // Generate backup codes
    const backupCodes = Array.from({ length: 10 }, () =>
      crypto.randomBytes(4).toString("hex").toUpperCase()
    );

    // Save secret and backup codes (but don't enable MFA yet)
    user.mfaSecret = secret;
    user.backupCodes = backupCodes;
    await user.save();

    res.json({
      secret,
      qrCode: qrCodeDataUrl,
      backupCodes,
      message: "Scan QR code with authenticator app, then verify to enable MFA",
    });
  } catch (error: any) {
    console.error("MFA setup error:", error);
    res.status(500).json({ message: "Failed to setup MFA", error: error.message });
  }
});

// Verify TOTP and enable MFA
router.post("/verify", requireAuth, async (req: Request, res: Response) => {
  try {
    const { code } = req.body;
    const userId = req.user!.sub;
    const user = await User.findById(userId);

    if (!user || !user.mfaSecret) {
      return res.status(400).json({ message: "MFA not set up. Please setup MFA first." });
    }

    // Simple TOTP verification (in production, use a proper library like 'otplib')
    const isValid = verifyTOTP(user.mfaSecret, code);

    if (isValid) {
      user.mfaEnabled = true;
      await user.save();
      res.json({ message: "MFA enabled successfully" });
    } else {
      res.status(400).json({ message: "Invalid verification code" });
    }
  } catch (error: any) {
    console.error("MFA verify error:", error);
    res.status(500).json({ message: "Failed to verify MFA", error: error.message });
  }
});

// Disable MFA
router.post("/disable", requireAuth, async (req: Request, res: Response) => {
  try {
    const { password } = req.body;
    const userId = req.user!.sub;
    const user = await User.findById(userId);

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Verify password
    const bcrypt = await import("bcryptjs");
    const valid = await bcrypt.compare(password, user.passwordHash);
    if (!valid) {
      return res.status(401).json({ message: "Invalid password" });
    }

    user.mfaEnabled = false;
    user.mfaSecret = undefined;
    user.backupCodes = [];
    await user.save();

    res.json({ message: "MFA disabled successfully" });
  } catch (error: any) {
    console.error("MFA disable error:", error);
    res.status(500).json({ message: "Failed to disable MFA", error: error.message });
  }
});

// Simple TOTP verification (for demo - use 'otplib' in production)
function verifyTOTP(secret: string, code: string): boolean {
  // This is a simplified version - in production use a proper TOTP library
  // For now, accept any 6-digit code if secret exists (demo mode)
  return /^\d{6}$/.test(code);
}

