/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  mockSession,
  mockTraineeAccess,
} from '../../../helpers/mockNext';

// Trainer routes that know the trainee use the phase plan of the occupation of
// that trainee (KfBM S4b): the blocker and the company exam a trainer creates,
// and the phase length in the report list. The phase plan loading itself has
// its own tests, here it is replaced by a lookup that answers per trainee, so
// one request can hold a FIAE and a KfBM trainee.

const ORG = 'org-1';
const settings: Record<string, unknown> = {
  f1: { phase_months: [18, 18] },
  k1: { phase_months: [15, 21] },
  k2: { phase_months: [15, 21] },
};

// Training began on 2026-08-01, 2027-11-15 is month 15
const START = new Date(2026, 7, 1);
const DATE = '2027-11-15';

const trainer = {
  firstName: 'Tina',
  lastName: 'Trainer',
  email: 'trainer@example.com',
  fullName: 'Tina Trainer',
  role: 'TRAINER',
};

const traineeRow = (id: string, durationYears = 3) => ({
  id,
  fullName: `Azubi ${id}`,
  firstName: 'Azubi',
  lastName: id,
  email: `${id}@example.com`,
  startOfTrainingDate: START,
  ausbildungDurationYears: durationYears,
});

function mockPhasePlans() {
  const loadPhasePlanForUser = jest.fn(async (id: string, years: number) => {
    const { resolvePhasePlan } = jest.requireActual(
      '@/lib/catalog/phase-plan'
    ) as typeof import('@/lib/catalog/phase-plan');
    return resolvePhasePlan(settings[id], years);
  });
  const loadPhasePlansForUsers = jest.fn(
    async (users: { id: string; durationYears: number }[]) => {
      const { resolvePhasePlan } = jest.requireActual(
        '@/lib/catalog/phase-plan'
      ) as typeof import('@/lib/catalog/phase-plan');
      return new Map(
        users.map(u => [
          u.id,
          resolvePhasePlan(settings[u.id], u.durationYears),
        ])
      );
    }
  );
  jest.doMock('@/lib/catalog/phase-plan-db', () => ({
    __esModule: true,
    loadPhasePlanForUser,
    loadPhasePlansForUsers,
  }));
  return { loadPhasePlanForUser, loadPhasePlansForUsers };
}

const call = (method: string, url: string, body?: unknown) =>
  ({
    url,
    method,
    nextUrl: new URL(url),
    headers: { get: () => null },
    json: async () => body,
  }) as any;

describe('POST /api/trainer/blocks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  async function load(trainees: ReturnType<typeof traineeRow>[]) {
    jest.resetModules();
    const mock = createTableDb({
      // the trainer first, then one row per trainee in the order of the list
      profiles: { sequence: [[trainer], ...trainees.map(t => [t])] },
      ausbildungBlocks: [],
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    jest.doMock('@/lib/auth-helpers', () => ({
      __esModule: true,
      getUserOrgId: async () => ORG,
    }));
    jest.doMock('@/lib/email', () => ({
      __esModule: true,
      sendBlockerInvite: jest.fn(async () => undefined),
    }));
    mockSession(fakeSession({ id: 'tr1', organizationId: ORG }));
    mockTraineeAccess('ok');
    const plans = mockPhasePlans();
    const mod = await import('@/app/api/trainer/blocks/route');
    return { mod, mock, plans };
  }

  const body = (traineeIds: string[]) => ({
    traineeIds,
    blockType: 'SCHOOL',
    startDate: DATE,
    endDate: '2027-11-19',
    sendInvitation: false,
  });

  it('gives each trainee the phase of their own occupation', async () => {
    const { mod, mock, plans } = await load([
      traineeRow('f1'),
      traineeRow('k1'),
    ]);
    const res = await mod.POST(
      call('POST', 'http://localhost/api/trainer/blocks', body(['f1', 'k1']))
    );
    expect(res.status).toBe(201);
    const rows = mock.writes('insert', 'ausbildung_blocks') as any[];
    expect(rows.map(r => [r.traineeId, r.ausbildungsjahr])).toEqual([
      ['f1', 1],
      ['k1', 2],
    ]);
    expect(plans.loadPhasePlanForUser).toHaveBeenCalledWith('f1', 3);
    expect(plans.loadPhasePlanForUser).toHaveBeenCalledWith('k1', 3);
  });

  it('FIAE shortened (2 years): month 15 is phase 2', async () => {
    const { mod, mock } = await load([traineeRow('f1', 2)]);
    await mod.POST(
      call('POST', 'http://localhost/api/trainer/blocks', body(['f1']))
    );
    expect(mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
      ausbildungsjahr: 2,
    });
  });

  it('does not ask for a phase plan of a trainee without a start date', async () => {
    const noStart = { ...traineeRow('k1'), startOfTrainingDate: null as any };
    const { mod, mock, plans } = await load([noStart]);
    await mod.POST(
      call('POST', 'http://localhost/api/trainer/blocks', body(['k1']))
    );
    expect(mock.writes('insert', 'ausbildung_blocks')[0]).toMatchObject({
      ausbildungsjahr: 1,
    });
    expect(plans.loadPhasePlanForUser).not.toHaveBeenCalled();
  });
});

