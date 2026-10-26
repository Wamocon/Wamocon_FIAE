// The plan of the learning field import (phase 4.5): the 13 learning fields of
// the KfBM and the assignment of the enablers of the content import to them,
// built from the parsed mapping table and the codes of the import. Pure
// functions: no file access, no database.
//
// Nothing is guessed. A row that cannot be assigned to exactly one enabler of
// the import, a number outside 1 to 13, a number in the column of another school
// year and a cell of an unknown form are listed as skipped with the reason and
// the row number, they never become a mapping.
//
// The plan holds codes, numbers and row numbers only, no text of the table, so
// the plan file and its summary may be shared like the other reports.

import {
  LEARNING_FIELD_COUNT,
  learningFieldCode,
  learningFieldNumber,
  learningFieldYear,
  learningFieldsOfYear,
} from './model';
import type { SchoolYear } from './model';
import type { ParsedMappingSheet, SheetPosition } from './mapping-sheet';
import type { TitleSet } from './titles';
import { MAX_TITLE_LENGTH } from './titles';
import type {
  ImportIndex,
  LearningFieldPlan,
  LearningFieldStats,
  OpenPoint,
  PlanLearningField,
  PlanMapping,
  PlanNote,
  PlanSkip,
  SkipCode,
  YearColumn,
} from './types';

const YEARS: ReadonlyArray<{ year: SchoolYear; column: YearColumn }> = [
  { year: 1, column: 'C' },
  { year: 2, column: 'D' },
  { year: 3, column: 'E' },
];

const SKIP_CODES: readonly SkipCode[] = [
  'BLOCK_UNKNOWN',
  'SECTION_MISMATCH',
  'NUMBER_MISMATCH',
  'NUMBER_OUT_OF_RANGE',
  'COMPONENT_EXCLUDED',
  'COMPONENT_NOT_IN_IMPORT',
  'REFERENCE_MISMATCH',
  'NO_LETTER',
  'DUPLICATE_LETTER',
  'ENABLER_NOT_IN_IMPORT',
  'ENABLER_AMBIGUOUS',
  'ORPHAN_REFERENCE',
  'UNPARSEABLE_REFERENCE',
  'LF_OUT_OF_RANGE',
  'YEAR_MISMATCH',
  'ENABLER_NOT_IN_DATABASE',
];

/** The reasons in German, for the summary. */
export const SKIP_CODE_TEXT: Record<SkipCode, string> = {
  BLOCK_UNKNOWN: 'Zeile gehört zu keiner erkennbaren Komponente',
  SECTION_MISMATCH: 'Paragraf der Komponente passt nicht zum Abschnitt',
  NUMBER_MISMATCH: 'Nummer und Paragraf der Komponente widersprechen sich',
  NUMBER_OUT_OF_RANGE: 'Nummer der Komponente außerhalb des Abschnitts',
  COMPONENT_EXCLUDED: 'Komponente ist bewusst nicht Teil des Imports',
  COMPONENT_NOT_IN_IMPORT: 'Komponente hat kein Gegenstück im Import',
  REFERENCE_MISMATCH: 'Paragraf weicht von dem der Importkomponente ab',
  NO_LETTER: 'Zeile ohne Buchstaben',
  DUPLICATE_LETTER: 'Buchstabe kommt in der Komponente mehrfach vor',
  ENABLER_NOT_IN_IMPORT: 'Kein Enabler mit diesem Buchstaben im Import',
  ENABLER_AMBIGUOUS: 'Buchstabe passt zu mehreren Importkomponenten',
  ORPHAN_REFERENCE: 'Lernfeldangabe ohne Zeilentext',
  UNPARSEABLE_REFERENCE: 'Lernfeldangabe nicht lesbar',
  LF_OUT_OF_RANGE: 'Lernfeld außerhalb von 1 bis 13',
  YEAR_MISMATCH: 'Lernfeld gehört nicht zum Schuljahr der Spalte',
  ENABLER_NOT_IN_DATABASE: 'Enabler fehlt in der Zieldatenbank',
};

const BLOCK_REASON: Record<string, string> = {
  BLOCK_UNKNOWN: 'The component block has neither a number nor a paragraph.',
  SECTION_MISMATCH:
    'The paragraph of the component does not fit the section it stands in.',
  NUMBER_MISMATCH: 'The number of the component and its paragraph differ.',
  NUMBER_OUT_OF_RANGE:
    'The number of the component is outside the numbers of its section.',
};

