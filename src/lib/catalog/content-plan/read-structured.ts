import {
  columnIndex,
  type SheetRow,
} from '@/lib/content-import/learning-fields/xlsx-sheet';
import { readXlsx } from '@/lib/content-upload/read-xlsx';
import {
  EXAMPLE_PLAN,
  TABLE_TITLES,
} from '@/lib/catalog/content-plan/template';
import { RowCollector, rowsToPlan } from '@/lib/catalog/content-plan/rows';
import {
  COMPONENT_FIELDS,
  PLAN_LIMITS,
  RELATION_TYPES,
  TOTAL_FIELDS,
  type PlanDraft,
  type RelationType,
} from '@/lib/catalog/content-plan/types';

/**
 * The first stage of reading a plan document: the SCRIPT. Structured files
 * (xlsx, csv, json) are read after a fixed template (see template.ts), without
 * any AI. The Excel file goes through the safe reader of the content upload
 * (read-xlsx.ts: size, zip, macros, links), never through a parser of its own.
 *
 * The tables, by the name of the sheet (xlsx), by a line "# Komponenten" (csv)
 * or by their header (csv without sections):
 *   Gesamt        Kennzahl | Wert
 *   Komponenten   Code | Titel | Phase | Art | Stunden | Wochen | Enabler |
 *                 Szenarien | Use Cases | Quizze | Global-Quiz | Reihenfolge |
 *                 Lernfelder
 *   Lernfelder    Code | Titel | Stunden
 *   Beziehungen   Art | Von | Nach
 *   Hinweise      one note per row
 * Every part is optional, an empty cell is "not stated", a row whose first cell
 * starts with # is a comment. Whatever cannot be read becomes an issue with its
 * place and is left out, never turned into a zero.
 */

export type TableId =
  | 'totals'
  | 'components'
  | 'learningFields'
  | 'relations'
  | 'notes';

/** A table as rows of cell texts, with the row number the file shows. */
export type Grid = { row: number; cells: string[] }[];

/** Lower case, no accents, only letters and digits: "Use Cases" is "usecases". */
export function normalizeKey(text: string): string {
  return text
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]/g, '');
}

const TABLE_NAMES: Record<TableId, string[]> = {
  totals: ['gesamt', 'gesamtzahlen', 'kennzahlen', 'totals'],
  components: ['komponenten', 'components'],
  learningFields: ['lernfelder', 'learningfields'],
  relations: ['beziehungen', 'zuordnungen', 'relations'],
  notes: ['hinweise', 'notizen', 'notes'],
};

function tableOfName(name: string): TableId | null {
  const key = normalizeKey(
    name.replace(/^\s*(?:blatt|tabelle|sheet)\s*:/i, '')
  );
  for (const id of Object.keys(TABLE_NAMES) as TableId[]) {
    if (TABLE_NAMES[id].includes(key)) return id;
  }
  return null;
}

const TOTAL_ALIASES: Record<string, (typeof TOTAL_FIELDS)[number]> = {
  komponenten: 'components',
  anzahlkomponenten: 'components',
  enabler: 'enablers',
  anzahlenabler: 'enablers',
  szenarien: 'scenarios',
  anzahlszenarien: 'scenarios',
  usecases: 'useCases',
  anzahlusecases: 'useCases',
  lektionsquizze: 'lessonQuizzes',
  enablerquizze: 'lessonQuizzes',
  quizze: 'lessonQuizzes',
  globalquizze: 'globalQuizzes',
  lernfelder: 'learningFields',
  anzahllernfelder: 'learningFields',
  fragenjequiz: 'questionsPerQuiz',
  fragenproquiz: 'questionsPerQuiz',
  stundengesamt: 'hours',
  stunden: 'hours',
  gesamtstunden: 'hours',
};

const COMPONENT_ALIASES: Record<string, (typeof COMPONENT_FIELDS)[number]> = {
  code: 'code',
  kennung: 'code',
  komponentencode: 'code',
  kuerzel: 'code',
  titel: 'title',
  bezeichnung: 'title',
  name: 'title',
  komponentenname: 'title',
  phase: 'phase',
  ausbildungsphase: 'phase',
  art: 'kind',
  komponentenart: 'kind',
  stunden: 'hours',
  std: 'hours',
  zeitrichtwertstunden: 'hours',
  wochen: 'weeks',
  zeitrichtwertwochen: 'weeks',
  enabler: 'enablers',
  anzahlenabler: 'enablers',
  szenarien: 'scenarios',
  anzahlszenarien: 'scenarios',
  usecases: 'useCases',
  anzahlusecases: 'useCases',
  quizze: 'quizzes',
  lektionsquizze: 'quizzes',
  enablerquizze: 'quizzes',
  anzahlquizze: 'quizzes',
  globalquiz: 'globalQuiz',
  reihenfolge: 'order',
  position: 'order',
  nr: 'order',
  lernfelder: 'learningFields',
  lernfeld: 'learningFields',
  lf: 'learningFields',
};

