/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  FIAE,
  KFBM,
  ORG,
  OTHER_ORG,
  T1,
  T3,
  loadScoped,
  scopeReq,
  selectsFrom,
  superAdminSession,
  trainerSession,
} from '../../../helpers/trainerScope';
import { traineeSession } from '../../../helpers/mockNext';

// Trainer routes that read or change the data of ONE trainee (a report, an
// evaluation, a block, an exam, a review, the trainee profile itself). Each
// one has to answer like a missing record (404) for a trainee of another
// organization or of another occupation than the chosen one, and must not
// change anything then. The platform-owner flag of an organization does not
// widen the scope, the super admin sees every organization.

const traineeRow = (organizationId = ORG) => ({
  id: T1,
  role: 'TRAINEE',
  organizationId,
  fullName: 'Azubi Eins',
  email: 'a1@example.com',
  startOfTrainingDate: new Date(2026, 7, 1),
  ausbildungDurationYears: 3,
});

type Write = { op: 'update' | 'insert' | 'delete'; table: string };
type Case = {
  name: string;
  route: string;
  method: string;
  url: string;
  params?: Record<string, string>;
  body?: unknown;
  tables: Record<string, any>;
  returns?: Record<string, any[]>;
  write?: Write;
  /** The trainee is bound by this column in the where() of the write. */
  whereTrainee?: string;
  ok: number;
};

const API = 'http://localhost/api/trainer';

const report = {
  id: 'r1',
  traineeId: T1,
  status: 'SUBMITTED',
  weekNumber: 1,
  year: 2027,
};
const evaluation = {
  id: 'ev1',
  traineeId: T1,
  status: 'SUBMITTED',
  trainerRating: '2',
  weekNumber: 1,
  year: 2027,
};

