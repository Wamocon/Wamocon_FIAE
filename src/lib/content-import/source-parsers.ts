// Parsers for the KfBM source documents (quiz and scenario). Pure functions:
// no file access, no database. The input is plain text or a list of paragraphs
// (see SourceInput), a thin helper turns a .docx into such a list
// (docx-paragraphs.ts).
//
// Solution protection: the correct answer and the short rationale of a quiz
// question and the solution parts of a scenario are solutions. The parsers keep
// them apart from the visible part and mark them (solutionFields, visibility).
// toTraineeQuiz and toTraineeScenario give the view that trainees may see.
//
// A parser never throws on bad content. It returns the best effort value plus
// the list of issues, so one broken file does not stop a whole run.
//
// This module has no runtime import on purpose, the scripts under
// scripts/import load it directly with Node's type stripping.

import type {
  Difficulty,
  ImportIssue,
  IssueSeverity,
  Paragraph,
  ParsedQuiz,
  ParsedScenario,
  ParseResult,
  QuizOption,
  QuizQuestion,
  SourceInput,
} from './types';

export const QUIZ_SOLUTION_FIELDS = Object.freeze([
  'correctLetter',
  'rationale',
] as const);

const clean = (text: string) =>
  text
    .normalize('NFC')
    .replace(/[\u200b\u200c\u200d\u2060\u00ad\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

/**
 * Normalizes the input to paragraphs. In plain text a line wrapped in ** is
 * bold. Whitespace is collapsed, empty paragraphs stay (they separate blocks).
 * A soft line break inside a paragraph (Shift+Enter in Word) starts a new line,
 * so a label that follows a break is never glued to the text before it.
 * Input that is not a string or a list gives an empty result.
 */
export function toParagraphs(input: SourceInput): Paragraph[] {
  const items: ReadonlyArray<unknown> =
    typeof input === 'string'
      ? input.split(/\r?\n/)
      : Array.isArray(input)
        ? input
        : [];
  const out: Paragraph[] = [];
  for (const item of items) {
    if (item === null || item === undefined) continue;
    const isText = typeof item === 'string';
    const raw = isText ? item : String((item as { text?: unknown }).text ?? '');
    const bold = isText ? false : Boolean((item as { bold?: unknown }).bold);
    for (const piece of raw.split(/\r\n|\r|\n/)) {
      const wrapped = isText ? /^\s*\*\*(.*)\*\*\s*$/.exec(piece) : null;
      out.push(
        wrapped
          ? { text: clean(wrapped[1]), bold: true }
          : { text: clean(piece), bold }
      );
    }
  }
  return out;
}

function makeResult<T>(value: T, issues: ImportIssue[]): ParseResult<T> {
  return {
    value,
    issues,
    ok: !issues.some(issue => issue.severity === 'error'),
  };
}

function issue(
  code: string,
  severity: IssueSeverity,
  message: string,
  question?: number
): ImportIssue {
  return question === undefined
    ? { code, severity, message }
    : { code, severity, message, question };
}

const codeOf = (num: string, split: string | undefined, letter: string) =>
  `${Number(num)}${split ? `.${split}` : ''}${letter.toLowerCase()}`;

// Headings: "1b) Title" (strict), "Quiz 1b: Title" (variant, a real separator is
// required and the prefix must fit the kind of document). The letter is lower
// case as in the sources, so "3D-Druck" or "1B) Title" is not a heading.
const ENABLER_HEADING = /^(\d{1,2})(?:[._](\d))?([a-z])\)\s*(.+)$/;
const QUIZ_HEADING_LOOSE =
  /^(?:Quiz\s+)?(\d{1,2})(?:[._/](\d))?([a-z])\s*[:.)\-–—]\s*(.+)$/;
const SCENARIO_HEADING = /^Szenario\s+(\d{1,2})(?:[._](\d))?([a-z])\)\s*(.+)$/;
const SCENARIO_HEADING_LOOSE =
  /^(?:Szenario[\s_]+)?(\d{1,2})(?:[._/](\d))?([a-z])\s*[:.)\-–—]\s*(.+)$/;
const GLOBAL_MARK = /^Global[\s-]*Quiz\b/i;
const GLOBAL_HEADING = /^(\d{1,2})(?:\.(\d))?\)\s*(.+)$/;

