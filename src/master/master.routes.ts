import { Router } from "express";
import { Hospital, IHospital } from "./hospital.model";
import { Pharmacy, IPharmacy } from "./pharmacy.model";
import { Distributor, IDistributor } from "./distributor.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";
import { createActivity } from "../activity/activity.service";

export const router = Router();

// Hospitals
router.post(
  "/hospitals",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req, res) => {
    try {
      const hospital = await Hospital.create(req.body) as IHospital;
      
      await createActivity(
        "HOSPITAL_CREATED",
        "Hospital Created",
        `New hospital created: ${hospital.name}`,
        {
          hospitalId: String(hospital._id),
          metadata: { name: hospital.name, address: hospital.address },
        }
      );
      
      res.status(201).json(hospital);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

router.get(
  "/hospitals",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (_req, res) => {
    try {
      const hospitals = await Hospital.find().sort({ createdAt: -1 });
      res.json(hospitals);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

router.get(
  "/hospitals/:id",
  requireAuth,
  async (req, res) => {
    try {
      const hospital = await Hospital.findById(req.params.id);
      if (!hospital) {
        return res.status(404).json({ message: "Hospital not found" });
      }
      res.json(hospital);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Pharmacies
router.post(
  "/pharmacies",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req, res) => {
    try {
      const pharmacy = await Pharmacy.create(req.body) as IPharmacy;
      
      await createActivity(
        "PHARMACY_CREATED",
        "Pharmacy Created",
        `New pharmacy created: ${pharmacy.name}`,
        {
          pharmacyId: String(pharmacy._id),
          metadata: { name: pharmacy.name, address: pharmacy.address },
        }
      );
      
      res.status(201).json(pharmacy);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

router.get(
  "/pharmacies",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (_req, res) => {
    try {
      const pharmacies = await Pharmacy.find().sort({ createdAt: -1 });
      res.json(pharmacies);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

router.get(
  "/pharmacies/:id",
  requireAuth,
  async (req, res) => {
    try {
      const pharmacy = await Pharmacy.findById(req.params.id);
      if (!pharmacy) {
        return res.status(404).json({ message: "Pharmacy not found" });
      }
      res.json(pharmacy);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Distributors
router.post(
  "/distributors",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req, res) => {
    try {
      const distributor = await Distributor.create(req.body) as IDistributor;
      
      await createActivity(
        "DISTRIBUTOR_CREATED",
        "Distributor Created",
        `New distributor created: ${distributor.name}`,
        {
          distributorId: String(distributor._id),
          metadata: { name: distributor.name, address: distributor.address },
        }
      );
      
      res.status(201).json(distributor);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

router.get(
  "/distributors",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (_req, res) => {
    try {
      const distributors = await Distributor.find().sort({ createdAt: -1 });
      res.json(distributors);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

router.get(
  "/distributors/:id",
  requireAuth,
  async (req, res) => {
    try {
      const distributor = await Distributor.findById(req.params.id);
      if (!distributor) {
        return res.status(404).json({ message: "Distributor not found" });
      }
      res.json(distributor);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Update Hospital
router.patch(
  "/hospitals/:id",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req, res) => {
    try {
      const hospital = await Hospital.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
      ) as IHospital | null;
      if (!hospital) {
        return res.status(404).json({ message: "Hospital not found" });
      }
      
      await createActivity(
        "HOSPITAL_UPDATED",
        "Hospital Updated",
        `Hospital updated: ${hospital.name}`,
        {
          hospitalId: String(hospital._id),
          metadata: { name: hospital.name },
        }
      );
      
      res.json(hospital);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Delete Hospital
router.delete(
  "/hospitals/:id",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req, res) => {
    try {
      const hospitalId = req.params.id;
      const hospital = await Hospital.findById(hospitalId) as IHospital | null;
      if (!hospital) {
        return res.status(404).json({ message: "Hospital not found" });
      }

      // Store hospital info before deletion
      const hospitalInfo = {
        name: hospital.name,
        hospitalId: String(hospital._id),
      };

      // Delete the hospital and verify deletion
      const deleteResult = await Hospital.deleteOne({ _id: hospital._id as any });
      
      if (deleteResult.deletedCount === 0) {
        return res.status(500).json({ message: "Failed to delete hospital" });
      }


      

      // Verify deletion
      const verifyDelete = await Hospital.findById(hospitalId);
      if (verifyDelete) {
        // Try force delete using collection
        await Hospital.collection.deleteOne({ _id: hospital._id as any });
        const verifyAgain = await Hospital.findById(hospitalId);
        if (verifyAgain) {
          return res.status(500).json({ message: "Failed to delete hospital from database" });
        }
      }
      
      await createActivity(
        "HOSPITAL_DELETED",
        "Hospital Deleted",
        `Hospital deleted: ${hospitalInfo.name}`,
        {
          hospitalId: hospitalInfo.hospitalId,
          metadata: { name: hospitalInfo.name },
        }
      );
      
      res.json({ message: "Hospital deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Update Pharmacy
router.patch(
  "/pharmacies/:id",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req, res) => {
    try {
      const pharmacy = await Pharmacy.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
      ) as IPharmacy | null;
      if (!pharmacy) {
        return res.status(404).json({ message: "Pharmacy not found" });
      }
      
      await createActivity(
        "PHARMACY_UPDATED",
        "Pharmacy Updated",
        `Pharmacy updated: ${pharmacy.name}`,
        {
          pharmacyId: String(pharmacy._id),
          metadata: { name: pharmacy.name },
        }
      );
      
      res.json(pharmacy);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Delete Pharmacy
router.delete(
  "/pharmacies/:id",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req, res) => {
    try {
      const pharmacyId = req.params.id;
      const pharmacy = await Pharmacy.findById(pharmacyId) as IPharmacy | null;
      if (!pharmacy) {
        return res.status(404).json({ message: "Pharmacy not found" });
      }

      // Store pharmacy info before deletion
      const pharmacyInfo = {
        name: pharmacy.name,
        pharmacyId: String(pharmacy._id),
      };

      // Delete the pharmacy and verify deletion
      const deleteResult = await Pharmacy.deleteOne({ _id: pharmacy._id as any });
      
      if (deleteResult.deletedCount === 0) {
        return res.status(500).json({ message: "Failed to delete pharmacy" });
      }

      // Verify deletion
      const verifyDelete = await Pharmacy.findById(pharmacyId);
      if (verifyDelete) {
        // Try force delete using collection
        await Pharmacy.collection.deleteOne({ _id: pharmacy._id as any });
        const verifyAgain = await Pharmacy.findById(pharmacyId);
        if (verifyAgain) {
          return res.status(500).json({ message: "Failed to delete pharmacy from database" });
        }
      }
      
      await createActivity(
        "PHARMACY_DELETED",
        "Pharmacy Deleted",
        `Pharmacy deleted: ${pharmacyInfo.name}`,
        {
          pharmacyId: pharmacyInfo.pharmacyId,
          metadata: { name: pharmacyInfo.name },
        }
      );
      
      res.json({ message: "Pharmacy deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Update Distributor
router.patch(
  "/distributors/:id",
  requireAuth,
  async (req, res) => {
    try {
      const userRole = req.user?.role;
      const isAdmin = userRole === "SUPER_ADMIN" || userRole === "HOSPITAL_ADMIN";
      const isDistributor = userRole === "DISTRIBUTOR";
      
      // Check if distributor can only update their own info
      if (isDistributor && !isAdmin) {
        const { User } = await import("../user/user.model");
        const currentUser = await User.findById(req.user!.sub);
        if (currentUser && currentUser.distributorId !== req.params.id) {
          return res.status(403).json({ message: "You can only update your own distributor information" });
        }
      }
      
      const distributor = await Distributor.findByIdAndUpdate(
        req.params.id,
        req.body,
        { new: true, runValidators: true }
      ) as IDistributor | null;
      if (!distributor) {
        return res.status(404).json({ message: "Distributor not found" });
      }
      
      await createActivity(
        "DISTRIBUTOR_UPDATED",
        "Distributor Updated",
        `Distributor updated: ${distributor.name}`,
        {
          distributorId: String(distributor._id),
          metadata: { name: distributor.name },
        }
      );
      
      res.json(distributor);
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);

// Delete Distributor
router.delete(
  "/distributors/:id",
  requireAuth,
  requireRole(["SUPER_ADMIN", "HOSPITAL_ADMIN"]),
  async (req, res) => {
    try {
      const distributorId = req.params.id;
      const distributor = await Distributor.findById(distributorId) as IDistributor | null;
      if (!distributor) {
        return res.status(404).json({ message: "Distributor not found" });
      }

      // Store distributor info before deletion
      const distributorInfo = {
        name: distributor.name,
        distributorId: String(distributor._id),
      };

      // Delete the distributor and verify deletion
      const deleteResult = await Distributor.deleteOne({ _id: distributor._id as any });
      
      if (deleteResult.deletedCount === 0) {
        return res.status(500).json({ message: "Failed to delete distributor" });
      }

      // Verify deletion
      const verifyDelete = await Distributor.findById(distributorId);
      if (verifyDelete) {
        // Try force delete using collection
        await Distributor.collection.deleteOne({ _id: distributor._id as any });
        const verifyAgain = await Distributor.findById(distributorId);
        if (verifyAgain) {
          return res.status(500).json({ message: "Failed to delete distributor from database" });
        }
      }
      
      await createActivity(
        "DISTRIBUTOR_DELETED",
        "Distributor Deleted",
        `Distributor deleted: ${distributorInfo.name}`,
        {
          distributorId: distributorInfo.distributorId,
          metadata: { name: distributorInfo.name },
        }
      );
      
      res.json({ message: "Distributor deleted successfully" });
    } catch (error: any) {
      res.status(400).json({ message: error.message });
    }
  }
);
