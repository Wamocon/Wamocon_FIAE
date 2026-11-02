/**
 * HAI quiz mode: the rate limit of the two routes.
 *
 * Per person and route, in the memory of one server instance (src/lib/
 * rate-limit.ts). The numbers leave room for a quick learner (one question
 * every few seconds) and stop a script that tries to read out the whole pool.
 * The answer route is the one that matters: it tells right or wrong and, once
 * the quiz is passed, the solution. Besides the limit per route there is a limit
 * of attempts per person and question (QUIZ_MODE_ATTEMPT_LIMIT).
 *
 * @module lib/hai/quizMode/limits
 */

import { NextResponse } from 'next/server';
import { checkRateLimit } from '@/lib/rate-limit';

export const QUIZ_MODE_LIMITS = {
  next: { limit: 40, windowMs: 60_000 },
  answer: { limit: 80, windowMs: 60_000 },
} as const;

export type QuizModeRoute = keyof typeof QUIZ_MODE_LIMITS;

/**
 * Attempts of one person at one question while its solution is withheld (the
 * quiz of the question is not passed yet). Without this a person could try the
 * options of a question one after the other and read the key from the verdict
 * right or wrong, which the withheld solution is meant to prevent. The quiz mode
 * never asks the same question twice in a session, so a learner needs one
 * attempt per question and round. Three per question and hour leave room for a
 * second round and a slip of the finger, and stop the trial of four or more
 * options. After the pass the solution is shown anyway, so the limit does not
 * apply then (and not to trainers). Like all limits here it lives in the memory
 * of one server instance (src/lib/rate-limit.ts).
 */
export const QUIZ_MODE_ATTEMPT_LIMIT = {
  limit: 3,
  windowMs: 60 * 60_000,
} as const;

/**
 * A 429 response when the person has used up the attempts at this question,
 * otherwise null. The answer says what happened and when to try again, and
 * carries no solution. One attempt is counted per call, so call it only for an
 * attempt that is really graded.
 */
export function quizModeAttemptLimit(
  userId: string,
  questionId: string
): NextResponse | null {
  const result = checkRateLimit(
    `hai-quiz-mode:attempt:${userId}:${questionId}`,
    QUIZ_MODE_ATTEMPT_LIMIT
  );
  if (result.allowed) return null;
  return NextResponse.json(
    {
      error: 'Too many attempts at this question',
      code: 'QUESTION_ATTEMPTS_EXCEEDED',
    },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } }
  );
}

/** A 429 response when the person is over the limit, otherwise null. */
export function quizModeRateLimit(
  userId: string,
  route: QuizModeRoute
): NextResponse | null {
  const result = checkRateLimit(
    `hai-quiz-mode:${route}:${userId}`,
    QUIZ_MODE_LIMITS[route]
  );
  if (result.allowed) return null;
  return NextResponse.json(
    { error: 'Too many requests', code: 'RATE_LIMITED' },
    { status: 429, headers: { 'Retry-After': String(result.retryAfterSec) } }
  );
}
