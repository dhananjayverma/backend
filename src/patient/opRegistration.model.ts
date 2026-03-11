import mongoose from 'mongoose';

const opRegistrationSchema = new mongoose.Schema(
  {
    opId: {
      type: String,
      unique: true,
      required: true,
    },
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PatientRecord',
      required: true,
    },
    registrationDate: {
      type: Date,
      default: Date.now,
    },
    doctorId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'DoctorRecord',
      required: true,
    },
    consultationFee: {
      type: Number,
      required: true,
    },
    tokenNumber: {
      type: String,
      unique: true,
    },
    consultationStatus: {
      type: String,
      enum: ['WAITING', 'IN_CONSULTATION', 'COMPLETED', 'NO_SHOW'],
      default: 'WAITING',
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'CLOSED'],
      default: 'ACTIVE',
    },
    billId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'Bill',
    },
  },
  { timestamps: true }
);

export const OPRegistration = mongoose.model('OPRegistration', opRegistrationSchema);