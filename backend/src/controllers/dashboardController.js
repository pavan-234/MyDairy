import DiaryEntry, { diaryMoods } from "../models/DiaryEntry.js";
import { buildStreakPipeline } from "../services/diaryAnalytics.js";
import { cacheAside } from "../services/readCache.js";

const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const periods = new Set(["day", "week", "month"]);

function parseDate(value) {
  if (typeof value !== "string" || !datePattern.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isNaN(date.getTime()) ||
    date.toISOString().slice(0, 10) !== value
    ? null
    : date;
}

function shiftDays(date, days) {
  return new Date(date.getTime() + days * 86400000);
}

function formatDate(date) {
  return date.toISOString().slice(0, 10);
}

function getActivityRange(today, group) {
  if (group === "day") {
    return { from: formatDate(shiftDays(today, -29)), to: formatDate(today) };
  }
  if (group === "week") {
    const mondayOffset = (today.getUTCDay() + 6) % 7;
    const currentWeek = shiftDays(today, -mondayOffset);
    return {
      from: formatDate(shiftDays(currentWeek, -77)),
      to: formatDate(today),
    };
  }

  const from = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 11, 1)
  );
  return { from: formatDate(from), to: formatDate(today) };
}

function entryProjection() {
  return {
    title: 1,
    date: 1,
    mood: 1,
    tags: 1,
    isFavorite: 1,
    createdAt: 1,
    updatedAt: 1,
  };
}

export async function getDashboard(req, res) {
  if (
    Object.keys(req.query).some((key) => !["today", "group"].includes(key)) ||
    Object.values(req.query).some((value) => typeof value !== "string")
  ) {
    return res.status(400).json({
      message: "Only one today and group parameter are supported",
    });
  }

  const today = parseDate(req.query.today);
  if (!today) {
    return res.status(400).json({
      message: "today must be a valid YYYY-MM-DD date",
    });
  }
  const group = req.query.group ?? "day";
  if (!periods.has(group)) {
    return res.status(400).json({
      message: "group must be day, week, or month",
    });
  }

  const dashboard = await cacheAside({
    userId: req.authUser._id,
    resource: "dashboard",
    parameters: { today: req.query.today, group },
    ttlSeconds: 30,
    load: async () => {
      const range = getActivityRange(today, group);
      const weekStart = formatDate(
        shiftDays(today, -((today.getUTCDay() + 6) % 7))
      );
      const monthStart = `${req.query.today.slice(0, 7)}-01`;
      const dateGroup =
        group === "day"
          ? "$date"
          : {
              $dateTrunc: {
                date: { $dateFromString: { dateString: "$date" } },
                unit: group,
                ...(group === "week" ? { startOfWeek: "monday" } : {}),
                timezone: "UTC",
              },
            };

      const [result] = await DiaryEntry.aggregate([
        {
          $match: {
            userId: req.authUser._id,
            deletedAt: null,
            isLocked: { $ne: true },
            isDraft: { $ne: true },
          },
        },
        { $sort: { date: -1, createdAt: -1, _id: -1 } },
        {
          $project: {
            title: 1,
            date: 1,
            mood: 1,
            tags: 1,
            isFavorite: 1,
            createdAt: 1,
            updatedAt: 1,
          },
        },
        {
          $facet: {
            summary: [
              {
                $group: {
                  _id: null,
                  totalEntries: { $sum: 1 },
                  favoriteCount: {
                    $sum: { $cond: [{ $eq: ["$isFavorite", true] }, 1, 0] },
                  },
                  entriesThisWeek: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $gte: ["$date", weekStart] },
                            { $lte: ["$date", req.query.today] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                  entriesThisMonth: {
                    $sum: {
                      $cond: [
                        {
                          $and: [
                            { $gte: ["$date", monthStart] },
                            { $lte: ["$date", req.query.today] },
                          ],
                        },
                        1,
                        0,
                      ],
                    },
                  },
                },
              },
              { $project: { _id: 0 } },
            ],
            streak: buildStreakPipeline(req.query.today),
            moods: [
              {
                $group: {
                  _id: { $ifNull: ["$mood", "NEUTRAL"] },
                  count: { $sum: 1 },
                },
              },
              { $project: { _id: 0, mood: "$_id", count: 1 } },
            ],
            tags: [
              { $unwind: "$tags" },
              { $group: { _id: "$tags", count: { $sum: 1 } } },
              { $sort: { count: -1, _id: 1 } },
              { $limit: 8 },
              { $project: { _id: 0, tag: "$_id", count: 1 } },
            ],
            activity: [
              { $match: { date: { $gte: range.from, $lte: range.to } } },
              { $group: { _id: dateGroup, count: { $sum: 1 } } },
              { $sort: { _id: 1 } },
              {
                $project: {
                  _id: 0,
                  period: {
                    $cond: [
                      { $eq: [group, "day"] },
                      "$_id",
                      {
                        $dateToString: {
                          format: group === "month" ? "%Y-%m" : "%Y-%m-%d",
                          date: "$_id",
                          timezone: "UTC",
                        },
                      },
                    ],
                  },
                  count: 1,
                },
              },
            ],
            recentEntries: [{ $limit: 5 }, { $project: entryProjection() }],
            favoriteEntries: [
              { $match: { isFavorite: true } },
              { $limit: 5 },
              { $project: entryProjection() },
            ],
          },
        },
      ]);

      const summary = result.summary[0] ?? {
        totalEntries: 0,
        favoriteCount: 0,
        entriesThisWeek: 0,
        entriesThisMonth: 0,
      };
      const streak = result.streak[0] ?? {
        current: 0,
        longest: 0,
        writtenToday: false,
      };
      const moodCounts = new Map(
        result.moods.map(({ mood, count }) => [mood, count])
      );
      return {
        summary: { ...summary, ...streak },
        moodDistribution: diaryMoods.map((mood) => ({
          mood,
          count: moodCounts.get(mood) ?? 0,
        })),
        topTags: result.tags,
        activity: result.activity,
        recentEntries: result.recentEntries,
        favoriteEntries: result.favoriteEntries,
        period: { group, ...range },
      };
    },
  });
  res.json(dashboard);
}
