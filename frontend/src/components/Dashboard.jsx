import { useEffect, useState } from "react";
import { getDashboard } from "../api/entries.js";

const moodLabels = {
  HAPPY: "Happy",
  GOOD: "Good",
  NEUTRAL: "Neutral",
  SAD: "Sad",
  ANGRY: "Angry",
  EXCITED: "Excited",
};
const moodColors = {
  HAPPY: "bg-amber-400",
  GOOD: "bg-emerald-500",
  NEUTRAL: "bg-slate-400",
  SAD: "bg-blue-400",
  ANGRY: "bg-rose-500",
  EXCITED: "bg-violet-500",
};

function localToday() {
  const date = new Date();
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
  return date.toISOString().slice(0, 10);
}

function formatActivityLabel(period, group) {
  if (group === "month") {
    const [year, month] = period.split("-");
    return new Date(Number(year), Number(month) - 1, 1).toLocaleDateString(
      undefined,
      { month: "short" }
    );
  }
  if (group === "week") {
    const [, month, day] = period.split("-");
    return `${Number(month)}/${Number(day)}`;
  }
  return new Date(`${period}T12:00:00`).toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
}

function formatEntryDate(date) {
  if (!date) return "Date unavailable";
  return new Date(`${date.slice(0, 10)}T12:00:00`).toLocaleDateString(
    undefined,
    { month: "short", day: "numeric", year: "numeric" }
  );
}

function DashboardEntryList({ entries, darkMode, emptyText, onEntrySelect }) {
  if (!entries.length) {
    return <p className="px-4 py-6 text-sm opacity-60">{emptyText}</p>;
  }

  return (
    <ul
      className={`divide-y ${
        darkMode ? "divide-stone-800" : "divide-stone-200/70"
      }`}
    >
      {entries.map((entry) => (
        <li key={entry._id}>
          <button
            className={`flex w-full items-center gap-3 px-4 py-3 text-left transition ${
              darkMode ? "hover:bg-stone-800/70" : "hover:bg-stone-50"
            }`}
            onClick={() => onEntrySelect(entry._id)}
            type="button"
          >
            <span className="min-w-0 flex-1">
              <span className="block truncate text-sm font-medium">
                {entry.isLocked
                  ? "🔒 Locked entry"
                  : entry.title || "Untitled entry"}
              </span>
              <span className="mt-1 block text-xs opacity-55">
                {formatEntryDate(entry.date)}
                {!entry.isLocked && entry.mood
                  ? ` · ${moodLabels[entry.mood] || entry.mood}`
                  : ""}
              </span>
            </span>
            <span aria-hidden="true" className="text-sm opacity-40">
              ›
            </span>
          </button>
        </li>
      ))}
    </ul>
  );
}