interface HeadingMatch {
  code: string;
  title: string;
  variant: boolean;
}

function matchEnablerHeading(
  text: string,
  strict: RegExp,
  loose: RegExp
): HeadingMatch | null {
  const exact = strict.exec(text);
  if (exact) {
    return {
      code: codeOf(exact[1], exact[2], exact[3]),
      title: clean(exact[4]),
      variant: false,
    };
  }
  const variant = loose.exec(text);
  if (variant) {
    return {
      code: codeOf(variant[1], variant[2], variant[3]),
      title: clean(variant[4]),
      variant: true,
    };
  }
  return null;
}

/** Difficulty band of a question of a global quiz (1-5, 6-15, 16-20). */
export function globalQuestionDifficulty(number: number): Difficulty {
  if (number <= 5) return 'low';
  if (number <= 15) return 'medium';
  return 'high';
}

function mapDifficulty(word: string): Difficulty | null {
  const w = word
    .replace(/\(.*?\)/g, '')
    .toLowerCase()
    .replace(/[^a-zäöüß]/g, '')
    .trim();
  if (['leicht', 'einfach', 'low'].includes(w)) return 'low';
  if (['mittel', 'mittelschwer', 'medium'].includes(w)) return 'medium';
  if (['anspruchsvoll', 'schwer', 'schwierig', 'hoch', 'high'].includes(w)) {
    return 'high';
  }
  return null;
}

// "9. Text" and "9.Text", but not a heading like "24.1a) Title".
const QUESTION_START = /^(\d{1,3})\.(?!\d+[a-z]?\))\s*(.+)$/;
const OPTION_LINE = /^([A-Z])\)\s*(.*)$/;
const ANSWER_LINE = /^Richtige\s+Antwort(?![\p{L}])\s*:?\s*(.*)$/iu;
const RATIONALE_LINE = /^Kurzbegr(?:ü|ue)ndung(?![\p{L}])\s*:?\s*(.*)$/iu;
const DIFFICULTY_LINE = /Schwierigkeitsgrad\s*[:\-–]?\s*(.*)$/i;
const ANSWER_HEAD =
  /^[A-Za-z](?:\s*(?:,|;|&|\/|\bund\b|\boder\b)\s*[A-Za-z])*(?![A-Za-zÄÖÜäöüß])/i;
const ANSWER_TOKEN = /(?<![\p{L}\p{N}])[A-H](?![\p{L}\p{N}])/gu;

/**
 * Letters named by the line "Richtige Antwort: ...". Besides the leading
 * letters it counts every single capital letter in the first 25 characters, so
 * "B + C", "B C" or "B) und C)" give two letters, not one.
 */
function answerLetters(value: string): { letters: string[]; lower: boolean } {
  const head = ANSWER_HEAD.exec(value);
  const found = new Set<string>();
  let lower = false;
  if (head) {
    for (const part of head[0].split(/\s*(?:,|;|&|\/|\bund\b|\boder\b)\s*/i)) {
      const letter = part.trim();
      if (letter.length === 0) continue;
      if (letter !== letter.toUpperCase()) lower = true;
      found.add(letter.toUpperCase());
    }
  }
  for (const token of value.slice(0, 25).matchAll(ANSWER_TOKEN)) {
    found.add(token[0]);
  }
  return { letters: [...found], lower };
}

interface DraftQuestion {
  number: number;
  text: string;
  options: QuizOption[];
  answers: string[];
  rationale: string | null;
  state: 'question' | 'options' | 'answered' | 'rationale';
}

export interface ParseQuizOptions {
  /** Expected number of questions (a global quiz defaults to 20). */
  expectedQuestions?: number;
}

/**
 * Parses the text of a quiz file (enabler quiz or global quiz).
 *
 * Expected format: heading ("1b) Title", global quiz "06.1) Title (§ ...)"
 * followed by "Global Quiz"), a line "Quiz, Schwierigkeitsgrad: leicht" (not for
 * a global quiz), then per question a numbered question, four options "A)" to
 * "D)", "Richtige Antwort: B" and "Kurzbegründung: ...".
 */
