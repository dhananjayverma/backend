import { Router } from "express";
import { Order, IOrder } from "./order.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";
import { createActivity } from "../activity/activity.service";
import { socketEvents } from "../socket/socket.server";
import { FinanceEntry } from "../finance/finance.model";

export const router = Router();

// Helper function to get order ID as string
const getOrderId = (order: IOrder): string => String(order._id);

// Helper function to get short order ID (last 8 chars)
const getShortOrderId = (order: IOrder): string => String(order._id).slice(-8);

// Helper function to emit order status update events
const emitOrderStatusUpdate = (order: IOrder, status: string, additionalData?: any) => {
  const orderId = getOrderId(order);
  const baseData = {
    orderId,
    status,
    pharmacyId: order.pharmacyId,
    ...additionalData,
  };

  socketEvents.emitToUser(order.patientId, "order:statusUpdated", baseData);
  socketEvents.emitToAdmin("order:statusUpdated", {
    ...baseData,
    patientId: order.patientId,
  });

  if (status === "SENT_TO_PHARMACY") {
    socketEvents.emitToRole("PHARMACY_STAFF", "order:statusUpdated", {
      ...baseData,
      patientId: order.patientId,
    });
  }
};

// Helper function to emit order created events
const emitOrderCreated = (order: IOrder) => {
  const orderId = getOrderId(order);
  const createdAt = (order as any).createdAt || new Date();
  const data = {
    orderId,
    patientId: order.patientId,
    pharmacyId: order.pharmacyId,
    status: order.status,
    itemCount: order.items.length,
    createdAt,
  };

  socketEvents.emitToAdmin("order:created", data);
  socketEvents.emitToUser(order.patientId, "order:created", {
    orderId: data.orderId,
    pharmacyId: data.pharmacyId,
    status: data.status,
    itemCount: data.itemCount,
    createdAt: data.createdAt,
  });
};

// Helper function to emit order cancelled events
const emitOrderCancelled = (order: IOrder) => {
  const orderId = getOrderId(order);
  socketEvents.emitToUser(order.patientId, "order:cancelled", {
    orderId,
    status: "CANCELLED",
    pharmacyId: order.pharmacyId,
  });
  socketEvents.emitToAdmin("order:cancelled", {
    orderId,
    patientId: order.patientId,
    pharmacyId: order.pharmacyId,
  });
};

