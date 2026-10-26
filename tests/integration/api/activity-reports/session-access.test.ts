/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  FIAE_CATALOG_ID,
  fakeSession,
  makeRequest,
  mockCatalogScope,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';

// The routes for activity reports (Ausbildungsnachweise), weekly evaluations
// and the grade history work with the bearer session only. The person is the
// session, a userId, trainerId or traineeId in the query or body is ignored,
// and a record of someone else is answered like a missing one (404). A trainee
// reaches only their own reports, trainer level only those of trainees inside
// its organization scope (and occupation). The owner or the organization is
// part of every write condition, not only of a check before it. 401 and 403 of
// the session layer run for every handler in route-guards.test.ts. The table
// mock ignores where(), so the tests read the rendered conditions.

const ME = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const TRAINER = '33333333-3333-4333-8333-333333333333';
const R1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const E1 = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EV1 = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const RT1 = 'dddddddd-dddd-4ddd-8ddd-dddddddddddd';
const CRIT = 'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'org-1';
const FOREIGN_ORG = 'org-2';

const me = traineeSession(ME, { organizationId: ORG });
const trainer = fakeSession({ id: TRAINER, organizationId: ORG });
const superAdmin = fakeSession({
  id: TRAINER,
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
  isAdmin: true,
});

const traineeProfile = {
  id: ME,
  role: 'TRAINEE',
  organizationId: ORG,
  isPlatformOwner: false,
  startOfTrainingDate: new Date(2026, 7, 1),
  ausbildungDurationYears: 3,
};

const report = (extra: Record<string, unknown> = {}) => ({
  id: R1,
  traineeId: ME,
  organizationId: ORG,
  ausbildungsjahr: 1,
  weekNumber: 10,
  year: 2027,
  periodStart: new Date(2027, 2, 1),
  periodEnd: new Date(2027, 2, 5),
  abteilung: null,
  status: 'SUBMITTED',
  submittedAt: null,
  reviewerId: null,
  reviewedAt: null,
  reviewerFeedback: null,
  traineeSignedAt: null,
  trainerSignedAt: null,
  skillSelfRatings: null,
  pdfUrl: null,
  pdfGeneratedAt: null,
  createdAt: new Date(2027, 2, 1),
  updatedAt: new Date(2027, 2, 1),
  ...extra,
});

type Tables = Record<string, any>;

async function loadRoute(
  route: string,
  session: ReturnType<typeof fakeSession> | null,
  tables: Tables = {},
  returns: Record<string, any[]> = {},
  catalog: 'mock' | 'real' = 'mock'
) {
  jest.resetModules();
  mockSession(session);
  if (catalog === 'mock') {
    mockCatalogScope();
  } else {
    jest.dontMock('@/lib/catalog/scope');
    jest.dontMock('@/lib/catalog/public');
  }
  const mock = createTableDb(tables, returns);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import(`@/app/api/${route}/route`);
  return { mod, mock };
}

const call = (
  method: string,
  url: string,
  body?: unknown,
  headers?: Record<string, string>
) =>
  makeRequest(method, `http://localhost${url}`, {
    token: 'tok',
    body,
    headers,
  });
const withId = (id: string) => ({ params: Promise.resolve({ id }) });

const noWrites = (mock: { db: any }) => {
  expect(mock.db.insert).not.toHaveBeenCalled();
  expect(mock.db.update).not.toHaveBeenCalled();
  expect(mock.db.delete).not.toHaveBeenCalled();
};

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});

