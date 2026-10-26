/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// Package H4: /api/hai/action executes only confirmed actions of the list, as
// the person of the session. Every action is checked again against the role,
// the responsibility (organization, occupation, assigned trainer) and the
// parameters. The mock database ignores where(), so these tests drive the
// rules through the rows each table returns. The real SQL (responsibility
// queries, updates with WHERE on owner and organization) is covered by the
// smoke test against the local database, see the pull request.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ME = '10000000-0000-4000-8000-000000000001';
const TRAINEE = '10000000-0000-4000-8000-000000000002';
const ENABLER = '20000000-0000-4000-8000-000000000001';
const QUIZ = '20000000-0000-4000-8000-000000000002';
const COURSE = '20000000-0000-4000-8000-000000000003';
const SUBMISSION = '30000000-0000-4000-8000-000000000001';
const REPORT = '30000000-0000-4000-8000-000000000002';
const ORG = 'b0000000-0000-4000-8000-00000000000b';
const OTHER_ORG = 'c0000000-0000-4000-8000-00000000000c';

type Rows = Record<string, any[]>;

const CATALOGS = [
  { id: FIAE, code: 'FIAE', isActive: true },
  { id: KFBM, code: 'KFBM', isActive: true },
];

async function load(
  options: {
    role?: 'TRAINEE' | 'TRAINER';
    tables?: Rows;
    pro?: boolean;
    orgFails?: boolean;
    /** Result of the occupation filter of the trainee lists (real SQL in the smoke test). */
    traineeInCatalog?: boolean;
    anonymous?: boolean;
    superAdmin?: boolean;
  } = {}
) {
  const {
    role = 'TRAINEE',
    tables = {},
    pro = true,
    orgFails = false,
    traineeInCatalog = true,
    anonymous = false,
    superAdmin = false,
  } = options;
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  mockSession(
    anonymous
      ? null
      : fakeSession({
          id: ME,
          role: superAdmin ? 'SUPER_ADMIN' : role,
          isTrainerLevel: role === 'TRAINER',
          isSuperAdmin: superAdmin,
          organizationId: ORG,
        })
  );
  const rec = createTableDb({
    trainingCatalogs: CATALOGS,
    organizationCatalogs: [],
    traineeEnrollments: [],
    ...tables,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  const getUserOrgIdStrict = jest.fn(async (_id: string) => {
    if (orgFails) throw new Error('db down');
    return ORG;
  });
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    ...(jest.requireActual('@/lib/auth-helpers') as object),
    requireProPlan: async () => pro,
    getUserOrgIdStrict,
  }));
  const ensureTraineeInCatalog = jest.fn(async () => {
    const { NextResponse } = jest.requireActual('next/server') as any;
    return traineeInCatalog
      ? null
      : NextResponse.json({ error: 'Not found' }, { status: 404 });
  });
  jest.doMock('@/lib/catalog/trainee-scope', () => ({
    __esModule: true,
    ensureTraineeInCatalog,
  }));
  const mod = (await import('@/app/api/hai/action/route')) as any;
  return { mod, rec, getUserOrgIdStrict, ensureTraineeInCatalog };
}

function post(body: unknown, headers: Record<string, string> = {}) {
  return makeRequest('POST', 'http://localhost/api/hai/action', {
    token: 't',
    body,
    headers,
  });
}

const confirmed = (actionType: string, parameters: unknown = {}) => ({
  actionType,
  parameters,
  confirmed: true,
});

function writeCount(rec: Awaited<ReturnType<typeof load>>['rec']) {
  return rec.calls.filter(c => c.op !== 'select').length;
}

// --- rows -------------------------------------------------------------------

const traineeProfile = (overrides: Record<string, unknown> = {}) => ({
  id: TRAINEE,
  role: 'TRAINEE',
  organizationId: ORG,
  assignedTrainerId: ME,
  startOfTrainingDate: null,
  ausbildungDurationYears: 3,
  ...overrides,
});