// Patient creates a direct medicine order (not from prescription)
router.post(
  "/medicine-order",
  requireAuth,
  requireRole(["PATIENT"]),
  async (req, res) => {
    try {
      const { pharmacyId, items, deliveryType, deliveryAddress, phoneNumber, totalAmount, deliveryCharge, prescriptionImageUrl, patientLocation } = req.body;

      // Validate required fields
      if (!pharmacyId) {
        return res.status(400).json({ message: "pharmacyId is required" });
      }
      
      if (!items || !Array.isArray(items) || items.length === 0) {
        return res.status(400).json({ message: "items array is required" });
      }

      if (deliveryType === "DELIVERY" && !deliveryAddress) {
        return res.status(400).json({ message: "deliveryAddress is required for delivery" });
      }

      // Create order with PENDING status - will be reviewed by admin
      const orderData: any = {
        pharmacyId,
        patientId: req.user!.sub,
        items: items.map((item: any) => ({
          medicineName: item.medicineName,
          quantity: item.quantity,
        })),
        status: "PENDING",
        deliveryType: deliveryType || "PICKUP",
        deliveryAddress: deliveryType === "DELIVERY" ? deliveryAddress : undefined,
        phoneNumber,
        totalAmount: totalAmount || 0,
        deliveryCharge: deliveryCharge || 0,
        prescriptionImageUrl: prescriptionImageUrl || undefined,
        prescriptionVerified: false,
        patientLocation: patientLocation || req.body.patientLocation,
        pharmacyLocation: req.body.pharmacyLocation,
      };

      const order = await Order.create(orderData);

      // Create finance entries when order is created (payment happens at checkout)
      if (order.totalAmount && order.totalAmount > 0) {
        try {
          const orderId = getOrderId(order);
          
          // Check if finance entries already exist for this order
          const existingEntries = await FinanceEntry.find({
            "meta.orderId": orderId,
            type: { $in: ["MEDICINE_SALE", "DELIVERY_CHARGE"] },
          });
          
          // Only create finance entries if they don't already exist
          if (existingEntries.length === 0) {
            // Calculate medicine sale amount (totalAmount - deliveryCharge)
            const medicineAmount = (order.totalAmount || 0) - (order.deliveryCharge || 0);
            
            // Create MEDICINE_SALE finance entry
            if (medicineAmount > 0) {
              await FinanceEntry.create({
                pharmacyId: order.pharmacyId,
                patientId: order.patientId,
                type: "MEDICINE_SALE",
                amount: medicineAmount,
                occurredAt: new Date(),
                meta: {
                  orderId: orderId,
                  items: order.items,
                  totalAmount: order.totalAmount,
                },
              });
            }
            
            // Create DELIVERY_CHARGE finance entry if delivery charge exists
            if (order.deliveryCharge && order.deliveryCharge > 0) {
              await FinanceEntry.create({
                pharmacyId: order.pharmacyId,
                patientId: order.patientId,
                type: "DELIVERY_CHARGE",
                amount: order.deliveryCharge,
                occurredAt: new Date(),
                meta: {
                  orderId: orderId,
                  deliveryType: order.deliveryType,
                },
              });
            }
            
            // Emit finance update event to refresh admin dashboard
            socketEvents.emitToAdmin("finance:updated", {
              orderId: orderId,
              pharmacyId: order.pharmacyId,
              totalAmount: order.totalAmount,
            });
          }
        } catch (financeError: any) {
          console.error("Error creating finance entries for order:", financeError);
          // Don't fail order creation if finance entry creation fails
        }
      }

      await createActivity(
        "ORDER_CREATED",
        "New Medicine Order Created",
        `Patient ${order.patientId} created a direct medicine order. Waiting for admin approval.`,
        {
          orderId: getOrderId(order),
          patientId: order.patientId,
          pharmacyId: order.pharmacyId,
          metadata: {
            orderType: "DIRECT_MEDICINE_ORDER",
            itemCount: order.items.length,
            deliveryType: order.deliveryType,
            phoneNumber,
            totalAmount: order.totalAmount,
          },
        }
      );

      emitOrderCreated(order);

      res.status(201).json(order);
    } catch (error: any) {
      console.error("Error creating medicine order:", error);
      res.status(400).json({ message: error.message || "Failed to create order" });
    }
  }
);

// Patient creates an order from prescription
router.post(
  "/",
  requireAuth,
  requireRole(["PATIENT"]),
  async (req, res) => {
    try {
      const { pharmacyId, ...orderData } = req.body;
      
      if (!pharmacyId) {
        return res.status(400).json({ message: "pharmacyId is required" });
      }
      
      // Get pharmacy location if available
      let pharmacyLocation = undefined;
      if (pharmacyId) {
        try {
          const { Pharmacy } = await import("../master/pharmacy.model");
          const pharmacy = await Pharmacy.findById(pharmacyId);
          if (pharmacy && pharmacy.latitude && pharmacy.longitude) {
            pharmacyLocation = {
              latitude: pharmacy.latitude,
              longitude: pharmacy.longitude,
            };
          }
        } catch (e) {
          // Silently fail - pharmacy location is optional
        }
      }

      const order = await Order.create({
        ...orderData,
        pharmacyId,
        patientId: req.user!.sub,
        status: "PENDING",
        patientLocation: orderData.patientLocation,
        pharmacyLocation,
      });

      // Create finance entries when order is created (payment happens at checkout)
      if (order.totalAmount && order.totalAmount > 0) {
        try {
          const orderId = getOrderId(order);
          
          // Check if finance entries already exist for this order
          const existingEntries = await FinanceEntry.find({
            "meta.orderId": orderId,
            type: { $in: ["MEDICINE_SALE", "DELIVERY_CHARGE"] },
          });
          
          // Only create finance entries if they don't already exist
          if (existingEntries.length === 0) {
            // Calculate medicine sale amount (totalAmount - deliveryCharge)
            const medicineAmount = (order.totalAmount || 0) - (order.deliveryCharge || 0);
            
            // Create MEDICINE_SALE finance entry
            if (medicineAmount > 0) {
              await FinanceEntry.create({
                pharmacyId: order.pharmacyId,
                patientId: order.patientId,
                type: "MEDICINE_SALE",
                amount: medicineAmount,
                occurredAt: new Date(),
                meta: {
                  orderId: orderId,
                  items: order.items,
                  totalAmount: order.totalAmount,
                },
              });
            }
            
            // Create DELIVERY_CHARGE finance entry if delivery charge exists
            if (order.deliveryCharge && order.deliveryCharge > 0) {
              await FinanceEntry.create({
                pharmacyId: order.pharmacyId,
                patientId: order.patientId,
                type: "DELIVERY_CHARGE",
                amount: order.deliveryCharge,
                occurredAt: new Date(),
                meta: {
                  orderId: orderId,
                  deliveryType: order.deliveryType,
                },
              });
            }
            console.log(`Finance entries created for prescription order ${getShortOrderId(order)} at checkout`);
            
            // Emit finance update event to refresh admin dashboard
            socketEvents.emitToAdmin("finance:updated", {
              orderId: orderId,
              pharmacyId: order.pharmacyId,
              totalAmount: order.totalAmount,
            });
          }
        } catch (financeError: any) {
          console.error("Error creating finance entries for order:", financeError);
          // Don't fail order creation if finance entry creation fails
        }
      }
      
      await createActivity(
        "ORDER_CREATED",
        "New Order Created",
        `Patient ${order.patientId} created order. Waiting for admin approval.`,
        {
          patientId: order.patientId,
          pharmacyId: order.pharmacyId,
          metadata: { orderId: getOrderId(order), itemCount: order.items.length },
        }
      );

      emitOrderCreated(order);
      
      res.status(201).json(order);
    } catch (error: any) {
      console.error("Error creating order:", error);
      res.status(500).json({ message: "Failed to create order", error: error.message });
    }
  }
);

