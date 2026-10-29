/**
 * The calendar day of the platform (Germany) as an instant, for the questions
 * "is this date still ahead" (upcoming exams, appointments of the dashboard).
 *
 * Comparing with the current instant is wrong for dates: an exam on today's
 * date is stored as a date without a time (midnight UTC) and would count as
 * past from the first minute of the day. Comparing with the start of today
 * keeps today's date upcoming, and it follows the calendar of the people who
 * use the platform instead of the time zone of the server (UTC).
 */

export const PLATFORM_TIME_ZONE = 'Europe/Berlin';

const DAY_MS = 24 * 60 * 60 * 1000;

function partsIn(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(date);
  const get = (type: string) =>
    Number(parts.find(part => part.type === type)?.value);
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
    second: get('second'),
  };
}

/** Offset of the time zone from UTC at an instant, in milliseconds. */
function offsetAt(date: Date, timeZone: string): number {
  const p = partsIn(date, timeZone);
  const asUtc = Date.UTC(
    p.year,
    p.month - 1,
    p.day,
    p.hour,
    p.minute,
    p.second
  );
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** The instant the current calendar day of the time zone started. */
export function startOfToday(
  now: Date = new Date(),
  timeZone: string = PLATFORM_TIME_ZONE
): Date {
  const { year, month, day } = partsIn(now, timeZone);
  const midnightUtc = Date.UTC(year, month - 1, day);
  // The offset at that date (daylight saving time changes at night, after
  // local midnight, so the offset at UTC midnight is the one of local midnight)
  return new Date(midnightUtc - offsetAt(new Date(midnightUtc), timeZone));
}

/** Where a date lies relative to the start of today. */
export function daysFromToday(
  date: Date,
  now: Date = new Date(),
  timeZone: string = PLATFORM_TIME_ZONE
) {
  const start = startOfToday(now, timeZone).getTime();
  const daysUntil = Math.floor((date.getTime() - start) / DAY_MS);
  return {
    daysUntil,
    isPast: date.getTime() < start,
    isToday: daysUntil === 0,
    isSoon: daysUntil >= 0 && daysUntil <= 7,
  };
}

/** ISO 8601 calendar week (1 to 53) of a calendar date. */
export function isoWeekOfDate(
  year: number,
  month: number,
  day: number
): number {
  const d = new Date(Date.UTC(year, month - 1, day));
  const dayNum = d.getUTCDay() || 7;
  // the Thursday of the week decides the year of the week
  d.setUTCDate(d.getUTCDate() + 4 - dayNum);
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1);
  return Math.ceil(((d.getTime() - yearStart) / DAY_MS + 1) / 7);
}

/** ISO calendar week of an instant, on the calendar of the time zone. */
export function isoWeekOf(
  date: Date,
  timeZone: string = PLATFORM_TIME_ZONE
): number {
  const { year, month, day } = partsIn(date, timeZone);
  return isoWeekOfDate(year, month, day);
}
