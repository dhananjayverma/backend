import { Router, Request, Response } from "express";
import { DistributorOrder, IDistributorOrder } from "./distributorOrder.model";
import { createActivity } from "../activity/activity.service";

export const router = Router();

const DEFAULT_LIMIT = 200;
const REQUIRED_FIELDS = ["pharmacyId", "distributorId", "medicineName", "quantity"];

const getOrderId = (order: IDistributorOrder): string => String(order._id);

const validateRequiredFields = (body: any): string[] => {
  return REQUIRED_FIELDS.filter((field) => !body[field] && body[field] !== 0);
};

router.post("/", async (req: Request, res: Response) => {
  try {
    const missing = validateRequiredFields(req.body);
    
    if (missing.length > 0) {
      return res.status(400).json({ 
        message: `Missing required fields: ${missing.join(", ")}` 
      });
    }

    const { pharmacyId, distributorId, medicineName, category, quantity } = req.body;

    console.log("Creating distributor order:", { pharmacyId, distributorId, medicineName, category, quantity });

    const order = await DistributorOrder.create({
      pharmacyId: String(pharmacyId),
      distributorId: String(distributorId),
      medicineName: String(medicineName),
      category: category || undefined,
      quantity: Number(quantity),
      status: "PENDING",
    });

    console.log("Order created successfully:", { orderId: getOrderId(order), pharmacyId: order.pharmacyId, distributorId: order.distributorId });

    await createActivity(
      "DISTRIBUTOR_ORDER_CREATED",
      "Distributor Order Created",
      `Manual order created for ${medicineName} (${quantity} units) to Pharmacy ${pharmacyId}`,
      {
        pharmacyId,
        distributorId,
        metadata: { orderId: getOrderId(order), medicineName, quantity },
      }
    );

    res.status(201).json(order);
  } catch (error: any) {
    console.error("Error creating distributor order:", error);
    res.status(500).json({ message: "Failed to create distributor order", error: error.message });
  }
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const { distributorId, pharmacyId, status } = req.query;
    const filter: any = {};
    
    if (distributorId) {
      const distIdString = String(distributorId).trim();
      filter.distributorId = distIdString;
      console.log("Filtering by distributorId:", distIdString);
    }
    if (pharmacyId) {
      const pharmaIdString = String(pharmacyId).trim();
      filter.pharmacyId = pharmaIdString;
      console.log("Filtering by pharmacyId:", pharmaIdString);
    }
    if (status) filter.status = status;

    console.log("Fetching distributor orders with filter:", JSON.stringify(filter));

    // First, let's check if there are ANY orders in the database
    const totalOrders = await DistributorOrder.countDocuments({});
    console.log(`Total orders in database: ${totalOrders}`);
    
    // If filtering by distributorId, let's also check what distributorIds exist
    if (distributorId) {
      const allOrders = await DistributorOrder.find({}).limit(10).select("distributorId").lean();
      const uniqueDistributorIds = [...new Set(allOrders.map((o: any) => String(o.distributorId)))];
      console.log(`Sample distributorIds in database (first 10 orders):`, uniqueDistributorIds);
    }

    const orders = await DistributorOrder.find(filter)
      .sort({ createdAt: -1 })
      .limit(DEFAULT_LIMIT);
    
    console.log(`Found ${orders.length} orders matching filter`);
    
    // Log the actual distributorIds found if no matches
    if (orders.length === 0 && distributorId) {
      const sampleOrders = await DistributorOrder.find({}).limit(5).select("distributorId createdAt").lean();
      const sampleDistributorIds = sampleOrders.map((o: any) => String(o.distributorId));
      console.log("Sample orders from database:", sampleOrders.map((o: any) => ({
        distributorId: String(o.distributorId),
        distributorIdType: typeof o.distributorId,
        createdAt: o.createdAt
      })));
      
      // Check if the queried distributorId exists in any orders
      const queriedIdString = String(distributorId).trim();
      const matchingIds = sampleDistributorIds.filter(id => id === queriedIdString);
      
      if (matchingIds.length === 0 && sampleDistributorIds.length > 0) {
        console.error("⚠️ MISMATCH DETECTED:");
        console.error(`  Queried distributorId: "${queriedIdString}"`);
        console.error(`  Found distributorIds in orders: ${JSON.stringify(sampleDistributorIds)}`);
        console.error(`  These don't match! The user's distributorId should be set to match the Distributor master table _id used in orders.`);
        console.error(`  Please check if the user account's distributorId is correctly set to match the Distributor master table _id.`);
      }
    }
    
    res.json(orders);
  } catch (error: any) {
    console.error("Error fetching distributor orders:", error);
    res.status(500).json({ message: "Failed to fetch distributor orders", error: error.message });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  try {
    const {
      status,
      deliveryOtp,
      deliveryProofImageUrl,
      deliveryAgentId,
      deliveryAgentName,
      deliveryAgentPhone,
      pickedAt,
      outForDeliveryAt,
      deliveredAt,
    } = req.body;

    const updateData: any = {};
    if (status !== undefined) updateData.status = status;
    if (deliveryOtp !== undefined) updateData.deliveryOtp = deliveryOtp;
    if (deliveryProofImageUrl !== undefined) updateData.deliveryProofImageUrl = deliveryProofImageUrl;
    if (deliveryAgentId !== undefined) updateData.deliveryAgentId = deliveryAgentId;
    if (deliveryAgentName !== undefined) updateData.deliveryAgentName = deliveryAgentName;
    if (deliveryAgentPhone !== undefined) updateData.deliveryAgentPhone = deliveryAgentPhone;
    if (pickedAt !== undefined) updateData.pickedAt = pickedAt ? new Date(pickedAt) : undefined;
    if (outForDeliveryAt !== undefined)
      updateData.outForDeliveryAt = outForDeliveryAt ? new Date(outForDeliveryAt) : undefined;
    if (deliveredAt !== undefined)
      updateData.deliveredAt = deliveredAt ? new Date(deliveredAt) : undefined;

    const order = await DistributorOrder.findByIdAndUpdate(req.params.id, updateData, { new: true });

    if (!order) {
      return res.status(404).json({ message: "Distributor order not found" });
    }

    // Update delivery agent status if assigned
    if (deliveryAgentId) {
      try {
        const { User } = await import("../user/user.model");
        await User.findByIdAndUpdate(deliveryAgentId, {
          status: "BUSY",
          currentOrderId: String(order._id),
        });
      } catch (error) {
        console.error("Failed to update delivery agent status:", error);
      }
    }

    // Create activity logs
    if (status === "DELIVERED") {
      await createActivity(
        "DISTRIBUTOR_ORDER_DELIVERED",
        "Distributor Order Delivered",
        `Order for ${order.medicineName} delivered to Pharmacy ${order.pharmacyId}`,
        {
          pharmacyId: order.pharmacyId,
          distributorId: order.distributorId,
          metadata: { orderId: getOrderId(order), medicineName: order.medicineName },
        }
      );

      // Mark delivery agent as available again
      if (order.deliveryAgentId) {
        try {
          const { User } = await import("../user/user.model");
          await User.findByIdAndUpdate(order.deliveryAgentId, {
            status: "AVAILABLE",
            currentOrderId: undefined,
          });
        } catch (error) {
          console.error("Failed to update delivery agent status:", error);
        }
      }
    } else if (status === "DISPATCHED") {
      await createActivity(
        "ORDER_STATUS_UPDATED",
        "Distributor Order Dispatched",
        `Order for ${order.medicineName} dispatched to Pharmacy ${order.pharmacyId}`,
        {
          pharmacyId: order.pharmacyId,
          distributorId: order.distributorId,
          metadata: {
            orderId: getOrderId(order),
            medicineName: order.medicineName,
            deliveryAgentId: order.deliveryAgentId,
            status: "DISPATCHED",
          },
        }
      );
    } else if (status === "ACCEPTED") {
      await createActivity(
        "ORDER_STATUS_UPDATED",
        "Distributor Order Accepted",
        `Order for ${order.medicineName} accepted by Distributor ${order.distributorId}`,
        {
          pharmacyId: order.pharmacyId,
          distributorId: order.distributorId,
          metadata: { orderId: getOrderId(order), medicineName: order.medicineName, status: "ACCEPTED" },
        }
      );
    }

    res.json(order);
  } catch (error: any) {
    console.error("Error updating distributor order:", error);
    res.status(500).json({ message: "Failed to update distributor order", error: error.message });
  }
});

