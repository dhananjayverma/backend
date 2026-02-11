import { Router, Request, Response } from "express";
import { InventoryItem } from "../inventory/inventory.model";
import { Pharmacy } from "../master/pharmacy.model";

export const router = Router();

/**
 * Get products by category with filters
 * Public endpoint for patient app
 */
router.get("/", async (req: Request, res: Response) => {
  try {
    const {
      category,
      search,
      pharmacyId,
      minPrice,
      maxPrice,
      prescriptionRequired,
      latitude,
      longitude,
      radius = 10,
      limit = 50,
      skip = 0,
    } = req.query;

    const filter: any = {
      quantity: { $gt: 0 }, // Only available items
    };

    // Filter by category
    if (category) {
      filter.category = category;
    }

    // Search by name, composition, or brand
    if (search) {
      filter.$or = [
        { medicineName: { $regex: search, $options: "i" } },
        { composition: { $regex: search, $options: "i" } },
        { brandName: { $regex: search, $options: "i" } },
      ];
    }

    // Filter by pharmacy
    if (pharmacyId) {
      filter.pharmacyId = pharmacyId;
    }

    // Price range filter
    if (minPrice || maxPrice) {
      filter.sellingPrice = {};
      if (minPrice) filter.sellingPrice.$gte = Number(minPrice);
      if (maxPrice) filter.sellingPrice.$lte = Number(maxPrice);
    }

    // Prescription required filter
    if (prescriptionRequired !== undefined) {
      filter.prescriptionRequired = prescriptionRequired === "true";
    }

    // Get pharmacies within radius if location provided
    let pharmacyIds: string[] = [];
    if (latitude && longitude && !pharmacyId) {
      const pharmacies = await Pharmacy.find({
        isActive: true,
        latitude: { $exists: true },
        longitude: { $exists: true },
      });

      const nearbyPharmacies = pharmacies.filter((pharmacy) => {
        if (!pharmacy.latitude || !pharmacy.longitude) return false;
        const distance = calculateDistance(
          Number(latitude),
          Number(longitude),
          pharmacy.latitude,
          pharmacy.longitude
        );
        return distance <= Number(radius);
      });

      pharmacyIds = nearbyPharmacies.map((p) => String(p._id));
      if (pharmacyIds.length > 0) {
        filter.pharmacyId = { $in: pharmacyIds };
      } else {
        // No pharmacies in range
        return res.json({
          products: [],
          total: 0,
          hasMore: false,
        });
      }
    }

    // Find products
    const items = await InventoryItem.find(filter)
      .sort({ expiryDate: 1, sellingPrice: 1 }) // FIFO and price sorting
      .skip(Number(skip))
      .limit(Number(limit))
      .lean();

    // Get unique pharmacy IDs
    const uniquePharmacyIds = [...new Set(items.map((item) => item.pharmacyId).filter(Boolean))];
    const pharmacies = await Pharmacy.find({
      _id: { $in: uniquePharmacyIds },
      isActive: true,
    }).lean();

    // Create pharmacy map
    const pharmacyMap: Record<string, any> = {};
    pharmacies.forEach((pharmacy) => {
      const id = String(pharmacy._id);
      pharmacyMap[id] = {
        _id: id,
        name: pharmacy.name,
        address: pharmacy.address,
        phone: pharmacy.phone,
        latitude: pharmacy.latitude,
        longitude: pharmacy.longitude,
      };

      // Calculate distance if location provided
      if (latitude && longitude && pharmacy.latitude && pharmacy.longitude) {
        pharmacyMap[id].distance = calculateDistance(
          Number(latitude),
          Number(longitude),
          pharmacy.latitude,
          pharmacy.longitude
        );
      }
    });

    // Format products
    const products = items
      .filter((item) => {
        // Filter out expired items
        const expiryDate = new Date(item.expiryDate);
        const today = new Date();
        return expiryDate >= today;
      })
      .map((item) => {
        const expiryDate = new Date(item.expiryDate);
        const today = new Date();
        const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

        return {
          _id: String(item._id),
          medicineName: item.medicineName,
          composition: item.composition,
          brandName: item.brandName || "Generic",
          category: item.category || "MEDICINE",
          sellingPrice: item.sellingPrice,
          mrp: item.mrp || item.sellingPrice,
          discount: item.discount || 0,
          quantity: item.quantity,
          imageUrl: item.imageUrl || null,
          description: item.description || null,
          prescriptionRequired: item.prescriptionRequired || false,
          daysUntilExpiry,
          pharmacy: item.pharmacyId ? pharmacyMap[String(item.pharmacyId)] : null,
        };
      });

    // Get total count for pagination
    const total = await InventoryItem.countDocuments(filter);

    res.json({
      products,
      total,
      hasMore: Number(skip) + products.length < total,
    });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

/**
 * Get medicines by composition or brand - for patient app
 * Returns compositions with available brands and pharmacy availability
 * Query: search (composition or brand name), latitude, longitude, radius, prescribedBrand (optional - restrict to this brand if from prescription)
 */
router.get("/by-composition", async (req: Request, res: Response) => {
  try {
    const { search, latitude, longitude, radius = 10, prescribedBrand } = req.query;
    if (!search || String(search).trim().length < 2) {
      return res.json({ compositions: [], query: search });
    }
    const q = String(search).trim();
    const filter: any = {
      quantity: { $gt: 0 },
      $or: [
        { composition: { $regex: q, $options: "i" } },
        { medicineName: { $regex: q, $options: "i" } },
        { brandName: { $regex: q, $options: "i" } },
      ],
    };
    let pharmacyIds: string[] = [];
    if (latitude && longitude) {
      const pharmacies = await Pharmacy.find({
        isActive: true,
        latitude: { $exists: true },
        longitude: { $exists: true },
      }).lean();
      const nearby = pharmacies.filter((pharmacy: any) => {
        if (!pharmacy.latitude || !pharmacy.longitude) return false;
        const distance = calculateDistance(
          Number(latitude),
          Number(longitude),
          pharmacy.latitude,
          pharmacy.longitude
        );
        return distance <= Number(radius);
      });
      pharmacyIds = nearby.map((p: any) => String(p._id));
      if (pharmacyIds.length > 0) filter.pharmacyId = { $in: pharmacyIds };
    }
    const items = await InventoryItem.find(filter)
      .sort({ expiryDate: 1 })
      .limit(200)
      .lean();
    const today = new Date();
    const validItems = items.filter((item: any) => new Date(item.expiryDate) >= today);
    const pharmacyIdsUsed = [...new Set(validItems.map((item: any) => item.pharmacyId).filter(Boolean))];
    const pharmacies = await Pharmacy.find({ _id: { $in: pharmacyIdsUsed }, isActive: true }).lean();
    const pharmacyMap: Record<string, any> = {};
    pharmacies.forEach((pharmacy: any) => {
      const id = String(pharmacy._id);
      pharmacyMap[id] = {
        _id: id,
        name: pharmacy.name,
        address: pharmacy.address,
        phone: pharmacy.phone,
        distance: latitude && longitude && pharmacy.latitude && pharmacy.longitude
          ? calculateDistance(Number(latitude), Number(longitude), pharmacy.latitude, pharmacy.longitude)
          : null,
      };
    });
    const byComposition = new Map<string, any>();
    for (const item of validItems) {
      const comp = item.composition || item.medicineName;
      if (prescribedBrand && item.brandName && !String(item.brandName).toLowerCase().includes(String(prescribedBrand).toLowerCase())) {
        continue; // Prescription mandates specific brand - only include that brand
      }
      if (!byComposition.has(comp)) {
        byComposition.set(comp, { composition: comp, medicineName: item.medicineName, brands: [] });
      }
      const entry = byComposition.get(comp);
      const brandKey = `${item.brandName || "Generic"}|${item.batchNumber}`;
      const existing = entry.brands.find((b: any) => b.inventoryItemId === String(item._id));
      if (!existing) {
        const daysUntilExpiry = Math.ceil((new Date(item.expiryDate).getTime() - today.getTime()) / (1000 * 60 * 60 * 24));
        entry.brands.push({
          inventoryItemId: String(item._id),
          brandName: item.brandName || "Generic",
          batchNumber: item.batchNumber,
          expiryDate: item.expiryDate,
          daysUntilExpiry,
          availableQuantity: item.quantity,
          sellingPrice: item.sellingPrice,
          mrp: item.mrp || item.sellingPrice,
          pharmacy: item.pharmacyId ? pharmacyMap[String(item.pharmacyId)] : null,
        });
      }
    }
    const compositions = Array.from(byComposition.values());
    res.json({ compositions, query: search });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

/**
 * Get product by ID
 */
router.get("/:id", async (req: Request, res: Response) => {
  try {
    const { id } = req.params;
    const item = await InventoryItem.findById(id).lean();

    if (!item) {
      return res.status(404).json({ message: "Product not found" });
    }

    // Check if expired
    const expiryDate = new Date(item.expiryDate);
    const today = new Date();
    if (expiryDate < today) {
      return res.status(404).json({ message: "Product expired" });
    }

    // Get pharmacy info
    let pharmacy = null;
    if (item.pharmacyId) {
      const pharmacyDoc = await Pharmacy.findById(item.pharmacyId).lean();
      if (pharmacyDoc) {
        pharmacy = {
          _id: String(pharmacyDoc._id),
          name: pharmacyDoc.name,
          address: pharmacyDoc.address,
          phone: pharmacyDoc.phone,
        };
      }
    }

    const daysUntilExpiry = Math.ceil((expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24));

    res.json({
      _id: String(item._id),
      medicineName: item.medicineName,
      composition: item.composition,
      brandName: item.brandName || "Generic",
      category: item.category || "MEDICINE",
      sellingPrice: item.sellingPrice,
      mrp: item.mrp || item.sellingPrice,
      discount: item.discount || 0,
      quantity: item.quantity,
      imageUrl: item.imageUrl || null,
      description: item.description || null,
      prescriptionRequired: item.prescriptionRequired || false,
      batchNumber: item.batchNumber,
      expiryDate: item.expiryDate,
      daysUntilExpiry,
      pharmacy,
    });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

/**
 * Get categories
 */
router.get("/categories/list", async (_req: Request, res: Response) => {
  try {
    const categories = [
      {
        value: "MEDICINE",
        label: "Medicines",
        icon: "💊",
        description: "Prescription and over-the-counter medicines",
      },
      {
        value: "MEDICAL_EQUIPMENT",
        label: "Medical Equipment",
        icon: "🩺",
        description: "Medical devices and equipment",
      },
      {
        value: "HEALTH_SUPPLEMENT",
        label: "Health Supplements",
        icon: "💊",
        description: "Vitamins and health supplements",
      },
      {
        value: "PERSONAL_CARE",
        label: "Personal Care",
        icon: "🧴",
        description: "Personal hygiene and care products",
      },
    ];

    res.json({ categories });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

/**
 * Calculate distance between two coordinates (Haversine formula)
 */
function calculateDistance(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const R = 6371; // Radius of the Earth in km
  const dLat = toRad(lat2 - lat1);
  const dLon = toRad(lon2 - lon1);
  const a =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  const distance = R * c; // Distance in km
  return distance;
}

function toRad(degrees: number): number {
  return (degrees * Math.PI) / 180;
}

