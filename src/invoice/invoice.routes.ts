import { Router } from "express";
import { requireAuth } from "../shared/middleware/auth";
import { Order } from "../order/order.model";
import { DistributorOrder } from "../distributor/distributorOrder.model";
import { generateOrderInvoicePDF, generateDistributorInvoicePDF } from "./invoice.service";
import { Pharmacy } from "../master/pharmacy.model";
import { User } from "../user/user.model";

export const router = Router();

// Generate PDF invoice for patient order
router.get(
  "/order/:orderId",
  requireAuth,
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const order = await Order.findById(orderId);

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Check authorization
      const userId = req.user!.sub;
      const userRole = req.user!.role;
      const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";
      const isPharmacyStaff = userRole === "PHARMACY_STAFF";

      if (!isAdmin && !isPharmacyStaff && String(order.patientId) !== String(userId)) {
        return res.status(403).json({ message: "You can only view invoices for your own orders" });
      }

      // Get pharmacy info
      let pharmacyInfo;
      try {
        const pharmacy = await Pharmacy.findById(order.pharmacyId);
        if (pharmacy) {
          pharmacyInfo = {
            name: pharmacy.name,
            address: pharmacy.address,
            phone: pharmacy.phone,
            email: pharmacy.email,
          };
        }
      } catch (e) {
        // Silently fail
      }

      // Get patient info
      let patientInfo;
      try {
        const patient = await User.findById(order.patientId);
        if (patient) {
          patientInfo = {
            name: patient.name,
            email: patient.email,
            phone: patient.phone,
            address: order.deliveryAddress || order.address,
          };
        }
      } catch (e) {
        // Silently fail
      }

      // Generate PDF
      const pdfBuffer = await generateOrderInvoicePDF(order, pharmacyInfo, patientInfo);

      // Set response headers
      const invoiceNumber = `INV-${String(order._id).slice(-8).toUpperCase()}-${new Date().getFullYear()}`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoiceNumber}.pdf"`);
      res.setHeader("Content-Length", pdfBuffer.length);

      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("Error generating order invoice PDF:", error);
      res.status(500).json({ message: "Failed to generate invoice", error: error.message });
    }
  }
);

// Generate PDF invoice for distributor order
router.get(
  "/distributor-order/:orderId",
  requireAuth,
  async (req, res) => {
    try {
      const { orderId } = req.params;
      const order = await DistributorOrder.findById(orderId);

      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Check authorization - only distributor, pharmacy, or admin can view
      const userId = req.user!.sub;
      const userRole = req.user!.role;
      const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";

      if (!isAdmin && String(order.distributorId) !== String(userId) && String(order.pharmacyId) !== String(userId)) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Get pharmacy info
      let pharmacyInfo;
      try {
        const pharmacy = await Pharmacy.findById(order.pharmacyId);
        if (pharmacy) {
          pharmacyInfo = {
            name: pharmacy.name,
            address: pharmacy.address,
            phone: pharmacy.phone,
            email: pharmacy.email,
          };
        }
      } catch (e) {
        // Silently fail
      }

      // Get distributor info
      let distributorInfo;
      try {
        const distributor = await User.findById(order.distributorId);
        if (distributor) {
          distributorInfo = {
            name: distributor.name,
            address: distributor.address,
            phone: distributor.phone,
          };
        }
      } catch (e) {
        // Silently fail
      }

      // Generate PDF
      const pdfBuffer = await generateDistributorInvoicePDF(order, pharmacyInfo, distributorInfo);

      // Set response headers
      const invoiceNumber = `INV-${String(order._id).slice(-8).toUpperCase()}-${new Date().getFullYear()}`;
      res.setHeader("Content-Type", "application/pdf");
      res.setHeader("Content-Disposition", `attachment; filename="invoice-${invoiceNumber}.pdf"`);
      res.setHeader("Content-Length", pdfBuffer.length);

      res.send(pdfBuffer);
    } catch (error: any) {
      console.error("Error generating distributor invoice PDF:", error);
      res.status(500).json({ message: "Failed to generate invoice", error: error.message });
    }
  }
);

