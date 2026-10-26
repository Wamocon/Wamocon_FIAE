// The learning field model of the KfBM catalog (phase 4.5): how many learning
// fields there are, in which school year each one lies and how its code is
// written. Pure functions and constants, no file access, no database.
//
// The year assignment (learning fields 1 to 4 in school year 1, 5 to 8 in year
// 2, 9 to 13 in year 3) comes from the mapping work of the project (see
// docs/kfbm-import-runbook.md). The code is written LF1 to LF13 like the seed of
// the FIAE learning fields (scripts/seed-lernfelder.ts), the column is
// training_catalog_learning_fields.code.

export type SchoolYear = 1 | 2 | 3;

/** Number of learning fields of the KfBM. */
export const LEARNING_FIELD_COUNT = 13;

/** First and last learning field of each school year. */
export const YEAR_RANGES: ReadonlyArray<{
  year: SchoolYear;
  first: number;
  last: number;
}> = [
  { year: 1, first: 1, last: 4 },
  { year: 2, first: 5, last: 8 },
  { year: 3, first: 9, last: 13 },
];

/** School year of a learning field number, null outside 1 to 13. */
export function learningFieldYear(number: number): SchoolYear | null {
  if (!Number.isInteger(number)) return null;
  const range = YEAR_RANGES.find(r => number >= r.first && number <= r.last);
  return range ? range.year : null;
}

/** LF1 to LF13. */
export function learningFieldCode(number: number): string {
  return `LF${number}`;
}

/** Number of a code written LF1 to LF13, otherwise null. */
export function learningFieldNumber(code: string): number | null {
  const match = /^LF(\d{1,2})$/.exec(code);
  if (!match) return null;
  const number = Number(match[1]);
  return learningFieldYear(number) === null ? null : number;
}

/** The learning field numbers of one school year, in order. */
export function learningFieldsOfYear(year: SchoolYear): number[] {
  const range = YEAR_RANGES.find(r => r.year === year);
  if (!range) return [];
  const out: number[] = [];
  for (let n = range.first; n <= range.last; n += 1) out.push(n);
  return out;
}
