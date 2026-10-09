import argon2 from "argon2";
import sanitizeHtml from "sanitize-html";
import DiaryEntry, { diaryMoods } from "../models/DiaryEntry.js";
import User from "../models/User.js";
import { deleteEntryImages } from "./imageController.js";
import { buildStreakPipeline } from "../services/diaryAnalytics.js";
import { cacheAside, invalidateUserReadCache } from "../services/readCache.js";
import {
  clearEntryUnlockCookie,
  hasValidEntryUnlock,
  setEntryUnlockCookie,
} from "../services/entryUnlock.js";

const richTextPolicy = {
  allowedTags: ["b", "strong", "i", "em", "u", "br", "p", "div", "span"],
  allowedAttributes: { span: ["style"] },
  allowedStyles: {
    span: {
      color: [/^#[\da-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i],
    },
  },
};
const writableFields = [
  "title",
  "content",
  "formatting",
  "mood",
  "tags",
  "isFavorite",
  "isDraft",
];
const maxPageSize = 50;
const maxSkip = 100000;
const searchFields = new Set([
  "page",
  "limit",
  "search",
  "mood",
  "tags",
  "favorite",
  "from",
  "to",
  "sort",
  "order",
]);
const datePattern = /^\d{4}-\d{2}-\d{2}$/;

function parseDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return null;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== value
    ? null
    : parsed;
}

