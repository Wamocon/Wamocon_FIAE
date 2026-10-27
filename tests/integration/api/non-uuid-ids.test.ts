/**
 * @jest-environment node
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import {
  fakeSession,
  makeRequest,
  mockCatalogScope,
  mockSession,
  type FakeSession,
} from '../../helpers/mockNext';
import { createTableDb } from '../../helpers/mockDb';
import { GUARDED_ROUTES } from '../../helpers/guardedRoutes';

// An id in the path that is no uuid cannot be a record. A route that hands it to
// a uuid column ends in 500 (or 503), because the database rejects the value.
// Every route below has to answer 404, in the words of its own "not found",
// before it asks the database for anything.

const ORG = '11111111-1111-4111-8111-111111111111';
const FIAE = '00000000-0000-4000-8000-000000000001';
const GOOD = '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11';
const BAD_IDS = ['not-an-id', "x'; drop table profiles; --"];

type Entry = {
  route: string;
  method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  /** Path segments, `{bad}` is replaced by the id under test. */
  params: Record<string, string>;
  body?: unknown;
  as?: 'trainer' | 'admin' | 'superAdmin';
};

const SESSIONS: Record<NonNullable<Entry['as']>, FakeSession> = {
  trainer: fakeSession({ id: 'tr1', organizationId: ORG }),
  admin: fakeSession({
    id: 'ad1',
    role: 'ADMIN',
    organizationId: ORG,
    isAdmin: true,
  }),
  superAdmin: fakeSession({
    id: 'sa1',
    role: 'SUPER_ADMIN',
    organizationId: ORG,
    isAdmin: true,
    isSuperAdmin: true,
  }),
};

function trap() {
  return jest.fn(() => {
    throw new Error('the database must not be reached');
  });
}

// Curriculum writes are only open to the platform wide admin (PR 127), the
// id check comes after that guard
const CURRICULUM_WRITES = new Set(
  GUARDED_ROUTES.filter(r => r.guard === 'curriculum').map(
    r => `${r.method} ${r.route}`
  )
);
const defaultCaller = (entry: Entry): NonNullable<Entry['as']> =>
  CURRICULUM_WRITES.has(`${entry.method} ${entry.route}`)
    ? 'superAdmin'
    : 'trainer';