// Get orders (with auth - for mobile app compatibility)
// Must come before /my route
router.get(
  "/",
  requireAuth,
  async (req, res) => {
    try {
      const { patientId, pharmacyId } = req.query;
      
      if (patientId && req.user!.sub === patientId) {
        const orders = await Order.find({ patientId: String(patientId) })
          .sort({ createdAt: -1 })
          .limit(50);
        return res.json(orders);
      }
      
      if (req.user!.role === "PHARMACY_STAFF" || req.user!.role === "SUPER_ADMIN") {
        const filter: any = {};
        if (patientId) filter.patientId = String(patientId);
        if (pharmacyId) filter.pharmacyId = String(pharmacyId);
        const orders = await Order.find(filter)
          .sort({ createdAt: -1 })
          .limit(100);
        return res.json(orders);
      }
      
      res.json([]);
    } catch (error: any) {
      console.error("Error fetching orders:", error);
      res.status(500).json({ message: "Failed to fetch orders", error: error.message });
    }
  }
);

// Patient views own orders
router.get(
  "/my",
  requireAuth,
  async (req, res) => {
    try {
      const orders = await Order.find({ patientId: req.user!.sub })
        .sort({ createdAt: -1 })
        .limit(50);
      res.json(orders);
    } catch (error: any) {
      console.error("Error fetching user orders:", error);
      res.status(500).json({ message: "Failed to fetch orders", error: error.message });
    }
  }
);

// Pharmacy views orders to fulfill
router.get(
  "/by-pharmacy/:pharmacyId",
  requireAuth,
  requireRole(["PHARMACY_STAFF", "SUPER_ADMIN"]),
  async (req, res) => {
    try {
      const { pharmacyId } = req.params;
      const orders = await Order.find({ pharmacyId })
        .sort({ createdAt: -1 })
        .limit(100);
      res.json(orders);
    } catch (error: any) {
      console.error("Error fetching orders by pharmacy:", error);
      res.status(500).json({ message: "Failed to fetch orders", error: error.message });
    }
  }
);