function parseListQuery(query) {
  for (const key of Object.keys(query)) {
    if (!searchFields.has(key)) {
      return { error: `Unknown query parameter: ${key}` };
    }
  }
  if (Object.values(query).some((value) => typeof value !== "string")) {
    return { error: "Query parameters must each have one string value" };
  }

  const parseInteger = (value, fallback, name) => {
    if (value === undefined) return { value: fallback };
    if (typeof value !== "string" || !/^\d+$/.test(value)) {
      return { error: `${name} must be a positive integer` };
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0
      ? { value: parsed }
      : { error: `${name} must be a positive integer` };
  };

  const pageResult = parseInteger(query.page, 1, "page");
  if (pageResult.error) return pageResult;
  const limitResult = parseInteger(query.limit, 10, "limit");
  if (limitResult.error) return limitResult;
  const { page, limit } = { page: pageResult.value, limit: limitResult.value };
  if (limit > maxPageSize) {
    return { error: `limit must not exceed ${maxPageSize}` };
  }
  if ((page - 1) * limit > maxSkip) {
    return { error: `page exceeds the maximum supported offset of ${maxSkip}` };
  }

  if (query.search !== undefined && query.search.length > 100) {
    return { error: "search must be 100 characters or fewer" };
  }
  const searchTerms = query.search
    ?.trim()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
  if (query.search?.trim() && !searchTerms) {
    return { error: "search must include at least one letter or number" };
  }
  if (query.mood !== undefined && !diaryMoods.includes(query.mood)) {
    return { error: `mood must be one of: ${diaryMoods.join(", ")}` };
  }
  let tags;
  if (query.tags !== undefined) {
    tags = query.tags.split(",").map((tag) => tag.trim().toLowerCase());
    if (
      tags.length > 10 ||
      tags.some((tag) => tag.length === 0 || tag.length > 24)
    ) {
      return {
        error:
          "tags must contain at most 10 comma-separated tags of 1–24 characters",
      };
    }
    tags = [...new Set(tags)];
  }
  let favorite;
  if (query.favorite !== undefined) {
    if (query.favorite !== "true" && query.favorite !== "false") {
      return { error: "favorite must be true or false" };
    }
    favorite = query.favorite === "true";
  }
  const fromDate = query.from === undefined ? undefined : parseDate(query.from);
  const toDate = query.to === undefined ? undefined : parseDate(query.to);
  if (query.from !== undefined && !fromDate) {
    return { error: "from must be a valid YYYY-MM-DD date" };
  }
  if (query.to !== undefined && !toDate) {
    return { error: "to must be a valid YYYY-MM-DD date" };
  }
  if (
    fromDate &&
    toDate &&
    (fromDate > toDate || (toDate - fromDate) / 86400000 > 3650)
  ) {
    return { error: "Date range must be ordered and no longer than 10 years" };
  }
  const sort = query.sort ?? "createdAt";
  if (!["createdAt", "updatedAt"].includes(sort)) {
    return { error: "sort must be createdAt or updatedAt" };
  }
  const order = query.order ?? "desc";
  if (!["asc", "desc"].includes(order)) {
    return { error: "order must be asc or desc" };
  }

  return {
    page,
    limit,
    filter: {
      ...(searchTerms ? { $text: { $search: searchTerms } } : {}),
      ...(query.mood ? { mood: query.mood } : {}),
      ...(tags?.length ? { tags: { $all: tags } } : {}),
      ...(favorite !== undefined ? { isFavorite: favorite } : {}),
      ...(fromDate || toDate
        ? {
            date: {
              ...(query.from ? { $gte: query.from } : {}),
              ...(query.to ? { $lte: query.to } : {}),
            },
          }
        : {}),
    },
    sort: { [sort]: order === "asc" ? 1 : -1, _id: order === "asc" ? 1 : -1 },
  };
}

function parseDateRangeQuery(query, maxDays) {
  if (
    Object.keys(query).some((key) => !["from", "to"].includes(key)) ||
    Object.values(query).some((value) => typeof value !== "string")
  ) {
    return { error: "Only one from and one to date parameter are supported" };
  }
  const fromDate = parseDate(query.from);
  const toDate = parseDate(query.to);
  if (!fromDate || !toDate || fromDate > toDate) {
    return { error: "from and to must be ordered valid YYYY-MM-DD dates" };
  }
  if ((toDate - fromDate) / 86400000 >= maxDays) {
    return { error: `Date range must not exceed ${maxDays} days` };
  }
  return { from: query.from, to: query.to };
}

function parseCalendarDayQuery(query) {
  if (
    Object.keys(query).some(
      (key) => !["date", "page", "limit"].includes(key)
    ) ||
    Object.values(query).some((value) => typeof value !== "string")
  ) {
    return { error: "Only one date, page, and limit parameter are supported" };
  }
  const date = parseDate(query.date);
  if (!date) {
    return { error: "date must be a valid YYYY-MM-DD date" };
  }

  const parsePositiveInteger = (value, fallback, name) => {
    if (value === undefined) return { value: fallback };
    if (!/^\d+$/.test(value)) {
      return { error: `${name} must be a positive integer` };
    }
    const parsed = Number(value);
    return Number.isSafeInteger(parsed) && parsed > 0
      ? { value: parsed }
      : { error: `${name} must be a positive integer` };
  };
  const pageResult = parsePositiveInteger(query.page, 1, "page");
  if (pageResult.error) return pageResult;
  const limitResult = parsePositiveInteger(query.limit, 50, "limit");
  if (limitResult.error) return limitResult;
  if (limitResult.value > maxPageSize) {
    return { error: `limit must not exceed ${maxPageSize}` };
  }
  if ((pageResult.value - 1) * limitResult.value > maxSkip) {
    return { error: `page exceeds the maximum supported offset of ${maxSkip}` };
  }

  return { date: query.date, page: pageResult.value, limit: limitResult.value };
}

function validateEntryInput(body, entry) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return "Entry data must be a JSON object";
  }

  if (body.title !== undefined) {
    if (typeof body.title !== "string" || body.title.trim().length > 160) {
      return "Title must be a string of at most 160 characters";
    }
    entry.title = body.title.trim();
  }

  if (
    body.date !== undefined &&
    (typeof body.date !== "string" || body.date !== entry.date)
  ) {
    return "An entry's date cannot be changed";
  }

  if (body.content !== undefined) {
    if (typeof body.content !== "string" || body.content.length > 100000) {
      return "Content must be a string of at most 100000 characters";
    }
    entry.content = sanitizeHtml(body.content, richTextPolicy);
  }

  if (body.formatting !== undefined) {
    if (
      !body.formatting ||
      typeof body.formatting !== "object" ||
      Array.isArray(body.formatting)
    ) {
      return "Formatting must be a JSON object";
    }
    entry.formatting = body.formatting;
  }

  if (body.mood !== undefined) {
    if (!diaryMoods.includes(body.mood)) {
      return `Mood must be one of: ${diaryMoods.join(", ")}`;
    }
    entry.mood = body.mood;
  }

  if (body.tags !== undefined) {
    if (!Array.isArray(body.tags) || body.tags.length > 10) {
      return "Tags must be an array of at most 10 items";
    }
    const tags = [];
    for (const tag of body.tags) {
      if (typeof tag !== "string") {
        return "Each tag must be a string";
      }
      const normalizedTag = tag.trim().replace(/\s+/g, " ").toLowerCase();
      if (
        normalizedTag.length === 0 ||
        normalizedTag.length > 24 ||
        /[\u0000-\u001f\u007f]/.test(normalizedTag)
      ) {
        return "Tags must be between 1 and 24 characters";
      }
      if (!tags.includes(normalizedTag)) tags.push(normalizedTag);
    }
    entry.tags = tags;
  }

  for (const field of ["isFavorite", "isDraft"]) {
    if (body[field] !== undefined) {
      if (typeof body[field] !== "boolean") {
        return `${field} must be true or false`;
      }
      entry[field] = body[field];
    }
  }

  const plainText = sanitizeHtml(entry.content, {
    allowedTags: [],
    allowedAttributes: {},
  })
    .replace(/&nbsp;|&#160;/gi, " ")
    .trim();
  if (!entry.isDraft && (!entry.title.trim() || !plainText)) {
    return "Published entries require both a title and diary content";
  }

  return null;
}

