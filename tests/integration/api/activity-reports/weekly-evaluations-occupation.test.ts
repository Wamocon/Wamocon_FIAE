/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';

// A weekly evaluation (Wochenbewertung) belongs to one occupation
// (weekly_evaluations.training_catalog_id). A trainee in two trainings can have
// one evaluation per week in EACH occupation, but not two in the same one.
// Every list shows the evaluations of the occupation of the tab only, trainer
// level sees only the occupation it chose, the annual overview and the
// Arbeitszeugnis count per occupation. A trainee with one occupation works as
// before. The real catalog scope runs against a table mock, which ignores
// where(), so the assertions read the rendered conditions and the written
// values.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'org-1';
const ME = '11111111-1111-4111-8111-111111111111';
const TRAINER = '33333333-3333-4333-8333-333333333333';
const REPORT_KFBM = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const REPORT_FIAE = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EVALUATION = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';

const CATALOGS = [
  {
    id: FIAE,
    code: 'FIAE',
    isActive: true,
    settings: { phase_months: [18, 18] },
  },
  {
    id: KFBM,
    code: 'KFBM',
    isActive: true,
    settings: { phase_months: [15, 21] },
  },
];
const BOTH = [
  { trainingCatalogId: FIAE, isEnabled: true },
  { trainingCatalogId: KFBM, isEnabled: true },
];

const traineeProfile = {
  id: ME,
  role: 'TRAINEE',
  organizationId: ORG,
  isPlatformOwner: false,
  startOfTrainingDate: new Date(2026, 7, 1),
  ausbildungDurationYears: 3,
};

/** Two enrollments: FIAE first (the default), KfBM second. */
const twoEnrollments = [
  {
    trainingCatalogId: FIAE,
    startDate: '2026-08-01',
    createdAt: new Date(2026, 7, 1),
  },
  {
    trainingCatalogId: KFBM,
    startDate: '2027-02-01',
    createdAt: new Date(2027, 1, 1),
  },
];

const COLUMN = '"weekly_evaluations"."training_catalog_id" = $';

function req(
  method: string,
  url: string,
  options: { header?: string; body?: unknown } = {}
) {
  return makeRequest(method, url, {
    token: 't',
    body: options.body,
    headers: options.header ? { 'x-catalog': options.header } : undefined,
  });
}

