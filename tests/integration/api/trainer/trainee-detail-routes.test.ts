/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import { fakeSession, mockSession } from '../../../helpers/mockNext';
import { progressionWorld } from '../../../helpers/progressionWorld';

// Detail page of a trainee (second round of the Jira bugs of 02.11.2026):
// WMCNL-2985 an empty name is refused by the server, 2994 the picture address
// has to be a web address, 2984 the overview carries the status of the summary
// (a rejected one is not "done"), 2990 it carries the summaries themselves,
// 2989 and 2992 it lists courses, enablers and quizzes in the order of the
// training plan.

const FIAE = '00000000-0000-4000-8000-000000000001';
const ORG = 'org-1';
const T1 = '00000000-0000-4000-8000-0000000000a1';

const traineeRow = {
  id: T1,
  fullName: 'Leon Moretz',
  avatarUrl: null,
  isActive: true,
  trainerActivated: true,
  ausbildungDurationYears: 3,
  assignedTrainerId: 'tr1',
  startOfTrainingDate: null,
  role: 'TRAINEE',
  organizationId: ORG,
  createdAt: new Date('2020-01-01'),
};

function req(url: string, method = 'GET', body?: unknown) {
  return {
    url,
    method,
    headers: { get: () => null },
    json: async () => body,
  } as any;
}

async function load(
  route: string,
  tables: Record<string, any>,
  returns: Record<string, any[]> = {}
) {
  jest.resetModules();
  const mock = createTableDb(
    {
      trainingCatalogs: [{ id: FIAE, code: 'FIAE', isActive: true }],
      organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
      ...tables,
    },
    returns
  );
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    verifyPlatformOwner: async () => false,
    verifyTrainer: async () => true,
    getUserOrgId: async () => ORG,
    getUserOrgIdStrict: async () => ORG,
  }));
  mockSession(fakeSession({ id: 'tr1', organizationId: ORG }));
  const mod = await import(`@/app/api/trainer/trainees/${route}`);
  return { mock, mod };
}

const params = { params: Promise.resolve({ traineeId: T1 }) };
const URL_BASE = `http://localhost/api/trainer/trainees/${T1}`;

const updatedRow = {
  id: T1,
  fullName: 'Neu',
  avatarUrl: null,
  startOfTrainingDate: null,
  ausbildungDurationYears: 3,
  assignedTrainerId: 'tr1',
  trainerActivated: true,
};

describe('PATCH the master data of a trainee', () => {
  beforeEach(() => jest.clearAllMocks());

  it('refuses an empty or blank name and writes nothing (WMCNL-2985)', async () => {
    for (const name of ['', '   ']) {
      const { mock, mod } = await load(
        '[traineeId]/route',
        { profiles: [traineeRow] },
        { profiles: [updatedRow] }
      );
      const res = await mod.PATCH(
        req(URL_BASE, 'PATCH', { full_name: name }),
        params
      );
      expect(res.status).toBe(400);
      expect((await res.json()).code).toBe('FULL_NAME_REQUIRED');
      expect(mock.writes('update', 'profiles')).toHaveLength(0);
    }
  });

  it('refuses a name that is too long', async () => {
    const { mock, mod } = await load(
      '[traineeId]/route',
      { profiles: [traineeRow] },
      { profiles: [updatedRow] }
    );
    const res = await mod.PATCH(
      req(URL_BASE, 'PATCH', { full_name: 'x'.repeat(121) }),
      params
    );
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('FULL_NAME_TOO_LONG');
    expect(mock.writes('update', 'profiles')).toHaveLength(0);
  });

  it('saves a valid name, trimmed', async () => {
    const { mock, mod } = await load(
      '[traineeId]/route',
      { profiles: [traineeRow] },
      { profiles: [updatedRow] }
    );
    const res = await mod.PATCH(
      req(URL_BASE, 'PATCH', { full_name: '  Neu  ' }),
      params
    );
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'profiles')).toEqual([{ fullName: 'Neu' }]);
  });

  it('accepts only a web address as picture, an empty one removes the picture (WMCNL-2994)', async () => {
    const bad = await load(
      '[traineeId]/route',
      { profiles: [traineeRow] },
      { profiles: [updatedRow] }
    );
    const refused = await bad.mod.PATCH(
      req(URL_BASE, 'PATCH', { avatar_url: 'javascript:alert(1)' }),
      params
    );
    expect(refused.status).toBe(400);
    expect((await refused.json()).code).toBe('AVATAR_URL_INVALID');
    expect(bad.mock.writes('update', 'profiles')).toHaveLength(0);

    const good = await load(
      '[traineeId]/route',
      { profiles: [traineeRow] },
      { profiles: [updatedRow] }
    );
    const ok = await good.mod.PATCH(
      req(URL_BASE, 'PATCH', { avatar_url: 'https://example.com/a.png' }),
      params
    );
    expect(ok.status).toBe(200);
    expect(good.mock.writes('update', 'profiles')).toEqual([
      { avatarUrl: 'https://example.com/a.png' },
    ]);

    const clear = await load(
      '[traineeId]/route',
      { profiles: [traineeRow] },
      { profiles: [updatedRow] }
    );
    await clear.mod.PATCH(req(URL_BASE, 'PATCH', { avatar_url: '' }), params);
    expect(clear.mock.writes('update', 'profiles')).toEqual([
      { avatarUrl: null },
    ]);
  });
});

