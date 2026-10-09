import mongoose from "mongoose";

const backupImportSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
    },
    backupId: {
      type: String,
      required: true,
    },
    status: {
      type: String,
      enum: ["IMPORTING", "COMPLETED", "CLEANUP_REQUIRED"],
      required: true,
      default: "IMPORTING",
    },
    completedAt: Date,
  },
  { timestamps: true }
);

backupImportSchema.index({ userId: 1, backupId: 1 }, { unique: true });

export default mongoose.model("BackupImport", backupImportSchema);
