// The content rule (stage 2 of the assignment, docs/ki-upload-konzept.md 6.2):
// type, component, enabler and quiz level from the heading and the structure of a
// document. Pure function on a list of paragraphs: no file access, no database,
// no network, no model.
//
// It uses the parsers of the import (parseQuizText, parseScenarioText,
// parseUseCaseText, splitEnablerHeading) and adds only the choice of the parser:
// the structure of a document says which one reads it.
//   a line "Global Quiz" behind the heading       a global quiz, heading "06.1) Title"
//   a line "Quiz, Schwierigkeitsgrad: leicht"     an enabler quiz, heading "1b) Title"
//   lines "Richtige Antwort: B"                   a quiz
//   two or more sections of a use case            a use case (Behandelte Themen, Zielsetzung,
//                                                 Weg zum Ziel, Musterlösung, Bewertungskriterien)
//   a heading "Szenario 1b) Title" or the sections
//   Ausgangssituation and Lösungsszenario         a scenario
//   a heading "4a) Title" and a long text         an enabler text
// A text that is none of these is left alone (kind "none"), the rule never
// guesses a type.
//
// What the text of a document cannot do: the code comes from the heading alone,
// the type from the structure of the whole text (the lines of answers, the
// sections), which is what a quiz or a use case is made of. A code in the body, a
// line that looks like another heading and an instruction in the text change
// nothing. A text that contradicts its path ends as a conflict in assign.ts.
//
// A PDF has header lines before the heading (the own PDF of the source carry three).
// The parsers refuse them, so a PDF is read from the first line on that starts a
// recognizable document, within the first lines only. Its result is an original
// (docType pdf_original) of the type that it shows.
//
// The result never holds a message of a parser (those quote the document), only
// the stable codes of its issues.

import { splitEnablerHeading } from '../../content-import/apply/plan';
import {
  parseQuizText,
  parseScenarioText,
  toParagraphs,
} from '../../content-import/source-parsers';
import { parseUseCaseText } from '../../content-import/use-cases/parser';
import type { ImportIssue, Paragraph } from '../../content-import/types';

import { hasSolutionMarker } from '../patterns';
import { sanitizeExcerptText } from '../text-clean';

import type { OriginalType, QuizLevelCode, UploadDocType } from './types';

/** Work limits against a hostile file. */
const MAX_PARAGRAPHS = 5000;
const MAX_PARAGRAPH_CHARS = 4000;
const MAX_TOTAL_CHARS = 400_000;
/** Lines of a PDF that may stand before the heading. */
const MAX_LEADING_LINES = 5;
/** Characters of body text that make a heading with a code an enabler text. */
const MIN_ENABLER_CHARS = 300;
/** Lines with the options of a question that mark a file as a quiz in disguise. */
const QUESTION_OPTION_LINES = 3;
/** Lines "Richtige Antwort" that make a text a quiz (one line can be a quotation). */
const MIN_ANSWER_LINES = 2;

export type ContentNoneReason = 'NO_TEXT' | 'NO_STRUCTURE' | 'QUESTION_FORMAT';

export interface ContentNone {
  kind: 'none';
  reason: ContentNoneReason;
  /** True when the input was cut before it was read. */
  truncated: boolean;
}

export interface ContentMatch {
  kind: 'match';
  docType: UploadDocType;
  /** For a PDF: the type of the document it shows. */
  originalType: OriginalType | null;
  /**
   * The code as the heading writes it: 1b, 6.2d, 24.1a for a document of an
   * enabler, 06.1 for a global quiz. Null when the type is known but the heading
   * carries no code.
   */
  headingKey: string | null;
  componentNumber: number | null;
  componentSplit: number | null;
  enablerLetter: string | null;
  quizLevel: QuizLevelCode | null;
  /** The heading has another form than "1b) Title". */
  headingVariant: boolean;
  /** Codes of the error issues of the parser. */
  parserErrors: string[];
  /** Codes of the warning issues of the parser. */
  parserWarnings: string[];
  /** What led to the type, for the review list. */
  signals: string[];
  /** Header lines of a PDF that were skipped. */
  skippedLeadingLines: number;
  truncated: boolean;
  /**
   * A line of an enabler text carries a marker word of a solution (the parsers
   * name no solution part of a teaching text, so the marker words are all that
   * protect it). Only ever true for an enabler text.
   */
  solutionMarker: boolean;
}