// Get single order by ID (Patient can view own orders, Admin/Pharmacy can view any)
// Must come after /by-pharmacy/:pharmacyId to avoid route conflicts
router.get(
  "/:id",
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const order = await Order.findById(id);
      
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Check authorization - patient can only view their own orders
      const userId = req.user!.sub;
      const userRole = req.user!.role;
      const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";
      const isPharmacyStaff = userRole === "PHARMACY_STAFF";
      
      // Convert both IDs to strings for comparison
      const orderPatientIdStr = String(order.patientId);
      const userIdStr = String(userId);
      
      if (!isAdmin && !isPharmacyStaff && orderPatientIdStr !== userIdStr) {
        return res.status(403).json({ message: "You can only view your own orders" });
      }

      // Populate pharmacy info if available
      let orderWithPharmacy: any = order.toObject();
      try {
        const { Pharmacy } = await import("../master/pharmacy.model");
        const pharmacy = await Pharmacy.findById(order.pharmacyId);
        if (pharmacy) {
          orderWithPharmacy.pharmacy = {
            name: pharmacy.name,
            address: pharmacy.address,
          };
        }
      } catch (e) {
        // Silently fail - pharmacy info is optional
      }

      res.json(orderWithPharmacy);
    } catch (error: any) {
      console.error("Error fetching order:", error);
      res.status(500).json({ message: "Failed to fetch order", error: error.message });
    }
  }
);

// Admin status update helper
const adminStatusUpdate = async (
  req: any,
  res: any,
  currentStatus: string,
  newStatus: string,
  activityTitle: string,
  activityDescription: string,
  updateFields: any
) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }
    
    if (order.status !== currentStatus) {
      return res.status(400).json({ 
        message: `Order must be ${currentStatus}. Current status: ${order.status}` 
      });
    }
    
    const updated = await Order.findByIdAndUpdate(
      req.params.id,
      { status: newStatus, ...updateFields },
      { new: true }
    );
    
    await createActivity(
      "ORDER_STATUS_UPDATED",
      activityTitle,
      activityDescription.replace("{shortId}", getShortOrderId(order)),
      {
        patientId: order.patientId,
        pharmacyId: order.pharmacyId,
        metadata: { orderId: getOrderId(order), status: newStatus },
      }
    );

    emitOrderStatusUpdate(order, newStatus);
    
    res.json(updated);
  } catch (error: any) {
    console.error(`Error updating order status to ${newStatus}:`, error);
    res.status(500).json({ message: "Failed to update order", error: error.message });
  }
};

// Admin accepts order (changes PENDING to ORDER_RECEIVED)
router.patch(
  "/:id/admin-accept",
  requireAuth,
  requireRole(["SUPER_ADMIN"]),
  async (req, res) => {
    await adminStatusUpdate(
      req,
      res,
      "PENDING",
      "ORDER_RECEIVED",
      "Order Received by Admin",
      "Order {shortId} received and accepted by admin",
      { adminApprovedAt: new Date() }
    );
  }
);

// Admin marks medicine as received from supplier
router.patch(
  "/:id/admin-receive-medicine",
  requireAuth,
  requireRole(["SUPER_ADMIN"]),
  async (req, res) => {
    await adminStatusUpdate(
      req,
      res,
      "ORDER_RECEIVED",
      "MEDICINE_RECEIVED",
      "Medicine Received",
      "Medicine for order {shortId} received from supplier",
      { medicineReceivedAt: new Date() }
    );
  }
);

// Admin sends order to pharmacy
router.patch(
  "/:id/admin-send-to-pharmacy",
  requireAuth,
  requireRole(["SUPER_ADMIN"]),
  async (req, res) => {
    await adminStatusUpdate(
      req,
      res,
      "MEDICINE_RECEIVED",
      "SENT_TO_PHARMACY",
      "Order Sent to Pharmacy",
      "Order {shortId} sent to pharmacy for processing",
      { sentToPharmacyAt: new Date() }
    );
  }
);

