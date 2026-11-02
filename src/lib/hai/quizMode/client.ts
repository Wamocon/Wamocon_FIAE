/**
 * HAI quiz mode: the browser side of the two routes.
 *
 * Every call goes through authFetch (the HAI routes take the person from the
 * bearer token). The answers are checked for their shape before the card sees
 * them, and a failure becomes a key of the interface (hai.quiz.error.<key>),
 * never the text of the server.
 *
 * @module lib/hai/quizMode/client
 */

import { authFetch } from '@/lib/authFetch';
import { DENIAL_CODES } from '../denial';
import type { QuizQuestionPublic } from './logic';
import type { QuizEmptyReason, QuizFeedback } from './session';

export type NextQuestionResult =
  | {
      kind: 'question';
      question: QuizQuestionPublic;
      total: number;
      remaining: number;
    }
  | { kind: 'empty'; reason: QuizEmptyReason; total?: number }
  | { kind: 'error'; errorKey: string };

export type AnswerResult =
  | { kind: 'ok'; feedback: QuizFeedback }
  | { kind: 'error'; errorKey: string };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** The key of the error text for a failed call. */
export function errorKeyFor(status: number, code?: unknown): string {
  if (status === 429 && code === 'QUESTION_ATTEMPTS_EXCEEDED')
    return 'attemptsExceeded';
  if (status === 429) return 'rateLimited';
  if (status === 403 && (code === 'ENABLER_LOCKED' || code === 'QUIZ_LOCKED'))
    return 'locked';
  // The reason in plain words (denial.ts): plan, release, course, else generic
  if (status === 403 && code === DENIAL_CODES.PRO_REQUIRED) {
    return 'planRequired';
  }
  if (status === 403 && code === 'AWAITING_ACTIVATION') {
    return 'awaitingActivation';
  }
  if (status === 403 && code === DENIAL_CODES.COURSE_NOT_ASSIGNED) {
    return 'notAssigned';
  }
  if (status === 403) return 'forbidden';
  if (status === 404) return 'notFound';
  if (status === 400) return 'invalid';
  return 'generic';
}

function asQuestion(value: unknown): QuizQuestionPublic | null {
  if (!isRecord(value)) return null;
  const { id, text, options, enablerId, enablerTitle } = value;
  if (
    typeof id !== 'string' ||
    typeof text !== 'string' ||
    typeof enablerId !== 'string' ||
    typeof enablerTitle !== 'string' ||
    !Array.isArray(options) ||
    options.length < 2
  ) {
    return null;
  }
  const parsedOptions = options.map(o =>
    isRecord(o) && typeof o.id === 'string' && typeof o.text === 'string'
      ? { id: o.id, text: o.text }
      : null
  );
  if (parsedOptions.some(o => o === null)) return null;
  return {
    id,
    text,
    multiple: value.multiple === true,
    options: parsedOptions as Array<{ id: string; text: string }>,
    enablerId,
    enablerTitle,
    courseTitle:
      typeof value.courseTitle === 'string' ? value.courseTitle : null,
    enablerHref:
      typeof value.enablerHref === 'string' ? value.enablerHref : null,
  };
}

const JSON_POST = {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
} as const;

/** Status and body of a response, a body that is no JSON counts as null. */
async function readResponse(
  res: Response
): Promise<{ status: number; data: unknown }> {
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    data = null;
  }
  return { status: res.status, data };
}

/** Ask the server for the next question of a session. */
export async function fetchNextQuestion(input: {
  enablerId: string | null;
  topic: string | null;
  exclude: string[];
}): Promise<NextQuestionResult> {
  try {
    const { status, data } = await readResponse(
      await authFetch('/api/hai/quiz-mode/next', {
        ...JSON_POST,
        body: JSON.stringify({
          enablerId: input.enablerId ?? undefined,
          topic: input.topic ?? undefined,
          exclude: input.exclude,
        }),
      })
    );
    if (status < 200 || status >= 300) {
      return {
        kind: 'error',
        errorKey: errorKeyFor(status, isRecord(data) ? data.code : undefined),
      };
    }
    if (!isRecord(data)) return { kind: 'error', errorKey: 'generic' };
    if (data.status === 'exhausted') {
      return {
        kind: 'empty',
        reason: 'exhausted',
        total: typeof data.total === 'number' ? data.total : undefined,
      };
    }
    if (data.status === 'empty') {
      return {
        kind: 'empty',
        reason:
          data.reason === 'no_topic_match' ? 'no_topic_match' : 'no_content',
      };
    }
    const question = asQuestion(data.question);
    if (data.status !== 'ok' || !question)
      return { kind: 'error', errorKey: 'generic' };
    return {
      kind: 'question',
      question,
      total: typeof data.total === 'number' ? data.total : 0,
      remaining: typeof data.remaining === 'number' ? data.remaining : 0,
    };
  } catch {
    return { kind: 'error', errorKey: 'network' };
  }
}

/**
 * Send the attempt. The answer carries the solution once the quiz of the
 * question is passed, before that only right or wrong (solutionWithheld).
 */
export async function submitQuizAnswer(
  questionId: string,
  optionIds: string[]
): Promise<AnswerResult> {
  try {
    const { status, data } = await readResponse(
      await authFetch('/api/hai/quiz-mode/answer', {
        ...JSON_POST,
        body: JSON.stringify({ questionId, optionIds }),
      })
    );
    if (status < 200 || status >= 300) {
      return {
        kind: 'error',
        errorKey: errorKeyFor(status, isRecord(data) ? data.code : undefined),
      };
    }
    if (!isRecord(data) || typeof data.correct !== 'boolean') {
      return { kind: 'error', errorKey: 'generic' };
    }
    if (data.solutionWithheld === true) {
      // Right or wrong only, whatever else the body might carry is ignored
      return {
        kind: 'ok',
        feedback: {
          correct: data.correct,
          selectedOptionIds: optionIds,
          correctOptionIds: [],
          explanation: null,
          solutionWithheld: true,
          correctCount:
            typeof data.correctCount === 'number' && data.correctCount > 1
              ? data.correctCount
              : null,
        },
      };
    }
    if (!Array.isArray(data.correctOptionIds)) {
      return { kind: 'error', errorKey: 'generic' };
    }
    return {
      kind: 'ok',
      feedback: {
        correct: data.correct,
        selectedOptionIds: optionIds,
        correctOptionIds: data.correctOptionIds.filter(
          (id): id is string => typeof id === 'string'
        ),
        explanation:
          typeof data.explanation === 'string' && data.explanation.trim() !== ''
            ? data.explanation
            : null,
        solutionWithheld: false,
        correctCount: null,
      },
    };
  } catch {
    return { kind: 'error', errorKey: 'network' };
  }
}
