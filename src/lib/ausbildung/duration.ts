/**
 * Central helpers for variable-duration Ausbildung plans.
 *
 * The 26 ARP training components are grouped by phases:
 *  - phase 1: component order 1-12
 *  - phase 2: component order 13-22
 *  - phase 3: integrative components order 23-26, active for the whole plan
 *
 * A 3-year plan keeps the legacy 18 + 18 month split. A 2-year intensive plan
 * compresses those same two phases to 12 + 12 months.
 */

export type AusbildungDurationYears = 2 | 3;
export type TrainingPhase = 1 | 2;
export type TrainingComponentPhase = 1 | 2 | 3;
export type ContentStage = TrainingComponentPhase;

export const DEFAULT_DURATION_YEARS: AusbildungDurationYears = 3;
const WEEKS_PER_YEAR = 52;

/** Normalise an arbitrary value to a valid duration (2/3), defaulting to 3. */
export function normalizeDurationYears(
  value: number | null | undefined
): AusbildungDurationYears {
  if (value === 2 || value === 3) return value;
  return DEFAULT_DURATION_YEARS;
}

/** User-facing label for the selected overall Ausbildung duration. */
export function getAusbildungDurationLabel(
  value: number | null | undefined
): string {
  const duration = normalizeDurationYears(value);
  return duration === 2
    ? '2 Jahre (Verkürzte Ausbildungszeit)'
    : '3 Jahre (Regelausbildungszeit)';
}

/** Whole months elapsed between two dates (calendar months, not 30-day chunks). */
function monthsBetween(start: Date, now: Date): number {
  let months =
    (now.getFullYear() - start.getFullYear()) * 12 +
    (now.getMonth() - start.getMonth());
  if (now.getDate() < start.getDate()) months -= 1;
  return Math.max(0, months);
}

/** Add a number of months to a date, clamping the day to the target month length. */
function addMonths(date: Date, months: number): Date {
  const d = new Date(date.getTime());
  const targetMonth = d.getMonth() + months;
  const result = new Date(d.getFullYear(), targetMonth, 1);
  const lastDay = new Date(
    result.getFullYear(),
    result.getMonth() + 1,
    0
  ).getDate();
  result.setDate(Math.min(d.getDate(), lastDay));
  result.setHours(
    d.getHours(),
    d.getMinutes(),
    d.getSeconds(),
    d.getMilliseconds()
  );
  return result;
}

function getPhaseOneMonths(durationYears: AusbildungDurationYears): number {
  return durationYears === 2 ? 12 : 18;
}

/** Month range for phase labels. Months are one-based and inclusive. */
export function getPhaseMonthRange(
  durationYears: number | null | undefined,
  phase: TrainingPhase
): { startMonth: number; endMonth: number } {
  const duration = normalizeDurationYears(durationYears);
  const phaseOneMonths = getPhaseOneMonths(duration);

  if (phase === 1) {
    return { startMonth: 1, endMonth: phaseOneMonths };
  }

  return {
    startMonth: phaseOneMonths + 1,
    endMonth: duration * 12,
  };
}

/** Current module phase (1/2) for the trainee's selected Ausbildung duration. */
export function getTrainingPhase(
  startDate: Date,
  durationYears: number | null | undefined = DEFAULT_DURATION_YEARS,
  now: Date = new Date()
): TrainingPhase {
  const duration = normalizeDurationYears(durationYears);
  const phaseOneMonths = getPhaseOneMonths(duration);
  const monthsSince = monthsBetween(startDate, now);
  return monthsSince < phaseOneMonths ? 1 : 2;
}

/** Backward-compatible alias: stored ausbildungsjahr values now mean phase. */
export const getContentStage = getTrainingPhase;

/**
 * Current calendar reporting year (1 .. durationYears) for a trainee, based on
 * real elapsed calendar years. Defaults to a 3-year plan.
 */
export function getCalendarYear(
  startDate: Date,
  durationYears: number | null | undefined = DEFAULT_DURATION_YEARS,
  now: Date = new Date()
): number {
  const duration = normalizeDurationYears(durationYears);
  const monthsSince = monthsBetween(startDate, now);
  const year = Math.floor(monthsSince / 12) + 1;
  if (year < 1) return 1;
  if (year > duration) return duration;
  return year;
}

