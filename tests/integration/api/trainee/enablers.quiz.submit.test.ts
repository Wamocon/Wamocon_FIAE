/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';

function makePost(url: string, body: any) {
  return {
    url,
    json: async () => body,
  } as any;
}

async function importHandlerWithDb(mockDb: any) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  const mod = await import('@/app/api/trainee/enablers/[enablerId]/quiz/submit/route');
  return mod.POST as (req: any, ctx: { params: Promise<{ enablerId: string }> }) => Promise<Response>;
}

describe('API: POST /api/trainee/enablers/[enablerId]/quiz/submit', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('computes score and saves submission + answers', async () => {
    // DB call order and returns:
    // 1) enabler
    // 2) member
    // 3) enablerQuizzes link
    // 4) quiz
    // 5) questions
    // 6) options
    const sequence: any[] = [
      [{ id: 'e1', isActive: true, courseId: 'c1' }],
      [{ userId: 't1', courseId: 'c1' }],
      [{ enablerId: 'e1', quizId: 'q1' }],
      [{ id: 'q1', title: 'T' }],
      [
        { id: 'q-1', quizId: 'q1', questionText: 'Q1' },
        { id: 'q-2', quizId: 'q1', questionText: 'Q2' },
        { id: 'q-3', quizId: 'q1', questionText: 'Q3' },
      ],
      [
        { id: 'o-1', questionId: 'q-1', isCorrect: true },
        { id: 'o-2', questionId: 'q-1', isCorrect: false },
        { id: 'o-3', questionId: 'q-2', isCorrect: true },
        { id: 'o-4', questionId: 'q-3', isCorrect: false },
      ],
    ];
    let idx = 0;
    let savedSubmission: any = null;
    let savedAnswers: any[] = [];
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({
          where: () => sequence[idx++],
        }),
      })),
      transaction: jest.fn(async (fn: any) => {
        const tx = {
          insert: (table: any) => ({
            values: (values: any) => ({
              returning: () => {
                if (Array.isArray(values)) {
                  savedAnswers = values;
                  return [];
                }
                savedSubmission = values;
                return [{ id: 'sub-1', ...values }];
              },
            }),
          }),
        };
        return fn(tx);
      }),
    };

    const POST = await importHandlerWithDb(mockDb);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/quiz/submit', {
        traineeId: 't1',
        answers: [
          { questionId: 'q-1', selectedOptionId: 'o-1' }, // correct
          { questionId: 'q-2', selectedOptionId: 'o-3' }, // correct
          { questionId: 'q-3', selectedOptionId: 'o-4' }, // wrong
        ],
      }),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(200);
    // 2 correct out of 3 -> 67 (rounded)
    expect(body.score).toBe(67);
    expect(body.submissionId).toBe('sub-1');
  // Ensure persisted
  expect(savedSubmission).toMatchObject({ traineeId: 't1', quizId: 'q1', isReviewed: false, score: 67 });
    // Feedback correctness matches answers
  const byQ = new Map<string, any>(body.feedback.map((f: any) => [String(f.questionId), f]));
    expect(byQ.get('q-1')!.correct).toBe(true);
    expect(byQ.get('q-2')!.correct).toBe(true);
    expect(byQ.get('q-3')!.correct).toBe(false);
  });

  it('400 if no quiz linked', async () => {
    const sequence: any[] = [
      [{ id: 'e1', isActive: true, courseId: 'c1' }],
      [{ userId: 't1', courseId: 'c1' }],
      [], // link missing
    ];
    let idx = 0;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({ where: () => sequence[idx++] }),
      })),
    };
    const POST = await importHandlerWithDb(mockDb);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/quiz/submit', { traineeId: 't1', answers: [{ questionId: 'q', selectedOptionId: 'o' }] }),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(400);
    expect(body).toEqual({ error: 'No quiz' });
  });

  it('403 if not member of course', async () => {
    const sequence: any[] = [
      [{ id: 'e1', isActive: true, courseId: 'c1' }],
      [], // not a member
    ];
    let idx = 0;
    const mockDb = {
      select: jest.fn().mockImplementation(() => ({
        from: () => ({ where: () => sequence[idx++] }),
      })),
    };
    const POST = await importHandlerWithDb(mockDb);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/quiz/submit', { traineeId: 't1', answers: [{ questionId: 'q', selectedOptionId: 'o' }] }),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });
});