const LEARNING_FIELD_ALIASES: Record<string, 'code' | 'title' | 'hours'> = {
  code: 'code',
  kennung: 'code',
  lernfeld: 'code',
  titel: 'title',
  bezeichnung: 'title',
  name: 'title',
  stunden: 'hours',
  std: 'hours',
  zeitrichtwert: 'hours',
  zeitrichtwertstunden: 'hours',
};

const RELATION_COLUMNS: Record<string, 'type' | 'from' | 'to'> = {
  art: 'type',
  typ: 'type',
  von: 'from',
  nach: 'to',
};

function relationType(raw: string): RelationType | null {
  const key = normalizeKey(raw);
  if (key.includes('usecase') && key.includes('enabler')) {
    return 'use_case_enabler';
  }
  if (key.includes('enabler') && key.includes('lernfeld')) {
    return 'enabler_learning_field';
  }
  if (key.includes('komponente') && key.includes('lernfeld')) {
    return 'component_learning_field';
  }
  return (RELATION_TYPES as readonly string[]).includes(raw.trim())
    ? (raw.trim() as RelationType)
    : null;
}

const isComment = (cells: string[]) => (cells[0] ?? '').trim().startsWith('#');
const isBlank = (cells: string[]) => cells.every(c => c.trim() === '');

/** The first row of a grid that names at least `min` known columns. */
function headerOf(
  grid: Grid,
  aliases: Record<string, string>,
  min: number
): { index: number; columns: Map<number, string> } | null {
  for (let i = 0; i < Math.min(grid.length, 10); i += 1) {
    const columns = new Map<number, string>();
    grid[i].cells.forEach((cell, at) => {
      const field = aliases[normalizeKey(cell)];
      if (field !== undefined && ![...columns.values()].includes(field)) {
        columns.set(at, field);
      }
    });
    if (columns.size >= min) return { index: i, columns };
  }
  return null;
}

/** Fills the collector from the tables. The place of a field is "<table>, row n". */
export function collectTables(
  tables: Partial<Record<TableId, Grid>>,
  collector: RowCollector,
  placeOf: (table: TableId, row: number) => string = (table, row) =>
    `${TABLE_TITLES[table]}, Zeile ${row}`
): void {
  const totals = tables.totals;
  if (totals) {
    for (const { row, cells } of totals) {
      if (isComment(cells) || isBlank(cells)) continue;
      const field = TOTAL_ALIASES[normalizeKey(cells[0] ?? '')];
      const value = cells[1] ?? '';
      if (field === undefined) {
        // the header row and the explanation lines are no values
        if (
          value.trim() !== '' &&
          normalizeKey(cells[0] ?? '') !== 'kennzahl'
        ) {
          collector.issue(placeOf('totals', row), 'unknown_field');
        }
        continue;
      }
      collector.add('totals', '', field, value, placeOf('totals', row));
    }
  }

  const components = tables.components;
  if (components) {
    const header = headerOf(components, COMPONENT_ALIASES, 2);
    if (!header) {
      collector.issue(TABLE_TITLES.components, 'no_header');
    } else {
      for (const { row, cells } of components.slice(header.index + 1)) {
        if (isComment(cells) || isBlank(cells)) continue;
        const get = (field: string) => {
          for (const [at, f] of header.columns) {
            if (f === field) return (cells[at] ?? '').trim();
          }
          return '';
        };
        const ref = get('code') || get('title');
        const where = placeOf('components', row);
        if (ref === '') {
          collector.issue(where, 'missing_name');
          continue;
        }
        for (const [at, field] of header.columns) {
          collector.add('component', ref, field, cells[at] ?? '', where);
        }
      }
    }
  }

  const learningFields = tables.learningFields;
  if (learningFields) {
    const header = headerOf(learningFields, LEARNING_FIELD_ALIASES, 2);
    if (!header) {
      collector.issue(TABLE_TITLES.learningFields, 'no_header');
    } else {
      for (const { row, cells } of learningFields.slice(header.index + 1)) {
        if (isComment(cells) || isBlank(cells)) continue;
        const get = (field: string) => {
          for (const [at, f] of header.columns) {
            if (f === field) return (cells[at] ?? '').trim();
          }
          return '';
        };
        const ref = get('code') || get('title');
        const where = placeOf('learningFields', row);
        if (ref === '') {
          collector.issue(where, 'missing_name');
          continue;
        }
        for (const [at, field] of header.columns) {
          collector.add('learningField', ref, field, cells[at] ?? '', where);
        }
      }
    }
  }

  const relations = tables.relations;
  if (relations) {
    const header = headerOf(relations, RELATION_COLUMNS, 3);
    if (!header) {
      collector.issue(TABLE_TITLES.relations, 'no_header');
    } else {
      const at = (name: string) =>
        [...header.columns].find(([, f]) => f === name)?.[0] ?? -1;
      for (const { row, cells } of relations.slice(header.index + 1)) {
        if (isComment(cells) || isBlank(cells)) continue;
        const where = placeOf('relations', row);
        const type = relationType(cells[at('type')] ?? '');
        if (type === null) {
          collector.issue(where, 'unknown_relation');
          continue;
        }
        collector.addRelation(
          type,
          cells[at('from')] ?? '',
          cells[at('to')] ?? '',
          where
        );
      }
    }
  }

  const notes = tables.notes;
  if (notes) {
    for (const { row, cells } of notes) {
      if (isComment(cells) || isBlank(cells)) continue;
      const first = normalizeKey(cells[0] ?? '');
      if (first === 'hinweis' || first === 'hinweise' || first === 'text') {
        continue;
      }
      collector.addNote(cells[0] ?? '', placeOf('notes', row));
    }
  }
}

