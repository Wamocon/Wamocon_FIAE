// Excerpt of a document: the only thing that may leave the platform
// (docs/ki-upload-konzept.md, 5.3, 6.4 and 6.5). Pure function, no file system,
// no database, no network, no model.
//
// What an excerpt is: at most 2500 characters, built from a POSITIVE list of the
// parts a document type allows (heading, difficulty, the first three questions
// without options, the starting situation of a scenario, the topics and the
// objective of a use case, the headings and the first 1200 characters of an
// enabler text). The file name is not an input, so it cannot be in the result.
// Solution parts (correct answer, rationale, solution scenario, model solution,
// criteria) are never part of the list.
//
// The checks run in this order (the cleaning first, see text-clean.ts):
//   1. clean every paragraph: NFKC, no invisible characters, one kind of line break
//   2. signs of a customer document in the whole text
//   3. recognize the type of the document with the parsers of the import. For a
//      known type the trainee view (toTraineeQuiz, toTraineeScenario,
//      toTraineeUseCase) is the cross check: when it refuses the file, nothing
//      is sent
//   4. gather the candidate lines from the positive list, as WHOLE lines
//   5. check every whole line: marker words of a solution, texts of solutions
//      (the own ones and the ones of other files and of the database), personal
//      patterns are replaced. Then the same on the joined lines, because a text
//      can be spread over two lines
//   6. only then cut: first the caps of the parts, then the limit of the
//      excerpt. A cut AFTER the check cannot leave a piece of a solution: the
//      line was clean as a whole, and so is every start of it. (A cut BEFORE the
//      check would leave a start of a solution that the check no longer finds.)
//   7. instruction text for a model, and the checks of 5 once more on the exact
//      string that would be sent
// A hard block ends with an empty excerpt, so no code path can send it by
// accident. A file of unknown structure keeps its excerpt (the person may look
// at it and choose to send it) but is not sendable without an opt in.

import {
  toTraineeQuiz,
  toTraineeScenario,
  parseQuizText,
  parseScenarioText,
} from '../content-import/source-parsers';
import { splitEnablerHeading } from '../content-import/apply/plan';
import { leakOf } from '../content-import/apply/guard';
import type { Paragraph } from '../content-import/types';
import {
  parseUseCaseText,
  toTraineeUseCase,
} from '../content-import/use-cases/parser';

import { finding, type Finding } from './findings';
import { EXCERPT_MAX_CHARS } from './limits';
import {
  customerDocumentClasses,
  findInstructionText,
  hasSolutionMarker,
  isOwnLetterheadLine,
  redactPersonalData,
} from './patterns';
import { foldConfusables, sanitizeExcerptText } from './text-clean';

export type ExcerptDocType =
  | 'enabler'
  | 'quiz'
  | 'global_quiz'
  | 'scenario'
  | 'use_case'
  | 'unknown';

export type ExcerptReason =
  | 'OK'
  | 'NO_TEXT'
  | 'EMPTY_EXCERPT'
  | 'STRUCTURE_UNKNOWN'
  | 'QUESTION_FORMAT'
  | 'PARSER_REFUSED'
  | 'GUARD_REFUSED'
  | 'INSTRUCTION_TEXT'
  | 'PII_THRESHOLD'
  | 'CUSTOMER_DOCUMENT';

export interface BuildExcerptInput {
  paragraphs: readonly Paragraph[];
  /**
   * Solution texts that stand elsewhere (other files of the run, the target
   * database). They are only searched for, never sent. Pass the same array for
   * every file of a run, its index is built once.
   */
  knownSolutions?: readonly string[];
  /** The person chose to send a file of unknown structure. */
  optIn?: boolean;
  /** Limit in characters, never above 2500. */
  maxChars?: number;
}

export interface ExcerptResult {
  /** What would be sent. Empty when a hard block applies. */
  excerpt: string;
  /** Codes and fixed messages, never text of the document. */
  findings: Finding[];
  sendable: boolean;
  reason: ExcerptReason;
  docType: ExcerptDocType;
  /** Placeholders in the excerpt (personal data, links, file names). */
  redactions: number;
}

