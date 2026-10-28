// The time guideline in weeks of the 27 KfBM components, taken from the
// official training framework plan (Ausbildungsrahmenplan). Pure data and
// checks, no database and no file access.
//
// Source (the only one the numbers come from):
//   Bundesgesetzblatt Jahrgang 2025 Teil I Nr. 62, ausgegeben zu Bonn am
//   28. Februar 2025: Verordnung über die Berufsausbildung zum Kaufmann für
//   Büromanagement und zur Kauffrau für Büromanagement (BüroMKfAusbV) vom
//   25. Februar 2025, Anlage (Ausbildungsrahmenplan), Spalte 4 "Zeitliche
//   Richtwerte in Wochen im 1. bis 15. Monat | 16. bis 36. Monat". The pages
//   named below are the pages "Seite N von 17" of that publication.
//   Section A (wahlqualifikationsübergreifende berufsprofilgebende Fertigkeiten)
//   is on pages 8 to 10, section B (Wahlqualifikationen) on pages 10 to 15,
//   section C (integrativ zu vermittelnde Fertigkeiten) on pages 15 to 17.
// Cross-checked against two documents of the BIBB (Ausbildung gestalten,
// Kaufmann/Kauffrau für Büromanagement, Bonn 2025): chapter 2.2.1 (overview,
// "Wochen insgesamt: 58 | 37" for section A, "44*" for two Wahlqualifikationen)
// and the "Muster Betrieblicher Ausbildungsplan" (pages 5 to 36), which prints
// every value together with its period.
//
// Rules of the mapping (nothing is calculated, every value is printed in the
// plan):
//  - Component number n is the position of the regulation: K1 to K9 are
//    section A positions 1 to 9 (§ 4 Abs. 2), K10 to K19 are the section B
//    Wahlqualifikationen 1 to 10 (§ 4 Abs. 3), K20 to K25 are the section C
//    positions 1 to 6 (§ 4 Abs. 4). K18 (Wahlqualifikation 9, Verwaltung) is
//    not imported, it has 22 weeks like every other one.
//  - A position whose weeks are split over the two periods is two components.
//    The plan prints one value per block of letters: position A6 has 6 weeks
//    in the 1st to 15th month (a to c, K6.1) and 11 weeks in the 16th to 36th
//    month (d to g, K6.2), C5 has 4 and 2 weeks (K24.1, K24.2), C6 has 2 and 9
//    weeks (K25.1, K25.2). The other positions of section A have one value in
//    one period.
//  - Every Wahlqualifikation has 22 weeks in the 16th to 36th month. A trainee
//    chooses two of them, so the weeks of all elective components must never be
//    added up (nine components give 198 weeks, a training has 44).
//  - Section C positions 1 to 4 (K20 to K23) have no weeks. The plan says
//    "Zeitliche Zuordnung: während der gesamten Ausbildung". They stay without
//    weeks (the import writes 0), nobody should invent a value.
//  - The values are gross weeks (Bruttozeiten): school, holidays and illness
//    are not deducted (BIBB, chapter 2.2.1). The plan has no hours at all.
//  - The planned hours (total_hours) are NOT official. They are weeks times 40
//    (HOURS_PER_WEEK), a decision of the owner of 28.10.2026. The factor 40 is
//    the rule the platform already used for the FIAE components (comment on
//    total_hours in the schema: "totalWeeks * 40"). It is a gross value, the
//    BIBB model calculation gives about three days a week in the company.
//    Without weeks (K20 to K23) there are no hours.

/**
 * Hours per week of the planned hours of a component. Decision of the owner of
 * 28.10.2026, not an official figure (the training framework plan has no hours).
 */
export const HOURS_PER_WEEK = 40;

/** Planned hours of a number of weeks: weeks times 40, 0 without weeks. */
export function hoursFromWeeks(weeks: number | null | undefined): number {
  return typeof weeks === 'number' && Number.isFinite(weeks) && weeks > 0
    ? weeks * HOURS_PER_WEEK
    : 0;
}

export type WeeksPeriod = 'months-1-15' | 'months-16-36' | 'whole-training';

export interface ComponentWeeks {
  /** Component code of the import (K1, K6.2, K24.1). */
  code: string;
  /** Position of the regulation: A1 to A9, B1 to B10, C1 to C6. */
  position: string;
  /** Period of the value, whole-training for the positions without weeks. */
  period: WeeksPeriod;
  /** Weeks printed in the plan, null where the plan prints none. */
  weeks: number | null;
  /**
   * Page "Seite N von 17" of the Bundesgesetzblatt that prints the value (the
   * page where the position starts for the ones without weeks).
   */
  page: number;
  /** Letters of the position that the value covers (blocks of a split). */
  letters: string;
}

const T1 = 'months-1-15' as const;
const T2 = 'months-16-36' as const;
const WHOLE = 'whole-training' as const;