// Pharmacy updates order status
router.patch(
  "/:id/status",
  requireAuth,
  requireRole(["PHARMACY_STAFF", "SUPER_ADMIN"]),
  async (req, res) => {
    try {
      const { status, deliveryPersonId, deliveryPersonName, deliveryPersonPhone, estimatedDeliveryTime, deliveryNotes } = req.body;
      
      const order = await Order.findById(req.params.id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }
      
      // Prevent updating to the same status
      if (order.status === status) {
        return res.status(400).json({ 
          message: `Order is already ${status}` 
        });
      }
      
      // Prevent updating already delivered or cancelled orders
      if (order.status === "DELIVERED" || order.status === "CANCELLED") {
        return res.status(400).json({ 
          message: `Cannot update order status. Order is already ${order.status}` 
        });
      }
      
      // Validate status transitions
      if (status === "ACCEPTED") {
        const allowedStatuses = ["PENDING", "ORDER_RECEIVED", "MEDICINE_RECEIVED", "SENT_TO_PHARMACY"];
        if (!allowedStatuses.includes(order.status)) {
          return res.status(400).json({ 
            message: `Order cannot be accepted from current status: ${order.status}. Allowed statuses: ${allowedStatuses.join(", ")}` 
          });
        }
      } else if (status === "PACKED") {
        if (order.status !== "ACCEPTED") {
          return res.status(400).json({ 
            message: `Order must be ACCEPTED to pack. Current status: ${order.status}` 
          });
        }
      } else if (status === "OUT_FOR_DELIVERY") {
        if (order.status !== "PACKED") {
          return res.status(400).json({ 
            message: `Order must be PACKED to dispatch. Current status: ${order.status}` 
          });
        }
      } else if (status === "DELIVERED") {
        if (order.status !== "OUT_FOR_DELIVERY") {
          return res.status(400).json({ 
            message: `Order must be OUT_FOR_DELIVERY to mark as delivered. Current status: ${order.status}` 
          });
        }
      }
      
      const updateData: any = { status };
      
      if (status === "OUT_FOR_DELIVERY") {
        if (deliveryPersonId) updateData.deliveryPersonId = deliveryPersonId;
        if (deliveryPersonName) updateData.deliveryPersonName = deliveryPersonName;
        if (deliveryPersonPhone) updateData.deliveryPersonPhone = deliveryPersonPhone;
        if (estimatedDeliveryTime) updateData.estimatedDeliveryTime = new Date(estimatedDeliveryTime);
        if (deliveryNotes) updateData.deliveryNotes = deliveryNotes;
      }
      
      if (status === "DELIVERED") {
        updateData.deliveredAt = new Date();
        if (deliveryNotes) updateData.deliveryNotes = deliveryNotes;
      }
      
      const updated = await Order.findByIdAndUpdate(
        req.params.id,
        updateData,
        { new: true }
      );
      
      let description = `Order ${getShortOrderId(order)} status changed to ${status}`;
      if (status === "OUT_FOR_DELIVERY" && deliveryPersonName) {
        description += ` - Assigned to ${deliveryPersonName}`;
      }
      if (status === "DELIVERED") {
        description += " - Medicine delivered successfully";
      }
      
      await createActivity(
        "ORDER_STATUS_UPDATED",
        "Order Status Updated",
        description,
        {
          patientId: order.patientId,
          pharmacyId: order.pharmacyId,
          metadata: { 
            orderId: getOrderId(order), 
            status,
            deliveryPersonName: updated?.deliveryPersonName,
            estimatedDeliveryTime: updated?.estimatedDeliveryTime,
          },
        }
      );

      // Note: Finance entries are created when order is created (at checkout/payment time)
      // This is kept as a fallback for old orders that don't have finance entries yet
      if (status === "DELIVERED" && updated && updated.totalAmount && updated.totalAmount > 0) {
        try {
          const orderId = getOrderId(updated);
          
          // Check if finance entries already exist for this order
          const existingEntries = await FinanceEntry.find({
            "meta.orderId": orderId,
            type: { $in: ["MEDICINE_SALE", "DELIVERY_CHARGE"] },
          });
          
          // Only create finance entries if they don't already exist (fallback for old orders)
          if (existingEntries.length === 0) {
            // Calculate medicine sale amount (totalAmount - deliveryCharge)
            const medicineAmount = (updated.totalAmount || 0) - (updated.deliveryCharge || 0);
            
            // Create MEDICINE_SALE finance entry
            if (medicineAmount > 0) {
              await FinanceEntry.create({
                pharmacyId: updated.pharmacyId,
                patientId: updated.patientId,
                type: "MEDICINE_SALE",
                amount: medicineAmount,
                occurredAt: updated.createdAt || new Date(), // Use order creation time, not delivery time
                meta: {
                  orderId: orderId,
                  items: updated.items,
                  totalAmount: updated.totalAmount,
                },
              });
            }
            
            // Create DELIVERY_CHARGE finance entry if delivery charge exists
            if (updated.deliveryCharge && updated.deliveryCharge > 0) {
              await FinanceEntry.create({
                pharmacyId: updated.pharmacyId,
                patientId: updated.patientId,
                type: "DELIVERY_CHARGE",
                amount: updated.deliveryCharge,
                occurredAt: updated.createdAt || new Date(), // Use order creation time, not delivery time
                meta: {
                  orderId: orderId,
                  deliveryType: updated.deliveryType,
                },
              });
            }
            console.log(`Finance entries created for old order ${getShortOrderId(updated)} as fallback`);
          }
        } catch (financeError: any) {
          // Log error but don't fail the order update
          console.error("Error creating finance entries for delivered order (fallback):", financeError);
        }
      }

      emitOrderStatusUpdate(order, status, {
        deliveryPersonName: updated?.deliveryPersonName,
        estimatedDeliveryTime: updated?.estimatedDeliveryTime,
        deliveredAt: updated?.deliveredAt,
      });
      
      // Emit special event when order is delivered for finance updates
      if (status === "DELIVERED" && updated) {
        socketEvents.emitToAdmin("order:delivered", {
          orderId: getOrderId(updated),
          patientId: updated.patientId,
          pharmacyId: updated.pharmacyId,
          totalAmount: updated.totalAmount,
          deliveredAt: updated.deliveredAt,
        });
      }
      
      res.json(updated);
    } catch (error: any) {
      console.error("Error updating order status:", error);
      res.status(500).json({ message: "Failed to update order status", error: error.message });
    }
  }
);