async function load(
  route: string,
  tables: Record<string, any>,
  session: ReturnType<typeof fakeSession> = traineeSession(ME, {
    organizationId: ORG,
  })
) {
  jest.resetModules();
  jest.dontMock('@/lib/catalog/scope');
  mockSession(session);
  const mock = createTableDb({
    trainingCatalogs: CATALOGS,
    organizationCatalogs: BOTH,
    traineeEnrollments: twoEnrollments,
    profiles: [traineeProfile],
    activityReports: [],
    weeklyEvaluations: [],
    weeklySoftskillRatings: [],
    ...tables,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import(`@/app/api/${route}`);
  return { mod, mock };
}

const trainer = () => fakeSession({ id: TRAINER, organizationId: ORG });

const reportRow = (
  id: string,
  catalogId: string,
  extra: Record<string, unknown> = {}
) => ({
  id,
  traineeId: ME,
  organizationId: ORG,
  trainingCatalogId: catalogId,
  status: 'SUBMITTED',
  weekNumber: 46,
  year: 2027,
  ausbildungsjahr: 1,
  ...extra,
});

const evaluationRow = (
  catalogId: string,
  extra: Record<string, unknown> = {}
) => ({
  id: EVALUATION,
  traineeId: ME,
  trainerId: TRAINER,
  organizationId: ORG,
  trainingCatalogId: catalogId,
  activityReportId: catalogId === KFBM ? REPORT_KFBM : REPORT_FIAE,
  weekNumber: 46,
  year: 2027,
  ausbildungsjahr: 1,
  status: 'SUBMITTED',
  selfRating: '2',
  trainerRating: '3',
  selfSubmittedAt: null,
  ...extra,
});

/** How often the rendered conditions filter evaluations by their own column. */
const columnFilters = (sql: string) => sql.split(COLUMN).length - 1;

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

describe('POST /api/weekly-evaluations: one evaluation per week and occupation', () => {
  const url = 'http://localhost/api/weekly-evaluations';
  const grade = (activityReportId: string) => ({
    activityReportId,
    trainerRating: 2,
  });

  it('the same week of one trainee gets an evaluation in each occupation (the occupation of the report)', async () => {
    const kfbm = await load(
      'weekly-evaluations/route',
      { activityReports: [reportRow(REPORT_KFBM, KFBM)] },
      trainer()
    );
    const resKfbm = await kfbm.mod.POST(
      req('POST', url, { body: grade(REPORT_KFBM) })
    );
    expect(resKfbm.status).toBe(200);
    expect(kfbm.mock.writes('insert', 'weekly_evaluations')).toHaveLength(1);
    expect(kfbm.mock.writes('insert', 'weekly_evaluations')[0]).toMatchObject({
      traineeId: ME,
      trainingCatalogId: KFBM,
      activityReportId: REPORT_KFBM,
      weekNumber: 46,
      year: 2027,
    });

    // the evaluation of the same week in the other occupation is no duplicate
    const fiae = await load(
      'weekly-evaluations/route',
      { activityReports: [reportRow(REPORT_FIAE, FIAE)] },
      trainer()
    );
    const resFiae = await fiae.mod.POST(
      req('POST', url, { body: grade(REPORT_FIAE) })
    );
    expect(resFiae.status).toBe(200);
    expect(fiae.mock.writes('insert', 'weekly_evaluations')[0]).toMatchObject({
      traineeId: ME,
      trainingCatalogId: FIAE,
      activityReportId: REPORT_FIAE,
      weekNumber: 46,
      year: 2027,
    });
  });

  it('looks the existing evaluation up through the report, which belongs to one occupation', async () => {
    const { mod, mock } = await load(
      'weekly-evaluations/route',
      { activityReports: [reportRow(REPORT_KFBM, KFBM)] },
      trainer()
    );
    await mod.POST(req('POST', url, { body: grade(REPORT_KFBM) }));
    const lookup = mock.filters('select', 'weekly_evaluations');
    expect(lookup.sql).toContain(
      '"weekly_evaluations"."activity_report_id" = $'
    );
    expect(lookup.params).toContain(REPORT_KFBM);
    expect(lookup.params).not.toContain(REPORT_FIAE);
  });

  it('a second grading of the same report changes the evaluation, no second row in the same occupation', async () => {
    const { mod, mock } = await load(
      'weekly-evaluations/route',
      {
        activityReports: [reportRow(REPORT_KFBM, KFBM)],
        weeklyEvaluations: [evaluationRow(KFBM)],
      },
      trainer()
    );
    const res = await mod.POST(
      req('POST', url, { body: { ...grade(REPORT_KFBM), trainerRating: 4 } })
    );
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'weekly_evaluations')).toHaveLength(0);
    expect(mock.writes('update', 'weekly_evaluations')).toHaveLength(1);
    expect(mock.writes('update', 'weekly_evaluations')[0]).toMatchObject({
      trainerRating: '4',
      status: 'APPROVED',
    });
    // the update does not move the evaluation into another occupation
    expect(mock.writes('update', 'weekly_evaluations')[0]).not.toHaveProperty(
      'trainingCatalogId'
    );
  });

  it('a trainer who chose the other occupation does not reach the report, nothing is written', async () => {
    const { mod, mock } = await load(
      'weekly-evaluations/route',
      { activityReports: [reportRow(REPORT_KFBM, KFBM)] },
      trainer()
    );
    const res = await mod.POST(
      req('POST', url, { header: 'FIAE', body: grade(REPORT_KFBM) })
    );
    expect(res.status).toBe(404);
    expect(mock.writes('insert', 'weekly_evaluations')).toHaveLength(0);
  });
});

