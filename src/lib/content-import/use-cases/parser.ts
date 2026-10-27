// Parser for the use case documents of the KfBM source (phase 4.6). Pure
// functions: no file access, no database. The input is plain text or a list of
// paragraphs (see SourceInput), docx-paragraphs.ts turns a .docx into such a
// list, including the table position of every paragraph.
//
// Format of a use case document (see docs/kfbm-import-quellformat.md):
//   heading   "4a) Title"
//   sections  Behandelte Themen (optional), Ausgangssituation (with the data
//             table "Eckdaten"), Zielsetzung, Weg zum Ziel, Musterlösung
//             (and, if a later version has it, Bewertungskriterien)
// A section heading is a bold line outside a table whose text is the name of
// the section. Everything else is text of the section above it.
//
// Solution protection: the model solution (and the evaluation criteria) are
// solutions. The parser keeps them apart from the visible sections and marks
// them (solutionFields, visibility). toTraineeUseCase gives the view that
// trainees may see and fails closed.
//
// A parser never throws on bad content. It returns the best effort value plus
// the list of issues, so one broken file does not stop a whole run.
//
// Only a type import and toParagraphs: the scripts under scripts/import load
// this module with Node's type stripping (the hook of ts-resolve-hook.mjs adds
// the file extension).

import { toParagraphs } from '../source-parsers';
import type {
  ImportIssue,
  IssueSeverity,
  Paragraph,
  ParseResult,
  SourceInput,
} from '../types';
import type { ParsedUseCase, TraineeUseCase } from './types';

export const USE_CASE_SOLUTION_FIELDS = Object.freeze([
  'solution',
  'criteria',
] as const);

type SectionName =
  | 'topics'
  | 'situation'
  | 'objective'
  | 'steps'
  | 'solution'
  | 'criteria';

const SECTION_PATTERNS: Record<SectionName, RegExp> = {
  topics: /^Behandelte\s+Themen\s*:?$/i,
  situation: /^Ausgangssituation\s*:?$/i,
  objective: /^Zielsetzung\s*:?$/i,
  steps: /^Weg\s+zum\s+Ziel\s*:?$/i,
  solution: /^Musterl(?:ö|oe)sung\s*:?$/i,
  criteria: /^Bewertungskriterien\s*:?$/i,
};
const SECTION_ORDER: SectionName[] = [
  'topics',
  'situation',
  'objective',
  'steps',
  'solution',
  'criteria',
];
const SECTION_LABEL: Record<SectionName, string> = {
  topics: 'Behandelte Themen',
  situation: 'Ausgangssituation',
  objective: 'Zielsetzung',
  steps: 'Weg zum Ziel',
  solution: 'Musterlösung',
  criteria: 'Bewertungskriterien',
};
/** Sections a use case must have. The others are optional. */
const REQUIRED: SectionName[] = ['situation', 'objective', 'steps', 'solution'];
/** The data table inside the situation, a missing one is only noted. */
const DATA_HEADING = /^Eckdaten\s*:?$/i;

const HEADING = /^(\d{1,2})(?:[._](\d))?([a-z])\)\s*(.+)$/;
const HEADING_LOOSE =
  /^(?:UC[\s_]+)?(\d{1,2})(?:[._/](\d))?([a-z])\s*[:.)\-–—]\s*(.+)$/;

const codeOf = (num: string, split: string | undefined, letter: string) =>
  `${Number(num)}${split ? `.${split}` : ''}${letter.toLowerCase()}`;

function issue(
  code: string,
  severity: IssueSeverity,
  message: string
): ImportIssue {
  return { code, severity, message };
}

/**
 * Text of a run of paragraphs. Table rows become one line each (cells joined by
 * " | ", several paragraphs of one cell joined by a space), consecutive rows
 * form a block, every other paragraph is a block of its own. Blocks are
 * separated by an empty line.
 */