// Patient cancels own order
router.patch(
  "/:id/cancel",
  requireAuth,
  async (req, res) => {
    try {
      const { cancellationReason } = req.body;
      const order = await Order.findById(req.params.id);
      
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      if (order.patientId !== req.user!.sub && req.user!.role !== "SUPER_ADMIN") {
        return res.status(403).json({ message: "You can only cancel your own orders" });
      }

      const nonCancellableStatuses = ["DELIVERED", "CANCELLED", "OUT_FOR_DELIVERY"];
      if (nonCancellableStatuses.includes(order.status)) {
        return res.status(400).json({ 
          message: `Cannot cancel order. Current status: ${order.status}` 
        });
      }

      const updated = await Order.findByIdAndUpdate(
        req.params.id,
        { 
          status: "CANCELLED",
          cancellationReason: cancellationReason || "Cancelled by patient",
          cancelledAt: new Date(),
        },
        { new: true }
      );

      const cancelledBy = req.user!.role === "SUPER_ADMIN" ? "admin" : "patient";
      await createActivity(
        "ORDER_STATUS_UPDATED",
        "Order Cancelled",
        `Order ${getShortOrderId(order)} cancelled by ${cancelledBy}`,
        {
          patientId: order.patientId,
          pharmacyId: order.pharmacyId,
          metadata: { 
            orderId: getOrderId(order), 
            status: "CANCELLED",
            cancellationReason: cancellationReason || "Cancelled by patient",
          },
        }
      );

      emitOrderCancelled(order);

      res.json(updated);
    } catch (error: any) {
      console.error("Error cancelling order:", error);
      res.status(500).json({ message: "Failed to cancel order", error: error.message });
    }
  }
);

