/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

function makeGet(url: string) {
  return { url } as any;
}

const scope = {
  id: 'tr1',
  role: 'TRAINER',
  organizationId: 'org1',
  isPlatformOwner: false,
  canSeeOrgWide: false,
  profileIds: ['tr1'],
};

async function importHandler(mockDb: any, trainerScope: any = scope) {
  jest.resetModules();
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  jest.doMock('@/lib/trainer-scope', () => ({
    __esModule: true,
    getTrainerScope: jest.fn().mockResolvedValue(trainerScope),
  }));
  const mod = await import('@/app/api/trainer/profile/route');
  return mod.GET as (req: any) => Promise<Response>;
}

describe('API: Trainer Profile', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
  });

  it('400 without trainerId', async () => {
    const { db } = createTableDb();
    const GET = await importHandler(db);
    const res = await GET(makeGet('http://localhost/api/trainer/profile'));
    expect(res.status).toBe(400);
  });

  it('403 if the caller has no trainer scope', async () => {
    const { db } = createTableDb();
    const GET = await importHandler(db, null);
    const res = await GET(
      makeGet('http://localhost/api/trainer/profile?trainerId=tr1')
    );
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
    const res = await GET(
      makeGet('http://localhost/api/trainer/profile?trainerId=tr1')
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
