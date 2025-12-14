import { Activity, IActivity, ActivityType } from "./activity.model";

interface ActivityMetadata {
  userId?: string;
  hospitalId?: string;
  pharmacyId?: string;
  distributorId?: string;
  doctorId?: string;
  patientId?: string;
  [key: string]: any;
}

const DEFAULT_ACTIVITY_LIMIT = 50;

export async function createActivity(
  type: ActivityType,
  title: string,
  description: string,
  metadata?: ActivityMetadata
): Promise<IActivity> {
  // Filter out undefined values from metadata to prevent ObjectId cast errors
  const cleanMetadata: ActivityMetadata = {};
  if (metadata) {
    Object.keys(metadata).forEach((key) => {
      const value = metadata[key];
      // Only include defined values that are not the string "undefined"
      if (value !== undefined && value !== null && value !== "undefined") {
        cleanMetadata[key] = value;
      }
    });
  }
  
  return await Activity.create({
    type,
    title,
    description,
    ...cleanMetadata,
  });
}

export async function getRecentActivities(limit: number = DEFAULT_ACTIVITY_LIMIT): Promise<IActivity[]> {
  return Activity.find()
    .sort({ createdAt: -1 })
    .limit(limit)
    .lean()
    .exec() as unknown as Promise<IActivity[]>;
}
