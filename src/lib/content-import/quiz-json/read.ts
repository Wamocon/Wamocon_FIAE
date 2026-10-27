// Reads the quiz JSON files (schema 1.0, one with the enabler quizzes in three
// levels, one with the global quizzes) and turns them into the same input that
// the Word path gives the planner. Pure functions: no file access, the caller
// reads and parses the file.
//
// How the same keys come out: every quiz level (and every global quiz) becomes a
// synthetic source file whose path is built from the ids of the JSON in the
// scheme of the source tree ("Komponente Teil 2 .../10 - Titel (§ ...)/Enablers/
// 10a/Quiz/10a_Quiz_Low.docx"). pathInfo, the one function that classifies the
// Word files, derives key, enabler and component from it. The planner then
// treats the file like a Word file: same codes, same component and enabler
// rules, same solution guard.
//
// The reader is strict and never guesses. An unknown field, a missing or
// doubled id, an answer that is none of the options, a wrong number of options
// and similar are findings with the id, the level and the question number. A
// level with an error is handed to the planner as a file with an error issue,
// so it is skipped with its reason exactly like a Word file with a format error.
// A finding never quotes the content of the file.
//
// This module has no import of its own types at runtime, the scripts under
// scripts/import load it with Node's type stripping.

import { splitEnablerHeading } from '../apply/plan';
import type { SourceFile } from '../apply/plan';
import type { QuizLevel } from '../apply/types';
import { enablerKeysMatch, pathInfo } from '../path-info';
import {
  QUIZ_SOLUTION_FIELDS,
  cleanText,
  globalQuestionDifficulty,
} from '../source-parsers';
import type {
  ImportIssue,
  ParsedQuiz,
  PathInfo,
  QuizOption,
  QuizQuestion,
} from '../types';
import type {
  FindingSeverity,
  QuizJsonFinding,
  QuizJsonLimits,
  QuizJsonOptions,
  QuizJsonRead,
  QuizJsonSet,
  UnmappedSkip,
} from './types';

export const SCHEMA_VERSION = '1.0';

export const DEFAULT_LIMITS: QuizJsonLimits = Object.freeze({
  maxQuizzes: 1000,
  maxQuestionsPerSet: 100,
  maxTotalQuestions: 50000,
  maxQuestionChars: 2000,
  maxOptionChars: 1000,
  maxExplanationChars: 4000,
  maxTitleChars: 500,
});

const LESSON_QUESTIONS = 10;
const GLOBAL_QUESTIONS = 20;

/** Names of the levels in the JSON and the level of the plan. */
const LEVELS: ReadonlyArray<{
  name: string;
  level: QuizLevel;
  file: string;
}> = [
  { name: 'leicht', level: 'low', file: 'Low' },
  { name: 'mittel', level: 'medium', file: 'Medium' },
  { name: 'schwer', level: 'high', file: 'High' },
];

const TOP_FIELDS = {
  lesson: ['schema_version', 'quiz_count', 'difficulty_levels', 'quizzes'],
  global: ['schema_version', 'quiz_count', 'quizzes'],
} as const;
const LESSON_FIELDS = [
  'id',
  'title',
  'category',
  'source_files',
  'difficulties',
  'curriculum_component',
  'training_section',
] as const;
const GLOBAL_FIELDS = [
  'id',
  'curriculum_component',
  'title',
  'source',
  'source_file',
  'source_json',
  'questions',
] as const;
const COMPONENT_FIELDS = ['id', 'title'] as const;
const SET_FIELDS = ['label', 'source', 'questions', 'attached_source'] as const;
const SOURCE_FILE_FIELDS = ['High', 'Low', 'Medium'] as const;
const QUESTION_FIELDS = [
  'id',
  'number',
  'question',
  'options',
  'correct_answer',
  'explanation',
  'source_warnings',
] as const;
const OPTION_FIELDS = ['key', 'text'] as const;

const LESSON_ID = /^(\d{1,2})(?:_(\d))?([a-z])$/;
const COMPONENT_ID = /^(\d{2})(?:\.(\d))?$/;
const GLOBAL_TITLE = /^(\d{2}(?:\.\d)?)\)\s*\S/;
const ANSWER_KEY = /^[A-D]$/;
const SHORT_STRING_MAX = 200;
// A path separator or a control character in a name would change the path that
// the key is derived from.
// eslint-disable-next-line no-control-regex
const PATH_UNSAFE = /[\\/\u0000-\u001f\u007f]/;
// eslint-disable-next-line no-control-regex
const CONTROL = /[\u0000-\u001f\u007f]/;

type Raw = Record<string, unknown>;

const isRecord = (value: unknown): value is Raw =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