/** Caps of single lines, characters. */
const LINE_CAPS = { title: 200, heading: 120, question: 300 };
/** Caps of the parts, characters (lines and the line breaks between them). */
const GROUP_CAPS = {
  headings: 1000,
  body: 1200,
  situation: 1000,
  topics: 600,
  objective: 400,
};
type Group = keyof typeof GROUP_CAPS;
const MAX_HEADINGS = 20;
const QUESTIONS = 3;
/** Work limits against a hostile file. */
const MAX_PARAGRAPHS = 5000;
const MAX_PARAGRAPH_CHARS = 20000;
const MAX_FULL_TEXT_CHARS = 400000;
/** Personal placeholders above this number keep a file from the model. */
const PII_LIMIT = 3;
/** Hits of markers and solution texts above this number refuse the file. */
const GUARD_LIMIT = 1;
const MIN_ENABLER_CHARS = 300;

// --- small helpers --------------------------------------------------------------

/** Cuts to a length without splitting a surrogate pair. */
function cut(text: string, max: number): string {
  if (text.length <= max) return text;
  let end = Math.max(0, max);
  const last = text.charCodeAt(end - 1);
  if (last >= 0xd800 && last <= 0xdbff) end -= 1;
  return text.slice(0, end).trimEnd();
}

const collapse = (text: string) => text.replace(/\s+/g, ' ').trim();

/** Lines of a text, no empty ones, white space collapsed. */
const linesOf = (text: string) =>
  text
    .split('\n')
    .map(collapse)
    .filter(line => line.length > 0);

/** Text from a PDF or any plain text as paragraphs (nothing is bold). */
export function paragraphsFromText(text: string): Paragraph[] {
  return text.split(/\r?\n/).map(line => ({ text: line, bold: false }));
}

/**
 * The whole lines up to the point where twice the cap is reached. The caps cut
 * AFTER the check (see above), so the check needs the whole lines, and twice
 * the cap leaves room for lines that the check removes.
 */
function wholeLines(lines: string[], cap: number): string[] {
  const out: string[] = [];
  let used = 0;
  for (const line of lines) {
    out.push(line);
    used += line.length + 1;
    if (used >= cap * 2) break;
  }
  return out;
}

// --- the checks of the lines ------------------------------------------------

interface ProtectContext {
  /** Solution texts of the document itself. */
  solutions: readonly string[];
  /** Solution texts that stand elsewhere. */
  known?: readonly string[];
}

export interface Protected {
  /** The lines that were kept, personal patterns replaced. */
  lines: string[];
  markerHits: number;
  leakHits: number;
  /** A marker or a solution text only shows up when the kept lines are joined. */
  crossHit: boolean;
  personal: number;
  other: number;
  instruction: string[];
}

// Keyed by the array of the caller, which may grow between two files: the entry
// is only used for the length it was built for. (The index of leakOf in guard.ts
// is keyed by the array that this function returns, so a new array means a new
// index.)
const foldedCache = new WeakMap<
  readonly string[],
  { length: number; folded: string[] }
>();
function folded(solutions: readonly string[] | undefined): string[] {
  if (!solutions || solutions.length === 0) return [];
  const known = foldedCache.get(solutions);
  if (known && known.length === solutions.length) return known.folded;
  const result = solutions.map(solution =>
    foldConfusables(sanitizeExcerptText(solution))
  );
  foldedCache.set(solutions, { length: solutions.length, folded: result });
  return result;
}

interface Line {
  text: string;
  /** Cap of this line, applied after the checks. */
  cap?: number;
  /** The part the line belongs to, its cap is applied after the checks. */
  group?: Group;
}

interface Checked {
  lines: Line[];
  markerHits: number;
  leakHits: number;
  crossHit: boolean;
  personal: number;
  other: number;
}

/** Checks whole lines. A line with a marker or a solution text is cut out. */
function checkLines(lines: readonly Line[], context: ProtectContext): Checked {
  const own = folded(context.solutions);
  const known = folded(context.known);
  const hasLeak = (probe: string) =>
    (own.length > 0 && leakOf(probe, own) !== null) ||
    (known.length > 0 && leakOf(probe, known) !== null);
  const kept: Line[] = [];
  let markerHits = 0;
  let leakHits = 0;
  let personal = 0;
  let other = 0;
  for (const line of lines) {
    if (hasSolutionMarker(line.text)) {
      markerHits += 1;
      continue;
    }
    if (hasLeak(foldConfusables(line.text))) {
      leakHits += 1;
      continue;
    }
    const redacted = redactPersonalData(line.text);
    personal += redacted.personal;
    other += redacted.other;
    kept.push({ ...line, text: redacted.text });
  }
  // A text can be spread over two lines (a soft line break in the source).
  const joined = kept.map(line => line.text);
  const crossHit =
    hasSolutionMarker(joined.join('\n')) ||
    hasLeak(foldConfusables(joined.join(' ')));
  return { lines: kept, markerHits, leakHits, crossHit, personal, other };
}

