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

// The HAI actions create_activity_report and submit_activity_report work in the
// occupation the person works in (x-catalog, otherwise the default): a trainee
// in two trainings gets the report in the chosen one, the week is checked in
// that occupation only, and a draft of the other training is not submitted by
// mistake. A report named by id is submitted whatever its occupation. The mock
// database ignores where(), the tests read the rendered conditions.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ME = '10000000-0000-4000-8000-000000000001';
const ORG = 'b0000000-0000-4000-8000-00000000000b';
const REPORT = '30000000-0000-4000-8000-000000000002';

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

async function load(
  tables: Record<string, any[]> = {},
  session: ReturnType<typeof fakeSession> = traineeSession(ME, {
    organizationId: ORG,
  })
) {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockSession(session);
  const rec = createTableDb({
    trainingCatalogs: [
      { id: FIAE, code: 'FIAE', isActive: true, settings: null },
      { id: KFBM, code: 'KFBM', isActive: true, settings: null },
    ],
    organizationCatalogs: [
      { trainingCatalogId: FIAE, isEnabled: true },
      { trainingCatalogId: KFBM, isEnabled: true },
    ],
    traineeEnrollments: twoEnrollments,
    profiles: [
      {
        id: ME,
        role: 'TRAINEE',
        organizationId: ORG,
        startOfTrainingDate: null,
        ausbildungDurationYears: 3,
      },
    ],
    activityReports: [],
    ...tables,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    ...(jest.requireActual('@/lib/auth-helpers') as object),
    requireProPlan: async () => true,
    getUserOrgIdStrict: async () => ORG,
  }));
  const mod = (await import('@/app/api/hai/action/route')) as any;
  return { mod, rec };
}

function post(body: unknown, catalog?: string) {
  return makeRequest('POST', 'http://localhost/api/hai/action', {
    token: 't',
    body,
    headers: catalog ? { 'x-catalog': catalog } : undefined,
  });
}

const confirmed = (actionType: string, parameters: unknown = {}) => ({
  actionType,
  parameters,
  confirmed: true,
});

beforeEach(() => jest.clearAllMocks());

describe('create_activity_report', () => {
  it('writes the report into the chosen occupation and looks the week up in it', async () => {
    const { mod, rec } = await load();
    const res = await mod.POST(
      post(
        confirmed('create_activity_report', { weekNumber: 12, year: 2027 }),
        'KFBM'
      )
    );
    expect(res.status).toBe(200);
    expect(rec.writes('insert', 'activity_reports')[0]).toMatchObject({
      traineeId: ME,
      trainingCatalogId: KFBM,
      weekNumber: 12,
      year: 2027,
    });
    const lookup = rec.filters('select', 'activity_reports');
    expect(lookup.params).toContain(KFBM);
    expect(lookup.params).not.toContain(FIAE);
  });

  it('the same week in the other occupation is no duplicate', async () => {
    const { mod, rec } = await load();
    const res = await mod.POST(
      post(
        confirmed('create_activity_report', { weekNumber: 12, year: 2027 }),
        'FIAE'
      )
    );
    expect(res.status).toBe(200);
    expect(rec.writes('insert', 'activity_reports')[0]).toMatchObject({
      trainingCatalogId: FIAE,
    });
    expect(rec.filters('select', 'activity_reports').params).not.toContain(
      KFBM
    );
  });

  it('a second report for the week in the same occupation answers 409, nothing is written', async () => {
    const { mod, rec } = await load({
      activityReports: [{ id: REPORT, status: 'DRAFT', weekNumber: 12 }],
    });
    const res = await mod.POST(
      post(
        confirmed('create_activity_report', { weekNumber: 12, year: 2027 }),
        'KFBM'
      )
    );
    expect(res.status).toBe(409);
    expect(rec.writes('insert', 'activity_reports')).toEqual([]);
  });

  it('without a choice the default occupation (first enrollment) is used', async () => {
    const { mod, rec } = await load();
    const res = await mod.POST(
      post(confirmed('create_activity_report', { weekNumber: 12, year: 2027 }))
    );
    expect(res.status).toBe(200);
    expect(rec.writes('insert', 'activity_reports')[0]).toMatchObject({
      trainingCatalogId: FIAE,
    });
  });

  it('a trainee with one occupation: the report is FIAE, as before', async () => {
    const { mod, rec } = await load({ traineeEnrollments: [] });
    const res = await mod.POST(
      post(confirmed('create_activity_report', { weekNumber: 12, year: 2027 }))
    );
    expect(res.status).toBe(200);
    expect(rec.writes('insert', 'activity_reports')[0]).toMatchObject({
      trainingCatalogId: FIAE,
    });
  });

  it('refuses an occupation the trainee is not enrolled in, nothing is written', async () => {
    const { mod, rec } = await load({
      traineeEnrollments: [twoEnrollments[0]],
    });
    const res = await mod.POST(
      post(
        confirmed('create_activity_report', { weekNumber: 12, year: 2027 }),
        'KFBM'
      )
    );
    expect(res.status).toBe(403);
    expect(rec.writes('insert', 'activity_reports')).toEqual([]);
  });
});

