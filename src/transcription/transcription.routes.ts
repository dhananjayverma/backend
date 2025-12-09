import { Router, Request, Response } from "express";
import { requireAuth, requireRole } from "../shared/middleware/auth";
import { Conversation } from "../conversation/conversation.model";

export const router = Router();

router.post(
  "/transcribe",
  requireAuth,
  requireRole(["DOCTOR"]),
  async (req: Request, res: Response) => {
    try {
      const { audioData, conversationId, appointmentId } = req.body;
      const mockTranscript = `
        Patient: I've been experiencing headaches for the past week.
        Doctor: Can you describe the pain? Is it constant or intermittent?
        Patient: It's mostly in the morning, and it gets better during the day.
        Doctor: Any other symptoms like nausea or sensitivity to light?
        Patient: Yes, sometimes I feel nauseous.
        Doctor: Based on your symptoms, this could be tension headaches or migraines. 
        I'll prescribe some pain relief medication and recommend rest.
      `.trim();

      // AI Suggestions (mock - in production use GPT/Claude API)
      const suggestions = {
        diagnosis: [
          "Tension Headache",
          "Migraine",
          "Stress-related headache"
        ],
        medicines: [
          {
            medicineName: "Paracetamol",
            dosage: "500mg",
            frequency: "Twice daily",
            duration: "5 days",
            notes: "Take with food"
          },
          {
            medicineName: "Ibuprofen",
            dosage: "400mg",
            frequency: "As needed",
            duration: "3 days",
            notes: "For severe pain only"
          }
        ],
        notes: "Patient should rest, avoid stress, and follow up if symptoms persist."
      };

      if (conversationId) {
        const conversation = await Conversation.findById(conversationId);
        if (conversation) {
          conversation.messages.push({
            senderId: req.user!.sub,
            senderRole: "DOCTOR",
            messageType: "TEXT",
            content: `[Transcription]\n${mockTranscript}`,
            timestamp: new Date(),
            metadata: { isTranscription: true, suggestions },
          });
          await conversation.save();
        }
      }

      res.json({
        transcript: mockTranscript,
        suggestions,
        message: "Transcription completed successfully",
      });
    } catch (error: any) {
      console.error("Transcription error:", error);
      res.status(500).json({
        message: "Failed to transcribe audio",
        error: error.message,
      });
    }
  }
);

router.post(
  "/generate-prescription",
  requireAuth,
  requireRole(["DOCTOR"]),
  async (req: Request, res: Response) => {
    try {
      const { conversationId, appointmentId, items, diagnosis, notes } = req.body;

      res.json({
        suggestedItems: items || [],
        diagnosis: diagnosis || [],
        notes: notes || "",
        message: "Prescription suggestions generated",
      });
    } catch (error: any) {
      console.error("Prescription generation error:", error);
      res.status(500).json({
        message: "Failed to generate prescription",
        error: error.message,
      });
    }
  }
);