describe('GET /api/trainee/evaluations of a trainee in two occupations', () => {
  const url = `http://localhost/api/trainee/evaluations?userId=${ME}`;

  it('KfBM tab: only the evaluations of KfBM, by the column of the evaluation itself', async () => {
    const { mod, mock } = await load('trainee/evaluations/route', {
      weeklyEvaluations: [evaluationRow(KFBM)],
    });
    const res = await mod.GET(req('GET', url, { header: 'KFBM' }));
    expect(res.status).toBe(200);
    expect((await res.json()).evaluations.map((e: any) => e.id)).toEqual([
      EVALUATION,
    ]);
    const filter = mock.filters('select', 'weekly_evaluations');
    expect(filter.sql).toContain(COLUMN);
    // no detour through the activity report any more
    expect(filter.sql).not.toContain('activity_reports');
    expect(filter.params).toContain(ME);
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
  });

  it('FIAE tab: only the evaluations of FIAE', async () => {
    const { mod, mock } = await load('trainee/evaluations/route', {
      weeklyEvaluations: [evaluationRow(FIAE)],
    });
    const res = await mod.GET(req('GET', url, { header: 'FIAE' }));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'weekly_evaluations');
    expect(filter.params).toContain(FIAE);
    expect(filter.params).not.toContain(KFBM);
  });

  it('the two tabs do not share a cached list', async () => {
    const { mod, mock } = await load('trainee/evaluations/route', {
      weeklyEvaluations: [evaluationRow(KFBM)],
    });
    await mod.GET(req('GET', url, { header: 'KFBM' }));
    await mod.GET(req('GET', url, { header: 'FIAE' }));
    const selects = mock.calls.filter(
      c => c.op === 'select' && c.table === 'weekly_evaluations'
    );
    expect(selects).toHaveLength(2);
  });

  it('without a choice the first enrollment counts (never both lists mixed)', async () => {
    const { mod, mock } = await load('trainee/evaluations/route', {
      weeklyEvaluations: [evaluationRow(FIAE)],
    });
    const res = await mod.GET(req('GET', url));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'weekly_evaluations');
    expect(filter.params).toContain(FIAE);
    expect(filter.params).not.toContain(KFBM);
  });

  it('refuses an occupation the trainee is not enrolled in (403)', async () => {
    const { mod, mock } = await load('trainee/evaluations/route', {
      traineeEnrollments: [twoEnrollments[0]],
    });
    const res = await mod.GET(req('GET', url, { header: 'KFBM' }));
    expect(res.status).toBe(403);
    expect(mock.filters('select', 'weekly_evaluations').params).toEqual([]);
  });
});

describe('GET /api/trainee/evaluations of a trainee with one occupation', () => {
  it('is not filtered by occupation, exactly as before', async () => {
    const { mod, mock } = await load('trainee/evaluations/route', {
      traineeEnrollments: [],
      weeklyEvaluations: [evaluationRow(FIAE)],
    });
    const res = await mod.GET(
      req('GET', `http://localhost/api/trainee/evaluations?userId=${ME}`)
    );
    expect(res.status).toBe(200);
    expect((await res.json()).evaluations).toHaveLength(1);
    const filter = mock.filters('select', 'weekly_evaluations');
    expect(filter.sql).not.toContain('training_catalog_id');
    expect(filter.params).toContain(ME);
  });
});