/**
 * The checks of the lines of an excerpt: a line with a marker word of a
 * solution or with a solution text is cut out, personal patterns are replaced,
 * instruction text is reported. Used on the final text again, and by the
 * tests.
 */
export function protectExcerptLines(
  lines: readonly string[],
  context: ProtectContext
): Protected {
  const checked = checkLines(
    lines.map(text => ({ text })),
    context
  );
  const kept = checked.lines.map(line => line.text);
  return {
    lines: kept,
    markerHits: checked.markerHits,
    leakHits: checked.leakHits,
    crossHit: checked.crossHit,
    personal: checked.personal,
    other: checked.other,
    instruction: findInstructionText(kept.join('\n')),
  };
}

/** Caps of single lines and of the parts, after the checks. */
function applyCaps(lines: readonly Line[]): string[] {
  const room: Record<Group, number> = { ...GROUP_CAPS };
  const out: string[] = [];
  for (const line of lines) {
    let text = line.cap === undefined ? line.text : cut(line.text, line.cap);
    if (line.group) {
      if (room[line.group] <= 0) continue;
      text = cut(text, room[line.group]);
      room[line.group] -= text.length + 1;
    }
    if (text.length > 0) out.push(text);
  }
  return out;
}

/** Placeholders of the replacements that are in a text. */
const PLACEHOLDER = /\[(E-Mail|IBAN|Telefon|Steuer-ID|Name|Link|Datei)\]/g;
const PERSONAL_PLACEHOLDER = /\[(?:E-Mail|IBAN|Telefon|Steuer-ID|Name)\]/g;

// --- recognizing the type -------------------------------------------------------

const USE_CASE_HEADING =
  /^(?:Behandelte\s+Themen|Zielsetzung|Weg\s+zum\s+Ziel|Musterl(?:ö|oe)sung|Bewertungskriterien)\s*:?$/i;
const SITUATION_HEADING = /^Ausgangssituation\s*:?$/i;
const SOLUTION_HEADING =
  /^(?:L(?:ö|oe)sung(?:s?szenario)?|Wie das Fachwissen zur L(?:ö|oe)sung beitr(?:ä|ae)gt)\s*:?$/i;
const GLOBAL_MARK = /^Global[\s-]*Quiz\b/i;
const OPTION_LINE = /^[A-D]\)\s/;
const ANSWER_LINE = /^Richtige\s+Antwort\b/i;
/** A line that begins a solution part in a document of unknown structure. */
const SOLUTION_START =
  /^(?:L(?:ö|oe)sung|Musterl(?:ö|oe)sung|Bewertungskriterien|Antwortschl(?:ü|ue)ssel|Korrekte\s+Antwort|L(?:ö|oe)sungsvorschlag)\b/i;

type Kind = 'quiz' | 'use_case' | 'scenario' | 'enabler' | 'unknown';

function recognize(
  paragraphs: readonly Paragraph[],
  lines: string[]
): { kind: Kind; global: boolean } {
  const second = lines[1] ?? '';
  const third = lines[2] ?? '';
  const global =
    GLOBAL_MARK.test(second) ||
    (/^\(§[^)]*\)$/.test(second) && GLOBAL_MARK.test(third));
  const answers = lines.filter(line => ANSWER_LINE.test(line)).length;
  const difficulty = lines
    .slice(0, 4)
    .some(line => /^Quiz\b.*Schwierigkeitsgrad/i.test(line));
  if (global || answers > 0 || difficulty) return { kind: 'quiz', global };
  const no = { global: false };
  if (lines.filter(line => USE_CASE_HEADING.test(line)).length >= 2) {
    return { kind: 'use_case', ...no };
  }
  if (
    /^Szenario\b/i.test(lines[0] ?? '') ||
    (lines.some(line => SITUATION_HEADING.test(line)) &&
      lines.some(line => SOLUTION_HEADING.test(line)))
  ) {
    return { kind: 'scenario', ...no };
  }
  const first = lines[0] ?? '';
  if (
    !/^(?:Szenario|Quiz)\b/i.test(first) &&
    splitEnablerHeading(first).code !== null
  ) {
    const body = paragraphs
      .slice(1)
      .reduce((sum, paragraph) => sum + paragraph.text.length, 0);
    if (body >= MIN_ENABLER_CHARS) return { kind: 'enabler', ...no };
  }
  return { kind: 'unknown', ...no };
}