// ---------------------------------------------------------------------------
// The formats
// ---------------------------------------------------------------------------

export type StructuredFailure =
  | 'NO_PLAN_TABLE'
  | 'NOT_JSON'
  | 'NOT_AN_OBJECT'
  | 'TOO_COMPLEX'
  | 'NOT_TEXT'
  | string;

export type StructuredResult =
  | { ok: true; draft: PlanDraft }
  | { ok: false; code: StructuredFailure };

/** JSON with sorted keys, so the order of columns does not matter. */
function canonical(value: unknown): string {
  return JSON.stringify(value, (_key, item) =>
    item !== null && typeof item === 'object' && !Array.isArray(item)
      ? Object.fromEntries(
          Object.entries(item).sort(([x], [y]) => (x < y ? -1 : 1))
        )
      : item
  );
}

/** Marks a proposal that is the unchanged template. */
function finish(collector: RowCollector): StructuredResult {
  const draft = collector.draft('script');
  if (canonical(rowsToPlan(draft.rows)) === canonical(EXAMPLE_PLAN)) {
    collector.warn('EXAMPLE_TEMPLATE');
  }
  return { ok: true, draft };
}

function gridOf(rows: SheetRow[]): Grid {
  return rows.map(({ row, cells }) => {
    const letters = Object.keys(cells);
    const width = letters.reduce((m, l) => Math.max(m, columnIndex(l)), 0);
    const out = new Array<string>(width).fill('');
    for (const letter of letters) out[columnIndex(letter) - 1] = cells[letter];
    return { row, cells: out };
  });
}

/** An Excel file: one call of the safe reader per table, found by sheet name. */
export async function readPlanXlsx(
  bytes: Uint8Array
): Promise<StructuredResult> {
  const tables: Partial<Record<TableId, Grid>> = {};
  for (const id of Object.keys(TABLE_NAMES) as TableId[]) {
    const result = await readXlsx(bytes, {
      limits: { maxSheetsRead: 12 },
      pick: (_rows, name) => tableOfName(name) === id,
    });
    if (result.status !== 'ok') {
      return { ok: false, code: result.code ?? 'XLSX_FAILED' };
    }
    if (result.picked) tables[id] = gridOf(result.rows);
  }
  if (Object.keys(tables).length === 0) {
    return { ok: false, code: 'NO_PLAN_TABLE' };
  }
  const collector = new RowCollector(false);
  collectTables(
    tables,
    collector,
    (table, row) => `Blatt ${TABLE_TITLES[table]}, Zeile ${row}`
  );
  return finish(collector);
}

/** Rows of a delimited text, quotes and doubled quotes handled. */
export function parseDelimited(text: string, delimiter: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === delimiter) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else cell += ch;
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function delimiterOf(text: string): string {
  const line =
    text.split(/\r?\n/).find(l => l.trim() !== '' && !l.startsWith('#')) ?? '';
  const counts: [string, number][] = [';', ',', '\t'].map(d => [
    d,
    line.split(d).length - 1,
  ]);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ';';
}

/** A table of a csv without sections, recognised by its header. */
function tableOfHeader(cells: string[]): TableId | null {
  const keys = cells.map(normalizeKey);
  if (keys[0] === 'kennzahl') return 'totals';
  if (keys.includes('von') && keys.includes('nach')) return 'relations';
  const hasName = keys.includes('code') || keys.includes('titel');
  if (!hasName) return null;
  const componentOnly = keys.some(k =>
    [
      'phase',
      'art',
      'enabler',
      'szenarien',
      'usecases',
      'quizze',
      'wochen',
    ].includes(k)
  );
  return componentOnly ? 'components' : 'learningFields';
}

