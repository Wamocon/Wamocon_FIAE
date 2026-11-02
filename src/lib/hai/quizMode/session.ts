/**
 * HAI quiz mode: the state of one quiz session in the browser (pure reducer).
 *
 * The server keeps no state. The session lives here: the questions asked so
 * far (sent as "exclude" with the next request, so a question does not come
 * back until all are through), the attempts and the question on screen. No
 * answer is stored anywhere, ending the session throws everything away.
 *
 * @module lib/hai/quizMode/session
 */

import type { QuizQuestionPublic } from './logic';

export type QuizPhase =
  | 'loading'
  | 'question'
  | 'checking'
  | 'feedback'
  | 'summary'
  | 'empty'
  | 'error';

/** Why no question was delivered. */
export type QuizEmptyReason = 'no_content' | 'no_topic_match' | 'exhausted';

/** What the person asked for: an enabler, a topic, or everything open. */
export interface QuizScope {
  enablerId: string | null;
  topic: string | null;
}

export interface QuizFeedback {
  correct: boolean;
  selectedOptionIds: string[];
  /** Empty while the solution is withheld. */
  correctOptionIds: string[];
  /** Null while the solution is withheld. */
  explanation: string | null;
  /**
   * The server holds the solution back: the quiz of the question is not passed
   * yet. The card then says right or wrong and points to the quiz.
   */
  solutionWithheld: boolean;
  /** Right options of a multiple choice question while withheld, else null. */
  correctCount: number | null;
}

export interface QuizAttempt {
  questionId: string;
  enablerId: string;
  enablerTitle: string;
  enablerHref: string | null;
  correct: boolean;
  /** The solution of this question was not shown (quiz not passed yet). */
  solutionWithheld: boolean;
}

export interface QuizSessionState {
  phase: QuizPhase;
  scope: QuizScope;
  question: QuizQuestionPublic | null;
  feedback: QuizFeedback | null;
  attempts: QuizAttempt[];
  /** Ids of the questions delivered so far (the history of the session). */
  asked: string[];
  /** How many questions fit the scope, as the server counted them. */
  total: number | null;
  /** How many of them are left, the one on screen included. */
  remaining: number | null;
  reason: QuizEmptyReason | null;
  /** Suffix of the i18n key hai.quiz.error.<key>. */
  errorKey: string | null;
  /**
   * Name of the occupation the quiz is about (as the tab shows it), from the
   * server: the quiz follows the occupation chosen in the app, so the card says
   * which one it is. Null while the server has not said (or could not).
   */
  occupation: string | null;
}

export type QuizAction =
  | { type: 'start'; scope: QuizScope }
  | {
      type: 'question';
      question: QuizQuestionPublic;
      total: number;
      remaining: number;
      occupation?: string | null;
    }
  | {
      type: 'empty';
      reason: QuizEmptyReason;
      total?: number;
      occupation?: string | null;
    }
  | { type: 'checking' }
  | { type: 'answered'; feedback: QuizFeedback }
  | { type: 'loading' }
  | { type: 'finish' }
  | { type: 'restart' }
  | { type: 'failed'; errorKey: string }
  | { type: 'answerFailed'; errorKey: string };

export function initialQuizState(
  scope: QuizScope = { enablerId: null, topic: null }
): QuizSessionState {
  return {
    phase: 'loading',
    scope,
    question: null,
    feedback: null,
    attempts: [],
    asked: [],
    total: null,
    remaining: null,
    reason: null,
    errorKey: null,
    occupation: null,
  };
}

