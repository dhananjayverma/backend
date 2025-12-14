import mongoose from "mongoose";
import { User } from "../../user/user.model";
import { InventoryItem } from "../../inventory/inventory.model";
import { Prescription } from "../../prescription/prescription.model";
import { Appointment } from "../../appointment/appointment.model";
import { Order } from "../../order/order.model";
import { FinanceEntry } from "../../finance/finance.model";
import { Hospital } from "../../master/hospital.model";
import { Pharmacy } from "../../master/pharmacy.model";
import { PatientRecord } from "../../patient/patientRecord.model";

export class IndexService {
  private static async createIndex(
    collection: mongoose.Collection,
    index: any,
    options?: any
  ): Promise<void> {
    try {
      await collection.createIndex(index, options);
    } catch (e: any) {
      if (e.code === 85 || e.codeName === "IndexOptionsConflict" || e.message?.includes("already exists")) {
        // Index already exists, skip
      } else {
        throw e;
      }
    }
  }

  private static async findDuplicates(collection: mongoose.Collection, field: string) {
    return await collection.aggregate([
      { $group: { _id: `$${field}`, count: { $sum: 1 }, ids: { $push: "$_id" } } },
      { $match: { count: { $gt: 1 } } },
    ]).toArray();
  }

  private static mergeArrayFields(primary: any[], duplicates: any[][]): any[] {
    return [...new Set([...primary, ...duplicates.flat()])];
  }

  private static mergeDateSortedArrays(primary: any[], duplicates: any[][], dateField: string = "date"): any[] {
    return [...primary, ...duplicates.flat()].sort(
      (a: any, b: any) => new Date(b[dateField]).getTime() - new Date(a[dateField]).getTime()
    );
  }

  private static async mergeDuplicatePatientRecords(): Promise<void> {
    console.log("🔍 Checking for duplicate patientId records...");
    const duplicates = await this.findDuplicates(PatientRecord.collection, "patientId");

    if (duplicates.length === 0) {
      console.log("✅ No duplicate patientId records found");
      return;
    }

    console.log(`⚠️  Found ${duplicates.length} duplicate patientId(s), merging records...`);

    for (const dup of duplicates) {
      try {
        const records = await PatientRecord.find({ patientId: dup._id })
          .sort({ updatedAt: -1, createdAt: -1 })
          .lean();

        if (records.length <= 1) continue;

        const [primaryRecord, ...duplicateRecords] = records;

        const mergedRecord: any = {
          ...primaryRecord,
          diagnosis: this.mergeArrayFields(primaryRecord.diagnosis || [], duplicateRecords.map((r: any) => r.diagnosis || [])),
          allergies: this.mergeArrayFields(primaryRecord.allergies || [], duplicateRecords.map((r: any) => r.allergies || [])),
          currentMedications: this.mergeArrayFields(primaryRecord.currentMedications || [], duplicateRecords.map((r: any) => r.currentMedications || [])),
          pastSurgeries: this.mergeArrayFields(primaryRecord.pastSurgeries || [], duplicateRecords.map((r: any) => r.pastSurgeries || [])),
          hospitalizationHistory: this.mergeDateSortedArrays(
            primaryRecord.hospitalizationHistory || [],
            duplicateRecords.map((r: any) => r.hospitalizationHistory || []),
            "date"
          ),
          labReports: this.mergeDateSortedArrays(
            primaryRecord.labReports || [],
            duplicateRecords.map((r: any) => r.labReports || []),
            "date"
          ),
        };

        const allNotes = [
          primaryRecord.notes,
          ...duplicateRecords.map((r: any) => r.notes).filter(Boolean),
        ].filter(Boolean);

        if (allNotes.length > 1) {
          mergedRecord.notes = allNotes.join("\n\n--- Merged from duplicate record ---\n\n");
        } else if (allNotes.length === 1) {
          mergedRecord.notes = allNotes[0];
        }

        await PatientRecord.findByIdAndUpdate(primaryRecord._id, mergedRecord);

        const duplicateIds = duplicateRecords.map((r: any) => r._id);
        await PatientRecord.deleteMany({ _id: { $in: duplicateIds } });

        console.log(`✅ Merged ${duplicateRecords.length} duplicate record(s) for patientId: ${dup._id}`);
      } catch (e: any) {
        console.error(`⚠️  Error merging duplicates for patientId ${dup._id}:`, e.message);
      }
    }

    const remainingDuplicates = await this.findDuplicates(PatientRecord.collection, "patientId");

    if (remainingDuplicates.length > 0) {
      console.error(`❌ Still have ${remainingDuplicates.length} duplicate(s). Please run: npm run fix-duplicates`);
      throw new Error(`Cannot create unique index: ${remainingDuplicates.length} duplicate patientId records still exist`);
    }

    console.log("✅ All duplicates merged successfully");
  }