export type ContentResult = ContentNone | ContentMatch;

export interface ClassifyContentOptions {
  format?: 'docx' | 'pdf';
}

const GLOBAL_MARK = /^Global[\s-]*Quiz\b/i;
const PARAGRAPH_REFERENCE = /^\(§[^)]*\)$/;
const DIFFICULTY_LINE = /^Quiz\b.*Schwierigkeitsgrad/i;
const ANSWER_LINE = /^Richtige\s+Antwort\b/i;
const OPTION_LINE = /^[A-D]\)\s/;
const USE_CASE_HEADING =
  /^(?:Behandelte\s+Themen|Zielsetzung|Weg\s+zum\s+Ziel|Musterl(?:ö|oe)sung|Bewertungskriterien)\s*:?$/i;
const SITUATION_HEADING = /^Ausgangssituation\s*:?$/i;
const SOLUTION_HEADING =
  /^(?:L(?:ö|oe)sung(?:s?szenario)?|Wie das Fachwissen zur L(?:ö|oe)sung beitr(?:ä|ae)gt)\s*:?$/i;
const STRICT_ENABLER_HEADING = /^(\d{1,2})(?:[._](\d))?([a-z])\)\s*(.+)$/;
const ENABLER_KEY = /^(\d{1,2})(?:\.(\d))?([a-z])$/;
const COMPONENT_KEY = /^(\d{1,2})(?:\.(\d))?$/;

const LEVELS: ReadonlySet<string> = new Set(['low', 'medium', 'high']);

/** The paragraphs that the parsers read: bounded and cleaned. */
function prepare(input: unknown): {
  paragraphs: Paragraph[];
  truncated: boolean;
} {
  if (!Array.isArray(input)) return { paragraphs: [], truncated: false };
  let truncated = input.length > MAX_PARAGRAPHS;
  let budget = MAX_TOTAL_CHARS;
  const bounded: Paragraph[] = [];
  for (const item of input.slice(0, MAX_PARAGRAPHS)) {
    if (item === null || typeof item !== 'object') continue;
    const raw = typeof item.text === 'string' ? item.text : '';
    const take = raw.slice(
      0,
      Math.min(MAX_PARAGRAPH_CHARS, Math.max(0, budget))
    );
    if (take.length < raw.length) truncated = true;
    budget -= take.length;
    bounded.push({
      text: take,
      bold: Boolean(item.bold),
      ...(typeof item.row === 'number' ? { row: item.row } : {}),
      ...(typeof item.cell === 'number' ? { cell: item.cell } : {}),
    });
  }
  // The strong cleaning of the excerpt first (NFKC, every invisible character,
  // so none can split a heading or a marker word), then toParagraphs, which
  // cleans like the parsers do and splits soft line breaks.
  return {
    paragraphs: toParagraphs(
      bounded.map(p => ({ ...p, text: sanitizeExcerptText(p.text) }))
    ),
    truncated,
  };
}

const codesOf = (issues: ImportIssue[], severity: 'error' | 'warning') => [
  ...new Set(issues.filter(i => i.severity === severity).map(i => i.code)),
];

interface Found {
  docType: Exclude<UploadDocType, 'pdf_original'>;
  headingKey: string | null;
  quizLevel: QuizLevelCode | null;
  headingVariant: boolean;
  parserErrors: string[];
  parserWarnings: string[];
  signals: string[];
  solutionMarker: boolean;
}

const GLOBAL_HEADING = /^\d{1,2}(?:\.\d)?\)\s*\S/;
/** A wrapped paragraph reference is short: it is a line of a heading, no text. */
const WRAPPED_LINE_MAX = 80;

/**
 * A heading of a global quiz whose paragraph reference was wrapped over several
 * lines (a PDF breaks "(§ 4 Abs. 2 Nr. 6)" at the line end): the lines between
 * the heading and the line "Global Quiz" are joined to the heading, so the parser
 * sees the form it knows. The forms with no gap and with one line that is the
 * whole reference are the parser's own and stay as they are.
 */
