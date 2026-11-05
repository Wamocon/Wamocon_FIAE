/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  FIAE_CATALOG_ID,
  fakeSession,
  mockCatalogScope,
  mockSession,
} from '../../../helpers/mockNext';

function makeGet(url: string) {
  return { url } as any;
}

async function importHandler(
  mockDb: any,
  session: ReturnType<typeof fakeSession> | null = fakeSession({ id: 'tr1' })
) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  mockSession(session);
  mockCatalogScope();
  const mod = await import('@/app/api/trainer/profile/route');
  return mod.GET as (req: any) => Promise<Response>;
}

describe('API: Trainer Profile', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('401 without a session', async () => {
    const { db } = createTableDb();
    const GET = await importHandler(db, null);
    const res = await GET(makeGet('http://localhost/api/trainer/profile'));
    expect(res.status).toBe(401);
  });

  it('403 for a trainee session', async () => {
    const { db } = createTableDb();
    const GET = await importHandler(
      db,
      fakeSession({ role: 'TRAINEE', isTrainerLevel: false })
    );
    const res = await GET(makeGet('http://localhost/api/trainer/profile'));
    expect(res.status).toBe(403);
  });

  const DAY = 24 * 60 * 60 * 1000;

  // WMCNL-3030: "Letzte Aktivitäten" stayed empty although the trainees were
  // active, because the list was read from the activity_log (which records the
  // actions of trainers and admins). It comes from what the trainees did now.
  it('GET /api/trainer/profile returns stats and the real activities of the trainees', async () => {
    const now = Date.now();
    const { db } = createTableDb({
      profiles: [
        { id: 't1', fullName: 'Trainee 1' },
        { id: 't2', fullName: 'Trainee 2' },
      ],
      courses: { sequence: [[{ c: 5 }], [{ c: 7 }]] }, // active, total
      enablers: [{ c: 20 }],
      useCases: [{ c: 4 }],
      lernfelderSchema: [{ c: 9 }],
      quizSubmissions: {
        // the pending count first, then the list of the activities
        sequence: [
          [{ c: 2 }],
          [
            {
              id: 'q1',
              traineeId: 't1',
              title: 'HTML und CSS',
              score: 80,
              at: new Date(now - 2 * 60 * 60 * 1000),
            },
          ],
        ],
      },
      useCaseSubmissions: {
        sequence: [
          [{ c: 0 }],
          [
            {
              id: 'u1',
              traineeId: 't2',
              title: 'Use Case Eins',
              status: 'APPROVED',
              at: new Date(now - DAY),
            },
          ],
        ],
      },
      enablerCompletions: [
        {
          enablerId: 'e1',
          traineeId: 't2',
          title: 'Lektion Eins',
          at: new Date(now - 60 * 60 * 1000),
        },
      ],
    });

    const GET = await importHandler(db);
    // The trainerId query parameter is ignored, the session decides
    const res = await GET(
      makeGet('http://localhost/api/trainer/profile?trainerId=someone-else')
    );

    expect(res.status).toBe(200);
    const body = await res.json();

    expect(body.counts.trainees).toBe(2);
    expect(body.counts.activeCourses).toBe(5);
    expect(body.counts.totalCourses).toBe(7);
    expect(body.counts.pendingReviews).toBe(2); // 2 quizzes + 0 use cases

    // Newest first: lesson (1 h), quiz (2 h), use case (1 day)
    expect(body.recentActivities.map((a: any) => a.activityType)).toEqual([
      'LESSON_COMPLETED',
      'QUIZ_SUBMITTED',
      'USECASE_SUBMITTED',
    ]);
    const [lesson, quiz, useCase] = body.recentActivities;
    expect(lesson).toMatchObject({
      userFullName: 'Trainee 2',
      itemTitle: 'Lektion Eins',
    });
    expect(quiz).toMatchObject({
      userFullName: 'Trainee 1',
      itemTitle: 'HTML und CSS',
      score: 80,
    });
    expect(useCase).toMatchObject({
      userFullName: 'Trainee 2',
      itemTitle: 'Use Case Eins',
      status: 'APPROVED',
    });
    // No German text of the server: the page translates the structured values
    expect(JSON.stringify(body.recentActivities)).not.toMatch(/abgegeben/);
  });

  it('the activities do not come from the activity_log (it holds the actions of trainers)', async () => {
    const { db, calls } = createTableDb({
      profiles: [{ id: 't1', fullName: 'Trainee 1' }],
      courses: [{ c: 1 }],
      enablers: [{ c: 1 }],
      useCases: [{ c: 1 }],
      lernfelderSchema: [{ c: 1 }],
      quizSubmissions: [],
      useCaseSubmissions: [],
      enablerCompletions: [],
      activityLog: [
        {
          id: 'a1',
          userId: 'tr1',
          activityType: 'TRAINEE_ENABLER_OVERRIDE',
          createdAt: new Date(),
        },
      ],
    });
    const GET = await importHandler(db);
    const res = await GET(makeGet('http://localhost/api/trainer/profile'));
    expect(res.status).toBe(200);
    expect((await res.json()).recentActivities).toEqual([]);
    expect(calls.some(c => c.table === 'activity_log')).toBe(false);
  });

  it('the activities are limited to the trainees in the scope and to the occupation of the tab', async () => {
    const { db, filters } = createTableDb({
      profiles: [{ id: 't1', fullName: 'Trainee 1' }],
      courses: [{ c: 1 }],
      enablers: [{ c: 1 }],
      useCases: [{ c: 1 }],
      lernfelderSchema: [{ c: 1 }],
    });
    const GET = await importHandler(db);
    await GET(makeGet('http://localhost/api/trainer/profile'));
    for (const table of [
      'quiz_submissions',
      'use_case_submissions',
      'enabler_completions',
    ]) {
      const f = filters('select', table);
      // the trainees of the scope (a sub select on profiles) ...
      expect(f.sql).toMatch(/in \(select/i);
      // ... and the catalog of the item (quiz, use case, course of the lesson)
      expect(f.sql).toMatch(/training_catalog_id/);
      expect(f.params).toContain(FIAE_CATALOG_ID);
    }
  });
});
