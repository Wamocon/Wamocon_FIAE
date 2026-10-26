/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../helpers/mockDb';
import { mockCatalogScope } from '../../helpers/mockNext';

// HAI callers that know the trainee use the phase plan of the occupation
// (KfBM S4): the user snapshot and the draft of an activity report. FIAE keeps
// the 18 / 12 month rule.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

const settings = {
  FIAE: { phase_months: [18, 18] },
  KFBM: { phase_months: [15, 21] },
} as const;

type Occupation = keyof typeof settings;

function scopeFor(occupation: Occupation) {
  const id = occupation === 'FIAE' ? FIAE : KFBM;
  return { allowedCatalogIds: [id], activeCatalogId: id, selected: false };
}

// 16 whole months ago: phase 1 under the FIAE rule (18), phase 2 for KfBM (15)
function sixteenMonthsAgo() {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 16, 1);
}

async function load(occupation: Occupation, tables: Record<string, any>) {
  jest.resetModules();
  const mock = createTableDb({
    trainingCatalogs: [{ settings: settings[occupation] }],
    ...tables,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    toHaiRole: (role?: string | null) =>
      role === 'TRAINER' || role === 'ADMIN' ? 'TRAINER' : 'TRAINEE',
    getUserOrgId: async () => 'org-1',
    getUserOrgIdStrict: async () => 'org-1',
  }));
  mockCatalogScope(scopeFor(occupation));
  return mock;
}

describe('HAI user snapshot', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  const trainee = (durationYears = 3) => ({
    fullName: 'Azubi',
    firstName: 'A',
    role: 'TRAINEE',
    startOfTrainingDate: sixteenMonthsAgo(),
    ausbildungDurationYears: durationYears,
  });

  it('FIAE: month 16 is still phase 1', async () => {
    await load('FIAE', { profiles: [trainee()] });
    const { fetchUserSnapshot } = await import('@/lib/hai/dataContext');
    const snapshot = await fetchUserSnapshot('t1');
    expect(snapshot?.currentTrainingPhase).toBe(1);
  });

  it('FIAE shortened (2 years): month 16 is phase 2', async () => {
    await load('FIAE', { profiles: [trainee(2)] });
    const { fetchUserSnapshot } = await import('@/lib/hai/dataContext');
    const snapshot = await fetchUserSnapshot('t1');
    expect(snapshot?.currentTrainingPhase).toBe(2);
  });

  it('KfBM: month 16 is phase 2', async () => {
    await load('KFBM', { profiles: [trainee()] });
    const { fetchUserSnapshot } = await import('@/lib/hai/dataContext');
    const snapshot = await fetchUserSnapshot('t1');
    expect(snapshot?.currentTrainingPhase).toBe(2);
  });

  it('a trainer has no training phase', async () => {
    await load('KFBM', {
      profiles: [{ ...trainee(), role: 'TRAINER' }],
    });
    const { fetchUserSnapshot } = await import('@/lib/hai/dataContext');
    const snapshot = await fetchUserSnapshot('tr1');
    expect(snapshot?.currentTrainingPhase).toBeUndefined();
  });
});

describe('HAI action create_activity_report', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  // The week starts on 2027-11-15, month 15 of a training from 2026-08-01
  const tables = (durationYears: number) => ({
    profiles: [
      {
        id: 't1',
        role: 'TRAINEE',
        fullName: 'Azubi',
        startOfTrainingDate: new Date(2026, 7, 1),
        ausbildungDurationYears: durationYears,
      },
    ],
    activityReports: [],
  });

  async function createReport(occupation: Occupation, durationYears = 3) {
    const mock = await load(occupation, tables(durationYears));
    const { executeAction } = await import('@/lib/hai/actions');
    const result = await executeAction(
      'create_activity_report',
      { weekNumber: 46, year: 2027 },
      { id: 't1', role: 'TRAINEE', organizationId: 'org-1' } as any
    );
    return { result, mock };
  }

  it('FIAE: month 15 is phase 1', async () => {
    const { result, mock } = await createReport('FIAE');
    expect(result.success).toBe(true);
    expect(mock.writes('insert', 'activity_reports')[0]).toMatchObject({
      ausbildungsjahr: 1,
    });
  });

  it('FIAE shortened: month 15 is phase 2', async () => {
    const { result, mock } = await createReport('FIAE', 2);
    expect(result.success).toBe(true);
    expect(mock.writes('insert', 'activity_reports')[0]).toMatchObject({
      ausbildungsjahr: 2,
    });
  });

  it('KfBM: month 15 is phase 2', async () => {
    const { result, mock } = await createReport('KFBM');
    expect(result.success).toBe(true);
    expect(mock.writes('insert', 'activity_reports')[0]).toMatchObject({
      ausbildungsjahr: 2,
    });
  });
});
