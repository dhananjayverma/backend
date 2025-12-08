import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { Appointment, IAppointment } from "./appointment.model";
import { createActivity } from "../activity/activity.service";
import { sendAppointmentReminder } from "../notifications/notification.service";
import { validateRequired } from "../shared/middleware/validation";
import { AppError } from "../shared/middleware/errorHandler";
import { User } from "../user/user.model";
import { Conversation } from "../conversation/conversation.model";
import { Prescription } from "../prescription/prescription.model";
import { socketEvents } from "../socket/socket.server";
import { createDoctorPatientHistory } from "../doctorHistory/doctorHistory.service";
// Import model to ensure it's initialized
import "../doctorHistory/doctorHistory.model";
import { bookSlot, releaseSlot } from "../schedule/schedule.service";
import multer from "multer";
import path from "path";
import fs from "fs";

export const router = Router();

// Configure multer for file uploads
const upload = multer({
  dest: "uploads/reports/",
  limits: {
    fileSize: 10 * 1024 * 1024, // 10MB limit
  },
  fileFilter: (req: Request, file: any, cb: any) => {
    const allowedTypes = /jpeg|jpg|png|pdf|doc|docx/;
    const extname = allowedTypes.test(path.extname(file.originalname).toLowerCase());
    const mimetype = allowedTypes.test(file.mimetype);
    
    if (mimetype && extname) {
      return cb(null, true);
    } else {
      cb(new Error("Invalid file type. Only images, PDFs, and documents are allowed."));
    }
  },
});