export function renderBlocks(paragraphs: readonly Paragraph[]): string {
  const blocks: string[] = [];
  let tableLines: string[] = [];
  const flushTable = () => {
    if (tableLines.length > 0) blocks.push(tableLines.join('\n'));
    tableLines = [];
  };
  let i = 0;
  while (i < paragraphs.length) {
    const { row } = paragraphs[i];
    if (row === undefined) {
      flushTable();
      const text = paragraphs[i].text.trim();
      if (text.length > 0) blocks.push(text);
      i += 1;
      continue;
    }
    const cells: Array<{ id: number | undefined; parts: string[] }> = [];
    while (i < paragraphs.length && paragraphs[i].row === row) {
      const { cell, text } = paragraphs[i];
      const last = cells[cells.length - 1];
      if (last && cell !== undefined && last.id === cell) {
        if (text.length > 0) last.parts.push(text);
      } else {
        cells.push({ id: cell, parts: text.length > 0 ? [text] : [] });
      }
      i += 1;
    }
    const line = cells.map(cell => cell.parts.join(' ')).join(' | ');
    if (cells.some(cell => cell.parts.length > 0)) tableLines.push(line);
  }
  flushTable();
  return blocks.join('\n\n');
}

function makeResult<T>(value: T, issues: ImportIssue[]): ParseResult<T> {
  return {
    value,
    issues,
    ok: !issues.some(entry => entry.severity === 'error'),
  };
}

/**
 * Parses the text of a use case file: the heading "4a) Title" and the sections
 * Behandelte Themen, Ausgangssituation, Zielsetzung and Weg zum Ziel (visible
 * for trainees) and Musterlösung and Bewertungskriterien (solutions, trainer
 * only).
 */
export function parseUseCaseText(
  input: SourceInput
): ParseResult<ParsedUseCase> {
  const issues: ImportIssue[] = [];
  const paragraphs = toParagraphs(input);
  const useCase: ParsedUseCase = {
    code: null,
    title: null,
    topics: '',
    situation: '',
    objective: '',
    steps: '',
    solution: '',
    criteria: '',
    hasDataTable: false,
    visibility: {
      topics: 'trainee',
      situation: 'trainee',
      objective: 'trainee',
      steps: 'trainee',
      solution: 'trainer',
      criteria: 'trainer',
    },
  };
  const firstIndex = paragraphs.findIndex(p => p.text.length > 0);
  if (firstIndex < 0) {
    issues.push(issue('EMPTY_INPUT', 'error', 'The document has no text.'));
    return makeResult(useCase, issues);
  }

  const headingLine = paragraphs[firstIndex].text;
  const strict = HEADING.exec(headingLine);
  const loose = strict ? null : HEADING_LOOSE.exec(headingLine);
  const match = strict ?? loose;
  if (match) {
    useCase.code = codeOf(match[1], match[2], match[3]);
    useCase.title = match[4].replace(/\s+/g, ' ').trim();
    if (loose) {
      issues.push(
        issue(
          'HEADING_VARIANT',
          'warning',
          'The heading has another form than "4a) Title".'
        )
      );
    }
  } else {
    useCase.title = headingLine;
    issues.push(
      issue('HEADING_FORMAT', 'error', 'The heading carries no use case code.')
    );
  }

  const content: Record<SectionName, Paragraph[]> = {
    topics: [],
    situation: [],
    objective: [],
    steps: [],
    solution: [],
    criteria: [],
  };
  const seen: SectionName[] = [];
  let active: SectionName | null = null;
  let ignored = 0;
  let unboldHeadings = 0;
  // A solution heading that is not read as a heading would leave the solution
  // in the section above, which trainees see: that is an error, not a hint.
  const strayProtected: SectionName[] = [];
  for (const paragraph of paragraphs.slice(firstIndex + 1)) {
    const { text } = paragraph;
    const name =
      text.length > 0
        ? SECTION_ORDER.find(section => SECTION_PATTERNS[section].test(text))
        : undefined;
    if (name && paragraph.bold && paragraph.row === undefined) {
      if (seen.includes(name)) {
        issues.push(
          issue(
            'SECTION_DUPLICATE',
            'error',
            `The section "${SECTION_LABEL[name]}" appears more than once.`
          )
        );
      } else {
        seen.push(name);
      }
      active = name;
      continue;
    }
    if (name) {
      unboldHeadings += 1;
      if (
        (name === 'solution' || name === 'criteria') &&
        !strayProtected.includes(name)
      ) {
        strayProtected.push(name);
      }
    }
    if (active) {
      content[active].push(paragraph);
    } else if (text.length > 0) {
      ignored += 1;
    }
  }
  if (ignored > 0) {
    issues.push(
      issue(
        'UNPARSED_LINE',
        'warning',
        `${ignored} line(s) before the first section were ignored.`
      )
    );
  }
  for (const name of strayProtected) {
    issues.push(
      issue(
        'SOLUTION_HEADING_NOT_BOLD',
        'error',
        `The heading "${SECTION_LABEL[name]}" is not bold or stands in a table, so its text would stay in a visible section.`
      )
    );
  }
  if (unboldHeadings > 0) {
    issues.push(
      issue(
        'SECTION_HEADING_NOT_BOLD',
        'warning',
        `${unboldHeadings} line(s) read like a section heading but are not bold or stand in a table. They stay text of the section above.`
      )
    );
  }

  for (const name of SECTION_ORDER) {
    const required = REQUIRED.includes(name);
    if (!seen.includes(name)) {
      if (required || name === 'topics') {
        issues.push(
          issue(
            'SECTION_MISSING',
            required ? 'error' : 'warning',
            `The section "${SECTION_LABEL[name]}" is missing.`
          )
        );
      }
    } else if (renderBlocks(content[name]).length === 0) {
      issues.push(
        issue(
          'SECTION_EMPTY',
          required ? 'error' : 'warning',
          `The section "${SECTION_LABEL[name]}" has no text.`
        )
      );
    }
  }
  const expectedOrder = SECTION_ORDER.filter(name => seen.includes(name));
  if (seen.join('|') !== expectedOrder.join('|')) {
    issues.push(
      issue(
        'SECTION_ORDER',
        'error',
        `The sections appear in the order ${seen.map(s => SECTION_LABEL[s]).join(', ')}, expected ${expectedOrder.map(s => SECTION_LABEL[s]).join(', ')}.`
      )
    );
  }

  useCase.hasDataTable = content.situation.some(
    p => p.bold && p.row === undefined && DATA_HEADING.test(p.text)
  );
  if (seen.includes('situation') && !useCase.hasDataTable) {
    issues.push(
      issue(
        'DATA_HEADING_MISSING',
        'warning',
        'The situation has no bold line "Eckdaten".'
      )
    );
  }

  useCase.topics = renderBlocks(content.topics);
  useCase.situation = renderBlocks(content.situation);
  useCase.objective = renderBlocks(content.objective);
  useCase.steps = renderBlocks(content.steps);
  useCase.solution = renderBlocks(content.solution);
  useCase.criteria = renderBlocks(content.criteria);
  return makeResult(useCase, issues);
}