// ---------------------------------------------------------------------------
describe('GET /api/activity-reports', () => {
  const url = (q = '') => `/api/activity-reports${q}`;

  it('gives a trainee their own reports and ignores a foreign userId', async () => {
    const { mod, mock } = await loadRoute('activity-reports', me, {
      activityReports: [report()],
    });
    const res = await mod.GET(call('GET', url(`?userId=${OTHER}`)));
    expect(res.status).toBe(200);
    expect((await res.json()).reports).toHaveLength(1);
    const filter = mock.filters('select', 'activity_reports');
    expect(filter.params).toContain(ME);
    expect(filter.params).not.toContain(OTHER);
  });

  it('needs no userId from a trainee', async () => {
    const { mod } = await loadRoute('activity-reports', me, {
      activityReports: [report()],
    });
    const res = await mod.GET(call('GET', url()));
    expect(res.status).toBe(200);
  });

  it('lists the submitted reports of the organization for trainer level', async () => {
    const { mod, mock } = await loadRoute('activity-reports', trainer, {
      activityReports: [report()],
    });
    const res = await mod.GET(call('GET', url(`?userId=${TRAINER}`)));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'activity_reports');
    expect(filter.sql).toContain('exists (select 1 from "profiles"');
    expect(filter.params).toContain(ORG);
    expect(filter.params).toContain('DRAFT');
  });

  it('gives the platform-wide view to the super admin, no organization', async () => {
    const { mod, mock } = await loadRoute('activity-reports', superAdmin, {
      activityReports: [report()],
    });
    const res = await mod.GET(call('GET', url()));
    expect(res.status).toBe(200);
    expect(mock.filters('select', 'activity_reports').params).not.toContain(
      ORG
    );
  });

  it('narrows trainer level to one trainee of its organization', async () => {
    const { mod, mock } = await loadRoute('activity-reports', trainer, {
      profiles: [traineeProfile],
      activityReports: [report()],
    });
    const res = await mod.GET(call('GET', url(`?userId=${ME}`)));
    expect(res.status).toBe(200);
    expect(mock.filters('select', 'activity_reports').params).toContain(ME);
  });

  it('answers 404 for a trainee of another organization', async () => {
    const { mod } = await loadRoute('activity-reports', trainer, {
      profiles: [{ ...traineeProfile, organizationId: FOREIGN_ORG }],
      activityReports: [report()],
    });
    const res = await mod.GET(call('GET', url(`?userId=${ME}`)));
    expect(res.status).toBe(404);
  });

  it('answers 403 for an occupation the trainer may not use', async () => {
    const { mod } = await loadRoute(
      'activity-reports',
      trainer,
      {
        trainingCatalogs: [
          { id: FIAE_CATALOG_ID, code: 'FIAE', isActive: true },
        ],
        organizationCatalogs: [
          { trainingCatalogId: FIAE_CATALOG_ID, isEnabled: true },
        ],
        activityReports: [report()],
      },
      {},
      'real'
    );
    const res = await mod.GET(
      call('GET', url(), undefined, { 'x-catalog': 'KFBM' })
    );
    expect(res.status).toBe(403);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/activity-reports', () => {
  const body = (extra: Record<string, unknown> = {}) => ({
    userId: OTHER,
    weekNumber: 46,
    year: 2027,
    entries: [{ useCaseId: 'u1', actualHours: 8, plannedHours: 40 }],
    submit: false,
    ...extra,
  });
  const tables = {
    profiles: [traineeProfile],
    trainingUseCases: [{ id: 'u1', description: 'UC', plannedHours: 40 }],
    activityReports: [],
  };

  it('creates the report for the session user, not for the userId of the body', async () => {
    const { mod, mock } = await loadRoute('activity-reports', me, tables, {
      activityReports: [{ id: R1 }],
    });
    const res = await mod.POST(call('POST', '/api/activity-reports', body()));
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'activity_reports')[0]).toMatchObject({
      traineeId: ME,
      organizationId: ORG,
    });
  });

  it('works without a userId in the body', async () => {
    const { mod } = await loadRoute('activity-reports', me, tables, {
      activityReports: [{ id: R1 }],
    });
    const res = await mod.POST(
      call('POST', '/api/activity-reports', body({ userId: undefined }))
    );
    expect(res.status).toBe(200);
  });

  it('refuses trainer level, only a trainee creates reports', async () => {
    const { mod, mock } = await loadRoute('activity-reports', trainer, tables);
    const res = await mod.POST(call('POST', '/api/activity-reports', body()));
    expect(res.status).toBe(403);
    noWrites(mock);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/activity-reports/[id]', () => {
  const get = (id = R1) => call('GET', `/api/activity-reports/${id}`);

  it('gives a trainee their own report', async () => {
    const { mod } = await loadRoute('activity-reports/[id]', me, {
      activityReports: [report()],
    });
    const res = await mod.GET(get(), withId(R1));
    expect(res.status).toBe(200);
    expect((await res.json()).report.id).toBe(R1);
  });

  it('answers 404 for the report of another trainee', async () => {
    const { mod } = await loadRoute('activity-reports/[id]', me, {
      activityReports: [report({ traineeId: OTHER })],
    });
    expect((await mod.GET(get(), withId(R1))).status).toBe(404);
  });

  it('answers 404 for an id that is not a uuid, without a query', async () => {
    const { mod, mock } = await loadRoute('activity-reports/[id]', me);
    expect((await mod.GET(get('r1'), withId('r1'))).status).toBe(404);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('gives trainer level the report of a trainee of its organization', async () => {
    const { mod } = await loadRoute('activity-reports/[id]', trainer, {
      activityReports: [report()],
      profiles: [traineeProfile],
    });
    expect((await mod.GET(get(), withId(R1))).status).toBe(200);
  });

  it('answers 404 for a trainee of another organization', async () => {
    const { mod } = await loadRoute('activity-reports/[id]', trainer, {
      activityReports: [report()],
      profiles: [{ ...traineeProfile, organizationId: FOREIGN_ORG }],
    });
    expect((await mod.GET(get(), withId(R1))).status).toBe(404);
  });

  it('keeps a DRAFT private from trainer level', async () => {
    const { mod } = await loadRoute('activity-reports/[id]', trainer, {
      activityReports: [report({ status: 'DRAFT' })],
      profiles: [traineeProfile],
    });
    expect((await mod.GET(get(), withId(R1))).status).toBe(404);
  });

  it('gives the super admin the report of any organization', async () => {
    const { mod } = await loadRoute('activity-reports/[id]', superAdmin, {
      activityReports: [report()],
      profiles: [{ ...traineeProfile, organizationId: FOREIGN_ORG }],
    });
    expect((await mod.GET(get(), withId(R1))).status).toBe(200);
  });
});

// ---------------------------------------------------------------------------
describe('DELETE /api/activity-reports/[id]', () => {
  const del = () => call('DELETE', `/api/activity-reports/${R1}`);

  it('deletes the own draft with the owner in the delete condition', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      me,
      { activityReports: [report({ status: 'DRAFT' })] },
      { activityReports: [{ id: R1 }] }
    );
    const res = await mod.DELETE(del(), withId(R1));
    expect(res.status).toBe(200);
    const reports = mock.filters('delete', 'activity_reports');
    expect(reports.params).toContain(ME);
    expect(reports.params).toContain(R1);
    expect(
      mock.filters('delete', 'activity_report_use_case_entries').params
    ).toContain(ME);
  });

  it('deletes a rejected report of the trainee', async () => {
    const { mod } = await loadRoute(
      'activity-reports/[id]',
      me,
      { activityReports: [report({ status: 'REJECTED' })] },
      { activityReports: [{ id: R1 }] }
    );
    expect((await mod.DELETE(del(), withId(R1))).status).toBe(200);
  });

  it('answers 404 for the report of another trainee and deletes nothing', async () => {
    const { mod, mock } = await loadRoute('activity-reports/[id]', me, {
      activityReports: [report({ traineeId: OTHER, status: 'DRAFT' })],
    });
    expect((await mod.DELETE(del(), withId(R1))).status).toBe(404);
    noWrites(mock);
  });

  it('does not let a trainee delete a submitted report', async () => {
    const { mod, mock } = await loadRoute('activity-reports/[id]', me, {
      activityReports: [report({ status: 'SUBMITTED' })],
    });
    expect((await mod.DELETE(del(), withId(R1))).status).toBe(403);
    noWrites(mock);
  });

  it.each([me, trainer])(
    'never deletes an approved report (%#)',
    async session => {
      const { mod, mock } = await loadRoute('activity-reports/[id]', session, {
        activityReports: [report({ status: 'APPROVED' })],
        profiles: [traineeProfile],
      });
      expect((await mod.DELETE(del(), withId(R1))).status).toBe(403);
      noWrites(mock);
    }
  );

  it('does not let trainer level delete a submitted report (it may be graded)', async () => {
    const { mod, mock } = await loadRoute('activity-reports/[id]', trainer, {
      activityReports: [report({ status: 'SUBMITTED' })],
      profiles: [traineeProfile],
    });
    expect((await mod.DELETE(del(), withId(R1))).status).toBe(403);
    noWrites(mock);
  });

  it('lets trainer level delete a rejected report of its organization', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      trainer,
      {
        activityReports: [report({ status: 'REJECTED' })],
        profiles: [traineeProfile],
      },
      { activityReports: [{ id: R1 }] }
    );
    expect((await mod.DELETE(del(), withId(R1))).status).toBe(200);
    const filter = mock.filters('delete', 'activity_reports');
    expect(filter.sql).toContain('exists (select 1 from "profiles"');
    expect(filter.params).toContain(ORG);
  });

  it('answers 404 for a trainee of another organization and deletes nothing', async () => {
    const { mod, mock } = await loadRoute('activity-reports/[id]', trainer, {
      activityReports: [report({ status: 'REJECTED' })],
      profiles: [{ ...traineeProfile, organizationId: FOREIGN_ORG }],
    });
    expect((await mod.DELETE(del(), withId(R1))).status).toBe(404);
    noWrites(mock);
  });

  it('does not touch a report that was approved between check and delete', async () => {
    const { mod } = await loadRoute(
      'activity-reports/[id]',
      me,
      { activityReports: [report({ status: 'DRAFT' })] },
      { activityReports: [] }
    );
    const res = await mod.DELETE(del(), withId(R1));
    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('PUT /api/activity-reports/[id]', () => {
  const put = (extra: Record<string, unknown> = {}) =>
    call('PUT', `/api/activity-reports/${R1}`, {
      userId: ME,
      weekNumber: 10,
      year: 2027,
      entries: [{ useCaseId: 'u1', actualHours: 8, plannedHours: 40 }],
      submit: false,
      ...extra,
    });
  const tables = (extra: Record<string, unknown> = {}) => ({
    profiles: [traineeProfile],
    trainingUseCases: [{ id: 'u1', description: 'UC', plannedHours: 40 }],
    activityReports: [report({ status: 'DRAFT' })],
    ...extra,
  });

  it('updates the own draft with the owner in the update condition', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      me,
      tables()
    );
    const res = await mod.PUT(put(), withId(R1));
    expect(res.status).toBe(200);
    const filter = mock.filters('update', 'activity_reports');
    expect(filter.params).toContain(ME);
    expect(filter.params).toContain(R1);
    expect(filter.params).toContain('DRAFT');
    expect(filter.params).toContain('REJECTED');
  });

  it('works without a userId in the body', async () => {
    const { mod } = await loadRoute('activity-reports/[id]', me, tables());
    const res = await mod.PUT(put({ userId: undefined }), withId(R1));
    expect(res.status).toBe(200);
  });

  it('ignores the userId of the body, a foreign report is a 404', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      me,
      tables({
        activityReports: [report({ traineeId: OTHER, status: 'DRAFT' })],
      })
    );
    const res = await mod.PUT(put({ userId: OTHER }), withId(R1));
    expect(res.status).toBe(404);
    noWrites(mock);
  });

  it('refuses trainer level, the edit is an action of the trainee', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      trainer,
      tables()
    );
    expect((await mod.PUT(put(), withId(R1))).status).toBe(403);
    noWrites(mock);
  });

  it('refuses a submitted report', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      me,
      tables({ activityReports: [report({ status: 'SUBMITTED' })] })
    );
    expect((await mod.PUT(put(), withId(R1))).status).toBe(403);
    noWrites(mock);
  });

  it('does not replace the entries when the guarded update matches nothing', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      me,
      tables(),
      { activityReports: [] }
    );
    expect((await mod.PUT(put(), withId(R1))).status).toBe(403);
    expect(mock.db.delete).not.toHaveBeenCalled();
    expect(mock.db.insert).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('PATCH /api/activity-reports/[id] (approve or reject)', () => {
  const patch = (body: Record<string, unknown> = {}) =>
    call('PATCH', `/api/activity-reports/${R1}`, {
      status: 'APPROVED',
      userId: OTHER,
      ...body,
    });
  const tables = (extra: Record<string, unknown> = {}) => ({
    activityReports: [report()],
    profiles: [traineeProfile],
    ...extra,
  });

  it('records the session user as reviewer, not the userId of the body', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      trainer,
      tables(),
      { activityReports: [report({ status: 'APPROVED' })] }
    );
    const res = await mod.PATCH(patch(), withId(R1));
    expect(res.status).toBe(200);
    const set = mock.writes('update', 'activity_reports')[0] as any;
    expect(set.reviewerId).toBe(TRAINER);
    expect(set.status).toBe('APPROVED');
    const filter = mock.filters('update', 'activity_reports');
    expect(filter.sql).toContain('exists (select 1 from "profiles"');
    expect(filter.params).toContain(ORG);
    expect(filter.params).toContain('SUBMITTED');
  });

  it('needs no userId', async () => {
    const { mod } = await loadRoute(
      'activity-reports/[id]',
      trainer,
      tables(),
      { activityReports: [report({ status: 'REJECTED' })] }
    );
    const res = await mod.PATCH(
      patch({ userId: undefined, status: 'REJECTED', feedback: 'again' }),
      withId(R1)
    );
    expect(res.status).toBe(200);
  });

  it('is not an action of a trainee', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      me,
      tables()
    );
    expect((await mod.PATCH(patch(), withId(R1))).status).toBe(403);
    noWrites(mock);
  });

  it('answers 404 for a trainee of another organization', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      trainer,
      tables({
        profiles: [{ ...traineeProfile, organizationId: FOREIGN_ORG }],
      })
    );
    expect((await mod.PATCH(patch(), withId(R1))).status).toBe(404);
    noWrites(mock);
  });

  it('rejects a feedback that is not a text or too long', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      trainer,
      tables()
    );
    const object = await mod.PATCH(
      patch({ status: 'REJECTED', feedback: { x: 1 } }),
      withId(R1)
    );
    expect(object.status).toBe(400);
    const long = await mod.PATCH(
      patch({ status: 'REJECTED', feedback: 'x'.repeat(5001) }),
      withId(R1)
    );
    expect(long.status).toBe(400);
    noWrites(mock);
  });

  it('rejects a status other than APPROVED or REJECTED', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      trainer,
      tables()
    );
    const res = await mod.PATCH(patch({ status: 'DRAFT' }), withId(R1));
    expect(res.status).toBe(400);
    noWrites(mock);
  });

  it('refuses a report that is not submitted', async () => {
    const { mod } = await loadRoute(
      'activity-reports/[id]',
      trainer,
      tables({ activityReports: [report({ status: 'APPROVED' })] }),
      { activityReports: [] }
    );
    expect((await mod.PATCH(patch(), withId(R1))).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/activity-reports/[id]/entries', () => {
  const get = () => call('GET', `/api/activity-reports/${R1}/entries`);
  const entry = { id: E1, reportId: R1, plannedHours: 8, actualHours: 8 };

  it('gives a trainee the entries of their own report', async () => {
    const { mod } = await loadRoute('activity-reports/[id]/entries', me, {
      activityReports: [report()],
      activityReportUseCaseEntries: [entry],
    });
    const res = await mod.GET(get(), withId(R1));
    expect(res.status).toBe(200);
    expect((await res.json()).entries).toHaveLength(1);
  });

  it('answers 404 for the report of another trainee, no entries are read', async () => {
    const { mod, mock } = await loadRoute('activity-reports/[id]/entries', me, {
      activityReports: [report({ traineeId: OTHER })],
      activityReportUseCaseEntries: [entry],
    });
    expect((await mod.GET(get(), withId(R1))).status).toBe(404);
    expect(mock.filters('select', 'activity_report_use_case_entries').sql).toBe(
      ''
    );
  });

  it('gives trainer level the entries inside its organization', async () => {
    const { mod } = await loadRoute('activity-reports/[id]/entries', trainer, {
      activityReports: [report()],
      profiles: [traineeProfile],
      activityReportUseCaseEntries: [entry],
    });
    expect((await mod.GET(get(), withId(R1))).status).toBe(200);
  });

  it('answers 404 outside the organization of trainer level', async () => {
    const { mod } = await loadRoute('activity-reports/[id]/entries', trainer, {
      activityReports: [report()],
      profiles: [{ ...traineeProfile, organizationId: FOREIGN_ORG }],
      activityReportUseCaseEntries: [entry],
    });
    expect((await mod.GET(get(), withId(R1))).status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('PATCH /api/activity-reports/[id]/entries (grades)', () => {
  const patch = (body: Record<string, unknown> = {}) =>
    call('PATCH', `/api/activity-reports/${R1}/entries`, {
      trainerId: OTHER,
      entryGrades: [{ entryId: E1, grade: 2, comment: 'good' }],
      ...body,
    });
  const tables = (extra: Record<string, unknown> = {}) => ({
    activityReports: [report()],
    profiles: [traineeProfile],
    activityReportUseCaseEntries: [
      { id: E1, reportId: R1, trainerGrade: null },
    ],
    ...extra,
  });

  it('sets the grade as the session user with the organization in the condition', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]/entries',
      trainer,
      tables()
    );
    const res = await mod.PATCH(patch(), withId(R1));
    expect(res.status).toBe(200);
    const set = mock.writes(
      'update',
      'activity_report_use_case_entries'
    )[0] as any;
    expect(set.gradeApprovedBy).toBe(TRAINER);
    expect(set.trainerGrade).toBe('2');
    const filter = mock.filters('update', 'activity_report_use_case_entries');
    expect(filter.params).toContain(E1);
    expect(filter.params).toContain(R1);
    expect(filter.params).toContain(ORG);
  });

  it('writes the session user into the grade history, not the trainerId of the body', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]/entries',
      trainer,
      tables({
        activityReportUseCaseEntries: [
          { id: E1, reportId: R1, trainerGrade: '4' },
        ],
      })
    );
    const res = await mod.PATCH(patch(), withId(R1));
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'grade_edit_history')[0]).toMatchObject({
      changedBy: TRAINER,
      oldValue: '4',
      newValue: '2',
    });
  });

  it.each(['REJECTED'])(
    'does not grade a %s report',
    async status => {
      const { mod, mock } = await loadRoute(
        'activity-reports/[id]/entries',
        trainer,
        tables({ activityReports: [report({ status })] })
      );
      expect((await mod.PATCH(patch(), withId(R1))).status).toBe(409);
      noWrites(mock);
    }
  );

  it('grades an approved report (edit with audit trail)', async () => {
    const { mod } = await loadRoute(
      'activity-reports/[id]/entries',
      trainer,
      tables({ activityReports: [report({ status: 'APPROVED' })] })
    );
    expect((await mod.PATCH(patch(), withId(R1))).status).toBe(200);
  });

  it('puts the status of the report into the grade update', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]/entries',
      trainer,
      tables()
    );
    await mod.PATCH(patch(), withId(R1));
    const filter = mock.filters('update', 'activity_report_use_case_entries');
    expect(filter.params).toContain('SUBMITTED');
    expect(filter.params).toContain('APPROVED');
  });

  it('writes no history line when the grade update matched nothing', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]/entries',
      trainer,
      tables({
        activityReportUseCaseEntries: [
          { id: E1, reportId: R1, trainerGrade: '4' },
        ],
      }),
      { activityReportUseCaseEntries: [] }
    );
    const res = await mod.PATCH(patch(), withId(R1));
    expect(res.status).toBe(200);
    expect((await res.json()).updatedCount).toBe(0);
    expect(mock.writes('insert', 'grade_edit_history')).toHaveLength(0);
  });

  it('does not let a trainee set grades', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]/entries',
      me,
      tables()
    );
    expect((await mod.PATCH(patch(), withId(R1))).status).toBe(403);
    noWrites(mock);
  });

  it('answers 404 for a trainee of another organization and grades nothing', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]/entries',
      trainer,
      tables({
        profiles: [{ ...traineeProfile, organizationId: FOREIGN_ORG }],
      })
    );
    expect((await mod.PATCH(patch(), withId(R1))).status).toBe(404);
    noWrites(mock);
  });

  it('refuses an entry of another report and writes nothing', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]/entries',
      trainer,
      tables({ activityReportUseCaseEntries: [] })
    );
    expect((await mod.PATCH(patch(), withId(R1))).status).toBe(403);
    noWrites(mock);
  });

  it('refuses a grade outside 1 to 6', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]/entries',
      trainer,
      tables()
    );
    const res = await mod.PATCH(
      patch({ entryGrades: [{ entryId: E1, grade: 7 }] }),
      withId(R1)
    );
    expect(res.status).toBe(400);
    noWrites(mock);
  });

  it('needs an entryGrades array', async () => {
    const { mod } = await loadRoute(
      'activity-reports/[id]/entries',
      trainer,
      tables()
    );
    const res = await mod.PATCH(patch({ entryGrades: 'x' }), withId(R1));
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('PATCH /api/activity-reports/[id]/skill-ratings', () => {
  const patch = (body: Record<string, unknown> = {}) =>
    call('PATCH', `/api/activity-reports/${R1}/skill-ratings`, {
      userId: OTHER,
      skillSelfRatings: { FACHKOMPETENZ: '2' },
      ...body,
    });

  it('saves the self rating of the own report with the owner in the condition', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]/skill-ratings',
      me,
      { activityReports: [report()] }
    );
    const res = await mod.PATCH(patch(), withId(R1));
    expect(res.status).toBe(200);
    const filter = mock.filters('update', 'activity_reports');
    expect(filter.params).toContain(ME);
    expect(filter.params).toContain(R1);
  });

  it('answers 404 for the report of another trainee, whatever the userId says', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]/skill-ratings',
      me,
      { activityReports: [report({ traineeId: OTHER })] }
    );
    const res = await mod.PATCH(patch({ userId: OTHER }), withId(R1));
    expect(res.status).toBe(404);
    noWrites(mock);
  });

  it('is not an action of trainer level', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]/skill-ratings',
      trainer,
      { activityReports: [report()] }
    );
    expect((await mod.PATCH(patch(), withId(R1))).status).toBe(403);
    noWrites(mock);
  });

  it('keeps the one-time rule', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]/skill-ratings',
      me,
      {
        activityReports: [report({ skillSelfRatings: { FACHKOMPETENZ: '3' } })],
      }
    );
    expect((await mod.PATCH(patch(), withId(R1))).status).toBe(409);
    noWrites(mock);
  });

  it('refuses an invalid grade', async () => {
    const { mod } = await loadRoute('activity-reports/[id]/skill-ratings', me, {
      activityReports: [report()],
    });
    const res = await mod.PATCH(
      patch({ skillSelfRatings: { FACHKOMPETENZ: '9' } }),
      withId(R1)
    );
    expect(res.status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/weekly-evaluations', () => {
  const get = (q = `?activityReportId=${R1}`) =>
    call('GET', `/api/weekly-evaluations${q}`);
  const evaluation = { id: EV1, activityReportId: R1, traineeId: ME };

  it('gives a trainee the evaluation of their own report', async () => {
    const { mod } = await loadRoute('weekly-evaluations', me, {
      activityReports: [report()],
      weeklyEvaluations: [evaluation],
      weeklySoftskillRatings: [{ id: RT1 }],
    });
    const res = await mod.GET(get());
    expect(res.status).toBe(200);
    const data = await res.json();
    expect(data.evaluation.id).toBe(EV1);
    expect(data.softskillRatings).toHaveLength(1);
  });

  it('answers the empty result for an own report without evaluation', async () => {
    const { mod } = await loadRoute('weekly-evaluations', me, {
      activityReports: [report()],
      weeklyEvaluations: [],
    });
    const res = await mod.GET(get());
    expect(await res.json()).toEqual({
      evaluation: null,
      softskillRatings: [],
    });
  });

  it('answers 404 for the report of another trainee and reads no evaluation', async () => {
    const { mod, mock } = await loadRoute('weekly-evaluations', me, {
      activityReports: [report({ traineeId: OTHER })],
      weeklyEvaluations: [evaluation],
    });
    expect((await mod.GET(get())).status).toBe(404);
    expect(mock.filters('select', 'weekly_evaluations').sql).toBe('');
  });

  it('answers 404 for a trainee of another organization', async () => {
    const { mod } = await loadRoute('weekly-evaluations', trainer, {
      activityReports: [report()],
      profiles: [{ ...traineeProfile, organizationId: FOREIGN_ORG }],
      weeklyEvaluations: [evaluation],
    });
    expect((await mod.GET(get())).status).toBe(404);
  });

  it('gives trainer level the evaluation inside its organization', async () => {
    const { mod } = await loadRoute('weekly-evaluations', trainer, {
      activityReports: [report()],
      profiles: [traineeProfile],
      weeklyEvaluations: [evaluation],
    });
    expect((await mod.GET(get())).status).toBe(200);
  });

  it('needs the id of a report', async () => {
    const { mod } = await loadRoute('weekly-evaluations', me);
    expect((await mod.GET(get(''))).status).toBe(400);
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/weekly-evaluations', () => {
  const post = (body: Record<string, unknown> = {}) =>
    call('POST', '/api/weekly-evaluations', {
      activityReportId: R1,
      traineeId: OTHER,
      trainerId: OTHER,
      organizationId: 'org-9',
      weekNumber: 1,
      year: 2001,
      trainerRating: 2,
      softskillsOnly: true,
      softskillRatings: [{ criterionId: CRIT, trainerRating: 2 }],
      ...body,
    });
  const tables = (extra: Record<string, unknown> = {}) => ({
    activityReports: [report()],
    profiles: [traineeProfile],
    weeklyEvaluations: [],
    weeklySoftskillRatings: [],
    // the criterion of the ratings has to exist
    mesSoftskillCriteria: [{ id: CRIT }],
    ...extra,
  });

  it('takes trainee, trainer, organization and week from the report and the session', async () => {
    const { mod, mock } = await loadRoute(
      'weekly-evaluations',
      trainer,
      tables()
    );
    const res = await mod.POST(post());
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'weekly_evaluations')[0]).toMatchObject({
      traineeId: ME,
      trainerId: TRAINER,
      organizationId: ORG,
      weekNumber: 10,
      year: 2027,
      activityReportId: R1,
    });
  });

  it('does not evaluate a rejected report', async () => {
    const { mod, mock } = await loadRoute(
      'weekly-evaluations',
      trainer,
      tables({ activityReports: [report({ status: 'REJECTED' })] })
    );
    expect((await mod.POST(post())).status).toBe(409);
    noWrites(mock);
  });

  it('does not let a trainee write an evaluation', async () => {
    const { mod, mock } = await loadRoute('weekly-evaluations', me, tables());
    expect((await mod.POST(post())).status).toBe(403);
    noWrites(mock);
  });

  it('answers 404 for a trainee of another organization and writes nothing', async () => {
    const { mod, mock } = await loadRoute(
      'weekly-evaluations',
      trainer,
      tables({
        profiles: [{ ...traineeProfile, organizationId: FOREIGN_ORG }],
      })
    );
    expect((await mod.POST(post())).status).toBe(404);
    noWrites(mock);
  });

  it('needs the id of a report', async () => {
    const { mod } = await loadRoute('weekly-evaluations', trainer, tables());
    const res = await mod.POST(post({ activityReportId: undefined }));
    expect(res.status).toBe(400);
  });

  it('updates an existing evaluation and its ratings inside the organization', async () => {
    const { mod, mock } = await loadRoute(
      'weekly-evaluations',
      trainer,
      tables({
        weeklyEvaluations: [
          { id: EV1, activityReportId: R1, traineeId: ME, trainerRating: '3' },
        ],
        weeklySoftskillRatings: [
          { id: RT1, weeklyEvaluationId: EV1, trainerRating: '4' },
        ],
      }),
      { weeklyEvaluations: [{ id: EV1, activityReportId: R1, traineeId: ME }] }
    );
    const res = await mod.POST(post({ softskillsOnly: false }));
    expect(res.status).toBe(200);
    const evaluation = mock.filters('update', 'weekly_evaluations');
    expect(evaluation.params).toContain(EV1);
    expect(evaluation.params).toContain(ME);
    expect(evaluation.params).toContain(ORG);
    const rating = mock.filters('update', 'weekly_softskill_ratings');
    expect(rating.params).toContain(RT1);
    expect(rating.params).toContain(EV1);
    expect(rating.params).toContain(ORG);
    expect(mock.writes('insert', 'grade_edit_history')).toEqual(
      expect.arrayContaining([expect.objectContaining({ changedBy: TRAINER })])
    );
  });

  it('sets the release rating as the session user', async () => {
    const { mod, mock } = await loadRoute(
      'weekly-evaluations',
      trainer,
      tables({
        weeklyEvaluations: [
          { id: EV1, activityReportId: R1, traineeId: ME, releaseRating: '3' },
        ],
      })
    );
    const res = await mod.POST(
      post({ isRelease: true, releaseRating: 1, softskillRatings: [] })
    );
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'weekly_evaluations')[0]).toMatchObject({
      releasedBy: TRAINER,
      releaseRating: '1',
    });
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/grade-edit-history', () => {
  const get = (type: string | null, id: string | null = E1) => {
    const q = new URLSearchParams();
    if (type) q.set('entityType', type);
    if (id) q.set('entityId', id);
    return call('GET', `/api/grade-edit-history?${q}`);
  };
  const history = [{ id: 'h1', entityType: 'USE_CASE_ENTRY', entityId: E1 }];

  it.each([
    ['USE_CASE_ENTRY', 'activityReportUseCaseEntries'],
    ['WEEKLY_EVALUATION', 'weeklyEvaluations'],
    ['SOFTSKILL_RATING', 'weeklySoftskillRatings'],
  ])(
    'gives trainer level the history of a %s of its organization',
    async (type, table) => {
      const { mod } = await loadRoute('grade-edit-history', trainer, {
        [table]: [{ traineeId: ME }],
        profiles: [traineeProfile],
        gradeEditHistory: history,
      });
      const res = await mod.GET(get(type));
      expect(res.status).toBe(200);
      expect((await res.json()).history).toHaveLength(1);
    }
  );

  it('answers 404 for a trainee of another organization and reads no history', async () => {
    const { mod, mock } = await loadRoute('grade-edit-history', trainer, {
      activityReportUseCaseEntries: [{ traineeId: ME }],
      profiles: [{ ...traineeProfile, organizationId: FOREIGN_ORG }],
      gradeEditHistory: history,
    });
    expect((await mod.GET(get('USE_CASE_ENTRY'))).status).toBe(404);
    expect(mock.filters('select', 'grade_edit_history').sql).toBe('');
  });

  it('answers 404 for an entity that does not exist', async () => {
    const { mod } = await loadRoute('grade-edit-history', trainer, {
      activityReportUseCaseEntries: [],
      gradeEditHistory: history,
    });
    expect((await mod.GET(get('USE_CASE_ENTRY'))).status).toBe(404);
  });

  it('answers 404 for an id that is not a uuid', async () => {
    const { mod, mock } = await loadRoute('grade-edit-history', trainer);
    expect((await mod.GET(get('USE_CASE_ENTRY', 'x'))).status).toBe(404);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('refuses an unknown entity type and a missing parameter', async () => {
    const { mod } = await loadRoute('grade-edit-history', trainer);
    expect((await mod.GET(get('SOMETHING'))).status).toBe(400);
    expect((await mod.GET(get(null))).status).toBe(400);
  });

  it('is not for a trainee', async () => {
    const { mod, mock } = await loadRoute('grade-edit-history', me);
    expect((await mod.GET(get('USE_CASE_ENTRY'))).status).toBe(403);
    expect(mock.db.select).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/breadcrumb/label', () => {
  const get = (entity: string, id = E1) =>
    call('GET', `/api/breadcrumb/label?entity=${entity}&id=${id}`);

  beforeEach(() => {
    delete (globalThis as any).__breadcrumbLabelCache__;
  });

  it('gives the title of a module to a signed-in user', async () => {
    const { mod } = await loadRoute('breadcrumb/label', me, {
      modules: [{ title: 'Module 1' }],
    });
    const res = await mod.GET(get('module'));
    expect(await res.json()).toEqual({ label: 'Module 1' });
  });

  it('serves a lesson and a sub lesson', async () => {
    const lesson = await loadRoute('breadcrumb/label', me, {
      lessons: [{ title: 'Lesson' }],
    });
    expect(await (await lesson.mod.GET(get('lesson'))).json()).toEqual({
      label: 'Lesson',
    });
    const sub = await loadRoute('breadcrumb/label', me, {
      subLessons: [{ title: 'Sub' }],
    });
    expect(await (await sub.mod.GET(get('subLesson'))).json()).toEqual({
      label: 'Sub',
    });
  });

  it('limits a quiz title to the catalogs of the caller', async () => {
    const { mod, mock } = await loadRoute('breadcrumb/label', me, {
      quizzes: [{ title: 'Quiz' }],
    });
    const res = await mod.GET(get('quiz'));
    expect(await res.json()).toEqual({ label: 'Quiz' });
    const filter = mock.filters('select', 'quizzes');
    expect(filter.sql).toContain('"training_catalog_id"');
    expect(filter.params).toContain(FIAE_CATALOG_ID);
    expect(filter.params).not.toContain(KFBM);
  });

  it('does not serve a quiz title from the cache to another catalog', async () => {
    const first = await loadRoute('breadcrumb/label', me, {
      quizzes: [{ title: 'Quiz' }],
    });
    await first.mod.GET(get('quiz'));
    const second = await loadRoute('breadcrumb/label', me, { quizzes: [] });
    const res = await second.mod.GET(get('quiz'));
    expect(await res.json()).toEqual({ label: null });
  });

  it('refuses an unknown entity and a missing id', async () => {
    const { mod } = await loadRoute('breadcrumb/label', me);
    expect((await mod.GET(get('course'))).status).toBe(400);
    expect(
      (await mod.GET(call('GET', '/api/breadcrumb/label?entity=module'))).status
    ).toBe(400);
  });

  it('answers a missing title with a null label', async () => {
    const { mod } = await loadRoute('breadcrumb/label', me, { modules: [] });
    expect(await (await mod.GET(get('module'))).json()).toEqual({
      label: null,
    });
  });
});
