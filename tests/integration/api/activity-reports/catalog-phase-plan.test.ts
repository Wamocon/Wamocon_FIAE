/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  makeRequest,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';

// POST /api/activity-reports and PUT /api/activity-reports/[id] follow the
// catalog of the trainee (KfBM S4): the use cases come from the trainee's
// occupation only, and the phase of the report (ausbildungsjahr) comes from the
// phase plan of that occupation. FIAE keeps the old results. The tests run the
// real catalog scope against a table mock, which ignores where(); assertions on
// the filter use the rendered conditions.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'org-1';
const ME = '11111111-1111-4111-8111-111111111111';
const REPORT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const fiaeSettings = { phase_months: [18, 18] };
const kfbmSettings = { phase_months: [15, 21] };

// ISO week 46 of 2027 starts on 2027-11-15, month 15 of a training that began
// on 2026-08-01: still phase 1 for FIAE (18 months), phase 2 for KfBM (15).
const WEEK = 46;
const YEAR = 2027;
const START = new Date(2026, 7, 1);

type Occupation = 'FIAE' | 'KFBM';

function tablesFor(occupation: Occupation, durationYears = 3) {
  const id = occupation === 'FIAE' ? FIAE : KFBM;
  return {
    profiles: [
      {
        id: ME,
        role: 'TRAINEE',
        organizationId: ORG,
        isPlatformOwner: false,
        startOfTrainingDate: START,
        ausbildungDurationYears: durationYears,
      },
    ],
    trainingCatalogs: [
      {
        id,
        code: occupation,
        isActive: true,
        settings: occupation === 'FIAE' ? fiaeSettings : kfbmSettings,
      },
    ],
    organizationCatalogs: [{ trainingCatalogId: id, isEnabled: true }],
    traineeEnrollments:
      occupation === 'KFBM'
        ? [{ trainingCatalogId: KFBM, startDate: '2026-08-01' }]
        : [],
    trainingUseCases: [{ id: 'u1', description: 'Use case', plannedHours: 40 }],
    activityReports: [],
  };
}

async function loadRoute(
  route: 'activity-reports' | 'activity-reports/[id]',
  tables: Record<string, any>,
  returns: Record<string, any[]> = {}
) {
  jest.resetModules();
  // the real catalog scope runs against the table mock, as the trainee ME
  jest.dontMock('@/lib/catalog/scope');
  mockSession(traineeSession(ME, { organizationId: ORG }));
  const mock = createTableDb(tables, returns);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import(`@/app/api/${route}/route`);
  return { mod, mock };
}

const entry = (extra: Record<string, unknown> = {}) => ({
  useCaseId: 'u1',
  actualHours: 8,
  plannedHours: 40,
  ...extra,
});

const postBody = (entries = [entry()]) => ({
  userId: ME,
  weekNumber: WEEK,
  year: YEAR,
  entries,
  submit: false,
});

const post = (body: unknown) =>
  makeRequest('POST', 'http://localhost/api/activity-reports', { body });
const put = (body: unknown) =>
  makeRequest('PUT', `http://localhost/api/activity-reports/${REPORT}`, { body });