/** Own property only, so a name like "constructor" never reads the prototype. */
const own = (object: Raw, key: string): unknown =>
  Object.prototype.hasOwnProperty.call(object, key) ? object[key] : undefined;

const safeName = (name: string) =>
  /^[A-Za-z0-9_.-]{1,40}$/.test(name) ? name : '(unusual name)';

function unknownFields(object: Raw, allowed: readonly string[]): string[] {
  return Object.keys(object)
    .filter(name => !allowed.includes(name))
    .map(safeName);
}

const listNames = (names: string[]) =>
  names.length > 5
    ? `${names.slice(0, 5).join(', ')} and ${names.length - 5} more`
    : names.join(', ');

function mergeLimits(options: QuizJsonOptions): QuizJsonLimits {
  return { ...DEFAULT_LIMITS, ...(options.limits ?? {}) };
}

/** Collects the findings of one file and the issues of the quiz levels. */
class Collector {
  readonly findings: QuizJsonFinding[] = [];
  readonly unmapped: UnmappedSkip[] = [];

  add(
    severity: FindingSeverity,
    code: string,
    where: {
      id: string | null;
      level?: QuizLevel | null;
      key?: string | null;
      issues?: ImportIssue[];
      entry?: number;
    },
    message: string,
    question: number | null = null
  ): void {
    this.findings.push({
      severity,
      code,
      id: where.id,
      entry: where.entry ?? null,
      level: where.level ?? null,
      question,
      key: where.key ?? null,
      message,
    });
    where.issues?.push({
      code,
      severity,
      message,
      ...(question === null ? {} : { question }),
    });
  }

  /** An error for a quiz that has no content key: the plan lists it as skipped. */
  skip(
    type: 'quiz' | 'global-quiz',
    code: string,
    where: {
      id: string | null;
      entry: number;
      key?: string | null;
      level?: QuizLevel | null;
      componentCode?: string | null;
    },
    message: string
  ): void {
    this.add('error', code, where, message);
    this.unmapped.push({
      file: `${type === 'quiz' ? 'quiz-json' : 'global-quiz-json'}#${where.id ?? `entry-${where.entry}`}${where.level ? `/${where.level}` : ''}`,
      key: where.key ?? null,
      type,
      code,
      reason: message,
      componentCode: where.componentCode ?? null,
    });
  }
}

interface Header {
  entries: unknown[];
}

/** Checks the head of the file. Returns null when the file cannot be trusted. */
function readHeader(
  raw: unknown,
  kind: 'lesson' | 'global',
  limits: QuizJsonLimits,
  collector: Collector
): Header | null {
  const fatal = (code: string, message: string) =>
    collector.add('error', code, { id: null }, message);
  if (!isRecord(raw)) {
    fatal('NOT_OBJECT', 'The file does not hold a JSON object');
    return null;
  }
  let ok = true;
  const extra = unknownFields(raw, TOP_FIELDS[kind]);
  if (extra.length > 0) {
    fatal('UNKNOWN_FIELD', `Unknown field(s) in the head: ${listNames(extra)}`);
    ok = false;
  }
  if (own(raw, 'schema_version') !== SCHEMA_VERSION) {
    fatal(
      'SCHEMA_VERSION',
      `Only the schema version ${SCHEMA_VERSION} is read`
    );
    ok = false;
  }
  const quizzes = own(raw, 'quizzes');
  if (!Array.isArray(quizzes)) {
    fatal('QUIZZES_MISSING', 'The field quizzes is not a list');
    return null;
  }
  const count = own(raw, 'quiz_count');
  if (count !== quizzes.length) {
    fatal(
      'QUIZ_COUNT',
      `The head says ${typeof count === 'number' ? count : 'no number'} quizzes, the list has ${quizzes.length}`
    );
    ok = false;
  }
  if (kind === 'lesson') {
    const levels = own(raw, 'difficulty_levels');
    const expected = LEVELS.map(l => l.name);
    if (
      !Array.isArray(levels) ||
      levels.length !== expected.length ||
      levels.some((name, i) => name !== expected[i])
    ) {
      fatal(
        'LEVELS_HEADER',
        `The head must list the levels ${expected.join(', ')} in this order`
      );
      ok = false;
    }
  }
  if (quizzes.length > limits.maxQuizzes) {
    fatal(
      'TOO_MANY_QUIZZES',
      `The file has ${quizzes.length} quizzes, the limit is ${limits.maxQuizzes}`
    );
    return null;
  }
  // Questions in total, counted before anything is read in depth.
  let total = 0;
  for (const quiz of quizzes) {
    if (!isRecord(quiz)) continue;
    const sets =
      kind === 'global'
        ? [quiz]
        : (() => {
            const difficulties = own(quiz, 'difficulties');
            return isRecord(difficulties) ? Object.values(difficulties) : [];
          })();
    for (const set of sets) {
      const questions = isRecord(set) ? own(set, 'questions') : undefined;
      if (Array.isArray(questions)) total += questions.length;
    }
  }
  if (total > limits.maxTotalQuestions) {
    fatal(
      'TOO_MANY_QUESTIONS',
      `The file has ${total} questions, the limit is ${limits.maxTotalQuestions}`
    );
    return null;
  }
  return ok ? { entries: quizzes } : null;
}