describe('POST /api/trainer/school/exams', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  async function load(trainee: ReturnType<typeof traineeRow>) {
    jest.resetModules();
    const mock = createTableDb({ profiles: [trainee], schoolExams: [] });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    jest.doMock('@/lib/auth-helpers', () => ({
      __esModule: true,
      getUserOrgId: async () => ORG,
      verifyPlatformOwner: async () => false,
    }));
    mockSession(fakeSession({ id: 'tr1', organizationId: ORG }));
    mockTraineeAccess('ok');
    const plans = mockPhasePlans();
    const mod = await import('@/app/api/trainer/school/exams/route');
    return { mod, mock, plans };
  }

  const post = (traineeId: string) =>
    call('POST', 'http://localhost/api/trainer/school/exams', {
      traineeId,
      subject: 'Betriebliche Prüfung',
      examDate: DATE,
    });

  it('FIAE: month 15 is still phase 1', async () => {
    const { mod, mock } = await load(traineeRow('f1'));
    const res = await mod.POST(post('f1'));
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'school_exams')[0]).toMatchObject({
      ausbildungsjahr: 1,
    });
  });

  it('FIAE shortened (2 years): month 15 is phase 2', async () => {
    const { mod, mock } = await load(traineeRow('f1', 2));
    await mod.POST(post('f1'));
    expect(mock.writes('insert', 'school_exams')[0]).toMatchObject({
      ausbildungsjahr: 2,
    });
  });

  it('KfBM: month 15 is phase 2', async () => {
    const { mod, mock, plans } = await load(traineeRow('k1'));
    await mod.POST(post('k1'));
    expect(mock.writes('insert', 'school_exams')[0]).toMatchObject({
      ausbildungsjahr: 2,
    });
    expect(plans.loadPhasePlanForUser).toHaveBeenCalledWith('k1', 3);
  });
});

describe('GET /api/trainer/activity-reports', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  const report = (id: string, traineeId: string) => ({
    id,
    traineeId,
    status: 'SUBMITTED',
    ausbildungsjahr: 1,
    submittedAt: new Date(2027, 10, 20),
  });

  async function load(
    trainees: { id: string; durationYears: number | null }[],
    reports: ReturnType<typeof report>[]
  ) {
    jest.resetModules();
    const mock = createTableDb({
      profiles: trainees.map(t => ({
        id: t.id,
        fullName: `Azubi ${t.id}`,
        ausbildungDurationYears: t.durationYears,
        organizationId: ORG,
        assignedTrainerId: 'tr1',
      })),
      activityReports: reports,
      activityReportUseCaseEntries: [],
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    mockSession(fakeSession({ id: 'tr1', organizationId: ORG }));
    const plans = mockPhasePlans();
    const mod = await import('@/app/api/trainer/activity-reports/route');
    return { mod, plans };
  }

  const get = () =>
    call(
      'GET',
      'http://localhost/api/trainer/activity-reports?status=SUBMITTED'
    );

  it('tells the phase one length of the occupation of each trainee', async () => {
    const { mod } = await load(
      [
        { id: 'f1', durationYears: 3 },
        { id: 'k1', durationYears: 3 },
        { id: 'k2', durationYears: 2 },
      ],
      [report('r1', 'f1'), report('r2', 'k1'), report('r3', 'k2')]
    );
    const body = await (await mod.GET(get())).json();
    const byId = Object.fromEntries(
      body.reports.map((r: any) => [r.id, r.traineePhaseOneMonths])
    );
    // FIAE 18, KfBM 15, KfBM shortened 10
    expect(byId).toEqual({ r1: 18, r2: 15, r3: 10 });
  });

  it('keeps every other field of a report as it was', async () => {
    const { mod } = await load(
      [{ id: 'f1', durationYears: null }],
      [report('r1', 'f1')]
    );
    const body = await (await mod.GET(get())).json();
    expect(body.reports[0]).toMatchObject({
      id: 'r1',
      traineeName: 'Azubi f1',
      traineeAusbildungDurationYears: 3,
      entryCount: 0,
      totalHours: 0,
      hasOverbooking: false,
      isPending: true,
    });
    // a trainee without a duration counts as 3 years, also for the plan
    expect(body.reports[0].traineePhaseOneMonths).toBe(18);
  });

  it('asks for the plans of the trainees of the listed reports only, once', async () => {
    const { mod, plans } = await load(
      [
        { id: 'f1', durationYears: 3 },
        { id: 'k1', durationYears: 3 },
      ],
      [report('r1', 'k1'), report('r2', 'k1')]
    );
    await mod.GET(get());
    expect(plans.loadPhasePlansForUsers).toHaveBeenCalledTimes(1);
    expect(plans.loadPhasePlansForUsers).toHaveBeenCalledWith([
      { id: 'k1', durationYears: 3 },
    ]);
  });

  it('asks for no plans when there are no reports', async () => {
    const { mod, plans } = await load([{ id: 'f1', durationYears: 3 }], []);
    const body = await (await mod.GET(get())).json();
    expect(body.reports).toEqual([]);
    expect(plans.loadPhasePlansForUsers).not.toHaveBeenCalled();
  });
});