export function parseQuizText(
  input: SourceInput,
  options: ParseQuizOptions = {}
): ParseResult<ParsedQuiz> {
  const issues: ImportIssue[] = [];
  const lines = toParagraphs(input)
    .map(paragraph => paragraph.text)
    .filter(text => text.length > 0);

  const quiz: ParsedQuiz = {
    kind: 'unknown',
    enablerCode: null,
    componentKey: null,
    title: null,
    difficulty: null,
    questions: [],
    solutionFields: QUIZ_SOLUTION_FIELDS,
  };
  if (lines.length === 0) {
    issues.push(issue('EMPTY_INPUT', 'error', 'The document has no text.'));
    return makeResult(quiz, issues);
  }

  let index = 0;
  // Heading
  const first = lines[index];
  const second = lines[index + 1] ?? '';
  const third = lines[index + 2] ?? '';
  // The paragraph reference may stand on a line of its own: "04) Title",
  // "(§ 4 Abs. 2 Nr. 4)", "Global Quiz".
  const referenceLine = /^\(§[^)]*\)$/.test(second) && GLOBAL_MARK.test(third);
  const isGlobal = GLOBAL_MARK.test(second) || referenceLine;
  if (isGlobal) {
    quiz.kind = 'global';
    const match = GLOBAL_HEADING.exec(first);
    if (match) {
      quiz.componentKey = `${String(Number(match[1])).padStart(2, '0')}${
        match[2] ? `.${match[2]}` : ''
      }`;
      quiz.title = clean(referenceLine ? `${match[3]} ${second}` : match[3]);
      if (referenceLine) {
        issues.push(
          issue(
            'HEADING_VARIANT',
            'warning',
            'The paragraph reference of the global quiz stands on its own line.'
          )
        );
      }
    } else {
      quiz.title = first;
      issues.push(
        issue(
          'HEADING_FORMAT',
          'error',
          `The heading of the global quiz has no component number: "${first}".`
        )
      );
    }
    quiz.difficulty = 'mixed';
    index += referenceLine ? 3 : 2;
  } else if (QUESTION_START.test(first)) {
    quiz.kind = 'enabler';
    issues.push(
      issue(
        'HEADING_MISSING',
        'error',
        'The document starts with a question, there is no heading.'
      )
    );
  } else {
    quiz.kind = 'enabler';
    const heading = matchEnablerHeading(
      first,
      ENABLER_HEADING,
      QUIZ_HEADING_LOOSE
    );
    if (heading) {
      quiz.enablerCode = heading.code;
      quiz.title = heading.title;
      if (heading.variant) {
        issues.push(
          issue(
            'HEADING_VARIANT',
            'warning',
            `The heading has another form than "1b) Title": "${first}".`
          )
        );
      }
    } else {
      quiz.title = first;
      issues.push(
        issue(
          'HEADING_FORMAT',
          'error',
          `The heading carries no enabler code: "${first}".`
        )
      );
    }
    index += 1;
    const levelLine = lines[index];
    const levelMatch = levelLine ? DIFFICULTY_LINE.exec(levelLine) : null;
    if (levelMatch) {
      const level = mapDifficulty(levelMatch[1]);
      quiz.difficulty = level;
      if (!level) {
        issues.push(
          issue(
            'DIFFICULTY_UNKNOWN',
            'error',
            `Unknown difficulty "${clean(levelMatch[1])}".`
          )
        );
      }
      index += 1;
    } else {
      issues.push(
        issue(
          'DIFFICULTY_MISSING',
          'error',
          'There is no line "Quiz, Schwierigkeitsgrad: ..." after the heading.'
        )
      );
    }
  }

  // Questions
  const drafts: DraftQuestion[] = [];
  let current: DraftQuestion | null = null;
  let previousNumber = 0;

  for (; index < lines.length; index += 1) {
    const text = lines[index];
    const start = QUESTION_START.exec(text);
    if (start && (current === null || current.state !== 'question')) {
      const number = Number(start[1]);
      if (number !== previousNumber + 1) {
        const kind =
          number === previousNumber
            ? `question ${number} appears twice`
            : number < previousNumber
              ? `question ${number} comes after question ${previousNumber}`
              : previousNumber === 0
                ? `the numbering starts at ${number}, not at 1`
                : `question ${number} follows question ${previousNumber}, there is a gap`;
        issues.push(
          issue('QUESTION_NUMBER_GAP', 'error', `Numbering: ${kind}.`, number)
        );
      }
      previousNumber = number;
      current = {
        number,
        text: clean(start[2]),
        options: [],
        answers: [],
        rationale: null,
        state: 'question',
      };
      drafts.push(current);
      continue;
    }
    if (!current) {
      issues.push(
        issue(
          'UNPARSED_LINE',
          'warning',
          `Text before the first question was ignored: "${text.slice(0, 60)}".`
        )
      );
      continue;
    }
    const answer = ANSWER_LINE.exec(text);
    if (answer) {
      current.answers.push(answer[1]);
      current.state = 'answered';
      continue;
    }
    const rationale = RATIONALE_LINE.exec(text);
    if (rationale) {
      if (current.rationale !== null) {
        issues.push(
          issue(
            'RATIONALE_MULTIPLE',
            'warning',
            'A second rationale was joined to the first.',
            current.number
          )
        );
        current.rationale =
          `${current.rationale} ${clean(rationale[1])}`.trim();
      } else {
        current.rationale = clean(rationale[1]);
      }
      current.state = 'rationale';
      continue;
    }
    const option = OPTION_LINE.exec(text);
    if (
      option &&
      (current.state === 'question' || current.state === 'options')
    ) {
      current.options.push({
        letter: option[1].toUpperCase(),
        text: clean(option[2]),
      });
      current.state = 'options';
      continue;
    }
    if (current.state === 'question') {
      current.text = `${current.text} ${text}`.trim();
    } else if (current.state === 'rationale') {
      current.rationale = `${current.rationale ?? ''} ${text}`.trim();
    } else {
      issues.push(
        issue(
          'UNPARSED_LINE',
          'error',
          `Text that fits no part of question ${current.number}: "${text.slice(0, 60)}".`,
          current.number
        )
      );
    }
  }

  // Validation per question
  for (const draft of drafts) {
    const n = draft.number;
    const letters = draft.options.map(o => o.letter);
    if (draft.options.length !== 4) {
      issues.push(
        issue(
          'OPTION_COUNT',
          'error',
          `Question ${n} has ${draft.options.length} options, expected exactly 4 (A to D).`,
          n
        )
      );
    }
    if (letters.join('') !== 'ABCDEFGH'.slice(0, letters.length)) {
      issues.push(
        issue(
          'OPTION_ORDER',
          'error',
          `The options of question ${n} are ${letters.join(', ')}, expected A, B, C, D in this order.`,
          n
        )
      );
    }
    if (draft.options.some(o => o.text.length === 0)) {
      issues.push(
        issue(
          'OPTION_EMPTY',
          'error',
          `An option of question ${n} has no text.`,
          n
        )
      );
    }

    let correctLetter: string | null = null;
    if (draft.answers.length === 0) {
      issues.push(
        issue(
          'ANSWER_MISSING',
          'error',
          `Question ${n} has no "Richtige Antwort".`,
          n
        )
      );
    } else if (draft.answers.length > 1) {
      issues.push(
        issue(
          'ANSWER_MULTIPLE',
          'error',
          `Question ${n} has ${draft.answers.length} lines "Richtige Antwort", expected exactly one.`,
          n
        )
      );
    } else {
      const { letters: found, lower } = answerLetters(draft.answers[0]);
      if (found.length === 0 && draft.answers[0].trim().length === 0) {
        issues.push(
          issue(
            'ANSWER_MISSING',
            'error',
            `Question ${n} has an empty "Richtige Antwort".`,
            n
          )
        );
      } else if (found.length > 1) {
        issues.push(
          issue(
            'ANSWER_MULTIPLE',
            'error',
            `Question ${n} names several correct answers (${found.join(', ')}), expected exactly one.`,
            n
          )
        );
      } else if (found.length === 0 || !letters.includes(found[0])) {
        issues.push(
          issue(
            'ANSWER_INVALID',
            'error',
            `The correct answer "${clean(draft.answers[0]).slice(0, 40)}" of question ${n} is none of its options.`,
            n
          )
        );
      } else {
        correctLetter = found[0];
        if (lower) {
          issues.push(
            issue(
              'ANSWER_LOWERCASE',
              'warning',
              `The correct answer of question ${n} is written in lower case.`,
              n
            )
          );
        }
      }
    }
    if (draft.rationale === null || draft.rationale.length === 0) {
      issues.push(
        issue(
          'RATIONALE_MISSING',
          'error',
          `Question ${n} has no "Kurzbegründung".`,
          n
        )
      );
    }

    const question: QuizQuestion = {
      number: n,
      text: draft.text,
      options: draft.options,
      correctLetter,
      rationale:
        draft.rationale && draft.rationale.length > 0 ? draft.rationale : null,
      difficulty: quiz.kind === 'global' ? globalQuestionDifficulty(n) : null,
    };
    quiz.questions.push(question);
  }

  const expectedQuestions =
    options.expectedQuestions ?? (quiz.kind === 'global' ? 20 : undefined);
  if (drafts.length === 0) {
    issues.push(
      issue('NO_QUESTIONS', 'error', 'The document contains no question.')
    );
  } else if (
    expectedQuestions !== undefined &&
    drafts.length !== expectedQuestions
  ) {
    issues.push(
      issue(
        'QUESTION_COUNT',
        'error',
        `The document has ${drafts.length} questions, expected ${expectedQuestions}.`
      )
    );
  }
  return makeResult(quiz, issues);
}

