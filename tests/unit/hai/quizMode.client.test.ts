/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { authFetch } from '@/lib/authFetch';
import { errorKeyFor, submitQuizAnswer } from '@/lib/hai/quizMode/client';

jest.mock('@/lib/authFetch', () => ({
  __esModule: true,
  authFetch: jest.fn(),
}));

// Behavior under test: the answer call of src/lib/hai/quizMode/client.ts. A
// withheld solution (the quiz is not passed yet) becomes feedback without a
// right option and without an explanation, whatever else the body carries.

const authFetchMock = authFetch as unknown as jest.Mock<
  (url: string, init?: RequestInit) => Promise<Response>
>;

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });

describe('errorKeyFor', () => {
  it('names the attempt limit of a question apart from the limit of the route', () => {
    expect(errorKeyFor(429, 'QUESTION_ATTEMPTS_EXCEEDED')).toBe(
      'attemptsExceeded'
    );
    expect(errorKeyFor(429, 'RATE_LIMITED')).toBe('rateLimited');
    expect(errorKeyFor(429)).toBe('rateLimited');
  });

  it('names the reason of a 403 by its stable code (denial.ts)', () => {
    expect(errorKeyFor(403, 'ENABLER_LOCKED')).toBe('locked');
    expect(errorKeyFor(403, 'QUIZ_LOCKED')).toBe('locked');
    expect(errorKeyFor(403, 'PRO_REQUIRED')).toBe('planRequired');
    expect(errorKeyFor(403, 'AWAITING_ACTIVATION')).toBe('awaitingActivation');
    expect(errorKeyFor(403, 'COURSE_NOT_ASSIGNED')).toBe('notAssigned');
    expect(errorKeyFor(403, 'SOMETHING_ELSE')).toBe('forbidden');
    expect(errorKeyFor(403)).toBe('forbidden');
  });

  it('never shows a failure of the server as a missing right', () => {
    for (const status of [500, 502, 503]) {
      expect(errorKeyFor(status, 'PRO_REQUIRED')).toBe('generic');
    }
  });
});

describe('submitQuizAnswer', () => {
  beforeEach(() => authFetchMock.mockReset());

  it('turns a withheld answer into feedback with no solution', async () => {
    authFetchMock.mockResolvedValue(
      json(200, {
        solutionWithheld: true,
        correct: false,
        selectedOptionIds: ['o2'],
        multiple: false,
        correctCount: null,
        enablerId: 'e1',
      })
    );
    expect(await submitQuizAnswer('q1', ['o2'])).toEqual({
      kind: 'ok',
      feedback: {
        correct: false,
        selectedOptionIds: ['o2'],
        correctOptionIds: [],
        explanation: null,
        solutionWithheld: true,
        correctCount: null,
      },
    });
  });

  it('never takes a solution from a withheld body, even a stray one', async () => {
    authFetchMock.mockResolvedValue(
      json(200, {
        solutionWithheld: true,
        correct: false,
        correctOptionIds: ['o1'],
        explanation: 'Darum.',
        correctCount: 2,
      })
    );
    const result = await submitQuizAnswer('q1', ['o2']);
    expect(result).toMatchObject({
      kind: 'ok',
      feedback: {
        correctOptionIds: [],
        explanation: null,
        solutionWithheld: true,
        correctCount: 2,
      },
    });
  });

  it('takes the solution and the explanation of a released answer', async () => {
    authFetchMock.mockResolvedValue(
      json(200, {
        solutionWithheld: false,
        correct: false,
        correctOptionIds: ['o1'],
        explanation: 'Darum.',
      })
    );
    expect(await submitQuizAnswer('q1', ['o2'])).toEqual({
      kind: 'ok',
      feedback: {
        correct: false,
        selectedOptionIds: ['o2'],
        correctOptionIds: ['o1'],
        explanation: 'Darum.',
        solutionWithheld: false,
        correctCount: null,
      },
    });
  });

  it('rejects a body that is neither a withheld nor a complete answer', async () => {
    authFetchMock.mockResolvedValue(json(200, { correct: true }));
    expect(await submitQuizAnswer('q1', ['o1'])).toEqual({
      kind: 'error',
      errorKey: 'generic',
    });
  });

  it('maps the 429 of the attempt limit to its own message key', async () => {
    authFetchMock.mockResolvedValue(
      json(429, {
        error: 'Too many attempts at this question',
        code: 'QUESTION_ATTEMPTS_EXCEEDED',
      })
    );
    expect(await submitQuizAnswer('q1', ['o1'])).toEqual({
      kind: 'error',
      errorKey: 'attemptsExceeded',
    });
  });

  it('answers a network failure with the network key', async () => {
    authFetchMock.mockRejectedValue(new Error('offline'));
    expect(await submitQuizAnswer('q1', ['o1'])).toEqual({
      kind: 'error',
      errorKey: 'network',
    });
  });
});
