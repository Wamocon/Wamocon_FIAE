// What the path of a PDF of the source folder Komponenten_PDF says, and what its
// first heading says. Pure functions: no file access, no database.
//
// Layout: <component folder>/<Enabler | Szenarien | Use-Cases | Use-Cases_Musterlösung>/<file>.
// The component folder is "06.2 - Title (§ 4 Abs. 2 Nr. 6)". The id of an enabler stands
// at the start of the file name: 6d_Titel.pdf, 24_2e).pdf, 23a).pdf, 14c.pdf, with the
// prefix Szenario_ or UC_ in the other folders. A file that does not follow the pattern
// of its folder is reported and never guessed (14i.pdf in Szenarien).
//
// This module has no runtime import on purpose, the scripts under scripts/import load it
// directly with Node's type stripping.

import type { PathClass, PdfKind } from './types';

/** Component folder: "06.2 - Title (§ 4 Abs. 2 Nr. 6)". */
const COMPONENT_DIR = /^(\d{1,2})(?:\.(\d))?\s*-\s*\S/;
/** Enabler id at the start of a name: 1a, 6d, 24_2e, 25.2d (a bracket or a dot may follow). */
const ID = /^(\d{1,2})(?:[_.](\d))?([a-z])(?![a-z0-9])/i;
const NOTE = /\(\s*aus\s/i;
const SOLUTION_SUFFIX = /_musterl(?:ö|oe)sung$/i;

const FOLDER_KIND: Record<string, PdfKind> = {
  enabler: 'enabler',
  szenarien: 'scenario',
  'use-cases': 'usecase_task',
  'use-cases_musterlösung': 'usecase_solution',
  'use-cases_musterloesung': 'usecase_solution',
};

const PREFIX: Record<PdfKind, RegExp> = {
  enabler: /^/,
  scenario: /^Szenario_/i,
  usecase_task: /^UC_/i,
  usecase_solution: /^UC_/i,
};

const empty = (
  status: PathClass['status'],
  reason: string,
  extra: Partial<PathClass> = {}
): PathClass => ({
  kind: null,
  componentCode: null,
  enablerKey: null,
  enablerCode: null,
  nameId: null,
  status,
  reason,
  ...extra,
});

export function classifyPdfPath(rel: string): PathClass {
  const segments = rel
    .normalize('NFC')
    .split(/[\\/]+/)
    .map(s => s.trim())
    .filter(Boolean);
  const file = segments[segments.length - 1] ?? '';
  if (!/\.pdf$/i.test(file)) {
    return empty('ignored', 'The file is no PDF.');
  }
  if (segments.length !== 3) {
    return empty(
      'ignored',
      'The file does not lie directly in a document folder of a component folder.'
    );
  }
  const component = COMPONENT_DIR.exec(segments[0]);
  if (!component) {
    return empty('ignored', 'The folder is no component folder.');
  }
  const number = Number(component[1]);
  const split = component[2] ? Number(component[2]) : null;
  const componentCode = `K${number}${split !== null ? `.${split}` : ''}`;

  const folder = segments[1].toLowerCase();
  if (folder === 'quizze') {
    return empty('ignored', 'The folder Quizze is not part of this import.', {
      componentCode,
    });
  }
  const kind = FOLDER_KIND[folder];
  if (!kind) {
    return empty(
      'ignored',
      'The folder is not one of the four document folders.',
      { componentCode }
    );
  }

  const base = file.replace(/\.pdf$/i, '');
  const misnamed = (reason: string): PathClass =>
    empty('misnamed', reason, { kind, componentCode });
  if (NOTE.test(base)) {
    return empty(
      'annotated',
      'The file name carries a note: the content may belong to another slot, it needs a decision.',
      { kind, componentCode }
    );
  }
  const prefix = PREFIX[kind].exec(base);
  const match = prefix ? ID.exec(base.slice(prefix[0].length)) : null;
  if (!match) {
    return misnamed('The file name does not follow the pattern of its folder.');
  }
  const solution = SOLUTION_SUFFIX.test(base);
  if (kind === 'usecase_solution' && !solution) {
    return misnamed(
      'A file of the solution folder has to end with _Musterlösung.'
    );
  }
  if (kind === 'usecase_task' && solution) {
    return misnamed('A solution file lies in the task folder.');
  }
  const nameId = {
    number: Number(match[1]),
    split: match[2] ? Number(match[2]) : null,
    letter: match[3].toLowerCase(),
  };
  if (
    nameId.number !== number ||
    (nameId.split !== null && nameId.split !== split)
  ) {
    return misnamed(
      'The id in the file name does not fit the component folder.'
    );
  }
  const key = `${number}${split !== null ? `.${split}` : ''}${nameId.letter}`;
  return {
    kind,
    componentCode,
    enablerKey: key,
    enablerCode: `${componentCode}-${nameId.letter}`,
    nameId,
    status: 'ok',
    reason: null,
  };
}

export interface HeadingId {
  number: number;
  split: number | null;
  letter: string;
  /** The heading starts with "Szenario ". */
  scenario: boolean;
}

/** Lines of the first page that are searched for the heading. */
const HEADING_LINES = 25;
// 6d) Titel, Szenario 6d) Titel, Szenario_14j) Titel, Szenario 25/1a) Titel, 24.2e) Titel, 25/1b - Titel
const HEADING =
  /^(Szenario[\s_]+)?(\d{1,2})(?:[._/](\d))?([a-z])(?:\)\s*\S|\s+[-–]\s+\S)/i;

/** The enabler id of the heading in the first lines of the first page, or null. */
export function headingId(text: string | null | undefined): HeadingId | null {
  if (!text) return null;
  const lines = text.split(/\r?\n/).slice(0, HEADING_LINES);
  for (const line of lines) {
    const match = HEADING.exec(line.trim());
    if (match) {
      return {
        number: Number(match[2]),
        split: match[3] ? Number(match[3]) : null,
        letter: match[4].toLowerCase(),
        scenario: Boolean(match[1]),
      };
    }
  }
  return null;
}