export default function Dashboard({ darkMode, revision, onEntrySelect }) {
  const [group, setGroup] = useState("day");
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [retry, setRetry] = useState(0);
  const today = localToday();

  useEffect(() => {
    let active = true;
    setData(null);
    setLoading(true);
    setError("");
    getDashboard(today, group)
      .then((response) => {
        if (active) setData(response);
      })
      .catch((requestError) => {
        if (active) setError(requestError.message);
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [group, retry, revision, today]);

  const panelClass = `rounded-2xl border ${
    darkMode ? "border-stone-800 bg-stone-900" : "border-stone-200 bg-white"
  }`;
  const summary = data?.summary;
  const cards = [
    {
      label: "Published entries",
      value: summary?.totalEntries ?? 0,
      icon: "▤",
    },
    {
      label: "Current streak",
      value: `${summary?.current ?? 0} days`,
      icon: "🔥",
    },
    {
      label: "Longest streak",
      value: `${summary?.longest ?? 0} days`,
      icon: "✦",
    },
    { label: "Favorites", value: summary?.favoriteCount ?? 0, icon: "★" },
    { label: "This week", value: summary?.entriesThisWeek ?? 0, icon: "▦" },
    { label: "This month", value: summary?.entriesThisMonth ?? 0, icon: "◷" },
  ];
  const activity = data?.activity ?? [];
  const activityCounts = new Map(
    activity.map(({ period, count }) => [period, count])
  );
  const activitySeries = [];
  if (data?.period.group === "day") {
    const cursor = new Date(`${data.period.from}T00:00:00.000Z`);
    const end = new Date(`${data.period.to}T00:00:00.000Z`);
    while (cursor <= end) {
      const period = cursor.toISOString().slice(0, 10);
      activitySeries.push({ period, count: activityCounts.get(period) ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 1);
    }
  } else if (data?.period.group === "week") {
    const cursor = new Date(`${data.period.from}T00:00:00.000Z`);
    const end = new Date(`${data.period.to}T00:00:00.000Z`);
    while (cursor <= end) {
      const period = cursor.toISOString().slice(0, 10);
      activitySeries.push({ period, count: activityCounts.get(period) ?? 0 });
      cursor.setUTCDate(cursor.getUTCDate() + 7);
    }
  } else if (data?.period.group === "month") {
    const [year, month] = data.period.from.split("-").map(Number);
    const cursor = new Date(Date.UTC(year, month - 1, 1));
    const end = new Date(`${data.period.to}T00:00:00.000Z`);
    while (cursor <= end) {
      const period = cursor.toISOString().slice(0, 7);
      activitySeries.push({ period, count: activityCounts.get(period) ?? 0 });
      cursor.setUTCMonth(cursor.getUTCMonth() + 1);
    }
  }
  const maxActivity = Math.max(1, ...activity.map((item) => item.count));
  const maxMood = Math.max(
    1,
    ...(data?.moodDistribution ?? []).map((item) => item.count)
  );
  const maxTag = Math.max(
    1,
    ...(data?.topTags ?? []).map((item) => item.count)
  );

  return (
    <section>
      <header className="mb-7 flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="text-sm font-medium text-emerald-700">
            A view of your journey
          </p>
          <h1 className="mt-1 text-2xl font-semibold tracking-tight sm:text-3xl">
            Personal dashboard
          </h1>
          <p className="mt-2 text-sm opacity-65">
            Your writing habits, moods, and recent memories.
          </p>
        </div>
        <label className="text-xs font-medium opacity-70">
          Activity by
          <select
            className={`ml-2 rounded-lg border px-3 py-2 text-sm ${
              darkMode
                ? "border-stone-700 bg-stone-900 text-stone-100"
                : "border-stone-200 bg-white text-stone-800"
            }`}
            onChange={(event) => setGroup(event.target.value)}
            value={group}
          >
            <option value="day">Day · last 30 days</option>
            <option value="week">Week · last 12 weeks</option>
            <option value="month">Month · last 12 months</option>
          </select>
        </label>
      </header>

      {error && (
        <div
          className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800"
          role="alert"
        >
          <span>Dashboard data could not be loaded. {error}</span>
          <button
            className="rounded-lg border border-red-300 px-3 py-1.5 font-medium hover:bg-red-100"
            onClick={() => setRetry((current) => current + 1)}
            type="button"
          >
            Try again
          </button>
        </div>
      )}

      {loading && !data ? (
        <p className="py-12 text-center text-sm opacity-60">
          Gathering your writing summary...
        </p>
      ) : !data ? (
        <p className={`${panelClass} px-4 py-8 text-center text-sm opacity-65`}>
          Dashboard data is unavailable. Try loading it again.
        </p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {cards.map((card) => (
              <article className={`${panelClass} p-4 sm:p-5`} key={card.label}>
                <div className="flex items-center justify-between">
                  <p className="text-sm opacity-65">{card.label}</p>
                  <span aria-hidden="true" className="text-lg text-emerald-700">
                    {card.icon}
                  </span>
                </div>
                <p className="mt-3 text-2xl font-semibold tracking-tight">
                  {loading ? "—" : card.value}
                </p>
              </article>
            ))}
          </div>

          {summary?.totalEntries === 0 && !loading && (
            <div className={`${panelClass} mt-5 px-6 py-10 text-center`}>
              <span aria-hidden="true" className="text-3xl">
                ✧
              </span>
              <h2 className="mt-3 font-semibold">Your story starts here</h2>
              <p className="mt-2 text-sm opacity-60">
                Write your first entry to see your activity and mood patterns.
              </p>
            </div>
          )}

          <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1.6fr)_minmax(280px,1fr)]">
            <article className={`${panelClass} p-4 sm:p-5`}>
              <div className="flex flex-wrap items-start justify-between gap-2">
                <div>
                  <h2 className="font-semibold">Writing activity</h2>
                  <p className="mt-1 text-xs opacity-55">
                    Published entries per {group}
                  </p>
                </div>
                <span className="text-xs opacity-55">
                  {data?.period.from} – {data?.period.to}
                </span>
              </div>
              {!loading && summary?.totalEntries === 0 ? (
                <p className="py-12 text-center text-sm opacity-55">
                  No writing activity in this period.
                </p>
              ) : (
                <div className="mt-6 flex h-44 items-end gap-1 sm:gap-2">
                  {activitySeries.map((item, index) => (
                    <div
                      className="flex h-full min-w-0 flex-1 flex-col items-center justify-end gap-2"
                      key={item.period}
                      title={`${item.period}: ${item.count} ${item.count === 1 ? "entry" : "entries"}`}
                    >
                      <span className="text-[10px] font-medium opacity-65">
                        {item.count || ""}
                      </span>
                      <div
                        aria-label={`${item.period}: ${item.count} entries`}
                        className={`w-full max-w-8 rounded-t-md transition-[height] ${
                          item.count
                            ? "bg-emerald-600"
                            : darkMode
                              ? "bg-stone-800"
                              : "bg-stone-100"
                        }`}
                        role="img"
                        style={{
                          height: `${item.count ? Math.max(10, (item.count / maxActivity) * 100) : 4}%`,
                        }}
                      />
                      {(group !== "day" ||
                        index % 5 === 0 ||
                        index === activitySeries.length - 1) && (
                        <span className="whitespace-nowrap text-[9px] opacity-50 sm:text-[10px]">
                          {formatActivityLabel(item.period, group)}
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </article>

            <article className={`${panelClass} p-4 sm:p-5`}>
              <h2 className="font-semibold">Mood distribution</h2>
              <p className="mt-1 text-xs opacity-55">
                Across your published entries
              </p>
              <ul className="mt-5 space-y-3">
                {(data?.moodDistribution ?? []).map(({ mood, count }) => (
                  <li key={mood}>
                    <div className="mb-1 flex justify-between text-xs">
                      <span>{moodLabels[mood] || mood}</span>
                      <span className="opacity-55">{count}</span>
                    </div>
                    <div
                      className={`h-2 overflow-hidden rounded-full ${darkMode ? "bg-stone-800" : "bg-stone-100"}`}
                    >
                      <div
                        className={`h-full rounded-full ${moodColors[mood] || "bg-emerald-500"}`}
                        style={{ width: `${(count / maxMood) * 100}%` }}
                      />
                    </div>
                  </li>
                ))}
              </ul>
            </article>
          </div>

          <div className="mt-5 grid gap-5 xl:grid-cols-3">
            <article className={`${panelClass} overflow-hidden`}>
              <header className="border-b border-stone-200/70 px-4 py-4 dark:border-stone-800">
                <h2 className="font-semibold">Recent entries</h2>
              </header>
              <DashboardEntryList
                darkMode={darkMode}
                emptyText="Your recent entries will appear here."
                entries={data?.recentEntries ?? []}
                onEntrySelect={onEntrySelect}
              />
            </article>

            <article className={`${panelClass} overflow-hidden`}>
              <header className="border-b border-stone-200/70 px-4 py-4 dark:border-stone-800">
                <h2 className="font-semibold">Favorite entries</h2>
              </header>
              <DashboardEntryList
                darkMode={darkMode}
                emptyText="Favorite entries will appear here."
                entries={data?.favoriteEntries ?? []}
                onEntrySelect={onEntrySelect}
              />
            </article>

            <article className={`${panelClass} p-4 sm:p-5`}>
              <h2 className="font-semibold">Most-used tags</h2>
              <p className="mt-1 text-xs opacity-55">
                Top tags across your entries
              </p>
              {!data?.topTags?.length ? (
                <p className="py-6 text-sm opacity-55">
                  Add tags to entries to see them here.
                </p>
              ) : (
                <ul className="mt-5 space-y-3">
                  {data.topTags.map(({ tag, count }) => (
                    <li key={tag}>
                      <div className="mb-1 flex justify-between text-xs">
                        <span className="truncate">#{tag}</span>
                        <span className="ml-3 opacity-55">{count}</span>
                      </div>
                      <div
                        className={`h-2 overflow-hidden rounded-full ${darkMode ? "bg-stone-800" : "bg-stone-100"}`}
                      >
                        <div
                          className="h-full rounded-full bg-emerald-600"
                          style={{ width: `${(count / maxTag) * 100}%` }}
                        />
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </article>
          </div>
        </>
      )}
    </section>
  );
}
