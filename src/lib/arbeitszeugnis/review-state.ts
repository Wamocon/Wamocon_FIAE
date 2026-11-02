/**
 * Pure helpers of the certificate (Arbeitszeugnis) page of the trainer: what
 * keeps the buttons of the Gesamturteil from working and how the period is
 * written. Client safe (no database).
 */

export { TRAINING_START_MISSING_CODE } from './period';

export type GenerateMissing = 'grade' | 'components';

/**
 * Why the buttons that generate the Gesamturteil are not usable: the trainer
 * has not chosen an overall grade, or the period holds no graded activity (no
 * average to write about). Empty when nothing is missing.
 */
export function generateBlockers(input: {
  overallGrade: number | null;
  overallAverage: number | null | undefined;
}): GenerateMissing[] {
  const missing: GenerateMissing[] = [];
  if (input.overallGrade === null) missing.push('grade');
  if (!input.overallAverage) missing.push('components');
  return missing;
}

/**
 * A period date as the day it stands for. The server sends the start of the
 * first day and the end of the last day (23:59:59.999) as UTC instants, shown
 * in the time zone of the browser the end of 31 July became 1 August.
 */
export function formatPeriodDate(value: string | Date | null | undefined) {
  if (!value) return '–';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '–';
  return date.toLocaleDateString('de-DE', { timeZone: 'UTC' });
}