const enablerRow = (overrides: Record<string, unknown> = {}) => ({
  id: ENABLER,
  title: 'SQL Grundlagen',
  courseId: COURSE,
  isActive: true,
  trainingCatalogId: FIAE,
  ...overrides,
});

const submissionRow = (overrides: Record<string, unknown> = {}) => ({
  id: SUBMISSION,
  status: 'PENDING',
  traineeId: TRAINEE,
  enablerId: ENABLER,
  organizationId: ORG,
  ...overrides,
});

const quizSubmissionRow = (overrides: Record<string, unknown> = {}) => ({
  id: SUBMISSION,
  traineeId: TRAINEE,
  quizId: QUIZ,
  organizationId: ORG,
  isReviewed: false,
  trainingCatalogId: FIAE,
  ...overrides,
});

// ============================================================================

describe('/api/hai/action: entry conditions', () => {
  beforeEach(() => jest.clearAllMocks());

  it('answers 401 without a session and executes nothing', async () => {
    const { mod, rec } = await load({ anonymous: true });
    const res = await mod.POST(post(confirmed('complete_enabler')));
    expect(res.status).toBe(401);
    expect(rec.calls).toEqual([]);
  });

  it('answers 403 without the PRO plan and executes nothing', async () => {
    const { mod, rec } = await load({ pro: false });
    const res = await mod.POST(
      post(confirmed('complete_enabler', { enablerId: ENABLER }))
    );
    expect(res.status).toBe(403);
    expect(rec.calls).toEqual([]);
  });

  it('rejects a request without the explicit confirmation', async () => {
    const { mod, rec } = await load({
      tables: { enablers: [enablerRow()] },
    });
    for (const confirmedValue of [undefined, false, 'true', 1]) {
      const res = await mod.POST(
        post({
          actionType: 'complete_enabler',
          parameters: { enablerId: ENABLER },
          confirmed: confirmedValue,
        })
      );
      expect(res.status).toBe(400);
    }
    expect(rec.calls).toEqual([]);
  });

  it.each([
    'reject_submission',
    'reject_report',
    'upload_document',
    'show_progress',
    'submit_quiz',
    'constructor',
    '__proto__',
    'drop_everything',
    '',
    42,
    null,
  ])('rejects the action type %p', async actionType => {
    const { mod, rec } = await load({ role: 'TRAINER' });
    const res = await mod.POST(post(confirmed(actionType as string)));
    expect(res.status).toBe(400);
    expect(rec.calls).toEqual([]);
  });

  it('rejects a body that is not an object', async () => {
    const { mod, rec } = await load();
    for (const body of [null, [], 'text', 7]) {
      const res = await mod.POST(post(body));
      expect(res.status).toBe(400);
    }
    expect(rec.calls).toEqual([]);
  });

  it('rejects parameters that are not an object', async () => {
    const { mod, rec } = await load();
    const res = await mod.POST(post(confirmed('complete_enabler', [ENABLER])));
    expect(res.status).toBe(400);
    expect(rec.calls).toEqual([]);
  });

  it('never shows raw error details', async () => {
    const { mod, rec } = await load({
      tables: { enablers: [enablerRow()] },
    });
    rec.db.select.mockImplementationOnce(() => {
      throw new Error('relation "secret_table" does not exist');
    });
    const res = await mod.POST(
      post(confirmed('complete_enabler', { enablerId: ENABLER }))
    );
    const text = JSON.stringify(await res.json());
    expect(res.status).toBeGreaterThanOrEqual(500);
    expect(text).not.toContain('secret_table');
  });
});

