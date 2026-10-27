// Reader of a quiz JSON file from its bytes (package UP2 of docs/ki-upload-konzept.md).
//
// Pure: no file system, no database, no network. The answer is either a refusal with a
// stable code or the strict reading of src/lib/content-import/quiz-json (schema 1.0),
// never an exception.
//
// The checks run in this order, the cheap ones first:
//   1. size of the input (32 MB, as the import script)
//   2. a linear scan of the bytes for the shape of the nesting: JSON.parse of a file of
//      32 MB made of brackets or of empty objects costs seconds and about a gigabyte,
//      so a depth above 16 (the schema needs 9) or more than a million objects and lists
//      is refused BEFORE anything is decoded or parsed
//   3. valid UTF-8 (a file with a byte that is no UTF-8 is refused, nothing is
//      repaired or replaced), one optional byte order mark is dropped
//   4. valid JSON, one object (no array, no scalar)
//   5. the head: schema_version 1.0 and a list quizzes
//   6. the kind is read from the CONTENT of the head, never from the file name: the
//      enabler quizzes carry difficulty_levels in the head and difficulties in every
//      quiz, the global quizzes carry questions in every quiz
//   7. the strict reader of the import (unknown field, id, answer, option count,
//      limits of size and number). A file whose structure it refuses (fatal) is refused
//      here too, with the codes of its findings
//
// What leaves this module for the review list and the file row is a SUMMARY: counts,
// component codes and finding codes. The reading itself holds the questions and the
// correct answers (the transfer needs them for the options), so it is only ever handed
// to the plan builder on the server. The excerpt for the model is never made from a
// JSON file: it holds solutions (decision O13), see ki/steps.ts.

import {
  readGlobalQuizzes,
  readLessonQuizzes,
} from '../content-import/quiz-json/read';
import type {
  QuizJsonOptions,
  QuizJsonRead,
} from '../content-import/quiz-json/types';

import { maxFileBytesFor } from './staging/config';

export type QuizJsonKind = 'lesson' | 'global';

export type JsonRefusalCode =
  | 'TOO_LARGE'
  | 'NOT_UTF8'
  | 'TOO_COMPLEX'
  | 'READ_ERROR'
  | 'NOT_JSON'
  | 'NOT_AN_OBJECT'
  | 'NOT_QUIZ_JSON'
  | 'SCHEMA_VERSION'
  | 'KIND_UNKNOWN'
  | 'SCHEMA_REFUSED'
  | 'NO_QUIZ';

/** What the review list and the file row may hold about a quiz file: numbers and codes. */
export interface QuizJsonSummary {
  kind: QuizJsonKind;
  /** Entries of the quiz list. */
  quizzes: number;
  /** Quiz levels (lesson quizzes) or global quizzes that the reader could build. */
  sets: number;
  questions: number;
  /** Sets with at least one error: the planner skips them. */
  setsWithErrors: number;
  errors: number;
  warnings: number;
  /** Quizzes that have no content key at all (skipped by the planner). */
  unmapped: number;
  /** Component codes of the sets, sorted, at most 60. */
  components: string[];
  /** Codes of the ERRORS only (a hint never crowds one out), unique, at most 20. */
  errorCodes: string[];
  /** Codes of the findings, unique, at most 20. */
  findingCodes: string[];
}

export type ReadQuizJsonResult =
  | {
      status: 'ok';
      kind: QuizJsonKind;
      /** The full reading. Server side only, never stored, never shown, never sent. */
      read: QuizJsonRead;
      summary: QuizJsonSummary;
    }
  | { status: 'rejected'; code: JsonRefusalCode; findingCodes: string[] };

export interface ReadQuizJsonOptions extends QuizJsonOptions {
  /** Largest input in bytes (default: the limit of the kind json). */
  maxBytes?: number;
}

const MAX_CODES = 20;

/** Limits of the shape of a quiz file (the schema needs a depth of 9 and some 20 thousand containers). */
export const JSON_SHAPE_LIMITS = Object.freeze({
  maxDepth: 16,
  maxContainers: 1_000_000,
});

/**
 * Whether the nesting of the bytes is too deep or has too many objects and lists. One pass,
 * string and escape aware (the bytes of a quote, a backslash or a bracket never occur inside
 * a multi byte character of UTF-8). Unbalanced brackets are left to the parser.
 */
export function isTooComplex(bytes: Uint8Array): boolean {
  let depth = 0;
  let containers = 0;
  let inString = false;
  let escaped = false;
  for (let i = 0; i < bytes.length; i += 1) {
    const c = bytes[i];
    if (inString) {
      if (escaped) escaped = false;
      else if (c === 0x5c) escaped = true;
      else if (c === 0x22) inString = false;
      continue;
    }
    if (c === 0x22) inString = true;
    else if (c === 0x7b || c === 0x5b) {
      depth += 1;
      containers += 1;
      if (
        depth > JSON_SHAPE_LIMITS.maxDepth ||
        containers > JSON_SHAPE_LIMITS.maxContainers
      ) {
        return true;
      }
    } else if (c === 0x7d || c === 0x5d) depth -= 1;
  }
  return false;
}
const MAX_COMPONENTS = 60;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const hasOwn = (object: Record<string, unknown>, key: string) =>
  Object.prototype.hasOwnProperty.call(object, key);

const refused = (
  code: JsonRefusalCode,
  findingCodes: string[] = []
): ReadQuizJsonResult => ({ status: 'rejected', code, findingCodes });

/**
 * The kind of a quiz file from the content of its head: `lesson` for the enabler quizzes,
 * `global` for the global quizzes, null when the head says nothing or says both.
 */