/** The 27 imported components in the order of the plan. */
export const KFBM_COMPONENT_WEEKS: readonly ComponentWeeks[] = [
  // Section A, BGBl. 2025 I Nr. 62, Seite 8 to 9
  {
    code: 'K1',
    position: 'A1',
    period: T1,
    weeks: 11,
    page: 8,
    letters: 'a-f',
  },
  {
    code: 'K2',
    position: 'A2',
    period: T1,
    weeks: 11,
    page: 8,
    letters: 'a-j',
  },
  { code: 'K3', position: 'A3', period: T1, weeks: 7, page: 8, letters: 'a-d' },
  { code: 'K4', position: 'A4', period: T1, weeks: 5, page: 8, letters: 'a-c' },
  { code: 'K5', position: 'A5', period: T1, weeks: 7, page: 9, letters: 'a-e' },
  {
    code: 'K6.1',
    position: 'A6',
    period: T1,
    weeks: 6,
    page: 9,
    letters: 'a-c',
  },
  {
    code: 'K6.2',
    position: 'A6',
    period: T2,
    weeks: 11,
    page: 9,
    letters: 'd-g',
  },
  {
    code: 'K7',
    position: 'A7',
    period: T1,
    weeks: 11,
    page: 9,
    letters: 'a-f',
  },
  {
    code: 'K8',
    position: 'A8',
    period: T2,
    weeks: 13,
    page: 9,
    letters: 'a-e',
  },
  {
    code: 'K9',
    position: 'A9',
    period: T2,
    weeks: 13,
    page: 9,
    letters: 'a-f',
  },
  // Section B, Seite 10 to 15, 22 weeks each in the 16th to 36th month
  {
    code: 'K10',
    position: 'B1',
    period: T2,
    weeks: 22,
    page: 10,
    letters: 'a-u',
  },
  {
    code: 'K11',
    position: 'B2',
    period: T2,
    weeks: 22,
    page: 11,
    letters: 'a-n',
  },
  {
    code: 'K12',
    position: 'B3',
    period: T2,
    weeks: 22,
    page: 11,
    letters: 'a-s',
  },
  {
    code: 'K13',
    position: 'B4',
    period: T2,
    weeks: 22,
    page: 12,
    letters: 'a-o',
  },
  {
    code: 'K14',
    position: 'B5',
    period: T2,
    weeks: 22,
    page: 12,
    letters: 'a-o',
  },
  {
    code: 'K15',
    position: 'B6',
    period: T2,
    weeks: 22,
    page: 13,
    letters: 'a-m',
  },
  {
    code: 'K16',
    position: 'B7',
    period: T2,
    weeks: 22,
    page: 13,
    letters: 'a-m',
  },
  {
    code: 'K17',
    position: 'B8',
    period: T2,
    weeks: 22,
    page: 14,
    letters: 'a-h',
  },
  {
    code: 'K19',
    position: 'B10',
    period: T2,
    weeks: 22,
    page: 15,
    letters: 'a-j',
  },
  // Section C, Seite 15 to 17: positions 1 to 4 without weeks
  {
    code: 'K20',
    position: 'C1',
    period: WHOLE,
    weeks: null,
    page: 15,
    letters: 'a-i',
  },
  {
    code: 'K21',
    position: 'C2',
    period: WHOLE,
    weeks: null,
    page: 16,
    letters: 'a-g',
  },
  {
    code: 'K22',
    position: 'C3',
    period: WHOLE,
    weeks: null,
    page: 16,
    letters: 'a-f',
  },
  {
    code: 'K23',
    position: 'C4',
    period: WHOLE,
    weeks: null,
    page: 16,
    letters: 'a-h',
  },
  // Section C positions 5 and 6, Seite 17
  {
    code: 'K24.1',
    position: 'C5',
    period: T1,
    weeks: 4,
    page: 17,
    letters: 'a-d',
  },
  {
    code: 'K24.2',
    position: 'C5',
    period: T2,
    weeks: 2,
    page: 17,
    letters: 'e',
  },
  {
    code: 'K25.1',
    position: 'C6',
    period: T1,
    weeks: 2,
    page: 17,
    letters: 'a-c',
  },
  {
    code: 'K25.2',
    position: 'C6',
    period: T2,
    weeks: 9,
    page: 17,
    letters: 'd-k',
  },
];

/**
 * The totals the plan itself states, the check of the data above. A and the
 * electives are printed in the BIBB overview (chapter 2.2.1), C is the sum of
 * positions 5 and 6, the whole is three years of 52 weeks ("Die Summe der
 * zeitlichen Richtwerte im Ausbildungsrahmenplan beträgt pro Ausbildungsjahr
 * 52 Wochen").
 */
export const RAHMENPLAN_WEEK_TOTALS = {
  sectionA: { 'months-1-15': 58, 'months-16-36': 37 },
  sectionC: { 'months-1-15': 6, 'months-16-36': 11 },
  /** Weeks of one Wahlqualifikation, all in the 16th to 36th month. */
  electiveEach: 22,
  /** A training contract names two Wahlqualifikationen. */
  electivesChosen: 2,
  weeksPerTrainingYear: 52,
  trainingYears: 3,
  total: 156,
} as const;

