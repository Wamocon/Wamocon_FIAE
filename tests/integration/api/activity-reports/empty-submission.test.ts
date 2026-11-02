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

// WMCNL-3011: an Ausbildungsnachweis without a single entry with hours was
// handed in (0 Std., "Keine Einträge") and landed with the trainer. Handing in
// needs at least one entry with hours, on the server (create and update) and in
// the pages. A draft can still be saved without entries (update only).

const FIAE = '00000000-0000-4000-8000-000000000001';
const ORG = 'org-1';
const ME = '11111111-1111-4111-8111-111111111111';
const REPORT = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

const traineeProfile = {
  id: ME,
  role: 'TRAINEE',
  organizationId: ORG,
  isPlatformOwner: false,
  startOfTrainingDate: new Date(2026, 7, 1),
  ausbildungDurationYears: 3,
};

// The table mock ignores where(): a POST needs a table without the draft of the
// fixture or the duplicate check would find it
async function load(route: string, withDraft = true) {
  jest.resetModules();
  jest.dontMock('@/lib/catalog/scope');
  mockSession(traineeSession(ME, { organizationId: ORG }));
  const mock = createTableDb({
    trainingCatalogs: [
      {
        id: FIAE,
        code: 'FIAE',
        isActive: true,
        settings: { phase_months: [18, 18] },
      },
    ],
    organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
    traineeEnrollments: [],
    profiles: [traineeProfile],
    activityReports: withDraft
      ? [
          {
            id: REPORT,
            traineeId: ME,
            trainingCatalogId: FIAE,
            status: 'DRAFT',
            weekNumber: 42,
            year: 2026,
            ausbildungsjahr: 1,
          },
        ]
      : [],
    trainingUseCases: [{ id: 'u1', description: 'Use case', plannedHours: 40 }],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import(`@/app/api/${route}`);
  return { mod, mock };
}

const request = (method: string, url: string, body: unknown) =>
  makeRequest(method, url, { token: 't', body });

const entry = (hours: number) => ({
  useCaseId: 'u1',
  actualHours: hours,
  plannedHours: 40,
  traineeGrade: '2',
});
const params = { params: Promise.resolve({ id: REPORT }) };
const base = { weekNumber: 42, year: 2026 };

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe('PUT /api/activity-reports/[id] with submit', () => {
  const put = (body: Record<string, unknown>) =>
    request('PUT', `http://localhost/api/activity-reports/${REPORT}`, {
      ...base,
      ...body,
    });

  it.each([
    ['no entries at all', { entries: [] }],
    ['no entries field', {}],
    ['only entries of 0 hours', { entries: [entry(0)] }],
  ])(
    'refuses %s with EMPTY_SUBMISSION and writes nothing',
    async (_n, body) => {
      const { mod, mock } = await load('activity-reports/[id]/route');
      const res = await mod.PUT(put({ ...body, submit: true }), params);
      expect(res.status).toBe(400);
      const answer = await res.json();
      expect(answer.code).toBe('EMPTY_SUBMISSION');
      expect(answer.error).toContain('ohne Tätigkeit');
      expect(mock.writes('update', 'activity_reports')).toHaveLength(0);
    }
  );

  it('hands in a report with one entry with hours', async () => {
    const { mod, mock } = await load('activity-reports/[id]/route');
    const res = await mod.PUT(
      put({ entries: [entry(8)], submit: true }),
      params
    );
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'activity_reports')).toHaveLength(1);
  });

  it('still saves a draft without entries (nothing is handed in)', async () => {
    const { mod } = await load('activity-reports/[id]/route');
    const res = await mod.PUT(put({ entries: [], submit: false }), params);
    expect(res.status).toBe(200);
  });
});

describe('POST /api/activity-reports with submit', () => {
  // another week than the draft of the fixture
  const post = (body: Record<string, unknown>) =>
    request('POST', 'http://localhost/api/activity-reports', {
      weekNumber: 43,
      year: 2026,
      ...body,
    });

  it('refuses a hand-in with only entries of 0 hours and writes nothing', async () => {
    const { mod, mock } = await load('activity-reports/route');
    const res = await mod.POST(post({ entries: [entry(0)], submit: true }));
    expect(res.status).toBe(400);
    expect((await res.json()).code).toBe('EMPTY_SUBMISSION');
    expect(mock.writes('insert', 'activity_reports')).toHaveLength(0);
  });

  it('refuses a hand-in without entries (a 400, nothing written)', async () => {
    const { mod, mock } = await load('activity-reports/route');
    const res = await mod.POST(post({ entries: [], submit: true }));
    expect(res.status).toBe(400);
    expect(mock.writes('insert', 'activity_reports')).toHaveLength(0);
  });

  it('creates a submitted report with an entry with hours', async () => {
    const { mod, mock } = await load('activity-reports/route', false);
    const res = await mod.POST(post({ entries: [entry(8)], submit: true }));
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'activity_reports')).toHaveLength(1);
  });
});