function hasWritableField(body) {
  return writableFields.some((field) => body[field] !== undefined);
}

function serializeEntry(entry, includeLockedContent = false) {
  const value = typeof entry.toObject === "function" ? entry.toObject() : entry;
  delete value.unlockVersion;
  if (!value.isLocked || includeLockedContent) return value;
  return {
    _id: value._id,
    date: value.date,
    isLocked: true,
    createdAt: value.createdAt,
    updatedAt: value.updatedAt,
    deletedAt: value.deletedAt,
    ...(value.purgeRequestedAt
      ? { purgeRequestedAt: value.purgeRequestedAt }
      : {}),
  };
}

function excludesLockedEntries(parsed) {
  return Boolean(
    parsed.filter.$text ||
    parsed.filter.mood ||
    parsed.filter.tags ||
    parsed.filter.isFavorite !== undefined
  );
}

function markPrivateNoStore(res) {
  res.set("Cache-Control", "private, no-store");
}

export async function getEntries(req, res) {
  const parsed = parseListQuery(req.query);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const filter = {
    userId: req.authUser._id,
    deletedAt: null,
    ...(excludesLockedEntries(parsed) ? { isLocked: { $ne: true } } : {}),
    ...parsed.filter,
  };
  const total = await DiaryEntry.countDocuments(filter);
  const totalPages = Math.ceil(total / parsed.limit);
  const page = totalPages ? Math.min(parsed.page, totalPages) : 1;
  const entries = await DiaryEntry.find(filter)
    .sort(parsed.sort)
    .skip((page - 1) * parsed.limit)
    .limit(parsed.limit);
  const data = entries.map(serializeEntry);

  res.json({
    data,
    pagination: {
      page,
      limit: parsed.limit,
      total,
      totalPages,
    },
  });
}