export interface TraineeQuiz {
  kind: ParsedQuiz['kind'];
  enablerCode: string | null;
  componentKey: string | null;
  title: string | null;
  difficulty: ParsedQuiz['difficulty'];
  questions: Array<{
    number: number;
    text: string;
    options: QuizOption[];
    difficulty: Difficulty | null;
  }>;
}

// A marker of a solution in text that trainees would see. Last line of defence:
// a view that contains one is refused, whatever the issue list says.
const SOLUTION_MARKERS = [
  /Richtige\s+Antwort/i,
  /Kurzbegr(?:ü|ue)ndung/i,
  /L(?:ö|oe)sungs?szenario/i,
  /Fachwissen\s+zur\s+L(?:ö|oe)sung/i,
];
const hasSolutionMarker = (texts: string[]) =>
  texts.some(text => SOLUTION_MARKERS.some(marker => marker.test(text)));

/**
 * The part of a quiz that trainees may see: no correct answer, no rationale.
 * Fails closed: returns null when the parse result has an error or when a
 * solution marker is found in the visible text.
 */
export function toTraineeQuiz(
  result: ParseResult<ParsedQuiz>
): TraineeQuiz | null {
  if (!result.ok) return null;
  const quiz = result.value;
  const view: TraineeQuiz = {
    kind: quiz.kind,
    enablerCode: quiz.enablerCode,
    componentKey: quiz.componentKey,
    title: quiz.title,
    difficulty: quiz.difficulty,
    questions: quiz.questions.map(question => ({
      number: question.number,
      text: question.text,
      options: question.options.map(option => ({ ...option })),
      difficulty: question.difficulty,
    })),
  };
  const visible = [
    view.title ?? '',
    ...view.questions.flatMap(q => [q.text, ...q.options.map(o => o.text)]),
  ];
  return hasSolutionMarker(visible) ? null : view;
}

