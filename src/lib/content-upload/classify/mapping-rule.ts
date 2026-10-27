// The rule stage for an Excel file (package UP2): is it the learning field mapping table?
// Pure function: no database, no network, no model.
//
// The file is recognized by the CONTENT of a sheet, never by its name: a sheet with the
// header row "Schuljahr 1" to "Schuljahr 3" in the columns C to E and at least one
// position (a row with text in column B) is the mapping table of the training regulation
// (src/lib/content-import/learning-fields/mapping-sheet.ts). Any other workbook is
// refused by the extract step.
//
// What a band means:
//   high    the sheet has the form of the table and every component block names a valid
//           number of its section
//   medium  some blocks cannot be assigned (no number, a paragraph that does not fit its
//           section) or rows carry learning fields but no position. The planner skips
//           exactly those rows with their reasons and reads the rest. Reason
//           PARSER_ERRORS, so a click does not take it, a person confirms it on purpose
//
// The assignment of the FILE has no component, enabler or level: the codes come from the
// table and are checked against the catalog when the plan is built. The document type is
// 'other' (the database allows it, the rules never give it to a Word file), and a person
// cannot change it. Reasons carry stable codes and short German texts and never quote a
// cell.

import type { ParsedMappingSheet } from '../../content-import/learning-fields/mapping-sheet';

import {
  CONFIDENCE,
  REASON_TEXT_MAX,
  type ProposalBand,
  type Reason,
} from './types';

/** What the review list and the file row may hold about the table: numbers only. */
export interface MappingSummary {
  positions: number;
  blocks: number;
  blocksWithIssues: number;
  orphanRows: number;
  /** Codes of the problems of the blocks, unique. */
  issueCodes: string[];
}

export interface MappingProposal {
  docType: 'other';
  source: 'content';
  band: ProposalBand;
  confidence: number;
  reasons: Reason[];
}

const cut = (text: string) =>
  text.length > REASON_TEXT_MAX ? text.slice(0, REASON_TEXT_MAX) : text;

export function summarizeMappingSheet(
  sheet: ParsedMappingSheet
): MappingSummary {
  const issues = new Set<string>();
  let blocksWithIssues = 0;
  for (const block of sheet.blocks) {
    if (block.issues.length > 0) blocksWithIssues += 1;
    for (const code of block.issues) issues.add(code);
  }
  return {
    positions: sheet.positions.length,
    blocks: sheet.blocks.length,
    blocksWithIssues,
    orphanRows: sheet.orphanRows.length,
    issueCodes: [...issues].sort(),
  };
}

export function classifyMappingSheet(summary: MappingSummary): MappingProposal {
  const reasons: Reason[] = [
    {
      code: 'XLSX_MAPPING',
      text: cut(
        `Das Tabellenblatt hat die Form der Lernfeld-Zuordnung: ${summary.positions} Positionen in ${summary.blocks} Komponentenblöcken.`
      ),
    },
  ];
  if (summary.blocksWithIssues > 0 || summary.orphanRows > 0) {
    const codes = summary.issueCodes.filter(c => /^[A-Z_]{1,40}$/.test(c));
    reasons.push({
      code: 'PARSER_ERRORS',
      text: cut(
        `Der Leser meldet Fehler: ${summary.blocksWithIssues} Komponentenblöcke und ${summary.orphanRows} Zeilen ohne Position werden übersprungen${codes.length > 0 ? ` (${codes.join(', ')})` : ''}.`
      ),
    });
    return {
      docType: 'other',
      source: 'content',
      band: 'medium',
      confidence: CONFIDENCE.medium,
      reasons,
    };
  }
  return {
    docType: 'other',
    source: 'content',
    band: 'high',
    confidence: CONFIDENCE.content,
    reasons,
  };
}