describe('/api/hai/action: the role must fit the action type', () => {
  beforeEach(() => jest.clearAllMocks());

  const TRAINEE_ONLY: Array<[string, Record<string, unknown>]> = [
    ['create_activity_report', { weekNumber: 12 }],
    ['submit_activity_report', {}],
    ['complete_enabler', { enablerId: ENABLER }],
  ];
  const TRAINER_ONLY: Array<[string, Record<string, unknown>]> = [
    ['approve_submission', { submissionId: SUBMISSION }],
    ['approve_report', { reportId: REPORT }],
    ['grade_quiz', { submissionId: SUBMISSION, score: 80 }],
  ];

  it.each(TRAINER_ONLY)(
    'a trainee may not run %s',
    async (type, parameters) => {
      const { mod, rec } = await load({ role: 'TRAINEE' });
      const res = await mod.POST(post(confirmed(type, parameters)));
      expect(res.status).toBe(403);
      expect(writeCount(rec)).toBe(0);
      expect(rec.calls).toEqual([]);
    }
  );

  it.each(TRAINEE_ONLY)(
    'a trainer level person may not run %s',
    async (type, parameters) => {
      const { mod, rec } = await load({ role: 'TRAINER' });
      const res = await mod.POST(post(confirmed(type, parameters)));
      expect(res.status).toBe(403);
      expect(rec.calls).toEqual([]);
    }
  );

  it.each(['TRAINEE', 'TRAINER'] as const)(
    'a %s may mark the own notifications as read',
    async role => {
      const { mod, rec } = await load({ role });
      const res = await mod.POST(
        post(confirmed('mark_notification_read', { markAll: true }))
      );
      expect(res.status).toBe(200);
      expect(rec.writes('update', 'notifications')).toHaveLength(1);
    }
  );

  it('lists only the actions of the role', async () => {
    const trainee = await load({ role: 'TRAINEE' });
    const traineeRes = await trainee.mod.GET(
      makeRequest('GET', 'http://localhost/api/hai/action', { token: 't' })
    );
    expect((await traineeRes.json()).availableActions).toEqual([
      'create_activity_report',
      'submit_activity_report',
      'complete_enabler',
      'mark_notification_read',
    ]);

    const trainer = await load({ role: 'TRAINER' });
    const trainerRes = await trainer.mod.GET(
      makeRequest('GET', 'http://localhost/api/hai/action', { token: 't' })
    );
    expect((await trainerRes.json()).availableActions).toEqual([
      'mark_notification_read',
      'approve_submission',
      'approve_report',
      'grade_quiz',
    ]);
  });
});

describe('/api/hai/action: parameters', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    [-1],
    [101],
    [85.5],
    ['85'],
    [null],
    [Number.MAX_SAFE_INTEGER],
    [undefined],
  ])('grade_quiz rejects the score %p', async score => {
    const { mod, rec } = await load({
      role: 'TRAINER',
      tables: {
        quizSubmissions: [quizSubmissionRow()],
        profiles: [traineeProfile()],
        quizzes: [{ trainingCatalogId: FIAE }],
      },
    });
    const res = await mod.POST(
      post(confirmed('grade_quiz', { submissionId: SUBMISSION, score }))
    );
    expect(res.status).toBe(400);
    expect(writeCount(rec)).toBe(0);
  });

  it.each([0, 1, 100])('grade_quiz accepts the score %p', async score => {
    const { mod, rec } = await load({
      role: 'TRAINER',
      tables: {
        quizSubmissions: [quizSubmissionRow()],
        profiles: [traineeProfile()],
        quizzes: [{ trainingCatalogId: FIAE }],
      },
    });
    const res = await mod.POST(
      post(confirmed('grade_quiz', { submissionId: SUBMISSION, score }))
    );
    expect(res.status).toBe(200);
    expect(rec.writes('update', 'quiz_submissions')[0]).toMatchObject({
      score,
      isReviewed: true,
      reviewedById: ME,
    });
  });

  it.each([
    ['complete_enabler', { enablerId: 'not-a-uuid' }],
    ['complete_enabler', { enablerId: '' }],
    ['complete_enabler', {}],
    ['approve_submission', { submissionId: "1' OR '1'='1" }],
    ['approve_report', { reportId: 5 }],
    ['create_activity_report', { weekNumber: 99 }],
    ['create_activity_report', { weekNumber: 1.5 }],
    ['create_activity_report', { year: 1999 }],
    ['mark_notification_read', {}],
    ['mark_notification_read', { notificationId: 'x' }],
  ])('rejects invalid parameters of %s', async (type, parameters) => {
    const role = ['approve_submission', 'approve_report'].includes(type)
      ? 'TRAINER'
      : 'TRAINEE';
    const { mod, rec } = await load({ role });
    const res = await mod.POST(post(confirmed(type, parameters)));
    expect(res.status).toBe(400);
    expect(rec.calls).toEqual([]);
  });

  it('drops parameters that are not on the list of the action', async () => {
    const { mod, rec } = await load({
      tables: {
        enablers: [enablerRow()],
        courseMembers: [{ userId: ME }],
        enablerCompletions: [],
      },
    });
    const res = await mod.POST(
      post(
        confirmed('complete_enabler', {
          enablerId: ENABLER,
          traineeId: TRAINEE,
          organizationId: OTHER_ORG,
        })
      )
    );
    expect(res.status).toBe(200);
    // The person is the session, never a parameter
    expect(rec.writes('insert', 'enabler_completions')[0]).toMatchObject({
      traineeId: ME,
      enablerId: ENABLER,
    });
  });
});

