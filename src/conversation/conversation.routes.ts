import { Router, Request, Response } from "express";
import { Conversation, IConversation } from "./conversation.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";
import { validateRequest } from "../shared/middleware/validation";
import { body } from "express-validator";
import { createActivity } from "../activity/activity.service";
import { socketEvents } from "../socket/socket.server";
import { createNotification } from "../notifications/notification.service";

export const router = Router();

const DEFAULT_MESSAGE_TYPE = "TEXT";
const DEFAULT_LIMIT = 100;

const getConversationId = (conversation: IConversation): string => String(conversation._id);

router.post(
  "/",
  requireAuth,
  requireRole(["DOCTOR", "PATIENT"]),
  [
    body("appointmentId").notEmpty().withMessage("Appointment ID is required"),
    body("conversationType").isIn(["ONLINE", "OFFLINE"]).withMessage("Invalid conversation type"),
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { appointmentId, conversationType, doctorId, patientId, hospitalId } = req.body;

      const { Appointment } = await import("../appointment/appointment.model");
      const appointment = await Appointment.findById(appointmentId);
      
      if (!appointment) {
        return res.status(404).json({ message: "Appointment not found" });
      }

      const finalDoctorId = doctorId || appointment.doctorId;
      const finalPatientId = patientId || appointment.patientId;
      const finalHospitalId = hospitalId || appointment.hospitalId;
      const finalConversationType = conversationType || (appointment.channel === "VIDEO" ? "ONLINE" : "OFFLINE");

      let conversation = await Conversation.findOne({
        appointmentId,
        isActive: true,
      });

      if (!conversation) {
        conversation = await Conversation.create({
          appointmentId,
          doctorId: finalDoctorId,
          patientId: finalPatientId,
          hospitalId: finalHospitalId,
          conversationType: finalConversationType,
          messages: [],
          isActive: true,
          startedAt: new Date(),
        });

        await createActivity(
          "CONVERSATION_STARTED",
          "Consultation Started",
          `Conversation started for appointment ${appointmentId}`,
          {
            appointmentId,
            doctorId: finalDoctorId,
            patientId: finalPatientId,
            hospitalId: finalHospitalId,
            metadata: { 
              conversationId: getConversationId(conversation), 
              conversationType: finalConversationType 
            },
          }
        );

        // Notify patient that consultation has started
        try {
          const { User } = await import("../user/user.model");
          const doctor = await User.findById(finalDoctorId);
          await createNotification({
            userId: finalPatientId,
            type: "CONSULTATION_STARTED",
            title: "Consultation Started",
            message: `Dr. ${doctor?.name || "Doctor"} has started your consultation. You can now chat with your doctor.`,
            metadata: {
              appointmentId,
              conversationId: getConversationId(conversation),
              doctorId: finalDoctorId,
            },
            channel: "PUSH",
          });
          
          // Emit socket event
          socketEvents.emitToUser(finalPatientId, "notification:new", {
            type: "CONSULTATION_STARTED",
            title: "Consultation Started",
            message: `Dr. ${doctor?.name || "Doctor"} has started your consultation.`,
          });
        } catch (error) {
          console.error("Failed to create notification for consultation start:", error);
        }
      }

      res.json(conversation);
    } catch (error: any) {
      console.error("Error creating conversation:", error);
      res.status(500).json({ message: "Failed to create conversation", error: error.message });
    }
  }
);

router.post(
  "/:id/messages",
  requireAuth,
  requireRole(["DOCTOR", "PATIENT"]),
  [
    body("content").notEmpty().withMessage("Message content is required"),
    body("messageType").isIn(["TEXT", "AUDIO", "IMAGE", "FILE"]).optional(),
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const conversation = await Conversation.findById(req.params.id);
      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      const message = {
        senderId: req.user!.sub,
        senderRole: req.user!.role as "DOCTOR" | "PATIENT",
        messageType: (req.body.messageType || DEFAULT_MESSAGE_TYPE) as "TEXT" | "AUDIO" | "IMAGE" | "FILE",
        content: req.body.content,
        timestamp: new Date(),
        metadata: req.body.metadata || {},
      };

      conversation.messages.push(message);
      await conversation.save();

      // Emit Socket.IO events for real-time message updates
      const messageData = {
        conversationId: getConversationId(conversation),
        appointmentId: conversation.appointmentId,
        message: {
          senderId: message.senderId,
          senderRole: message.senderRole,
          messageType: message.messageType,
          content: message.content,
          timestamp: message.timestamp,
        },
        doctorId: conversation.doctorId,
        patientId: conversation.patientId,
      };

      // Emit to both doctor and patient
      socketEvents.emitToUser(conversation.doctorId, "message:created", messageData);
      socketEvents.emitToUser(conversation.patientId, "message:created", messageData);

      // Notify the other party about new message
      try {
        const { User } = await import("../user/user.model");
        const sender = await User.findById(message.senderId);
        const recipientId = message.senderRole === "DOCTOR" ? conversation.patientId : conversation.doctorId;
        const recipient = await User.findById(recipientId);
        
        if (recipientId && message.messageType === "TEXT") {
          await createNotification({
            userId: recipientId,
            type: "MESSAGE_RECEIVED",
            title: "New Message",
            message: `You have a new message from ${sender?.name || (message.senderRole === "DOCTOR" ? "Doctor" : "Patient")}`,
            metadata: {
              conversationId: getConversationId(conversation),
              appointmentId: conversation.appointmentId,
              senderId: message.senderId,
              senderRole: message.senderRole,
            },
            channel: "PUSH",
          });
          
          // Emit notification event
          socketEvents.emitToUser(recipientId, "notification:new", {
            type: "MESSAGE_RECEIVED",
            title: "New Message",
            message: `New message from ${sender?.name || (message.senderRole === "DOCTOR" ? "Doctor" : "Patient")}`,
          });
        }
      } catch (error) {
        console.error("Failed to create notification for message:", error);
      }

      res.json(conversation);
    } catch (error: any) {
      console.error("Error adding message:", error);
      res.status(500).json({ message: "Failed to add message", error: error.message });
    }
  }
);