// Scenario ------------------------------------------------------------------

const SECTION_PATTERNS = {
  situation: /^Ausgangssituation\s*:?$/i,
  solution: /^L(?:ö|oe)sung(?:s?szenario)?\s*:?$/i,
  knowledgeContribution:
    /^Wie das Fachwissen zur L(?:ö|oe)sung beitr(?:ä|ae)gt\s*:?$/i,
} as const;
type SectionName = keyof typeof SECTION_PATTERNS;
const SECTION_ORDER: SectionName[] = [
  'situation',
  'solution',
  'knowledgeContribution',
];
// A line that starts like a section heading but is none (for example
// "Lösungsszenario (nur Trainer)") must not end up in the previous section.
const SECTION_LIKE = /^(?:Ausgangssituation|L(?:ö|oe)sung|Wie das Fachwissen)/i;
const SECTION_LABEL: Record<SectionName, string> = {
  situation: 'Ausgangssituation',
  solution: 'Lösungsszenario',
  knowledgeContribution: 'Wie das Fachwissen zur Lösung beiträgt',
};

/**
 * Parses the text of a scenario file: heading "Szenario 1b) Title" and the
 * sections Ausgangssituation (visible for trainees), Lösungsszenario and "Wie
 * das Fachwissen zur Lösung beiträgt" (solutions, trainer only).
 */
