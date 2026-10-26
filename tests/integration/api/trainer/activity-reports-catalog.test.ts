/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import { fakeSession, mockSession } from '../../../helpers/mockNext';

// Report list of the trainer per occupation. A report belongs to the trainee
// who wrote it, the trainee to the occupation of their enrollment. The tests
// run the real catalog scope against a table mock. The mock ignores where(),
// so the assertions look at the rendered conditions (mock.filters), at the
// queries that were (not) made and at the answers of the route. The real SQL
// is checked against a database in the smoke test of the pull request.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'org-1';

const catalogs = [
  { id: FIAE, code: 'FIAE', isActive: true },
  { id: KFBM, code: 'KFBM', isActive: true },
];
const fiaeOnly = [{ trainingCatalogId: FIAE, isEnabled: true }];
const both = [...fiaeOnly, { trainingCatalogId: KFBM, isEnabled: true }];

const trainee = (id: string) => ({
  id,
  fullName: `Azubi ${id}`,
  ausbildungDurationYears: 3,
  organizationId: ORG,
  assignedTrainerId: 'tr1',
});

const report = (id: string, traineeId: string) => ({
  id,
  traineeId,
  status: 'SUBMITTED',
  ausbildungsjahr: 1,
  submittedAt: new Date(2027, 10, 20),
});

const URL_LIST = 'http://localhost/api/trainer/activity-reports';

function req(url: string, header?: string) {
  return {
    url,
    method: 'GET',
    nextUrl: new URL(url),
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-catalog' ? (header ?? null) : null,
    },
  } as any;
}

async function load(
  tables: Record<string, any> = {},
  scopeOverrides: Record<string, unknown> = {}
) {
  jest.resetModules();
  const mock = createTableDb({
    trainingCatalogs: catalogs,
    organizationCatalogs: both,
    profiles: [trainee('t1')],
    activityReports: [report('r1', 't1')],
    activityReportUseCaseEntries: [],
    ...tables,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/trainer-scope', () => ({
    __esModule: true,
    getTrainerScope: async () => ({
      id: 'tr1',
      role: 'ADMIN',
      organizationId: ORG,
      isPlatformOwner: false,
      isSuperAdmin: false,
      canSeeOrgWide: true,
      profileIds: ['tr1'],
      ...scopeOverrides,
    }),
    isTraineeVisibleToTrainer: () => true,
  }));
  jest.doMock('@/lib/catalog/phase-plan-db', () => ({
    __esModule: true,
    loadPhasePlansForUsers: async (users: { id: string }[]) =>
      new Map(users.map(u => [u.id, { phaseMonths: [18, 18] }])),
  }));
  mockSession(fakeSession({ id: 'tr1', organizationId: ORG }));
  const mod = await import('@/app/api/trainer/activity-reports/route');
  return { mock, mod };
}

const selectsFrom = (mock: ReturnType<typeof createTableDb>, table: string) =>
  mock.calls.filter(c => c.op === 'select' && c.table === table);