interface TextRead {
  text: string;
  problem: 'type' | 'empty' | 'long' | 'control' | null;
}

function readText(value: unknown, max: number): TextRead {
  if (typeof value !== 'string') return { text: '', problem: 'type' };
  if (value.length > max) return { text: '', problem: 'long' };
  const text = cleanText(value);
  if (text.length === 0) return { text, problem: 'empty' };
  if (CONTROL.test(text)) return { text, problem: 'control' };
  return { text, problem: null };
}

const lower = (text: string) => text.toLowerCase();

interface SetContext {
  collector: Collector;
  limits: QuizLevelLimits;
  /** Where the findings and issues of this set go. */
  where: {
    id: string;
    level: QuizLevel | null;
    key: string | null;
    issues: ImportIssue[];
  };
  /** Question ids of the whole file (they must be unique). */
  questionIds: Set<string>;
}

type QuizLevelLimits = Pick<
  QuizJsonLimits,
  | 'maxQuestionsPerSet'
  | 'maxQuestionChars'
  | 'maxOptionChars'
  | 'maxExplanationChars'
  | 'maxTitleChars'
>;

/** Reads the questions of one set. Fills the issues, returns the questions that could be built. */
function readQuestions(
  raw: unknown,
  ctx: SetContext,
  expected: { count: number; severity: FindingSeverity },
  global: boolean
): QuizQuestion[] {
  const { collector, where, limits } = ctx;
  const out: QuizQuestion[] = [];
  if (!Array.isArray(raw) || raw.length === 0) {
    collector.add(
      'error',
      'NO_QUESTIONS',
      where,
      'The set contains no questions'
    );
    return out;
  }
  if (raw.length > limits.maxQuestionsPerSet) {
    collector.add(
      'error',
      'TOO_MANY_QUESTIONS',
      where,
      `The set has ${raw.length} questions, the limit is ${limits.maxQuestionsPerSet}`
    );
    return out;
  }
  if (raw.length !== expected.count) {
    collector.add(
      expected.severity,
      'QUESTION_COUNT',
      where,
      `The set has ${raw.length} questions, expected ${expected.count}`
    );
  }
  const seenQuestions = new Set<string>();
  raw.forEach((entry, index) => {
    const n = index + 1;
    const flag = (severity: FindingSeverity, code: string, message: string) =>
      collector.add(severity, code, where, message, n);
    if (!isRecord(entry)) {
      flag('error', 'QUESTION_NOT_OBJECT', `Question ${n} is not an object`);
      return;
    }
    const extra = unknownFields(entry, QUESTION_FIELDS);
    if (extra.length > 0) {
      flag(
        'error',
        'UNKNOWN_FIELD',
        `Question ${n} has unknown field(s): ${listNames(extra)}`
      );
    }
    const id = own(entry, 'id');
    if (typeof id !== 'string' || id.length === 0 || id.length > 100) {
      flag('error', 'ID_INVALID', `Question ${n} has no valid id`);
    } else if (ctx.questionIds.has(id)) {
      flag('error', 'ID_DUPLICATE', `The id of question ${n} is used twice`);
    } else {
      ctx.questionIds.add(id);
    }
    if (own(entry, 'number') !== n) {
      flag(
        'error',
        'NUMBER_SEQUENCE',
        `Question ${n} does not carry the number ${n} in the list`
      );
    }

    const text = readText(own(entry, 'question'), limits.maxQuestionChars);
    if (text.problem === 'long') {
      flag('error', 'TEXT_TOO_LONG', `Question ${n} is too long`);
    } else if (text.problem === 'control') {
      flag('error', 'TEXT_CONTROL', `Question ${n} holds a control character`);
    } else if (text.problem !== null) {
      flag('error', 'TEXT_EMPTY', `Question ${n} has no text`);
    } else {
      const sameAs = lower(text.text);
      if (seenQuestions.has(sameAs)) {
        flag(
          'error',
          'QUESTION_DUPLICATE',
          `Question ${n} repeats the text of an earlier question`
        );
      }
      seenQuestions.add(sameAs);
    }

    // Options: exactly four, the keys A to D in this order, no empty text, no twin.
    const options: QuizOption[] = [];
    const rawOptions = own(entry, 'options');
    if (!Array.isArray(rawOptions)) {
      flag('error', 'OPTION_COUNT', `Question ${n} has no list of options`);
    } else {
      if (rawOptions.length !== 4) {
        flag(
          'error',
          'OPTION_COUNT',
          `Question ${n} has ${rawOptions.length} options, expected exactly 4`
        );
      }
      const texts = new Set<string>();
      let emptyReported = false;
      let twinReported = false;
      rawOptions.slice(0, 8).forEach(item => {
        if (!isRecord(item)) {
          flag(
            'error',
            'OPTION_INVALID',
            `An option of question ${n} is no object`
          );
          return;
        }
        const extraOption = unknownFields(item, OPTION_FIELDS);
        if (extraOption.length > 0) {
          flag(
            'error',
            'UNKNOWN_FIELD',
            `An option of question ${n} has unknown field(s): ${listNames(extraOption)}`
          );
        }
        const key = own(item, 'key');
        const optionText = readText(own(item, 'text'), limits.maxOptionChars);
        if (optionText.problem === 'long') {
          flag(
            'error',
            'OPTION_TOO_LONG',
            `An option of question ${n} is too long`
          );
        } else if (optionText.problem === 'control') {
          flag(
            'error',
            'TEXT_CONTROL',
            `An option of question ${n} holds a control character`
          );
        } else if (optionText.problem !== null) {
          if (!emptyReported) {
            flag(
              'error',
              'OPTION_EMPTY',
              `An option of question ${n} has no text`
            );
            emptyReported = true;
          }
        } else if (texts.has(lower(optionText.text))) {
          if (!twinReported) {
            flag(
              'error',
              'OPTION_DUPLICATE',
              `Two options of question ${n} have the same text`
            );
            twinReported = true;
          }
        } else {
          texts.add(lower(optionText.text));
        }
        options.push({
          letter: typeof key === 'string' ? key : '',
          text: optionText.text,
        });
      });
      if (
        rawOptions.length === 4 &&
        options.map(o => o.letter).join('') !== 'ABCD'
      ) {
        flag(
          'error',
          'OPTION_ORDER',
          `The option keys of question ${n} must be A, B, C, D in this order`
        );
      }
    }

    const answer = own(entry, 'correct_answer');
    let correctLetter: string | null = null;
    if (answer === undefined || answer === '') {
      flag('error', 'ANSWER_MISSING', `Question ${n} has no correct_answer`);
    } else if (
      typeof answer !== 'string' ||
      !ANSWER_KEY.test(answer) ||
      !options.some(o => o.letter === answer)
    ) {
      flag(
        'error',
        'ANSWER_INVALID',
        `The correct_answer of question ${n} is none of its options`
      );
    } else {
      correctLetter = answer;
    }

    const explanation = readText(
      own(entry, 'explanation'),
      limits.maxExplanationChars
    );
    if (explanation.problem === 'long') {
      flag(
        'error',
        'RATIONALE_TOO_LONG',
        `The explanation of question ${n} is too long`
      );
    } else if (explanation.problem === 'control') {
      flag(
        'error',
        'TEXT_CONTROL',
        `The explanation of question ${n} holds a control character`
      );
    } else if (explanation.problem !== null) {
      flag('error', 'RATIONALE_MISSING', `Question ${n} has no explanation`);
    }

    if (Object.prototype.hasOwnProperty.call(entry, 'source_warnings')) {
      const warnings = own(entry, 'source_warnings');
      if (
        Array.isArray(warnings) &&
        warnings.every(w => typeof w === 'string' && w.length > 0)
      ) {
        if (warnings.length > 0) {
          flag(
            'warning',
            'SOURCE_WARNING',
            `The source marks question ${n} with ${warnings.length} warning(s), check it before activation`
          );
        }
      } else {
        flag(
          'error',
          'SOURCE_WARNINGS_INVALID',
          `source_warnings of question ${n} is not a list of texts`
        );
      }
    }

    out.push({
      number: n,
      text: text.text,
      options,
      correctLetter,
      rationale:
        explanation.problem === null && explanation.text.length > 0
          ? explanation.text
          : null,
      difficulty: global ? globalQuestionDifficulty(n) : null,
    });
  });
  return out;
}