// Get distributor order by ID
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const order = await DistributorOrder.findById(req.params.id);
    if (!order) {
      return res.status(404).json({ message: "Distributor order not found" });
    }
    res.json(order);
  } catch (error: any) {
    console.error("Error fetching distributor order:", error);
    res.status(500).json({ message: "Failed to fetch distributor order", error: error.message });
  }
});

// Delete distributor order
router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const order = await DistributorOrder.findById(req.params.id);
    
    if (!order) {
      return res.status(404).json({ message: "Distributor order not found" });
    }

    // Only allow deleting PENDING or CANCELLED orders
    if (order.status !== "PENDING" && order.status !== "CANCELLED") {
      return res.status(400).json({ 
        message: `Cannot delete order with status: ${order.status}. Only PENDING or CANCELLED orders can be deleted.` 
      });
    }

    await DistributorOrder.findByIdAndDelete(req.params.id);

    // Create activity log for deletion
    try {
      await createActivity(
        "ORDER_STATUS_UPDATED",
        "Distributor Order Deleted",
        `Order for ${order.medicineName} (${order.quantity} units) deleted by Pharmacy ${order.pharmacyId}`,
        {
          pharmacyId: order.pharmacyId,
          distributorId: order.distributorId,
          metadata: { orderId: getOrderId(order), medicineName: order.medicineName, quantity: order.quantity, action: "DELETED" },
        }
      );
    } catch (error) {
      console.error("Failed to create activity log for order deletion:", error);
      // Continue even if activity log fails
    }

    res.json({ message: "Distributor order deleted successfully" });
  } catch (error: any) {
    console.error("Error deleting distributor order:", error);
    res.status(500).json({ message: "Failed to delete distributor order", error: error.message });
  }
});
