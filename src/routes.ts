import { Express } from "express";
import { router as userRouter } from "./user/user.routes";
import { router as appointmentRouter } from "./appointment/appointment.routes";
import { router as prescriptionRouter } from "./prescription/prescription.routes";
import { router as inventoryRouter } from "./inventory/inventory.routes";
import { router as distributorOrderRouter } from "./distributor/distributorOrder.routes";
import { router as financeRouter } from "./finance/finance.routes";
import { router as masterRouter } from "./master/master.routes";
import { router as orderRouter } from "./order/order.routes";
import { router as notificationRouter } from "./notifications/notification.routes";
import { router as patientRecordRouter } from "./patient/patientRecord.routes";
import { router as activityRouter } from "./activity/activity.routes";
import { router as pricingRouter } from "./pricing/pricing.routes";
import { router as conversationRouter } from "./conversation/conversation.routes";
import { router as templateRouter } from "./template/template.routes";
import { router as publicRouter } from "./public/public.routes";
import { router as reportRequestRouter } from "./reportRequest/reportRequest.routes";
import { router as settingsRouter } from "./settings/settings.routes";
import doctorHistoryRouter from "./doctorHistory/doctorHistory.routes";
import patientHistoryRouter from "./patientHistory/patientHistory.routes";
import doctorRecordRouter from "./doctor/doctorRecord.routes";
import { router as scheduleRouter } from "./schedule/schedule.routes";
import { router as mfaRouter } from "./user/mfa.routes";
import { router as transcriptionRouter } from "./transcription/transcription.routes";
import { router as invoiceRouter } from "./invoice/invoice.routes";

export function registerRoutes(app: Express) {
  // Public API routes (no authentication required)
  app.use("/api/public", publicRouter);
  
  // Protected API routes (authentication required)
  app.use("/api/users", userRouter);
  app.use("/api/users/mfa", mfaRouter);
  app.use("/api/transcription", transcriptionRouter);
  app.use("/api/appointments", appointmentRouter);
  app.use("/api/prescriptions", prescriptionRouter);
  app.use("/api/inventory", inventoryRouter);
  app.use("/api/distributor-orders", distributorOrderRouter);
  app.use("/api/finance", financeRouter);
  app.use("/api/master", masterRouter);
  app.use("/api/orders", orderRouter);
  app.use("/api/notifications", notificationRouter);
  app.use("/api/patient-records", patientRecordRouter);
  app.use("/api/activities", activityRouter);
  app.use("/api/pricing", pricingRouter);
  app.use("/api/conversations", conversationRouter);
  app.use("/api/templates", templateRouter);
  app.use("/api/report-requests", reportRequestRouter);
  app.use("/api/settings", settingsRouter);
  app.use("/api/doctor-history", doctorHistoryRouter);
  app.use("/api/patient-history", patientHistoryRouter);
  app.use("/api/doctor-records", doctorRecordRouter);
  app.use("/api/schedules", scheduleRouter);
  app.use("/api/invoices", invoiceRouter);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });
}


