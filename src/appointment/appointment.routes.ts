import { Router, Request, Response } from "express";
import mongoose from "mongoose";
import { Appointment, IAppointment } from "./appointment.model";
import { createActivity } from "../activity/activity.service";
import { sendAppointmentReminder, createNotification } from "../notifications/notification.service";
import { validateRequired } from "../shared/middleware/validation";
import { AppError } from "../shared/middleware/errorHandler";
import { requireAuth } from "../shared/middleware/auth";
import { User } from "../user/user.model";
import { Conversation } from "../conversation/conversation.model";
import { Prescription } from "../prescription/prescription.model";
import { socketEvents } from "../socket/socket.server";
import { createDoctorPatientHistory } from "../doctorHistory/doctorHistory.service";
// Import model to ensure it's initialized
import "../doctorHistory/doctorHistory.model";
import { bookSlot, releaseSlot } from "../schedule/schedule.service";
import { Hospital } from "../master/hospital.model";
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
  requireAuth,
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
    
    try {
      await createDoctorPatientHistory({
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

    // Create notification for doctor
    try {
      await createNotification({
        userId: appointment.doctorId,
        type: "APPOINTMENT_REQUEST",
        title: "New Appointment Request",
        message: `New appointment request from ${appointment.patientName} for ${appointmentDate.toLocaleString()}. Issue: ${appointment.issue}`,
        metadata: {
          appointmentId: String(appointment._id),
          patientId: appointment.patientId,
          patientName: appointment.patientName,
          scheduledAt: appointment.scheduledAt,
        },
        channel: "PUSH",
      });
    } catch (error) {
      console.error("Failed to create notification for doctor:", error);
    }

    // Create notification for patient
    try {
      await createNotification({
        userId: appointment.patientId,
        type: "APPOINTMENT_BOOKED",
        title: "Appointment Booked",
        message: `Your appointment with Dr. ${doctor?.name || "Doctor"} has been booked for ${appointmentDate.toLocaleString()}. Status: Pending confirmation.`,
        metadata: {
          appointmentId: String(appointment._id),
          doctorId: appointment.doctorId,
          scheduledAt: appointment.scheduledAt,
        },
        channel: "PUSH",
      });
    } catch (error) {
      console.error("Failed to create notification for patient:", error);
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
    
    // Also emit notification event
    socketEvents.emitToUser(appointment.doctorId, "notification:new", {
      type: "APPOINTMENT_REQUEST",
      title: "New Appointment Request",
      message: `New appointment request from ${appointment.patientName}`,
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
router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const { doctorId, patientId, hospitalId, status } = req.query;
    const userId = (req as any).user?.sub;
    const userRole = (req as any).user?.role;

    const filter: any = {};
    
    // If patientId is provided, use it
    if (patientId) {
      filter.patientId = patientId;
    } else if (userRole === "PATIENT") {
      // If user is a patient and no patientId provided, use their own ID
      filter.patientId = userId;
    }
    
    // If doctorId is provided, use it
    if (doctorId) {
      filter.doctorId = doctorId;
    } else if (userRole === "DOCTOR") {
      // If user is a doctor and no doctorId provided, use their own ID
      filter.doctorId = userId;
    }
    
    if (hospitalId) filter.hospitalId = hospitalId;
    if (status) filter.status = status;

    console.log("Fetching appointments with filter:", filter);
    const items = await Appointment.find(filter).sort({ scheduledAt: 1 }).limit(100);
    console.log(`Found ${items.length} appointments`);
    
    // Populate doctor and hospital information
    const enrichedItems = await Promise.all(
      items.map(async (appointment: any) => {
        const appointmentObj = appointment.toObject ? appointment.toObject() : appointment;
        
        // Fetch doctor information
        let doctor = null;
        if (appointmentObj.doctorId) {
          try {
            const doctorDoc = await User.findById(appointmentObj.doctorId)
              .select("name email specialization qualification serviceCharge")
              .lean();
            if (doctorDoc) {
              doctor = {
                _id: String(doctorDoc._id),
                name: doctorDoc.name,
                specialization: doctorDoc.specialization || undefined,
                qualification: doctorDoc.qualification || undefined,
                serviceCharge: doctorDoc.serviceCharge || undefined,
              };
            }
          } catch (error: any) {
            console.error(`Error fetching doctor ${appointmentObj.doctorId}:`, error.message);
          }
        }
        
        // Fetch hospital information
        let hospital = null;
        if (appointmentObj.hospitalId) {
          try {
            const hospitalDoc = await Hospital.findById(appointmentObj.hospitalId)
              .select("name address city state contactNumber")
              .lean();
            if (hospitalDoc) {
              hospital = {
                _id: String(hospitalDoc._id),
                name: hospitalDoc.name,
                address: hospitalDoc.address,
                city: hospitalDoc.city || undefined,
                state: hospitalDoc.state || undefined,
                contactNumber: hospitalDoc.contactNumber || undefined,
              };
            }
          } catch (error: any) {
            console.error(`Error fetching hospital ${appointmentObj.hospitalId}:`, error.message);
          }
        }
        
        return {
          ...appointmentObj,
          doctor,
          hospital,
        };
      })
    );
    
    res.json(enrichedItems);
  } catch (error: any) {
    console.error("Error fetching appointments:", error);
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
router.patch("/:id/status", requireAuth, validateRequired(["status"]), async (req: Request, res: Response) => {
  try {
  const { status } = req.body;
  
  const validStatuses = ["PENDING", "CONFIRMED", "COMPLETED", "CANCELLED"];
  if (!validStatuses.includes(status)) {
    throw new AppError(`Invalid status. Must be one of: ${validStatuses.join(", ")}`, 400);
  }

    const appointment = await Appointment.findById(req.params.id) as IAppointment | null;
    if (!appointment) {
      throw new AppError("Appointment not found", 404);
    }

    // Check authorization
    const userId = req.user?.sub;
    const userRole = req.user?.role;
    const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";
    const isDoctor = userRole === "DOCTOR";
    const isPatient = userRole === "PATIENT";
    
    // Convert both IDs to strings for comparison
    const doctorIdStr = String(appointment.doctorId);
    const patientIdStr = String(appointment.patientId);
    const userIdStr = String(userId);
    
    // Allow patients to mark their own appointments as COMPLETED
    if (isPatient && status === "COMPLETED" && patientIdStr === userIdStr) {
      // Patient can mark their own appointment as completed
    } else if (isAdmin) {
      // Admin can update any appointment
    } else if (isDoctor && doctorIdStr === userIdStr) {
      // Doctor can update their own appointments
    } else {
      throw new AppError("You don't have permission to update this appointment", 403);
    }

    const updated = await Appointment.findByIdAndUpdate(
      req.params.id,
      { status },
      { new: true }
    ) as IAppointment | null;
  
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

    // Create notifications based on status
    try {
      const doctor = await User.findById(appointment.doctorId);
      const patient = await User.findById(appointment.patientId);
      
      if (status === "CONFIRMED") {
        // Notify patient
        await createNotification({
          userId: appointment.patientId,
          type: "APPOINTMENT_CONFIRMED",
          title: "Appointment Confirmed",
          message: `Your appointment with Dr. ${doctor?.name || "Doctor"} has been confirmed for ${new Date(appointment.scheduledAt).toLocaleString()}.`,
          metadata: {
            appointmentId: String(appointment._id),
            doctorId: appointment.doctorId,
            scheduledAt: appointment.scheduledAt,
          },
          channel: "PUSH",
        });
      } else if (status === "CANCELLED") {
        // Notify patient
        await createNotification({
          userId: appointment.patientId,
          type: "APPOINTMENT_CANCELLED",
          title: "Appointment Cancelled",
          message: `Your appointment with Dr. ${doctor?.name || "Doctor"} scheduled for ${new Date(appointment.scheduledAt).toLocaleString()} has been cancelled.${updated?.cancellationReason ? ` Reason: ${updated.cancellationReason}` : ""}`,
          metadata: {
            appointmentId: String(appointment._id),
            doctorId: appointment.doctorId,
            cancellationReason: updated?.cancellationReason,
          },
          channel: "PUSH",
        });
      } else if (status === "COMPLETED") {
        // Notify patient
        await createNotification({
          userId: appointment.patientId,
          type: "APPOINTMENT_COMPLETED",
          title: "Appointment Completed",
          message: `Your appointment with Dr. ${doctor?.name || "Doctor"} has been marked as completed.`,
          metadata: {
            appointmentId: String(appointment._id),
            doctorId: appointment.doctorId,
          },
          channel: "PUSH",
        });
      }
    } catch (error) {
      console.error("Failed to create notifications for status update:", error);
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
    
    // Emit notification events
    if (status === "CONFIRMED") {
      socketEvents.emitToUser(appointment.patientId, "notification:new", {
        type: "APPOINTMENT_CONFIRMED",
        title: "Appointment Confirmed",
        message: `Your appointment has been confirmed.`,
      });
    } else if (status === "CANCELLED") {
      socketEvents.emitToUser(appointment.patientId, "notification:new", {
        type: "APPOINTMENT_CANCELLED",
        title: "Appointment Cancelled",
        message: `Your appointment has been cancelled.`,
      });
    }
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
        
        await createDoctorPatientHistory({
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
      } catch (historyError: any) {
        console.error("Failed to record appointment history:", historyError);
      }
    }

    // Create activity
    await createActivity(
      "APPOINTMENT_STATUS_UPDATED",
      "Appointment Status Updated",
      `Appointment ${String(updated!._id)} status changed to ${status}`,
      {
        patientId: updated!.patientId,
        doctorId: updated!.doctorId,
        hospitalId: updated!.hospitalId,
        metadata: { appointmentId: String(updated!._id), status },
      }
    );
    
    res.json(updated);
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
    if (!oldAppointment) {
      throw new AppError("Appointment not found", 404);
    }

    // Check authorization - doctor can only reschedule their own appointments
    const userId = (req as any).user?.sub;
    const userRole = (req as any).user?.role;
    const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";
    
    if (!isAdmin && oldAppointment.doctorId !== userId) {
      throw new AppError("You can only reschedule your own appointments", 403);
    }
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

    const appointment = await Appointment.findById(req.params.id) as IAppointment | null;
    if (!appointment) {
      throw new AppError("Appointment not found", 404);
    }

    // Check authorization - doctor can only cancel their own appointments
    const userId = (req as any).user?.sub;
    const userRole = (req as any).user?.role;
    const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";
    
    if (!isAdmin && appointment.doctorId !== userId) {
      throw new AppError("You can only cancel your own appointments", 403);
    }

    const updated = await Appointment.findByIdAndUpdate(
      req.params.id,
      { 
        status: "CANCELLED",
        cancellationReason: cancellationReason.trim(),
        reason: cancellationReason.trim()
      },
      { new: true }
    ) as IAppointment | null;

    // Release slot when appointment is cancelled
    try {
      await releaseSlot(updated!.doctorId, updated!.scheduledAt);
    } catch (slotError: any) {
      console.warn("Failed to release slot:", slotError.message);
    }

    // End conversation if active
    const conversation = await Conversation.findOne({
      appointmentId: String(updated!._id),
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
      `Appointment cancelled for Patient ${updated!.patientId}. Reason: ${cancellationReason}`,
      {
        patientId: updated!.patientId,
        doctorId: updated!.doctorId,
        hospitalId: updated!.hospitalId,
        metadata: { appointmentId: String(updated!._id), cancellationReason },
      }
    );
    
    res.json(updated);
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
router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
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

    // Check authorization - patients can only delete their own appointments
    const userId = (req as any).user?.sub;
    const userRole = (req as any).user?.role;
    const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";
    const isDoctor = userRole === "DOCTOR";
    const isPatient = userRole === "PATIENT";
    
    if (isPatient && String(appointment.patientId) !== String(userId)) {
      return res.status(403).json({ 
        message: "You can only delete your own appointments",
        error: "Unauthorized"
      });
    }
    
    if (isDoctor && String(appointment.doctorId) !== String(userId) && !isAdmin) {
      return res.status(403).json({ 
        message: "You can only delete your own appointments",
        error: "Unauthorized"
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

    try {
      const prescriptions = await Prescription.find({ appointmentId: appointmentIdStr });
      if (prescriptions.length > 0) {
        await Prescription.deleteMany({ appointmentId: appointmentIdStr });
      }
    } catch (error: any) {
      console.error("Error deleting prescriptions:", error.message);
    }

    try {
      const conversations = await Conversation.find({ appointmentId: appointmentIdStr });
      if (conversations.length > 0) {
        await Conversation.deleteMany({ appointmentId: appointmentIdStr });
      }
    } catch (error: any) {
      console.error("Error deleting conversations:", error.message);
    }

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
            if (!fs.existsSync(filePath)) {
              filePath = path.join(__dirname, "../../", reportFile);
            }
          }
        }

        if (fs.existsSync(filePath)) {
          fs.unlinkSync(filePath);
        }
      } catch (error: any) {
        console.error("Failed to delete report file:", error.message);
      }
    }

    let deleteResult: any = null;
    let deleted = false;
    
    try {
      const deletedDoc = await Appointment.findByIdAndDelete(appointmentObjectId);
      if (deletedDoc) {
        deleted = true;
        deleteResult = { deletedCount: 1, acknowledged: true };
      }
    } catch (error: any) {
      console.error("findByIdAndDelete failed:", error.message);
    }
    
    if (!deleted) {
      try {
        deleteResult = await Appointment.deleteOne({ _id: appointmentObjectId });
        if (deleteResult.deletedCount > 0) {
          deleted = true;
        }
      } catch (error: any) {
        console.error("deleteOne failed:", error.message);
      }
    }
    
    if (!deleted) {
      try {
        const objectId = new mongoose.Types.ObjectId(appointmentId);
        deleteResult = await Appointment.collection.deleteOne({ _id: objectId });
        if (deleteResult.deletedCount > 0) {
          deleted = true;
        }
      } catch (error: any) {
        console.error("Collection deleteOne failed:", error.message);
      }
    }
    
    if (deleted && deleteResult && deleteResult.deletedCount > 0) {
      await new Promise(resolve => setTimeout(resolve, 100));
      
      const verifyDelete = await Appointment.findById(appointmentObjectId);
      if (verifyDelete) {
        try {
          const objectId = new mongoose.Types.ObjectId(appointmentId);
          const retryResult = await Appointment.collection.deleteOne({ _id: objectId });
          
          if (retryResult.deletedCount === 0) {
            return res.status(500).json({ 
              message: "Appointment deletion failed - document still exists in database",
              error: "Deletion verification failed",
              appointmentId: appointmentIdStr
            });
          }
        } catch (error: any) {
          console.error("Retry delete failed:", error.message);
          return res.status(500).json({ 
            message: "Appointment deletion verification failed: " + error.message,
            error: "Verification error",
            appointmentId: appointmentIdStr
          });
        }
      }
    } else {
      const checkExists = await Appointment.findById(appointmentObjectId);
      if (!checkExists) {
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