  private static async createPatientRecordUniqueIndex(): Promise<void> {
    try {
      const existingIndexes = await PatientRecord.collection.indexes();
      const existingNonUniqueIndex = existingIndexes.find(
        (idx: any) => idx.name === "patientId_1" && !idx.unique
      );

      if (existingNonUniqueIndex) {
        await PatientRecord.collection.dropIndex("patientId_1");
        console.log("⚠️  Dropped existing non-unique patientId index");
      }
    } catch (e) {
      // Index might not exist, continue
    }

    try {
      await PatientRecord.collection.createIndex(
        { patientId: 1 },
        { unique: true, name: "patientId_unique" }
      );
      console.log("✅ Created unique patientId index");
    } catch (e: any) {
      if (e.message?.includes("already exists") || e.code === 85 || e.codeName === "IndexOptionsConflict") {
        console.log("✅ Patient Record unique index already exists");
      } else if (e.code === 11000 || e.codeName === "DuplicateKey") {
        console.error("❌ Still have duplicate patientId values. Please clean up duplicates manually.");
        console.error("   Run this query to find duplicates:");
        console.error('   db.patientrecords.aggregate([{$group: {_id: "$patientId", count: {$sum: 1}, ids: {$push: "$_id"}}}, {$match: {count: {$gt: 1}}}])');
      } else {
        console.error("⚠️  Error creating index:", e.message);
      }
    }
  }

  static async createAllIndexes(): Promise<void> {
    console.log("📊 Creating database indexes...");

    try {
      await this.createIndex(User.collection, { name: "text" });
      await this.createIndex(User.collection, { role: 1, isActive: 1 });
      await this.createIndex(User.collection, { hospitalId: 1 });
      await this.createIndex(User.collection, { pharmacyId: 1 });
      console.log("✅ User indexes created");

      await this.createIndex(InventoryItem.collection, { medicineName: "text", batchNumber: "text" });
      await this.createIndex(InventoryItem.collection, { pharmacyId: 1, medicineName: 1 });
      await this.createIndex(InventoryItem.collection, { quantity: 1, threshold: 1 });
      await this.createIndex(InventoryItem.collection, { expiryDate: 1 });
      console.log("✅ Inventory indexes created");

      await this.createIndex(Prescription.collection, { "items.medicineName": "text", notes: "text" });
      await this.createIndex(Prescription.collection, { patientId: 1, doctorId: 1 });
      await this.createIndex(Prescription.collection, { createdAt: -1 });
      console.log("✅ Prescription indexes created");

      await this.createIndex(Appointment.collection, { patientId: 1, doctorId: 1 });
      await this.createIndex(Appointment.collection, { scheduledAt: 1 });
      await this.createIndex(Appointment.collection, { status: 1, scheduledAt: 1 });
      await this.createIndex(Appointment.collection, { hospitalId: 1 });
      console.log("✅ Appointment indexes created");

      await this.createIndex(Order.collection, { patientId: 1, status: 1 });
      await this.createIndex(Order.collection, { pharmacyId: 1, status: 1 });
      await this.createIndex(Order.collection, { createdAt: -1 });
      console.log("✅ Order indexes created");

      await this.createIndex(FinanceEntry.collection, { type: 1, occurredAt: -1 });
      await this.createIndex(FinanceEntry.collection, { hospitalId: 1, occurredAt: -1 });
      await this.createIndex(FinanceEntry.collection, { pharmacyId: 1, occurredAt: -1 });
      await this.createIndex(FinanceEntry.collection, { occurredAt: -1 });
      console.log("✅ Finance indexes created");

      await this.createIndex(Hospital.collection, { name: "text", address: "text" });
      await this.createIndex(Hospital.collection, { isActive: 1 });
      console.log("✅ Hospital indexes created");

      await this.createIndex(Pharmacy.collection, { name: "text", address: "text" });
      await this.createIndex(Pharmacy.collection, { isActive: 1 });
      console.log("✅ Pharmacy indexes created");

      await this.mergeDuplicatePatientRecords();
      await this.createPatientRecordUniqueIndex();
      console.log("✅ Patient Record indexes processed");

      console.log("✅ All indexes created successfully");
    } catch (error: any) {
      if (error.message?.includes("duplicate key") && error.message?.includes("patientId")) {
        console.error("❌ Error creating patientId unique index: Duplicate records exist");
        console.error("   Please run: npm run fix-duplicates");
        console.error("   Or manually clean up duplicate patientId records in MongoDB");
      } else {
        console.error("❌ Error creating indexes:", error.message);
      }
    }
  }

  static async getIndexStats(): Promise<Record<string, any>> {
    const collections = [
      "users",
      "inventoryitems",
      "prescriptions",
      "appointments",
      "orders",
      "financeentries",
      "hospitals",
      "pharmacies",
      "patientrecords",
    ];

    const stats: Record<string, any> = {};

    for (const collectionName of collections) {
      try {
        const collection = mongoose.connection.collection(collectionName);
        const indexes = await collection.indexes();
        stats[collectionName] = {
          count: indexes.length,
          indexes: indexes.map((idx: any) => ({
            name: idx.name,
            keys: idx.key,
          })),
        };
      } catch (error) {
        stats[collectionName] = { error: "Collection not found" };
      }
    }

    return stats;
  }
}