// --- the candidate lines per type -------------------------------------------

interface Parts {
  lines: Line[];
  solutions: string[];
  refused: boolean;
  /** Issue codes of a refusing parser, for the finding. */
  issues: string[];
  docType: ExcerptDocType;
  /** The text was cut at the first line that begins a solution part. */
  cut?: boolean;
}

const DIFFICULTY_LABEL: Record<string, string> = {
  low: 'leicht',
  medium: 'mittel',
  high: 'anspruchsvoll',
  mixed: 'gemischt',
};

const errorCodes = (
  issues: ReadonlyArray<{ severity: string; code: string }>
) => [...new Set(issues.filter(i => i.severity === 'error').map(i => i.code))];

const titleLine = (paragraphs: readonly Paragraph[]): Line => ({
  text: linesOf(paragraphs.find(p => p.text.trim())?.text ?? '')[0] ?? '',
  cap: LINE_CAPS.title,
});

function quizParts(paragraphs: readonly Paragraph[], global: boolean): Parts {
  const parsed = parseQuizText(paragraphs, {
    expectedQuestions: global ? 20 : undefined,
  });
  const quiz = parsed.value;
  const docType: ExcerptDocType =
    quiz.kind === 'global' ? 'global_quiz' : 'quiz';
  const view = toTraineeQuiz(parsed);
  const solutions: string[] = [];
  for (const question of quiz.questions) {
    if (question.rationale) solutions.push(question.rationale);
    for (const option of question.options) {
      if (question.correctLetter?.includes(option.letter)) {
        solutions.push(option.text);
      }
    }
  }
  if (!view) {
    return {
      lines: [],
      solutions,
      refused: true,
      issues: errorCodes(parsed.issues),
      docType,
    };
  }
  const lines: Line[] = [titleLine(paragraphs)];
  if (quiz.kind === 'global') lines.push({ text: 'Global Quiz' });
  else if (quiz.difficulty) {
    const label = DIFFICULTY_LABEL[quiz.difficulty] ?? quiz.difficulty;
    lines.push({ text: `Quiz, Schwierigkeitsgrad: ${label}` });
  }
  for (const question of view.questions.slice(0, QUESTIONS)) {
    const prefix = `Frage ${question.number}: `;
    lines.push({
      text: prefix + collapse(question.text),
      cap: prefix.length + LINE_CAPS.question,
    });
  }
  return { lines, solutions, refused: false, issues: [], docType };
}

const grouped = (lines: string[], group: Group): Line[] =>
  wholeLines(lines, GROUP_CAPS[group]).map(text => ({ text, group }));

function scenarioParts(paragraphs: readonly Paragraph[]): Parts {
  const parsed = parseScenarioText(paragraphs);
  const view = toTraineeScenario(parsed);
  const solutions = [
    parsed.value.solution,
    parsed.value.knowledgeContribution,
  ].filter(Boolean);
  if (!view) {
    return {
      lines: [],
      solutions,
      refused: true,
      issues: errorCodes(parsed.issues),
      docType: 'scenario',
    };
  }
  return {
    lines: [
      titleLine(paragraphs),
      { text: 'Ausgangssituation' },
      ...grouped(linesOf(view.situation), 'situation'),
    ],
    solutions,
    refused: false,
    issues: [],
    docType: 'scenario',
  };
}

