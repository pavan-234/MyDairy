import mongoose from "mongoose";
import DailyTask, {
  taskPriorities,
  taskRecurrences,
  taskStatuses,
} from "../models/DailyTask.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const writableFields = new Set([
  "text",
  "date",
  "dueDate",
  "priority",
  "recurrence",
  "status",
  "completed",
]);
const maxPageSize = 100;
const maxSkip = 100000;

function isValidDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return (
    !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
  );
}

function serializeTask(task) {
  const value = typeof task.toObject === "function" ? task.toObject() : task;
  const serialized = { ...value };
  delete serialized.reminderTime;
  delete serialized.reminderTimeZone;
  const dueDate = value.dueDate || value.date;
  const status = value.status || (value.completed ? "COMPLETED" : "TODO");
  return {
    ...serialized,
    date: dueDate,
    dueDate,
    status,
    completed: status === "COMPLETED",
    priority: value.priority || "MEDIUM",
    recurrence: value.recurrence || "NONE",
  };
}

function validateTaskInput(body, { creating = false } = {}) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return { error: "Task data must be a JSON object" };
  }
  for (const key of Object.keys(body)) {
    if (!writableFields.has(key)) {
      return { error: `Unknown task field: ${key}` };
    }
  }
  if (!creating && Object.keys(body).length === 0) {
    return { error: "Provide at least one task field to update" };
  }

  const input = {};
  if (body.text !== undefined) {
    if (
      typeof body.text !== "string" ||
      !body.text.trim() ||
      body.text.trim().length > 120
    ) {
      return { error: "text must contain 1–120 characters" };
    }
    input.text = body.text.trim();
  } else if (creating) {
    return { error: "text is required" };
  }

  if (
    body.date !== undefined &&
    body.dueDate !== undefined &&
    body.date !== body.dueDate
  ) {
    return { error: "date and dueDate must match when both are provided" };
  }
  const dateValue = body.dueDate ?? body.date;
  if (dateValue !== undefined) {
    if (!isValidDate(dateValue)) {
      return { error: "dueDate must be a valid YYYY-MM-DD date" };
    }
    input.dueDate = dateValue;
  } else if (creating) {
    return { error: "dueDate is required" };
  }

  if (body.priority !== undefined) {
    if (!taskPriorities.includes(body.priority)) {
      return { error: `priority must be one of: ${taskPriorities.join(", ")}` };
    }
    input.priority = body.priority;
  } else if (creating) {
    input.priority = "MEDIUM";
  }

  if (body.recurrence !== undefined) {
    if (!taskRecurrences.includes(body.recurrence)) {
      return {
        error: `recurrence must be one of: ${taskRecurrences.join(", ")}`,
      };
    }
    input.recurrence = body.recurrence;
  } else if (creating) {
    input.recurrence = "NONE";
  }

  if (body.status !== undefined && !taskStatuses.includes(body.status)) {
    return { error: `status must be one of: ${taskStatuses.join(", ")}` };
  }
  if (body.completed !== undefined && typeof body.completed !== "boolean") {
    return { error: "completed must be true or false" };
  }
  if (
    body.status !== undefined &&
    body.completed !== undefined &&
    (body.status === "COMPLETED") !== body.completed
  ) {
    return { error: "status and completed values conflict" };
  }
  if (body.status !== undefined) input.status = body.status;
  else if (body.completed !== undefined) {
    input.status = body.completed ? "COMPLETED" : "TODO";
  } else if (creating) {
    input.status = "TODO";
  }

  if (creating && input.status === "COMPLETED") {
    return { error: "A new task cannot start as completed" };
  }
  return { value: input };
}

function nextDueDate(date, recurrence) {
  const [year, month, day] = date.split("-").map(Number);
  if (recurrence === "DAILY") {
    const next = new Date(Date.UTC(year, month - 1, day + 1));
    return next.toISOString().slice(0, 10);
  }
  if (recurrence === "WEEKLY") {
    const next = new Date(Date.UTC(year, month - 1, day + 7));
    return next.toISOString().slice(0, 10);
  }
  const nextMonth = new Date(Date.UTC(year, month, 1));
  const lastDay = new Date(
    Date.UTC(nextMonth.getUTCFullYear(), nextMonth.getUTCMonth() + 1, 0)
  ).getUTCDate();
  nextMonth.setUTCDate(Math.min(day, lastDay));
  return nextMonth.toISOString().slice(0, 10);
}

