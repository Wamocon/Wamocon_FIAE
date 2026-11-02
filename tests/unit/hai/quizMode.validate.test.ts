/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  cleanTopicInput,
  parseAnswerBody,
  parseNextBody,
} from '@/lib/hai/quizMode/validate';
import {
  QUIZ_MODE_ATTEMPT_LIMIT,
  QUIZ_MODE_LIMITS,
  quizModeAttemptLimit,
  quizModeRateLimit,
} from '@/lib/hai/quizMode/limits';
import { resetRateLimits } from '@/lib/rate-limit';

// Behavior under test: src/lib/hai/quizMode/validate.ts and limits.ts. Every id
// has to be a uuid, lists are capped, a body that does not fit is a 400 that
// names the field.

const ID = '20000000-0000-4000-8000-000000000001';
const ID2 = '20000000-0000-4000-8000-000000000002';

describe('parseNextBody', () => {
  it('accepts an empty body object', () => {
    expect(parseNextBody({})).toEqual({
      ok: true,
      value: { enablerId: null, topic: null, exclude: [] },
    });
  });

  it('takes enabler, topic and history, and removes duplicates from the history', () => {
    expect(
      parseNextBody({ enablerId: ID, topic: ' SQL ', exclude: [ID, ID2, ID] })
    ).toEqual({
      ok: true,
      value: { enablerId: ID, topic: 'SQL', exclude: [ID, ID2] },
    });
  });

  it('treats null like absent', () => {
    expect(
      parseNextBody({ enablerId: null, topic: null, exclude: null })
    ).toEqual({
      ok: true,
      value: { enablerId: null, topic: null, exclude: [] },
    });
  });

  it.each([
    ['null', null],
    ['a string', 'x'],
    ['an array', []],
    ['an enabler id that is no uuid', { enablerId: 'abc' }],
    ['an enabler id that is a number', { enablerId: 7 }],
    ['a topic that is a number', { topic: 7 }],
    ['an exclude that is no list', { exclude: ID }],
    ['an exclude with a non uuid', { exclude: [ID, 'nope'] }],
    ['an exclude that is too long', { exclude: Array(501).fill(ID) }],
  ])('rejects %s', (_name, body) => {
    const result = parseNextBody(body);
    expect(result.ok).toBe(false);
  });

  it('names the field in the error, not the value', () => {
    const result = parseNextBody({ enablerId: 'secret-value' });
    expect(result).toEqual({ ok: false, error: 'Invalid enablerId' });
  });

  it('cleans the topic: control characters out, cut to the limit, blank gives null', () => {
    expect(cleanTopicInput('SQL\u0000\n Joins')).toBe('SQL Joins');
    expect(cleanTopicInput('x'.repeat(200))).toHaveLength(80);
    expect(cleanTopicInput(' \n ')).toBeNull();
  });
});

describe('parseAnswerBody', () => {
  it('accepts one question and its options', () => {
    expect(parseAnswerBody({ questionId: ID, optionIds: [ID2] })).toEqual({
      ok: true,
      value: { questionId: ID, optionIds: [ID2] },
    });
  });

  it.each([
    ['no body', null],
    ['no question id', { optionIds: [ID] }],
    ['a question id that is no uuid', { questionId: 'x', optionIds: [ID] }],
    ['no options', { questionId: ID }],
    ['an empty list', { questionId: ID, optionIds: [] }],
    ['an option id that is no uuid', { questionId: ID, optionIds: ['x'] }],
    ['options that are no list', { questionId: ID, optionIds: ID2 }],
    ['the same option twice', { questionId: ID, optionIds: [ID2, ID2] }],
    ['too many options', { questionId: ID, optionIds: Array(13).fill(ID2) }],
  ])('rejects %s', (_name, body) => {
    expect(parseAnswerBody(body).ok).toBe(false);
  });
});

describe('quizModeRateLimit', () => {
  beforeEach(() => resetRateLimits());

  it('lets the limit through and then answers 429 with Retry-After', async () => {
    const { limit } = QUIZ_MODE_LIMITS.next;
    for (let i = 0; i < limit; i++) {
      expect(quizModeRateLimit('user-1', 'next')).toBeNull();
    }
    const blocked = quizModeRateLimit('user-1', 'next');
    expect(blocked?.status).toBe(429);
    expect(Number(blocked?.headers.get('Retry-After'))).toBeGreaterThanOrEqual(
      1
    );
    expect(await blocked?.json()).toEqual({
      error: 'Too many requests',
      code: 'RATE_LIMITED',
    });
  });

  it('counts per person and per route', () => {
    for (let i = 0; i < QUIZ_MODE_LIMITS.next.limit; i++) {
      quizModeRateLimit('user-1', 'next');
    }
    expect(quizModeRateLimit('user-1', 'next')?.status).toBe(429);
    expect(quizModeRateLimit('user-2', 'next')).toBeNull();
    expect(quizModeRateLimit('user-1', 'answer')).toBeNull();
  });
});

describe('quizModeAttemptLimit', () => {
  beforeEach(() => resetRateLimits());

  it('is three attempts per question and hour', () => {
    expect(QUIZ_MODE_ATTEMPT_LIMIT).toEqual({ limit: 3, windowMs: 3_600_000 });
  });

  it('lets the attempts through and then answers 429 with a code and no solution', async () => {
    for (let i = 0; i < QUIZ_MODE_ATTEMPT_LIMIT.limit; i++) {
      expect(quizModeAttemptLimit('user-1', 'q-1')).toBeNull();
    }
    const blocked = quizModeAttemptLimit('user-1', 'q-1');
    expect(blocked?.status).toBe(429);
    // an hour window: the person is told to wait, not a few seconds
    expect(Number(blocked?.headers.get('Retry-After'))).toBeGreaterThan(3000);
    expect(await blocked?.json()).toEqual({
      error: 'Too many attempts at this question',
      code: 'QUESTION_ATTEMPTS_EXCEEDED',
    });
  });

  it('counts per person and per question', () => {
    for (let i = 0; i < QUIZ_MODE_ATTEMPT_LIMIT.limit; i++) {
      quizModeAttemptLimit('user-1', 'q-1');
    }
    expect(quizModeAttemptLimit('user-1', 'q-1')?.status).toBe(429);
    expect(quizModeAttemptLimit('user-1', 'q-2')).toBeNull();
    expect(quizModeAttemptLimit('user-2', 'q-1')).toBeNull();
  });

  it('is independent of the limit of the route', () => {
    for (let i = 0; i < QUIZ_MODE_ATTEMPT_LIMIT.limit; i++) {
      quizModeAttemptLimit('user-1', 'q-1');
    }
    expect(quizModeRateLimit('user-1', 'answer')).toBeNull();
  });
});
