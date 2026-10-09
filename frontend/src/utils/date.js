export function localDateKey(year, monthIndex, day) {
  return `${year}-${String(monthIndex + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

export function localMonthDateRange(year, monthIndex) {
  const lastDay = new Date(year, monthIndex + 1, 0).getDate();
  return {
    from: localDateKey(year, monthIndex, 1),
    to: localDateKey(year, monthIndex, lastDay),
  };
}