export interface BuildOptions {
  now?: Date;
  /** Titles from the source list or from the owner. Without them: placeholders. */
  titles?: TitleSet | null;
  /** Name of the sheet that was read (only for the record). */
  sheetName?: string;
}

const COMPONENT_CODE = /^K(\d{1,2})(?:\.(\d))?$/;

function learningFieldList(titles: TitleSet | null | undefined) {
  const fields: PlanLearningField[] = [];
  const warnings: string[] = [...(titles?.warnings ?? [])];
  for (let number = 1; number <= LEARNING_FIELD_COUNT; number += 1) {
    const title = titles?.titles[number];
    const source = title ? titles?.source : undefined;
    fields.push({
      code: learningFieldCode(number),
      number,
      title: title ?? `Lernfeld ${number}`,
      titleSource: source ?? 'placeholder',
      titleProvisional: source !== 'json',
      trainingYear: learningFieldYear(number) as SchoolYear,
      hoursBudget: null,
      orderIndex: number,
    });
    const named = titles?.years[number];
    const year = learningFieldYear(number);
    if (named !== undefined && named !== year) {
      warnings.push(
        `LF${number}: the source list names school year ${named}, the assignment is school year ${year}.`
      );
    }
  }
  return { fields, warnings };
}

/** Number of mappings a position would give if its cells were all readable. */
function potentialPairs(position: SheetPosition): number {
  let pairs = 0;
  for (const { year } of YEARS) {
    const refs = position.years[year];
    if (refs.kind === 'numbers') pairs += refs.numbers.length;
    else if (refs.kind === 'all') pairs += learningFieldsOfYear(year).length;
  }
  return pairs;
}

const columnRank = (column: YearColumn | null) =>
  column === null ? 0 : column === 'C' ? 1 : column === 'D' ? 2 : 3;

/**
 * The learning fields and the mappings from the parsed table. `index` names the
 * components and enablers of the content import the mappings may point at.
 */
