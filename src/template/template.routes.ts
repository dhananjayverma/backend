import { Router, Request, Response } from "express";
import { Template, ITemplate } from "./template.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";
import { validateRequest } from "../shared/middleware/validation";
import { body } from "express-validator";
import { AppError } from "../shared/middleware/errorHandler";

export const router = Router();

// Get all templates
router.get(
  "/",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN", "DOCTOR", "PHARMACY_STAFF", "PATIENT"]),
  async (req: Request, res: Response) => {
    try {
      const { type, hospitalId } = req.query;
      const filter: any = { isActive: true };
      if (type) filter.type = type;
      if (hospitalId) {
        filter.$or = [{ hospitalId }, { hospitalId: null }];
      } else {
        filter.hospitalId = null;
      }

      const templates = await Template.find(filter).sort({ isDefault: -1, createdAt: -1 });
      res.json(templates);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Get default template for a type (accessible to all authenticated users including patients)
router.get(
  "/default/:type",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const { hospitalId } = req.query;
      const filter: any = {
        type: req.params.type,
        isActive: true,
        isDefault: true,
      };

      if (hospitalId) {
        const hospitalTemplate = await Template.findOne({ ...filter, hospitalId });
        if (hospitalTemplate) {
          return res.json(hospitalTemplate);
        }
      }

      const globalTemplate = await Template.findOne({ ...filter, hospitalId: null });
      if (!globalTemplate) {
        return res.status(404).json({ message: "No default template found" });
      }

      res.json(globalTemplate);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Create template
router.post(
  "/",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  [
    body("name").notEmpty().withMessage("Template name is required"),
    body("type").isIn(["PRESCRIPTION", "BILL", "REPORT", "APPOINTMENT_LETTER"]).withMessage("Invalid template type"),
    body("content").notEmpty().withMessage("Template content is required"),
  ],
  validateRequest,
  async (req: Request, res: Response) => {
    try {
      const { name, type, hospitalId, content, variables, headerImageUrl, footerText, isDefault } = req.body;

      if (isDefault) {
        await Template.updateMany(
          { type, hospitalId: hospitalId || null, isDefault: true },
          { isDefault: false }
        );
      }

      const template = await Template.create({
        name,
        type,
        hospitalId: hospitalId || null,
        content,
        variables: variables || [],
        headerImageUrl,
        footerText,
        isDefault: isDefault || false,
        isActive: true,
      }) as ITemplate;

      res.status(201).json(template);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Update template
router.patch(
  "/:id",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const { name, content, variables, headerImageUrl, footerText, isActive, isDefault } = req.body;
      const template = await Template.findById(req.params.id) as ITemplate | null;

      if (!template) {
        throw new AppError("Template not found", 404);
      }

      if (isDefault && !template.isDefault) {
        await Template.updateMany(
          { type: template.type, hospitalId: template.hospitalId, isDefault: true },
          { isDefault: false }
        );
      }

      const updateData: any = {};
      if (name !== undefined) updateData.name = name;
      if (content !== undefined) updateData.content = content;
      if (variables !== undefined) updateData.variables = variables;
      if (headerImageUrl !== undefined) updateData.headerImageUrl = headerImageUrl;
      if (footerText !== undefined) updateData.footerText = footerText;
      if (isActive !== undefined) updateData.isActive = isActive;
      if (isDefault !== undefined) updateData.isDefault = isDefault;

      const updated = await Template.findByIdAndUpdate(req.params.id, updateData, { new: true });
      res.json(updated);
    } catch (error: any) {
      if (error instanceof AppError) {
        res.status(error.status).json({ message: error.message });
      } else {
        res.status(400).json({ message: error.message });
      }
    }
  }
);

// Delete template
router.delete(
  "/:id",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req: Request, res: Response) => {
    try {
      const templateId = req.params.id;
      const template = await Template.findById(templateId) as ITemplate | null;
      if (!template) {
        throw new AppError("Template not found", 404);
      }

      const deleteResult = await Template.deleteOne({ _id: template._id });
      
      if (deleteResult.deletedCount === 0) {
        throw new AppError("Failed to delete template", 500);
      }

      res.json({ message: "Template deleted successfully" });
    } catch (error: any) {
      if (error instanceof AppError) {
        res.status(error.status).json({ message: error.message });
      } else {
        res.status(400).json({ message: error.message || "Failed to delete template" });
      }
    }
  }
);

// Render template with data
router.post(
  "/:id/render",
  requireAuth,
  async (req: Request, res: Response) => {
    try {
      const template = await Template.findById(req.params.id) as ITemplate | null;
      if (!template) {
        throw new AppError("Template not found", 404);
      }

      const { data } = req.body;
      let rendered = template.content;

      template.variables.forEach((variable) => {
        const value = data[variable.key] || variable.defaultValue || "";
        const regex = new RegExp(`\\{\\{${variable.key}\\}\\}`, "g");
        rendered = rendered.replace(regex, String(value));
      });

      const commonVars: Record<string, string> = {
        hospitalName: data.hospitalName || "",
        doctorName: data.doctorName || "",
        patientName: data.patientName || "",
        date: data.date || new Date().toLocaleDateString(),
        time: data.time || new Date().toLocaleTimeString(),
        ...data,
      };

      Object.keys(commonVars).forEach((key) => {
        const regex = new RegExp(`\\{\\{${key}\\}\\}`, "g");
        rendered = rendered.replace(regex, String(commonVars[key]));
      });

      res.json({ rendered, template });
    } catch (error: any) {
      if (error instanceof AppError) {
        res.status(error.status).json({ message: error.message });
      } else {
        res.status(400).json({ message: error.message });
      }
    }
  }
);