describe('POST /api/activity-reports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  describe('phase of the report', () => {
    it('FIAE: month 15 is still phase 1 (18 + 18 months)', async () => {
      const { mod, mock } = await loadRoute(
        'activity-reports',
        tablesFor('FIAE'),
        { activityReports: [{ id: REPORT }] }
      );
      const res = await mod.POST(post(postBody()));
      expect(res.status).toBe(200);
      expect(mock.writes('insert', 'activity_reports')[0]).toMatchObject({
        ausbildungsjahr: 1,
      });
    });

    it('FIAE shortened (2 years): month 15 is phase 2 (12 + 12 months)', async () => {
      const { mod, mock } = await loadRoute(
        'activity-reports',
        tablesFor('FIAE', 2),
        { activityReports: [{ id: REPORT }] }
      );
      const res = await mod.POST(post(postBody()));
      expect(res.status).toBe(200);
      expect(mock.writes('insert', 'activity_reports')[0]).toMatchObject({
        ausbildungsjahr: 2,
      });
    });

    it('KfBM: month 15 is phase 2 (15 + 21 months)', async () => {
      const { mod, mock } = await loadRoute(
        'activity-reports',
        tablesFor('KFBM'),
        { activityReports: [{ id: REPORT }] }
      );
      const res = await mod.POST(post(postBody()));
      expect(res.status).toBe(200);
      expect(mock.writes('insert', 'activity_reports')[0]).toMatchObject({
        ausbildungsjahr: 2,
      });
    });

    it('reads the phase plan of the trainee catalog', async () => {
      const { mod, mock } = await loadRoute(
        'activity-reports',
        tablesFor('KFBM'),
        { activityReports: [{ id: REPORT }] }
      );
      await mod.POST(post(postBody()));
      expect(mock.filters('select', 'training_catalogs').params).toContain(
        KFBM
      );
    });
  });

  describe('use cases', () => {
    it('looks the use cases up inside the catalog of the trainee', async () => {
      const { mod, mock } = await loadRoute(
        'activity-reports',
        tablesFor('KFBM'),
        { activityReports: [{ id: REPORT }] }
      );
      const res = await mod.POST(post(postBody()));
      expect(res.status).toBe(200);
      const filter = mock.filters('select', 'training_use_cases');
      expect(filter.sql).toContain(
        '"training_components"."training_catalog_id"'
      );
      expect(filter.params).toContain(KFBM);
      expect(filter.params).not.toContain(FIAE);
    });

    it('FIAE keeps looking the use cases up in FIAE', async () => {
      const { mod, mock } = await loadRoute(
        'activity-reports',
        tablesFor('FIAE'),
        { activityReports: [{ id: REPORT }] }
      );
      await mod.POST(post(postBody()));
      const filter = mock.filters('select', 'training_use_cases');
      expect(filter.params).toContain(FIAE);
      expect(filter.params).not.toContain(KFBM);
    });

    it('rejects an entry whose use case is not in the catalog, even with 0 hours', async () => {
      // the lookup finds nothing for a use case of another occupation
      const { mod, mock } = await loadRoute(
        'activity-reports',
        { ...tablesFor('KFBM'), trainingUseCases: [] },
        { activityReports: [{ id: REPORT }] }
      );
      const res = await mod.POST(
        post(postBody([entry({ useCaseId: 'fiae-use-case', actualHours: 0 })]))
      );
      expect(res.status).toBe(400);
      expect(mock.writes('insert', 'activity_reports')).toHaveLength(0);
      expect(
        mock.writes('insert', 'activity_report_use_case_entries')
      ).toHaveLength(0);
    });
  });

  it('refuses a trainee whose catalog scope is rejected', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports',
      {
        ...tablesFor('KFBM'),
        // the enrolled catalog is not enabled for the organization
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
      },
      { activityReports: [{ id: REPORT }] }
    );
    const res = await mod.POST(post(postBody()));
    expect(res.status).toBe(403);
    expect(mock.writes('insert', 'activity_reports')).toHaveLength(0);
  });
});

describe('PUT /api/activity-reports/[id]', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  const draft = {
    id: REPORT,
    traineeId: ME,
    status: 'DRAFT',
    ausbildungsjahr: 1,
  };

  function putTables(occupation: Occupation, durationYears = 3) {
    return {
      ...tablesFor(occupation, durationYears),
      activityReports: [draft],
    };
  }

  const params = { params: Promise.resolve({ id: REPORT }) };

  it('FIAE: month 15 stays phase 1', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      putTables('FIAE')
    );
    const res = await mod.PUT(put(postBody()), params);
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'activity_reports')[0]).toMatchObject({
      ausbildungsjahr: 1,
    });
  });

  it('FIAE shortened: month 15 stays phase 2', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      putTables('FIAE', 2)
    );
    const res = await mod.PUT(put(postBody()), params);
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'activity_reports')[0]).toMatchObject({
      ausbildungsjahr: 2,
    });
  });

  it('KfBM: month 15 is phase 2', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      putTables('KFBM')
    );
    const res = await mod.PUT(put(postBody()), params);
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'activity_reports')[0]).toMatchObject({
      ausbildungsjahr: 2,
    });
  });

  it('looks the use cases up inside the catalog of the report owner', async () => {
    const { mod, mock } = await loadRoute(
      'activity-reports/[id]',
      putTables('KFBM')
    );
    await mod.PUT(put(postBody()), params);
    const filter = mock.filters('select', 'training_use_cases');
    expect(filter.sql).toContain('"training_components"."training_catalog_id"');
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
  });

  it('rejects an entry whose use case is not in the catalog', async () => {
    const { mod, mock } = await loadRoute('activity-reports/[id]', {
      ...putTables('KFBM'),
      trainingUseCases: [],
    });
    const res = await mod.PUT(
      put(postBody([entry({ useCaseId: 'fiae-use-case', actualHours: 0 })])),
      params
    );
    expect(res.status).toBe(400);
    expect(mock.writes('update', 'activity_reports')).toHaveLength(0);
  });

  it('answers 404 for a report of another trainee', async () => {
    const { mod } = await loadRoute('activity-reports/[id]', {
      ...putTables('FIAE'),
      activityReports: [{ ...draft, traineeId: 'someone-else' }],
    });
    const res = await mod.PUT(put(postBody()), params);
    expect(res.status).toBe(404);
  });
});
