import "dotenv/config";
import mongoose from "mongoose";
import connectDatabase from "../config/database.js";
import DailyTask from "../models/DailyTask.js";
import DiaryEntry from "../models/DiaryEntry.js";
import User from "../models/User.js";

const ownerEmail = process.env.MIGRATION_OWNER_EMAIL?.trim().toLowerCase();
if (!ownerEmail) {
  throw new Error(
    "Set MIGRATION_OWNER_EMAIL to the account that should own existing diary data"
  );
}

await connectDatabase();
try {
  const owner = await User.findOne({ email: ownerEmail });
  if (!owner) {
    throw new Error(
      `No account exists for MIGRATION_OWNER_EMAIL=${ownerEmail}`
    );
  }

  const ownershipFilter = {
    $or: [{ userId: { $exists: false } }, { userId: null }],
  };
  const [entryCount, taskCount] = await Promise.all([
    DiaryEntry.countDocuments(ownershipFilter),
    DailyTask.countDocuments(ownershipFilter),
  ]);

  await Promise.all([
    DiaryEntry.updateMany(ownershipFilter, { $set: { userId: owner._id } }),
    DailyTask.updateMany(ownershipFilter, { $set: { userId: owner._id } }),
  ]);

  console.log(
    `Assigned ${entryCount} diary entries and ${taskCount} tasks to ${owner.email}.`
  );
} finally {
  await mongoose.disconnect();
}