function shortStringProblem(value: unknown, max: number): boolean {
  return (
    typeof value !== 'string' ||
    value.length === 0 ||
    value.length > max ||
    CONTROL.test(value)
  );
}

/**
 * The source fields (paths of the Word files) are not used by the import. A
 * missing source (null) is a note, a value that is no text is an error.
 */
function checkSource(
  value: unknown,
  what: string,
  max: number,
  collector: Collector,
  where: Parameters<Collector['add']>[2]
): void {
  if (value === null) {
    collector.add('warning', 'SOURCE_NULL', where, `${what} is null`);
  } else if (shortStringProblem(value, max)) {
    collector.add(
      'error',
      'SOURCE_TYPE',
      where,
      `${what} is missing or no text`
    );
  }
}

const countOf = (issues: ImportIssue[], severity: FindingSeverity) =>
  issues.filter(i => i.severity === severity).length;

/** A synthetic source file that stands for one quiz level or one global quiz. */
function syntheticFile(
  rel: string,
  info: PathInfo,
  content: SourceFile['content']
): SourceFile {
  return { rel, size: 0, mtimeMs: 0, placeholder: false, info, content };
}

function parsedQuiz(
  fields: Pick<
    ParsedQuiz,
    'kind' | 'enablerCode' | 'componentKey' | 'difficulty' | 'questions'
  >
): ParsedQuiz {
  return {
    ...fields,
    title: null,
    solutionFields: QUIZ_SOLUTION_FIELDS,
  };
}