describe('GET /api/trainer/activity-reports per occupation', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('FIAE regression: without a header it asks nothing about occupations and filters as before', async () => {
    const { mock, mod } = await load();
    const res = await mod.GET(req(URL_LIST));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.reports.map((r: any) => r.id)).toEqual(['r1']);
    expect(body.meta).toEqual({ total: 1, pending: 1, assignedTrainees: 1 });
    expect(selectsFrom(mock, 'training_catalogs')).toHaveLength(0);
    expect(selectsFrom(mock, 'organization_catalogs')).toHaveLength(0);
    expect(selectsFrom(mock, 'trainee_enrollments')).toHaveLength(0);
    const filter = mock.filters('select', 'profiles');
    expect(filter.sql).not.toContain('trainee_enrollments');
    expect(filter.sql).not.toContain('exists');
  });

  it('KfBM selected: only trainees with a KfBM enrollment (no enrollment counts as FIAE)', async () => {
    const { mock, mod } = await load();
    const res = await mod.GET(req(URL_LIST, 'KFBM'));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'profiles');
    expect(filter.sql).toContain('exists (select 1 from "trainee_enrollments"');
    expect(filter.sql).toContain(
      '"trainee_enrollments"."trainee_id" = "profiles"."id"'
    );
    expect(filter.sql).toContain(
      '"trainee_enrollments"."training_catalog_id" = $'
    );
    expect(filter.sql).not.toContain('not exists');
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
  });

  it('FIAE selected: FIAE enrollments and trainees without any enrollment', async () => {
    const { mock, mod } = await load();
    const res = await mod.GET(req(URL_LIST, 'FIAE'));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'profiles');
    expect(filter.sql).toContain(
      'not exists (select 1 from "trainee_enrollments"'
    );
    expect(filter.params).toContain(FIAE);
    expect(filter.params).not.toContain(KFBM);
  });

  it('the code is case-insensitive and also read from ?catalog=', async () => {
    const { mock, mod } = await load();
    const res = await mod.GET(req(`${URL_LIST}?catalog=kfbm`));
    expect(res.status).toBe(200);
    expect(mock.filters('select', 'profiles').params).toContain(KFBM);
  });

  it('lists the reports of the trainees of the chosen occupation only', async () => {
    // the filter on profiles leaves k1, the reports are asked for k1 alone
    const { mock, mod } = await load({
      profiles: [trainee('k1')],
      activityReports: [report('r2', 'k1')],
    });
    const res = await mod.GET(req(URL_LIST, 'KFBM'));
    const body = await res.json();
    expect(body.reports.map((r: any) => r.id)).toEqual(['r2']);
    expect(body.meta.assignedTrainees).toBe(1);
    const reportFilter = mock.filters('select', 'activity_reports');
    expect(reportFilter.params).toContain('k1');
    expect(reportFilter.params).not.toContain('t1');
  });

  it('a traineeId of another occupation gives an empty list, not the list of the chosen occupation', async () => {
    const { mock, mod } = await load({ profiles: [trainee('k1')] });
    const res = await mod.GET(req(`${URL_LIST}?traineeId=t1`, 'KFBM'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      reports: [],
      meta: { total: 0, pending: 0 },
    });
    expect(selectsFrom(mock, 'activity_reports')).toHaveLength(0);
  });

  it('a traineeId inside the chosen occupation lists that trainee only', async () => {
    const { mock, mod } = await load({
      profiles: [trainee('k1'), trainee('k2')],
      activityReports: [report('r2', 'k1')],
    });
    const res = await mod.GET(req(`${URL_LIST}?traineeId=k1`, 'KFBM'));
    expect((await res.json()).reports.map((r: any) => r.id)).toEqual(['r2']);
    const reportFilter = mock.filters('select', 'activity_reports');
    expect(reportFilter.params).toContain('k1');
    expect(reportFilter.params).not.toContain('k2');
  });

  it('FIAE regression: without a header a foreign traineeId behaves as before', async () => {
    const { mock, mod } = await load({ profiles: [trainee('k1')] });
    const res = await mod.GET(req(`${URL_LIST}?traineeId=t1`));
    expect(res.status).toBe(200);
    expect(selectsFrom(mock, 'activity_reports')).toHaveLength(1);
    expect(mock.filters('select', 'activity_reports').params).toContain('k1');
  });

  it('answers an empty list without asking for reports when no trainee is left', async () => {
    const { mock, mod } = await load({ profiles: [] });
    const res = await mod.GET(req(URL_LIST, 'KFBM'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      reports: [],
      meta: { total: 0, pending: 0 },
    });
    expect(selectsFrom(mock, 'activity_reports')).toHaveLength(0);
  });

  it('combines the occupation with the trainer visibility of a normal trainer', async () => {
    const { mock, mod } = await load(
      {},
      { canSeeOrgWide: false, profileIds: ['tr1'] }
    );
    const res = await mod.GET(req(URL_LIST, 'KFBM'));
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'profiles');
    expect(filter.sql).toContain('"profiles"."assigned_trainer_id"');
    expect(filter.sql).toContain('exists (select 1 from "trainee_enrollments"');
  });

  it('refuses an occupation the organization has not enabled (403) before any report is read', async () => {
    const { mock, mod } = await load({ organizationCatalogs: fiaeOnly });
    const res = await mod.GET(req(URL_LIST, 'KFBM'));
    expect(res.status).toBe(403);
    expect(selectsFrom(mock, 'profiles')).toHaveLength(0);
    expect(selectsFrom(mock, 'activity_reports')).toHaveLength(0);
  });

  it('refuses an unknown occupation (403)', async () => {
    const { mock, mod } = await load();
    const res = await mod.GET(req(URL_LIST, 'NOPE'));
    expect(res.status).toBe(403);
    expect(selectsFrom(mock, 'activity_reports')).toHaveLength(0);
  });

  it('answers 503 and hides the details when the scope cannot be determined (fail closed)', async () => {
    const { mock, mod } = await load();
    mock.db.select.mockImplementation(() => {
      throw new Error('connection refused at 10.0.0.1');
    });
    const res = await mod.GET(req(URL_LIST, 'KFBM'));
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('10.0.0.1');
  });
});