async function ensureNextOccurrence(task) {
  const dueDate = nextDueDate(task.dueDate || task.date, task.recurrence);
  const recurrenceKey = `${task.recurrenceSeriesId}:${dueDate}`;
  const existing = await DailyTask.findOne({
    userId: task.userId,
    recurrenceKey,
  }).lean();
  if (existing) return existing;

  try {
    return await DailyTask.create({
      userId: task.userId,
      text: task.text,
      date: dueDate,
      dueDate,
      status: "TODO",
      completed: false,
      priority: task.priority || "MEDIUM",
      recurrence: task.recurrence,
      recurrenceSeriesId: task.recurrenceSeriesId,
      recurrenceKey,
    });
  } catch (error) {
    if (error.code !== 11000) throw error;
    const concurrentOccurrence = await DailyTask.findOne({
      userId: task.userId,
      recurrenceKey,
    }).lean();
    if (!concurrentOccurrence) throw error;
    return concurrentOccurrence;
  }
}

function parseTaskListQuery(query) {
  const allowed = new Set([
    "date",
    "from",
    "to",
    "status",
    "priority",
    "recurrence",
    "search",
    "page",
    "limit",
  ]);
  if (Object.keys(query).some((key) => !allowed.has(key))) {
    return { error: "Unknown task query parameter" };
  }
  if (Object.values(query).some((value) => typeof value !== "string")) {
    return { error: "Task query parameters must each have one string value" };
  }

  for (const key of ["date", "from", "to"]) {
    if (query[key] !== undefined && !isValidDate(query[key])) {
      return { error: `${key} must be a valid YYYY-MM-DD date` };
    }
  }
  if (query.date && (query.from || query.to)) {
    return { error: "date cannot be combined with from or to" };
  }
  if (query.from && query.to && query.from > query.to) {
    return { error: "from must be on or before to" };
  }
  if (query.status && !taskStatuses.includes(query.status)) {
    return { error: `status must be one of: ${taskStatuses.join(", ")}` };
  }
  if (query.priority && !taskPriorities.includes(query.priority)) {
    return { error: `priority must be one of: ${taskPriorities.join(", ")}` };
  }
  if (query.recurrence && !taskRecurrences.includes(query.recurrence)) {
    return {
      error: `recurrence must be one of: ${taskRecurrences.join(", ")}`,
    };
  }
  if (query.search !== undefined && query.search.length > 100) {
    return { error: "search must be 100 characters or fewer" };
  }
  if (query.search !== undefined && !query.search.trim()) {
    return { error: "search must contain a non-whitespace character" };
  }

  const integer = (value, fallback, name) => {
    if (value === undefined) return { value: fallback };
    if (!/^\d+$/.test(value)) {
      return { error: `${name} must be a positive integer` };
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0
      ? { value: parsed }
      : { error: `${name} must be a positive integer` };
  };
  const page = integer(query.page, 1, "page");
  if (page.error) return page;
  const limit = integer(query.limit, 50, "limit");
  if (limit.error) return limit;
  if (limit.value > maxPageSize) {
    return { error: `limit must not exceed ${maxPageSize}` };
  }
  if ((page.value - 1) * limit.value > maxSkip) {
    return { error: `page exceeds the maximum supported offset of ${maxSkip}` };
  }

  const clauses = [];
  if (query.status === "COMPLETED") {
    clauses.push({
      $or: [
        { status: "COMPLETED" },
        { status: { $exists: false }, completed: true },
      ],
    });
  } else if (query.status) {
    clauses.push(
      query.status === "TODO"
        ? {
            $or: [
              { status: "TODO" },
              { status: { $exists: false }, completed: { $ne: true } },
            ],
          }
        : { status: query.status }
    );
  }
  if (query.priority === "MEDIUM") {
    clauses.push({
      $or: [{ priority: "MEDIUM" }, { priority: { $exists: false } }],
    });
  } else if (query.priority) {
    clauses.push({ priority: query.priority });
  }
  if (query.recurrence === "NONE") {
    clauses.push({
      $or: [{ recurrence: "NONE" }, { recurrence: { $exists: false } }],
    });
  } else if (query.recurrence) {
    clauses.push({ recurrence: query.recurrence });
  }
  if (query.date) {
    clauses.push({
      $or: [
        { dueDate: query.date },
        { dueDate: { $exists: false }, date: query.date },
      ],
    });
  }
  if (query.from || query.to) {
    const bounds = {
      ...(query.from ? { $gte: query.from } : {}),
      ...(query.to ? { $lte: query.to } : {}),
    };
    clauses.push({
      $or: [{ dueDate: bounds }, { dueDate: { $exists: false }, date: bounds }],
    });
  }
  const filter = {
    ...(clauses.length ? { $and: clauses } : {}),
    ...(query.search
      ? { text: { $regex: escapeRegex(query.search.trim()), $options: "i" } }
      : {}),
  };
  return { page: page.value, limit: limit.value, filter };
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export async function getTasks(req, res) {
  const parsed = parseTaskListQuery(req.query);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }
  const filter = { ...parsed.filter, userId: req.authUser._id };
  const legacyRequest = Object.keys(req.query).every((key) => key === "date");
  if (legacyRequest) {
    const tasks = await DailyTask.find(filter)
      .sort({ date: -1, createdAt: 1 })
      .lean();
    return res.json(tasks.map(serializeTask));
  }
  const total = await DailyTask.countDocuments(filter);
  const totalPages = Math.ceil(total / parsed.limit);
  const page = totalPages ? Math.min(parsed.page, totalPages) : 1;
  const data = await DailyTask.find(filter)
    .sort({ date: 1, dueDate: 1, priority: -1, createdAt: 1, _id: 1 })
    .skip((page - 1) * parsed.limit)
    .limit(parsed.limit)
    .lean();
  const serializedTasks = data.map(serializeTask);
  res.json({
    data: serializedTasks,
    pagination: { page, limit: parsed.limit, total, totalPages },
  });
}

export async function createTask(req, res) {
  const parsed = validateTaskInput(req.body, { creating: true });
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }
  const values = parsed.value;
  const recurrenceSeriesId =
    values.recurrence === "NONE" ? undefined : new mongoose.Types.ObjectId();
  const dueDate = values.dueDate;
  const task = await DailyTask.create({
    ...values,
    date: dueDate,
    dueDate,
    completed: false,
    userId: req.authUser._id,
    ...(recurrenceSeriesId
      ? {
          recurrenceSeriesId,
          recurrenceKey: `${recurrenceSeriesId}:${dueDate}`,
        }
      : {}),
  });
  res.status(201).json(serializeTask(task));
}