describe('POST /api/trainee/evaluations (self assessment) per occupation', () => {
  const url = 'http://localhost/api/trainee/evaluations';
  const body = {
    weekNumber: 46,
    year: 2027,
    ausbildungsjahr: 1,
    selfRating: 2,
    selfComment: 'Gut gelaufen',
    submit: true,
  };

  it('looks the evaluation of this week up in the occupation of the tab, not in the other one', async () => {
    const { mod, mock } = await load('trainee/evaluations/route', {
      weeklyEvaluations: [evaluationRow(KFBM, { status: 'DRAFT' })],
    });
    const res = await mod.POST(req('POST', url, { header: 'KFBM', body }));
    expect(res.status).toBe(200);
    const lookup = mock.filters('select', 'weekly_evaluations');
    expect(lookup.sql).toContain(COLUMN);
    expect(lookup.params).toContain(KFBM);
    expect(lookup.params).not.toContain(FIAE);
    expect(mock.writes('update', 'weekly_evaluations')[0]).toMatchObject({
      selfRating: 2,
      status: 'SUBMITTED',
    });
  });

  it('the same week in the other occupation is looked up in that occupation', async () => {
    const { mod, mock } = await load('trainee/evaluations/route', {
      weeklyEvaluations: [evaluationRow(FIAE, { status: 'DRAFT' })],
    });
    const res = await mod.POST(req('POST', url, { header: 'FIAE', body }));
    expect(res.status).toBe(200);
    const lookup = mock.filters('select', 'weekly_evaluations');
    expect(lookup.params).toContain(FIAE);
    expect(lookup.params).not.toContain(KFBM);
  });

  it('an evaluation of the other occupation is no match: nothing exists in this one, nothing is written', async () => {
    // the lookup in KfBM finds no row (the FIAE evaluation of the same week is
    // another one), so there is no evaluation to change and no second row appears
    const { mod, mock } = await load('trainee/evaluations/route', {
      weeklyEvaluations: [],
    });
    const res = await mod.POST(req('POST', url, { header: 'KFBM', body }));
    expect(res.status).toBe(404);
    expect(mock.writes('insert', 'weekly_evaluations')).toHaveLength(0);
    expect(mock.writes('update', 'weekly_evaluations')).toHaveLength(0);
  });

  it('an approved evaluation stays untouched', async () => {
    const { mod, mock } = await load('trainee/evaluations/route', {
      weeklyEvaluations: [evaluationRow(KFBM, { status: 'APPROVED' })],
    });
    const res = await mod.POST(req('POST', url, { header: 'KFBM', body }));
    expect(res.status).toBe(400);
    expect(mock.writes('update', 'weekly_evaluations')).toHaveLength(0);
  });

  it('refuses an occupation the trainee is not enrolled in (403)', async () => {
    const { mod, mock } = await load('trainee/evaluations/route', {
      traineeEnrollments: [twoEnrollments[0]],
      weeklyEvaluations: [evaluationRow(KFBM, { status: 'DRAFT' })],
    });
    const res = await mod.POST(req('POST', url, { header: 'KFBM', body }));
    expect(res.status).toBe(403);
    expect(mock.writes('update', 'weekly_evaluations')).toHaveLength(0);
  });

  it('a trainee with one occupation: the evaluation is looked up in FIAE, as before', async () => {
    const { mod, mock } = await load('trainee/evaluations/route', {
      traineeEnrollments: [],
      weeklyEvaluations: [evaluationRow(FIAE, { status: 'DRAFT' })],
    });
    const res = await mod.POST(req('POST', url, { body }));
    expect(res.status).toBe(200);
    expect(mock.filters('select', 'weekly_evaluations').params).toContain(FIAE);
  });
});

describe('GET /api/trainer/evaluations per occupation', () => {
  const url = 'http://localhost/api/trainer/evaluations';

  it('with KfBM chosen the list and the pending count see only the evaluations of KfBM', async () => {
    const { mod, mock } = await load(
      'trainer/evaluations/route',
      { weeklyEvaluations: [] },
      trainer()
    );
    const res = await mod.GET(req('GET', url, { header: 'KFBM' }));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'weekly_evaluations');
    // the list and the pending count
    expect(columnFilters(filter.sql)).toBe(2);
    expect(filter.sql).not.toContain('activity_reports');
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
  });

  it('with FIAE chosen only FIAE counts', async () => {
    const { mod, mock } = await load(
      'trainer/evaluations/route',
      { weeklyEvaluations: [] },
      trainer()
    );
    const res = await mod.GET(req('GET', url, { header: 'FIAE' }));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'weekly_evaluations');
    expect(columnFilters(filter.sql)).toBe(2);
    expect(filter.params).toContain(FIAE);
    expect(filter.params).not.toContain(KFBM);
  });

  it('without a choice nothing is filtered by occupation (as before)', async () => {
    const { mod, mock } = await load(
      'trainer/evaluations/route',
      { weeklyEvaluations: [] },
      trainer()
    );
    const res = await mod.GET(req('GET', url));
    expect(res.status).toBe(200);
    expect(
      columnFilters(mock.filters('select', 'weekly_evaluations').sql)
    ).toBe(0);
  });

  it('refuses an occupation the organization has not enabled (403)', async () => {
    const { mod } = await load(
      'trainer/evaluations/route',
      {
        weeklyEvaluations: [],
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
      },
      trainer()
    );
    const res = await mod.GET(req('GET', url, { header: 'KFBM' }));
    expect(res.status).toBe(403);
  });
});

