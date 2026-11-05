import { getTrainingPhase } from '@/lib/ausbildung/duration';
import { getISOWeekInfo } from '@/lib/date/iso-week';

/** The school year of today, e.g. "2026/2027". German school years start in August. */
export function getCurrentSchuljahr(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  return month >= 8 ? `${year}/${year + 1}` : `${year - 1}/${year}`;
}

/** The training phase (Ausbildungsjahr) of a trainee at a date. */
export function calculateAusbildungsjahr(
  startDate: Date,
  durationYears?: number | null,
  atDate: Date = new Date(),
  phaseOneMonths?: number | null
): number {
  return getTrainingPhase(startDate, durationYears, atDate, phaseOneMonths);
}

/** The ISO calendar week number of a date. */
export function getISOWeek(date: Date): number {
  return getISOWeekInfo(date).week;
}
