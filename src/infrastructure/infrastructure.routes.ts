import { Router } from "express";
import { Room } from "./room.model";
import { Bed } from "./bed.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

const ADMIN_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN"];
const STAFF_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN", "RECEPTIONIST", "NURSE"];

// ─── ROOMS ────────────────────────────────────────────────────────────────────

router.post("/rooms", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const room = await Room.create(req.body);
    // Auto-create beds
    const bedCount = req.body.totalBeds || 1;
    const beds = [];
    for (let i = 1; i <= bedCount; i++) {
      beds.push({
        hospitalId: req.body.hospitalId,
        roomId: room._id,
        bedNumber: `${room.roomNumber}-B${i}`,
        status: "AVAILABLE",
      });
    }
    await Bed.insertMany(beds);
    res.status(201).json(room);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/rooms", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const { hospitalId, floor, status, roomType } = req.query;
    const filter: any = {};
    if (hospitalId) filter.hospitalId = hospitalId;
    if (floor) filter.floor = Number(floor);
    if (status) filter.status = status;
    if (roomType) filter.roomType = roomType;
    filter.isActive = true;
    const rooms = await Room.find(filter).sort({ floor: 1, roomNumber: 1 });
    res.json(rooms);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.get("/rooms/:id", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const room = await Room.findById(req.params.id);
    if (!room) return res.status(404).json({ message: "Room not found" });
    res.json(room);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.patch("/rooms/:id", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const room = await Room.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!room) return res.status(404).json({ message: "Room not found" });
    res.json(room);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.delete("/rooms/:id", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    await Room.findByIdAndUpdate(req.params.id, { isActive: false });
    res.json({ message: "Room deactivated" });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// ─── BEDS ─────────────────────────────────────────────────────────────────────

router.get("/beds", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const { hospitalId, roomId, status } = req.query;
    const filter: any = { isActive: true };
    if (hospitalId) filter.hospitalId = hospitalId;
    if (roomId) filter.roomId = roomId;
    if (status) filter.status = status;
    const beds = await Bed.find(filter).populate("roomId", "roomNumber floor roomType");
    res.json(beds);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.post("/beds", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const bed = await Bed.create(req.body);
    res.status(201).json(bed);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

router.patch("/beds/:id", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const bed = await Bed.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!bed) return res.status(404).json({ message: "Bed not found" });
    res.json(bed);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get available beds for a hospital
router.get("/available-beds", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const { hospitalId, roomType } = req.query;
    const filter: any = { status: "AVAILABLE", isActive: true };
    if (hospitalId) filter.hospitalId = hospitalId;

    const beds = await Bed.find(filter).populate({
      path: "roomId",
      match: roomType ? { roomType, isActive: true } : { isActive: true },
      select: "roomNumber floor roomType rentPerDay",
    });

    const available = beds.filter((b) => b.roomId !== null);
    res.json(available);
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Get occupancy stats
router.get("/occupancy", requireAuth, requireRole(STAFF_ROLES), async (req, res) => {
  try {
    const { hospitalId } = req.query;
    const filter: any = { isActive: true };
    if (hospitalId) filter.hospitalId = hospitalId;

    const [total, occupied, available, cleaning] = await Promise.all([
      Bed.countDocuments(filter),
      Bed.countDocuments({ ...filter, status: "OCCUPIED" }),
      Bed.countDocuments({ ...filter, status: "AVAILABLE" }),
      Bed.countDocuments({ ...filter, status: "CLEANING" }),
    ]);

    res.json({ total, occupied, available, cleaning, occupancyRate: total ? Math.round((occupied / total) * 100) : 0 });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});