interface LessonHead {
  entry: number;
  raw: Raw;
  id: string;
  componentId: string;
  section: string;
  /** Path info of the three levels, by level. */
  infos: Map<QuizLevel, PathInfo>;
  enablerKey: string;
  componentCode: string;
}

/**
 * Reads the enabler quizzes (the file with the three levels per quiz).
 * `raw` is the parsed JSON.
 */
export function readLessonQuizzes(
  raw: unknown,
  options: QuizJsonOptions = {}
): QuizJsonRead {
  const limits = mergeLimits(options);
  const collector = new Collector();
  const files: SourceFile[] = [];
  const sets: QuizJsonSet[] = [];
  const header = readHeader(raw, 'lesson', limits, collector);
  const result = (): QuizJsonRead => ({
    kind: 'lesson',
    fatal: header === null,
    quizzes: header?.entries.length ?? 0,
    findings: collector.findings,
    files,
    unmapped: collector.unmapped,
    sets,
  });
  if (!header) return result();

  // Step 1: id, component and path of every quiz --------------------------------
  const heads: LessonHead[] = [];
  header.entries.forEach((entry, index) => {
    const n = index + 1;
    if (!isRecord(entry)) {
      collector.skip(
        'quiz',
        'QUIZ_NOT_OBJECT',
        { id: null, entry: n },
        `Entry ${n} of the quiz list is not an object`
      );
      return;
    }
    const id = own(entry, 'id');
    const idMatch = typeof id === 'string' ? LESSON_ID.exec(id) : null;
    if (typeof id !== 'string' || !idMatch) {
      collector.skip(
        'quiz',
        'ID_INVALID',
        { id: null, entry: n },
        `The id of entry ${n} is missing or has no form like 10a or 24_1a`
      );
      return;
    }
    const at = { id, entry: n };
    const component = own(entry, 'curriculum_component');
    const componentId = isRecord(component) ? own(component, 'id') : undefined;
    const componentTitle = isRecord(component)
      ? own(component, 'title')
      : undefined;
    const idParts =
      typeof componentId === 'string' ? COMPONENT_ID.exec(componentId) : null;
    if (
      !isRecord(component) ||
      !idParts ||
      shortStringProblem(componentTitle, limits.maxTitleChars) ||
      PATH_UNSAFE.test(componentTitle as string)
    ) {
      collector.skip(
        'quiz',
        'COMPONENT_INVALID',
        at,
        'curriculum_component needs an id like 06.1 and a title without path characters'
      );
      return;
    }
    const section = own(entry, 'training_section');
    if (
      shortStringProblem(section, SHORT_STRING_MAX) ||
      PATH_UNSAFE.test(section as string)
    ) {
      collector.skip(
        'quiz',
        'SECTION_INVALID',
        at,
        'training_section is missing or holds path characters'
      );
      return;
    }
    if (
      Number(idMatch[1]) !== Number(idParts[1]) ||
      (idMatch[2] !== undefined && idMatch[2] !== idParts[2])
    ) {
      collector.skip(
        'quiz',
        'COMPONENT_MISMATCH',
        at,
        `The id ${id} does not fit the component ${componentId as string}`
      );
      return;
    }
    const letter = idMatch[3];
    const split = idParts[2] !== undefined ? Number(idParts[2]) : null;
    const enablerKey = `${Number(idParts[1])}${split !== null ? `.${split}` : ''}${letter}`;
    const infos = new Map<QuizLevel, PathInfo>();
    let problem: string | null = null;
    for (const { level, file } of LEVELS) {
      const rel = `${section as string}/${componentTitle as string}/Enablers/${id}/Quiz/${id}_Quiz_${file}.docx`;
      const info = pathInfo(rel);
      const wanted = `quiz:${enablerKey}:${level}`;
      if (
        info.type !== 'quiz' ||
        info.issues.length > 0 ||
        info.key !== wanted ||
        info.component?.key !== componentId
      ) {
        problem =
          info.issues.length > 0
            ? `The ids give a path that does not fit the scheme (${info.issues.join(', ')})`
            : 'The ids and the component give no valid content key';
        break;
      }
      infos.set(level, info);
    }
    if (problem !== null || !infos.get('low')?.component) {
      collector.skip('quiz', 'PATH_MAPPING', at, problem ?? 'No component');
      return;
    }
    heads.push({
      entry: n,
      raw: entry,
      id,
      componentId: componentId as string,
      section: section as string,
      infos,
      enablerKey,
      componentCode: (infos.get('low') as PathInfo).component?.code as string,
    });
  });

  // Step 2: ids and keys must be unique -----------------------------------------
  const byId = new Map<string, LessonHead[]>();
  const byKey = new Map<string, LessonHead[]>();
  for (const head of heads) {
    byId.set(head.id, [...(byId.get(head.id) ?? []), head]);
    byKey.set(head.enablerKey, [...(byKey.get(head.enablerKey) ?? []), head]);
  }
  const usable: LessonHead[] = [];
  for (const head of heads) {
    const sameId = (byId.get(head.id) ?? []).length > 1;
    const sameKey = (byKey.get(head.enablerKey) ?? []).length > 1;
    if (sameId || sameKey) {
      collector.skip(
        'quiz',
        sameId ? 'ID_DUPLICATE' : 'KEY_DUPLICATE',
        {
          id: head.id,
          entry: head.entry,
          key: `quiz:${head.enablerKey}`,
          componentCode: head.componentCode,
        },
        sameId
          ? `The quiz id ${head.id} is used by several entries, none of them is read`
          : `The enabler ${head.enablerKey} is named by several quiz ids, none of them is read`
      );
    } else {
      usable.push(head);
    }
  }

  // Step 3: one title and one section per component -----------------------------
  const variants = new Map<string, Set<string>>();
  for (const head of usable) {
    const component = own(head.raw, 'curriculum_component') as Raw;
    const variant = `${own(component, 'title') as string}\u0000${head.section}`;
    const set = variants.get(head.componentId) ?? new Set<string>();
    set.add(variant);
    variants.set(head.componentId, set);
  }

  // Step 4: the quizzes ---------------------------------------------------------
  const questionIds = new Set<string>();
  const expected = {
    count: options.expectedQuestions ?? LESSON_QUESTIONS,
    severity: 'warning' as FindingSeverity,
  };
  for (const head of usable) {
    const quizIssues: ImportIssue[] = [];
    const quizWhere = { id: head.id, key: `quiz:${head.enablerKey}` };
    const flag = (severity: FindingSeverity, code: string, message: string) =>
      collector.add(
        severity,
        code,
        { ...quizWhere, issues: quizIssues },
        message
      );
    const extra = unknownFields(head.raw, LESSON_FIELDS);
    if (extra.length > 0) {
      flag('error', 'UNKNOWN_FIELD', `Unknown field(s): ${listNames(extra)}`);
    }
    const component = own(head.raw, 'curriculum_component') as Raw;
    const extraComponent = unknownFields(component, COMPONENT_FIELDS);
    if (extraComponent.length > 0) {
      flag(
        'error',
        'UNKNOWN_FIELD',
        `Unknown field(s) in curriculum_component: ${listNames(extraComponent)}`
      );
    }
    if ((variants.get(head.componentId)?.size ?? 0) > 1) {
      flag(
        'error',
        'COMPONENT_CONFLICT',
        `The quizzes of the component ${head.componentId} name different titles or sections`
      );
    }
    const category = own(head.raw, 'category');
    if (
      typeof category !== 'string' ||
      category.normalize('NFC') !== head.section.normalize('NFC')
    ) {
      flag(
        'warning',
        'CATEGORY_MISMATCH',
        'category is missing or differs from training_section'
      );
    }
    const titleRead = readText(own(head.raw, 'title'), limits.maxTitleChars);
    const heading =
      titleRead.problem === null ? splitEnablerHeading(titleRead.text) : null;
    const headingOk =
      heading !== null &&
      heading.code !== null &&
      enablerKeysMatch(heading.code, head.enablerKey);
    if (!headingOk) {
      flag(
        'warning',
        'TITLE_HEADING',
        `The title has no heading of the enabler ${head.enablerKey} (form: 10a) Title), the enabler must come from the Word documents`
      );
    }

    const sourceFiles = own(head.raw, 'source_files');
    if (!isRecord(sourceFiles)) {
      flag('warning', 'SOURCE_FILES', 'source_files is missing');
    } else {
      const extraFiles = unknownFields(sourceFiles, SOURCE_FILE_FIELDS);
      if (extraFiles.length > 0) {
        flag(
          'error',
          'UNKNOWN_FIELD',
          `Unknown field(s) in source_files: ${listNames(extraFiles)}`
        );
      }
    }

    const difficulties = own(head.raw, 'difficulties');
    if (isRecord(difficulties)) {
      const knownLevels = LEVELS.map(l => l.name);
      const extraLevels = Object.keys(difficulties)
        .filter(name => !knownLevels.includes(name))
        .map(safeName);
      if (extraLevels.length > 0) {
        flag(
          'error',
          'UNKNOWN_LEVEL',
          `Unknown level(s): ${listNames(extraLevels)}`
        );
      }
    }

    let anyClean = false;
    for (const { name, level, file } of LEVELS) {
      const info = head.infos.get(level) as PathInfo;
      const rawSet = isRecord(difficulties)
        ? own(difficulties, name)
        : undefined;
      if (!isRecord(rawSet)) {
        collector.skip(
          'quiz',
          'LEVEL_MISSING',
          {
            id: head.id,
            entry: head.entry,
            level,
            key: info.key,
            componentCode: head.componentCode,
          },
          `The level ${name} of quiz ${head.id} is missing`
        );
        continue;
      }
      const ownIssues: ImportIssue[] = [];
      const setWhere = {
        id: head.id,
        level,
        key: info.key,
        issues: ownIssues,
      };
      const extraSet = unknownFields(rawSet, SET_FIELDS);
      if (extraSet.length > 0) {
        collector.add(
          'error',
          'UNKNOWN_FIELD',
          setWhere,
          `Unknown field(s) in the level ${name}: ${listNames(extraSet)}`
        );
      }
      if (own(rawSet, 'label') !== name) {
        collector.add(
          'error',
          'LABEL_MISMATCH',
          setWhere,
          `The label of the level ${name} differs from its name`
        );
      }
      for (const field of ['source', 'attached_source'] as const) {
        checkSource(
          own(rawSet, field),
          `${field} of the level ${name}`,
          limits.maxTitleChars,
          collector,
          setWhere
        );
      }
      // The path of the Word file in the JSON must name the same key.
      if (isRecord(sourceFiles)) {
        const stated = own(sourceFiles, file);
        const statedInfo =
          typeof stated === 'string' && stated.length <= 300
            ? pathInfo(stated)
            : null;
        if (
          !statedInfo ||
          statedInfo.key !== info.key ||
          statedInfo.issues.length > 0
        ) {
          collector.add(
            'warning',
            'SOURCE_PATH_MISMATCH',
            setWhere,
            `source_files.${file} names another content key than the id of the quiz`
          );
        }
      }
      const questions = readQuestions(
        own(rawSet, 'questions'),
        {
          collector,
          limits,
          where: setWhere,
          questionIds,
        },
        expected,
        false
      );
      const issues = [...quizIssues, ...ownIssues];
      const parsed = parsedQuiz({
        kind: 'enabler',
        enablerCode: head.enablerKey,
        componentKey: null,
        difficulty: level,
        questions,
      });
      files.push(
        syntheticFile(`quiz-json#${head.id}/${level}`, info, {
          type: 'quiz',
          result: {
            value: parsed,
            issues,
            ok: countOf(issues, 'error') === 0,
          },
        })
      );
      sets.push({
        id: head.id,
        componentCode: head.componentCode,
        level,
        key: info.key,
        questions: questions.length,
        errors: countOf(issues, 'error'),
        warnings: countOf(issues, 'warning'),
      });
      if (countOf(issues, 'error') === 0) anyClean = true;
    }

    // The enabler: only when the title names it and a level can be planned. A
    // Word document of the same enabler wins over this one (mergeQuizSources).
    if (headingOk && anyClean && heading) {
      const low = head.infos.get('low') as PathInfo;
      files.push(
        syntheticFile(
          `quiz-json#${head.id}/enabler`,
          {
            ...low,
            type: 'enabler',
            difficulty: null,
            key: `enabler:${head.enablerKey}`,
            flags: [...low.flags, 'from-quiz-json'],
          },
          {
            type: 'enabler',
            paragraphs: [{ text: titleRead.text, bold: true }],
          }
        )
      );
    }
  }
  return result();
}