describe('an evaluation of another occupation for trainer level (by id)', () => {
  const params = { params: Promise.resolve({ id: EVALUATION }) };
  const url = `http://localhost/api/trainer/evaluations/${EVALUATION}`;
  const tables = { weeklyEvaluations: [evaluationRow(FIAE)] };

  it('is answered like a missing one while the other occupation is chosen', async () => {
    const { mod } = await load(
      'trainer/evaluations/[id]/route',
      tables,
      trainer()
    );
    const res = await mod.GET(req('GET', url, { header: 'KFBM' }), params);
    expect(res.status).toBe(404);
    expect((await res.json()).error).toBe('Evaluation not found');
  });

  it('is readable in its own occupation and without a choice', async () => {
    const own = await load('trainer/evaluations/[id]/route', tables, trainer());
    const resOwn = await own.mod.GET(
      req('GET', url, { header: 'FIAE' }),
      params
    );
    expect(resOwn.status).toBe(200);
    expect((await resOwn.json()).evaluation.trainingCatalogId).toBe(FIAE);

    const none = await load(
      'trainer/evaluations/[id]/route',
      tables,
      trainer()
    );
    const resNone = await none.mod.GET(req('GET', url), params);
    expect(resNone.status).toBe(200);
  });

  it('cannot be graded or approved from the other occupation, nothing is written', async () => {
    const put = await load('trainer/evaluations/[id]/route', tables, trainer());
    const resPut = await put.mod.PUT(
      req('PUT', url, {
        header: 'KFBM',
        body: { trainerRating: 2, softskillRatings: [] },
      }),
      params
    );
    expect(resPut.status).toBe(404);
    expect(put.mock.writes('update', 'weekly_evaluations')).toHaveLength(0);

    const patch = await load(
      'trainer/evaluations/[id]/route',
      tables,
      trainer()
    );
    const resPatch = await patch.mod.PATCH(
      req('PATCH', url, { header: 'KFBM', body: { action: 'approve' } }),
      params
    );
    expect(resPatch.status).toBe(404);
    expect(patch.mock.writes('update', 'weekly_evaluations')).toHaveLength(0);
  });

  it('a foreign organization stays outside, whatever the occupation is', async () => {
    const { mod } = await load(
      'trainer/evaluations/[id]/route',
      {
        ...tables,
        profiles: [{ ...traineeProfile, organizationId: 'org-2' }],
      },
      trainer()
    );
    const res = await mod.GET(req('GET', url, { header: 'FIAE' }), params);
    expect(res.status).toBe(404);
  });
});

