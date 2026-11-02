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

// An activity report (Ausbildungsnachweis) belongs to one occupation
// (activity_reports.training_catalog_id). A trainee in two trainings sees only
// the reports of the occupation of the tab, can write one report per week in
// each occupation, but not two in the same one. Trainer level sees only the
// reports of the occupation it chose (the occupation of the REPORT, not of the
// enrollments of the trainee). A trainee with one occupation works as before.
// The real catalog scope runs against a table mock, which ignores where(), so
// the assertions read the rendered conditions and the written values.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'org-1';
const ME = '11111111-1111-4111-8111-111111111111';
const TRAINER = '33333333-3333-4333-8333-333333333333';
const REPORT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

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
    trainingUseCases: [{ id: 'u1', description: 'Use case', plannedHours: 40 }],
    ...tables,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import(`@/app/api/${route}`);
  return { mod, mock };
}

const LIST = `http://localhost/api/activity-reports?userId=${ME}&limit=500`;

const reportRow = (catalogId: string, extra: Record<string, unknown> = {}) => ({
  id: REPORT,
  traineeId: ME,
  trainingCatalogId: catalogId,
  status: 'DRAFT',
  weekNumber: 10,
  year: 2027,
  ausbildungsjahr: 1,
  ...extra,
});

const postBody = {
  weekNumber: 46,
  year: 2027,
  entries: [{ useCaseId: 'u1', actualHours: 8, plannedHours: 40 }],
  submit: false,
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('GET /api/activity-reports of a trainee in two occupations', () => {
  it('KfBM tab: only the reports of KfBM', async () => {
    const { mod, mock } = await load('activity-reports/route', {
      activityReports: [reportRow(KFBM)],
    });
    const res = await mod.GET(req('GET', LIST, { header: 'KFBM' }));
    expect(res.status).toBe(200);
    expect((await res.json()).reports.map((r: any) => r.id)).toEqual([REPORT]);
    const filter = mock.filters('select', 'activity_reports');
    expect(filter.sql).toContain(
      '"activity_reports"."training_catalog_id" = $'
    );
    expect(filter.params).toContain(ME);
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
  });

  it('FIAE tab: only the reports of FIAE', async () => {
    const { mod, mock } = await load('activity-reports/route', {
      activityReports: [reportRow(FIAE)],
    });
    const res = await mod.GET(req('GET', LIST, { header: 'FIAE' }));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'activity_reports');
    expect(filter.params).toContain(FIAE);
    expect(filter.params).not.toContain(KFBM);
  });

  it('without a choice the first enrollment counts (never both lists mixed)', async () => {
    const { mod, mock } = await load('activity-reports/route', {
      activityReports: [reportRow(FIAE)],
    });
    const res = await mod.GET(req('GET', LIST));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'activity_reports');
    expect(filter.params).toContain(FIAE);
    expect(filter.params).not.toContain(KFBM);
  });

  it('refuses an occupation the trainee is not enrolled in (403)', async () => {
    const { mod, mock } = await load('activity-reports/route', {
      traineeEnrollments: [twoEnrollments[0]],
    });
    const res = await mod.GET(req('GET', LIST, { header: 'KFBM' }));
    expect(res.status).toBe(403);
    expect(mock.filters('select', 'activity_reports').params).toEqual([]);
  });
});

describe('GET /api/activity-reports of a trainee with one occupation', () => {
  it('is not filtered by occupation, exactly as before', async () => {
    const { mod, mock } = await load('activity-reports/route', {
      traineeEnrollments: [],
      activityReports: [reportRow(FIAE)],
    });
    const res = await mod.GET(req('GET', LIST));
    expect(res.status).toBe(200);
    expect((await res.json()).reports).toHaveLength(1);
    const filter = mock.filters('select', 'activity_reports');
    expect(filter.sql).not.toContain('training_catalog_id');
    expect(filter.params).toContain(ME);
  });
});