const cases: Case[] = [
  {
    name: 'GET /trainees/[id]',
    route: 'trainer/trainees/[traineeId]/route',
    method: 'GET',
    url: `${API}/trainees/${T1}`,
    params: { traineeId: T1 },
    tables: {},
    ok: 200,
  },
  {
    name: 'GET /trainees/[id]/overview',
    route: 'trainer/trainees/[traineeId]/overview/route',
    method: 'GET',
    url: `${API}/trainees/${T1}/overview`,
    params: { traineeId: T1 },
    tables: {},
    ok: 200,
  },
  {
    name: 'PATCH /trainees/[id]',
    route: 'trainer/trainees/[traineeId]/route',
    method: 'PATCH',
    url: `${API}/trainees/${T1}`,
    params: { traineeId: T1 },
    body: { full_name: 'Neu' },
    tables: {},
    returns: {
      profiles: [
        {
          id: T1,
          fullName: 'Neu',
          ausbildungDurationYears: 3,
          assignedTrainerId: null,
          trainerActivated: false,
        },
      ],
    },
    write: { op: 'update', table: 'profiles' },
    whereTrainee: '"profiles"."organization_id" = $',
    ok: 200,
  },
  {
    name: 'PATCH /trainees/[id]/activate',
    route: 'trainer/trainees/[traineeId]/activate/route',
    method: 'PATCH',
    url: `${API}/trainees/${T1}/activate`,
    params: { traineeId: T1 },
    body: { itemType: 'ENABLER', itemId: 'e1', isActive: true },
    tables: { enablers: [{ trainingCatalogId: FIAE }] },
    write: { op: 'insert', table: 'trainee_enabler_overrides' },
    ok: 200,
  },
  {
    name: 'GET /activity-reports/[id]',
    route: 'trainer/activity-reports/[id]/route',
    method: 'GET',
    url: `${API}/activity-reports/r1`,
    params: { id: 'r1' },
    tables: { activityReports: [report], activityReportEntries: [] },
    ok: 200,
  },
  {
    name: 'PUT /activity-reports/[id]',
    route: 'trainer/activity-reports/[id]/route',
    method: 'PUT',
    url: `${API}/activity-reports/r1`,
    params: { id: 'r1' },
    body: { action: 'approve' },
    tables: { activityReports: [report] },
    returns: { activityReports: [{ ...report, status: 'APPROVED' }] },
    write: { op: 'update', table: 'activity_reports' },
    whereTrainee: '"activity_reports"."trainee_id" = $',
    ok: 200,
  },
  {
    name: 'GET /evaluations/[id]',
    route: 'trainer/evaluations/[id]/route',
    method: 'GET',
    url: `${API}/evaluations/ev1`,
    params: { id: 'ev1' },
    tables: {
      weeklyEvaluations: [evaluation],
      weeklySoftskillRatings: [],
    },
    ok: 200,
  },
  {
    name: 'PUT /evaluations/[id]',
    route: 'trainer/evaluations/[id]/route',
    method: 'PUT',
    url: `${API}/evaluations/ev1`,
    params: { id: 'ev1' },
    body: { trainerRating: '2' },
    tables: { weeklyEvaluations: [evaluation], weeklySoftskillRatings: [] },
    write: { op: 'update', table: 'weekly_evaluations' },
    whereTrainee: '"weekly_evaluations"."trainee_id" = $',
    ok: 200,
  },
  {
    name: 'PATCH /evaluations/[id]',
    route: 'trainer/evaluations/[id]/route',
    method: 'PATCH',
    url: `${API}/evaluations/ev1`,
    params: { id: 'ev1' },
    body: { action: 'approve' },
    tables: { weeklyEvaluations: [evaluation] },
    write: { op: 'update', table: 'weekly_evaluations' },
    whereTrainee: '"weekly_evaluations"."trainee_id" = $',
    ok: 200,
  },
  {
    name: 'PATCH /blocks/[id]',
    route: 'trainer/blocks/[blockId]/route',
    method: 'PATCH',
    url: `${API}/blocks/b1`,
    params: { blockId: 'b1' },
    body: { title: 'Neu' },
    tables: {
      ausbildungBlocks: [
        {
          id: 'b1',
          traineeId: T1,
          blockType: 'TRAINER_BLOCKER',
          createdByTrainerId: T3,
        },
      ],
    },
    returns: { ausbildungBlocks: [{ id: 'b1', title: 'Neu' }] },
    write: { op: 'update', table: 'ausbildung_blocks' },
    whereTrainee: '"ausbildung_blocks"."trainee_id" = $',
    ok: 200,
  },
  {
    name: 'DELETE /blocks/[id]',
    route: 'trainer/blocks/[blockId]/route',
    method: 'DELETE',
    url: `${API}/blocks/b1`,
    params: { blockId: 'b1' },
    tables: {
      ausbildungBlocks: [
        {
          id: 'b1',
          traineeId: T1,
          blockType: 'TRAINER_BLOCKER',
          createdByTrainerId: T3,
        },
      ],
    },
    write: { op: 'delete', table: 'ausbildung_blocks' },
    whereTrainee: '"ausbildung_blocks"."trainee_id" = $',
    ok: 200,
  },
  {
    name: 'GET /blocks?traineeId',
    route: 'trainer/blocks/route',
    method: 'GET',
    url: `${API}/blocks?traineeId=${T1}`,
    tables: { ausbildungBlocks: [] },
    ok: 200,
  },
  {
    name: 'GET /school/exams?traineeId',
    route: 'trainer/school/exams/route',
    method: 'GET',
    url: `${API}/school/exams?traineeId=${T1}`,
    tables: { schoolExams: [] },
    ok: 200,
  },
  {
    name: 'PUT /school/exams/[id]/grade',
    route: 'trainer/school/exams/[examId]/grade/route',
    method: 'PUT',
    url: `${API}/school/exams/x1/grade`,
    params: { examId: 'x1' },
    body: { points: 40, maxPoints: 50 },
    tables: {
      schoolExams: [{ traineeId: T1, subject: 'Mathe' }],
      schoolExamResults: [],
    },
    returns: { schoolExamResults: [{ id: 'res1', points: 40 }] },
    write: { op: 'insert', table: 'school_exam_results' },
    ok: 200,
  },
  {
    name: 'PATCH /reviews/enablers/[id]',
    route: 'trainer/reviews/enablers/[submissionId]/route',
    method: 'PATCH',
    url: `${API}/reviews/enablers/s1`,
    params: { submissionId: 's1' },
    body: { status: 'APPROVED' },
    tables: {
      enablerSubmissions: [{ id: 's1', enablerId: 'e1', traineeId: T1 }],
      enablers: [{ id: 'e1', trainingCatalogId: FIAE }],
    },
    returns: {
      enablerSubmissions: [{ id: 's1', enablerId: 'e1', traineeId: T1 }],
    },
    write: { op: 'update', table: 'enabler_submissions' },
    whereTrainee: '"enabler_submissions"."trainee_id" = $',
    ok: 200,
  },
  {
    name: 'PATCH /reviews/use-cases/[id]',
    route: 'trainer/reviews/use-cases/[submissionId]/route',
    method: 'PATCH',
    url: `${API}/reviews/use-cases/s1`,
    params: { submissionId: 's1' },
    body: { status: 'APPROVED' },
    tables: {
      useCaseSubmissions: [{ id: 's1', useCaseId: 'u1', traineeId: T1 }],
      useCases: [{ id: 'u1', trainingCatalogId: FIAE }],
    },
    returns: {
      useCaseSubmissions: [{ id: 's1', useCaseId: 'u1', traineeId: T1 }],
    },
    write: { op: 'update', table: 'use_case_submissions' },
    whereTrainee: '"use_case_submissions"."trainee_id" = $',
    ok: 200,
  },
  {
    name: 'POST /school/exams',
    route: 'trainer/school/exams/route',
    method: 'POST',
    url: `${API}/school/exams`,
    body: { traineeId: T1, subject: 'Betrieb', examDate: '2027-11-15' },
    tables: { schoolExams: [] },
    write: { op: 'insert', table: 'school_exams' },
    ok: 200,
  },
];

