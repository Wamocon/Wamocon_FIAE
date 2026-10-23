/**
 * Phase plan of an occupation: how many months phase 1 and phase 2 last for a
 * trainee of a given overall duration (3 years standard, 2 years shortened).
 *
 * Pure function over the stored catalog settings (training_catalogs.settings,
 * snake_case jsonb), so it works on the server and in the browser.
 *
 * Rules:
 *  - 3 years: settings.phase_months, for example [18, 18] (FIAE) or
 *    [15, 21] (KfBM).
 *  - 2 years: settings.shortened_training_rules.phase_months if it is valid,
 *    otherwise the standard split scaled to 24 months (KfBM 15 + 21 becomes
 *    10 + 14, FIAE 18 + 18 becomes 12 + 12 as before).
 *  - A plan is only valid if both phases are positive whole months and add up
 *    to the duration (36 or 24 months). Missing or invalid settings fall back
 *    to the values used before the catalogs: 18 + 18 and 12 + 12 months.
 */

import {
  normalizeDurationYears,
  type AusbildungDurationYears,
} from '@/lib/ausbildung/duration';
import {
  DEFAULT_CATALOG_SETTINGS,
  catalogSettingsSchema,
} from '@/lib/catalog/settings';

export interface PhasePlan {
  durationYears: AusbildungDurationYears;
  /** Whole training in months (duration times 12). */
  totalMonths: number;
  /** Months of phase 1 and phase 2, they add up to totalMonths. */
  phaseMonths: [number, number];
}

const STANDARD_YEARS = 3;
const SHORTENED_YEARS = 2;

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

/** A valid pair of phase months that adds up to `totalMonths`, or null. */
function parsePhaseMonths(
  value: unknown,
  totalMonths: number
): [number, number] | null {
  const parsed = catalogSettingsSchema.shape.phase_months.safeParse(value);
  if (!parsed.success || !parsed.data) return null;
  const [one, two] = parsed.data;
  return one + two === totalMonths ? [one, two] : null;
}

/** Phase lengths in months for the given catalog settings and duration. */
export function resolvePhasePlan(
  settings: unknown,
  durationYears: number | null | undefined
): PhasePlan {
  const duration = normalizeDurationYears(durationYears);
  const totalMonths = duration * 12;
  const source = isRecord(settings) ? settings : {};

  const standardTotal = STANDARD_YEARS * 12;
  const standard: [number, number] = parsePhaseMonths(
    source.phase_months,
    standardTotal
  ) ?? [...DEFAULT_CATALOG_SETTINGS.phaseMonths];

  if (duration !== SHORTENED_YEARS) {
    return { durationYears: duration, totalMonths, phaseMonths: standard };
  }

  const rules = isRecord(source.shortened_training_rules)
    ? source.shortened_training_rules
    : {};
  const fromRules = parsePhaseMonths(rules.phase_months, totalMonths);
  if (fromRules) {
    return { durationYears: duration, totalMonths, phaseMonths: fromRules };
  }

  // Scale the standard split to the shortened duration, both phases keep at
  // least one month.
  const phaseOne = Math.min(
    totalMonths - 1,
    Math.max(1, Math.round((standard[0] * totalMonths) / standardTotal))
  );
  return {
    durationYears: duration,
    totalMonths,
    phaseMonths: [phaseOne, totalMonths - phaseOne],
  };
}
