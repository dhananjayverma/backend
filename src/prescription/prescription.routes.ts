import { Router, Request, Response } from "express";
import { Prescription, IPrescription } from "./prescription.model";
import { createActivity } from "../activity/activity.service";
import { validateRequired } from "../shared/middleware/validation";
import { AppError } from "../shared/middleware/errorHandler";
import { socketEvents } from "../socket/socket.server";
import { createDoctorPatientHistory } from "../doctorHistory/doctorHistory.service";
// Import model to ensure it's initialized
import "../doctorHistory/doctorHistory.model";

export const router = Router();

// Helper function to get prescription ID as string
const getPrescriptionId = (prescription: IPrescription): string => String(prescription._id);

// Helper function to safely get createdAt timestamp
const getCreatedAt = (prescription: IPrescription): Date => {
  return (prescription as any).createdAt || new Date();
};

// Helper function to validate prescription items
const validatePrescriptionItems = (items: any[]): void => {
  if (!Array.isArray(items) || items.length === 0) {
    throw new AppError("Prescription must have at least one item", 400);
  }

  for (const item of items) {
    if (!item.medicineName || !item.dosage || !item.frequency || !item.duration) {
      throw new AppError("Each prescription item must have medicineName, dosage, frequency, and duration", 400);
    }
  }
};

// Helper function to handle errors consistently
const handleError = (error: any, res: Response, defaultStatus: number = 500): void => {
  if (error instanceof AppError) {
    res.status(error.status).json({ message: error.message });
  } else {
    console.error("Error:", error);
    res.status(defaultStatus).json({ message: error.message || "Internal server error" });
  }
};

// Helper function to generate medicines HTML table
const generateMedicinesHtml = (items: IPrescription["items"]): string => {
  return items
    .map(
      (item, idx) => `
      <tr>
        <td style="padding: 8px; border: 1px solid #334155;">${idx + 1}</td>
        <td style="padding: 8px; border: 1px solid #334155;">${item.medicineName}</td>
        <td style="padding: 8px; border: 1px solid #334155;">${item.dosage}</td>
        <td style="padding: 8px; border: 1px solid #334155;">${item.frequency}</td>
        <td style="padding: 8px; border: 1px solid #334155;">${item.duration}</td>
        <td style="padding: 8px; border: 1px solid #334155;">${item.notes || "-"}</td>
      </tr>
    `
    )
    .join("");
};

