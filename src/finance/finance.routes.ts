import { Router, Request, Response } from "express";
import { FinanceEntry, IFinanceEntry } from "./finance.model";

export const router = Router();

const DEFAULT_LIMIT = 1000;
const DEFAULT_PERIOD = "MONTHLY";

interface DateFilter {
  $gte?: Date;
  $lte?: Date;
}

interface FinanceSummary {
  revenue: number;
  expenses: number;
  netProfit: number;
  count: number;
}

const createDateFilter = (from?: string, to?: string): DateFilter | null => {
  if (!from && !to) return null;
  
  const filter: DateFilter = {};
  if (from) filter.$gte = new Date(from);
  if (to) filter.$lte = new Date(to);
  return filter;
};

const calculateFinanceSummary = (entries: IFinanceEntry[]): FinanceSummary => {
  let revenue = 0;
  let expenses = 0;

  entries.forEach((entry) => {
    if (entry.amount > 0) {
      revenue += entry.amount;
    } else {
      expenses += Math.abs(entry.amount);
    }
  });

  return {
    revenue,
    expenses,
    netProfit: revenue - expenses,
    count: entries.length,
  };
};

const getPeriodKey = (date: Date, period: string): string => {
  if (period === "DAILY") {
    return date.toISOString().split("T")[0];
  } else if (period === "MONTHLY") {
    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}`;
  } else {
    return String(date.getFullYear());
  }
};

router.post("/", async (req: Request, res: Response) => {
  try {
    const entry = await FinanceEntry.create(req.body);
    res.status(201).json(entry);
  } catch (error: any) {
    console.error("Error creating finance entry:", error);
    res.status(500).json({ message: "Failed to create finance entry", error: error.message });
  }
});

router.get("/reports", async (req: Request, res: Response) => {
  try {
    const { from, to, hospitalId, pharmacyId, type } = req.query;
    const filter: any = {};
    
    const dateFilter = createDateFilter(from as string, to as string);
    if (dateFilter) filter.occurredAt = dateFilter;
    
    if (hospitalId) filter.hospitalId = hospitalId;
    if (pharmacyId) filter.pharmacyId = pharmacyId;
    if (type) filter.type = type;

    const entries = await FinanceEntry.find(filter).limit(DEFAULT_LIMIT);
    const summary = calculateFinanceSummary(entries);

    res.json({
      ...summary,
      total: summary.revenue - summary.expenses,
      entries,
    });
  } catch (error: any) {
    console.error("Error fetching finance reports:", error);
    res.status(500).json({ message: "Failed to fetch finance reports", error: error.message });
  }
});

router.get("/summary", async (req: Request, res: Response) => {
  try {
    const { from, to, hospitalId, pharmacyId, patientId } = req.query;
    const filter: any = {};
    
    const dateFilter = createDateFilter(from as string, to as string);
    if (dateFilter) filter.occurredAt = dateFilter;
    
    if (hospitalId) filter.hospitalId = hospitalId;
    if (pharmacyId) filter.pharmacyId = pharmacyId;
    if (patientId) filter.patientId = patientId;

    const entries = await FinanceEntry.find(filter).limit(DEFAULT_LIMIT);
    
    // Calculate revenue (positive amounts) and expenses (negative amounts) separately
    let revenue = 0;
    let expenses = 0;
    
    entries.forEach((entry) => {
      if (entry.amount > 0) {
        revenue += entry.amount;
      } else {
        expenses += Math.abs(entry.amount);
      }
    });
    
    const total = revenue - expenses; // Net profit
    const summary = calculateFinanceSummary(entries);

    res.json({ 
      total, 
      revenue, 
      expenses, 
      netProfit: total,
      count: entries.length, 
      entries 
    });
  } catch (error: any) {
    console.error("Error fetching finance summary:", error);
    res.status(500).json({ message: "Failed to fetch finance summary", error: error.message });
  }
});

router.get("/reports/hospital/:id", async (req: Request, res: Response) => {
  try {
    const { from, to } = req.query;
    const filter: any = { hospitalId: req.params.id };
    
    const dateFilter = createDateFilter(from as string, to as string);
    if (dateFilter) filter.occurredAt = dateFilter;

    const entries = await FinanceEntry.find(filter).sort({ occurredAt: -1 });
    const summary = calculateFinanceSummary(entries);

    res.json({
      hospitalId: req.params.id,
      totalRevenue: summary.revenue,
      totalExpenses: summary.expenses,
      netProfit: summary.netProfit,
      count: summary.count,
      entries,
    });
  } catch (error: any) {
    console.error("Error fetching hospital finance report:", error);
    res.status(500).json({ message: "Failed to fetch hospital finance report", error: error.message });
  }
});

router.get("/reports/unit/:type", async (req: Request, res: Response) => {
  try {
    const { from, to, id } = req.query;
    const filter: any = {};
    
    const dateFilter = createDateFilter(from as string, to as string);
    if (dateFilter) filter.occurredAt = dateFilter;

    const unitType = req.params.type;
    if (unitType === "DOCTOR" && id) {
      filter.doctorId = id;
    } else if (unitType === "PHARMACY" && id) {
      filter.pharmacyId = id;
    } else if (unitType === "DISTRIBUTOR" && id) {
      filter.distributorId = id;
    }

    const entries = await FinanceEntry.find(filter).sort({ occurredAt: -1 });
    const summary = calculateFinanceSummary(entries);

    res.json({
      unitType,
      unitId: id,
      totalRevenue: summary.revenue,
      totalExpenses: summary.expenses,
      netProfit: summary.netProfit,
      count: summary.count,
      entries,
    });
  } catch (error: any) {
    console.error("Error fetching unit finance report:", error);
    res.status(500).json({ message: "Failed to fetch unit finance report", error: error.message });
  }
});

router.get("/reports/time", async (req: Request, res: Response) => {
  try {
    const { period = DEFAULT_PERIOD, from, to } = req.query;
    const filter: any = {};
    
    const dateFilter = createDateFilter(from as string, to as string);
    if (dateFilter) filter.occurredAt = dateFilter;

    const entries = await FinanceEntry.find(filter).sort({ occurredAt: -1 });
    
    const grouped: Record<string, { revenue: number; expenses: number; count: number }> = {};
    
    entries.forEach((entry) => {
      const date = new Date(entry.occurredAt);
      const key = getPeriodKey(date, period as string);

      if (!grouped[key]) {
        grouped[key] = { revenue: 0, expenses: 0, count: 0 };
      }
      
      if (entry.amount > 0) {
        grouped[key].revenue += entry.amount;
      } else {
        grouped[key].expenses += Math.abs(entry.amount);
      }
      grouped[key].count += 1;
    });

    const summary = calculateFinanceSummary(entries);

    res.json({
      period,
      summary: Object.entries(grouped).map(([periodKey, data]) => ({
        period: periodKey,
        revenue: data.revenue,
        expenses: data.expenses,
        netProfit: data.revenue - data.expenses,
        count: data.count,
      })),
      totalRevenue: summary.revenue,
      totalExpenses: summary.expenses,
    });
  } catch (error: any) {
    console.error("Error fetching time-based finance report:", error);
    res.status(500).json({ message: "Failed to fetch time-based finance report", error: error.message });
  }
});
