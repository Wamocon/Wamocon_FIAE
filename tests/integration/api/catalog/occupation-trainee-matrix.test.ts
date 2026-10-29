/**
 * @jest-environment node
 */
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  it,
  jest,
} from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  makeRequest,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';
import {
  PDF_BYTES,
  createMemorySubmissionStorage,
} from '../../../helpers/memorySubmissionStorage';

// Occupation matrix (Jira WMCNL-2810, step 3.8): a trainee only reaches the content of the
// own occupation. The same checks run for a FIAE trainee and for a KfBM trainee, in both
// directions, with the REAL catalog scope (src/lib/catalog/scope.ts) against a table mock
// of one organization that has BOTH occupations enabled, so the organization alone does not
// decide. Content of the other occupation answers 404 (as for a missing record), nothing
// is read or written for it. Content of the own occupation passes the same guard.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';
const TRAINEE = '22222222-2222-4222-8222-222222222222';
const USE_CASE = '33333333-3333-4333-8333-333333333333';
const COURSE = '44444444-4444-4444-8444-444444444444';
const ENABLER = '55555555-5555-4555-8555-555555555555';
const QUIZ = '66666666-6666-4666-8666-666666666666';

const OCCUPATIONS = [
  { name: 'FIAE', own: FIAE, other: KFBM },
  { name: 'KfBM', own: KFBM, other: FIAE },
] as const;

async function world(trainee: string, contentCatalog: string, extra = {}) {
  jest.resetModules();
  const storage = createMemorySubmissionStorage('public');
  const mock = createTableDb({
    trainingCatalogs: [
      { id: FIAE, code: 'FIAE', isActive: true },
      { id: KFBM, code: 'KFBM', isActive: true },
    ],
    profiles: [
      {
        id: TRAINEE,
        role: 'TRAINEE',
        organizationId: ORG,
        isPlatformOwner: false,
      },
    ],
    organizationCatalogs: [
      { trainingCatalogId: FIAE, isEnabled: true },
      { trainingCatalogId: KFBM, isEnabled: true },
    ],
    traineeEnrollments: [
      { trainingCatalogId: trainee, startDate: '2026-08-01' },
    ],
    useCases: [
      {
        id: USE_CASE,
        trainingCatalogId: contentCatalog,
        courseId: COURSE,
        isActive: true,
        title: 'Use Case',
        enablerId: null,
      },
    ],
    courses: [{ id: COURSE, trainingCatalogId: contentCatalog, title: 'Kurs' }],
    enablers: [
      { id: ENABLER, trainingCatalogId: contentCatalog, isActive: true },
    ],
    quizzes: [{ id: QUIZ, trainingCatalogId: contentCatalog, isActive: true }],
    courseMembers: [{ userId: TRAINEE, courseId: COURSE }],
    useCaseSubmissions: [],
    contentDocuments: [],
    ...extra,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    verifyPlatformOwner: async () => true,
    getUserOrgId: async () => ORG,
  }));
  jest.doMock('@/lib/catalog/progression-db', () => ({
    __esModule: true,
    requireEnablerOpen: async () => null,
  }));
  jest.doMock('@/lib/submission-file/storage', () => {
    const actual = jest.requireActual('@/lib/submission-file/storage') as any;
    return { ...actual, createSubmissionStorage: () => storage };
  });
  mockSession(traineeSession(TRAINEE, { organizationId: ORG }));
  return { mock, storage };
}

const asTrainee = (method: string, url: string, body?: unknown) =>
  makeRequest(method, url, { token: 't', body });

type Probe = {
  name: string;
  route: string;
  call: (mod: any) => Promise<Response>;
  /** Writes that must not happen for foreign content. */
  forbiddenWrites?: string[];
  /**
   * The answer for content of the own occupation (control: the guard lets it through).
   * Left out where the route needs a larger world, other tests cover that answer.
   */
  ownStatus?: number;
};

