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

    const { pharmacyId, distributorId, medicineName, quantity } = req.body;

    const order = await DistributorOrder.create({
      pharmacyId,
      distributorId,
      medicineName,
      quantity,
      status: "PENDING",
    });

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
    const { distributorId, status } = req.query;
    const filter: any = {};
    
    if (distributorId) filter.distributorId = distributorId;
    if (status) filter.status = status;

    const orders = await DistributorOrder.find(filter)
      .sort({ createdAt: -1 })
      .limit(DEFAULT_LIMIT);
    
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
        "DISTRIBUTOR_ORDER_DISPATCHED",
        "Distributor Order Dispatched",
        `Order for ${order.medicineName} dispatched to Pharmacy ${order.pharmacyId}`,
        {
          pharmacyId: order.pharmacyId,
          distributorId: order.distributorId,
          metadata: {
            orderId: getOrderId(order),
            medicineName: order.medicineName,
            deliveryAgentId: order.deliveryAgentId,
          },
        }
      );
    } else if (status === "ACCEPTED") {
      await createActivity(
        "DISTRIBUTOR_ORDER_ACCEPTED",
        "Distributor Order Accepted",
        `Order for ${order.medicineName} accepted by Distributor ${order.distributorId}`,
        {
          pharmacyId: order.pharmacyId,
          distributorId: order.distributorId,
          metadata: { orderId: getOrderId(order), medicineName: order.medicineName },
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