export async function getTrashEntries(req, res) {
  const parsed = parseListQuery(req.query);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const filter = {
    userId: req.authUser._id,
    deletedAt: { $ne: null },
    ...(excludesLockedEntries(parsed) ? { isLocked: { $ne: true } } : {}),
    ...parsed.filter,
  };
  const total = await DiaryEntry.countDocuments(filter);
  const totalPages = Math.ceil(total / parsed.limit);
  const page = totalPages ? Math.min(parsed.page, totalPages) : 1;
  const entries = await DiaryEntry.find(filter)
    .sort({ deletedAt: -1, _id: -1 })
    .skip((page - 1) * parsed.limit)
    .limit(parsed.limit)
    .select("+purgeRequestedAt");
  const data = entries.map(serializeEntry);

  res.json({
    data,
    pagination: {
      page,
      limit: parsed.limit,
      total,
      totalPages,
    },
  });
}

export async function getCalendarDates(req, res) {
  const range = parseDateRangeQuery(req.query, 366);
  if (range.error) {
    return res.status(400).json({ message: range.error });
  }

  const dateCount = (parseDate(range.to) - parseDate(range.from)) / 86400000;
  const load = async () => {
    const dates = await DiaryEntry.distinct("date", {
      userId: req.authUser._id,
      deletedAt: null,
      isLocked: { $ne: true },
      isDraft: { $ne: true },
      date: { $gte: range.from, $lte: range.to },
    });
    return { dates: dates.sort() };
  };
  if (dateCount > 31) return res.json(await load());
  res.json(
    await cacheAside({
      userId: req.authUser._id,
      resource: "calendar-dates",
      parameters: range,
      ttlSeconds: 120,
      load,
    })
  );
}