async function run(
  entry: Case,
  options: {
    session?: any;
    org?: string;
    header?: string;
    profiles?: any;
  } = {}
) {
  const { mod, mock } = await loadScoped(entry.route, {
    session: options.session,
    tables: {
      profiles: options.profiles ?? [traineeRow(options.org ?? ORG)],
      ...entry.tables,
    },
    returns: entry.returns,
    setup: () => {
      jest.doMock('@/lib/catalog/phase-plan-db', () => ({
        __esModule: true,
        loadPhasePlanForUser: async () => ({ phaseMonths: [18, 18] }),
        loadPhasePlansForUsers: async () => new Map(),
      }));
      jest.doMock('@/lib/email', () => ({
        __esModule: true,
        sendBlockerInvite: async () => undefined,
      }));
    },
  });
  const request = scopeReq(entry.url, {
    header: options.header,
    method: entry.method,
    body: entry.body,
  });
  const res = await (entry.params
    ? mod[entry.method](request, { params: Promise.resolve(entry.params) })
    : mod[entry.method](request));
  return { res, mock };
}

const writes = (mock: any, entry: Case) =>
  entry.write ? mock.writes(entry.write.op, entry.write.table) : [];

describe.each(cases)('$name', entry => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  it('works for a trainee of the own organization', async () => {
    const { res, mock } = await run(entry);
    expect(res.status).toBe(entry.ok);
    if (entry.write) {
      expect(writes(mock, entry).length).toBeGreaterThan(0);
    }
  });

  it('binds the change to the checked trainee in the where()', async () => {
    if (!entry.whereTrainee) return;
    const { mock } = await run(entry);
    const where = mock.filters(entry.write!.op, entry.write!.table);
    expect(where.sql).toContain(entry.whereTrainee);
    expect(where.params).toContain(
      entry.whereTrainee.includes('organization_id') ? ORG : T1
    );
  });

  it('answers 404 for a trainee of another organization and changes nothing', async () => {
    const { res, mock } = await run(entry, { org: OTHER_ORG });
    expect(res.status).toBe(404);
    expect(writes(mock, entry)).toEqual([]);
    expect(mock.writes('insert', 'notifications')).toEqual([]);
  });

  it('answers 404 for an unknown trainee', async () => {
    const { res, mock } = await run(entry, { profiles: [] });
    expect(res.status).toBe(404);
    expect(writes(mock, entry)).toEqual([]);
  });

  it('the platform-owner flag of the organization is no exception', async () => {
    const { res, mock } = await run(entry, {
      session: trainerSession({ isPlatformOwner: true }),
      org: OTHER_ORG,
    });
    expect(res.status).toBe(404);
    expect(writes(mock, entry)).toEqual([]);
  });

  it('answers 404 for a trainee of another occupation than the chosen one', async () => {
    const { res, mock } = await run(entry, {
      header: 'KFBM',
      // the second lookup is the occupation check, it finds nobody
      profiles: { sequence: [[traineeRow()], []] },
    });
    expect(res.status).toBe(404);
    expect(writes(mock, entry)).toEqual([]);
  });

  it('refuses an occupation the organization has not enabled (403)', async () => {
    const { mod } = await loadScoped(entry.route, {
      tables: {
        profiles: [traineeRow()],
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
        ...entry.tables,
      },
    });
    const request = scopeReq(entry.url, {
      header: 'KFBM',
      method: entry.method,
      body: entry.body,
    });
    const res = await (entry.params
      ? mod[entry.method](request, { params: Promise.resolve(entry.params) })
      : mod[entry.method](request));
    expect(res.status).toBe(403);
  });

  it('the super admin reaches a trainee of any organization', async () => {
    const { res } = await run(entry, {
      session: superAdminSession(),
      org: OTHER_ORG,
    });
    expect(res.status).toBe(entry.ok);
  });

  it('turns a trainee away (403) and an anonymous caller (401)', async () => {
    const trainee = await run(entry, { session: traineeSession('t9') });
    expect(trainee.res.status).toBe(403);
    expect(selectsFrom(trainee.mock, 'profiles')).toHaveLength(0);
    const anonymous = await run(entry, { session: null });
    expect(anonymous.res.status).toBe(401);
  });
});

