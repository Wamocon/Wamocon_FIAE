// The descriptions that the import writes, in the form that FIAE has for the
// same kind of content (docs/kfbm-import-runbook.md, "Beschreibungen im
// FIAE-Umfang"). Pure functions and constants, no file access, no database.
//
// FIAE (measured in the preview copy, characters):
//   enabler        about 265 (median 204, longest 956): intro line and topic list
//   use case       about 21 (longest 44): the title, the task is the PDF
//   course         about 65: one sentence with the title
//   learning field about 1263 (longest 2117): the text of the framework curriculum
// The teaching texts and tasks themselves are PDF documents of the enabler or the
// use case, not description text.

import { shortenText } from './short-text';

/**
 * The longest enabler description a plan may hold. FIAE's longest one has 956
 * characters, the rule of enabler-summary.ts stays under 600. A plan with a
 * longer text was built before the short form (the whole Word text) and is
 * refused, so an old plan file cannot write the long text again.
 */
export const MAX_ENABLER_DESCRIPTION = 1000;

/**
 * The longest use case description a plan may hold (the short title below stays
 * under USE_CASE_DESCRIPTION_MAX). A longer one is the whole assignment of a plan
 * that was built before the short form.
 */
export const MAX_USE_CASE_DESCRIPTION = 300;

/** A use case description is one short line (FIAE: 21 characters on average, 44 at most). */
export const USE_CASE_DESCRIPTION_MAX = 120;

/**
 * The description of a use case like the FIAE ones: the title, one line. The
 * assignment itself (situation, objective, steps) is the task PDF of the use
 * case (document type TRAINEE_QUESTION), not description text.
 */
export function describeUseCase(title: string): string {
  return shortenText(title, USE_CASE_DESCRIPTION_MAX);
}

/** The sentence that describes a component and its course, like the FIAE courses. */
export function componentDescription(component: {
  code: string;
  title: string;
  reference: string | null;
}): string {
  const reference = component.reference ? ` (${component.reference})` : '';
  return `Komponente ${component.code}: ${component.title}${reference}`;
}

export interface LengthStats {
  count: number;
  min: number;
  median: number;
  mean: number;
  max: number;
}

/** Count, minimum, median, mean and maximum of a list of lengths, null if empty. */
export function lengthStats(lengths: readonly number[]): LengthStats | null {
  if (lengths.length === 0) return null;
  const sorted = [...lengths].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  const median =
    sorted.length % 2 === 1
      ? sorted[middle]
      : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
  const sum = sorted.reduce((a, b) => a + b, 0);
  return {
    count: sorted.length,
    min: sorted[0],
    median,
    mean: Math.round(sum / sorted.length),
    max: sorted[sorted.length - 1],
  };
}

// ---------------------------------------------------------------------------
// Length of descriptions before and after a run (numbers only)
// ---------------------------------------------------------------------------

/** The columns whose length a run reports (the text itself is never reported). */
const LENGTH_COLUMNS = ['description_text', 'description'];

const textLength = (value: unknown) =>
  typeof value === 'string' ? value.length : 0;

/**
 * Lengths before (existing row) and after (desired values) of the description
 * columns among `columns`, or undefined if none of them is a description.
 */
export function lengthChangesOf(
  columns: readonly string[],
  existing: Record<string, unknown>,
  desired: Record<string, unknown>
): Record<string, { before: number; after: number }> | undefined {
  const out: Record<string, { before: number; after: number }> = {};
  for (const column of columns) {
    if (!LENGTH_COLUMNS.includes(column)) continue;
    out[column] = {
      before: textLength(existing[column]),
      after: textLength(desired[column]),
    };
  }
  return Object.keys(out).length > 0 ? out : undefined;
}

interface DifferenceLike {
  table: string;
  key: string;
  columns: string[];
  lengths?: Record<string, { before: number; after: number }>;
}

const LIST_LIMIT = 200;

/**
 * The part of a run report (German Markdown lines) that names how many rows get
 * another description and how long it was before and after, per table and
 * column and per row. Empty when no description differs. Numbers only.
 * `applied` tells whether the run replaced the texts (--update-existing) or
 * only found them.
 */
export function renderLengthChanges(
  differences: readonly DifferenceLike[],
  applied: boolean
): string[] {
  const rows: Array<{
    table: string;
    key: string;
    column: string;
    before: number;
    after: number;
  }> = [];
  for (const d of differences) {
    for (const [column, change] of Object.entries(d.lengths ?? {})) {
      rows.push({ table: d.table, key: d.key, column, ...change });
    }
  }
  if (rows.length === 0) return [];
  const out: string[] = [];
  out.push('## Beschreibungen: Länge vorher und nachher');
  out.push('');
  out.push(
    applied
      ? 'Mit --update-existing ersetzt. Die Zahlen sind Zeichen, die Texte stehen nicht im Bericht.'
      : 'Nicht geändert (dafür gibt es --update-existing). Die Zahlen sind Zeichen, die Texte stehen nicht im Bericht.'
  );
  out.push('');
  out.push(
    '| Tabelle | Spalte | Zeilen | Mittel vorher | Mittel nachher | größte vorher | größte nachher |'
  );
  out.push('|---|---|---|---|---|---|---|');
  const groups = new Map<string, typeof rows>();
  for (const row of rows) {
    const id = `${row.table}\u0000${row.column}`;
    groups.set(id, [...(groups.get(id) ?? []), row]);
  }
  for (const group of groups.values()) {
    const before = lengthStats(group.map(r => r.before)) as LengthStats;
    const after = lengthStats(group.map(r => r.after)) as LengthStats;
    out.push(
      `| ${group[0].table} | ${group[0].column} | ${group.length} | ${before.mean} | ${after.mean} | ${before.max} | ${after.max} |`
    );
  }
  out.push('');
  for (const row of rows.slice(0, LIST_LIMIT)) {
    out.push(
      `- ${row.table} ${row.key} ${row.column}: ${row.before} auf ${row.after} Zeichen`
    );
  }
  if (rows.length > LIST_LIMIT) {
    out.push(`- und ${rows.length - LIST_LIMIT} weitere`);
  }
  out.push('');
  return out;
}
