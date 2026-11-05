/**
 * HAI quiz mode: validation of the request bodies (pure).
 *
 * Every id has to be a uuid (the database rejects anything else with a 500),
 * lists are capped, texts are cut. A body that does not fit is a 400 with a
 * message that names the field, never the value.
 *
 * @module lib/hai/quizMode/validate
 */

import { isUuid } from '@/lib/uuid';
import {
  QUIZ_MODE_MAX_EXCLUDE,
  QUIZ_MODE_MAX_SELECTED,
  QUIZ_MODE_MAX_TOPIC_CHARS,
} from './logic';
import { isRecord } from '@/lib/type-guards';

export interface NextRequestInput {
  enablerId: string | null;
  topic: string | null;
  exclude: string[];
}

export interface AnswerRequestInput {
  questionId: string;
  optionIds: string[];
}

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

/** Control characters out, blanks collapsed, cut to the topic limit. */
export function cleanTopicInput(value: string): string | null {
  const cleaned = value
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, QUIZ_MODE_MAX_TOPIC_CHARS)
    .trim();
  return cleaned === '' ? null : cleaned;
}

/** Body of POST /api/hai/quiz-mode/next. */
export function parseNextBody(body: unknown): Parsed<NextRequestInput> {
  if (!isRecord(body)) return { ok: false, error: 'Invalid body' };

  let enablerId: string | null = null;
  if (body.enablerId !== undefined && body.enablerId !== null) {
    if (!isUuid(body.enablerId))
      return { ok: false, error: 'Invalid enablerId' };
    enablerId = body.enablerId;
  }

  let topic: string | null = null;
  if (body.topic !== undefined && body.topic !== null) {
    if (typeof body.topic !== 'string')
      return { ok: false, error: 'Invalid topic' };
    topic = cleanTopicInput(body.topic);
  }

  let exclude: string[] = [];
  if (body.exclude !== undefined && body.exclude !== null) {
    if (
      !Array.isArray(body.exclude) ||
      body.exclude.length > QUIZ_MODE_MAX_EXCLUDE
    )
      return { ok: false, error: 'Invalid exclude' };
    if (!body.exclude.every(isUuid))
      return { ok: false, error: 'Invalid exclude' };
    exclude = Array.from(new Set(body.exclude as string[]));
  }

  return { ok: true, value: { enablerId, topic, exclude } };
}

/** Body of POST /api/hai/quiz-mode/answer. */
export function parseAnswerBody(body: unknown): Parsed<AnswerRequestInput> {
  if (!isRecord(body)) return { ok: false, error: 'Invalid body' };
  if (!isUuid(body.questionId))
    return { ok: false, error: 'Invalid questionId' };
  const optionIds = body.optionIds;
  if (
    !Array.isArray(optionIds) ||
    optionIds.length === 0 ||
    optionIds.length > QUIZ_MODE_MAX_SELECTED ||
    !optionIds.every(isUuid)
  ) {
    return { ok: false, error: 'Invalid optionIds' };
  }
  const unique = Array.from(new Set(optionIds as string[]));
  if (unique.length !== optionIds.length)
    return { ok: false, error: 'Invalid optionIds' };
  return {
    ok: true,
    value: { questionId: body.questionId, optionIds: unique },
  };
}