function partsOfUseCase(paragraphs: readonly Paragraph[]): Parts {
  const parsed = parseUseCaseText(paragraphs);
  const view = toTraineeUseCase(parsed);
  const solutions = [parsed.value.solution, parsed.value.criteria].filter(
    Boolean
  );
  if (!view) {
    return {
      lines: [],
      solutions,
      refused: true,
      issues: errorCodes(parsed.issues),
      docType: 'use_case',
    };
  }
  const lines: Line[] = [titleLine(paragraphs)];
  const topics = linesOf(view.topics);
  if (topics.length > 0) {
    lines.push({ text: 'Behandelte Themen' }, ...grouped(topics, 'topics'));
  }
  const objective = linesOf(view.objective);
  if (objective.length > 0) {
    lines.push({ text: 'Zielsetzung' }, ...grouped(objective, 'objective'));
  }
  return { lines, solutions, refused: false, issues: [], docType: 'use_case' };
}

/** Short bold lines outside of tables: the headings of a text. */
function headingLines(paragraphs: readonly Paragraph[]): Line[] {
  const out: Line[] = [];
  for (const paragraph of paragraphs) {
    if (out.length >= MAX_HEADINGS) break;
    if (!paragraph.bold || paragraph.row !== undefined) continue;
    const text = collapse(paragraph.text);
    // a bold line like "Antwort: B" or "Quelle: ..." is a label with a value,
    // no heading, and a long bold line is a paragraph
    if (text.length === 0 || text.length > LINE_CAPS.heading) continue;
    if (/^[^:]{1,30}:\s*\S/.test(text)) continue;
    out.push({ text, cap: LINE_CAPS.heading, group: 'headings' });
  }
  return out;
}

function enablerParts(all: readonly Paragraph[]): Parts {
  // Everything from the first line that begins a solution part is cut off.
  const end = all.findIndex(p =>
    linesOf(p.text).some(line => SOLUTION_START.test(line))
  );
  const paragraphs = end < 0 ? all : all.slice(0, end);
  const rest = paragraphs.slice(paragraphs.findIndex(p => p.text.trim()) + 1);
  const body = rest
    .filter(p => !p.bold && p.row === undefined)
    .flatMap(p => linesOf(p.text));
  return {
    lines: [
      titleLine(paragraphs),
      ...headingLines(rest),
      ...grouped(body, 'body'),
    ],
    solutions: [],
    refused: false,
    issues: [],
    docType: 'enabler',
    cut: end >= 0,
  };
}

function unknownParts(paragraphs: readonly Paragraph[]): Parts {
  // Everything from the first line that begins a solution part is cut off.
  const end = paragraphs.findIndex(p =>
    linesOf(p.text).some(line => SOLUTION_START.test(line))
  );
  const before = end < 0 ? paragraphs : paragraphs.slice(0, end);
  const first = before.findIndex(p => p.text.trim());
  return {
    lines:
      first < 0
        ? []
        : [titleLine(before), ...headingLines(before.slice(first + 1))],
    solutions: [],
    refused: false,
    issues: [],
    docType: 'unknown',
    cut: end >= 0,
  };
}

// --- the excerpt -------------------------------------------------------------

/** Step 1 of the excerpt: every paragraph cleaned, with limits on the work. */
function cleanParagraphs(input: readonly Paragraph[]): {
  paragraphs: Paragraph[];
  truncated: boolean;
} {
  let truncated = input.length > MAX_PARAGRAPHS;
  let budget = MAX_FULL_TEXT_CHARS;
  const paragraphs: Paragraph[] = input
    .slice(0, MAX_PARAGRAPHS)
    .map(paragraph => {
      const raw = String(paragraph.text ?? '');
      if (raw.length > MAX_PARAGRAPH_CHARS) truncated = true;
      // the work on the text has a total budget, whatever the caller passes
      const take = raw.slice(
        0,
        Math.min(MAX_PARAGRAPH_CHARS, Math.max(0, budget))
      );
      if (take.length < raw.length) truncated = true;
      budget -= take.length;
      return {
        ...paragraph,
        text: sanitizeExcerptText(take),
      };
    })
    // the page header of an own PDF is no part of the text
    .filter(paragraph => !isOwnLetterheadLine(paragraph.text));
  return { paragraphs, truncated };
}

/**
 * The solution texts a document names (rationales, the text of the correct
 * option, the solution and the knowledge text of a scenario, the solution and the
 * criteria of a use case), cleaned like the lines of an excerpt. They are only
 * searched for in the excerpts of OTHER files, never sent. Also for a file that
 * a parser refuses: its solutions can still stand in another file.
 */