export function detectQuizJsonKind(raw: unknown): QuizJsonKind | null {
  if (!isRecord(raw)) return null;
  const quizzes = hasOwn(raw, 'quizzes') ? raw.quizzes : undefined;
  let lesson = hasOwn(raw, 'difficulty_levels');
  let global = false;
  if (Array.isArray(quizzes)) {
    // The first entry that is an object decides, the reader names every other entry that
    // does not fit as an error of its own
    const first = quizzes.find(isRecord);
    if (first) {
      if (hasOwn(first, 'difficulties')) lesson = true;
      if (hasOwn(first, 'questions')) global = true;
    }
  }
  if (lesson === global) return null;
  return lesson ? 'lesson' : 'global';
}

/** The text of the bytes as UTF-8 without a byte order mark, or null when it is no UTF-8. */
function decodeUtf8(bytes: Uint8Array): string | null {
  try {
    // fatal: an invalid sequence throws instead of becoming U+FFFD; the decoder drops
    // one leading byte order mark (ignoreBOM is false)
    return new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  } catch {
    return null;
  }
}

function summarize(kind: QuizJsonKind, read: QuizJsonRead): QuizJsonSummary {
  const codes = new Set<string>();
  const errorCodes = new Set<string>();
  let errors = 0;
  let warnings = 0;
  for (const finding of read.findings) {
    if (finding.severity === 'error') {
      errors += 1;
      if (errorCodes.size < MAX_CODES) errorCodes.add(finding.code);
    } else warnings += 1;
  }
  // errors first: a hint never takes the place of the code of an error
  for (const code of errorCodes) codes.add(code);
  for (const finding of read.findings) {
    if (codes.size >= MAX_CODES) break;
    codes.add(finding.code);
  }
  const components = new Set<string>();
  let questions = 0;
  let setsWithErrors = 0;
  for (const set of read.sets) {
    questions += set.questions;
    if (set.errors > 0) setsWithErrors += 1;
    if (set.componentCode) components.add(set.componentCode);
  }
  return {
    kind,
    quizzes: read.quizzes,
    sets: read.sets.length,
    questions,
    setsWithErrors,
    errors,
    warnings,
    unmapped: read.unmapped.length,
    components: [...components].sort().slice(0, MAX_COMPONENTS),
    errorCodes: [...errorCodes].sort(),
    findingCodes: [...codes].sort(),
  };
}

/** Whether a reading has at least one set the planner can use. */
export function hasUsableSet(summary: QuizJsonSummary): boolean {
  return summary.sets - summary.setsWithErrors > 0;
}

/** Reads a quiz JSON file. Never throws, never repairs. */
export function readQuizJson(
  input: Uint8Array | ArrayBuffer,
  options: ReadQuizJsonOptions = {}
): ReadQuizJsonResult {
  try {
    const bytes = ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input);
    const maxBytes = options.maxBytes ?? maxFileBytesFor('json');
    if (bytes.length > maxBytes) return refused('TOO_LARGE');
    if (isTooComplex(bytes)) return refused('TOO_COMPLEX');
    const text = decodeUtf8(bytes);
    if (text === null) return refused('NOT_UTF8');

    let raw: unknown;
    try {
      raw = JSON.parse(text);
    } catch {
      return refused('NOT_JSON');
    }
    if (!isRecord(raw)) return refused('NOT_AN_OBJECT');
    if (!hasOwn(raw, 'schema_version') || !hasOwn(raw, 'quizzes')) {
      return refused('NOT_QUIZ_JSON');
    }
    if (raw.schema_version !== '1.0') return refused('SCHEMA_VERSION');
    const kind = detectQuizJsonKind(raw);
    if (kind === null) return refused('KIND_UNKNOWN');

    const readerOptions: QuizJsonOptions = {
      expectedQuestions: options.expectedQuestions,
      expectedGlobalQuestions: options.expectedGlobalQuestions,
      limits: options.limits,
    };
    const read =
      kind === 'lesson'
        ? readLessonQuizzes(raw, readerOptions)
        : readGlobalQuizzes(raw, readerOptions);
    if (read.fatal) {
      const codes = [
        ...new Set(
          read.findings.filter(f => f.severity === 'error').map(f => f.code)
        ),
      ]
        .sort()
        .slice(0, MAX_CODES);
      return refused('SCHEMA_REFUSED', codes);
    }
    const summary = summarize(kind, read);
    if (read.quizzes === 0) return refused('NO_QUIZ');
    return { status: 'ok', kind, read, summary };
  } catch {
    // Whatever went wrong, the caller gets a result and no detail of the file. It is not
    // reported as a fault of the file: it may be one of the reader
    return refused('READ_ERROR');
  }
}

/**
 * The solution texts of a quiz JSON file: the explanation of every question and the text
 * of its correct option, as the Word reader gives them (excerpt.ts solutionTextsOf). They
 * are only ever SEARCHED FOR in the excerpts of other files (a teaching text that repeats
 * an answer is cut out before anything leaves the platform), never sent and never stored.
 * Every set counts, also one with errors: it may still hold a solution that another file
 * repeats.
 */
export function quizJsonSolutionTexts(read: QuizJsonRead): string[] {
  const texts: string[] = [];
  for (const file of read.files) {
    const content = file.content;
    if (!content || content.type === 'enabler' || content.type === 'scenario') {
      continue;
    }
    for (const question of content.result.value.questions) {
      if (question.rationale) texts.push(question.rationale);
      for (const option of question.options) {
        if (question.correctLetter?.includes(option.letter)) {
          texts.push(option.text);
        }
      }
    }
  }
  return texts;
}