// Helper function to render template
const renderTemplate = (template: any, templateData: Record<string, string>): string => {
  let rendered = template.content;
  
  // Replace template variables (if variables array exists)
  if (template.variables && Array.isArray(template.variables)) {
    template.variables.forEach((variable: any) => {
      const value = templateData[variable.key] || variable.defaultValue || "";
      const regex = new RegExp(`\\{\\{${variable.key}\\}\\}`, "g");
      rendered = rendered.replace(regex, String(value));
    });
  }

  // Replace all common variables
  Object.keys(templateData).forEach((key) => {
    const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
    rendered = rendered.replace(regex, String(templateData[key]));
  });

  // Handle simple conditionals like {{#if notes}}...{{/if}}
  rendered = rendered.replace(/\{\{#if\s+(\w+)\}\}([\s\S]*?)\{\{\/if\}\}/g, (match, key, content) => {
    return templateData[key] ? content : '';
  });

  return rendered;
};

// Helper function to prepare template data
const prepareTemplateData = (
  prescription: IPrescription,
  hospital: any,
  doctor: any,
  patient: any,
  template: any
): Record<string, string> => {
  const medicinesHtml = generateMedicinesHtml(prescription.items);
  const createdAt = getCreatedAt(prescription);

  return {
    hospitalName: hospital?.name || "Hospital Name",
    hospitalAddress: hospital?.address || "",
    hospitalPhone: hospital?.phone || "",
    patientName: patient?.name || "Patient Name",
    patientId: prescription.patientId,
    doctorName: doctor?.name || "Doctor Name",
    doctorId: prescription.doctorId,
    appointmentId: prescription.appointmentId || "",
    prescriptionId: getPrescriptionId(prescription),
    date: createdAt.toLocaleDateString(),
    time: createdAt.toLocaleTimeString(),
    medicines: `
      <table style="width: 100%; border-collapse: collapse; margin-top: 10px;">
        <tr style="background: #1e293b;">
          <th style="padding: 8px; text-align: left; border: 1px solid #334155;">#</th>
          <th style="padding: 8px; text-align: left; border: 1px solid #334155;">Medicine</th>
          <th style="padding: 8px; text-align: left; border: 1px solid #334155;">Dosage</th>
          <th style="padding: 8px; text-align: left; border: 1px solid #334155;">Frequency</th>
          <th style="padding: 8px; text-align: left; border: 1px solid #334155;">Duration</th>
          <th style="padding: 8px; text-align: left; border: 1px solid #334155;">Notes</th>
        </tr>
        ${medicinesHtml}
      </table>
    `,
    notes: prescription.notes || "",
    notesSection: prescription.notes 
      ? `<div class="notes">
          <strong>Additional Notes:</strong>
          <p>${prescription.notes}</p>
        </div>`
      : "",
    footerText: template.footerText || "This is a computer-generated prescription.",
  };
};

// Helper function to fetch related data for template rendering
const fetchTemplateData = async (prescription: IPrescription, hospitalId?: string) => {
  const { User } = await import("../user/user.model");
  const { Hospital } = await import("../master/hospital.model");
  
  const doctor = await User.findById(prescription.doctorId);
  const patient = await User.findById(prescription.patientId);
  
  const appointment = prescription.appointmentId
    ? await import("../appointment/appointment.model").then((m) =>
        m.Appointment.findById(prescription.appointmentId)
      )
    : null;
  
  const hospital = appointment
    ? await Hospital.findById((appointment as any)?.hospitalId || hospitalId)
    : hospitalId
      ? await Hospital.findById(hospitalId)
      : null;

  return { doctor, patient, hospital, appointment };
};

// Create prescription after consultation
router.post(
  "/",
  validateRequired(["appointmentId", "doctorId", "patientId", "items"]),
  async (req: Request, res: Response) => {
    try {
      const { items } = req.body;
      validatePrescriptionItems(items);

      const prescriptionData = {
        ...req.body,
        reportStatus: "PENDING",
      };
      
      const prescription = await Prescription.create(prescriptionData) as IPrescription;
      
      // Auto-link prescription to conversation from appointment
      const { Conversation } = await import("../conversation/conversation.model");
      const conversation = await Conversation.findOne({
        appointmentId: prescription.appointmentId,
        isActive: true,
      });

      if (conversation) {
        conversation.prescriptionId = getPrescriptionId(prescription);
        await conversation.save();
      } else if (req.body.conversationId) {
        await Conversation.findByIdAndUpdate(req.body.conversationId, {
          prescriptionId: getPrescriptionId(prescription),
        });
      }
      
      // Fetch patient name for history
      const { User } = await import("../user/user.model");
      const patient = await User.findById(prescription.patientId);
      const patientName = patient?.name || `Patient ${prescription.patientId.slice(-8)}`;

      // Record in doctor-patient history
      try {
        console.log("📝 Creating doctor-patient history for prescription:", {
          doctorId: prescription.doctorId,
          patientId: prescription.patientId,
          patientName,
          prescriptionId: getPrescriptionId(prescription),
        });
        
        const historyRecord = await createDoctorPatientHistory({
          doctorId: prescription.doctorId,
          patientId: prescription.patientId,
          patientName,
          historyType: "PRESCRIPTION",
          appointmentId: prescription.appointmentId,
          prescriptionId: getPrescriptionId(prescription),
          prescriptionItems: prescription.items,
          prescriptionNotes: prescription.notes || prescription.suggestions,
          metadata: {
            itemCount: prescription.items.length,
            reportStatus: prescription.reportStatus,
          },
        });
        
        console.log("✅ Doctor-patient history created successfully:", historyRecord._id);
      } catch (historyError: any) {
        console.error("❌ Failed to record prescription history:", historyError);
        console.error("Error details:", {
          message: historyError.message,
          stack: historyError.stack,
          name: historyError.name,
        });
        // Don't fail the request if history recording fails
      }

      await createActivity(
        "PRESCRIPTION_CREATED",
        "New Prescription Created",
        `Doctor ${prescription.doctorId} created prescription for Patient ${prescription.patientId}. Available in Patient Portal and Admin Reports.`,
        {
          patientId: prescription.patientId,
          doctorId: prescription.doctorId,
          pharmacyId: prescription.pharmacyId,
          metadata: { 
            prescriptionId: getPrescriptionId(prescription), 
            itemCount: prescription.items.length,
            reportStatus: "PENDING",
          },
        }
      );

      const createdAt = getCreatedAt(prescription);
      socketEvents.emitToUser(prescription.patientId, "prescription:created", {
        prescriptionId: getPrescriptionId(prescription),
        doctorId: prescription.doctorId,
        itemCount: prescription.items.length,
        createdAt,
      });
      socketEvents.emitToAdmin("prescription:created", {
        prescriptionId: getPrescriptionId(prescription),
        patientId: prescription.patientId,
        doctorId: prescription.doctorId,
        reportStatus: "PENDING",
        itemCount: prescription.items.length,
        createdAt,
      });
      
      res.status(201).json(prescription);
    } catch (error: any) {
      handleError(error, res, 500);
    }
  }
);

// Create prescription from voice input (speech-to-text)
router.post("/voice", validateRequired(["appointmentId", "doctorId", "patientId", "voiceText"]), async (req: Request, res: Response) => {
  try {
    const { appointmentId, doctorId, patientId, pharmacyId, voiceText, notes } = req.body;

    const items = parseVoicePrescription(voiceText);

    if (items.length === 0) {
      throw new AppError("Could not parse prescription items from voice text", 400);
    }

    const prescription = await Prescription.create({
      appointmentId,
      doctorId,
      patientId,
      pharmacyId,
      items,
      notes: notes || "Generated from voice input",
    }) as IPrescription;

    await createActivity(
      "PRESCRIPTION_CREATED",
      "Voice Prescription Created",
      `Doctor ${doctorId} created prescription via voice for Patient ${patientId}`,
      {
        patientId,
        doctorId,
        pharmacyId,
        metadata: { prescriptionId: getPrescriptionId(prescription), itemCount: items.length, source: "voice" },
      }
    );

    res.status(201).json(prescription);
  } catch (error: any) {
    handleError(error, res, 500);
  }
});

// Simple voice prescription parser (enhance with NLP in production)
function parseVoicePrescription(voiceText: string): Array<{
  medicineName: string;
  dosage: string;
  frequency: string;
  duration: string;
}> {
  const items: Array<{ medicineName: string; dosage: string; frequency: string; duration: string }> = [];
  
  const lines = voiceText.split(/[.,;]/).filter(line => line.trim().length > 0);
  
  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 5) continue;

    const words = trimmed.split(/\s+/);
    const medicineName = words.find(w => /^[A-Z]/.test(w)) || words[0] || "Medicine";
    
    const dosageMatch = trimmed.match(/(\d+\s*(mg|ml|g|tablet|tab|capsule|cap))/i);
    const dosage = dosageMatch ? dosageMatch[0] : "As directed";
    
    const frequencyMatch = trimmed.match(/(once|twice|thrice|\d+)\s*(daily|day|week|hour)/i);
    const frequency = frequencyMatch ? frequencyMatch[0] : "As needed";
    
    const durationMatch = trimmed.match(/for\s+(\d+\s*(day|week|month|hour)s?)/i);
    const duration = durationMatch ? durationMatch[0] : "As directed";

    items.push({ medicineName, dosage, frequency, duration });
  }

  return items;
}