// Get order location (for tracking)
router.get(
  "/:id/location",
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const userId = (req as any).user?.userId;

      const order = await Order.findById(id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Only patient or admin can view order location
      if (order.patientId !== userId && (req as any).user?.role !== "SUPER_ADMIN" && (req as any).user?.role !== "HOSPITAL_ADMIN") {
        return res.status(403).json({ message: "Access denied" });
      }

      res.json({
        deliveryLocation: order.deliveryLocation,
        pharmacyLocation: order.pharmacyLocation,
        patientLocation: order.patientLocation,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to get order location", error: error.message });
    }
  }
);

// Update delivery location (for delivery person)
router.put(
  "/:id/delivery-location",
  requireAuth,
  async (req, res) => {
    try {
      const { id } = req.params;
      const { latitude, longitude, accuracy } = req.body;
      const userId = (req as any).user?.userId;

      // Validate location data
      if (typeof latitude !== "number" || typeof longitude !== "number") {
        return res.status(400).json({ message: "Invalid location coordinates" });
      }

      const order = await Order.findById(id);
      if (!order) {
        return res.status(404).json({ message: "Order not found" });
      }

      // Only delivery person assigned to this order or admin can update
      if (
        order.deliveryPersonId !== userId &&
        (req as any).user?.role !== "SUPER_ADMIN" &&
        (req as any).user?.role !== "HOSPITAL_ADMIN"
      ) {
        return res.status(403).json({ message: "Access denied" });
      }

      // Update delivery location
      order.deliveryLocation = {
        latitude,
        longitude,
        timestamp: new Date(),
        accuracy: accuracy || undefined,
      };

      await order.save();

      // Emit real-time location update
      socketEvents.emitToUser(order.patientId, "order:deliveryLocationUpdated", {
        orderId: String(order._id),
        location: order.deliveryLocation,
        patientId: order.patientId,
      });

      res.json({
        message: "Delivery location updated",
        location: order.deliveryLocation,
      });
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update delivery location", error: error.message });
    }
  }
);

// Update order (general update route for pharmacy staff and admin)
router.patch("/:id", requireAuth, requireRole(["PHARMACY_STAFF", "SUPER_ADMIN", "HOSPITAL_ADMIN"]), async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Check authorization - pharmacy staff can only update orders for their pharmacy
    const userId = req.user!.sub;
    const userRole = req.user!.role;
    const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";
    
    if (userRole === "PHARMACY_STAFF") {
      // Get user's pharmacyId from database
      const { User } = await import("../user/user.model");
      const user = await User.findById(userId);
      if (!user || !user.pharmacyId) {
        return res.status(403).json({ message: "You are not associated with a pharmacy" });
      }
      
      if (String(order.pharmacyId) !== String(user.pharmacyId)) {
        return res.status(403).json({ message: "You can only update orders for your pharmacy" });
      }
    }

    // Only allow updating specific fields
    const allowedUpdates: any = {};
    if (req.body.prescriptionVerified !== undefined) {
      allowedUpdates.prescriptionVerified = req.body.prescriptionVerified;
    }

    if (Object.keys(allowedUpdates).length === 0) {
      return res.status(400).json({ message: "No valid fields to update" });
    }

    const updated = await Order.findByIdAndUpdate(
      req.params.id,
      allowedUpdates,
      { new: true }
    );

    // Log activity if prescription was verified
    if (allowedUpdates.prescriptionVerified !== undefined) {
      await createActivity(
        "ORDER_STATUS_UPDATED",
        "Prescription Verification Updated",
        `Prescription for order ${getShortOrderId(order)} ${allowedUpdates.prescriptionVerified ? "verified" : "rejected"}`,
        {
          patientId: order.patientId,
          pharmacyId: order.pharmacyId,
          metadata: {
            orderId: getOrderId(order),
            prescriptionVerified: allowedUpdates.prescriptionVerified,
          },
        }
      );

      // Emit socket event
      emitOrderStatusUpdate(updated!, order.status, {
        prescriptionVerified: allowedUpdates.prescriptionVerified,
      });
    }

    res.json(updated);
  } catch (error: any) {
    res.status(500).json({ message: "Failed to update order", error: error.message });
  }
});

// Delete order (Patient can delete their own, Admin can delete any)
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const order = await Order.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Order not found" });
    }

    // Check authorization - patients can only delete their own orders
    const userId = req.user!.sub;
    const userRole = req.user!.role;
    const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";
    
    if (userRole === "PATIENT" && String(order.patientId) !== String(userId)) {
      return res.status(403).json({ message: "You can only delete your own orders" });
    }
    
    if (!isAdmin && userRole !== "PATIENT") {
      return res.status(403).json({ message: "You are not authorized to delete orders" });
    }

    // Only allow deletion if order is PENDING or CANCELLED
    if (order.status !== "PENDING" && order.status !== "CANCELLED") {
      return res.status(400).json({ 
        message: `Cannot delete order. Only PENDING or CANCELLED orders can be deleted. Current status: ${order.status}`,
        currentStatus: order.status
      });
    }

    await Order.findByIdAndDelete(req.params.id);

    await createActivity(
      "ORDER_DELETED",
      "Order Deleted",
      `Order ${getShortOrderId(order)} deleted`,
      {
        patientId: order.patientId,
        pharmacyId: order.pharmacyId,
        metadata: { orderId: getOrderId(order) },
      }
    );

    emitOrderCancelled(order);

    res.json({ message: "Order deleted successfully" });
  } catch (error: any) {
    res.status(500).json({ message: "Failed to delete order", error: error.message });
  }
});