export function parseScenarioText(
  input: SourceInput
): ParseResult<ParsedScenario> {
  const issues: ImportIssue[] = [];
  const paragraphs = toParagraphs(input);
  const lines = paragraphs.map(paragraph => paragraph.text);
  const scenario: ParsedScenario = {
    code: null,
    title: null,
    situation: '',
    solution: '',
    knowledgeContribution: '',
    visibility: {
      situation: 'trainee',
      solution: 'trainer',
      knowledgeContribution: 'trainer',
    },
  };
  const nonEmpty = lines.filter(text => text.length > 0);
  if (nonEmpty.length === 0) {
    issues.push(issue('EMPTY_INPUT', 'error', 'The document has no text.'));
    return makeResult(scenario, issues);
  }

  const headingLine = nonEmpty[0];
  const heading = matchEnablerHeading(
    headingLine,
    SCENARIO_HEADING,
    SCENARIO_HEADING_LOOSE
  );
  if (heading) {
    scenario.code = heading.code;
    scenario.title = heading.title;
    if (heading.variant) {
      issues.push(
        issue(
          'HEADING_VARIANT',
          'warning',
          `The heading has another form than "Szenario 1b) Title": "${headingLine}".`
        )
      );
    }
  } else {
    scenario.title = headingLine;
    issues.push(
      issue(
        'HEADING_FORMAT',
        'error',
        `The heading carries no scenario code: "${headingLine}".`
      )
    );
  }

  const content: Record<SectionName, string[]> = {
    situation: [],
    solution: [],
    knowledgeContribution: [],
  };
  const seen: SectionName[] = [];
  let active: SectionName | null = null;
  let skippedHeading = false;
  for (const { text, bold } of paragraphs) {
    if (!skippedHeading) {
      if (text.length > 0) skippedHeading = true;
      continue;
    }
    if (text.length === 0) continue;
    const name = SECTION_ORDER.find(section =>
      SECTION_PATTERNS[section].test(text)
    );
    if (name) {
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
    if (
      bold &&
      text.length <= 60 &&
      !/[.!?]$/.test(text) &&
      !SECTION_LIKE.test(text)
    ) {
      issues.push(
        issue(
          'SECTION_UNKNOWN_HEADING',
          'error',
          `A bold line looks like a heading but is none of the known sections: "${text}".`
        )
      );
    }
    if (SECTION_LIKE.test(text)) {
      issues.push(
        issue(
          'SECTION_HEADING_VARIANT',
          'error',
          `A line looks like a section heading but is none: "${text.slice(0, 60)}".`
        )
      );
    }
    if (active) {
      content[active].push(text);
    } else {
      issues.push(
        issue(
          'UNPARSED_LINE',
          'warning',
          `Text before the first section was ignored: "${text.slice(0, 60)}".`
        )
      );
    }
  }

  for (const name of SECTION_ORDER) {
    if (!seen.includes(name)) {
      issues.push(
        issue(
          'SECTION_MISSING',
          'error',
          `The section "${SECTION_LABEL[name]}" is missing.`
        )
      );
    } else if (content[name].length === 0) {
      issues.push(
        issue(
          'SECTION_EMPTY',
          'error',
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

  scenario.situation = content.situation.join('\n\n');
  scenario.solution = content.solution.join('\n\n');
  scenario.knowledgeContribution = content.knowledgeContribution.join('\n\n');
  return makeResult(scenario, issues);
}

export interface TraineeScenario {
  code: string | null;
  title: string | null;
  situation: string;
}

/**
 * The part of a scenario that trainees may see: only the starting situation.
 * Fails closed: returns null when the parse result has an error or when a
 * solution marker is found in the situation.
 */
export function toTraineeScenario(
  result: ParseResult<ParsedScenario>
): TraineeScenario | null {
  if (!result.ok) return null;
  const scenario = result.value;
  if (hasSolutionMarker([scenario.title ?? '', scenario.situation])) {
    return null;
  }
  return {
    code: scenario.code,
    title: scenario.title,
    situation: scenario.situation,
  };
}
