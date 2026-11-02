/**
 * The period of a certificate (Arbeitszeugnis) by training year. The year is
 * counted from the start of the training of the trainee. Without a start date
 * there is no period: nothing is invented (before, 1 August 2025 was assumed,
 * so the "first training year" of a trainee without a start date showed
 * reports of the wrong months and counted 0 of 1 approved reports).
 */

import { getTrainingYearDateRange } from '@/lib/ausbildung/duration';

/** Code of the answer of a route when the start of the training is missing. */
export const TRAINING_START_MISSING_CODE = 'TRAINING_START_MISSING';

export const TRAINING_START_MISSING_MESSAGE =
  'Für diesen Azubi ist kein Ausbildungsstart hinterlegt. Der Zeitraum kann nicht berechnet werden. Wähle einen eigenen Zeitraum oder hinterlege den Ausbildungsstart im Profil.';

export function resolveTrainingYearPeriod(input: {
  startDate: Date | string | null | undefined;
  ausbildungsjahr: number;
  durationYears: number | null | undefined;
}): { startDate: Date; endDate: Date } | null {
  if (!input.startDate) return null;
  const start =
    input.startDate instanceof Date
      ? input.startDate
      : new Date(input.startDate);
  if (Number.isNaN(start.getTime())) return null;
  return getTrainingYearDateRange(
    start,
    input.ausbildungsjahr,
    input.durationYears
  );
}