describe('/api/hai/action: trainee actions', () => {
  beforeEach(() => jest.clearAllMocks());

  const base = (overrides: Rows = {}): Rows => ({
    enablers: [enablerRow()],
    courseMembers: [{ userId: ME }],
    enablerCompletions: [],
    ...overrides,
  });
  const complete = () =>
    post(confirmed('complete_enabler', { enablerId: ENABLER }));

  it('FIAE regression: the trainee confirms "complete enabler"', async () => {
    const { mod, rec } = await load({ tables: base() });
    const res = await mod.POST(complete());
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      success: true,
      data: { enablerId: ENABLER },
    });
    expect(rec.writes('insert', 'enabler_completions')).toHaveLength(1);
  });

  it('a foreign or unknown enabler id answers not found', async () => {
    const { mod, rec } = await load({ tables: base({ enablers: [] }) });
    const res = await mod.POST(complete());
    expect(res.status).toBe(404);
    expect(writeCount(rec)).toBe(0);
  });

  it('an enabler of another occupation answers not found', async () => {
    const { mod, rec } = await load({
      tables: base({ enablers: [enablerRow({ trainingCatalogId: KFBM })] }),
    });
    const res = await mod.POST(complete());
    expect(res.status).toBe(404);
    expect(writeCount(rec)).toBe(0);
  });

  it('an inactive enabler answers not found', async () => {
    const { mod, rec } = await load({
      tables: base({ enablers: [enablerRow({ isActive: false })] }),
    });
    const res = await mod.POST(complete());
    expect(res.status).toBe(404);
    expect(writeCount(rec)).toBe(0);
  });

  it('an enabler of a course the trainee is not a member of answers not found', async () => {
    const { mod, rec } = await load({ tables: base({ courseMembers: [] }) });
    const res = await mod.POST(complete());
    expect(res.status).toBe(404);
    expect(writeCount(rec)).toBe(0);
  });

  it('an enabler that is already completed answers 409', async () => {
    const { mod, rec } = await load({
      tables: base({ enablerCompletions: [{ traineeId: ME }] }),
    });
    const res = await mod.POST(complete());
    expect(res.status).toBe(409);
    expect(writeCount(rec)).toBe(0);
  });

  describe('a write never falls back to the platform organization', () => {
    it('create_activity_report stops when the organization cannot be resolved', async () => {
      const { mod, rec } = await load({
        orgFails: true,
        tables: { profiles: [traineeProfile({ id: ME })], activityReports: [] },
      });
      const res = await mod.POST(
        post(
          confirmed('create_activity_report', { weekNumber: 12, year: 2026 })
        )
      );
      expect(res.status).toBe(500);
      expect(rec.writes('insert', 'activity_reports')).toEqual([]);
    });

    it('create_activity_report writes the resolved organization', async () => {
      const { mod, rec } = await load({
        tables: { profiles: [traineeProfile({ id: ME })], activityReports: [] },
      });
      const res = await mod.POST(
        post(
          confirmed('create_activity_report', { weekNumber: 12, year: 2026 })
        )
      );
      expect(res.status).toBe(200);
      expect(rec.writes('insert', 'activity_reports')[0]).toMatchObject({
        traineeId: ME,
        organizationId: ORG,
      });
    });
  });

  it('submit_activity_report submits only a draft of the person', async () => {
    const { mod, rec } = await load({
      tables: {
        activityReports: [{ id: REPORT, status: 'DRAFT', weekNumber: 12 }],
      },
    });
    const res = await mod.POST(
      post(confirmed('submit_activity_report', { reportId: REPORT }))
    );
    expect(res.status).toBe(200);
    expect(rec.writes('update', 'activity_reports')[0]).toMatchObject({
      status: 'SUBMITTED',
    });
  });

  it('submit_activity_report refuses a report that is not a draft', async () => {
    const { mod, rec } = await load({
      tables: {
        activityReports: [{ id: REPORT, status: 'APPROVED', weekNumber: 12 }],
      },
    });
    const res = await mod.POST(
      post(confirmed('submit_activity_report', { reportId: REPORT }))
    );
    expect(res.status).toBe(409);
    expect(writeCount(rec)).toBe(0);
  });
});