describe('submit_activity_report', () => {
  const draft = { id: REPORT, status: 'DRAFT', weekNumber: 12 };

  it('by week: looks the report up in the chosen occupation', async () => {
    const { mod, rec } = await load({ activityReports: [draft] });
    const res = await mod.POST(
      post(
        confirmed('submit_activity_report', { weekNumber: 12, year: 2027 }),
        'KFBM'
      )
    );
    expect(res.status).toBe(200);
    const lookup = rec.filters('select', 'activity_reports');
    expect(lookup.params).toContain(KFBM);
    expect(lookup.params).not.toContain(FIAE);
    expect(rec.writes('update', 'activity_reports')[0]).toMatchObject({
      status: 'SUBMITTED',
    });
  });

  it('the most recent draft is the one of the chosen occupation', async () => {
    const { mod, rec } = await load({ activityReports: [draft] });
    const res = await mod.POST(
      post(confirmed('submit_activity_report', {}), 'FIAE')
    );
    expect(res.status).toBe(200);
    const lookup = rec.filters('select', 'activity_reports');
    expect(lookup.sql).toContain(
      '"activity_reports"."training_catalog_id" = $'
    );
    expect(lookup.params).toContain(FIAE);
    expect(lookup.params).not.toContain(KFBM);
  });

  it('by id: the own report is submitted whatever its occupation, no occupation is asked', async () => {
    const { mod, rec } = await load({ activityReports: [draft] });
    const res = await mod.POST(
      post(confirmed('submit_activity_report', { reportId: REPORT }))
    );
    expect(res.status).toBe(200);
    expect(
      rec.calls.filter(
        c => c.op === 'select' && c.table === 'training_catalogs'
      )
    ).toHaveLength(0);
    expect(rec.filters('select', 'activity_reports').sql).not.toContain(
      'training_catalog_id'
    );
  });
});

describe('approve_report (trainer level)', () => {
  const TRAINEE = '10000000-0000-4000-8000-000000000002';
  const trainer = fakeSession({
    id: ME,
    role: 'TRAINER',
    isTrainerLevel: true,
    organizationId: ORG,
  });
  const tables = {
    profiles: [
      {
        id: TRAINEE,
        role: 'TRAINEE',
        organizationId: ORG,
        assignedTrainerId: ME,
      },
    ],
    activityReports: [
      {
        id: REPORT,
        status: 'SUBMITTED',
        traineeId: TRAINEE,
        trainingCatalogId: FIAE,
        assignedTrainerId: ME,
      },
    ],
  };

  it('acts on a report of the chosen occupation', async () => {
    const { mod, rec } = await load(tables, trainer);
    const res = await mod.POST(
      post(confirmed('approve_report', { reportId: REPORT }), 'FIAE')
    );
    expect(res.status).toBe(200);
    expect(rec.writes('update', 'activity_reports')[0]).toMatchObject({
      status: 'APPROVED',
    });
  });

  it('a report of another occupation answers like a missing one, nothing is written', async () => {
    const { mod, rec } = await load(tables, trainer);
    const res = await mod.POST(
      post(confirmed('approve_report', { reportId: REPORT }), 'KFBM')
    );
    expect(res.status).toBe(404);
    expect(rec.writes('update', 'activity_reports')).toEqual([]);
  });

  it('without a choice the occupation does not restrict (as before)', async () => {
    const { mod } = await load(tables, trainer);
    const res = await mod.POST(
      post(confirmed('approve_report', { reportId: REPORT }))
    );
    expect(res.status).toBe(200);
  });
});