describe('overview of a trainee', () => {
  beforeEach(() => jest.clearAllMocks());

  const world = (extra: Record<string, any> = {}) => {
    const w = progressionWorld({
      // the database returns e2 first: the route puts the course order back
      target: 'e2',
      targetQuiz: 'q2',
      scores: { q1: 80 },
    });
    return {
      ...w,
      courses: [
        { ...w.courses[0], trainingCatalogId: FIAE, chapter: 2, code: 'K2' },
      ],
      courseMembers: w.courseMembers.map(m => ({ ...m, userId: T1 })),
      quizSubmissions: w.quizSubmissions.map(q => ({ ...q, traineeId: T1 })),
      // the order of work is in force: the trainee joined after the cut-off
      trainingCatalogs: [
        {
          id: FIAE,
          code: 'FIAE',
          isActive: true,
          settings: { sequence_since: '2026-11-01T00:00:00.000Z' },
        },
      ],
      traineeEnrollments: [
        {
          trainingCatalogId: FIAE,
          createdAt: new Date('2026-11-05T08:00:00Z'),
        },
      ],
      profiles: { sequence: [[traineeRow]] },
      ...extra,
    };
  };

  it('carries the status of the latest summary per enabler and the summaries (WMCNL-2984, 2990)', async () => {
    const { mod } = await load(
      '[traineeId]/overview/route',
      world({
        enablerSubmissions: [
          {
            enablerId: 'e1',
            traineeId: T1,
            status: 'REJECTED',
            attemptNumber: 2,
            submittedAt: new Date('2026-10-30T10:00:00Z'),
          },
        ],
      })
    );
    const body = await (
      await mod.GET(req(`${URL_BASE}/overview`), params)
    ).json();
    const e1 = body.enablers.find((e: any) => e.id === 'e1');
    const e2 = body.enablers.find((e: any) => e.id === 'e2');
    // The completion by quizzes is the one definition and stays as it is,
    // the status of the summary is told next to it
    expect(e1.completed).toBe(true);
    expect(e1.summaryStatus).toBe('REJECTED');
    expect(e2.summaryStatus).toBeNull();
    expect(body.summaries).toHaveLength(1);
    expect(body.summaries[0]).toMatchObject({
      enablerId: 'e1',
      enablerTitle: 'Enabler Eins',
      status: 'REJECTED',
      attemptNumber: 2,
      courseTitle: 'Kurs',
    });
  });

  it('a submission without a status waits for the review', async () => {
    const { mod } = await load(
      '[traineeId]/overview/route',
      world({
        enablerSubmissions: [
          {
            enablerId: 'e1',
            traineeId: T1,
            status: null,
            attemptNumber: 1,
            submittedAt: new Date('2026-10-30T10:00:00Z'),
          },
        ],
      })
    );
    const body = await (
      await mod.GET(req(`${URL_BASE}/overview`), params)
    ).json();
    expect(body.summaries[0].status).toBe('PENDING');
  });

  it('lists the enablers in course order and the quizzes low, medium, high (WMCNL-2989, 2992, 2994)', async () => {
    const { mod } = await load('[traineeId]/overview/route', world());
    const body = await (
      await mod.GET(req(`${URL_BASE}/overview`), params)
    ).json();
    expect(body.enablers.map((e: any) => e.id)).toEqual(['e1', 'e2']);
    expect(body.enablers[0].courseId).toBe('c1');
    expect(body.enablers[0].courseCode).toBe('K2');
    // e1 has LOW, e2 has LOW and MEDIUM, the database answers q2 first
    expect(
      body.enablerQuizzes.map((q: any) => `${q.enablerId}:${q.difficulty}`)
    ).toEqual(['e1:LOW', 'e2:LOW', 'e2:MEDIUM']);
    expect(body.enablerQuizzes[0].courseTitle).toBe('Kurs');
  });

  it('only one enabler of the course is open, the next one waits (WMCNL-2992: no second open one without an exception)', async () => {
    const { mod } = await load(
      '[traineeId]/overview/route',
      world({ quizSubmissions: [] })
    );
    const body = await (
      await mod.GET(req(`${URL_BASE}/overview`), params)
    ).json();
    const states = body.enablers.map((e: any) => e.state);
    expect(states).toEqual(['open', 'locked']);
    expect(body.enablers.map((e: any) => e.override)).toEqual([null, null]);
  });
});