export function solutionTextsOf(input: readonly Paragraph[]): string[] {
  const { paragraphs } = cleanParagraphs(input);
  const lines = paragraphs.flatMap(p => linesOf(p.text));
  if (lines.length === 0) return [];
  const { kind, global } = recognize(paragraphs, lines);
  if (kind === 'quiz') return quizParts(paragraphs, global).solutions;
  if (kind === 'scenario') return scenarioParts(paragraphs).solutions;
  if (kind === 'use_case') return partsOfUseCase(paragraphs).solutions;
  return [];
}

const nothing = (
  findings: Finding[],
  reason: ExcerptReason,
  docType: ExcerptDocType = 'unknown'
): ExcerptResult => ({
  excerpt: '',
  findings,
  sendable: false,
  reason,
  docType,
  redactions: 0,
});

/**
 * Builds the excerpt of a document. Never throws. The result says whether it
 * may be sent and why not, and lists the findings (codes, no content).
 */
export function buildExcerpt(input: BuildExcerptInput): ExcerptResult {
  const findings: Finding[] = [];
  const maxChars = Math.max(
    0,
    Math.min(EXCERPT_MAX_CHARS, Math.floor(input.maxChars ?? EXCERPT_MAX_CHARS))
  );

  // 1. clean every paragraph, with limits on the work
  const { paragraphs, truncated } = cleanParagraphs(input.paragraphs);
  if (truncated) {
    findings.push(
      finding(
        'INPUT_TRUNCATED',
        'info',
        'A very long document was cut before it was checked.'
      )
    );
  }
  const lines = paragraphs.flatMap(p => linesOf(p.text));
  if (lines.length === 0) {
    findings.push(finding('NO_TEXT', 'blocking', 'The document has no text.'));
    return nothing(findings, 'NO_TEXT');
  }

  // 2. signs of a customer document, in the whole text
  const classes = customerDocumentClasses(
    paragraphs
      .map(p => p.text)
      .join('\n')
      .slice(0, MAX_FULL_TEXT_CHARS)
  );
  const customer = classes.length >= 2;
  if (customer) {
    findings.push(
      finding(
        'CUSTOMER_DOCUMENT',
        'blocking',
        'The document shows several signs of a customer document.',
        classes.length
      )
    );
  } else if (classes.length === 1) {
    findings.push(
      finding(
        'CUSTOMER_PATTERN',
        'warning',
        'The document shows a sign of a customer document.',
        1
      )
    );
  }

  // 3. recognize the type, 4. gather the candidate lines
  const { kind, global } = recognize(paragraphs, lines);
  let questionFormat = false;
  let parts: Parts;
  if (kind === 'quiz') parts = quizParts(paragraphs, global);
  else if (kind === 'scenario') parts = scenarioParts(paragraphs);
  else if (kind === 'use_case') parts = partsOfUseCase(paragraphs);
  else if (kind === 'enabler') parts = enablerParts(paragraphs);
  else parts = unknownParts(paragraphs);
  // Lines with options A) to D) are the format of a question. Only a recognized
  // quiz may have them. In an enabler text or a file of unknown structure they
  // mean that the solution of a question stands next to them.
  if (kind === 'enabler' || kind === 'unknown') {
    questionFormat = lines.filter(line => OPTION_LINE.test(line)).length >= 3;
  }
  if (parts.refused) {
    findings.push(
      finding(
        'PARSER_REFUSED',
        'blocking',
        `The parser refuses the file: ${
          parts.issues.join(', ') || 'a solution marker in a visible part'
        }.`
      )
    );
  }
  if (questionFormat) {
    findings.push(
      finding(
        'QUESTION_FORMAT',
        'blocking',
        'The file has the format of a question with options and is never sent.'
      )
    );
  }
  if (parts.cut) {
    findings.push(
      finding(
        'SOLUTION_CUT',
        'warning',
        'The text was cut at the first line that begins a solution part.'
      )
    );
  }
  if (parts.docType === 'unknown') {
    findings.push(
      finding(
        'STRUCTURE_UNKNOWN',
        'info',
        'The structure is not known. The excerpt is only sent after an explicit choice.'
      )
    );
  }

  // 5. check the whole lines
  const context = { solutions: parts.solutions, known: input.knownSolutions };
  const checked: Checked =
    parts.refused || questionFormat
      ? {
          lines: [],
          markerHits: 0,
          leakHits: 0,
          crossHit: false,
          personal: 0,
          other: 0,
        }
      : checkLines(parts.lines, context);
  const hits = checked.markerHits + checked.leakHits;
  // No parser names the solution parts of an enabler text or of a file of
  // unknown structure, so the marker words are all that protect them: a marker
  // there may stand in front of the solution, and cutting the line is not
  // enough (the lines after it would stay). Such a file is refused.
  const unparsed = kind === 'enabler' || kind === 'unknown';
  const guardRefused =
    hits > GUARD_LIMIT ||
    checked.crossHit ||
    (unparsed && checked.markerHits > 0);
  if (guardRefused) {
    findings.push(
      finding(
        'GUARD_REFUSED',
        'blocking',
        checked.crossHit && hits <= GUARD_LIMIT
          ? 'A marker word or a solution text shows up across two lines.'
          : unparsed && checked.markerHits === 1 && hits === 1
            ? 'A marker word of a solution stands in a file without a known structure.'
            : 'Marker words or texts of solutions were found more than once.',
        hits
      )
    );
  } else {
    if (checked.markerHits > 0) {
      findings.push(
        finding(
          'MARKER_REMOVED',
          'warning',
          'A line with a marker word of a solution was cut out.',
          checked.markerHits
        )
      );
    }
    if (checked.leakHits > 0) {
      findings.push(
        finding(
          'LEAK_REMOVED',
          'warning',
          'A line with a solution text was cut out.',
          checked.leakHits
        )
      );
    }
  }

  // 6. cut: the caps of the parts, then the limit of the excerpt
  const text = cut(applyCaps(checked.lines).join('\n'), maxChars);

  // 7. what is left of the excerpt: personal placeholders, instruction text
  const placeholders = (text.match(PLACEHOLDER) ?? []).length;
  const personal = (text.match(PERSONAL_PLACEHOLDER) ?? []).length;
  if (placeholders > 0) {
    findings.push(
      finding(
        'PII_REDACTED',
        'info',
        'Personal patterns, links or file names were replaced.',
        placeholders
      )
    );
  }
  const piiBlocked = personal > PII_LIMIT;
  if (piiBlocked) {
    findings.push(
      finding(
        'PII_THRESHOLD',
        'blocking',
        'The excerpt holds too many personal patterns.',
        personal
      )
    );
  }
  const instruction = findInstructionText(text);
  if (instruction.length > 0) {
    findings.push(
      finding(
        'INSTRUCTION_TEXT',
        'blocking',
        'The excerpt holds wording that speaks to a model.',
        instruction.length
      )
    );
  }

  // The reason, in the order of the weight of the block
  const reason: ExcerptReason | null = customer
    ? 'CUSTOMER_DOCUMENT'
    : questionFormat
      ? 'QUESTION_FORMAT'
      : parts.refused
        ? 'PARSER_REFUSED'
        : guardRefused
          ? 'GUARD_REFUSED'
          : instruction.length > 0
            ? 'INSTRUCTION_TEXT'
            : piiBlocked
              ? 'PII_THRESHOLD'
              : null;
  if (reason) return nothing(findings, reason, parts.docType);

  // The exact string that would be sent, checked once more
  const final = protectExcerptLines(linesOf(text), context);
  if (final.markerHits + final.leakHits > 0 || final.crossHit) {
    findings.push(
      finding(
        'FINAL_CHECK_FAILED',
        'blocking',
        'The final check of the excerpt found something that the first check let pass.'
      )
    );
    return nothing(findings, 'GUARD_REFUSED', parts.docType);
  }
  const excerpt = final.lines.join('\n');
  if (excerpt.length === 0) {
    findings.push(
      finding(
        'EMPTY_EXCERPT',
        'blocking',
        'Nothing of the document may be sent.'
      )
    );
    return nothing(findings, 'EMPTY_EXCERPT', parts.docType);
  }
  const unknownStructure = parts.docType === 'unknown' && !input.optIn;
  return {
    excerpt,
    findings,
    sendable: !unknownStructure,
    reason: unknownStructure ? 'STRUCTURE_UNKNOWN' : 'OK',
    docType: parts.docType,
    redactions: placeholders,
  };
}
