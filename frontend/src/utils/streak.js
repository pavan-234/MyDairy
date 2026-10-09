export function calculateStreak(entries, today) {
  const entryDates = new Set(
    entries
      .map((entry) => entry.date?.slice(0, 10))
      .filter((date) => {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date || "")) return false;
        const parsedDate = new Date(`${date}T00:00:00Z`);
        return (
          !Number.isNaN(parsedDate.getTime()) &&
          parsedDate.toISOString().slice(0, 10) === date
        );
      })
  );
  const dayNumber = (date) => Date.parse(`${date}T00:00:00Z`) / 86400000;
  const dates = [...entryDates]
    .map(dayNumber)
    .sort((first, second) => first - second);

  let longest = 0;
  let run = 0;
  let previousDay = null;

  for (const day of dates) {
    run = previousDay !== null && day === previousDay + 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    previousDay = day;
  }

  const todayNumber = dayNumber(today);
  const yesterday = new Date((todayNumber - 1) * 86400000)
    .toISOString()
    .slice(0, 10);
  let current = 0;
  let streakDay = entryDates.has(today)
    ? todayNumber
    : entryDates.has(yesterday)
      ? todayNumber - 1
      : null;

  while (streakDay !== null) {
    const date = new Date(streakDay * 86400000).toISOString().slice(0, 10);
    if (!entryDates.has(date)) break;
    current += 1;
    streakDay -= 1;
  }

  return {
    current,
    longest,
    writtenToday: entryDates.has(today),
  };
}