/** Total number of weekly report cycles expected for the whole apprenticeship. */
export function getTotalDurationWeeks(
  durationYears: number | null | undefined = DEFAULT_DURATION_YEARS
): number {
  return normalizeDurationYears(durationYears) * WEEKS_PER_YEAR;
}

/**
 * Deadline by which a phase should be completed. Integrative phase 3 uses the
 * overall Ausbildung end date because it runs across the whole plan.
 */
export function getPhaseDeadline(
  startDate: Date,
  durationYears: number | null | undefined,
  phase: TrainingComponentPhase
): Date {
  const duration = normalizeDurationYears(durationYears);
  if (phase === 1) return addMonths(startDate, getPhaseOneMonths(duration));
  return addMonths(startDate, duration * 12);
}

/** Backward-compatible alias for callers still using content-stage wording. */
export function getContentStageDeadline(
  startDate: Date,
  stage: TrainingComponentPhase,
  durationYears: number | null | undefined = DEFAULT_DURATION_YEARS
): Date {
  return getPhaseDeadline(startDate, durationYears, stage);
}

/** Overall planned end date of the apprenticeship. */
export function getTrainingEndDate(
  startDate: Date,
  durationYears: number | null | undefined = DEFAULT_DURATION_YEARS
): Date {
  return addMonths(startDate, normalizeDurationYears(durationYears) * 12);
}

export const getAusbildungEndDate = getTrainingEndDate;

/** Inclusive date range for phase-specific or final certificate calculations. */
export function getPhaseDateRange(
  startDate: Date,
  phase: TrainingComponentPhase | 0,
  durationYears: number | null | undefined = DEFAULT_DURATION_YEARS
): { startDate: Date; endDate: Date } {
  const duration = normalizeDurationYears(durationYears);
  const phaseOneMonths = getPhaseOneMonths(duration);
  const startOffsetMonths = phase === 2 ? phaseOneMonths : 0;
  const endOffsetMonths =
    phase === 1 ? phaseOneMonths : normalizeDurationYears(duration) * 12;

  const rangeStart = addMonths(startDate, startOffsetMonths);
  const rangeEnd = addMonths(startDate, endOffsetMonths);
  rangeEnd.setDate(rangeEnd.getDate() - 1);
  rangeEnd.setHours(23, 59, 59, 999);

  return { startDate: rangeStart, endDate: rangeEnd };
}

/** Inclusive date range for year-based reports/certificates. */
export function getTrainingYearDateRange(
  startDate: Date,
  ausbildungsjahr: number,
  durationYears: number | null | undefined = DEFAULT_DURATION_YEARS
): { startDate: Date; endDate: Date } {
  const duration = normalizeDurationYears(durationYears);
  const normalizedYear =
    ausbildungsjahr === 0
      ? 0
      : Math.min(Math.max(Math.trunc(ausbildungsjahr) || 1, 1), duration);

  if (normalizedYear === 0) {
    return getPhaseDateRange(startDate, 0, duration);
  }

  const rangeStart = addMonths(startDate, (normalizedYear - 1) * 12);
  const rangeEnd = addMonths(startDate, normalizedYear * 12);
  rangeEnd.setDate(rangeEnd.getDate() - 1);
  rangeEnd.setHours(23, 59, 59, 999);

  return { startDate: rangeStart, endDate: rangeEnd };
}

/**
 * Expected number of completed weekly reports for a given calendar year, used to
 * gauge annual-summary completeness.
 *  - Past years are fully expected (52 weeks).
 *  - The current year expects everything up to the previous ISO week.
 *  - Future years expect nothing.
 */
export function getExpectedWeeksForYear(
  year: number,
  currentYear: number,
  currentWeek: number
): number {
  if (year < currentYear) return WEEKS_PER_YEAR;
  if (year === currentYear) return Math.max(0, currentWeek - 1);
  return 0;
}