export function quizReducer(
  state: QuizSessionState,
  action: QuizAction
): QuizSessionState {
  switch (action.type) {
    case 'start':
      return initialQuizState(action.scope);
    case 'loading':
      return { ...state, phase: 'loading', feedback: null, errorKey: null };
    case 'question':
      return {
        ...state,
        phase: 'question',
        question: action.question,
        feedback: null,
        asked: state.asked.includes(action.question.id)
          ? state.asked
          : [...state.asked, action.question.id],
        total: action.total,
        remaining: action.remaining,
        reason: null,
        errorKey: null,
        occupation: action.occupation ?? state.occupation,
      };
    case 'checking':
      return state.phase === 'question'
        ? { ...state, phase: 'checking' }
        : state;
    case 'answered': {
      if (!state.question) return state;
      const question = state.question;
      return {
        ...state,
        phase: 'feedback',
        feedback: action.feedback,
        attempts: [
          ...state.attempts,
          {
            questionId: question.id,
            enablerId: question.enablerId,
            enablerTitle: question.enablerTitle,
            enablerHref: question.enablerHref,
            correct: action.feedback.correct,
            solutionWithheld: action.feedback.solutionWithheld,
          },
        ],
      };
    }
    case 'empty':
      return {
        ...state,
        phase: state.attempts.length > 0 ? 'summary' : 'empty',
        question: null,
        feedback: null,
        reason: action.reason,
        total: action.total ?? state.total,
        remaining: 0,
        occupation: action.occupation ?? state.occupation,
      };
    case 'finish':
      return { ...state, phase: 'summary', question: null, feedback: null };
    case 'restart':
      // Everything is through, or the person wants another round: the history
      // starts again, the scope and the occupation stay
      return { ...initialQuizState(state.scope), occupation: state.occupation };
    case 'failed':
      return { ...state, phase: 'error', errorKey: action.errorKey };
    case 'answerFailed':
      // The question stays on screen, the person can try the check again
      return {
        ...state,
        phase: state.question ? 'question' : 'error',
        errorKey: action.errorKey,
      };
    default:
      return state;
  }
}

export interface QuizSummary {
  total: number;
  correct: number;
  /** At least one solution stayed back (its quiz is not passed yet). */
  anyWithheld: boolean;
  /** Enablers with at least one wrong answer, the most wrong ones first. */
  repeat: Array<{
    enablerId: string;
    title: string;
    href: string | null;
    wrong: number;
  }>;
}

/** The result of a session: x of y right and the topics to repeat. */
export function buildSummary(
  attempts: ReadonlyArray<QuizAttempt>
): QuizSummary {
  const wrongBy = new Map<
    string,
    { title: string; href: string | null; wrong: number }
  >();
  for (const attempt of attempts) {
    if (attempt.correct) continue;
    const entry = wrongBy.get(attempt.enablerId);
    if (entry) entry.wrong += 1;
    else
      wrongBy.set(attempt.enablerId, {
        title: attempt.enablerTitle,
        href: attempt.enablerHref,
        wrong: 1,
      });
  }
  return {
    total: attempts.length,
    correct: attempts.filter(a => a.correct).length,
    anyWithheld: attempts.some(a => a.solutionWithheld),
    repeat: Array.from(wrongBy, ([enablerId, v]) => ({ enablerId, ...v })).sort(
      (a, b) => b.wrong - a.wrong || a.title.localeCompare(b.title)
    ),
  };
}

const UUID_SHAPE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * The scope from the start signal of the chat answer (lib/hai/quizMode/
 * start.ts), or null when the answer carries none or a malformed one. The
 * quiz route checks the enabler again, this only keeps junk out of the state.
 */
export function toQuizStartScope(raw: unknown): QuizScope | null {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw))
    return null;
  const { topic, enablerId } = raw as Record<string, unknown>;
  return {
    topic:
      typeof topic === 'string' && topic.trim() !== ''
        ? topic.trim().slice(0, 80)
        : null,
    enablerId:
      typeof enablerId === 'string' && UUID_SHAPE.test(enablerId)
        ? enablerId
        : null,
  };
}

/** The ids of the options that may be selected at once for a question. */
export function toggleSelection(
  question: Pick<QuizQuestionPublic, 'multiple'>,
  current: ReadonlyArray<string>,
  optionId: string
): string[] {
  if (!question.multiple) return [optionId];
  return current.includes(optionId)
    ? current.filter(id => id !== optionId)
    : [...current, optionId];
}