// Get all prescriptions (with optional filters)
router.get("/", async (req: Request, res: Response) => {
  try {
    const { doctorId, patientId, pharmacyId, appointmentId } = req.query;
    const filter: any = {};
    if (doctorId) filter.doctorId = doctorId;
    if (patientId) filter.patientId = patientId;
    if (pharmacyId) filter.pharmacyId = pharmacyId;
    if (appointmentId) filter.appointmentId = appointmentId;

    const items = await Prescription.find(filter)
      .sort({ createdAt: -1 })
      .limit(100);
    res.json(items);
  } catch (error: any) {
    handleError(error, res, 500);
  }
});

// Get prescriptions for a patient
router.get("/by-patient/:patientId", async (req: Request, res: Response) => {
  try {
    const items = await Prescription.find({ patientId: req.params.patientId })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(items);
  } catch (error: any) {
    handleError(error, res, 500);
  }
});

// Get prescriptions for a pharmacy to fulfill
router.get("/by-pharmacy/:pharmacyId", async (req: Request, res: Response) => {
  try {
    const items = await Prescription.find({ pharmacyId: req.params.pharmacyId })
      .sort({ createdAt: -1 })
      .limit(50);
    res.json(items);
  } catch (error: any) {
    handleError(error, res, 500);
  }
});