export function buildLearningFieldPlan(
  sheet: ParsedMappingSheet,
  index: ImportIndex,
  options: BuildOptions = {}
): LearningFieldPlan {
  const { fields, warnings } = learningFieldList(options.titles);

  const componentsByNumber = new Map<
    number,
    Array<{ code: string; reference: string | null }>
  >();
  for (const component of index.components) {
    const match = COMPONENT_CODE.exec(component.code);
    if (!match) continue;
    const number = Number(match[1]);
    componentsByNumber.set(number, [
      ...(componentsByNumber.get(number) ?? []),
      component,
    ]);
  }
  const enablers = new Set(index.enablers);
  const excluded = new Set(index.excludedNumbers);

  // letters that appear more than once in a block are ambiguous
  const letterRows = new Map<string, number>();
  for (const position of sheet.positions) {
    if (position.blockIndex === null || position.letter === null) continue;
    const key = `${position.blockIndex}:${position.letter}`;
    letterRows.set(key, (letterRows.get(key) ?? 0) + 1);
  }

  const mappings: PlanMapping[] = [];
  const skipped: PlanSkip[] = [];
  const notes: PlanNote[] = [];
  const mapped = new Set<string>();
  const status = { mapped: 0, companyOnly: 0, noReference: 0, skipped: 0 };

  const rowSkip = (
    position: SheetPosition,
    code: SkipCode,
    reason: string,
    componentCode: string | null
  ) => {
    skipped.push({
      row: position.row,
      column: null,
      code,
      enablerCode: null,
      componentCode,
      learningField: null,
      pairs: potentialPairs(position),
      reason,
    });
    status.skipped += 1;
  };

  for (const position of sheet.positions) {
    if (position.blockIndex === null) {
      rowSkip(
        position,
        'BLOCK_UNKNOWN',
        'The position lies outside any component block.',
        null
      );
      continue;
    }
    const block = sheet.blocks[position.blockIndex];
    if (block.issues.length > 0 || block.componentNumber === null) {
      const code = (block.issues[0] ?? 'BLOCK_UNKNOWN') as SkipCode;
      rowSkip(position, code, BLOCK_REASON[code], null);
      continue;
    }
    const number = block.componentNumber;
    if (excluded.has(number)) {
      rowSkip(
        position,
        'COMPONENT_EXCLUDED',
        'The component is not part of the import (excluded on purpose).',
        `K${number}`
      );
      continue;
    }
    const candidates = componentsByNumber.get(number) ?? [];
    if (candidates.length === 0) {
      rowSkip(
        position,
        'COMPONENT_NOT_IN_IMPORT',
        `The import has no component K${number}.`,
        null
      );
      continue;
    }
    const single = candidates.length === 1 ? candidates[0].code : null;
    if (
      block.reference &&
      candidates.some(c => c.reference && c.reference !== block.reference)
    ) {
      rowSkip(
        position,
        'REFERENCE_MISMATCH',
        'The paragraph of the component differs from the paragraph of the import component.',
        single
      );
      continue;
    }
    const letter = position.letter;
    if (letter === null) {
      rowSkip(position, 'NO_LETTER', 'The position has no letter.', single);
      continue;
    }
    if ((letterRows.get(`${position.blockIndex}:${letter}`) ?? 0) > 1) {
      rowSkip(
        position,
        'DUPLICATE_LETTER',
        `The letter ${letter} is used more than once in the component block.`,
        single
      );
      continue;
    }
    const matches = candidates.filter(c => enablers.has(`${c.code}-${letter}`));
    if (matches.length === 0) {
      rowSkip(
        position,
        'ENABLER_NOT_IN_IMPORT',
        `The import has no enabler for this position (letter ${letter} of ${single ?? `K${number}`}).`,
        single
      );
      continue;
    }
    if (matches.length > 1) {
      rowSkip(
        position,
        'ENABLER_AMBIGUOUS',
        `The letter ${letter} fits an enabler of more than one component of K${number}.`,
        null
      );
      continue;
    }
    const componentCode = matches[0].code;
    const enablerCode = `${componentCode}-${letter}`;

    // the cells of the three school years
    const before = { mappings: mappings.length, skips: skipped.length };
    let empty = 0;
    const cellSkip = (
      column: YearColumn,
      code: SkipCode,
      reason: string,
      learningField: string | null,
      pairs: number
    ) =>
      skipped.push({
        row: position.row,
        column,
        code,
        enablerCode,
        componentCode,
        learningField,
        pairs,
        reason,
      });
    const addMapping = (
      learningFieldNumberValue: number,
      year: SchoolYear,
      column: YearColumn
    ) => {
      const code = learningFieldCode(learningFieldNumberValue);
      const key = `${enablerCode}|${code}`;
      if (mapped.has(key)) return;
      mapped.add(key);
      mappings.push({
        enablerCode,
        componentCode,
        learningFieldCode: code,
        schoolYear: year,
        row: position.row,
        column,
      });
    };
    for (const { year, column } of YEARS) {
      const refs = position.years[year];
      if (refs.kind === 'empty') {
        empty += 1;
      } else if (refs.kind === 'company-only') {
        // taught in the company only: no learning field on purpose
      } else if (refs.kind === 'unparseable') {
        cellSkip(
          column,
          'UNPARSEABLE_REFERENCE',
          'The learning field cell is not in a known form.',
          null,
          0
        );
      } else if (refs.kind === 'all') {
        for (const n of learningFieldsOfYear(year)) addMapping(n, year, column);
      } else {
        for (const n of refs.numbers) {
          if (learningFieldYear(n) !== year) {
            cellSkip(
              column,
              'YEAR_MISMATCH',
              `The learning field ${learningFieldCode(n)} does not belong to school year ${year}.`,
              learningFieldCode(n),
              1
            );
          } else {
            addMapping(n, year, column);
          }
        }
        for (const n of refs.invalid) {
          cellSkip(
            column,
            'LF_OUT_OF_RANGE',
            `The learning field number ${n} is outside 1 to ${LEARNING_FIELD_COUNT}.`,
            `LF${n}`,
            0
          );
        }
      }
    }
    const gotMappings = mappings.length > before.mappings;
    const gotSkips = skipped.length > before.skips;
    if (gotMappings) {
      status.mapped += 1;
    } else if (gotSkips) {
      status.skipped += 1;
    } else if (empty === YEARS.length) {
      status.noReference += 1;
      notes.push({
        row: position.row,
        code: 'NO_REFERENCE',
        enablerCode,
        componentCode,
      });
    } else {
      status.companyOnly += 1;
      notes.push({
        row: position.row,
        code: 'COMPANY_ONLY',
        enablerCode,
        componentCode,
      });
    }
  }

  for (const row of sheet.orphanRows) {
    skipped.push({
      row,
      column: null,
      code: 'ORPHAN_REFERENCE',
      enablerCode: null,
      componentCode: null,
      learningField: null,
      pairs: 0,
      reason: 'The row has learning field cells but no position text.',
    });
  }
  skipped.sort(
    (a, b) => a.row - b.row || columnRank(a.column) - columnRank(b.column)
  );

  const skippedByCode: Record<string, number> = {};
  for (const skip of skipped) {
    skippedByCode[skip.code] = (skippedByCode[skip.code] ?? 0) + 1;
  }
  const notesByCode: Record<string, number> = {};
  for (const note of notes) {
    notesByCode[note.code] = (notesByCode[note.code] ?? 0) + 1;
  }
  const bySchoolYear: Record<SchoolYear, number> = { 1: 0, 2: 0, 3: 0 };
  const byLearningField: Record<string, number> = {};
  for (const mapping of mappings) {
    bySchoolYear[mapping.schoolYear] += 1;
    byLearningField[mapping.learningFieldCode] =
      (byLearningField[mapping.learningFieldCode] ?? 0) + 1;
  }
  const stats: LearningFieldStats = {
    sheet: {
      headerRow: sheet.headerRow,
      firstDataRow: sheet.firstRow,
      lastRow: sheet.lastRow,
      sectionRows: sheet.sectionRows.length,
      blankRows: sheet.blankRows,
    },
    blocks: sheet.blocks.length,
    positions: sheet.positions.length,
    positionStatus: status,
    enablersMapped: new Set(mappings.map(m => m.enablerCode)).size,
    componentsMapped: new Set(mappings.map(m => m.componentCode)).size,
    mappings: mappings.length,
    mappingsBySchoolYear: bySchoolYear,
    mappingsByLearningField: byLearningField,
    skippedByCode,
    pairsSkipped: skipped.reduce((sum, s) => sum + s.pairs, 0),
    notesByCode,
    learningFields: {
      total: fields.length,
      withProvisionalTitle: fields.filter(
        f => f.titleSource !== 'placeholder' && f.titleProvisional
      ).length,
      withPlaceholderTitle: fields.filter(f => f.titleSource === 'placeholder')
        .length,
      withHours: fields.filter(f => f.hoursBudget !== null).length,
    },
  };

  const open: OpenPoint[] = ['HOURS_BUDGET'];
  if (fields.some(f => f.titleProvisional)) open.push('TITLES_PROVISIONAL');
  if (
    sheet.positions.some(p =>
      YEARS.some(({ year }) => p.years[year].kind === 'all')
    )
  ) {
    open.push('ALL_LEARNING_FIELDS');
  }
  open.push('USE_CASES');
  if (notes.some(n => n.code === 'COMPANY_ONLY')) {
    open.push('COMPANY_ONLY');
  }

  return {
    version: 1,
    catalog: 'KFBM',
    generatedAt: (options.now ?? new Date()).toISOString(),
    source: {
      sheet: options.sheetName ?? '',
      headerRow: sheet.headerRow,
      firstDataRow: sheet.firstRow,
      lastRow: sheet.lastRow,
    },
    learningFields: fields,
    mappings,
    skipped,
    notes,
    stats,
    open,
    warnings,
  };
}