/** A csv file. Sections "# Komponenten", or one table recognised by its header. */
export function readPlanCsv(bytes: Uint8Array): StructuredResult {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return { ok: false, code: 'NOT_TEXT' };
  }
  text = text.replace(/^﻿/, '');
  const rows = parseDelimited(text, delimiterOf(text));
  if (rows.length > 20_000) return { ok: false, code: 'TOO_COMPLEX' };
  const tables: Partial<Record<TableId, Grid>> = {};
  let current: TableId | null = null;
  let sawSection = false;
  rows.forEach((cells, index) => {
    const first = (cells[0] ?? '').trim();
    if (first.startsWith('#')) {
      const section = tableOfName(first.slice(1));
      if (section) {
        current = section;
        sawSection = true;
        tables[section] ??= [];
      }
      return;
    }
    if (isBlank(cells)) return;
    if (current === null && !sawSection) {
      const detected = tableOfHeader(cells);
      if (detected) {
        current = detected;
        tables[detected] ??= [];
      }
    }
    if (current !== null) tables[current]?.push({ row: index + 1, cells });
  });
  if (Object.keys(tables).length === 0) {
    return { ok: false, code: 'NO_PLAN_TABLE' };
  }
  const collector = new RowCollector(true);
  collectTables(tables, collector, (_table, row) => `Zeile ${row}`);
  return finish(collector);
}

/** A JSON file in the form of the plan model; keys starting with _ are explanations. */
export function readPlanJson(bytes: Uint8Array): StructuredResult {
  let raw: unknown;
  try {
    raw = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
  } catch {
    return { ok: false, code: 'NOT_JSON' };
  }
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, code: 'NOT_AN_OBJECT' };
  }
  const root = raw as Record<string, unknown>;
  const collector = new RowCollector(false);
  const obj = (value: unknown): Record<string, unknown> | null =>
    value !== null && typeof value === 'object' && !Array.isArray(value)
      ? (value as Record<string, unknown>)
      : null;
  const list = (value: unknown, where: string): unknown[] => {
    if (value === undefined) return [];
    if (!Array.isArray(value)) {
      collector.issue(where, 'invalid_value');
      return [];
    }
    if (value.length > PLAN_LIMITS.maxRows) {
      collector.issue(where, 'too_many_entries');
      return value.slice(0, PLAN_LIMITS.maxRows);
    }
    return value;
  };

  for (const key of Object.keys(root)) {
    if (
      key.startsWith('_') ||
      ['totals', 'components', 'learningFields', 'relations', 'notes'].includes(
        key
      )
    ) {
      continue;
    }
    collector.issue(`JSON ${key}`, 'unknown_field');
  }

  const totals = obj(root.totals);
  if (root.totals !== undefined && !totals) {
    collector.issue('JSON totals', 'invalid_value');
  }
  for (const [field, value] of Object.entries(totals ?? {})) {
    collector.add('totals', '', field, value, `JSON totals.${field}`);
  }

  const nested = (
    key: 'components' | 'learningFields',
    scope: 'component' | 'learningField'
  ) => {
    list(root[key], `JSON ${key}`).forEach((item, index) => {
      const entry = obj(item);
      const where = `JSON ${key}[${index}]`;
      if (!entry) {
        collector.issue(where, 'invalid_value');
        return;
      }
      const code = typeof entry.code === 'string' ? entry.code.trim() : '';
      const title = typeof entry.title === 'string' ? entry.title.trim() : '';
      const ref = code || title;
      if (ref === '') {
        collector.issue(where, 'missing_name');
        return;
      }
      for (const [field, value] of Object.entries(entry)) {
        collector.add(scope, ref, field, value, `${where}.${field}`);
      }
    });
  };
  nested('components', 'component');
  nested('learningFields', 'learningField');

  list(root.relations, 'JSON relations').forEach((item, index) => {
    const entry = obj(item);
    const where = `JSON relations[${index}]`;
    const type =
      entry && typeof entry.type === 'string' ? relationType(entry.type) : null;
    if (
      !entry ||
      type === null ||
      typeof entry.from !== 'string' ||
      typeof entry.to !== 'string'
    ) {
      collector.issue(where, 'unknown_relation');
      return;
    }
    collector.addRelation(type, entry.from, entry.to, where);
  });

  list(root.notes, 'JSON notes').forEach((item, index) => {
    const where = `JSON notes[${index}]`;
    if (typeof item !== 'string') collector.issue(where, 'invalid_value');
    else collector.addNote(item, where);
  });

  if (collector.rows.length === 0 && collector.issues.length === 0) {
    return { ok: false, code: 'NO_PLAN_TABLE' };
  }
  return finish(collector);
}
