/** Number of days of a month (month is 0-based). */
export function getDaysInMonth(year: number, month: number) {
  return new Date(year, month + 1, 0).getDate();
}

/** Weekday of the first day of a month, Monday = 0. */
export function getFirstDayOfMonth(year: number, month: number) {
  const day = new Date(year, month, 1).getDay();
  return day === 0 ? 6 : day - 1;
}

/** Whether a date lies within the range of a block (both days included). */
export function isDateInBlock(
  date: Date,
  block: { startDate: string; endDate: string }
): boolean {
  const start = new Date(block.startDate);
  const end = new Date(block.endDate);
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return date >= start && date <= end;
}