const ENABLER_CODE = /^K\d{1,2}(?:\.\d)?-[a-z]$/;

/** Problems of a plan (empty list = valid). Also checks a plan that was read from a file. */
export function validateLearningFieldPlan(plan: unknown): string[] {
  if (typeof plan !== 'object' || plan === null) {
    return ['The plan is not an object.'];
  }
  const p = plan as Partial<LearningFieldPlan>;
  const problems: string[] = [];
  if (p.version !== 1) problems.push('The plan version must be 1.');
  if (p.catalog !== 'KFBM') problems.push('The plan catalog must be KFBM.');
  if (
    !Array.isArray(p.learningFields) ||
    !Array.isArray(p.mappings) ||
    !Array.isArray(p.skipped)
  ) {
    problems.push(
      'The plan needs the lists learningFields, mappings and skipped.'
    );
    return problems;
  }
  if (p.learningFields.length !== LEARNING_FIELD_COUNT) {
    problems.push(
      `The plan must list the ${LEARNING_FIELD_COUNT} learning fields.`
    );
  }
  const known = new Map<string, SchoolYear>();
  for (const field of p.learningFields) {
    const number = learningFieldNumber(String(field?.code));
    if (number === null || learningFieldCode(number) !== String(field?.code)) {
      problems.push(
        `The learning field code ${String(field?.code)} is not LF1 to LF${LEARNING_FIELD_COUNT}.`
      );
      continue;
    }
    if (known.has(field.code)) {
      problems.push(`The learning field code ${field.code} is listed twice.`);
      continue;
    }
    const year = learningFieldYear(number) as SchoolYear;
    known.set(field.code, year);
    if (field.trainingYear !== year) {
      problems.push(`${field.code}: the school year must be ${year}.`);
    }
    if (field.orderIndex !== number) {
      problems.push(`${field.code}: the order must be ${number}.`);
    }
    if (
      typeof field.title !== 'string' ||
      field.title.trim() === '' ||
      field.title.length > MAX_TITLE_LENGTH
    ) {
      problems.push(
        `${field.code}: the title must be a text of 1 to ${MAX_TITLE_LENGTH} characters.`
      );
    }
    if (!['csv', 'json', 'placeholder'].includes(field.titleSource)) {
      problems.push(`${field.code}: the title source is not known.`);
    }
    if (
      field.hoursBudget !== null &&
      !(Number.isInteger(field.hoursBudget) && field.hoursBudget >= 0)
    ) {
      problems.push(
        `${field.code}: the hours must be empty or a whole number of 0 or more.`
      );
    }
  }
  const seen = new Set<string>();
  p.mappings.forEach((mapping, i) => {
    const n = i + 1;
    if (!ENABLER_CODE.test(String(mapping?.enablerCode))) {
      problems.push(
        `Mapping ${n}: the enabler code ${String(mapping?.enablerCode)} is not a code like K6.2-d.`
      );
    }
    const year = known.get(String(mapping?.learningFieldCode));
    if (year === undefined) {
      problems.push(
        `Mapping ${n}: the learning field ${String(mapping?.learningFieldCode)} is not in the plan.`
      );
    } else if (mapping.schoolYear !== year) {
      problems.push(
        `Mapping ${n}: the school year ${String(mapping.schoolYear)} does not fit ${mapping.learningFieldCode}.`
      );
    }
    if (!/^K\d{1,2}(?:\.\d)?$/.test(String(mapping?.componentCode))) {
      problems.push(
        `Mapping ${n}: the component code ${String(mapping?.componentCode)} is not a code like K6.2.`
      );
    }
    if (!Number.isInteger(mapping?.row)) {
      problems.push(`Mapping ${n}: the row must be a whole number.`);
    }
    const key = `${mapping?.enablerCode}|${mapping?.learningFieldCode}`;
    if (seen.has(key)) {
      problems.push(
        `Mapping ${n}: ${mapping.enablerCode} and ${mapping.learningFieldCode} are listed twice.`
      );
    }
    seen.add(key);
  });
  p.skipped.forEach((skip, i) => {
    if (!SKIP_CODES.includes(skip?.code as SkipCode)) {
      problems.push(
        `Skip ${i + 1}: the code ${String(skip?.code)} is not known.`
      );
    }
    if (!Number.isInteger(skip?.row)) {
      problems.push(`Skip ${i + 1}: the row must be a whole number.`);
    }
    for (const field of ['enablerCode', 'componentCode', 'learningField']) {
      const value = (skip as unknown as Record<string, unknown>)?.[field];
      if (value !== null && !/^[A-Za-z0-9.\-]{1,16}$/.test(String(value))) {
        problems.push(`Skip ${i + 1}: ${field} is not a code.`);
      }
    }
  });
  return problems;
}