// Get prescription by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const prescription = await Prescription.findById(req.params.id);
    if (!prescription) {
      throw new AppError("Prescription not found", 404);
    }
    res.json(prescription);
  } catch (error: any) {
    handleError(error, res, 500);
  }
});

// Update prescription
router.put("/:id", validateRequired(["items"]), async (req: Request, res: Response) => {
  try {
    const { items } = req.body;
    validatePrescriptionItems(items);

    const prescription = await Prescription.findByIdAndUpdate(
      req.params.id,
      { items, ...req.body },
      { new: true, runValidators: true }
    ) as IPrescription | null;

    if (!prescription) {
      throw new AppError("Prescription not found", 404);
    }

    await createActivity(
      "PRESCRIPTION_UPDATED",
      "Prescription Updated",
      `Prescription ${getPrescriptionId(prescription)} was updated`,
      {
        patientId: prescription.patientId,
        doctorId: prescription.doctorId,
        pharmacyId: prescription.pharmacyId,
        metadata: { prescriptionId: getPrescriptionId(prescription), itemCount: prescription.items.length },
      }
    );

    res.json(prescription);
  } catch (error: any) {
    handleError(error, res, 500);
  }
});

// Generate prescription document using template
router.get("/:id/document", async (req: Request, res: Response) => {
  try {
    const { hospitalId } = req.query;
    const prescription = await Prescription.findById(req.params.id) as IPrescription | null;
    if (!prescription) {
      throw new AppError("Prescription not found", 404);
    }

    const { doctor, patient, hospital } = await fetchTemplateData(prescription, hospitalId as string);

    const { Template } = await import("../template/template.model");
    const templateHospitalId = hospital ? String(hospital._id) : (hospitalId as string);
    const template = await Template.findOne({
      type: "PRESCRIPTION",
      isActive: true,
      isDefault: true,
      $or: templateHospitalId
        ? [{ hospitalId: templateHospitalId }, { hospitalId: null }]
        : [{ hospitalId: null }],
    }).sort({ hospitalId: -1 });

    if (!template) {
      return res.status(404).json({ message: "No template found" });
    }

    const templateData = prepareTemplateData(prescription, hospital, doctor, patient, template);
    const rendered = renderTemplate(template, templateData);

    res.json({ rendered, template: template.name, prescriptionId: getPrescriptionId(prescription) });
  } catch (error: any) {
    handleError(error, res, 500);
  }
});

