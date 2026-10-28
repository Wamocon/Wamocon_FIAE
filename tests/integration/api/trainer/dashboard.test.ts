/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  mockCatalogScope,
  mockSession,
} from '../../../helpers/mockNext';

function makeGet(url: string) {
  return { url } as any;
}

async function importHandlerWithDb(
  mockDb: any,
  session: ReturnType<typeof fakeSession> | null = fakeSession({ id: 'tr1' })
) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  mockSession(session);
  mockCatalogScope();
  const mod = await import('@/app/api/trainer/dashboard/route');
  return mod.GET as (req: any) => Promise<Response>;
}

describe('API: Trainer Dashboard', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('401 without a session', async () => {
    const { db } = createTableDb();
    const GET = await importHandlerWithDb(db, null);
    const res = await GET(makeGet('http://localhost/api/trainer/dashboard'));
    expect(res.status).toBe(401);
  });

  it('403 for a trainee session', async () => {
    const { db } = createTableDb();
    const GET = await importHandlerWithDb(
      db,
      fakeSession({ role: 'TRAINEE', isTrainerLevel: false })
    );
    const res = await GET(makeGet('http://localhost/api/trainer/dashboard'));
    expect(res.status).toBe(403);
  });

  it('GET /api/trainer/dashboard returns summary', async () => {
    const { db } = createTableDb({
      // Trainee lookup and the trainer's own org lookup share this table
      profiles: [
        {
          id: 't1',
          fullName: 'Trainee 1',
          avatarUrl: null,
          isActive: true,
          organizationId: 'org1',
        },
        {
          id: 't2',
          fullName: 'Trainee 2',
          avatarUrl: null,
          isActive: true,
          organizationId: 'org1',
        },
      ],
      courses: [{ id: 'c1', title: 'Course 1' }],
      courseMembers: [],
      enablers: [
        { id: 'e1', courseId: 'c1', scenarioPdfUrl: null },
        { id: 'e2', courseId: 'c1', scenarioPdfUrl: null },
      ],
      useCases: [],
      // e2 needs a passed quiz: t1 passed it, t2 did not
      enablerQuizLinks: [{ enablerId: 'e2', quizId: 'q1' }],
      quizzes: [{ id: 'q1', isActive: true }],
      questions: [{ id: 'qq1', quizId: 'q1', questionType: 'MCQ' }],
      quizSubmissions: {
        sequence: [
          [
            {
              traineeId: 't1',
              quizId: 'q1',
              score: 80,
              submittedAt: new Date(),
            },
          ],
          [{ c: 1 }], // pending quiz reviews
          [{ c: 0 }], // pending lesson quiz reviews
        ],
      },
      enablerSubmissions: { sequence: [[], [{ c: 0 }]] },
      useCaseSubmissions: [{ c: 0 }],
      activityReports: [{ c: 0 }],
      enablerCompletions: [],
    });

    const GET = await importHandlerWithDb(db);
    // Identity parameters in the query are ignored, the session decides
    const res = await GET(
      makeGet('http://localhost/api/trainer/dashboard?trainerAuthId=someone')
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.trainees).toHaveLength(2);
    // t1 completed both enablers (quiz passed), t2 only the one without quiz
    expect(body.trainees.find((t: any) => t.id === 't1').progress).toBe(100);
    expect(body.trainees.find((t: any) => t.id === 't2').progress).toBe(50);

    expect(body.counts.pendingQuiz).toBe(1);
    expect(body.counts.pendingReviews).toBe(1);
    expect(body.charts.moduleProgress).toEqual([
      { name: 'Course 1', completed: 0, inProgress: 0, notStarted: 2 },
    ]);
  });
});
