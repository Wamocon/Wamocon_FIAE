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

  it('GET /api/trainer/profile returns stats', async () => {
    const { db } = createTableDb({
      profiles: [
        { id: 't1', fullName: 'Trainee 1' },
        { id: 't2', fullName: 'Trainee 2' },
      ],
      courses: { sequence: [[{ c: 5 }], [{ c: 7 }]] }, // active, total
      enablers: [{ c: 20 }],
      useCases: [{ c: 4 }],
      lernfelderSchema: [{ c: 9 }],
      quizSubmissions: [{ c: 2 }],
      useCaseSubmissions: [{ c: 0 }],
      activityLog: {
        sequence: [
          [
            {
              id: 'a1',
              odaUserId: 't1',
              activityType: 'LOGIN',
              createdAt: new Date(),
            },
          ],
          [{ c: 10 }],
        ],
      },
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
    expect(body.counts.recentActivity7d).toBe(10);
    expect(body.recentActivities).toHaveLength(1);
    expect(body.recentActivities[0].userFullName).toBe('Trainee 1');
  });
});