describe('POST /api/activity-reports in two occupations', () => {
  it('writes the report into the occupation of the tab and checks the week in that occupation', async () => {
    const kfbm = await load('activity-reports/route', {});
    const resKfbm = await kfbm.mod.POST(
      req('POST', 'http://localhost/api/activity-reports', {
        header: 'KFBM',
        body: postBody,
      })
    );
    expect(resKfbm.status).toBe(200);
    expect(kfbm.mock.writes('insert', 'activity_reports')[0]).toMatchObject({
      traineeId: ME,
      trainingCatalogId: KFBM,
      weekNumber: 46,
      year: 2027,
    });
    const kfbmDuplicateCheck = kfbm.mock.filters('select', 'activity_reports');
    expect(kfbmDuplicateCheck.params).toContain(KFBM);
    expect(kfbmDuplicateCheck.params).not.toContain(FIAE);

    // the same week in the other occupation is no duplicate
    const fiae = await load('activity-reports/route', {});
    const resFiae = await fiae.mod.POST(
      req('POST', 'http://localhost/api/activity-reports', {
        header: 'FIAE',
        body: postBody,
      })
    );
    expect(resFiae.status).toBe(200);
    expect(fiae.mock.writes('insert', 'activity_reports')[0]).toMatchObject({
      trainingCatalogId: FIAE,
      weekNumber: 46,
    });
    expect(
      fiae.mock.filters('select', 'activity_reports').params
    ).not.toContain(KFBM);
  });

  it('a second report for the same week in the same occupation is refused (400)', async () => {
    const { mod, mock } = await load('activity-reports/route', {
      // the duplicate check finds the report of that week in this occupation
      activityReports: [reportRow(KFBM, { weekNumber: 46, year: 2027 })],
    });
    const res = await mod.POST(
      req('POST', 'http://localhost/api/activity-reports', {
        header: 'KFBM',
        body: postBody,
      })
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toContain('KW 46/2027');
    expect(mock.writes('insert', 'activity_reports')).toHaveLength(0);
    expect(mock.filters('select', 'activity_reports').params).toContain(KFBM);
  });

  it('a trainee with one occupation: the report is FIAE, as before', async () => {
    const { mod, mock } = await load('activity-reports/route', {
      traineeEnrollments: [],
    });
    const res = await mod.POST(
      req('POST', 'http://localhost/api/activity-reports', { body: postBody })
    );
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'activity_reports')[0]).toMatchObject({
      trainingCatalogId: FIAE,
    });
  });

  it('refuses an occupation the trainee is not enrolled in (403), nothing is written', async () => {
    const { mod, mock } = await load('activity-reports/route', {
      traineeEnrollments: [twoEnrollments[0]],
    });
    const res = await mod.POST(
      req('POST', 'http://localhost/api/activity-reports', {
        header: 'KFBM',
        body: postBody,
      })
    );
    expect(res.status).toBe(403);
    expect(mock.writes('insert', 'activity_reports')).toHaveLength(0);
  });
});

describe('PUT /api/activity-reports/[id] keeps the occupation of the report', () => {
  const params = { params: Promise.resolve({ id: REPORT }) };

  it('looks the use cases and the used hours up in the occupation of the REPORT, not of the open tab', async () => {
    const { mod, mock } = await load('activity-reports/[id]/route', {
      activityReports: [reportRow(KFBM)],
    });
    // the trainee edits the KfBM report while the FIAE tab is open
    const res = await mod.PUT(
      req('PUT', `http://localhost/api/activity-reports/${REPORT}`, {
        header: 'FIAE',
        body: postBody,
      }),
      params
    );
    expect(res.status).toBe(200);
    const useCases = mock.filters('select', 'training_use_cases');
    expect(useCases.sql).toContain(
      '"training_components"."training_catalog_id" = $'
    );
    expect(useCases.params).toContain(KFBM);
    const used = mock.filters('select', 'activity_reports');
    expect(used.sql).toContain('"activity_reports"."training_catalog_id" = $');
    expect(used.params).toContain(KFBM);
  });
});

