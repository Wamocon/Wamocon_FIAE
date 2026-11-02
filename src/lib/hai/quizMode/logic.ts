/**
 * HAI quiz mode: the pure rules (no database, no server imports).
 *
 * The quiz mode is a practice without grading: the HAI asks the questions of
 * the existing lesson quizzes one by one. Nothing here writes anything.
 *
 * Two shapes of a question exist and must never be mixed up:
 *  - QuizQuestionSource: what the server reads from the database, including
 *    is_correct and the explanation. It never leaves the server.
 *  - QuizQuestionPublic: what the browser gets BEFORE the attempt. It is built
 *    field by field (toPublicQuestion), so a new column of the source can never
 *    slip into the answer by accident.
 *
 * The solution (gradeAnswer) is returned only by the answer route, after the
 * attempt.
 *
 * @module lib/hai/quizMode/logic
 */

/** Most questions the client may name as "already asked" in one request. */
export const QUIZ_MODE_MAX_EXCLUDE = 500;

/** Most options one answer may contain (a question has far fewer). */
export const QUIZ_MODE_MAX_SELECTED = 12;

/** Longest topic text taken from a request. */
export const QUIZ_MODE_MAX_TOPIC_CHARS = 80;

/** How many candidates are checked at once while a valid question is searched. */
export const QUIZ_MODE_CANDIDATE_BATCH = 8;

export interface QuizOptionSource {
  id: string;
  text: string;
  isCorrect: boolean;
  /** Stored on the correct option by the author, may be blank. */
  explanation: string | null;
  orderIndex: number | null;
}

export interface QuizQuestionSource {
  id: string;
  text: string;
  enablerId: string;
  enablerTitle: string;
  courseTitle: string | null;
  /** Page of the enabler for the summary, null where there is none (trainer). */
  enablerHref: string | null;
  options: QuizOptionSource[];
}

/** A question without its options, as the candidate list of the pool. */
export interface QuizCandidate {
  id: string;
  text: string;
  enablerId: string;
  enablerTitle: string;
  courseTitle: string | null;
  /** Page of the enabler for the summary, null where there is none (trainer). */
  enablerHref: string | null;
}

export interface QuizOptionPublic {
  id: string;
  text: string;
}

export interface QuizQuestionPublic {
  id: string;
  text: string;
  /** More than one option is right: the person selects several. */
  multiple: boolean;
  options: QuizOptionPublic[];
  enablerId: string;
  enablerTitle: string;
  courseTitle: string | null;
  /** Page of the enabler for the summary, null where there is none (trainer). */
  enablerHref: string | null;
}

export type Rng = () => number;

/** An answer option that has to stay at the end ("Alle genannten", "Keine"). */
const POSITIONAL_OPTION =
  /^\s*(?:alle|keine|beide|none|all)\b.{0,40}\b(?:oben|genannt|vorher|aufgef[uü]hrt|richtig|falsch|antworten|above|these|answers)\b/i;

/** Lower case, umlauts as ae/oe/ue/ss, marks removed: the comparison form. */
export function foldText(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[\p{M}\p{Cf}]/gu, '');
}

function isBlank(value: unknown): boolean {
  return typeof value !== 'string' || value.trim() === '';
}

/**
 * A question the mode can ask: text, at least two options with text, at least
 * one correct option, and not every option correct (that would be no question).
 */
export function isAskable(source: QuizQuestionSource): boolean {
  if (isBlank(source.text)) return false;
  if (source.options.length < 2) return false;
  if (source.options.some(o => isBlank(o.text))) return false;
  const correct = source.options.filter(o => o.isCorrect).length;
  return correct >= 1 && correct < source.options.length;
}

/**
 * The options in a random order. An option that refers to the others ("Alle
 * genannten Antworten", "Keine der oben genannten") stays at the end in the
 * order of the author, because it would make no sense anywhere else. Pure: the
 * source is not changed, the random source is a parameter.
 */
export function shuffleOptions<
  T extends { text: string; orderIndex?: number | null },