describe('/api/hai/action: trainer actions', () => {
  beforeEach(() => jest.clearAllMocks());

  const approveSubmission = (headers: Record<string, string> = {}) =>
    post(
      confirmed('approve_submission', { submissionId: SUBMISSION }),
      headers
    );
  const approveReport = () =>
    post(confirmed('approve_report', { reportId: REPORT }));
  const grade = (headers: Record<string, string> = {}) =>
    post(
      confirmed('grade_quiz', { submissionId: SUBMISSION, score: 90 }),
      headers
    );

  const submissionTables = (overrides: Rows = {}): Rows => ({
    enablerSubmissions: [submissionRow()],
    profiles: [traineeProfile()],
    enablers: [enablerRow()],
    ...overrides,
  });
  const quizTables = (overrides: Rows = {}): Rows => ({
    quizSubmissions: [quizSubmissionRow()],
    profiles: [traineeProfile()],
    quizzes: [{ trainingCatalogId: FIAE }],
    ...overrides,
  });
  const reportTables = (overrides: Rows = {}): Rows => ({
    activityReports: [
      {
        id: REPORT,
        status: 'SUBMITTED',
        traineeId: TRAINEE,
        assignedTrainerId: ME,
      },
    ],
    profiles: [traineeProfile()],
    ...overrides,
  });

  describe('FIAE regression: the trainer confirms an own responsibility', () => {
    it('approve_submission of a trainee of the own organization', async () => {
      const { mod, rec } = await load({
        role: 'TRAINER',
        tables: submissionTables(),
      });
      const res = await mod.POST(approveSubmission());
      expect(res.status).toBe(200);
      expect(rec.writes('update', 'enabler_submissions')[0]).toMatchObject({
        status: 'APPROVED',
        reviewedById: ME,
      });
    });

    it('approve_report of the assigned trainee', async () => {
      const { mod, rec } = await load({
        role: 'TRAINER',
        tables: reportTables(),
      });
      const res = await mod.POST(approveReport());
      expect(res.status).toBe(200);
      expect(rec.writes('update', 'activity_reports')[0]).toMatchObject({
        status: 'APPROVED',
        reviewerId: ME,
      });
    });

    it('grade_quiz of a trainee of the own organization', async () => {
      const { mod, rec } = await load({
        role: 'TRAINER',
        tables: quizTables(),
      });
      const res = await mod.POST(grade());
      expect(res.status).toBe(200);
      expect(rec.writes('update', 'quiz_submissions')[0]).toMatchObject({
        score: 90,
        isReviewed: true,
      });
    });

    it('the super admin acts across organizations', async () => {
      const { mod, rec } = await load({
        role: 'TRAINER',
        superAdmin: true,
        tables: submissionTables({
          enablerSubmissions: [submissionRow({ organizationId: OTHER_ORG })],
          profiles: [traineeProfile({ organizationId: OTHER_ORG })],
        }),
      });
      const res = await mod.POST(approveSubmission());
      expect(res.status).toBe(200);
      expect(rec.writes('update', 'enabler_submissions')).toHaveLength(1);
    });
  });

  describe.each([
    [
      'approve_submission',
      'enabler_submissions',
      submissionTables,
      approveSubmission,
    ],
    ['grade_quiz', 'quiz_submissions', quizTables, grade],
  ] as const)('%s: foreign records', (_type, table, tables, request) => {
    it('a foreign organization answers not found', async () => {
      const { mod, rec } = await load({
        role: 'TRAINER',
        tables: tables({
          profiles: [traineeProfile({ organizationId: OTHER_ORG })],
        }),
      });
      const res = await mod.POST(request());
      expect(res.status).toBe(404);
      expect(writeCount(rec)).toBe(0);
    });

    it('a submission stored under a foreign organization answers not found', async () => {
      const key =
        table === 'enabler_submissions'
          ? 'enablerSubmissions'
          : 'quizSubmissions';
      const row =
        table === 'enabler_submissions' ? submissionRow : quizSubmissionRow;
      const { mod, rec } = await load({
        role: 'TRAINER',
        tables: tables({ [key]: [row({ organizationId: OTHER_ORG })] }),
      });
      const res = await mod.POST(request());
      expect(res.status).toBe(404);
      expect(writeCount(rec)).toBe(0);
    });

    it('a trainee that is not a trainee (a trainer id) answers not found', async () => {
      const { mod, rec } = await load({
        role: 'TRAINER',
        tables: tables({ profiles: [traineeProfile({ role: 'TRAINER' })] }),
      });
      const res = await mod.POST(request());
      expect(res.status).toBe(404);
      expect(writeCount(rec)).toBe(0);
    });

    it('an unknown submission id answers not found', async () => {
      const key =
        table === 'enabler_submissions'
          ? 'enablerSubmissions'
          : 'quizSubmissions';
      const { mod, rec } = await load({
        role: 'TRAINER',
        tables: tables({ [key]: [] }),
      });
      const res = await mod.POST(request());
      expect(res.status).toBe(404);
      expect(writeCount(rec)).toBe(0);
    });

    it('a trainee of another occupation answers not found', async () => {
      const { mod, rec, ensureTraineeInCatalog } = await load({
        role: 'TRAINER',
        traineeInCatalog: false,
        tables: tables(),
      });
      const res = await mod.POST(request({ 'x-catalog': 'FIAE' }));
      expect(res.status).toBe(404);
      expect(writeCount(rec)).toBe(0);
      // The check receives the trainer, the request (x-catalog) and the trainee
      expect(ensureTraineeInCatalog).toHaveBeenCalledTimes(1);
      const [actor, req, traineeId] = ensureTraineeInCatalog.mock
        .calls[0] as any[];
      expect(actor.id).toBe(ME);
      expect(req.headers.get('x-catalog')).toBe('FIAE');
      expect(traineeId).toBe(TRAINEE);
    });

    it('an occupation the trainer does not have answers 403', async () => {
      const { mod, rec } = await load({ role: 'TRAINER', tables: tables() });
      const res = await mod.POST(request({ 'x-catalog': 'KFBM' }));
      expect(res.status).toBe(403);
      expect(writeCount(rec)).toBe(0);
    });

    it('content of another occupation answers not found', async () => {
      const contentKey =
        table === 'enabler_submissions' ? 'enablers' : 'quizzes';
      const { mod, rec } = await load({
        role: 'TRAINER',
        tables: tables({
          [contentKey]: [{ ...enablerRow(), trainingCatalogId: KFBM }],
        }),
      });
      const res = await mod.POST(request());
      expect(res.status).toBe(404);
      expect(writeCount(rec)).toBe(0);
    });

    it('a state that does not fit answers 409', async () => {
      const key =
        table === 'enabler_submissions'
          ? 'enablerSubmissions'
          : 'quizSubmissions';
      const row =
        table === 'enabler_submissions'
          ? submissionRow({ status: 'APPROVED' })
          : quizSubmissionRow({ isReviewed: true });
      const { mod, rec } = await load({
        role: 'TRAINER',
        tables: tables({ [key]: [row] }),
      });
      const res = await mod.POST(request());
      expect(res.status).toBe(409);
      expect(writeCount(rec)).toBe(0);
    });

    it('a lookup that fails closes the action', async () => {
      const { mod, rec } = await load({ role: 'TRAINER', tables: tables() });
      rec.db.select.mockImplementationOnce(() => {
        throw new Error('db down');
      });
      const res = await mod.POST(request());
      expect(res.status).toBeGreaterThanOrEqual(500);
      expect(writeCount(rec)).toBe(0);
    });
  });

  describe('approve_report: foreign records', () => {
    it('a foreign organization answers not found', async () => {
      const { mod, rec } = await load({
        role: 'TRAINER',
        tables: reportTables({
          profiles: [traineeProfile({ organizationId: OTHER_ORG })],
        }),
      });
      const res = await mod.POST(approveReport());
      expect(res.status).toBe(404);
      expect(writeCount(rec)).toBe(0);
    });

    it('a trainee assigned to another trainer answers not found', async () => {
      const { mod, rec } = await load({
        role: 'TRAINER',
        tables: reportTables({
          activityReports: [
            {
              id: REPORT,
              status: 'SUBMITTED',
              traineeId: TRAINEE,
              assignedTrainerId: 'someone-else',
            },
          ],
        }),
      });
      const res = await mod.POST(approveReport());
      expect(res.status).toBe(404);
      expect(writeCount(rec)).toBe(0);
    });

    it('a trainee of another occupation answers not found', async () => {
      const { mod, rec } = await load({
        role: 'TRAINER',
        traineeInCatalog: false,
        tables: reportTables(),
      });
      const res = await mod.POST(approveReport());
      expect(res.status).toBe(404);
      expect(writeCount(rec)).toBe(0);
    });

    it('a report that is not submitted answers 409', async () => {
      const { mod, rec } = await load({
        role: 'TRAINER',
        tables: reportTables({
          activityReports: [
            {
              id: REPORT,
              status: 'DRAFT',
              traineeId: TRAINEE,
              assignedTrainerId: ME,
            },
          ],
        }),
      });
      const res = await mod.POST(approveReport());
      expect(res.status).toBe(409);
      expect(writeCount(rec)).toBe(0);
    });

    it('an unknown report answers not found', async () => {
      const { mod, rec } = await load({
        role: 'TRAINER',
        tables: reportTables({ activityReports: [] }),
      });
      const res = await mod.POST(approveReport());
      expect(res.status).toBe(404);
      expect(writeCount(rec)).toBe(0);
    });
  });

  it('a trainer whose organization cannot be resolved acts on nothing', async () => {
    const { mod, rec } = await load({
      role: 'TRAINER',
      orgFails: true,
      tables: submissionTables(),
    });
    const res = await mod.POST(approveSubmission());
    expect(res.status).toBe(503);
    expect(writeCount(rec)).toBe(0);
  });

  it('every update names owner and organization in its WHERE clause', async () => {
    const { mod, rec } = await load({
      role: 'TRAINER',
      tables: submissionTables(),
    });
    await mod.POST(approveSubmission());
    const where = rec.filters('update', 'enabler_submissions');
    expect(where.sql).toContain('"trainee_id"');
    expect(where.sql).toContain('"organization_id"');
    expect(where.sql).toContain('"status"');
    expect(where.params).toEqual(
      expect.arrayContaining([SUBMISSION, TRAINEE, ORG, 'PENDING'])
    );

    const quiz = await load({ role: 'TRAINER', tables: quizTables() });
    await quiz.mod.POST(grade());
    const quizWhere = quiz.rec.filters('update', 'quiz_submissions');
    expect(quizWhere.sql).toContain('"trainee_id"');
    expect(quizWhere.sql).toContain('"organization_id"');
    expect(quizWhere.sql).toContain('"is_reviewed"');
  });
});