const OPEN_TEXT: Record<OpenPoint, string> = {
  HOURS_BUDGET:
    'Stunden je Lernfeld: Keine Quelle in den Dateien, die Spalte bleibt leer.',
  TITLES_PROVISIONAL:
    'Titel der Lernfelder sind vorläufig (Platzhalter oder Kurztitel aus der Quellenliste), die offiziellen Titel nennt der Eigentümer in einer Titeldatei.',
  ALL_LEARNING_FIELDS:
    '"alle Lernfelder" wird als alle Lernfelder des Schuljahrs der Spalte gelesen.',
  USE_CASES:
    'Zuordnungen gibt es nur zu Enablern. Das Modell erlaubt auch Use Cases, die folgen mit deren Import.',
  COMPANY_ONLY:
    'Positionen mit "nur betrieblich" oder "nur betr./beh." haben bewusst kein Lernfeld.',
};

const TITLE_SOURCE_TEXT = {
  placeholder: 'Platzhalter (vorläufig)',
  csv: 'Quellenliste (vorläufig)',
  json: 'Titeldatei des Eigentümers',
} as const;

/**
 * Summary of a plan in Markdown (German): numbers, codes and row numbers, no
 * text of the table.
 */
export function renderLearningFieldSummary(
  plan: LearningFieldPlan,
  options: { maxSkips?: number } = {}
): string {
  const maxSkips = options.maxSkips ?? 300;
  const s = plan.stats;
  const out: string[] = [];
  out.push('# Plan der Lernfelder und Zuordnungen');
  out.push('');
  out.push(`Katalog: ${plan.catalog}. Stand: ${plan.generatedAt}.`);
  out.push(
    'Die Zusammenfassung nennt Zahlen, Codes und Zeilennummern, keine Inhalte der Tabelle.'
  );
  out.push('');
  out.push('## Zahlen');
  out.push('');
  out.push('| Größe | Anzahl |');
  out.push('|---|---|');
  const row = (label: string, value: number | string) =>
    out.push(`| ${label} | ${value} |`);
  row('Zeilen unter der Kopfzeile', s.sheet.lastRow - s.sheet.headerRow);
  row('Abschnittszeilen', s.sheet.sectionRows);
  row('Leerzeilen', s.sheet.blankRows);
  row('Komponenten der Tabelle', s.blocks);
  row('Positionen (Enabler)', s.positions);
  row('Positionen mit Zuordnung', s.positionStatus.mapped);
  row('Positionen nur betrieblich', s.positionStatus.companyOnly);
  row('Positionen ohne Lernfeldangabe', s.positionStatus.noReference);
  row('Positionen übersprungen', s.positionStatus.skipped);
  row('Zuordnungen (Enabler zu Lernfeld)', s.mappings);
  row('Zuordnungen im Schuljahr 1', s.mappingsBySchoolYear[1]);
  row('Zuordnungen im Schuljahr 2', s.mappingsBySchoolYear[2]);
  row('Zuordnungen im Schuljahr 3', s.mappingsBySchoolYear[3]);
  row('Enabler mit Zuordnung', s.enablersMapped);
  row('Komponenten mit Zuordnung', s.componentsMapped);
  row('Übersprungene Einträge', plan.skipped.length);
  row('Zuordnungen, die dadurch fehlen', s.pairsSkipped);
  out.push('');
  out.push('## Lernfelder');
  out.push('');
  out.push('| Code | Schuljahr | Titel aus | Stunden | Zuordnungen |');
  out.push('|---|---|---|---|---|');
  for (const field of plan.learningFields) {
    out.push(
      `| ${field.code} | ${field.trainingYear} | ${TITLE_SOURCE_TEXT[field.titleSource]} | ${field.hoursBudget ?? 'offen'} | ${s.mappingsByLearningField[field.code] ?? 0} |`
    );
  }
  out.push('');
  if (plan.skipped.length > 0) {
    out.push('## Übersprungene Einträge');
    out.push('');
    out.push(
      '| Zeile | Spalte | Code | Komponente | Enabler | Lernfeld | Zuordnungen betroffen |'
    );
    out.push('|---|---|---|---|---|---|---|');
    for (const skip of plan.skipped.slice(0, maxSkips)) {
      out.push(
        `| ${skip.row} | ${skip.column ?? ''} | ${skip.code} | ${skip.componentCode ?? ''} | ${skip.enablerCode ?? ''} | ${skip.learningField ?? ''} | ${skip.pairs} |`
      );
    }
    if (plan.skipped.length > maxSkips) {
      out.push('');
      out.push(`und ${plan.skipped.length - maxSkips} weitere`);
    }
    out.push('');
    out.push('Gründe:');
    out.push('');
    for (const [code, count] of Object.entries(s.skippedByCode)) {
      out.push(
        `- ${code} (${count}): ${SKIP_CODE_TEXT[code as SkipCode] ?? code}`
      );
    }
    out.push('');
  }
  if (plan.notes.length > 0) {
    out.push('## Positionen ohne Lernfeld (kein Fehler)');
    out.push('');
    for (const [code, count] of Object.entries(s.notesByCode)) {
      out.push(`- ${code}: ${count}`);
    }
    out.push('');
  }
  out.push('## Offene Punkte');
  out.push('');
  for (const point of plan.open) out.push(`- ${OPEN_TEXT[point]}`);
  out.push('');
  if (plan.warnings.length > 0) {
    out.push('## Hinweise');
    out.push('');
    for (const warning of plan.warnings) out.push(`- ${warning}`);
    out.push('');
  }
  return out.join('\n');
}