function joinWrappedGlobalHeading(paragraphs: Paragraph[]): {
  paragraphs: Paragraph[];
  wrapped: boolean;
} {
  const indexes: number[] = [];
  for (let i = 0; i < paragraphs.length && indexes.length < 6; i += 1) {
    if (paragraphs[i].text.length > 0) indexes.push(i);
  }
  if (indexes.length < 3 || !GLOBAL_HEADING.test(paragraphs[indexes[0]].text)) {
    return { paragraphs, wrapped: false };
  }
  for (let m = 2; m < indexes.length; m += 1) {
    if (!GLOBAL_MARK.test(paragraphs[indexes[m]].text)) continue;
    const gap = indexes.slice(1, m).map(i => paragraphs[i].text);
    const whole = gap.length === 1 && PARAGRAPH_REFERENCE.test(gap[0]);
    if (whole || gap.some(line => line.length > WRAPPED_LINE_MAX)) break;
    const head = paragraphs[indexes[0]];
    return {
      wrapped: true,
      paragraphs: [
        { ...head, text: `${head.text} ${gap.join(' ')}` },
        ...paragraphs.slice(indexes[m]),
      ],
    };
  }
  return { paragraphs, wrapped: false };
}

/** Which document is this, read from its first paragraph on. */
function recognize(
  source: Paragraph[]
): Found | { none: 'NO_TEXT' | 'NO_STRUCTURE' | 'QUESTION_FORMAT' } {
  const { paragraphs, wrapped } = joinWrappedGlobalHeading(source);
  const lines = paragraphs.map(p => p.text).filter(text => text.length > 0);
  if (lines.length === 0) return { none: 'NO_TEXT' };
  const first = lines[0];
  const second = lines[1] ?? '';
  const third = lines[2] ?? '';

  const global =
    GLOBAL_MARK.test(second) ||
    (PARAGRAPH_REFERENCE.test(second) && GLOBAL_MARK.test(third));
  const difficulty = lines.slice(0, 4).some(line => DIFFICULTY_LINE.test(line));
  const answers = lines.filter(line => ANSWER_LINE.test(line)).length;
  if (global || difficulty || answers >= MIN_ANSWER_LINES) {
    const parsed = parseQuizText(paragraphs, {
      expectedQuestions: global ? 20 : undefined,
    });
    const quiz = parsed.value;
    const signals = [
      ...(global ? ['global-mark'] : []),
      ...(difficulty ? ['difficulty-line'] : []),
      ...(answers >= MIN_ANSWER_LINES ? ['answer-lines'] : []),
      ...(wrapped ? ['wrapped-heading'] : []),
    ];
    const level =
      typeof quiz.difficulty === 'string' && LEVELS.has(quiz.difficulty)
        ? (quiz.difficulty as QuizLevelCode)
        : null;
    const warnings = codesOf(parsed.issues, 'warning');
    if (wrapped && !warnings.includes('HEADING_VARIANT')) {
      warnings.push('HEADING_VARIANT');
    }
    return {
      docType: quiz.kind === 'global' ? 'global_quiz' : 'quiz',
      headingKey: quiz.kind === 'global' ? quiz.componentKey : quiz.enablerCode,
      quizLevel: quiz.kind === 'global' ? null : level,
      headingVariant: warnings.includes('HEADING_VARIANT'),
      parserErrors: codesOf(parsed.issues, 'error'),
      parserWarnings: warnings,
      signals,
      solutionMarker: false,
    };
  }

  if (lines.filter(line => USE_CASE_HEADING.test(line)).length >= 2) {
    const parsed = parseUseCaseText(paragraphs);
    const warnings = codesOf(parsed.issues, 'warning');
    return {
      docType: 'use_case',
      headingKey: parsed.value.code,
      quizLevel: null,
      headingVariant: warnings.includes('HEADING_VARIANT'),
      parserErrors: codesOf(parsed.issues, 'error'),
      parserWarnings: warnings,
      signals: ['use-case-sections'],
      solutionMarker: false,
    };
  }

  const scenarioHeading = /^Szenario\b/i.test(first);
  const sections =
    lines.some(line => SITUATION_HEADING.test(line)) &&
    lines.some(line => SOLUTION_HEADING.test(line));
  if (scenarioHeading || sections) {
    const parsed = parseScenarioText(paragraphs);
    const warnings = codesOf(parsed.issues, 'warning');
    return {
      docType: 'scenario',
      headingKey: parsed.value.code,
      quizLevel: null,
      headingVariant: warnings.includes('HEADING_VARIANT'),
      parserErrors: codesOf(parsed.issues, 'error'),
      parserWarnings: warnings,
      signals: [
        ...(scenarioHeading ? ['scenario-heading'] : []),
        ...(sections ? ['situation-and-solution'] : []),
      ],
      solutionMarker: false,
    };
  }

  if (
    !/^(?:Szenario|Quiz)\b/i.test(first) &&
    splitEnablerHeading(first).code !== null
  ) {
    // Options A) to D) without the lines of a quiz: the file is a quiz in
    // disguise, not a teaching text
    if (
      lines.filter(line => OPTION_LINE.test(line)).length >=
      QUESTION_OPTION_LINES
    ) {
      return { none: 'QUESTION_FORMAT' };
    }
    const body = lines.slice(1).reduce((sum, line) => sum + line.length, 0);
    if (body >= MIN_ENABLER_CHARS) {
      const variant = !STRICT_ENABLER_HEADING.test(first);
      return {
        docType: 'enabler',
        headingKey: splitEnablerHeading(first).code,
        quizLevel: null,
        headingVariant: variant,
        parserErrors: [],
        parserWarnings: variant ? ['HEADING_VARIANT'] : [],
        signals: ['enabler-heading'],
        solutionMarker: lines.some(line => hasSolutionMarker(line)),
      };
    }
  }
  return { none: 'NO_STRUCTURE' };
}