// Marker words of a solution in text that trainees would see. Last line of
// defence: a view that contains one is refused, whatever the issue list says.
// "Bewertungskriterien" is no marker: the use cases use the word in their
// tasks (rate offers by criteria). The heading of such a section is read as a
// section of its own and kept apart.
const SOLUTION_MARKERS = [
  // A line that is only the heading of the criteria (the word alone is no
  // marker, the tasks use it in running text).
  /^\s*Bewertungskriterien\s*:?\s*$/im,
  /Musterl(?:ö|oe)sung/i,
  /Richtige\s+Antwort/i,
  /Kurzbegr(?:ü|ue)ndung/i,
  /L(?:ö|oe)sungs?szenario/i,
  /Fachwissen\s+zur\s+L(?:ö|oe)sung/i,
];

/** True when a text shows the marker of a solution. */
export function hasUseCaseSolutionMarker(texts: readonly string[]): boolean {
  return texts.some(text => SOLUTION_MARKERS.some(marker => marker.test(text)));
}

/** The visible text of a use case, in the order of the document. */
export function assignmentText(
  useCase: Pick<ParsedUseCase, 'situation' | 'objective' | 'steps'>
): string {
  return [
    `${SECTION_LABEL.situation}\n\n${useCase.situation}`,
    `${SECTION_LABEL.objective}\n\n${useCase.objective}`,
    `${SECTION_LABEL.steps}\n\n${useCase.steps}`,
  ].join('\n\n');
}

/**
 * The part of a use case that trainees may see: no model solution, no criteria.
 * Fails closed: returns null when the parse result has an error or when a
 * solution marker is found in the visible text.
 */
export function toTraineeUseCase(
  result: ParseResult<ParsedUseCase>
): TraineeUseCase | null {
  if (!result.ok) return null;
  const useCase = result.value;
  const view: TraineeUseCase = {
    code: useCase.code,
    title: useCase.title,
    topics: useCase.topics,
    situation: useCase.situation,
    objective: useCase.objective,
    steps: useCase.steps,
  };
  const visible = [
    view.title ?? '',
    view.topics,
    view.situation,
    view.objective,
    view.steps,
  ];
  return hasUseCaseSolutionMarker(visible) ? null : view;
}