// Create appointment (Patient app, Admin portal)
router.post(
  "/",
  validateRequired(["hospitalId", "doctorId", "patientId", "scheduledAt", "patientName", "age", "address", "issue"]),
  async (req: Request, res: Response) => {
    try {
    const { scheduledAt, patientName, age, address, issue } = req.body;
    const appointmentDate = new Date(scheduledAt);
    
    if (isNaN(appointmentDate.getTime())) {
      throw new AppError("Invalid scheduledAt date", 400);
    }

    // Allow appointments for today and future dates
    // If booking for today, allow any time (doctor can handle same-day appointments)
    const now = new Date();
    const appointmentDateOnly = new Date(appointmentDate.getFullYear(), appointmentDate.getMonth(), appointmentDate.getDate());
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Allow if appointment date is today or in the future
    if (appointmentDateOnly < todayOnly) {
      throw new AppError("Appointment cannot be scheduled in the past. Please select today or a future date.", 400);
    }

    // Validate age
    if (!age || age < 0 || age > 150) {
      throw new AppError("Invalid age. Must be between 0 and 150", 400);
    }

    // Validate required fields
    if (!patientName || patientName.trim().length === 0) {
      throw new AppError("Patient name is required", 400);
    }
    if (!address || address.trim().length === 0) {
      throw new AppError("Address is required", 400);
    }
    if (!issue || issue.trim().length === 0) {
      throw new AppError("Issue description is required", 400);
    }

    // Validate and book slot if slot-based booking is enabled
    let bookedSlot = null;
    try {
      bookedSlot = await bookSlot(req.body.doctorId, appointmentDate, req.body.hospitalId);
      if (!bookedSlot) {
        // Slot not available - check if slot system is being used
        // For now, allow booking but log warning
        console.warn(`Slot not available for doctor ${req.body.doctorId} at ${appointmentDate}, but allowing booking`);
      }
    } catch (slotError: any) {
      // If slot system fails, allow booking to proceed (backward compatibility)
      console.warn("Slot booking check failed:", slotError.message);
    }

      const appointment = await Appointment.create({
        ...req.body,
        slotId: bookedSlot?._id ? String(bookedSlot._id) : undefined,
        ...req.body,
        patientName: patientName.trim(),
        age: Number(age),
        address: address.trim(),
        issue: issue.trim(),
        reason: issue.trim(),
      }) as IAppointment;
    
    // Record appointment in doctor-patient history when created
    try {
      console.log("📝 Creating appointment history on creation:", {
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
        patientName: appointment.patientName,
        appointmentId: String(appointment._id),
      });
      
      const historyRecord = await createDoctorPatientHistory({
        doctorId: appointment.doctorId,
        patientId: appointment.patientId,
        patientName: appointment.patientName,
        historyType: "APPOINTMENT",
        appointmentId: String(appointment._id),
        appointmentDate: appointment.scheduledAt,
        appointmentStatus: appointment.status,
        metadata: {
          issue: appointment.issue,
          channel: appointment.channel,
          created: true,
        },
      });
      
      console.log("✅ Appointment history created on creation:", historyRecord._id);
    } catch (historyError: any) {
      console.error("❌ Failed to record appointment history on creation:", historyError);
      console.error("Error details:", {
        message: historyError.message,
        stack: historyError.stack,
      });
      // Don't fail the request if history recording fails
    }

    // Emit activity
    await createActivity(
      "APPOINTMENT_CREATED",
      "New Appointment Created",
      `Patient ${appointment.patientId} booked appointment with Doctor ${appointment.doctorId}`,
      {
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        hospitalId: appointment.hospitalId,
        metadata: { appointmentId: String(appointment._id) },
      }
    );

    // Schedule reminder notification (1 hour before)
    try {
      const patient = await User.findById(appointment.patientId);
      const doctor = await User.findById(appointment.doctorId);
      
      if (patient?.phone && doctor) {
        const reminderTime = new Date(appointmentDate.getTime() - 60 * 60 * 1000); // 1 hour before
        const now = new Date();
        
        if (reminderTime > now) {
          // In production, use a job scheduler (node-cron, Bull, etc.)
          setTimeout(async () => {
            await sendAppointmentReminder(
              appointment.patientId,
              patient.phone!,
              doctor.name,
              appointmentDate
            );
          }, reminderTime.getTime() - now.getTime());
        }
      }
    } catch (error) {
      console.error("Failed to schedule reminder:", error);
    }

    // Emit Socket.IO events with slot information
    socketEvents.emitToUser(appointment.doctorId, "appointment:created", {
      appointmentId: String(appointment._id),
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      scheduledAt: appointment.scheduledAt,
      status: appointment.status,
      patientName: appointment.patientName,
      reason: appointment.reason || appointment.issue,
      slotId: appointment.slotId,
      slotStartTime: bookedSlot?.startTime,
      slotEndTime: bookedSlot?.endTime,
    });
    
    // Also emit slot booking notification specifically
    if (bookedSlot) {
      socketEvents.emitToUser(appointment.doctorId, "slot:booked", {
        slotId: String(bookedSlot._id),
        appointmentId: String(appointment._id),
        patientId: appointment.patientId,
        patientName: appointment.patientName,
        startTime: bookedSlot.startTime,
        endTime: bookedSlot.endTime,
        scheduledAt: appointment.scheduledAt,
      });
    }
    socketEvents.emitToAdmin("appointment:created", {
      appointmentId: String(appointment._id),
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
      scheduledAt: appointment.scheduledAt,
      status: appointment.status,
    });
    
      res.status(201).json(appointment);
    } catch (error: any) {
      if (error instanceof AppError) {
        res.status(error.status).json({ message: error.message });
      } else {
        res.status(400).json({ message: error.message });
      }
    }
  }
);

// List appointments filtered by doctor/patient/hospital
router.get("/", async (req: Request, res: Response) => {
  try {
    const { doctorId, patientId, hospitalId, status } = req.query;

    const filter: any = {};
    if (doctorId) filter.doctorId = doctorId;
    if (patientId) filter.patientId = patientId;
    if (hospitalId) filter.hospitalId = hospitalId;
    if (status) filter.status = status;

    const items = await Appointment.find(filter).sort({ scheduledAt: 1 }).limit(100);
    res.json(items);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get appointment by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const appointment = await Appointment.findById(req.params.id) as IAppointment | null;
    if (!appointment) {
      throw new AppError("Appointment not found", 404);
    }
    res.json(appointment);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(400).json({ message: error.message || "Failed to fetch appointment" });
    }
  }
});