/**
 * Reads the global quizzes (one per component, 20 questions each). `raw` is
 * the parsed JSON.
 */
export function readGlobalQuizzes(
  raw: unknown,
  options: QuizJsonOptions = {}
): QuizJsonRead {
  const limits = mergeLimits(options);
  const collector = new Collector();
  const files: SourceFile[] = [];
  const sets: QuizJsonSet[] = [];
  const header = readHeader(raw, 'global', limits, collector);
  const result = (): QuizJsonRead => ({
    kind: 'global',
    fatal: header === null,
    quizzes: header?.entries.length ?? 0,
    findings: collector.findings,
    files,
    unmapped: collector.unmapped,
    sets,
  });
  if (!header) return result();

  interface GlobalHead {
    entry: number;
    raw: Raw;
    id: string;
    info: PathInfo;
  }
  const heads: GlobalHead[] = [];
  header.entries.forEach((entry, index) => {
    const n = index + 1;
    if (!isRecord(entry)) {
      collector.skip(
        'global-quiz',
        'QUIZ_NOT_OBJECT',
        { id: null, entry: n },
        `Entry ${n} of the quiz list is not an object`
      );
      return;
    }
    const id = own(entry, 'id');
    if (typeof id !== 'string' || !COMPONENT_ID.test(id)) {
      collector.skip(
        'global-quiz',
        'ID_INVALID',
        { id: null, entry: n },
        `The id of entry ${n} is missing or has no form like 06.1`
      );
      return;
    }
    const component = own(entry, 'curriculum_component');
    if (!isRecord(component) || own(component, 'id') !== id) {
      collector.skip(
        'global-quiz',
        'COMPONENT_MISMATCH',
        { id, entry: n },
        `curriculum_component is missing or names another component than the id ${id}`
      );
      return;
    }
    const info = pathInfo(`00_Global_Quizze/Word/${id}_Global_Quiz.docx`);
    if (
      info.type !== 'global-quiz' ||
      info.issues.length > 0 ||
      info.key !== `global-quiz:${id}` ||
      info.component?.key !== id
    ) {
      collector.skip(
        'global-quiz',
        'PATH_MAPPING',
        { id, entry: n },
        'The id gives no valid content key'
      );
      return;
    }
    heads.push({ entry: n, raw: entry, id, info });
  });

  const counts = new Map<string, number>();
  for (const head of heads) counts.set(head.id, (counts.get(head.id) ?? 0) + 1);
  const questionIds = new Set<string>();
  for (const head of heads) {
    const componentCode = head.info.component?.code ?? null;
    if ((counts.get(head.id) ?? 0) > 1) {
      collector.skip(
        'global-quiz',
        'ID_DUPLICATE',
        {
          id: head.id,
          entry: head.entry,
          key: head.info.key,
          componentCode,
        },
        `The global quiz of the component ${head.id} is listed several times, none of them is read`
      );
      continue;
    }
    const issues: ImportIssue[] = [];
    const where = { id: head.id, level: null, key: head.info.key, issues };
    const extra = unknownFields(head.raw, GLOBAL_FIELDS);
    if (extra.length > 0) {
      collector.add(
        'error',
        'UNKNOWN_FIELD',
        where,
        `Unknown field(s): ${listNames(extra)}`
      );
    }
    const component = own(head.raw, 'curriculum_component') as Raw;
    const extraComponent = unknownFields(component, COMPONENT_FIELDS);
    if (extraComponent.length > 0) {
      collector.add(
        'error',
        'UNKNOWN_FIELD',
        where,
        `Unknown field(s) in curriculum_component: ${listNames(extraComponent)}`
      );
    }
    const componentTitle = readText(
      own(component, 'title'),
      limits.maxTitleChars
    );
    const titleMatch =
      componentTitle.problem === null
        ? GLOBAL_TITLE.exec(componentTitle.text)
        : null;
    if (!titleMatch || titleMatch[1] !== head.id) {
      collector.add(
        'error',
        'COMPONENT_TITLE',
        where,
        'The title of curriculum_component does not start with the component id'
      );
    }
    if (shortStringProblem(own(head.raw, 'title'), limits.maxTitleChars)) {
      collector.add(
        'error',
        'SOURCE_TYPE',
        where,
        'title is missing or no text'
      );
    }
    for (const field of ['source', 'source_file', 'source_json']) {
      checkSource(
        own(head.raw, field),
        field,
        limits.maxTitleChars,
        collector,
        where
      );
    }
    const questions = readQuestions(
      own(head.raw, 'questions'),
      {
        collector,
        limits,
        where,
        questionIds,
      },
      {
        count: options.expectedGlobalQuestions ?? GLOBAL_QUESTIONS,
        severity: 'error',
      },
      true
    );
    files.push(
      syntheticFile(`global-quiz-json#${head.id}`, head.info, {
        type: 'global-quiz',
        result: {
          value: parsedQuiz({
            kind: 'global',
            enablerCode: null,
            componentKey: head.id,
            difficulty: 'mixed',
            questions,
          }),
          issues,
          ok: countOf(issues, 'error') === 0,
        },
      })
    );
    sets.push({
      id: head.id,
      componentCode,
      level: null,
      key: head.info.key,
      questions: questions.length,
      errors: countOf(issues, 'error'),
      warnings: countOf(issues, 'warning'),
    });
  }
  return result();
}