/** Component number, split and letter from a heading key. */
function partsOfKey(
  docType: Found['docType'],
  key: string | null
): { number: number | null; split: number | null; letter: string | null } {
  const blank = { number: null, split: null, letter: null };
  if (!key) return blank;
  if (docType === 'global_quiz') {
    const m = COMPONENT_KEY.exec(key);
    return m
      ? {
          number: Number(m[1]),
          split: m[2] ? Number(m[2]) : null,
          letter: null,
        }
      : blank;
  }
  const m = ENABLER_KEY.exec(key);
  return m
    ? {
        number: Number(m[1]),
        split: m[2] ? Number(m[2]) : null,
        letter: m[3].toLowerCase(),
      }
    : blank;
}

function toMatch(
  found: Found,
  pdf: boolean,
  skipped: number,
  truncated: boolean
): ContentMatch {
  const parts = partsOfKey(found.docType, found.headingKey);
  return {
    kind: 'match',
    docType: pdf ? 'pdf_original' : found.docType,
    originalType: pdf ? found.docType : null,
    headingKey: found.headingKey,
    componentNumber: parts.number,
    componentSplit: parts.split,
    enablerLetter: parts.letter,
    quizLevel: found.quizLevel,
    headingVariant: found.headingVariant,
    parserErrors: found.parserErrors,
    parserWarnings: found.parserWarnings,
    signals: found.signals,
    skippedLeadingLines: skipped,
    truncated,
    solutionMarker: found.solutionMarker,
  };
}

/**
 * Type, component, enabler and level of a document from its paragraphs. Never
 * throws.
 */
export function classifyByContent(
  input: ReadonlyArray<Paragraph>,
  options: ClassifyContentOptions = {}
): ContentResult {
  const { paragraphs, truncated } = prepare(input);
  const pdf = options.format === 'pdf';

  if (!pdf) {
    const found = recognize(paragraphs);
    if ('none' in found) {
      return { kind: 'none', reason: found.none, truncated };
    }
    return toMatch(found, false, 0, truncated);
  }

  // A PDF: the heading may come after a few header lines. The first line from
  // which on a document with a code is recognized is the start.
  const starts: number[] = [];
  paragraphs.forEach((p, index) => {
    if (p.text.length > 0 && starts.length <= MAX_LEADING_LINES) {
      starts.push(index);
    }
  });
  let fallback: { found: Found; skipped: number } | null = null;
  let last: ContentNone | null = null;
  for (let offset = 0; offset < starts.length; offset += 1) {
    const found = recognize(paragraphs.slice(starts[offset]));
    if ('none' in found) {
      if (offset === 0 || last === null) {
        last = { kind: 'none', reason: found.none, truncated };
      }
      continue;
    }
    if (found.headingKey !== null) {
      return toMatch(found, true, offset, truncated);
    }
    fallback ??= { found, skipped: offset };
  }
  if (fallback)
    return toMatch(fallback.found, true, fallback.skipped, truncated);
  return (
    last ?? {
      kind: 'none',
      reason: paragraphs.some(p => p.text.length > 0)
        ? 'NO_STRUCTURE'
        : 'NO_TEXT',
      truncated,
    }
  );
}