/** The codes the import knows (K18 is excluded, three numbers are split). */
export const EXPECTED_COMPONENT_CODES: readonly string[] = [
  'K1',
  'K2',
  'K3',
  'K4',
  'K5',
  'K6.1',
  'K6.2',
  'K7',
  'K8',
  'K9',
  'K10',
  'K11',
  'K12',
  'K13',
  'K14',
  'K15',
  'K16',
  'K17',
  'K19',
  'K20',
  'K21',
  'K22',
  'K23',
  'K24.1',
  'K24.2',
  'K25.1',
  'K25.2',
];

type SectionOf = (code: string) => 'A' | 'B' | 'C' | null;

const sectionOf: SectionOf = code => {
  const match = /^K(\d{1,2})(?:\.\d)?$/.exec(code);
  if (!match) return null;
  const n = Number(match[1]);
  if (n >= 1 && n <= 9) return 'A';
  if (n >= 10 && n <= 19) return 'B';
  if (n >= 20 && n <= 25) return 'C';
  return null;
};

/** Sum of the weeks of the components of one section in one period. */
export function sumWeeks(
  entries: readonly ComponentWeeks[],
  section: 'A' | 'B' | 'C',
  period: WeeksPeriod
): number {
  return entries
    .filter(e => sectionOf(e.code) === section && e.period === period)
    .reduce((sum, e) => sum + (e.weeks ?? 0), 0);
}

/**
 * Checks the table: exactly the 27 codes once each, whole positive weeks (or no
 * weeks for the positions of the whole training), the position matching the
 * component number, and the totals of the plan. Returns the problems, an empty
 * list means the table is sound.
 */
export function validateComponentWeeks(
  entries: readonly ComponentWeeks[] = KFBM_COMPONENT_WEEKS
): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  for (const e of entries) {
    if (seen.has(e.code)) errors.push(`${e.code} is listed twice`);
    seen.add(e.code);
    if (!EXPECTED_COMPONENT_CODES.includes(e.code)) {
      errors.push(`${e.code} is not a component of the import`);
    }
    const section = sectionOf(e.code);
    const n = Number(/^K(\d{1,2})/.exec(e.code)?.[1]);
    const expectedPosition =
      section === 'A'
        ? `A${n}`
        : section === 'B'
          ? `B${n - 9}`
          : section === 'C'
            ? `C${n - 19}`
            : null;
    if (e.position !== expectedPosition) {
      errors.push(`${e.code} must be position ${expectedPosition}`);
    }
    if (!Number.isInteger(e.page) || e.page < 8 || e.page > 17) {
      errors.push(`${e.code} names a page outside the plan (8 to 17)`);
    }
    if (e.period === 'whole-training') {
      if (e.weeks !== null) {
        errors.push(`${e.code} is whole-training and must have no weeks`);
      }
      if (section !== 'C') {
        errors.push(`${e.code}: only section C has no weeks`);
      }
    } else if (
      e.weeks === null ||
      !Number.isInteger(e.weeks) ||
      e.weeks < 1 ||
      e.weeks > RAHMENPLAN_WEEK_TOTALS.total
    ) {
      errors.push(`${e.code} needs whole weeks of at least 1`);
    }
    if (section === 'B' && (e.period !== T2 || e.weeks !== 22)) {
      errors.push(
        `${e.code} is a Wahlqualifikation: 22 weeks, 16th to 36th month`
      );
    }
  }
  for (const code of EXPECTED_COMPONENT_CODES) {
    if (!seen.has(code)) errors.push(`${code} is missing`);
  }
  if (entries.length !== EXPECTED_COMPONENT_CODES.length) {
    errors.push(
      `${EXPECTED_COMPONENT_CODES.length} components are expected, found ${entries.length}`
    );
  }
  if (errors.length > 0) return errors;

  const totals = RAHMENPLAN_WEEK_TOTALS;
  for (const period of [T1, T2] as const) {
    const a = sumWeeks(entries, 'A', period);
    if (a !== totals.sectionA[period]) {
      errors.push(
        `section A ${period} adds up to ${a}, the plan says ${totals.sectionA[period]}`
      );
    }
    const c = sumWeeks(entries, 'C', period);
    if (c !== totals.sectionC[period]) {
      errors.push(
        `section C ${period} adds up to ${c}, the plan says ${totals.sectionC[period]}`
      );
    }
  }
  const whole =
    sumWeeks(entries, 'A', T1) +
    sumWeeks(entries, 'A', T2) +
    sumWeeks(entries, 'C', T1) +
    sumWeeks(entries, 'C', T2) +
    totals.electiveEach * totals.electivesChosen;
  if (whole !== totals.total) {
    errors.push(
      `a training adds up to ${whole} weeks, expected ${totals.total}`
    );
  }
  if (totals.weeksPerTrainingYear * totals.trainingYears !== totals.total) {
    errors.push('three training years of 52 weeks must give the total');
  }
  return errors;
}

/**
 * The weeks of a component code: a whole number, null where the plan prints no
 * weeks (K20 to K23), undefined for a code the table does not know.
 */
export function officialWeeksOf(code: string): number | null | undefined {
  const entry = KFBM_COMPONENT_WEEKS.find(e => e.code === code);
  return entry ? entry.weeks : undefined;
}
