import { Router } from "express";
import { IPAdmission } from "../patient/ipAdmission.model";
import { OPRegistration } from "../patient/opRegistration.model";
import { ServiceRegistration } from "../patient/serviceRegistration.model";
import { Bill } from "../billing/bill.model";
import { Bed } from "../infrastructure/bed.model";
import { NurseTimesheet } from "../nurse/nurseTimesheet.model";
import { User } from "../user/user.model";
import { requireAuth, requireRole } from "../shared/middleware/auth";

export const router = Router();

const ADMIN_ROLES = ["SUPER_ADMIN", "HOSPITAL_ADMIN"];

// Daily OP count
router.get("/daily-op", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { hospitalId, date } = req.query;
    const d = date ? new Date(date as string) : new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(start); end.setDate(end.getDate() + 1);

    const count = await OPRegistration.countDocuments({ registrationDate: { $gte: start, $lt: end } });
    const records = await OPRegistration.find({ registrationDate: { $gte: start, $lt: end } })
      .populate("patientId", "name phone gender age")
      .populate("doctorId", "name specialization");
    res.json({ date: start, count, records });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Daily IP admissions
router.get("/daily-ip", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { date } = req.query;
    const d = date ? new Date(date as string) : new Date();
    const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    const end = new Date(start); end.setDate(end.getDate() + 1);

    const count = await IPAdmission.countDocuments({ admissionDate: { $gte: start, $lt: end } });
    const emergency = await IPAdmission.countDocuments({ admissionDate: { $gte: start, $lt: end }, $or: [{ emergencyFlag: true }, { casualtyFlag: true }] });
    const records = await IPAdmission.find({ admissionDate: { $gte: start, $lt: end } })
      .populate("patientId", "name phone gender")
      .populate("doctorId", "name");
    res.json({ date: start, count, emergency, records });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Revenue report (daily/range)
router.get("/revenue", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { hospitalId, from, to } = req.query;
    const filter: any = {};
    if (hospitalId) filter.hospitalId = hospitalId;
    if (from || to) {
      filter.createdAt = {};
      if (from) filter.createdAt.$gte = new Date(from as string);
      if (to) filter.createdAt.$lte = new Date(to as string);
    }

    const bills = await Bill.find(filter);
    const totalBilled = bills.reduce((s, b) => s + b.grandTotal, 0);
    const totalCollected = bills.reduce((s, b) => s + b.paidAmount, 0);
    const totalPending = bills.reduce((s, b) => s + b.outstandingBalance, 0);

    const byType = {
      IP: { billed: 0, collected: 0 },
      OP: { billed: 0, collected: 0 },
      SERVICE: { billed: 0, collected: 0 },
    };
    bills.forEach((b) => {
      const t = b.billType as "IP" | "OP" | "SERVICE";
      if (byType[t]) {
        byType[t].billed += b.grandTotal;
        byType[t].collected += b.paidAmount;
      }
    });

    // Payment mode breakdown
    const byMode: Record<string, number> = { CASH: 0, CARD: 0, UPI: 0, INSURANCE: 0 };
    bills.forEach((b) => {
      b.paymentHistory.forEach((p: any) => {
        byMode[p.mode] = (byMode[p.mode] || 0) + p.amount;
      });
    });

    res.json({ totalBilled, totalCollected, totalPending, byType, byMode, billCount: bills.length });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Bed occupancy report
router.get("/bed-occupancy", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { hospitalId } = req.query;
    const filter: any = { isActive: true };
    if (hospitalId) filter.hospitalId = hospitalId;

    const [total, occupied, available, cleaning, maintenance] = await Promise.all([
      Bed.countDocuments(filter),
      Bed.countDocuments({ ...filter, status: "OCCUPIED" }),
      Bed.countDocuments({ ...filter, status: "AVAILABLE" }),
      Bed.countDocuments({ ...filter, status: "CLEANING" }),
      Bed.countDocuments({ ...filter, status: "MAINTENANCE" }),
    ]);

    const occupancyRate = total ? Math.round((occupied / total) * 100) : 0;
    res.json({ total, occupied, available, cleaning, maintenance, occupancyRate });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Pending dues report
router.get("/pending-dues", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { hospitalId } = req.query;
    const filter: any = { outstandingBalance: { $gt: 0 }, status: { $nin: ["CANCELLED", "PAID"] } };
    if (hospitalId) filter.hospitalId = hospitalId;

    const bills = await Bill.find(filter)
      .populate("patientId", "name phone")
      .sort({ outstandingBalance: -1 });

    const total = bills.reduce((s, b) => s + b.outstandingBalance, 0);
    res.json({ total, count: bills.length, bills });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Discharge summary report
router.get("/discharge-summary", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { from, to } = req.query;
    const filter: any = { status: "DISCHARGED" };
    if (from || to) {
      filter.dischargeDate = {};
      if (from) filter.dischargeDate.$gte = new Date(from as string);
      if (to) filter.dischargeDate.$lte = new Date(to as string);
    }

    const records = await IPAdmission.find(filter)
      .populate("patientId", "name phone gender age")
      .populate("doctorId", "name specialization");

    res.json({ count: records.length, records });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Nurse attendance/shift report
router.get("/nurse-attendance", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { hospitalId, from, to } = req.query;
    const filter: any = {};
    if (hospitalId) filter.hospitalId = hospitalId;
    if (from || to) {
      filter.date = {};
      if (from) filter.date.$gte = new Date(from as string);
      if (to) filter.date.$lte = new Date(to as string);
    }

    const sheets = await NurseTimesheet.find(filter)
      .populate("nurseId", "name department")
      .sort({ date: -1 });

    // Group by nurse
    const byNurse: Record<string, any> = {};
    sheets.forEach((s) => {
      const nid = String(s.nurseId);
      if (!byNurse[nid]) byNurse[nid] = { nurse: s.nurseId, dayShifts: 0, nightShifts: 0, emergencies: 0, total: 0 };
      byNurse[nid].total++;
      if (s.shiftType === "DAY") byNurse[nid].dayShifts++;
      else byNurse[nid].nightShifts++;
      if (s.emergencyFlag) byNurse[nid].emergencies++;
    });

    res.json({ total: sheets.length, byNurse: Object.values(byNurse) });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Doctor-wise revenue report
router.get("/doctor-revenue", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { hospitalId, from, to } = req.query;
    const filter: any = {};
    if (hospitalId) filter.hospitalId = hospitalId;
    if (from || to) {
      filter.registrationDate = {};
      if (from) filter.registrationDate.$gte = new Date(from as string);
      if (to) filter.registrationDate.$lte = new Date(to as string);
    }

    const ops = await OPRegistration.find(filter).populate("doctorId", "name specialization serviceCharge");
    const ips = await IPAdmission.find(filter).populate("doctorId", "name specialization serviceCharge");

    const byDoctor: Record<string, any> = {};

    ops.forEach((op: any) => {
      const doc = op.doctorId;
      if (!doc) return;
      const id = String(doc._id);
      if (!byDoctor[id]) byDoctor[id] = { doctor: { _id: doc._id, name: doc.name, specialization: doc.specialization }, opCount: 0, ipCount: 0, opRevenue: 0, ipRevenue: 0 };
      byDoctor[id].opCount++;
      byDoctor[id].opRevenue += op.consultationFee || 0;
    });

    ips.forEach((ip: any) => {
      const doc = ip.doctorId;
      if (!doc) return;
      const id = String(doc._id);
      if (!byDoctor[id]) byDoctor[id] = { doctor: { _id: doc._id, name: doc.name, specialization: doc.specialization }, opCount: 0, ipCount: 0, opRevenue: 0, ipRevenue: 0 };
      byDoctor[id].ipCount++;
      byDoctor[id].ipRevenue += ip.expectedDays ? (ip.roomRentPerDay || 0) * ip.expectedDays : 0;
    });

    const result = Object.values(byDoctor).map((d: any) => ({
      ...d,
      totalPatients: d.opCount + d.ipCount,
      totalRevenue: d.opRevenue + d.ipRevenue,
    })).sort((a: any, b: any) => b.totalRevenue - a.totalRevenue);

    res.json({ count: result.length, doctors: result });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});

// Consolidated patient search (all charges, payments, outstanding)
router.get("/patient-consolidated", requireAuth, requireRole(ADMIN_ROLES), async (req, res) => {
  try {
    const { q, hospitalId } = req.query;
    if (!q) return res.status(400).json({ message: "Query parameter 'q' is required" });

    const searchStr = q as string;
    const hospitalFilter = hospitalId ? { hospitalId } : {};

    // Try to find by IP ID
    const ipByIpId = await IPAdmission.findOne({ ipId: searchStr, ...hospitalFilter })
      .populate("patientId", "name phone gender age address email")
      .populate("doctorId", "name specialization")
      .populate("roomId", "roomNumber roomType floor")
      .populate("bedId", "bedNumber");

    // Try to find by OP ID
    const opByOpId = await OPRegistration.findOne({ opId: searchStr, ...hospitalFilter })
      .populate("patientId", "name phone gender age address email")
      .populate("doctorId", "name specialization");

    // Try to find by patient name/phone (partial match)
    let patientFilter: any = {};
    if (!ipByIpId && !opByOpId) {
      const users = await User.find({
        role: "PATIENT",
        $or: [
          { name: { $regex: searchStr, $options: "i" } },
          { phone: { $regex: searchStr, $options: "i" } },
          { email: { $regex: searchStr, $options: "i" } },
        ],
      }).select("_id name phone email");

      if (users.length === 0) return res.json({ results: [] });

      const patientIds = users.map(u => u._id);
      patientFilter = { patientId: { $in: patientIds } };
    }

    const ipFilter = ipByIpId ? { _id: ipByIpId._id } : patientFilter;
    const opFilter = opByOpId ? { _id: opByOpId._id } : patientFilter;

    const [ipAdmissions, opRegistrations, serviceRegs] = await Promise.all([
      IPAdmission.find({ ...ipFilter, ...hospitalFilter })
        .populate("patientId", "name phone gender age address")
        .populate("doctorId", "name specialization")
        .populate("roomId", "roomNumber roomType floor")
        .populate("bedId", "bedNumber")
        .sort({ createdAt: -1 }).limit(10),
      OPRegistration.find({ ...opFilter, ...hospitalFilter })
        .populate("patientId", "name phone gender age")
        .populate("doctorId", "name specialization")
        .sort({ createdAt: -1 }).limit(20),
      ServiceRegistration.find({ ...patientFilter, ...hospitalFilter })
        .populate("patientId", "name phone")
        .sort({ createdAt: -1 }).limit(20),
    ]);

    // Gather bill IDs from admissions and OPs
    const refIds = [
      ...ipAdmissions.map((a: any) => a.ipId),
      ...opRegistrations.map((o: any) => o.opId),
    ];

    const bills = await Bill.find({ referenceId: { $in: refIds } })
      .select("referenceId billType grandTotal paidAmount outstandingBalance status lineItems paymentHistory isFrozen billNumber");

    const billMap: Record<string, any> = {};
    bills.forEach(b => { billMap[b.referenceId] = b; });

    const ipResults = ipAdmissions.map((a: any) => ({
      type: "IP",
      id: a.ipId,
      patient: a.patientId,
      doctor: a.doctorId,
      room: a.roomId,
      bed: a.bedId,
      admissionDate: a.admissionDate,
      status: a.status,
      bill: billMap[a.ipId] || null,
    }));

    const opResults = opRegistrations.map((o: any) => ({
      type: "OP",
      id: o.opId,
      patient: o.patientId,
      doctor: o.doctorId,
      token: o.tokenNumber,
      registrationDate: o.registrationDate,
      status: o.status,
      bill: billMap[o.opId] || null,
    }));

    const svcResults = serviceRegs.map((s: any) => ({
      type: "SERVICE",
      id: s.serviceRegId,
      patient: s.patientId,
      registrationDate: s.registrationDate || s.createdAt,
      status: s.status,
      grandTotal: s.grandTotal,
      paidAmount: s.paidAmount,
      outstandingBalance: s.outstandingBalance,
    }));

    const results = [...ipResults, ...opResults, ...svcResults].sort(
      (a: any, b: any) => new Date(b.admissionDate || b.registrationDate).getTime() - new Date(a.admissionDate || a.registrationDate).getTime()
    );

    const totalBilled = bills.reduce((s, b) => s + b.grandTotal, 0)
      + serviceRegs.reduce((s: number, r: any) => s + (r.grandTotal || 0), 0);
    const totalPaid = bills.reduce((s, b) => s + b.paidAmount, 0)
      + serviceRegs.reduce((s: number, r: any) => s + (r.paidAmount || 0), 0);
    const totalOutstanding = bills.reduce((s, b) => s + b.outstandingBalance, 0)
      + serviceRegs.reduce((s: number, r: any) => s + (r.outstandingBalance || 0), 0);

    res.json({ results, summary: { totalBilled, totalPaid, totalOutstanding, ipCount: ipResults.length, opCount: opResults.length, svcCount: svcResults.length } });
  } catch (error: any) {
    res.status(400).json({ message: error.message });
  }
});