>(options: ReadonlyArray<T>, rng: Rng = Math.random): T[] {
  // The stored order of the author first. Rows without a position keep their
  // place (the sort is stable)
  const position = (o: { orderIndex?: number | null }) =>
    o.orderIndex ?? Number.MAX_SAFE_INTEGER;
  const sorted = [...options].sort((a, b) => position(a) - position(b));
  const tail = sorted.filter(o => POSITIONAL_OPTION.test(o.text));
  const head = sorted.filter(o => !POSITIONAL_OPTION.test(o.text));
  for (let i = head.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [head[i], head[j]] = [head[j], head[i]];
  }
  return [...head, ...tail];
}

/**
 * The question as the browser gets it BEFORE the attempt. Every field is named
 * here on purpose: no is_correct, no explanation, no order index.
 */
export function toPublicQuestion(
  source: QuizQuestionSource,
  rng: Rng = Math.random
): QuizQuestionPublic {
  const correctCount = source.options.filter(o => o.isCorrect).length;
  return {
    id: source.id,
    text: source.text,
    multiple: correctCount > 1,
    options: shuffleOptions(source.options, rng).map(o => ({
      id: o.id,
      text: o.text,
    })),
    enablerId: source.enablerId,
    enablerTitle: source.enablerTitle,
    courseTitle: source.courseTitle,
    enablerHref: source.enablerHref,
  };
}

export interface QuizVerdict {
  correct: boolean;
  correctOptionIds: string[];
  /** The explanation of the correct option(s), null when the author wrote none. */
  explanation: string | null;
}

/**
 * Grade one attempt. Right means: exactly the correct options and nothing
 * else (one for a choice question, all of them for a multiple one). A
 * selection with an option that is not part of the question is no attempt:
 * the caller checks that first (selectionBelongsTo).
 */
export function gradeAnswer(
  source: QuizQuestionSource,
  selectedOptionIds: ReadonlyArray<string>
): QuizVerdict {
  const correctIds = source.options.filter(o => o.isCorrect).map(o => o.id);
  const selected = new Set(selectedOptionIds.map(String));
  const correct =
    selected.size === correctIds.length &&
    correctIds.every(id => selected.has(String(id)));
  const explanations: string[] = [];
  for (const option of source.options) {
    if (!option.isCorrect || isBlank(option.explanation)) continue;
    const text = (option.explanation as string).trim();
    if (!explanations.includes(text)) explanations.push(text);
  }
  return {
    correct,
    correctOptionIds: correctIds,
    explanation: explanations.length > 0 ? explanations.join('\n\n') : null,
  };
}

/** True when every selected id is an option of the question (no foreign id). */
export function selectionBelongsTo(
  source: QuizQuestionSource,
  selectedOptionIds: ReadonlyArray<string>
): boolean {
  const own = new Set(source.options.map(o => String(o.id)));
  return selectedOptionIds.every(id => own.has(String(id)));
}

// ---------------------------------------------------------------------------
// Topic filter
// ---------------------------------------------------------------------------

/**
 * A word of the topic reduced to a stem, so "Primärschlüsseln" finds
 * "Primärschlüssel" and "Joins" finds "Join". Short words stay as they are.
 */
function stemOf(word: string): string {
  if (word.length >= 8) return word.slice(0, word.length - 2);
  if (word.length >= 5) return word.slice(0, word.length - 1);
  return word;
}

