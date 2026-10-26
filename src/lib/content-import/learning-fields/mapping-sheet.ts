// Reads the mapping table of the project (phase 4.5): the list that assigns each
// position of the training regulation (an enabler of the import) to learning
// fields per school year. Pure functions: the rows come from xlsx-sheet.ts, this
// module opens no file.
//
// Layout of the table: a header row with "Schuljahr 1" to "Schuljahr 3" in the
// columns C to E. Column A names a component only in the first row of its block
// ("6. Auftragsbearbeitung durchführen (§ 4 Absatz 2 Nummer 6)", the cells of the
// block are merged), column B holds the position with its letter ("a) ..."),
// columns C to E the learning fields of the school years. Rows "Abschnitt B:"
// and "Abschnitt C:" start the sections of the regulation.
//
// The number of a component of the import (K6) comes from the paragraph of the
// regulation: section A (§ 4 Absatz 2) numbers 1 to 9 are K1 to K9, section B
// (§ 4 Absatz 3) numbers 1 to 10 are K10 to K19 and section C (§ 4 Absatz 4)
// numbers 1 to 6 are K20 to K25. The title is not used (it has typos and the
// wording differs from the import for some components).

import { cleanCell, parseLearningFieldRefs } from './refs';
import type { LearningFieldRefs } from './refs';
import type { SchoolYear } from './model';
import type { SheetRow } from './xlsx-sheet';

export type Section = 'A' | 'B' | 'C';

export interface Reference {
  absatz: number;
  nummer: number;
  /** Normalised: "§ 4 Abs. 2 Nr. 6". */
  text: string;
}

const REFERENCE =
  /§\s*\d+\s*(?:absatz|abs\.?)\s*(\d+)\s*(?:nummer|nr\.?)\s*(\d+)/i;

/** The paragraph of the regulation in a cell ("§ 4 Absatz 2 Nummer 6"), or null. */
export function parseReference(
  text: string | null | undefined
): Reference | null {
  const match = REFERENCE.exec(cleanCell(text));
  if (!match) return null;
  const absatz = Number(match[1]);
  const nummer = Number(match[2]);
  return { absatz, nummer, text: `§ 4 Abs. ${absatz} Nr. ${nummer}` };
}

/** Section, component numbers and the offset of the K numbers. */
const SECTIONS: Record<
  Section,
  { absatz: number; max: number; offset: number }
> = {
  A: { absatz: 2, max: 9, offset: 0 },
  B: { absatz: 3, max: 10, offset: 9 },
  C: { absatz: 4, max: 6, offset: 19 },
};

const sectionOfAbsatz = (absatz: number): Section | null =>
  (Object.keys(SECTIONS) as Section[]).find(
    s => SECTIONS[s].absatz === absatz
  ) ?? null;

export type BlockIssue =
  | 'SECTION_MISMATCH'
  | 'NUMBER_MISMATCH'
  | 'NUMBER_OUT_OF_RANGE'
  | 'BLOCK_UNKNOWN';

export interface SheetBlock {
  /** Row of the component title. */
  row: number;
  section: Section;
  /** Number in front of the title ("6." is 6), null if there is none. */
  position: number | null;
  /** Number of the component in the import (K6 is 6), null if it cannot be derived. */
  componentNumber: number | null;
  /** The paragraph of the regulation, normalised. */
  reference: string | null;
  issues: BlockIssue[];
}

export interface SheetPosition {
  row: number;
  /** Index in `blocks`, null for a position outside any block. */
  blockIndex: number | null;
  /** Letter of the position (a to z), null if the cell has none. */
  letter: string | null;
  /** References of the school year columns C (1), D (2) and E (3). */
  years: Record<SchoolYear, LearningFieldRefs>;
}

export interface ParsedMappingSheet {
  headerRow: number;
  /** First row below the header and last row with content. */
  firstRow: number;
  lastRow: number;
  blocks: SheetBlock[];
  positions: SheetPosition[];
  /** Rows "Abschnitt B:" and "Abschnitt C:". */
  sectionRows: number[];
  /** Rows with learning field cells but no position text. */
  orphanRows: number[];
  /** Rows below the header that carry no text in the columns A to E. */
  blankRows: number;
}

