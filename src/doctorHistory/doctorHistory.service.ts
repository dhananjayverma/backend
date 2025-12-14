import { DoctorPatientHistory, IDoctorPatientHistory, HistoryType } from "./doctorHistory.model";

interface CreateHistoryParams {
  doctorId: string;
  patientId: string;
  patientName: string;
  historyType: HistoryType;
  appointmentId?: string;
  appointmentDate?: Date;
  appointmentStatus?: string;
  prescriptionId?: string;
  prescriptionItems?: Array<{
    medicineName: string;
    dosage: string;
    frequency: string;
    duration: string;
  }>;
  prescriptionNotes?: string;
  reportRequest?: string;
  reportType?: string;
  reportFile?: string;
  diagnosis?: string;
  treatment?: string;
  doctorNotes?: string;
  metadata?: Record<string, any>;
}

export async function createDoctorPatientHistory(
  params: CreateHistoryParams
): Promise<IDoctorPatientHistory> {
  try {
    console.log("📝 Creating doctor-patient history with params:", {
      doctorId: params.doctorId,
      patientId: params.patientId,
      historyType: params.historyType,
    });
    
    const history = await DoctorPatientHistory.create(params);
    console.log("✅ History created successfully:", history._id);
    return history;
  } catch (error: any) {
    console.error("❌ Error creating doctor-patient history:", error);
    console.error("Error details:", {
      message: error.message,
      stack: error.stack,
      name: error.name,
      code: error.code,
    });
    throw error;
  }
}

export async function getDoctorPatientHistory(
  doctorId: string,
  patientId?: string,
  limit: number = 100
): Promise<IDoctorPatientHistory[]> {
  const query: any = { doctorId };
  if (patientId) {
    query.patientId = patientId;
  }
  
  return await DoctorPatientHistory.find(query)
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean()
    .exec() as unknown as IDoctorPatientHistory[];
}

export async function getDoctorPatientCount(doctorId: string): Promise<number> {
  const result = await DoctorPatientHistory.aggregate([
    { $match: { doctorId } },
    { $group: { _id: "$patientId" } },
    { $count: "total" },
  ]);
  
  return result[0]?.total || 0;
}

export async function getDoctorStats(doctorId: string): Promise<{
  totalPatients: number;
  totalAppointments: number;
  totalPrescriptions: number;
  totalReports: number;
}> {
  const [totalPatients, appointments, prescriptions, reports] = await Promise.all([
    getDoctorPatientCount(doctorId),
    DoctorPatientHistory.countDocuments({ doctorId, historyType: "APPOINTMENT" }),
    DoctorPatientHistory.countDocuments({ doctorId, historyType: "PRESCRIPTION" }),
    DoctorPatientHistory.countDocuments({ 
      doctorId, 
      historyType: { $in: ["REPORT_REQUEST", "REPORT_RECEIVED"] } 
    }),
  ]);
  
  return {
    totalPatients,
    totalAppointments: appointments,
    totalPrescriptions: prescriptions,
    totalReports: reports,
  };
}

export async function getPatientHistoryByDoctor(
  doctorId: string,
  patientId: string
): Promise<IDoctorPatientHistory[]> {
  return await DoctorPatientHistory.find({ doctorId, patientId })
    .sort({ createdAt: -1 })
    .lean()
    .exec() as unknown as IDoctorPatientHistory[];
}