/** The topic as words of the comparison form, words of one or two letters dropped. */
export function topicWords(topic: string): string[] {
  return foldText(topic)
    .split(/[^a-z0-9#+.]+/)
    .map(w => w.replace(/^[.+]+|[.]+$/g, ''))
    .filter(w => w.length >= 3 || /^(c#|c\+\+)$/.test(w));
}

/** Whether a text contains every word of the topic (by stem). No words: always. */
export function matchesTopic(topic: string | null, haystack: string): boolean {
  if (!topic) return true;
  const words = topicWords(topic);
  if (words.length === 0) return true;
  const text = foldText(haystack);
  return words.every(word => text.includes(stemOf(word)));
}

/** The text a topic is searched in: titles of enabler and course, the question. */
export function candidateHaystack(candidate: QuizCandidate): string {
  return [candidate.enablerTitle, candidate.courseTitle ?? '', candidate.text]
    .filter(Boolean)
    .join(' ');
}

// ---------------------------------------------------------------------------
// Choosing the next question
// ---------------------------------------------------------------------------

export interface PoolSelection {
  /** The candidates left after the topic filter and the history. */
  remaining: QuizCandidate[];
  /** All candidates that fit the topic, asked or not. */
  total: number;
  /** Candidates of the topic that are already in the history. */
  asked: number;
}

/**
 * The candidates for the next question: those that fit the topic and are not
 * in the history of the session. When none is left but some fit the topic, all
 * were asked (remaining is empty, total is greater than zero).
 */
export function selectCandidates(
  pool: ReadonlyArray<QuizCandidate>,
  options: { topic?: string | null; exclude?: ReadonlyArray<string> }
): PoolSelection {
  const fit = pool.filter(c =>
    matchesTopic(options.topic ?? null, candidateHaystack(c))
  );
  const asked = new Set((options.exclude ?? []).map(String));
  const remaining = fit.filter(c => !asked.has(String(c.id)));
  return { remaining, total: fit.length, asked: fit.length - remaining.length };
}

/** A copy of the list in random order (Fisher-Yates). */
export function shuffled<T>(
  list: ReadonlyArray<T>,
  rng: Rng = Math.random
): T[] {
  const copy = [...list];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [copy[i], copy[j]] = [copy[j], copy[i]];
  }
  return copy;
}

// ---------------------------------------------------------------------------
// Voice: text to read and a spoken choice
// ---------------------------------------------------------------------------

const LETTERS = 'ABCDEFGHIJKL';

/** The letter of an option by its position: A, B, C ... */
export function optionLetter(index: number): string {
  return LETTERS[index] ?? String(index + 1);
}

/**
 * The text the voice assistant reads for a question: the question, then the
 * options with their letters. No solution, it is built from the public shape.
 */
export function speechTextOf(question: QuizQuestionPublic): string {
  const hint = question.multiple ? ' Mehrere Antworten sind richtig.' : '';
  const options = question.options
    .map((o, i) => `${optionLetter(i)}: ${o.text}`)
    .join('. ');
  return `${question.text}${hint} ${options}.`;
}

const ORDINALS: Array<[RegExp, number]> = [
  [/\b(?:erste|ersten|erstes|eins|1)\b/, 0],
  [/\b(?:zweite|zweiten|zweites|zwei|2)\b/, 1],
  [/\b(?:dritte|dritten|drittes|drei|3)\b/, 2],
  [/\b(?:vierte|vierten|viertes|vier|4)\b/, 3],
  [/\b(?:fuenfte|fuenften|fuenftes|fuenf|5)\b/, 4],
  [/\b(?:sechste|sechsten|sechstes|sechs|6)\b/, 5],
];

/**
 * A spoken or typed choice ("A", "Antwort b", "die zweite", "Option 3") as the
 * index of the option, or null when the text is no clear choice. A longer
 * sentence is no choice: the quiz must not take a chat message for an answer.
 */
export function matchSpokenChoice(
  text: string,
  optionCount: number
): number | null {
  const folded = foldText(text)
    .replace(/[.,;:!?"'()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (folded === '' || folded.split(' ').length > 4) return null;
  const stripped = folded
    .replace(
      /\b(?:die|der|das|antwort|option|nummer|nr|ich|nehme|nimm|waehle|nehm|ist)\b/g,
      ' '
    )
    .replace(/\s+/g, ' ')
    .trim();
  const letter = /^([a-l])$/.exec(stripped);
  if (letter) {
    const index = LETTERS.indexOf(letter[1].toUpperCase());
    return index < optionCount ? index : null;
  }
  for (const [pattern, index] of ORDINALS) {
    if (pattern.test(stripped) && index < optionCount) return index;
  }
  return null;
}
