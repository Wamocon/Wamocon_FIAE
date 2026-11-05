/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import { fakeSession, mockSession } from '../../../helpers/mockNext';
import { progressionWorld } from '../../../helpers/progressionWorld';

// WMCNL-2982, 2995, 2996: ONE progress figure per trainee on every trainer
// page. The trainee list, the list with statistics, the profile of the trainee
// (PDF export) and the overview of the trainee (the detail page) used to count
// differently (rows of enabler_completions, the courses of the trainer, every
// course of the trainee in every occupation). They all go through
// src/lib/trainer/trainee-progress.ts now, over the courses of the chosen
// occupation. The table mock ignores where(), so the assertions look at the
// rendered conditions (mock.filters) and at the figures of the routes.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'org-1';
const T1 = '00000000-0000-4000-8000-0000000000a1';

const catalogs = [
  { id: FIAE, code: 'FIAE', isActive: true },
  { id: KFBM, code: 'KFBM', isActive: true },
];
const both = [
  { trainingCatalogId: FIAE, isEnabled: true },
  { trainingCatalogId: KFBM, isEnabled: true },
];

const traineeRow = {
  id: T1,
  fullName: 'Leon Moretz',
  firstName: 'Leon',
  lastName: 'Moretz',
  email: 'leon@example.com',
  avatarUrl: null,
  isActive: true,
  trainerActivated: true,
  ausbildungDurationYears: 3,
  assignedTrainerId: 'tr1',
  birthDate: null,
  startOfTrainingDate: null,
  role: 'TRAINEE',
  organizationId: ORG,
  createdAt: new Date('2020-01-01'),
};

function req(url: string, header?: string) {
  return {
    url,
    method: 'GET',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-catalog' ? (header ?? null) : null,
    },
  } as any;
}

// The trainee passed the quiz of the first enabler only: 1 of 2 enablers of the
// course are completed, that is 50 %, wherever it is shown
const world = () => {
  const w = progressionWorld({
    target: 'e1',
    targetQuiz: 'q1',
    scores: { q1: 80 },
  });
  return {
    ...w,
    // the course belongs to KfBM, the catalogs are the real two of the scope
    courses: w.courses.map(c => ({ ...c, trainingCatalogId: KFBM })),
    courseMembers: w.courseMembers.map(m => ({
      ...m,
      userId: T1,
      title: 'Kurs',
    })),
    quizSubmissions: w.quizSubmissions.map(q => ({ ...q, traineeId: T1 })),
    trainingCatalogs: catalogs.map(c => ({ ...c, settings: {} })),
  };
};

async function load(route: string, tables: Record<string, any>) {
  jest.resetModules();
  const mock = createTableDb({
    trainingCatalogs: catalogs,
    organizationCatalogs: both,
    ...tables,
  });
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
const URL_BASE = 'http://localhost/api/trainer/trainees';

// requireTraineeAccess reads the trainee first, with a header the occupation
// check is the second query on profiles, then the route reads its own rows
const profilesFor = (withHeader: boolean) => ({
  profiles: {
    sequence: [
      [traineeRow],
      ...(withHeader ? [[{ id: T1 }]] : []),
      [traineeRow],
    ],
  },
});

describe('one progress figure per trainee on every trainer page', () => {
  beforeEach(() => jest.clearAllMocks());

  it('list, list with statistics, profile and overview agree (50 %)', async () => {
    const figures: number[] = [];

    const list = await load('route', { ...world(), profiles: [traineeRow] });
    const listBody = await (await list.mod.GET(req(URL_BASE, 'KFBM'))).json();
    figures.push(listBody.trainees[0].progress);

    const stats = await load('with-stats/route', {
      ...world(),
      profiles: [traineeRow],
      activityReports: [],
    });
    const statsBody = await (
      await stats.mod.GET(req(`${URL_BASE}/with-stats`, 'KFBM'))
    ).json();
    figures.push(statsBody.trainees[0].progress);

    const record = await load('[traineeId]/route', {
      ...world(),
      ...profilesFor(true),
    });
    const recordBody = await (
      await record.mod.GET(req(`${URL_BASE}/${T1}`, 'KFBM'), params)
    ).json();
    figures.push(recordBody.trainee.progress);

    const overview = await load('[traineeId]/overview/route', {
      ...world(),
      ...profilesFor(true),
    });
    const overviewBody = await (
      await overview.mod.GET(req(`${URL_BASE}/${T1}/overview`, 'KFBM'), params)
    ).json();
    figures.push(overviewBody.stats.progressPct);

    expect(figures).toEqual([50, 50, 50, 50]);
    expect(overviewBody.stats.completedEnablers).toBe(1);
    expect(overviewBody.stats.totalEnablers).toBe(2);
    // never above 100 percent, whatever the data
    for (const f of figures) {
      expect(f).toBeGreaterThanOrEqual(0);
      expect(f).toBeLessThanOrEqual(100);
    }
  });

  it('the number of modules counts the courses of the chosen occupation only (WMCNL-2996)', async () => {
    const { mock, mod } = await load('route', {
      ...world(),
      profiles: [traineeRow],
    });
    const res = await mod.GET(req(URL_BASE, 'FIAE'));
    const body = await res.json();
    expect(body.trainees[0].coursesCount).toBe(1);
    // the memberships are read together with the catalog of the course
    const filter = mock.filters('select', 'course_members').sql;
    expect(filter).toContain('"courses"."training_catalog_id"');
    expect(filter).toContain('"course_members"."role"');
  });

  it('a trainee without a course in the chosen occupation has 0 modules and 0 % (no figure of the other occupation)', async () => {
    const { mod } = await load('route', {
      ...world(),
      // the database finds no membership inside the chosen occupation
      courseMembers: [],
      profiles: [traineeRow],
    });
    const body = await (await mod.GET(req(URL_BASE, 'FIAE'))).json();
    expect(body.trainees[0].coursesCount).toBe(0);
    expect(body.trainees[0].progress).toBe(0);
  });

  it('FIAE regression: without a header nothing about occupations is asked and the courses are not filtered by occupation', async () => {
    const { mock, mod } = await load('route', {
      ...world(),
      profiles: [traineeRow],
    });
    const res = await mod.GET(req(URL_BASE));
    expect(res.status).toBe(200);
    expect(
      mock.calls.filter(
        c => c.op === 'select' && c.table === 'training_catalogs'
      )
    ).toHaveLength(0);
    expect(mock.filters('select', 'course_members').sql).not.toContain(
      'training_catalog_id'
    );
  });

  it('the overview counts the courses of the chosen occupation only', async () => {
    const { mock, mod } = await load('[traineeId]/overview/route', {
      ...world(),
      ...profilesFor(true),
    });
    const res = await mod.GET(
      req(`${URL_BASE}/${T1}/overview`, 'KFBM'),
      params
    );
    expect(res.status).toBe(200);
    expect(mock.filters('select', 'course_members').sql).toContain(
      '"courses"."training_catalog_id"'
    );
  });
});
