/**
 * HAI quiz mode: the rate limit of the two routes.
 *
 * Per person and route, in the memory of one server instance (src/lib/
 * rate-limit.ts). The numbers leave room for a quick learner (one question
 * every few seconds) and stop a script that tries to read out the whole pool.
 * The answer route reveals the solution after an attempt, so it is the one
 * that matters.
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