export type ParsedMappingSheetResult =
  | { ok: true; sheet: ParsedMappingSheet }
  | { ok: false; error: string };

const text = (row: SheetRow, column: string) => cleanCell(row.cells[column]);

function isHeader(row: SheetRow): boolean {
  return (
    /^schuljahr\s*1\b/i.test(text(row, 'C')) &&
    /^schuljahr\s*2\b/i.test(text(row, 'D')) &&
    /^schuljahr\s*3\b/i.test(text(row, 'E'))
  );
}

function makeBlock(row: number, a: string, current: Section): SheetBlock {
  const reference = parseReference(a);
  const lead = /^(\d{1,2})\s*[.)]/.exec(a);
  const position = lead ? Number(lead[1]) : null;
  const block: SheetBlock = {
    row,
    section: current,
    position,
    componentNumber: null,
    reference: reference ? reference.text : null,
    issues: [],
  };
  let section: Section = current;
  let number: number | null = position;
  if (reference) {
    const fromReference = sectionOfAbsatz(reference.absatz);
    if (fromReference === null || fromReference !== current) {
      block.issues.push('SECTION_MISMATCH');
      return block;
    }
    section = fromReference;
    number = reference.nummer;
    if (position !== null && position !== reference.nummer) {
      block.issues.push('NUMBER_MISMATCH');
      return block;
    }
  } else if (position === null) {
    block.issues.push('BLOCK_UNKNOWN');
    return block;
  }
  const spec = SECTIONS[section];
  if (number === null || number < 1 || number > spec.max) {
    block.issues.push('NUMBER_OUT_OF_RANGE');
    return block;
  }
  block.componentNumber = spec.offset + number;
  return block;
}

/** Blocks and positions of the mapping table, from the rows of its sheet. */
export function parseMappingSheet(rows: SheetRow[]): ParsedMappingSheetResult {
  const header = rows.find(isHeader);
  if (!header) {
    return {
      ok: false,
      error:
        'The header row (Schuljahr 1 to 3 in the columns C to E) was not found.',
    };
  }
  const blocks: SheetBlock[] = [];
  const positions: SheetPosition[] = [];
  const sectionRows: number[] = [];
  const orphanRows: number[] = [];
  let blankRows = 0;
  let section: Section = 'A';
  let blockIndex: number | null = null;
  let lastRow = header.row;

  for (const row of rows) {
    if (row.row <= header.row) continue;
    const a = text(row, 'A');
    const b = text(row, 'B');
    const years = {
      1: parseLearningFieldRefs(row.cells.C),
      2: parseLearningFieldRefs(row.cells.D),
      3: parseLearningFieldRefs(row.cells.E),
    } satisfies Record<SchoolYear, LearningFieldRefs>;
    const hasRefs = Object.values(years).some(r => r.kind !== 'empty');
    if (a === '' && b === '' && !hasRefs) {
      blankRows += 1;
      continue;
    }
    lastRow = Math.max(lastRow, row.row);

    const sectionMatch = /^abschnitt\s+([a-c])\b/i.exec(a);
    if (sectionMatch) {
      section = sectionMatch[1].toUpperCase() as Section;
      sectionRows.push(row.row);
      blockIndex = null;
      continue;
    }
    if (a !== '') {
      blocks.push(makeBlock(row.row, a, section));
      blockIndex = blocks.length - 1;
    }
    if (b === '') {
      if (hasRefs) orphanRows.push(row.row);
      continue;
    }
    const letter = /^([a-z])\s*\)/i.exec(b);
    positions.push({
      row: row.row,
      blockIndex,
      letter: letter ? letter[1].toLowerCase() : null,
      years,
    });
  }
  return {
    ok: true,
    sheet: {
      headerRow: header.row,
      firstRow: header.row + 1,
      lastRow,
      blocks,
      positions,
      sectionRows,
      orphanRows,
      blankRows,
    },
  };
}