describe('a report of another occupation for trainer level', () => {
  const trainer = fakeSession({ id: TRAINER, organizationId: ORG });
  const params = { params: Promise.resolve({ id: REPORT }) };
  const url = `http://localhost/api/activity-reports/${REPORT}`;
  const tables = {
    traineeEnrollments: twoEnrollments,
    activityReports: [reportRow(FIAE, { status: 'SUBMITTED' })],
  };

  it('is answered like a missing one while the other occupation is chosen', async () => {
    const { mod } = await load('activity-reports/[id]/route', tables, trainer);
    const res = await mod.GET(req('GET', url, { header: 'KFBM' }), params);
    expect(res.status).toBe(404);
  });

  it('is readable in its own occupation and without a choice', async () => {
    const own = await load('activity-reports/[id]/route', tables, trainer);
    const resOwn = await own.mod.GET(
      req('GET', url, { header: 'FIAE' }),
      params
    );
    expect(resOwn.status).toBe(200);
    expect((await resOwn.json()).report.trainingCatalogId).toBe(FIAE);

    const none = await load('activity-reports/[id]/route', tables, trainer);
    const resNone = await none.mod.GET(req('GET', url), params);
    expect(resNone.status).toBe(200);
  });

  it('the report counts by its own occupation, not by the enrollments of the trainee', async () => {
    // the trainee has a KfBM enrollment only (the FIAE enrollment was removed),
    // the report was written for FIAE: the FIAE tab still reaches it
    const { mod, mock } = await load(
      'activity-reports/[id]/route',
      { ...tables, traineeEnrollments: [twoEnrollments[1]] },
      trainer
    );
    const res = await mod.GET(req('GET', url, { header: 'FIAE' }), params);
    expect(res.status).toBe(200);
    expect(
      mock.calls.filter(
        c => c.op === 'select' && c.table === 'trainee_enrollments'
      )
    ).toHaveLength(0);
  });

  it('a foreign organization stays outside, whatever the occupation is', async () => {
    const { mod } = await load(
      'activity-reports/[id]/route',
      {
        ...tables,
        profiles: [{ ...traineeProfile, organizationId: 'org-2' }],
      },
      trainer
    );
    const res = await mod.GET(req('GET', url, { header: 'FIAE' }), params);
    expect(res.status).toBe(404);
  });

  it('refuses an occupation the organization has not enabled (403)', async () => {
    const { mod } = await load(
      'activity-reports/[id]/route',
      {
        ...tables,
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
      },
      trainer
    );
    const res = await mod.GET(req('GET', url, { header: 'KFBM' }), params);
    expect(res.status).toBe(403);
  });
});

describe('Arbeitszeugnis aggregate per occupation', () => {
  const trainer = fakeSession({ id: TRAINER, organizationId: ORG });
  const params = { params: Promise.resolve({ traineeId: ME }) };

  it('counts only the reports (and their evaluations) of the chosen occupation', async () => {
    const { mod, mock } = await load(
      'trainer/arbeitszeugnis/aggregate/[traineeId]/route',
      {
        activityReportUseCaseEntries: [],
        weeklySoftskillRatings: [],
        weeklyEvaluations: [],
      },
      trainer
    );
    const res = await mod.GET(
      req(
        'GET',
        `http://localhost/api/trainer/arbeitszeugnis/aggregate/${ME}?ausbildungsjahr=1`,
        { header: 'KFBM' }
      ),
      params
    );
    expect(res.status).toBe(200);
    const entries = mock.filters('select', 'activity_report_use_case_entries');
    expect(entries.sql).toContain(
      '"activity_reports"."training_catalog_id" = $'
    );
    expect(entries.params).toContain(KFBM);
    expect(entries.params).not.toContain(FIAE);
    // the evaluations follow the occupation of their report
    const ratings = mock.filters('select', 'weekly_softskill_ratings');
    expect(ratings.params).toContain(KFBM);
  });

  it('without a choice nothing is filtered by occupation (as before)', async () => {
    const { mod, mock } = await load(
      'trainer/arbeitszeugnis/aggregate/[traineeId]/route',
      {
        activityReportUseCaseEntries: [],
        weeklySoftskillRatings: [],
        weeklyEvaluations: [],
      },
      trainer
    );
    const res = await mod.GET(
      req(
        'GET',
        `http://localhost/api/trainer/arbeitszeugnis/aggregate/${ME}?ausbildungsjahr=1`
      ),
      params
    );
    expect(res.status).toBe(200);
    expect(
      mock.filters('select', 'activity_report_use_case_entries').sql
    ).not.toContain('training_catalog_id" = $');
  });
});