// Update status (Doctor & Admin)
router.patch("/:id/status", validateRequired(["status"]), async (req: Request, res: Response) => {
  try {
  const { status } = req.body;
  
  const validStatuses = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"];
  if (!validStatuses.includes(status)) {
    throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(", ")}`, 400);
  }

    const appointment = await Appointment.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ) as IAppointment | null;

    if (!appointment) {
      throw new AppError("Appointment not found", 404);
    }
  
    // Auto-create conversation when appointment is confirmed
    if (status === "CONFIRMED") {
      const existingConversation = await Conversation.findOne({
        appointmentId: String(appointment._id),
        isActive: true,
      });

      if (!existingConversation) {
        const conversationType = appointment.channel === "VIDEO" ? "ONLINE" : "OFFLINE";
        await Conversation.create({
          appointmentId: String(appointment._id),
          doctorId: appointment.doctorId,
          patientId: appointment.patientId,
          hospitalId: appointment.hospitalId,
          conversationType,
          messages: [],
          isActive: true,
          startedAt: new Date(),
        });

        await createActivity(
          "CONVERSATION_STARTED",
          "Consultation Started",
          `Conversation started for appointment ${String(appointment._id)}`,
          {
            appointmentId: String(appointment._id),
            doctorId: appointment.doctorId,
            patientId: appointment.patientId,
            hospitalId: appointment.hospitalId,
            metadata: { conversationType },
          }
        );
      }
    }

    // Emit Socket.IO events for status update
    socketEvents.emitToUser(appointment.patientId, "appointment:statusUpdated", {
      appointmentId: String(appointment._id),
      status,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      scheduledAt: appointment.scheduledAt,
    });
    socketEvents.emitToUser(appointment.doctorId, "appointment:statusUpdated", {
      appointmentId: String(appointment._id),
      status,
      doctorId: appointment.doctorId,
      patientId: appointment.patientId,
      scheduledAt: appointment.scheduledAt,
    });
    socketEvents.emitToAdmin("appointment:statusUpdated", {
      appointmentId: String(appointment._id),
      status,
      patientId: appointment.patientId,
      doctorId: appointment.doctorId,
    });

    // Release slot when appointment is cancelled
    if (status === "CANCELLED") {
      try {
        await releaseSlot(appointment.doctorId, appointment.scheduledAt);
      } catch (slotError: any) {
        console.warn("Failed to release slot:", slotError.message);
      }

      const conversation = await Conversation.findOne({
        appointmentId: String(appointment._id),
        isActive: true,
      });

      if (conversation) {
        conversation.isActive = false;
        conversation.endedAt = new Date();
        await conversation.save();
      }
    }

    // End conversation when appointment is completed
    if (status === "COMPLETED") {
      const conversation = await Conversation.findOne({
        appointmentId: String(appointment._id),
        isActive: true,
      });

      if (conversation) {
        conversation.isActive = false;
        conversation.endedAt = new Date();
        await conversation.save();
      }
    }

    // Record in doctor-patient history when appointment is completed
    if (status === "COMPLETED") {
      try {
        const patient = await User.findById(appointment.patientId);
        const patientName = patient?.name || appointment.patientName || `Patient ${appointment.patientId.slice(-8)}`;
        
        console.log("📝 Creating appointment history:", {
          doctorId: appointment.doctorId,
          patientId: appointment.patientId,
          patientName,
          appointmentId: String(appointment._id),
        });
        
        const historyRecord = await createDoctorPatientHistory({
          doctorId: appointment.doctorId,
          patientId: appointment.patientId,
          patientName,
          historyType: "APPOINTMENT",
          appointmentId: String(appointment._id),
          appointmentDate: appointment.scheduledAt,
          appointmentStatus: status,
          metadata: {
            issue: appointment.issue,
            channel: appointment.channel,
          },
        });
        
        console.log("✅ Appointment history created:", historyRecord._id);
      } catch (historyError: any) {
        console.error("❌ Failed to record appointment history:", historyError);
        console.error("Error details:", {
          message: historyError.message,
          stack: historyError.stack,
        });
        // Don't fail the request if history recording fails
      }
    }

    // Create activity
    await createActivity(
      "APPOINTMENT_STATUS_UPDATED",
      "Appointment Status Updated",
      `Appointment ${String(appointment._id)} status changed to ${status}`,
      {
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        hospitalId: appointment.hospitalId,
        metadata: { appointmentId: String(appointment._id), status },
      }
    );
    
    res.json(appointment);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Reschedule appointment (Doctor & Admin)
router.patch("/:id/reschedule", validateRequired(["scheduledAt"]), async (req: Request, res: Response) => {
  try {
    const { scheduledAt, reason } = req.body;
    const newDate = new Date(scheduledAt);
    
    if (isNaN(newDate.getTime())) {
      throw new AppError("Invalid scheduledAt date", 400);
    }

    // Allow appointments for today and future dates
    const now = new Date();
    const appointmentDateOnly = new Date(newDate.getFullYear(), newDate.getMonth(), newDate.getDate());
    const todayOnly = new Date(now.getFullYear(), now.getMonth(), now.getDate());
    
    // Allow if appointment date is today or in the future
    if (appointmentDateOnly < todayOnly) {
      throw new AppError("Appointment cannot be rescheduled to a past date. Please select today or a future date.", 400);
    }

    // Release old slot and book new slot
    const oldAppointment = await Appointment.findById(req.params.id);
    let newBookedSlot = null;
    if (oldAppointment) {
      try {
        await releaseSlot(oldAppointment.doctorId, oldAppointment.scheduledAt);
        newBookedSlot = await bookSlot(req.body.doctorId || oldAppointment.doctorId, newDate, req.body.hospitalId || oldAppointment.hospitalId);
      } catch (slotError: any) {
        console.warn("Slot management failed during reschedule:", slotError.message);
      }
    }

    const updateData: any = { 
      scheduledAt: newDate,
      slotId: newBookedSlot?._id ? String(newBookedSlot._id) : undefined,
    };
    if (reason && reason.trim()) {
      updateData.reason = reason.trim();
    }
    const rescheduleReason = req.body.rescheduleReason || reason;
    if (rescheduleReason && rescheduleReason.trim()) {
      updateData.rescheduleReason = rescheduleReason.trim();
    }

    const appointment = await Appointment.findByIdAndUpdate(
      req.params.id,
      updateData,
      { new: true }
    ) as IAppointment | null;

    if (!appointment) {
      throw new AppError("Appointment not found", 404);
    }
    
    await createActivity(
      "APPOINTMENT_RESCHEDULED",
      "Appointment Rescheduled",
      `Appointment rescheduled to ${newDate.toLocaleString()}`,
      {
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        hospitalId: appointment.hospitalId,
        metadata: { appointmentId: String(appointment._id), newTime: scheduledAt },
      }
    );
    
    res.json(appointment);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Cancel appointment (Doctor & Admin)
router.patch("/:id/cancel", validateRequired(["cancellationReason"]), async (req: Request, res: Response) => {
  try {
    const { cancellationReason } = req.body;
    
    if (!cancellationReason || cancellationReason.trim().length === 0) {
      throw new AppError("Cancellation reason is required", 400);
    }

    const appointment = await Appointment.findByIdAndUpdate(
      req.params.id,
      { 
        status: "CANCELLED",
        cancellationReason: cancellationReason.trim(),
        reason: cancellationReason.trim()
      },
      { new: true }
    ) as IAppointment | null;

    if (!appointment) {
      throw new AppError("Appointment not found", 404);
    }

    // Release slot when appointment is cancelled
    try {
      await releaseSlot(appointment.doctorId, appointment.scheduledAt);
    } catch (slotError: any) {
      console.warn("Failed to release slot:", slotError.message);
    }

    // End conversation if active
    const conversation = await Conversation.findOne({
      appointmentId: String(appointment._id),
      isActive: true,
    });

    if (conversation) {
      conversation.isActive = false;
      conversation.endedAt = new Date();
      await conversation.save();
    }
    
    await createActivity(
      "APPOINTMENT_CANCELLED",
      "Appointment Cancelled",
      `Appointment cancelled for Patient ${appointment.patientId}. Reason: ${cancellationReason}`,
      {
        patientId: appointment.patientId,
        doctorId: appointment.doctorId,
        hospitalId: appointment.hospitalId,
        metadata: { appointmentId: String(appointment._id), cancellationReason },
      }
    );
    
    res.json(appointment);
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(400).json({ message: error.message });
    }
  }
});

// Upload report file for appointment
router.post(
  "/:id/upload-report",
  upload.single("report"),
  async (req: Request, res: Response) => {
    try {
      const file = (req as any).file;
      if (!file) {
        throw new AppError("No file uploaded", 400);
      }

      const appointment = await Appointment.findById(req.params.id) as IAppointment | null;
      if (!appointment) {
        if (file.path) {
          fs.unlinkSync(file.path);
        }
        throw new AppError("Appointment not found", 404);
      }

      // Delete old file if exists
      if (appointment.reportFile && fs.existsSync(appointment.reportFile)) {
        try {
          fs.unlinkSync(appointment.reportFile);
        } catch (error) {
          console.error("Failed to delete old report file:", error);
        }
      }

      // Update appointment with file info
      appointment.reportFile = file.path;
      appointment.reportFileName = file.originalname;
      await appointment.save();

      await createActivity(
        "APPOINTMENT_REPORT_UPLOADED",
        "Report Uploaded",
        `Patient uploaded report for appointment ${String(appointment._id)}`,
        {
          patientId: appointment.patientId,
          doctorId: appointment.doctorId,
          hospitalId: appointment.hospitalId,
          metadata: { appointmentId: String(appointment._id), fileName: file.originalname },
        }
      );

      // Notify doctor
      socketEvents.emitToUser(appointment.doctorId, "appointment:reportUploaded", {
        appointmentId: String(appointment._id),
        patientId: appointment.patientId,
        fileName: file.originalname,
      });

      res.json({
        message: "Report uploaded successfully",
        fileUrl: file.path,
        fileName: file.originalname,
      });
    } catch (error: any) {
      if (error instanceof AppError) {
        res.status(error.status).json({ message: error.message });
      } else {
        res.status(400).json({ message: error.message });
      }
    }
  }
);

// Get report file for appointment
router.get("/:id/report", async (req: Request, res: Response) => {
  try {
    const appointment = await Appointment.findById(req.params.id) as IAppointment | null;
    if (!appointment) {
      throw new AppError("Appointment not found", 404);
    }

    if (!appointment.reportFile) {
      throw new AppError("No report file found for this appointment", 404);
    }

    // Resolve file path
    let filePath: string;
    if (path.isAbsolute(appointment.reportFile)) {
      filePath = appointment.reportFile;
    } else {
      if (appointment.reportFile.startsWith("/uploads/") || appointment.reportFile.startsWith("uploads/")) {
        filePath = path.join(process.cwd(), appointment.reportFile.replace(/^\//, ""));
      } else {
        filePath = path.join(process.cwd(), "uploads/reports", path.basename(appointment.reportFile));
        // Also try the old path format
        if (!fs.existsSync(filePath)) {
          filePath = path.join(__dirname, "../../", appointment.reportFile);
        }
      }
    }

    if (!fs.existsSync(filePath)) {
      throw new AppError("Report file not found on server", 404);
    }

    res.sendFile(path.resolve(filePath));
  } catch (error: any) {
    if (error instanceof AppError) {
      res.status(error.status).json({ message: error.message });
    } else {
      res.status(400).json({ message: error.message || "Failed to fetch report file" });
    }
  }
});

// Delete appointment (Patient can delete their own, Doctor/Admin can delete any)
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const appointmentId = req.params.id;
    console.log(`[DELETE] Attempting to delete appointment with ID: ${appointmentId}`);
    
    // Validate MongoDB ObjectId format (more lenient - just check if it exists)
    if (!appointmentId || appointmentId.trim().length === 0) {
      return res.status(400).json({ 
        message: "Invalid appointment ID format", 
        error: "Appointment ID is required" 
      });
    }

    // Find the appointment
    const appointment = await Appointment.findById(appointmentId) as IAppointment | null;
    
    if (!appointment) {
      console.log(`[DELETE] Appointment not found: ${appointmentId}`);
      return res.status(404).json({ 
        message: "Appointment not found",
        error: "Not found",
        appointmentId: appointmentId
      });
    }

    console.log(`[DELETE] Found appointment: ${String(appointment._id)}, Status: ${appointment.status}`);

    // Only allow deletion if appointment is PENDING or CANCELLED
    if (appointment.status !== "PENDING" && appointment.status !== "CANCELLED") {
      return res.status(400).json({ 
        message: `Cannot delete appointment. Only PENDING or CANCELLED appointments can be deleted. Current status: ${appointment.status}`,
        error: "Invalid appointment status for deletion",
        currentStatus: appointment.status
      });
    }

    // Store IDs for cleanup and notifications
    const { patientId, doctorId, hospitalId, reportFile } = appointment;
    const appointmentIdStr = String(appointment._id);
    const appointmentObjectId = appointment._id as mongoose.Types.ObjectId;

    console.log(`[DELETE] Starting deletion process for appointment: ${appointmentIdStr}`);

    // 1. Delete related prescriptions
    let prescriptionsCount = 0;
    try {
      const prescriptions = await Prescription.find({ appointmentId: appointmentIdStr });
      prescriptionsCount = prescriptions.length;
      if (prescriptions.length > 0) {
        const prescriptionDeleteResult = await Prescription.deleteMany({ appointmentId: appointmentIdStr });
        console.log(`[DELETE] Deleted ${prescriptionDeleteResult.deletedCount} prescription(s)`);
      }
    } catch (error: any) {
      console.error("[DELETE] Error deleting prescriptions:", error.message);
      // Continue with appointment deletion even if prescription deletion fails
    }

    // 2. Delete related conversations
    let conversationsCount = 0;
    try {
      const conversations = await Conversation.find({ appointmentId: appointmentIdStr });
      conversationsCount = conversations.length;
      if (conversations.length > 0) {
        const conversationDeleteResult = await Conversation.deleteMany({ appointmentId: appointmentIdStr });
        console.log(`[DELETE] Deleted ${conversationDeleteResult.deletedCount} conversation(s)`);
      }
    } catch (error: any) {
      console.error("[DELETE] Error deleting conversations:", error.message);
      // Continue with appointment deletion even if conversation deletion fails
    }

    // 3. Delete report file if exists
    if (reportFile) {
      try {
        let filePath: string;
        if (path.isAbsolute(reportFile)) {
          filePath = reportFile;
        } else {
          if (reportFile.startsWith("/uploads/") || reportFile.startsWith("uploads/")) {
            filePath = path.join(process.cwd(), reportFile.replace(/^\//, ""));
          } else {
            filePath = path.join(process.cwd(), "uploads/reports", path.basename(reportFile));
            // Also try the old path format
            if (!fs.existsSync(filePath)) {
              filePath = path.join(__dirname, "../../", reportFile);
            }
          }
        }

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
          console.log(`[DELETE] Deleted report file: ${filePath}`);
        } else {
          console.warn(`[DELETE] Report file not found at path: ${filePath}`);
        }
      } catch (error: any) {
        console.error("[DELETE] Failed to delete report file:", error.message);
        // Continue with deletion even if file deletion fails
      }
    }

    // 4. Delete the appointment from database - Simplified and more reliable approach
    console.log(`[DELETE] Attempting to delete appointment with ObjectId: ${appointmentObjectId}`);
    console.log(`[DELETE] Appointment ID string: ${appointmentIdStr}`);
    
    let deleteResult: any = null;
    let deleted = false;
    
    // PRIMARY METHOD: Use findByIdAndDelete (simplest and most reliable)
    try {
      const deletedDoc = await Appointment.findByIdAndDelete(appointmentObjectId);
      if (deletedDoc) {
        deleted = true;
        deleteResult = { deletedCount: 1, acknowledged: true };
        console.log(`[DELETE] ✅ Document deleted successfully via findByIdAndDelete`);
      }
    } catch (error: any) {
      console.error(`[DELETE] findByIdAndDelete failed:`, error.message);
    }
    
    // FALLBACK METHOD 1: Try deleteOne with ObjectId
    if (!deleted) {
      try {
        deleteResult = await Appointment.deleteOne({ _id: appointmentObjectId });
        console.log(`[DELETE] Mongoose deleteOne result:`, {
          deletedCount: deleteResult.deletedCount,
          acknowledged: deleteResult.acknowledged
        });
        if (deleteResult.deletedCount > 0) {
          deleted = true;
          console.log(`[DELETE] ✅ Document deleted successfully via Mongoose deleteOne`);
        }
      } catch (error: any) {
        console.error(`[DELETE] Mongoose deleteOne failed:`, error.message);
      }
    }
    
    // FALLBACK METHOD 2: Use native MongoDB collection (bypasses Mongoose)
    if (!deleted) {
      try {
        const objectId = new mongoose.Types.ObjectId(appointmentId);
        deleteResult = await Appointment.collection.deleteOne({ _id: objectId });
        console.log(`[DELETE] Collection.deleteOne result:`, {
          deletedCount: deleteResult.deletedCount,
          acknowledged: deleteResult.acknowledged
        });
        if (deleteResult.deletedCount > 0) {
          deleted = true;
          console.log(`[DELETE] ✅ Document deleted successfully via collection.deleteOne`);
        }
      } catch (error: any) {
        console.error(`[DELETE] Collection.deleteOne failed:`, error.message);
      }
    }
    
    // FINAL VERIFICATION: Check if document still exists
    if (deleted && deleteResult && deleteResult.deletedCount > 0) {
      // Wait a moment for database to sync
      await new Promise(resolve => setTimeout(resolve, 100));
      
      // Verify deletion by querying the database
      const verifyDelete = await Appointment.findById(appointmentObjectId);
      if (verifyDelete) {
        console.error(`[DELETE] ⚠️ WARNING: Document still exists after deletion! Retrying...`);
        
        // Retry with native collection delete
        try {
          const objectId = new mongoose.Types.ObjectId(appointmentId);
          const retryResult = await Appointment.collection.deleteOne({ _id: objectId });
          console.log(`[DELETE] Retry delete result:`, retryResult);
          
          if (retryResult.deletedCount === 0) {
            console.error(`[DELETE] ❌ FAILED: Document still exists after retry`);
            return res.status(500).json({ 
              message: "Appointment deletion failed - document still exists in database",
              error: "Deletion verification failed",
              appointmentId: appointmentIdStr
            });
          }
        } catch (error: any) {
          console.error(`[DELETE] Retry delete failed:`, error.message);
          return res.status(500).json({ 
            message: "Appointment deletion verification failed: " + error.message,
            error: "Verification error",
            appointmentId: appointmentIdStr
          });
        }
      } else {
        console.log(`[DELETE] ✅ Verification passed - appointment is completely deleted`);
      }
    } else {
      // Check if document actually exists
      const checkExists = await Appointment.findById(appointmentObjectId);
      if (!checkExists) {
        // Document doesn't exist, so deletion is successful
        console.log(`[DELETE] ✅ Document does not exist - considered deleted`);
        deleted = true;
        deleteResult = { deletedCount: 1, acknowledged: true };
      } else {
        console.error(`[DELETE] ❌ FAILED: Could not delete appointment ${appointmentIdStr}`);
        return res.status(500).json({ 
          message: "Failed to delete appointment from database",
          error: "Deletion failed",
          appointmentId: appointmentIdStr,
          details: "All deletion methods returned deletedCount: 0"
        });
      }
    }

    // 5. Create activity log
    try {
      await createActivity(
        "APPOINTMENT_DELETED",
        "Appointment Deleted",
        `Appointment ${appointmentIdStr} was permanently deleted`,
        {
          patientId,
          doctorId,
          hospitalId,
          metadata: { appointmentId: appointmentIdStr },
        }
      );
    } catch (error) {
      console.error("Error creating activity log:", error);
      // Continue even if activity log fails
    }

    // 6. Emit Socket.IO events
    try {
      socketEvents.emitToUser(patientId, "appointment:deleted", {
        appointmentId: appointmentIdStr,
      });
      socketEvents.emitToUser(doctorId, "appointment:deleted", {
        appointmentId: appointmentIdStr,
      });
      socketEvents.emitToAdmin("appointment:deleted", {
        appointmentId: appointmentIdStr,
        patientId,
        doctorId,
      });
    } catch (error) {
      console.error("Error emitting socket events:", error);
      // Continue even if socket events fail
    }

    // Verify all related data is deleted
    const remainingPrescriptions = await Prescription.countDocuments({ appointmentId: appointmentIdStr });
    const remainingConversations = await Conversation.countDocuments({ appointmentId: appointmentIdStr });
    
    if (remainingPrescriptions > 0 || remainingConversations > 0) {
      console.warn(`WARNING: Some related data still exists - Prescriptions: ${remainingPrescriptions}, Conversations: ${remainingConversations}`);
    }

    res.json({ 
      message: "Appointment deleted successfully from database",
      appointmentId: appointmentIdStr,
      deletedCount: deleteResult?.deletedCount || 1,
      relatedDataDeleted: {
        prescriptions: prescriptionsCount,
        conversations: conversationsCount
      }
    });
  } catch (error: any) {
    console.error("Error deleting appointment:", error);
    const errorMessage = error instanceof AppError 
      ? error.message 
      : error.message || "Failed to delete appointment";
    return res.status(error instanceof AppError ? error.status : 500).json({ 
      message: errorMessage,
      error: "Deletion error",
      details: error.message
    });
  }
});
