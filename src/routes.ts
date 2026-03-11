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
import { router as otpRouter } from "./user/otp.routes";
import { router as transcriptionRouter } from "./transcription/transcription.routes";
import { router as invoiceRouter } from "./invoice/invoice.routes";
import { router as pharmacyInvoiceRouter } from "./invoice/pharmacyInvoice.routes";
import { router as auditRouter } from "./audit/audit.routes";
import { router as inventorySearchRouter } from "./inventory/inventory-search.routes";
import { router as pharmacyReportsRouter } from "./reports/pharmacyReports.routes";
import { router as medicineSearchRouter } from "./public/medicineSearch.routes";
import { router as productsRouter } from "./public/products.routes";
import { router as uploadRouter } from "./public/upload.routes";
import { router as infrastructureRouter } from "./infrastructure/infrastructure.routes";
import { router as ipAdmissionRouter } from "./patient/ipAdmission.routes";
import { router as opRegistrationRouter } from "./patient/opRegistration.routes";
import { router as serviceRegistrationRouter } from "./patient/serviceRegistration.routes";
import { router as billingRouter } from "./billing/billing.routes";
import { router as dischargeRouter } from "./discharge/discharge.routes";
import { router as nurseRouter } from "./nurse/nurse.routes";
import { router as hospitalServicesRouter } from "./hospitalServices/hospitalServices.routes";
import { router as certificateRouter } from "./certificates/certificate.routes";
import { router as hospitalReportsRouter } from "./reports/hospitalReports.routes";
import { router as vitalsRouter } from "./vitals/vitals.routes";
import { router as medicationRouter } from "./medications/medication.routes";
import { router as nurseAlertRouter } from "./nurseAlerts/nurseAlert.routes";

export function registerRoutes(app: Express) {
  // Root route - API information
  app.get("/", (_req, res) => {
    res.json({
      message: "Hospital Ecosystem API",
      version: "1.0.0",
      status: "running",
      endpoints: {
        health: "/api/health",
        public: "/api/public",
        api: "/api",
      },
    });
  });

  // Public API routes (no authentication required)
  app.use("/api/public", publicRouter);
  app.use("/api/public/medicine", medicineSearchRouter);
  app.use("/api/public/products", productsRouter);
  app.use("/api/public/upload", uploadRouter);
  
  // Protected API routes (authentication required)
  app.use("/api/users", userRouter);
  app.use("/api/users/mfa", mfaRouter);
  app.use("/api/users/otp", otpRouter);
  app.use("/api/transcription", transcriptionRouter);
  app.use("/api/appointments", appointmentRouter);
  app.use("/api/prescriptions", prescriptionRouter);
  // Mount inventory search routes FIRST so /search, /brands-by-composition, /expiry-risk are matched before /:id
  app.use("/api/inventory", inventorySearchRouter);
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
  app.use("/api/pharmacy-invoices", pharmacyInvoiceRouter);
  app.use("/api/audits", auditRouter);
  app.use("/api/reports/pharmacy", pharmacyReportsRouter);

  // New HSP Extension routes
  app.use("/api/infrastructure", infrastructureRouter);
  app.use("/api/ip-admissions", ipAdmissionRouter);
  app.use("/api/op-registrations", opRegistrationRouter);
  app.use("/api/service-registrations", serviceRegistrationRouter);
  app.use("/api/bills", billingRouter);
  app.use("/api/discharges", dischargeRouter);
  app.use("/api/nurse", nurseRouter);
  app.use("/api/hospital-services", hospitalServicesRouter);
  app.use("/api/certificates", certificateRouter);
  app.use("/api/reports/hospital", hospitalReportsRouter);
  app.use("/api/vitals", vitalsRouter);
  app.use("/api/medications", medicationRouter);
  app.use("/api/nurse/alerts", nurseAlertRouter);

  app.get("/api/health", (_req, res) => {
    res.json({ status: "ok" });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", message: "Server is running" });
  });
}


