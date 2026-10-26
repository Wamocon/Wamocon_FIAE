// Titles of the 13 learning fields (phase 4.5). The mapping table has no titles.
// The only evidence in the project files is the chapter list of the source list
// (Enabler_Quellen.csv), which names each learning field in the form
//   (1. AJ), LF3 ""Short title"": Kap. 6 ...
// of the textbook. These are short book headings, not necessarily the wording of
// the framework curriculum, so the plan marks them as provisional. The owner can
// hand over the official titles as a JSON file instead.
//
// Pure functions: the caller reads the file and passes the text.

import { LEARNING_FIELD_COUNT } from './model';
import type { SchoolYear } from './model';
import { cleanCell } from './refs';

export interface TitleSet {
  /** Title by learning field number. */
  titles: Record<number, string>;
  /** School year by learning field number (only the source list names it). */
  years: Record<number, SchoolYear>;
  source: 'csv' | 'json';
  warnings: string[];
}

export const MAX_TITLE_LENGTH = 200;

/** Title text: no control characters, single spaces, trimmed. */
export function cleanTitle(text: string | null | undefined): string {
  return cleanCell(text);
}

const CHAPTER_ENTRY =
  /(?:\((\d)\. AJ\),\s*)?LF\s?(\d{1,3})\s+""([^"\r\n]{1,200})""/g;

/** Most frequent value; a tie goes to the value that sorts first. */
function mostFrequent<T extends string | number>(
  values: T[]
): { value: T; variants: number } {
  const counts = new Map<T, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  const ordered = [...counts.entries()].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0)
  );
  return { value: ordered[0][0], variants: ordered.length };
}

/** Titles and school years from the chapter list column of the source list. */
export function titlesFromSourceCsv(text: string): TitleSet {
  const found = new Map<number, { titles: string[]; years: number[] }>();
  const outside: number[] = [];
  CHAPTER_ENTRY.lastIndex = 0;
  let match: RegExpExecArray | null;
  while ((match = CHAPTER_ENTRY.exec(text))) {
    const number = Number(match[2]);
    if (number < 1 || number > LEARNING_FIELD_COUNT) {
      if (!outside.includes(number)) outside.push(number);
      continue;
    }
    const title = cleanTitle(match[3]);
    if (title === '') continue;
    const entry = found.get(number) ?? { titles: [], years: [] };
    entry.titles.push(title);
    if (match[1]) entry.years.push(Number(match[1]));
    found.set(number, entry);
  }
  const titles: Record<number, string> = {};
  const years: Record<number, SchoolYear> = {};
  const warnings: string[] = [];
  for (const number of [...found.keys()].sort((a, b) => a - b)) {
    const entry = found.get(number) as { titles: string[]; years: number[] };
    const title = mostFrequent(entry.titles);
    titles[number] = title.value;
    if (title.variants > 1) {
      warnings.push(
        `LF${number}: ${title.variants} different titles in the source list, the most frequent one is used.`
      );
    }
    if (entry.years.length > 0) {
      const year = mostFrequent(entry.years);
      if (year.value >= 1 && year.value <= 3) {
        years[number] = year.value as SchoolYear;
      }
      if (year.variants > 1) {
        warnings.push(
          `LF${number}: ${year.variants} different school years in the source list, the most frequent one is reported.`
        );
      }
    }
  }
  for (const number of outside) {
    warnings.push(
      `LF${number} is outside 1 to ${LEARNING_FIELD_COUNT} and is ignored.`
    );
  }
  return { titles, years, source: 'csv', warnings };
}

/** Titles from a JSON object {"LF1": "...", "2": "..."} handed over by the owner. */
export function titlesFromJson(
  text: string
): { ok: true; set: TitleSet } | { ok: false; errors: string[] } {
  let data: unknown;
  try {
    data = JSON.parse(text);
  } catch {
    return { ok: false, errors: ['The titles file is not valid JSON.'] };
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    return { ok: false, errors: ['The titles file must be a JSON object.'] };
  }
  const titles: Record<number, string> = {};
  const errors: string[] = [];
  for (const [key, value] of Object.entries(data)) {
    const match = /^(?:LF)?(\d{1,3})$/.exec(key);
    const number = match ? Number(match[1]) : NaN;
    if (!(number >= 1 && number <= LEARNING_FIELD_COUNT)) {
      errors.push(
        `The key ${key} is not a learning field of 1 to ${LEARNING_FIELD_COUNT}.`
      );
      continue;
    }
    const title = typeof value === 'string' ? cleanTitle(value) : '';
    if (title === '') {
      errors.push(`The title of LF${number} must be a non-empty text.`);
    } else if (title.length > MAX_TITLE_LENGTH) {
      errors.push(
        `The title of LF${number} is longer than ${MAX_TITLE_LENGTH} characters.`
      );
    } else {
      titles[number] = title;
    }
  }
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, set: { titles, years: {}, source: 'json', warnings: [] } };
}
