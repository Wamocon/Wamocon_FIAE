/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  mockCatalogScope,
  mockTraineeSession,
} from '../../../helpers/mockNext';

function makePost(url: string, body: any) {
  return {
    url,
    json: async () => body,
  } as any;
}

async function importHandlerWithDb(mockDb: any) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  mockTraineeSession();
  mockCatalogScope();
  const mod =
    await import('@/app/api/trainee/enablers/[enablerId]/quiz/submit/route');
  return mod.POST as (
    req: any,
    ctx: { params: Promise<{ enablerId: string }> }
  ) => Promise<Response>;
}

const enablerRow = {
  id: 'e1',
  isActive: true,
  courseId: 'c1',
  title: 'Enabler 1',
};
const memberRow = { userId: 't1', courseId: 'c1' };
const orgRow = { organizationId: 'org1' };

describe('API: POST /api/trainee/enablers/[enablerId]/quiz/submit', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('computes score and saves submission + answers', async () => {
    const { db, writes } = createTableDb(
      {
        profiles: [orgRow],
        enablers: [enablerRow],
        courseMembers: [memberRow],
        enablerQuizzes: [{ enablerId: 'e1', quizId: 'q1' }],
        quizzes: [{ id: 'q1', title: 'T' }],
        questions: [
          { id: 'q-1', quizId: 'q1', questionText: 'Q1' },
          { id: 'q-2', quizId: 'q1', questionText: 'Q2' },
          { id: 'q-3', quizId: 'q1', questionText: 'Q3' },
        ],
        options: [
          { id: 'o-1', questionId: 'q-1', isCorrect: true },
          { id: 'o-2', questionId: 'q-1', isCorrect: false },
          { id: 'o-3', questionId: 'q-2', isCorrect: true },
          { id: 'o-4', questionId: 'q-3', isCorrect: false },
        ],
      },
      { quizSubmissions: [{ id: 'sub-1' }] }
    );

    const POST = await importHandlerWithDb(db);
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
    expect(writes('insert', 'quizSubmissions')[0]).toMatchObject({
      traineeId: 't1',
      quizId: 'q1',
      isReviewed: false,
      score: 67,
      organizationId: 'org1',
    });
    expect(writes('insert', 'quizSubmissionAnswers')[0]).toHaveLength(3);
    // Feedback correctness matches answers
    const byQ = new Map<string, any>(
      body.feedback.map((f: any) => [String(f.questionId), f])
    );
    expect(byQ.get('q-1')!.correct).toBe(true);
    expect(byQ.get('q-2')!.correct).toBe(true);
    expect(byQ.get('q-3')!.correct).toBe(false);
  });

  it('400 if no quiz linked', async () => {
    const { db } = createTableDb({
      profiles: [orgRow],
      enablers: [enablerRow],
      courseMembers: [memberRow],
      enablerQuizzes: [], // link missing
    });
    const POST = await importHandlerWithDb(db);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/quiz/submit', {
        traineeId: 't1',
        answers: [{ questionId: 'q', selectedOptionId: 'o' }],
      }),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(400);
    expect(body).toEqual({ error: 'No quiz' });
  });

  it('403 if not member of course', async () => {
    const { db } = createTableDb({
      profiles: [orgRow],
      enablers: [enablerRow],
      courseMembers: [], // not a member
    });
    const POST = await importHandlerWithDb(db);
    const res = await POST(
      makePost('http://localhost/api/trainee/enablers/e1/quiz/submit', {
        traineeId: 't1',
        answers: [{ questionId: 'q', selectedOptionId: 'o' }],
      }),
      { params: Promise.resolve({ enablerId: 'e1' }) }
    );
    const body = await (res as any).json();
    expect((res as any).status).toBe(403);
    expect(body).toEqual({ error: 'Forbidden' });
  });
});
