import mongoose from 'mongoose';

const ipAdmissionSchema = new mongoose.Schema(
  {
    ipId: {
      type: String,
      unique: true,
      required: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PatientRecord',
      required: true,
    },
    admissionDate: {
      type: Date,
      required: true,
    },
    expectedDays: {
      type: Number,
      required: true,
    },
    dischargeDate: {
      type: Date,
    },
    casualtyFlag: {
      type: Boolean,
      default: false,
    },
    emergencyFlag: {
      type: Boolean,
      default: false,
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DoctorRecord',
      required: true,
    },
    roomId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Room',
      required: true,
    },
    bedId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bed',
      required: true,
    },
    roomRentPerDay: {
      type: Number,
      required: true,
    },
    status: {
      type: String,
      enum: ['ADMITTED', 'UNDER_OBSERVATION', 'READY_FOR_DISCHARGE', 'DISCHARGED'],
      default: 'ADMITTED',
    },
    totalCharges: {
      type: Number,
      default: 0,
    },
    paidAmount: {
      type: Number,
      default: 0,
    },
    outstandingBalance: {
      type: Number,
      default: 0,
    },
  },
  { timestamps: true }
);

export const IPAdmission = mongoose.model('IPAdmission', ipAdmissionSchema);