export async function getCalendarActivity(req, res) {
  const range = parseDateRangeQuery(req.query, 366);
  if (range.error) {
    return res.status(400).json({ message: range.error });
  }

  const dateCount = (parseDate(range.to) - parseDate(range.from)) / 86400000;
  const load = async () => {
    const data = await DiaryEntry.aggregate([
      {
        $match: {
          userId: req.authUser._id,
          deletedAt: null,
          isLocked: { $ne: true },
          isDraft: { $ne: true },
          date: { $gte: range.from, $lte: range.to },
        },
      },
      { $group: { _id: "$date", count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
      { $project: { _id: 0, date: "$_id", count: 1 } },
    ]);
    return { data };
  };
  if (dateCount > 31) return res.json(await load());
  res.json(
    await cacheAside({
      userId: req.authUser._id,
      resource: "calendar-activity",
      parameters: range,
      ttlSeconds: 120,
      load,
    })
  );
}

export async function getCalendarDay(req, res) {
  const parsed = parseCalendarDayQuery(req.query);
  if (parsed.error) {
    return res.status(400).json({ message: parsed.error });
  }

  const filter = {
    userId: req.authUser._id,
    deletedAt: null,
    isLocked: { $ne: true },
    isDraft: { $ne: true },
    date: parsed.date,
  };
  const total = await DiaryEntry.countDocuments(filter);
  const totalPages = Math.ceil(total / parsed.limit);
  const page = totalPages ? Math.min(parsed.page, totalPages) : 1;
  const data = await DiaryEntry.find(filter)
    .sort({ createdAt: 1, _id: 1 })
    .skip((page - 1) * parsed.limit)
    .limit(parsed.limit);

  res.json({
    data,
    pagination: { page, limit: parsed.limit, total, totalPages },
  });
}

export async function getStreak(req, res) {
  if (
    Object.keys(req.query).length !== 1 ||
    !Object.hasOwn(req.query, "today") ||
    typeof req.query.today !== "string"
  ) {
    return res
      .status(400)
      .json({ message: "Only one today date parameter is supported" });
  }
  const today = parseDate(req.query.today);
  if (!today) {
    return res
      .status(400)
      .json({ message: "today must be a valid YYYY-MM-DD date" });
  }

  const rows = await DiaryEntry.aggregate([
    {
      $match: {
        userId: req.authUser._id,
        deletedAt: null,
        isLocked: { $ne: true },
        isDraft: { $ne: true },
      },
    },
    ...buildStreakPipeline(req.query.today),
  ]);

  res.json(rows[0] || { current: 0, longest: 0, writtenToday: false });
}

export async function getEntry(req, res) {
  const entry = await DiaryEntry.findOne({
    _id: req.params.id,
    userId: req.authUser._id,
    deletedAt: null,
  }).select("+unlockVersion");

  if (!entry) {
    return res.status(404).json({ message: "Diary entry not found" });
  }

  markPrivateNoStore(res);
  if (entry.isLocked) {
    if (!hasValidEntryUnlock(req, entry)) {
      clearEntryUnlockCookie(res);
      return res.status(423).json({
        message: "This entry is locked. Verify your password to unlock it.",
      });
    }
    return res.json(serializeEntry(entry, true));
  }

  res.json(serializeEntry(entry));
}

export async function lockEntry(req, res) {
  const entry = await DiaryEntry.findOneAndUpdate(
    {
      _id: req.params.id,
      userId: req.authUser._id,
      deletedAt: null,
    },
    { $set: { isLocked: true }, $inc: { unlockVersion: 1 } },
    { new: true }
  );
  if (!entry) {
    return res.status(404).json({ message: "Diary entry not found" });
  }

  clearEntryUnlockCookie(res);
  markPrivateNoStore(res);
  await invalidateUserReadCache(req.authUser._id);
  return res.json(serializeEntry(entry));
}

export async function unlockEntry(req, res) {
  const body = req.body;
  if (
    !body ||
    typeof body !== "object" ||
    Array.isArray(body) ||
    Object.keys(body).some((field) => field !== "currentPassword") ||
    typeof body.currentPassword !== "string" ||
    body.currentPassword.length > 128 ||
    !body.currentPassword
  ) {
    return res.status(400).json({
      message: "Provide your current password to unlock this entry",
    });
  }

  const entry = await DiaryEntry.findOne({
    _id: req.params.id,
    userId: req.authUser._id,
    deletedAt: null,
  }).select("+unlockVersion");
  if (!entry) {
    return res.status(404).json({ message: "Diary entry not found" });
  }
  if (!entry.isLocked) {
    return res.status(409).json({ message: "This entry is not locked" });
  }

  const user = await User.findById(req.authUser._id).select("+passwordHash");
  if (
    !user ||
    !(await argon2.verify(user.passwordHash, body.currentPassword))
  ) {
    return res.status(401).json({ message: "Current password is incorrect" });
  }

  const currentEntry = await DiaryEntry.findOne({
    _id: entry._id,
    userId: req.authUser._id,
    deletedAt: null,
    isLocked: true,
  }).select("+unlockVersion");
  if (!currentEntry || currentEntry.unlockVersion !== entry.unlockVersion) {
    return res.status(409).json({
      message: "Entry lock state changed. Refresh and try again.",
    });
  }

  setEntryUnlockCookie(res, currentEntry, req.authUser);
  markPrivateNoStore(res);
  return res.json(serializeEntry(currentEntry, true));
}

export async function createEntry(req, res) {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res
      .status(400)
      .json({ message: "Entry data must be a JSON object" });
  }
  if (Object.hasOwn(body, "isLocked") || Object.hasOwn(body, "unlockVersion")) {
    return res.status(400).json({
      message: "Use the dedicated lock action to change entry lock state",
    });
  }
  const { date } = body;
  const timezoneOffset = req.get("X-Timezone-Offset");
  const offsetMinutes =
    timezoneOffset === undefined ? 0 : Number(timezoneOffset);

  if (
    !Number.isInteger(offsetMinutes) ||
    offsetMinutes < -840 ||
    offsetMinutes > 720
  ) {
    return res.status(400).json({ message: "Invalid timezone offset" });
  }

  const today = new Date(Date.now() - offsetMinutes * 60_000)
    .toISOString()
    .slice(0, 10);

  if (date && date !== today) {
    return res
      .status(400)
      .json({ message: "New diary entries can only be created for today." });
  }

  const entry = new DiaryEntry({
    userId: req.authUser._id,
    date: today,
  });
  const validationError = validateEntryInput(body, entry);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }
  await entry.save();
  await invalidateUserReadCache(req.authUser._id);

  res.status(201).json(entry);
}