router.get("/by-appointment/:appointmentId", requireAuth, async (req: Request, res: Response) => {
  try {
    const conversation = await Conversation.findOne({
      appointmentId: req.params.appointmentId,
      isActive: true,
    });
    
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    
    res.json(conversation);
  } catch (error: any) {
    console.error("Error fetching conversation:", error);
    res.status(500).json({ message: "Failed to fetch conversation", error: error.message });
  }
});

router.get("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }
    res.json(conversation);
  } catch (error: any) {
    console.error("Error fetching conversation:", error);
    res.status(500).json({ message: "Failed to fetch conversation", error: error.message });
  }
});

router.patch(
  "/:id",
  requireAuth,
  requireRole(["DOCTOR"]),
  async (req: Request, res: Response) => {
    try {
      const { summary, prescriptionId, isActive, endedAt } = req.body;
      const updateData: any = {};
      
      if (summary !== undefined) updateData.summary = summary;
      if (prescriptionId !== undefined) updateData.prescriptionId = prescriptionId;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (endedAt !== undefined) updateData.endedAt = new Date(endedAt);

      const conversation = await Conversation.findByIdAndUpdate(req.params.id, updateData, {
        new: true,
      });

      if (!conversation) {
        return res.status(404).json({ message: "Conversation not found" });
      }

      if (isActive === false && !conversation.endedAt) {
        conversation.endedAt = new Date();
        await conversation.save();
        
        // Notify patient that consultation has ended
        try {
          const { User } = await import("../user/user.model");
          const doctor = await User.findById(conversation.doctorId);
          await createNotification({
            userId: conversation.patientId,
            type: "CONSULTATION_ENDED",
            title: "Consultation Ended",
            message: `Your consultation with Dr. ${doctor?.name || "Doctor"} has ended. Prescription will be available soon.`,
            metadata: {
              appointmentId: conversation.appointmentId,
              conversationId: getConversationId(conversation),
              doctorId: conversation.doctorId,
            },
            channel: "PUSH",
          });
          
          // Emit socket event
          socketEvents.emitToUser(conversation.patientId, "notification:new", {
            type: "CONSULTATION_ENDED",
            title: "Consultation Ended",
            message: `Your consultation has ended. Prescription will be available soon.`,
          });
        } catch (error) {
          console.error("Failed to create notification for consultation end:", error);
        }
      }

      res.json(conversation);
    } catch (error: any) {
      console.error("Error updating conversation:", error);
      res.status(500).json({ message: "Failed to update conversation", error: error.message });
    }
  }
);

router.get("/", requireAuth, async (req: Request, res: Response) => {
  try {
    const { doctorId, patientId, appointmentId } = req.query;
    const filter: any = {};
    
    if (doctorId) filter.doctorId = doctorId;
    if (patientId) filter.patientId = patientId;
    if (appointmentId) filter.appointmentId = appointmentId;

    const conversations = await Conversation.find(filter)
      .sort({ createdAt: -1 })
      .limit(DEFAULT_LIMIT);
    
    res.json(conversations);
  } catch (error: any) {
    console.error("Error fetching conversations:", error);
    res.status(500).json({ message: "Failed to fetch conversations", error: error.message });
  }
});

// Delete conversation (Patient can delete their own, Doctor/Admin can delete any)
router.delete("/:id", requireAuth, async (req: Request, res: Response) => {
  try {
    const conversation = await Conversation.findById(req.params.id);
    if (!conversation) {
      return res.status(404).json({ message: "Conversation not found" });
    }

    // Check authorization - patients can only delete their own conversations
    const userId = (req as any).user?.sub;
    const userRole = (req as any).user?.role;
    const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";
    const isDoctor = userRole === "DOCTOR";
    const isPatient = userRole === "PATIENT";
    
    if (isPatient && String(conversation.patientId) !== String(userId)) {
      return res.status(403).json({ message: "You can only delete your own conversations" });
    }
    
    if (isDoctor && String(conversation.doctorId) !== String(userId) && !isAdmin) {
      return res.status(403).json({ message: "You can only delete your own conversations" });
    }

    await Conversation.findByIdAndDelete(req.params.id);

    await createActivity(
      "CONVERSATION_DELETED",
      "Conversation Deleted",
      `Conversation ${getConversationId(conversation)} deleted`,
      {
        appointmentId: conversation.appointmentId,
        doctorId: conversation.doctorId,
        patientId: conversation.patientId,
        metadata: { conversationId: getConversationId(conversation) },
      }
    );

    socketEvents.emitToUser(conversation.patientId, "conversation:deleted", {
      conversationId: getConversationId(conversation),
      appointmentId: conversation.appointmentId,
    });
    socketEvents.emitToUser(conversation.doctorId, "conversation:deleted", {
      conversationId: getConversationId(conversation),
      appointmentId: conversation.appointmentId,
    });

    res.json({ message: "Conversation deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting conversation:", error);
    res.status(500).json({ message: "Failed to delete conversation", error: error.message });
  }
});