const PROBES: Probe[] = [
  {
    name: 'use case detail',
    ownStatus: 200,
    route: 'trainee/use-cases/[useCaseId]',
    call: mod =>
      mod.GET(
        asTrainee('GET', `http://localhost/api/trainee/use-cases/${USE_CASE}`),
        {
          params: Promise.resolve({ useCaseId: USE_CASE }),
        }
      ),
  },
  {
    name: 'use case documents',
    ownStatus: 200,
    route: 'trainee/use-cases/[useCaseId]/documents',
    call: mod =>
      mod.GET(
        asTrainee(
          'GET',
          `http://localhost/api/trainee/use-cases/${USE_CASE}/documents`
        ),
        { params: Promise.resolve({ useCaseId: USE_CASE }) }
      ),
  },
  {
    name: 'use case submit',
    ownStatus: 200,
    route: 'trainee/use-cases/[useCaseId]/submit',
    call: mod =>
      mod.POST(
        asTrainee(
          'POST',
          `http://localhost/api/trainee/use-cases/${USE_CASE}/submit`,
          {
            submissionText: 'Lösung',
            links: [],
          }
        ),
        { params: Promise.resolve({ useCaseId: USE_CASE }) }
      ),
    forbiddenWrites: [
      'use_case_submissions',
      'use_case_submission_links',
      'notifications',
    ],
  },
  {
    name: 'course detail',
    route: 'trainee/courses/[courseId]',
    call: mod =>
      mod.GET(
        asTrainee('GET', `http://localhost/api/trainee/courses/${COURSE}`),
        {
          params: Promise.resolve({ courseId: COURSE }),
        }
      ),
  },
  {
    name: 'enabler detail',
    route: 'trainee/enablers/[enablerId]',
    call: mod =>
      mod.GET(
        asTrainee('GET', `http://localhost/api/trainee/enablers/${ENABLER}`),
        {
          params: Promise.resolve({ enablerId: ENABLER }),
        }
      ),
  },
  {
    name: 'quiz answer',
    ownStatus: 400,
    route: 'trainee/quizzes/[quizId]/submit',
    call: mod =>
      mod.POST(
        asTrainee(
          'POST',
          `http://localhost/api/trainee/quizzes/${QUIZ}/submit`,
          {
            answers: [{ questionId: 'x', selectedOptionId: 'y' }],
          }
        ),
        { params: Promise.resolve({ quizId: QUIZ }) }
      ),
    forbiddenWrites: ['quiz_submissions'],
  },
];

describe.each(OCCUPATIONS)('a $name trainee', ({ own, other }) => {
  beforeEach(() => {
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });
  afterEach(() => jest.restoreAllMocks());

  describe.each(PROBES)('$name', probe => {
    it('does not reach content of the other occupation (404), nothing is written', async () => {
      const { mock } = await world(own, other);
      const mod = await import(`@/app/api/${probe.route}/route`);
      const res = await probe.call(mod);
      expect(res.status).toBe(404);
      for (const table of probe.forbiddenWrites ?? []) {
        expect(mock.writes('insert', table)).toHaveLength(0);
        expect(mock.writes('update', table)).toHaveLength(0);
      }
      const text = JSON.stringify(await res.json());
      expect(text).not.toContain('Use Case');
      expect(text).not.toContain('Kurs');
    });
  });

  describe.each(PROBES.filter(probe => probe.ownStatus !== undefined))(
    '$name (own occupation)',
    probe => {
      it('passes the occupation guard for content of the own occupation', async () => {
        await world(own, own);
        const mod = await import(`@/app/api/${probe.route}/route`);
        const res = await probe.call(mod);
        expect(res.status).toBe(probe.ownStatus);
      });
    }
  );

  describe('the file of a submission', () => {
    const call = async (
      mod: any,
      method: string,
      suffix = '',
      body?: unknown
    ) =>
      mod[method](
        asTrainee(
          method,
          `http://localhost/api/trainee/use-cases/${USE_CASE}/submission-file${suffix}`,
          body
        ),
        { params: Promise.resolve({ useCaseId: USE_CASE }) }
      );

    it('can not be fetched, announced or completed for a use case of the other occupation', async () => {
      const { storage } = await world(own, other);
      storage.objects.set('x', PDF_BYTES);
      const main =
        await import('@/app/api/trainee/use-cases/[useCaseId]/submission-file/route');
      const upload =
        await import('@/app/api/trainee/use-cases/[useCaseId]/submission-file/upload-url/route');
      const complete =
        await import('@/app/api/trainee/use-cases/[useCaseId]/submission-file/complete/route');
      expect((await call(main, 'GET')).status).toBe(404);
      expect((await call(main, 'DELETE')).status).toBe(404);
      expect(
        (
          await call(upload, 'POST', '/upload-url', {
            fileName: 'a.pdf',
            size: 5,
          })
        ).status
      ).toBe(404);
      expect(
        (await call(complete, 'POST', '/complete', { uploadId: 'x' })).status
      ).toBe(404);
      expect(storage.signedFor).toEqual([]);
    });

    it('is announced for a use case of the own occupation', async () => {
      const { storage } = await world(own, own);
      const upload =
        await import('@/app/api/trainee/use-cases/[useCaseId]/submission-file/upload-url/route');
      const res = await call(upload, 'POST', '/upload-url', {
        fileName: 'a.pdf',
        size: 5,
      });
      expect(res.status).toBe(200);
      expect(storage.signedFor).toHaveLength(1);
    });
  });
});