describe('a DRAFT report is private to the trainee', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  const draft = { ...report, status: 'DRAFT' };
  const params = { params: Promise.resolve({ id: 'r1' }) };

  it('GET and PUT answer 404 for an own trainee and change nothing', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/activity-reports/[id]/route',
      {
        tables: { profiles: [traineeRow()], activityReports: [draft] },
      }
    );
    const url = `${API}/activity-reports/r1`;
    expect((await mod.GET(scopeReq(url), params)).status).toBe(404);
    const put = await mod.PUT(
      scopeReq(url, { method: 'PUT', body: { action: 'approve' } }),
      params
    );
    expect(put.status).toBe(404);
    expect(mock.writes('update', 'activity_reports')).toEqual([]);
  });

  it('the trainer list and the school list leave drafts out', async () => {
    const list = await loadScoped('trainer/activity-reports/route', {
      tables: {
        profiles: [traineeRow()],
        activityReports: [],
        activityReportUseCaseEntries: [],
      },
    });
    await list.mod.GET(scopeReq(`${API}/activity-reports?status=DRAFT`));
    expect(
      list.mock.filters('select', 'activity_reports').params
    ).not.toContain('DRAFT');
    const school = await loadScoped('trainer/school/activity-reports/route', {
      tables: { activityReports: [], activityReportEntries: [] },
    });
    await school.mod.GET(scopeReq(`${API}/school/activity-reports`));
    expect(school.mock.filters('select', 'activity_reports').sql).toContain(
      '"activity_reports"."status" <> $'
    );
  });

  it('answers 409 when the report was reviewed in the meantime and does not notify', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/activity-reports/[id]/route',
      {
        tables: { profiles: [traineeRow()], activityReports: [report] },
        returns: { activityReports: [] },
      }
    );
    const res = await mod.PUT(
      scopeReq(`${API}/activity-reports/r1`, {
        method: 'PUT',
        body: { action: 'approve' },
      }),
      params
    );
    expect(res.status).toBe(409);
    expect(mock.writes('insert', 'notifications')).toEqual([]);
  });
});

describe('a foreign record answers exactly like a missing one', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it.each(cases.filter(c => c.params && c.method !== 'GET'))(
    '$name',
    async entry => {
      const foreign = await run(entry, { org: OTHER_ORG });
      const missingTables = Object.fromEntries(
        Object.keys(entry.tables).map(k => [k, []])
      );
      // a route bound to the trainee in the path has no record besides them
      const byTrainee = entry.route.includes('[traineeId]');
      const { mod } = await loadScoped(entry.route, {
        tables: {
          profiles: byTrainee ? [] : [traineeRow()],
          ...missingTables,
        },
      });
      const missing = await mod[entry.method](
        scopeReq(entry.url, { method: entry.method, body: entry.body }),
        { params: Promise.resolve(entry.params) }
      );
      expect(foreign.res.status).toBe(missing.status);
      // Routes that look the record up first have a message of their own for a
      // missing record, the foreign one has to use the same words
      expect(await foreign.res.json()).toEqual(await missing.json());
    }
  );
});