describe('annual summary and annual overview count per occupation', () => {
  const approved = (catalogId: string) =>
    evaluationRow(catalogId, { status: 'APPROVED', arpThemeText: null });

  it('trainee: the summary of the KfBM tab reads the evaluations of KfBM only', async () => {
    const { mod, mock } = await load('trainee/annual-summary/route', {
      weeklyEvaluations: [approved(KFBM)],
    });
    const res = await mod.GET(
      req('GET', 'http://localhost/api/trainee/annual-summary?year=2027', {
        header: 'KFBM',
      })
    );
    expect(res.status).toBe(200);
    expect((await res.json()).summary.totalEvaluations).toBe(1);
    const filter = mock.filters('select', 'weekly_evaluations');
    expect(columnFilters(filter.sql)).toBe(1);
    expect(filter.sql).not.toContain('activity_reports');
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
  });

  it('trainee with one occupation: not filtered by occupation, as before', async () => {
    const { mod, mock } = await load('trainee/annual-summary/route', {
      traineeEnrollments: [],
      weeklyEvaluations: [approved(FIAE)],
    });
    const res = await mod.GET(
      req('GET', 'http://localhost/api/trainee/annual-summary?year=2027')
    );
    expect(res.status).toBe(200);
    expect((await res.json()).summary.totalEvaluations).toBe(1);
    expect(mock.filters('select', 'weekly_evaluations').sql).not.toContain(
      'training_catalog_id'
    );
  });

  it('trainer: every query of the overview (trainees, evaluations, pending) is limited to the chosen occupation', async () => {
    const row = {
      ...approved(KFBM),
      traineeFullName: 'Azubi',
      traineeEmail: 'azubi@example.com',
    };
    const { mod, mock } = await load(
      'trainer/annual-overview/route',
      { weeklyEvaluations: [row] },
      trainer()
    );
    const res = await mod.GET(
      req('GET', 'http://localhost/api/trainer/annual-overview?year=2027', {
        header: 'KFBM',
      })
    );
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'weekly_evaluations');
    expect(columnFilters(filter.sql)).toBe(3);
    expect(filter.sql).not.toContain('activity_reports');
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
  });

  it('trainer without a choice: nothing is filtered by occupation (as before)', async () => {
    const row = {
      ...approved(FIAE),
      traineeFullName: 'Azubi',
      traineeEmail: 'azubi@example.com',
    };
    const { mod, mock } = await load(
      'trainer/annual-overview/route',
      { weeklyEvaluations: [row] },
      trainer()
    );
    const res = await mod.GET(
      req('GET', 'http://localhost/api/trainer/annual-overview?year=2027')
    );
    expect(res.status).toBe(200);
    expect(
      columnFilters(mock.filters('select', 'weekly_evaluations').sql)
    ).toBe(0);
  });
});

describe('Arbeitszeugnis counts the evaluations per occupation', () => {
  it('aggregate: the soft skills come from the evaluations of the chosen occupation', async () => {
    const { mod, mock } = await load(
      'trainer/arbeitszeugnis/aggregate/[traineeId]/route',
      { activityReportUseCaseEntries: [] },
      trainer()
    );
    const res = await mod.GET(
      req(
        'GET',
        `http://localhost/api/trainer/arbeitszeugnis/aggregate/${ME}?ausbildungsjahr=1`,
        { header: 'KFBM' }
      ),
      { params: Promise.resolve({ traineeId: ME }) }
    );
    expect(res.status).toBe(200);
    const ratings = mock.filters('select', 'weekly_softskill_ratings');
    expect(ratings.sql).toContain(COLUMN);
    expect(ratings.params).toContain(KFBM);
    expect(ratings.params).not.toContain(FIAE);
  });

  it('aggregate without a choice: no occupation filter on the evaluations (as before)', async () => {
    const { mod, mock } = await load(
      'trainer/arbeitszeugnis/aggregate/[traineeId]/route',
      { activityReportUseCaseEntries: [] },
      trainer()
    );
    const res = await mod.GET(
      req(
        'GET',
        `http://localhost/api/trainer/arbeitszeugnis/aggregate/${ME}?ausbildungsjahr=1`
      ),
      { params: Promise.resolve({ traineeId: ME }) }
    );
    expect(res.status).toBe(200);
    expect(
      columnFilters(mock.filters('select', 'weekly_softskill_ratings').sql)
    ).toBe(0);
  });

  it('skill radar: the soft skills of the radar come from the chosen occupation', async () => {
    const { mod, mock } = await load(
      'trainer/arbeitszeugnis/skill-radar/[traineeId]/route',
      { activityReportUseCaseEntries: [] },
      trainer()
    );
    const res = await mod.GET(
      req(
        'GET',
        `http://localhost/api/trainer/arbeitszeugnis/skill-radar/${ME}?ausbildungsjahr=1`,
        { header: 'KFBM' }
      ),
      { params: Promise.resolve({ traineeId: ME }) }
    );
    expect(res.status).toBe(200);
    const ratings = mock.filters('select', 'weekly_softskill_ratings');
    expect(ratings.sql).toContain(COLUMN);
    expect(ratings.params).toContain(KFBM);
    expect(ratings.params).not.toContain(FIAE);
  });
});
