import mongoose from "mongoose";

export const taskStatuses = ["TODO", "IN_PROGRESS", "COMPLETED", "CANCELLED"];
export const taskPriorities = ["LOW", "MEDIUM", "HIGH"];
export const taskRecurrences = ["NONE", "DAILY", "WEEKLY", "MONTHLY"];

const dailyTaskSchema = new mongoose.Schema(
  {
    userId: {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
      required: true,
      index: true,
    },
    text: {
      type: String,
      required: true,
      trim: true,
      maxlength: 120,
    },
    date: {
      type: String,
      required: true,
      default: () => new Date().toISOString().slice(0, 10),
    },
    dueDate: {
      type: String,
      match: /^\d{4}-\d{2}-\d{2}$/,
    },
    completed: {
      type: Boolean,
      default: false,
    },
    status: {
      type: String,
      enum: taskStatuses,
    },
    priority: {
      type: String,
      enum: taskPriorities,
    },
    recurrence: {
      type: String,
      enum: taskRecurrences,
    },
    recurrenceSeriesId: {
      type: mongoose.Schema.Types.ObjectId,
    },
    recurrenceKey: {
      type: String,
    },
  },
  {
    timestamps: true,
  }
);

dailyTaskSchema.index(
  { userId: 1, recurrenceKey: 1 },
  {
    unique: true,
    partialFilterExpression: { recurrenceKey: { $type: "string" } },
  }
);
dailyTaskSchema.index({ userId: 1, dueDate: 1, status: 1 });

const DailyTask = mongoose.model("DailyTask", dailyTaskSchema);

export default DailyTask;