// Generate formatted report (Admin Panel - Reports Section)
router.post("/:id/generate-report", async (req: Request, res: Response) => {
  try {
    const { hospitalId, templateId } = req.body;
    const prescription = await Prescription.findById(req.params.id) as IPrescription | null;
    if (!prescription) {
      throw new AppError("Prescription not found", 404);
    }

    const { doctor, patient, hospital } = await fetchTemplateData(prescription, hospitalId as string);

    const { Template } = await import("../template/template.model");
    
    let template = null;
    
    // If templateId is provided, use that specific template
    if (templateId) {
      template = await Template.findById(templateId);
    }
    
    // If no template found yet, try to find by hospital (prefer default)
    if (!template) {
      const templateHospitalId = hospital ? String(hospital._id) : (hospitalId as string);
      template = await Template.findOne({
        type: "PRESCRIPTION",
        isActive: { $ne: false }, // Allow null/undefined or true
        $or: templateHospitalId
          ? [{ hospitalId: templateHospitalId, isDefault: true }, { hospitalId: templateHospitalId }, { hospitalId: null, isDefault: true }, { hospitalId: null }]
          : [{ hospitalId: null, isDefault: true }, { hospitalId: null }],
      }).sort({ isDefault: -1, hospitalId: -1, createdAt: -1 });
    }
    
    // If still no template, use the first available PRESCRIPTION template
    if (!template) {
      template = await Template.findOne({ 
        type: "PRESCRIPTION",
        isActive: { $ne: false }
      }).sort({ isDefault: -1, createdAt: -1 });
    }

    // If no template exists at all, create a default template automatically
    if (!template) {
      const defaultTemplateContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    body { font-family: Arial, sans-serif; padding: 20px; line-height: 1.6; color: #000; max-width: 800px; margin: 0 auto; }
    .header { text-align: center; margin-bottom: 30px; padding-bottom: 20px; border-bottom: 2px solid #2563eb; }
    .hospital-name { font-size: 24px; font-weight: bold; margin-bottom: 10px; color: #1e40af; }
    .patient-info, .doctor-info { margin-bottom: 20px; background: #f8fafc; padding: 15px; border-radius: 8px; }
    .info-row { margin: 8px 0; }
    .info-label { font-weight: bold; color: #1e40af; display: inline-block; width: 120px; }
    .medicines-table { width: 100%; border-collapse: collapse; margin: 20px 0; }
    .medicines-table th { background: #1e293b; color: white; padding: 12px; text-align: left; border: 1px solid #334155; }
    .medicines-table td { padding: 10px; border: 1px solid #334155; }
    .medicines-table tr:nth-child(even) { background: #f1f5f9; }
    .notes { margin-top: 20px; padding: 15px; background: #fef3c7; border-left: 4px solid #f59e0b; border-radius: 4px; }
    .footer { margin-top: 30px; padding-top: 20px; border-top: 1px solid #e5e7eb; text-align: center; color: #6b7280; font-size: 12px; }
    .date-time { color: #6b7280; font-size: 14px; }
  </style>
</head>
<body>
  <div class="header">
    <div class="hospital-name">{{hospitalName}}</div>
    <div style="color: #6b7280;">{{hospitalAddress}}</div>
    <div style="color: #6b7280;">Phone: {{hospitalPhone}}</div>
  </div>

  <div class="patient-info">
    <h3 style="margin-top: 0; color: #1e40af;">Patient Information</h3>
    <div class="info-row">
      <span class="info-label">Name:</span>
      <span>{{patientName}}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Patient ID:</span>
      <span>{{patientId}}</span>
    </div>
  </div>

  <div class="doctor-info">
    <h3 style="margin-top: 0; color: #1e40af;">Doctor Information</h3>
    <div class="info-row">
      <span class="info-label">Doctor:</span>
      <span>{{doctorName}}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Date:</span>
      <span>{{date}}</span>
    </div>
    <div class="info-row">
      <span class="info-label">Time:</span>
      <span>{{time}}</span>
    </div>
  </div>

  <h3 style="color: #1e40af; margin-top: 30px;">Prescribed Medicines</h3>
  {{medicines}}

  {{notesSection}}

  <div class="footer">
    <p>{{footerText}}</p>
    <p class="date-time">Prescription ID: {{prescriptionId}} | Generated on {{date}} at {{time}}</p>
  </div>
</body>
</html>`;

      template = await Template.create({
        name: "Default Prescription Template",
        type: "PRESCRIPTION",
        hospitalId: null,
        content: defaultTemplateContent,
        variables: [
          { key: "hospitalName", label: "Hospital Name", required: true },
          { key: "hospitalAddress", label: "Hospital Address", required: false },
          { key: "hospitalPhone", label: "Hospital Phone", required: false },
          { key: "patientName", label: "Patient Name", required: true },
          { key: "patientId", label: "Patient ID", required: true },
          { key: "doctorName", label: "Doctor Name", required: true },
          { key: "date", label: "Date", required: true },
          { key: "time", label: "Time", required: true },
          { key: "medicines", label: "Medicines Table", required: true },
          { key: "notes", label: "Additional Notes", required: false },
          { key: "prescriptionId", label: "Prescription ID", required: true },
          { key: "footerText", label: "Footer Text", required: false },
        ],
        isActive: true,
        isDefault: true,
        footerText: "This is a computer-generated prescription. Please consult your doctor for any concerns.",
      });
    }

    const templateData = prepareTemplateData(prescription, hospital, doctor, patient, template);
    const rendered = renderTemplate(template, templateData);

    prescription.formattedReport = rendered;
    prescription.reportStatus = "FORMATTED";
    prescription.formattedAt = new Date();
    await prescription.save();

    await createActivity(
      "PRESCRIPTION_FORMATTED",
      "Prescription Report Generated",
      `Admin generated formatted report for prescription ${getPrescriptionId(prescription)}`,
      {
        patientId: prescription.patientId,
        doctorId: prescription.doctorId,
        metadata: { prescriptionId: getPrescriptionId(prescription) },
      }
    );

    socketEvents.emitToAdmin("prescription:formatted", {
      prescriptionId: getPrescriptionId(prescription),
      patientId: prescription.patientId,
      doctorId: prescription.doctorId,
      reportStatus: prescription.reportStatus,
    });

    res.json({ 
      rendered, 
      template: template.name, 
      prescriptionId: getPrescriptionId(prescription),
      reportStatus: prescription.reportStatus 
    });
  } catch (error: any) {
    handleError(error, res, 500);
  }
});

// Delete prescription (Admin only)
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const prescription = await Prescription.findById(req.params.id) as IPrescription | null;
    if (!prescription) {
      throw new AppError("Prescription not found", 404);
    }

    await Prescription.findByIdAndDelete(req.params.id);

    await createActivity(
      "PRESCRIPTION_DELETED",
      "Prescription Deleted",
      `Admin deleted prescription ${getPrescriptionId(prescription)}`,
      {
        patientId: prescription.patientId,
        doctorId: prescription.doctorId,
        metadata: { prescriptionId: getPrescriptionId(prescription) },
      }
    );

    socketEvents.emitToAdmin("prescription:deleted", {
      prescriptionId: getPrescriptionId(prescription),
      patientId: prescription.patientId,
      doctorId: prescription.doctorId,
    });

    res.json({ message: "Prescription deleted successfully" });
  } catch (error: any) {
    handleError(error, res, 500);
  }
});

// Finalize report (Admin Panel - Send to Patient)
router.post("/:id/finalize-report", async (req: Request, res: Response) => {
  try {
    const prescription = await Prescription.findById(req.params.id) as IPrescription | null;
    if (!prescription) {
      throw new AppError("Prescription not found", 404);
    }

    if (prescription.reportStatus !== "FORMATTED") {
      throw new AppError("Report must be formatted before finalizing", 400);
    }

    prescription.reportStatus = "FINALIZED";
    prescription.finalizedAt = new Date();
    prescription.finalizedBy = req.body.adminId || (req as any).user?.sub || "admin";
    await prescription.save();

    await createActivity(
      "PRESCRIPTION_FINALIZED",
      "Prescription Report Finalized",
      `Admin finalized report for prescription ${getPrescriptionId(prescription)}. Now available to patient.`,
      {
        patientId: prescription.patientId,
        doctorId: prescription.doctorId,
        metadata: { prescriptionId: getPrescriptionId(prescription) },
      }
    );

    socketEvents.emitToUser(prescription.patientId, "prescription:finalized", {
      prescriptionId: getPrescriptionId(prescription),
      doctorId: prescription.doctorId,
      finalizedAt: prescription.finalizedAt,
    });
    socketEvents.emitToAdmin("prescription:finalized", {
      prescriptionId: getPrescriptionId(prescription),
      patientId: prescription.patientId,
      doctorId: prescription.doctorId,
    });

    res.json({ 
      prescription, 
      message: "Report finalized and sent to patient portal" 
    });
  } catch (error: any) {
    handleError(error, res, 500);
  }
});

// Get all prescriptions for admin reports section
router.get("/admin/reports", async (req: Request, res: Response) => {
  try {
    const { status, page = 1, limit = 50 } = req.query;
    const filter: any = {};
    
    if (status) {
      filter.reportStatus = status;
    }

    const skip = (Number(page) - 1) * Number(limit);
    
    const { User } = await import("../user/user.model");
    const prescriptions = await Prescription.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(Number(limit))
      .lean();

    const populatedPrescriptions = await Promise.all(
      prescriptions.map(async (prescription: any) => {
        const doctor = await User.findById(prescription.doctorId);
        const patient = await User.findById(prescription.patientId);
        return {
          ...prescription,
          doctorId: doctor ? { _id: String(doctor._id), name: doctor.name, email: doctor.email } : prescription.doctorId,
          patientId: patient ? { _id: String(patient._id), name: patient.name, email: patient.email } : prescription.patientId,
        };
      })
    );

    const total = await Prescription.countDocuments(filter);

    res.json({
      prescriptions: populatedPrescriptions,
      total,
      page: Number(page),
      limit: Number(limit),
      totalPages: Math.ceil(total / Number(limit)),
    });
  } catch (error: any) {
    handleError(error, res, 500);
  }
});

// Get finalized reports for patient
router.get("/patient/reports/:patientId", async (req: Request, res: Response) => {
  try {
    const prescriptions = await Prescription.find({
      patientId: req.params.patientId,
      reportStatus: "FINALIZED",
    })
      .sort({ finalizedAt: -1 })
      .populate("doctorId", "name email")
      .populate("appointmentId");

    res.json(prescriptions);
  } catch (error: any) {
    handleError(error, res, 500);
  }
});