describe('PATCH /api/trainer/trainees/[traineeId]: assigned_trainer_id', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  const url = `${API}/trainees/${T1}`;
  const params = { params: Promise.resolve({ traineeId: T1 }) };
  const patch = (assigned: unknown) =>
    scopeReq(url, {
      method: 'PATCH',
      body: { assigned_trainer_id: assigned },
    });
  const returns = {
    profiles: [
      {
        id: T1,
        fullName: 'A',
        ausbildungDurationYears: 3,
        assignedTrainerId: T3,
        trainerActivated: false,
      },
    ],
  };

  it('assigns a trainer of the own organization', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/trainees/[traineeId]/route',
      {
        tables: {
          profiles: {
            sequence: [
              [traineeRow()],
              [{ role: 'TRAINER', organizationId: ORG }],
            ],
          },
        },
        returns,
      }
    );
    const res = await mod.PATCH(patch(T3), params);
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'profiles')).toEqual([
      { assignedTrainerId: T3 },
    ]);
  });

  it('refuses a trainer of another organization (404) and changes nothing', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/trainees/[traineeId]/route',
      {
        tables: {
          profiles: {
            sequence: [
              [traineeRow()],
              [{ role: 'TRAINER', organizationId: OTHER_ORG }],
            ],
          },
        },
        returns,
      }
    );
    const res = await mod.PATCH(patch(T3), params);
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Trainer not found' });
    expect(mock.writes('update', 'profiles')).toEqual([]);
  });

  it('refuses a person who is no trainer, an unknown one and an id that is no uuid', async () => {
    for (const [rows, assigned] of [
      [[{ role: 'TRAINEE', organizationId: ORG }], T3],
      [[], T3],
      [[{ role: 'TRAINER', organizationId: ORG }], 'not-a-uuid'],
    ] as const) {
      const { mod, mock } = await loadScoped(
        'trainer/trainees/[traineeId]/route',
        {
          tables: { profiles: { sequence: [[traineeRow()], [...rows]] } },
          returns,
        }
      );
      const res = await mod.PATCH(patch(assigned), params);
      expect(res.status).toBe(404);
      expect(mock.writes('update', 'profiles')).toEqual([]);
    }
  });

  it('the super admin may assign a trainer of any organization', async () => {
    const { mod } = await loadScoped('trainer/trainees/[traineeId]/route', {
      session: superAdminSession(),
      tables: {
        profiles: {
          sequence: [
            [traineeRow(OTHER_ORG)],
            [{ role: 'TRAINER', organizationId: OTHER_ORG }],
          ],
        },
      },
      returns,
    });
    expect((await mod.PATCH(patch(T3), params)).status).toBe(200);
  });
});

describe('PATCH /api/trainer/trainees/[traineeId]/activate: the item', () => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  const url = `${API}/trainees/${T1}/activate`;
  const params = { params: Promise.resolve({ traineeId: T1 }) };
  const body = { itemType: 'ENABLER', itemId: 'e1', isActive: true };

  it('refuses an item of an occupation the caller has not enabled (404)', async () => {
    const { mod, mock } = await loadScoped(
      'trainer/trainees/[traineeId]/activate/route',
      {
        tables: {
          organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
          profiles: [traineeRow()],
          enablers: [{ trainingCatalogId: KFBM }],
        },
      }
    );
    const res = await mod.PATCH(
      scopeReq(url, { method: 'PATCH', body }),
      params
    );
    expect(res.status).toBe(404);
    expect(mock.writes('insert', 'trainee_enabler_overrides')).toEqual([]);
    expect(mock.writes('insert', 'notifications')).toEqual([]);
  });

  it('still answers 400 for an incomplete payload', async () => {
    const { mod } = await loadScoped(
      'trainer/trainees/[traineeId]/activate/route',
      { tables: { profiles: [traineeRow()] } }
    );
    const res = await mod.PATCH(
      scopeReq(url, { method: 'PATCH', body: { itemType: 'ENABLER' } }),
      params
    );
    expect(res.status).toBe(400);
  });
});
