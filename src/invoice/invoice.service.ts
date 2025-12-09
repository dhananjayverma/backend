import PDFDocument from "pdfkit";
import { IOrder } from "../order/order.model";
import { IDistributorOrder } from "../distributor/distributorOrder.model";

interface PharmacyInfo {
  name?: string;
  address?: string;
  phone?: string;
  email?: string;
}

interface PatientInfo {
  name?: string;
  email?: string;
  phone?: string;
  address?: string;
}

interface DistributorInfo {
  name?: string;
  address?: string;
  phone?: string;
}

/**
 * Generate PDF invoice for patient order - Single A4 page
 */
export async function generateOrderInvoicePDF(
  order: IOrder,
  pharmacyInfo?: PharmacyInfo,
  patientInfo?: PatientInfo
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: 40, 
        size: "A4",
        autoFirstPage: true
      });
      const buffers: Buffer[] = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", reject);

      // Prevent automatic page breaks
      doc.page.margins = { top: 40, bottom: 40, left: 40, right: 40 };

      // Header with colored background
      doc
        .rect(0, 0, 595.28, 80)
        .fill("#1e3a8a");

      doc
        .fontSize(28)
        .font("Helvetica-Bold")
        .fillColor("#ffffff")
        .text("INVOICE", 40, 30, { align: "center", width: 515.28 });

      // Invoice details in header
      const invoiceNumber = `INV-${String(order._id).slice(-8).toUpperCase()}-${new Date().getFullYear()}`;
      const invoiceDate = new Date(order.createdAt || Date.now()).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor("#ffffff")
        .text(`Invoice #: ${invoiceNumber}`, 40, 50, { width: 200 })
        .text(`Date: ${invoiceDate}`, 355.28, 50, { width: 200, align: "right" });

      // From and To sections - Compact side by side
      let yPos = 100;
      
      // From section (Left)
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor("#1e3a8a")
        .text("FROM", 40, yPos);
      
      yPos += 18;
      if (pharmacyInfo) {
        doc
          .fontSize(10)
          .font("Helvetica-Bold")
          .fillColor("#000000")
          .text(pharmacyInfo.name || "Pharmacy", 40, yPos);
        yPos += 14;
        
        doc
          .fontSize(9)
          .font("Helvetica")
          .fillColor("#333333");
        
        if (pharmacyInfo.address) {
          doc.text(pharmacyInfo.address, 40, yPos, { width: 240 });
          yPos += 12;
        }
        if (pharmacyInfo.phone) {
          doc.text(`Phone: ${pharmacyInfo.phone}`, 40, yPos);
          yPos += 12;
        }
        if (pharmacyInfo.email) {
          doc.text(`Email: ${pharmacyInfo.email}`, 40, yPos);
        }
      }

      // Bill To section (Right)
      yPos = 100;
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor("#1e3a8a")
        .text("BILL TO", 315, yPos);
      
      yPos += 18;
      if (patientInfo) {
        doc
          .fontSize(10)
          .font("Helvetica-Bold")
          .fillColor("#000000")
          .text(patientInfo.name || "Patient", 315, yPos);
        yPos += 14;
        
        doc
          .fontSize(9)
          .font("Helvetica")
          .fillColor("#333333");
        
        if (patientInfo.address) {
          doc.text(patientInfo.address, 315, yPos, { width: 240 });
          yPos += 12;
        }
        if (patientInfo.phone) {
          doc.text(`Phone: ${patientInfo.phone}`, 315, yPos);
          yPos += 12;
        }
        if (patientInfo.email) {
          doc.text(`Email: ${patientInfo.email}`, 315, yPos);
        }
      }

      // Items Table - Compact
      yPos = 200;
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor("#1e3a8a")
        .text("ITEMS", 40, yPos);

      // Table Header with background
      yPos += 20;
      doc
        .rect(40, yPos - 5, 515.28, 20)
        .fill("#f3f4f6");
      
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("Medicine Name", 45, yPos)
        .text("Qty", 320, yPos)
        .text("Unit Price", 370, yPos)
        .text("Total", 480, yPos, { align: "right" });

      // Table items
      yPos += 25;
      let subtotal = 0;
      const totalQuantity = order.items.reduce((sum, item) => sum + item.quantity, 0);
      const unitPrice = order.totalAmount && totalQuantity > 0
        ? (order.totalAmount - (order.deliveryCharge || 0)) / totalQuantity
        : 0;

      order.items.forEach((item, index) => {
        const itemTotal = unitPrice * item.quantity;
        subtotal += itemTotal;

        // Alternate row colors
        if (index % 2 === 0) {
          doc
            .rect(40, yPos - 3, 515.28, 18)
            .fill("#fafafa");
        }

        doc
          .fontSize(9)
          .font("Helvetica")
          .fillColor("#000000")
          .text(item.medicineName, 45, yPos, { width: 260 })
          .text(String(item.quantity), 320, yPos)
          .text(`₹${unitPrice.toFixed(2)}`, 370, yPos)
          .text(`₹${itemTotal.toFixed(2)}`, 480, yPos, { align: "right", width: 70 });

        yPos += 18;
      });

      // Totals section - Right aligned
      yPos += 10;
      const totalsStartY = yPos;
      
      doc
        .moveTo(300, yPos)
        .lineTo(555.28, yPos)
        .stroke("#cccccc");

      yPos += 15;
      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor("#333333")
        .text("Subtotal:", 400, yPos)
        .text(`₹${subtotal.toFixed(2)}`, 480, yPos, { align: "right", width: 70 });

      if (order.deliveryCharge && order.deliveryCharge > 0) {
        yPos += 15;
        doc
          .text("Delivery Charge:", 400, yPos)
          .text(`₹${order.deliveryCharge.toFixed(2)}`, 480, yPos, { align: "right", width: 70 });
      }

      yPos += 15;
      doc
        .moveTo(300, yPos)
        .lineTo(555.28, yPos)
        .stroke("#1e3a8a");

      yPos += 15;
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#1e3a8a")
        .text("Total Amount:", 400, yPos)
        .text(`₹${(order.totalAmount || 0).toFixed(2)}`, 480, yPos, { align: "right", width: 70 });

      // Order Details - Compact at bottom
      yPos = totalsStartY + 80;
      if (yPos > 700) yPos = 700; // Ensure it fits on page

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor("#1e3a8a")
        .text("Order Information", 40, yPos);

      yPos += 15;
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("#666666")
        .text(`Order #: ${String(order._id).slice(-8)}`, 40, yPos)
        .text(`Status: ${order.status}`, 200, yPos)
        .text(`Type: ${order.deliveryType}`, 320, yPos);

      if (order.deliveredAt) {
        yPos += 12;
        const deliveredDate = new Date(order.deliveredAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
        doc.text(`Delivered: ${deliveredDate}`, 40, yPos);
      }

      // Footer
      doc
        .fontSize(7)
        .font("Helvetica")
        .fillColor("#999999")
        .text(
          "Thank you for your business! This is a computer-generated invoice.",
          40,
          800,
          { align: "center", width: 515.28 }
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}

/**
 * Generate PDF invoice for distributor order - Single A4 page
 */
export async function generateDistributorInvoicePDF(
  order: IDistributorOrder,
  pharmacyInfo?: PharmacyInfo,
  distributorInfo?: DistributorInfo
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    try {
      const doc = new PDFDocument({ 
        margin: 40, 
        size: "A4",
        autoFirstPage: true
      });
      const buffers: Buffer[] = [];

      doc.on("data", buffers.push.bind(buffers));
      doc.on("end", () => {
        const pdfBuffer = Buffer.concat(buffers);
        resolve(pdfBuffer);
      });
      doc.on("error", reject);

      // Prevent automatic page breaks
      doc.page.margins = { top: 40, bottom: 40, left: 40, right: 40 };

      // Header with colored background
      doc
        .rect(0, 0, 595.28, 80)
        .fill("#1e3a8a");

      doc
        .fontSize(28)
        .font("Helvetica-Bold")
        .fillColor("#ffffff")
        .text("INVOICE", 40, 30, { align: "center", width: 515.28 });

      // Invoice details in header
      const invoiceNumber = `INV-${String(order._id).slice(-8).toUpperCase()}-${new Date().getFullYear()}`;
      const invoiceDate = new Date(order.createdAt || Date.now()).toLocaleDateString("en-US", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });

      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor("#ffffff")
        .text(`Invoice #: ${invoiceNumber}`, 40, 50, { width: 200 })
        .text(`Date: ${invoiceDate}`, 355.28, 50, { width: 200, align: "right" });

      // From and To sections - Compact side by side
      let yPos = 100;
      
      // From section (Left) - Distributor
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor("#1e3a8a")
        .text("FROM", 40, yPos);
      
      yPos += 18;
      if (distributorInfo) {
        doc
          .fontSize(10)
          .font("Helvetica-Bold")
          .fillColor("#000000")
          .text(distributorInfo.name || "Distributor", 40, yPos);
        yPos += 14;
        
        doc
          .fontSize(9)
          .font("Helvetica")
          .fillColor("#333333");
        
        if (distributorInfo.address) {
          doc.text(distributorInfo.address, 40, yPos, { width: 240 });
          yPos += 12;
        }
        if (distributorInfo.phone) {
          doc.text(`Phone: ${distributorInfo.phone}`, 40, yPos);
        }
      }

      // Bill To section (Right) - Pharmacy
      yPos = 100;
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor("#1e3a8a")
        .text("BILL TO", 315, yPos);
      
      yPos += 18;
      if (pharmacyInfo) {
        doc
          .fontSize(10)
          .font("Helvetica-Bold")
          .fillColor("#000000")
          .text(pharmacyInfo.name || "Pharmacy", 315, yPos);
        yPos += 14;
        
        doc
          .fontSize(9)
          .font("Helvetica")
          .fillColor("#333333");
        
        if (pharmacyInfo.address) {
          doc.text(pharmacyInfo.address, 315, yPos, { width: 240 });
          yPos += 12;
        }
        if (pharmacyInfo.phone) {
          doc.text(`Phone: ${pharmacyInfo.phone}`, 315, yPos);
        }
      }

      // Items Table - Compact
      yPos = 200;
      doc
        .fontSize(11)
        .font("Helvetica-Bold")
        .fillColor("#1e3a8a")
        .text("ITEMS", 40, yPos);

      // Table Header with background
      yPos += 20;
      doc
        .rect(40, yPos - 5, 515.28, 20)
        .fill("#f3f4f6");
      
      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor("#000000")
        .text("Medicine Name", 45, yPos)
        .text("Qty", 320, yPos)
        .text("Unit Price", 370, yPos)
        .text("Total", 480, yPos, { align: "right" });

      // Table item
      yPos += 25;
      const unitPrice = 100; // Base price - should come from inventory
      const itemTotal = unitPrice * order.quantity;
      const tax = itemTotal * 0.18; // 18% GST
      const totalAmount = itemTotal + tax;

      doc
        .rect(40, yPos - 3, 515.28, 18)
        .fill("#fafafa");

      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor("#000000")
        .text(order.medicineName, 45, yPos, { width: 260 })
        .text(`${order.quantity} units`, 320, yPos)
        .text(`₹${unitPrice.toFixed(2)}`, 370, yPos)
        .text(`₹${itemTotal.toFixed(2)}`, 480, yPos, { align: "right", width: 70 });

      // Totals section - Right aligned
      yPos += 30;
      const totalsStartY = yPos;
      
      doc
        .moveTo(300, yPos)
        .lineTo(555.28, yPos)
        .stroke("#cccccc");

      yPos += 15;
      doc
        .fontSize(9)
        .font("Helvetica")
        .fillColor("#333333")
        .text("Subtotal:", 400, yPos)
        .text(`₹${itemTotal.toFixed(2)}`, 480, yPos, { align: "right", width: 70 });

      yPos += 15;
      doc
        .text("GST (18%):", 400, yPos)
        .text(`₹${tax.toFixed(2)}`, 480, yPos, { align: "right", width: 70 });

      yPos += 15;
      doc
        .moveTo(300, yPos)
        .lineTo(555.28, yPos)
        .stroke("#1e3a8a");

      yPos += 15;
      doc
        .fontSize(12)
        .font("Helvetica-Bold")
        .fillColor("#1e3a8a")
        .text("Total Amount:", 400, yPos)
        .text(`₹${totalAmount.toFixed(2)}`, 480, yPos, { align: "right", width: 70 });

      // Order Details - Compact at bottom
      yPos = totalsStartY + 80;
      if (yPos > 700) yPos = 700; // Ensure it fits on page

      doc
        .fontSize(9)
        .font("Helvetica-Bold")
        .fillColor("#1e3a8a")
        .text("Order Information", 40, yPos);

      yPos += 15;
      doc
        .fontSize(8)
        .font("Helvetica")
        .fillColor("#666666")
        .text(`Order #: ${String(order._id).slice(-8)}`, 40, yPos)
        .text(`Status: ${order.status}`, 200, yPos);

      if (order.deliveredAt) {
        yPos += 12;
        const deliveredDate = new Date(order.deliveredAt).toLocaleDateString("en-US", {
          year: "numeric",
          month: "short",
          day: "numeric",
        });
        doc.text(`Delivered: ${deliveredDate}`, 40, yPos);
      }

      // Footer
      doc
        .fontSize(7)
        .font("Helvetica")
        .fillColor("#999999")
        .text(
          "Thank you for your business! This is a computer-generated invoice.",
          40,
          800,
          { align: "center", width: 515.28 }
        );

      doc.end();
    } catch (error) {
      reject(error);
    }
  });
}