export async function updateTask(req, res) {
  const parsed = validateTaskInput(req.body);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }
  const task = await DailyTask.findOne({
    _id: req.params.id,
    userId: req.authUser._id,
  });
  if (!task) {
    return res.status(404).json({ message: "Task not found" });
  }

  const previousStatus = task.status || (task.completed ? "COMPLETED" : "TODO");
  const values = parsed.value;
  if (values.dueDate !== undefined) {
    task.date = values.dueDate;
    task.dueDate = values.dueDate;
  }
  if (values.recurrence !== undefined) {
    task.recurrence = values.recurrence;
    if (values.recurrence === "NONE") {
      task.recurrenceSeriesId = undefined;
      task.recurrenceKey = undefined;
    } else if (!task.recurrenceSeriesId) {
      task.recurrenceSeriesId = new mongoose.Types.ObjectId();
    }
  }
  for (const [key, value] of Object.entries(values)) {
    if (key !== "dueDate" && key !== "recurrence") task[key] = value;
  }
  const nextStatus = values.status ?? previousStatus;
  task.status = nextStatus;
  task.completed = nextStatus === "COMPLETED";
  if (task.recurrence && task.recurrence !== "NONE") {
    task.recurrenceKey = `${task.recurrenceSeriesId}:${task.dueDate || task.date}`;
  }
  try {
    await task.save();
  } catch (error) {
    if (error.code === 11000) {
      return res.status(409).json({
        message: "A recurring task already exists for that due date",
      });
    }
    throw error;
  }

  let nextTask;
  if (
    nextStatus === "COMPLETED" &&
    task.recurrence &&
    task.recurrence !== "NONE"
  ) {
    nextTask = await ensureNextOccurrence(serializeTask(task));
  }
  res.json({
    ...serializeTask(task),
    ...(nextTask ? { nextTask: serializeTask(nextTask) } : {}),
  });
}

export async function deleteTask(req, res) {
  const task = await DailyTask.findOneAndDelete({
    _id: req.params.id,
    userId: req.authUser._id,
  });

  if (!task) {
    return res.status(404).json({ message: "Task not found" });
  }

  res.json({ message: "Task deleted successfully" });
}
