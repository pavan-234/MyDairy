export function buildStreakPipeline(today) {
  const yesterday = new Date(
    new Date(`${today}T00:00:00.000Z`).getTime() - 86400000
  )
    .toISOString()
    .slice(0, 10);

  return [
    { $group: { _id: "$date" } },
    { $sort: { _id: 1 } },
    {
      $setWindowFields: {
        sortBy: { _id: 1 },
        output: {
          previousDate: { $shift: { output: "$_id", by: -1 } },
        },
      },
    },
    {
      $project: {
        date: "$_id",
        runStart: {
          $cond: [
            { $eq: ["$previousDate", null] },
            1,
            {
              $cond: [
                {
                  $eq: [
                    {
                      $dateDiff: {
                        startDate: {
                          $dateFromString: { dateString: "$previousDate" },
                        },
                        endDate: { $dateFromString: { dateString: "$_id" } },
                        unit: "day",
                        timezone: "UTC",
                      },
                    },
                    1,
                  ],
                },
                0,
                1,
              ],
            },
          ],
        },
      },
    },
    {
      $setWindowFields: {
        sortBy: { date: 1 },
        output: {
          runId: {
            $sum: "$runStart",
            window: { documents: ["unbounded", "current"] },
          },
        },
      },
    },
    {
      $group: {
        _id: "$runId",
        length: { $sum: 1 },
        lastDate: { $max: "$date" },
      },
    },
    {
      $group: {
        _id: null,
        longest: { $max: "$length" },
        runs: { $push: { length: "$length", lastDate: "$lastDate" } },
      },
    },
    {
      $project: {
        _id: 0,
        longest: 1,
        current: {
          $reduce: {
            input: "$runs",
            initialValue: 0,
            in: {
              $cond: [
                { $in: ["$$this.lastDate", [today, yesterday]] },
                "$$this.length",
                "$$value",
              ],
            },
          },
        },
        writtenToday: {
          $in: [
            today,
            { $map: { input: "$runs", as: "run", in: "$$run.lastDate" } },
          ],
        },
      },
    },
  ];
}