export async function updateEntry(req, res) {
  const body = req.body;
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return res
      .status(400)
      .json({ message: "Entry data must be a JSON object" });
  }
  if (Object.hasOwn(body, "isLocked") || Object.hasOwn(body, "unlockVersion")) {
    return res.status(400).json({
      message: "Use the dedicated lock action to change entry lock state",
    });
  }
  if (!hasWritableField(body)) {
    return res
      .status(400)
      .json({ message: "Provide at least one entry field to update" });
  }

  const entry = await DiaryEntry.findOne({
    _id: req.params.id,
    userId: req.authUser._id,
    deletedAt: null,
  }).select("+unlockVersion");
  if (!entry) {
    return res.status(404).json({ message: "Diary entry not found" });
  }
  if (entry.isLocked) {
    markPrivateNoStore(res);
    if (!hasValidEntryUnlock(req, entry)) {
      clearEntryUnlockCookie(res);
      return res.status(423).json({
        message: "This entry is locked. Verify your password to unlock it.",
      });
    }
  }

  const validationError = validateEntryInput(body, entry);
  if (validationError) {
    return res.status(400).json({ message: validationError });
  }
  await entry.save();
  await invalidateUserReadCache(req.authUser._id);

  res.json(serializeEntry(entry, true));
}

export async function deleteEntry(req, res) {
  const entry = await DiaryEntry.findOneAndUpdate(
    {
      _id: req.params.id,
      userId: req.authUser._id,
      deletedAt: null,
    },
    { $set: { deletedAt: new Date() } },
    { new: true }
  );

  if (!entry) {
    return res.status(404).json({ message: "Diary entry not found" });
  }

  await invalidateUserReadCache(req.authUser._id);
  res.json({
    message: "Diary entry moved to Trash",
    entry: serializeEntry(entry),
  });
}

export async function restoreTrashEntry(req, res) {
  const entry = await DiaryEntry.findOneAndUpdate(
    {
      _id: req.params.id,
      userId: req.authUser._id,
      deletedAt: { $ne: null },
      $or: [
        { purgeRequestedAt: null },
        { purgeRequestedAt: { $exists: false } },
      ],
    },
    { $set: { deletedAt: null, purgeRequestedAt: null } },
    { new: true }
  );

  if (!entry) {
    return res.status(404).json({ message: "Trashed diary entry not found" });
  }

  await invalidateUserReadCache(req.authUser._id);
  res.json({ message: "Diary entry restored", entry: serializeEntry(entry) });
}

async function permanentlyDeleteTrashEntry(userId, entryId) {
  const entry = await DiaryEntry.findOneAndUpdate(
    {
      _id: entryId,
      userId,
      deletedAt: { $ne: null },
      $or: [
        { purgeRequestedAt: null },
        { purgeRequestedAt: { $exists: false } },
      ],
    },
    { $set: { purgeRequestedAt: new Date() } },
    { new: true }
  ).select("+purgeRequestedAt");

  const existingEntry =
    entry ||
    (await DiaryEntry.findOne({
      _id: entryId,
      userId,
      deletedAt: { $ne: null },
      purgeRequestedAt: { $ne: null },
    }).select("+purgeRequestedAt"));
  if (!existingEntry) return false;

  await deleteEntryImages(existingEntry);
  await DiaryEntry.deleteOne({
    _id: existingEntry._id,
    userId,
    deletedAt: { $ne: null },
    purgeRequestedAt: { $ne: null },
  });
  return true;
}

export async function permanentlyDeleteEntry(req, res) {
  const deleted = await permanentlyDeleteTrashEntry(
    req.authUser._id,
    req.params.id
  );

  if (!deleted) {
    return res.status(404).json({ message: "Trashed diary entry not found" });
  }

  await invalidateUserReadCache(req.authUser._id);
  res.json({ message: "Diary entry permanently deleted" });
}
