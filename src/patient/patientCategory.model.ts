import mongoose from 'mongoose';

const patientCategorySchema = new mongoose.Schema(
  {
    patientId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: 'PatientRecord',
      required: true,
    },
    category: {
      type: String,
      enum: ['IP', 'OP', 'SERVICES'],
      required: true,
    },
    categoryId: {
      type: String,
      unique: true,
      sparse: true,
    },
    status: {
      type: String,
      enum: ['ACTIVE', 'DISCHARGED', 'CANCELLED'],
      default: 'ACTIVE',
    },
    registrationDate: {
      type: Date,
      default: Date.now,
    },
  },
  { timestamps: true }
);

export const PatientCategory = mongoose.model('PatientCategory', patientCategorySchema);