async function run(entry: Entry, bad: string, db: unknown) {
  jest.resetModules();
  mockSession(SESSIONS[entry.as ?? defaultCaller(entry)]);
  jest.doMock('@/db', () => ({ __esModule: true, default: db }));
  const mod = (await import(`@/app/api/${entry.route}/route`)) as any;
  const params = Object.fromEntries(
    Object.entries(entry.params).map(([k, v]) => [k, v === '{bad}' ? bad : v])
  );
  const request = makeRequest(entry.method, `http://localhost/api/x`, {
    token: 't',
    body: entry.body ?? {},
  });
  return (await mod[entry.method](request, {
    params: Promise.resolve(params),
  })) as Response;
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

// Routes that check the id themselves, before the first query
const OWN_CHECK: Entry[] = [
  {
    route: 'trainer/blocks/[blockId]',
    method: 'DELETE',
    params: { blockId: '{bad}' },
  },
  {
    route: 'trainer/blocks/[blockId]',
    method: 'PATCH',
    params: { blockId: '{bad}' },
    body: { title: 'x' },
  },
  {
    route: 'trainer/content/lessons/[lessonId]',
    method: 'PATCH',
    params: { lessonId: '{bad}' },
    body: { title: 'x' },
  },
  {
    route: 'trainer/content/lessons/[lessonId]',
    method: 'DELETE',
    params: { lessonId: '{bad}' },
  },
  {
    route: 'trainer/content/modules/[moduleId]',
    method: 'GET',
    params: { moduleId: '{bad}' },
  },
  {
    route: 'trainer/content/modules/[moduleId]',
    method: 'PATCH',
    params: { moduleId: '{bad}' },
    body: { title: 'x' },
  },
  {
    route: 'trainer/content/modules/[moduleId]',
    method: 'DELETE',
    params: { moduleId: '{bad}' },
  },
  {
    route: 'trainer/content/modules/[moduleId]/lessons',
    method: 'POST',
    params: { moduleId: '{bad}' },
    body: { title: 'x' },
  },
  {
    route: 'trainer/lernfelder/[id]',
    method: 'GET',
    params: { id: '{bad}' },
  },
  {
    route: 'trainer/lernfelder/[id]',
    method: 'PATCH',
    params: { id: '{bad}' },
    body: { title: 'x' },
  },
  {
    route: 'trainer/lernfelder/[id]',
    method: 'DELETE',
    params: { id: '{bad}' },
  },
  {
    route: 'trainer/evaluations/[id]',
    method: 'GET',
    params: { id: '{bad}' },
  },
  {
    route: 'trainer/evaluations/[id]',
    method: 'PUT',
    params: { id: '{bad}' },
    body: { trainerRating: '2' },
  },
  {
    route: 'trainer/evaluations/[id]',
    method: 'PATCH',
    params: { id: '{bad}' },
    body: { trainerRating: '2' },
  },
  {
    route: 'trainer/quiz-submissions/[submissionId]',
    method: 'PATCH',
    params: { submissionId: '{bad}' },
    body: { is_reviewed: true },
  },
  {
    route: 'trainer/reviews/enablers/[submissionId]',
    method: 'PATCH',
    params: { submissionId: '{bad}' },
    body: { status: 'APPROVED' },
  },
  {
    route: 'trainer/reviews/use-cases/[submissionId]',
    method: 'PATCH',
    params: { submissionId: '{bad}' },
    body: { status: 'APPROVED' },
  },
  {
    route: 'trainer/school/exams/[examId]/grade',
    method: 'PUT',
    params: { examId: '{bad}' },
    body: { grade: 2 },
  },
  {
    route: 'trainer/activity-reports/[id]',
    method: 'GET',
    params: { id: '{bad}' },
  },
  {
    route: 'trainer/activity-reports/[id]',
    method: 'PUT',
    params: { id: '{bad}' },
    body: { trainerGrade: 2 },
  },
  ...(
    [
      ['GET', 'trainer/content-upload/runs/[runId]'],
      ['POST', 'trainer/content-upload/runs/[runId]/discard'],
      ['GET', 'trainer/content-upload/runs/[runId]/files'],
      ['POST', 'trainer/content-upload/runs/[runId]/files'],
      ['POST', 'trainer/content-upload/runs/[runId]/upload-urls'],
      ['POST', 'trainer/content-upload/runs/[runId]/complete'],
      ['POST', 'trainer/content-upload/runs/[runId]/pump'],
    ] as const
  ).map(([method, route]) => ({
    route,
    method,
    params: { runId: '{bad}' },
    body: { files: [], fileIds: [] },
  })),
  {
    route: 'admin/organizations/[orgId]',
    method: 'GET',
    params: { orgId: '{bad}' },
    as: 'superAdmin',
  },
  {
    route: 'admin/organizations/[orgId]',
    method: 'PATCH',
    params: { orgId: '{bad}' },
    body: { name: 'x' },
    as: 'superAdmin',
  },
  {
    route: 'admin/organizations/[orgId]',
    method: 'DELETE',
    params: { orgId: '{bad}' },
    as: 'superAdmin',
  },
  {
    route: 'admin/users/[userId]',
    method: 'PATCH',
    params: { userId: '{bad}' },
    body: { fullName: 'x' },
    as: 'admin',
  },
  {
    route: 'admin/users/[userId]',
    method: 'DELETE',
    params: { userId: '{bad}' },
    as: 'admin',
  },
];

describe('a path id that is no uuid: routes with their own check', () => {
  beforeEach(() => {
    mockCatalogScope();
  });
  afterEach(() => {
    // the other group needs the real scope
    jest.dontMock('@/lib/catalog/scope');
    jest.dontMock('@/lib/catalog/public');
  });

  describe.each(OWN_CHECK.map(e => [`${e.method} ${e.route}`, e] as const))(
    '%s',
    (_name, entry) => {
      it.each(BAD_IDS)(
        'answers 404 for %p without touching the database',
        async bad => {
          const db = {
            select: trap(),
            insert: trap(),
            update: trap(),
            delete: trap(),
            execute: trap(),
            transaction: trap(),
          };
          const res = await run(entry, bad, db);
          expect(res.status).toBe(404);
          const body = await res.json();
          expect(typeof body.error).toBe('string');
          expect(JSON.stringify(body)).not.toContain('drop table');
          expect(db.select).not.toHaveBeenCalled();
          expect(db.update).not.toHaveBeenCalled();
          expect(db.delete).not.toHaveBeenCalled();
          expect(db.insert).not.toHaveBeenCalled();
        }
      );
    }
  );

  it('uses the wording of the route for its 404', async () => {
    const db = {
      select: trap(),
      update: trap(),
      delete: trap(),
      insert: trap(),
    };
    const words: Record<string, string> = {
      'trainer/blocks/[blockId]': 'Block not found',
      'trainer/evaluations/[id]': 'Evaluation not found',
      'trainer/quiz-submissions/[submissionId]': 'Submission not found',
      'trainer/reviews/enablers/[submissionId]': 'Submission not found',
      'trainer/reviews/use-cases/[submissionId]': 'Submission not found',
      'trainer/school/exams/[examId]/grade': 'Exam not found',
      'trainer/activity-reports/[id]': 'Report not found',
      'trainer/content-upload/runs/[runId]': 'Run not found',
    };
    for (const [route, message] of Object.entries(words)) {
      const entry = OWN_CHECK.find(e => e.route === route)!;
      const res = await run(entry, 'nope', db);
      expect((await res.json()).error).toBe(message);
    }
  });
});

// Routes whose id goes through the catalog scope (requireContentScope): the
// scope itself answers 404 for an id that is no uuid. Only the catalog tables
// may be read, and nothing is written.
const CONTENT: Entry[] = [
  ...(['GET', 'PATCH', 'DELETE'] as const).map(method => ({
    route: 'trainer/courses/[courseId]',
    method,
    params: { courseId: '{bad}' },
  })),
  ...(['GET', 'POST'] as const).map(method => ({
    route: 'trainer/courses/[courseId]/enablers',
    method,
    params: { courseId: '{bad}' },
  })),
  ...(['GET', 'POST'] as const).map(method => ({
    route: 'trainer/courses/[courseId]/use-cases',
    method,
    params: { courseId: '{bad}' },
  })),
  ...(['GET', 'POST', 'DELETE'] as const).map(method => ({
    route: 'trainer/courses/[courseId]/members',
    method,
    params: { courseId: '{bad}' },
  })),
  ...(['GET', 'PATCH', 'DELETE'] as const).map(method => ({
    route: 'trainer/enablers/[enablerId]',
    method,
    params: { enablerId: '{bad}' },
  })),
  ...(['GET', 'POST', 'DELETE'] as const).map(method => ({
    route: 'trainer/enablers/[enablerId]/documents',
    method,
    params: { enablerId: '{bad}' },
  })),
  ...(['GET', 'POST'] as const).map(method => ({
    route: 'trainer/enablers/[enablerId]/quiz',
    method,
    params: { enablerId: '{bad}' },
  })),
  ...(['GET', 'POST'] as const).map(method => ({
    route: 'trainer/enablers/[enablerId]/quizzes',
    method,
    params: { enablerId: '{bad}' },
  })),
  ...(['GET', 'PATCH', 'DELETE'] as const).map(method => ({
    route: 'trainer/enablers/[enablerId]/quizzes/[quizId]',
    method,
    params: { enablerId: '{bad}', quizId: '{bad}' },
  })),
  ...(['GET', 'PATCH', 'DELETE'] as const).map(method => ({
    route: 'trainer/quizzes/[quizId]',
    method,
    params: { quizId: '{bad}' },
  })),
  ...(['GET', 'PATCH', 'DELETE'] as const).map(method => ({
    route: 'trainer/use-cases/[useCaseId]',
    method,
    params: { useCaseId: '{bad}' },
  })),
  ...(['GET', 'POST', 'DELETE'] as const).map(method => ({
    route: 'trainer/use-cases/[useCaseId]/documents',
    method,
    params: { useCaseId: '{bad}' },
  })),
];

const CATALOG_TABLES = new Set(['training_catalogs', 'organization_catalogs']);

describe('a path id that is no uuid: routes that use the catalog scope', () => {
  describe.each(CONTENT.map(e => [`${e.method} ${e.route}`, e] as const))(
    '%s',
    (_name, entry) => {
      it.each(BAD_IDS)(
        'answers 404 for %p and reads no content table',
        async bad => {
          const { db, calls } = createTableDb({
            trainingCatalogs: [{ id: FIAE, code: 'FIAE', isActive: true }],
            organizationCatalogs: [
              { trainingCatalogId: FIAE, isEnabled: true },
            ],
          });
          const res = await run(entry, bad, db);
          expect(res.status).toBe(404);
          const touched = calls.filter(
            c => c.op !== 'select' || !CATALOG_TABLES.has(String(c.table))
          );
          expect(touched).toEqual([]);
        }
      );
    }
  );

  it('also stops a second id that is no uuid after a good first one', async () => {
    const { db, calls } = createTableDb({
      trainingCatalogs: [{ id: FIAE, code: 'FIAE', isActive: true }],
      organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
      enablers: [{ trainingCatalogId: FIAE }],
    });
    const entry: Entry = {
      route: 'trainer/enablers/[enablerId]/quizzes/[quizId]',
      method: 'DELETE',
      params: { enablerId: GOOD, quizId: '{bad}' },
    };
    const res = await run(entry, 'not-an-id', db);
    expect(res.status).toBe(404);
    expect(calls.some(c => c.table === 'quizzes')).toBe(false);
    expect(calls.some(c => c.op === 'delete')).toBe(false);
  });
});
