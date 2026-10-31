/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import { fakeSession, mockSession } from '../../../helpers/mockNext';

// Catalog isolation per route family. These tests run the real catalog scope
// (src/lib/catalog/scope.ts) against a table mock. The mock ignores where()
// conditions, so the assertions look at the rendered conditions
// (mock.filters) and at the answers of the guards.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'org-1';

const catalogs = [
  { id: FIAE, code: 'FIAE', isActive: true },
  { id: KFBM, code: 'KFBM', isActive: true },
];
const fiaeOnly = [{ trainingCatalogId: FIAE, isEnabled: true }];
const kfbmOnly = [{ trainingCatalogId: KFBM, isEnabled: true }];
const both = [...fiaeOnly, ...kfbmOnly];

function req(
  url: string,
  opts: { header?: string; body?: unknown; method?: string } = {}
) {
  return {
    url,
    method: opts.method ?? 'GET',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-catalog' ? (opts.header ?? null) : null,
    },
    json: async () => opts.body ?? {},
  } as any;
}

type Loaded = {
  mock: ReturnType<typeof createTableDb>;
  mod: any;
};

async function load(
  route: string,
  tables: Record<string, any>,
  options: {
    session?: ReturnType<typeof fakeSession> | null;
    db?: any;
  } = {}
): Promise<Loaded> {
  jest.resetModules();
  const mock = createTableDb({ trainingCatalogs: catalogs, ...tables });
  jest.doMock('@/db', () => ({
    __esModule: true,
    default: options.db ?? mock.db,
  }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    verifyPlatformOwner: async () => true,
    getUserOrgId: async () => ORG,
  }));
  if (options.session !== undefined) mockSession(options.session);
  const mod = await import(`@/app/api/${route}/route`);
  return { mock, mod };
}

const trainer = (overrides = {}) =>
  fakeSession({ id: 'tr1', organizationId: ORG, ...overrides });
const superAdmin = () =>
  fakeSession({
    id: 'sa1',
    role: 'ADMIN',
    isAdmin: true,
    isSuperAdmin: true,
    isPlatformOwner: true,
  });

const traineeProfile = {
  id: 't1',
  role: 'TRAINEE',
  organizationId: ORG,
  isPlatformOwner: false,
};

describe('catalog isolation', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('trainer routes', () => {
    it('course list: a KfBM trainer is limited to KFBM courses', async () => {
      const { mock, mod } = await load(
        'trainer/courses',
        { organizationCatalogs: kfbmOnly, courses: [] },
        { session: trainer() }
      );
      const res = await mod.GET(req('http://localhost/api/trainer/courses'));
      expect(res.status).toBe(200);
      const filter = mock.filters('select', 'courses');
      expect(filter.sql).toContain('"training_catalog_id"');
      expect(filter.params).toContain(KFBM);
      expect(filter.params).not.toContain(FIAE);
    });

    it('course list: a FIAE trainer keeps seeing FIAE courses', async () => {
      const { mock, mod } = await load(
        'trainer/courses',
        {
          organizationCatalogs: fiaeOnly,
          courses: [{ id: 'bbbbbbb3-0000-4000-8000-000000000003', title: 'C', year: 1, chapter: 1 }],
        },
        { session: trainer() }
      );
      const res = await mod.GET(req('http://localhost/api/trainer/courses'));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.courses).toHaveLength(1);
      expect(mock.filters('select', 'courses').params).toEqual([FIAE]);
    });

    it('course list: the super admin sees both catalogs', async () => {
      const { mock, mod } = await load(
        'trainer/courses',
        { courses: [] },
        { session: superAdmin() }
      );
      const res = await mod.GET(req('http://localhost/api/trainer/courses'));
      expect(res.status).toBe(200);
      expect(mock.filters('select', 'courses').params).toEqual(
        expect.arrayContaining([FIAE, KFBM])
      );
    });

    it('course list: x-catalog narrows the super admin to one catalog', async () => {
      const { mock, mod } = await load(
        'trainer/courses',
        { courses: [] },
        { session: superAdmin() }
      );
      await mod.GET(
        req('http://localhost/api/trainer/courses', { header: 'KFBM' })
      );
      expect(mock.filters('select', 'courses').params).toEqual([KFBM]);
    });

    it('a wrong x-catalog answers 403 on a list and on a write', async () => {
      const list = await load(
        'trainer/courses',
        { organizationCatalogs: fiaeOnly },
        { session: trainer() }
      );
      const res = await list.mod.GET(
        req('http://localhost/api/trainer/courses', { header: 'KFBM' })
      );
      expect(res.status).toBe(403);

      const write = await load(
        'trainer/courses',
        { organizationCatalogs: fiaeOnly },
        { session: superAdmin() }
      );
      const created = await write.mod.POST(
        req('http://localhost/api/trainer/courses', {
          header: 'NOPE',
          method: 'POST',
          body: { title: 'New' },
        })
      );
      expect(created.status).toBe(403);
      expect(write.mock.writes('insert', 'courses')).toHaveLength(0);
    });

    it('a new course gets the active catalog', async () => {
      const { mock, mod } = await load(
        'trainer/courses',
        { organizationCatalogs: kfbmOnly },
        { session: superAdmin() }
      );
      const res = await mod.POST(
        req('http://localhost/api/trainer/courses', {
          header: 'KFBM',
          method: 'POST',
          body: { title: 'K6.1 course' },
        })
      );
      expect(res.status).toBe(200);
      expect(mock.writes('insert', 'courses')[0]).toMatchObject({
        trainingCatalogId: KFBM,
        title: 'K6.1 course',
      });
    });

    it('course detail: a FIAE course is not found for a KfBM trainer', async () => {
      const { mod } = await load(
        'trainer/courses/[courseId]',
        {
          organizationCatalogs: kfbmOnly,
          courses: [
            { id: 'bbbbbbb3-0000-4000-8000-000000000003', title: 'FIAE course', trainingCatalogId: FIAE },
          ],
        },
        { session: trainer() }
      );
      const res = await mod.GET(
        req('http://localhost/api/trainer/courses/bbbbbbb3-0000-4000-8000-000000000003'),
        { params: Promise.resolve({ courseId: 'bbbbbbb3-0000-4000-8000-000000000003' }) }
      );
      expect(res.status).toBe(404);
    });

    it('course detail: the same course is served to a FIAE trainer', async () => {
      const { mod } = await load(
        'trainer/courses/[courseId]',
        {
          organizationCatalogs: fiaeOnly,
          courses: [
            { id: 'bbbbbbb3-0000-4000-8000-000000000003', title: 'FIAE course', trainingCatalogId: FIAE },
          ],
        },
        { session: trainer() }
      );
      const res = await mod.GET(
        req('http://localhost/api/trainer/courses/bbbbbbb3-0000-4000-8000-000000000003'),
        { params: Promise.resolve({ courseId: 'bbbbbbb3-0000-4000-8000-000000000003' }) }
      );
      expect(res.status).toBe(200);
    });

    it('course detail: the super admin reaches both catalogs', async () => {
      for (const catalogId of [FIAE, KFBM]) {
        const { mod } = await load(
          'trainer/courses/[courseId]',
          { courses: [{ id: 'bbbbbbb3-0000-4000-8000-000000000003', title: 'C', trainingCatalogId: catalogId }] },
          { session: superAdmin() }
        );
        const res = await mod.GET(
          req('http://localhost/api/trainer/courses/bbbbbbb3-0000-4000-8000-000000000003'),
          { params: Promise.resolve({ courseId: 'bbbbbbb3-0000-4000-8000-000000000003' }) }
        );
        expect(res.status).toBe(200);
      }
    });

    it('a trainer cannot delete an enabler of any catalog (403)', async () => {
      const { mock, mod } = await load(
        'trainer/enablers/[enablerId]',
        {
          organizationCatalogs: kfbmOnly,
          enablers: [{ id: 'bbbbbbb4-0000-4000-8000-000000000004', trainingCatalogId: FIAE }],
        },
        { session: trainer() }
      );
      const res = await mod.DELETE(
        req('http://localhost/api/trainer/enablers/bbbbbbb4-0000-4000-8000-000000000004', { method: 'DELETE' }),
        { params: Promise.resolve({ enablerId: 'bbbbbbb4-0000-4000-8000-000000000004' }) }
      );
      expect(res.status).toBe(403);
      expect(mock.writes('delete', 'enablers')).toHaveLength(0);
    });

    it('quiz list is limited to the caller catalogs', async () => {
      const { mock, mod } = await load(
        'trainer/quizzes',
        { organizationCatalogs: kfbmOnly, quizzes: [] },
        { session: trainer() }
      );
      const res = await mod.GET(req('http://localhost/api/trainer/quizzes'));
      expect(res.status).toBe(200);
      const filter = mock.filters('select', 'quizzes');
      expect(filter.params).toContain(KFBM);
      expect(filter.params).not.toContain(FIAE);
    });

    it('?type=big asks only for global quizzes, so the 200 row limit cannot cut them off', async () => {
      const { mock, mod } = await load(
        'trainer/quizzes',
        { organizationCatalogs: kfbmOnly, quizzes: [] },
        { session: trainer() }
      );
      const all = await mod.GET(req('http://localhost/api/trainer/quizzes'));
      expect(all.status).toBe(200);
      expect(mock.filters('select', 'quizzes').params).not.toContain('GLOBAL');
      const big = await mod.GET(
        req('http://localhost/api/trainer/quizzes?type=big')
      );
      expect(big.status).toBe(200);
      expect(mock.filters('select', 'quizzes').params).toContain('GLOBAL');
    });

    it('a new global quiz gets the active catalog', async () => {
      const { mock, mod } = await load(
        'trainer/quizzes',
        { organizationCatalogs: kfbmOnly },
        { session: superAdmin() }
      );
      const res = await mod.POST(
        req('http://localhost/api/trainer/quizzes', {
          header: 'KFBM',
          method: 'POST',
          body: { title: 'Global K1', quiz_type: 'big' },
        })
      );
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'quizzes')[0]).toMatchObject({
        trainingCatalogId: KFBM,
      });
    });

    it('a trainer cannot create a mini quiz for an enabler (403)', async () => {
      const { mock, mod } = await load(
        'trainer/quizzes',
        {
          organizationCatalogs: kfbmOnly,
          enablers: [{ id: 'bbbbbbb4-0000-4000-8000-000000000004', trainingCatalogId: FIAE }],
        },
        { session: trainer() }
      );
      const res = await mod.POST(
        req('http://localhost/api/trainer/quizzes', {
          header: 'KFBM',
          method: 'POST',
          body: { title: 'Mini', quiz_type: 'mini', enabler_id: 'bbbbbbb4-0000-4000-8000-000000000004' },
        })
      );
      expect(res.status).toBe(403);
      expect(mock.writes('insert', 'quizzes')).toHaveLength(0);
    });

    it('learning field list reads the catalog table of the caller', async () => {
      const { mock, mod } = await load(
        'trainer/lernfelder',
        {
          organizationCatalogs: kfbmOnly,
          trainingCatalogLearningFields: [],
        },
        { session: trainer() }
      );
      const res = await mod.GET(req('http://localhost/api/trainer/lernfelder'));
      expect(res.status).toBe(200);
      const filter = mock.filters('select', 'training_catalog_learning_fields');
      expect(filter.params).toContain(KFBM);
      expect(filter.params).not.toContain(FIAE);
    });

    it('a new learning field belongs to the active catalog', async () => {
      const { mock, mod } = await load(
        'trainer/lernfelder',
        { organizationCatalogs: kfbmOnly },
        { session: superAdmin() }
      );
      const res = await mod.POST(
        req('http://localhost/api/trainer/lernfelder', {
          header: 'KFBM',
          method: 'POST',
          body: { title: 'Bueroorganisation', label: 'LF-7' },
        })
      );
      expect(res.status).toBe(200);
      expect(
        mock.writes('insert', 'training_catalog_learning_fields')[0]
      ).toMatchObject({
        trainingCatalogId: KFBM,
        code: 'LF-7',
        trainingYear: 2,
      });
    });

    it('a taken learning field label answers 409, not 500', async () => {
      const conflict = Object.assign(new Error('failed query'), {
        cause: {
          code: '23505',
          constraint_name:
            'training_catalog_learning_fields_catalog_code_unique',
        },
      });
      const base = createTableDb({
        trainingCatalogs: catalogs,
        organizationCatalogs: kfbmOnly,
      });
      const db = {
        ...base.db,
        transaction: async () => {
          throw conflict;
        },
      };
      const { mod } = await load(
        'trainer/lernfelder',
        {},
        {
          session: superAdmin(),
          db,
        }
      );
      const res = await mod.POST(
        req('http://localhost/api/trainer/lernfelder', {
          header: 'KFBM',
          method: 'POST',
          body: { title: 'Duplicate', label: 'LF-7' },
        })
      );
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/already exists/);
    });

    it('another unique violation is still a server error', async () => {
      const other = Object.assign(new Error('failed query'), {
        cause: { code: '23505', constraint_name: 'something_else_unique' },
      });
      const base = createTableDb({
        trainingCatalogs: catalogs,
        organizationCatalogs: kfbmOnly,
      });
      const db = {
        ...base.db,
        transaction: async () => {
          throw other;
        },
      };
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const { mod } = await load(
        'trainer/lernfelder',
        {},
        {
          session: superAdmin(),
          db,
        }
      );
      const res = await mod.POST(
        req('http://localhost/api/trainer/lernfelder', {
          header: 'KFBM',
          method: 'POST',
          body: { title: 'X', label: 'LF-9' },
        })
      );
      expect(res.status).toBe(500);
      errorSpy.mockRestore();
    });

    it('creating a learning field takes the advisory lock for its catalog', async () => {
      const { mock, mod } = await load(
        'trainer/lernfelder',
        { organizationCatalogs: kfbmOnly },
        { session: superAdmin() }
      );
      await mod.POST(
        req('http://localhost/api/trainer/lernfelder', {
          header: 'KFBM',
          method: 'POST',
          body: { title: 'Locked', label: 'LF-2' },
        })
      );
      expect(mock.db.transaction).toHaveBeenCalledTimes(1);
      expect(mock.db.execute).toHaveBeenCalled();
    });

    it('a label change recalculates the training year', async () => {
      const { mock, mod } = await load(
        'trainer/lernfelder/[id]',
        { organizationCatalogs: kfbmOnly },
        { session: superAdmin() }
      );
      const res = await mod.PATCH(
        req('http://localhost/api/trainer/lernfelder/bbbbbbb5-0000-4000-8000-000000000005', {
          header: 'KFBM',
          method: 'PATCH',
          body: { label: 'LF-8' },
        }),
        { params: Promise.resolve({ id: 'bbbbbbb5-0000-4000-8000-000000000005' }) }
      );
      expect(res.status).toBe(200);
      expect(
        mock.writes('update', 'training_catalog_learning_fields')[0]
      ).toMatchObject({ code: 'LF-8', trainingYear: 2 });
    });

    it('fails closed when the catalog lookup breaks (503, no data)', async () => {
      const failing = {
        select: jest.fn(() => {
          throw new Error('db down');
        }),
      };
      const errorSpy = jest
        .spyOn(console, 'error')
        .mockImplementation(() => {});
      const { mod } = await load(
        'trainer/courses',
        {},
        { session: trainer(), db: failing }
      );
      const res = await mod.GET(req('http://localhost/api/trainer/courses'));
      expect(res.status).toBe(503);
      expect(failing.select).toHaveBeenCalled();
      errorSpy.mockRestore();
    });

    it('fails closed for an organization whose catalogs are all disabled', async () => {
      const { mod } = await load(
        'trainer/courses',
        {
          organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: false }],
        },
        { session: trainer() }
      );
      const res = await mod.GET(req('http://localhost/api/trainer/courses'));
      expect(res.status).toBe(403);
    });
  });

  describe('trainee routes', () => {
    it('course list: a KfBM trainee only gets KFBM courses', async () => {
      const { mock, mod } = await load('trainee/courses', {
        profiles: [traineeProfile],
        organizationCatalogs: both,
        traineeEnrollments: [
          { trainingCatalogId: KFBM, startDate: '2026-08-01' },
        ],
        courseMembers: [{ userId: 't1', courseId: 'bbbbbbb3-0000-4000-8000-000000000003' }],
        courses: [],
      });
      const res = await mod.GET(
        req('http://localhost/api/trainee/courses?traineeId=t1')
      );
      expect(res.status).toBe(200);
      const filter = mock.filters('select', 'courses');
      expect(filter.params).toContain(KFBM);
      expect(filter.params).not.toContain(FIAE);
    });

    it('course list: a trainee without enrollment stays on FIAE', async () => {
      const { mock, mod } = await load('trainee/courses', {
        profiles: [traineeProfile],
        organizationCatalogs: fiaeOnly,
        traineeEnrollments: [],
        courseMembers: [{ userId: 't1', courseId: 'bbbbbbb3-0000-4000-8000-000000000003' }],
        courses: [],
      });
      const res = await mod.GET(
        req('http://localhost/api/trainee/courses?traineeId=t1')
      );
      expect(res.status).toBe(200);
      expect(mock.filters('select', 'courses').params).toContain(FIAE);
    });

    it('occupation separation: a KfBM trainee gets 403 on ?catalog=FIAE', async () => {
      // The organization has both occupations enabled, the trainee is
      // enrolled in KfBM only
      const { mock, mod } = await load('trainee/courses', {
        profiles: [traineeProfile],
        organizationCatalogs: both,
        traineeEnrollments: [
          { trainingCatalogId: KFBM, startDate: '2026-08-01' },
        ],
        courseMembers: [{ userId: 't1', courseId: 'bbbbbbb3-0000-4000-8000-000000000003' }],
        courses: [],
      });
      const res = await mod.GET(
        req('http://localhost/api/trainee/courses?traineeId=t1&catalog=FIAE')
      );
      expect(res.status).toBe(403);
      // no course query ran for the foreign occupation
      expect(mock.filters('select', 'courses').sql).toBe('');
    });

    it('occupation separation: a FIAE trainee in the same organization only sees FIAE', async () => {
      const { mock, mod } = await load('trainee/courses', {
        profiles: [traineeProfile],
        organizationCatalogs: both,
        traineeEnrollments: [
          { trainingCatalogId: FIAE, startDate: '2026-08-01' },
        ],
        courseMembers: [{ userId: 't1', courseId: 'bbbbbbb3-0000-4000-8000-000000000003' }],
        courses: [],
      });
      const res = await mod.GET(
        req('http://localhost/api/trainee/courses?traineeId=t1')
      );
      expect(res.status).toBe(200);
      const filter = mock.filters('select', 'courses');
      expect(filter.params).toContain(FIAE);
      expect(filter.params).not.toContain(KFBM);

      // asking for the other occupation of the organization is rejected too
      const other = await load('trainee/courses', {
        profiles: [traineeProfile],
        organizationCatalogs: both,
        traineeEnrollments: [
          { trainingCatalogId: FIAE, startDate: '2026-08-01' },
        ],
        courseMembers: [{ userId: 't1', courseId: 'bbbbbbb3-0000-4000-8000-000000000003' }],
        courses: [],
      });
      const denied = await other.mod.GET(
        req('http://localhost/api/trainee/courses?traineeId=t1&catalog=KFBM')
      );
      expect(denied.status).toBe(403);
    });

    it('an unknown trainee id is rejected (fail closed)', async () => {
      const { mod } = await load('trainee/courses', {
        profiles: [],
        organizationCatalogs: fiaeOnly,
      });
      const res = await mod.GET(
        req('http://localhost/api/trainee/courses?traineeId=ghost')
      );
      expect(res.status).toBe(403);
    });

    it('course detail: a FIAE course is hidden from a KfBM trainee', async () => {
      const { mod } = await load('trainee/courses/[courseId]', {
        profiles: [traineeProfile],
        organizationCatalogs: both,
        traineeEnrollments: [
          { trainingCatalogId: KFBM, startDate: '2026-08-01' },
        ],
        courses: [{ id: 'bbbbbbb3-0000-4000-8000-000000000003', trainingCatalogId: FIAE }],
      });
      const res = await mod.GET(
        req('http://localhost/api/trainee/courses/bbbbbbb3-0000-4000-8000-000000000003?traineeId=t1'),
        { params: Promise.resolve({ courseId: 'bbbbbbb3-0000-4000-8000-000000000003' }) }
      );
      expect(res.status).toBe(404);
    });

    it('enabler detail: a FIAE enabler is hidden from a KfBM trainee', async () => {
      const { mod } = await load('trainee/enablers/[enablerId]', {
        profiles: [traineeProfile],
        organizationCatalogs: both,
        traineeEnrollments: [
          { trainingCatalogId: KFBM, startDate: '2026-08-01' },
        ],
        enablers: [{ id: 'bbbbbbb4-0000-4000-8000-000000000004', trainingCatalogId: FIAE, isActive: true }],
      });
      const res = await mod.GET(
        req('http://localhost/api/trainee/enablers/bbbbbbb4-0000-4000-8000-000000000004?traineeId=t1'),
        { params: Promise.resolve({ enablerId: 'bbbbbbb4-0000-4000-8000-000000000004' }) }
      );
      expect(res.status).toBe(404);
    });

    it('global quiz list is limited to the catalog of the trainee', async () => {
      const { mock, mod } = await load('trainee/quizzes', {
        profiles: [traineeProfile],
        organizationCatalogs: both,
        traineeEnrollments: [
          { trainingCatalogId: KFBM, startDate: '2026-08-01' },
        ],
        quizAssignments: [],
        quizzes: [],
      });
      const res = await mod.GET(
        req('http://localhost/api/trainee/quizzes?userId=t1')
      );
      expect(res.status).toBe(200);
      const filter = mock.filters('select', 'quiz_assignments');
      expect(filter.params).toContain(KFBM);
      expect(filter.params).not.toContain(FIAE);
    });

    it('quiz submit: a FIAE quiz cannot be answered by a KfBM trainee', async () => {
      const { mock, mod } = await load('trainee/quizzes/[quizId]/submit', {
        profiles: [traineeProfile],
        organizationCatalogs: both,
        traineeEnrollments: [
          { trainingCatalogId: KFBM, startDate: '2026-08-01' },
        ],
        quizzes: [{ id: 'bbbbbbb1-0000-4000-8000-000000000001', trainingCatalogId: FIAE, isActive: true }],
      });
      const res = await mod.POST(
        req('http://localhost/api/trainee/quizzes/bbbbbbb1-0000-4000-8000-000000000001/submit', {
          method: 'POST',
          body: {
            traineeId: 't1',
            answers: [{ questionId: 'x', selectedOptionId: 'y' }],
          },
        }),
        { params: Promise.resolve({ quizId: 'bbbbbbb1-0000-4000-8000-000000000001' }) }
      );
      expect(res.status).toBe(404);
      expect(mock.writes('insert', 'quiz_submissions')).toHaveLength(0);
    });

    it('use-case hours: training use cases are limited to the catalog', async () => {
      const { mock, mod } = await load('trainee/use-case-hours', {
        profiles: [traineeProfile],
        organizationCatalogs: both,
        traineeEnrollments: [
          { trainingCatalogId: KFBM, startDate: '2026-08-01' },
        ],
        activityReports: [],
        trainingUseCases: [],
      });
      const res = await mod.GET(
        req('http://localhost/api/trainee/use-case-hours?traineeId=t1')
      );
      expect(res.status).toBe(200);
      const filter = mock.filters('select', 'training_use_cases');
      expect(filter.sql).toContain(
        '"training_components"."training_catalog_id"'
      );
      expect(filter.params).toContain(KFBM);
    });

    it('lernfelder without a session fall back to the public catalog', async () => {
      const { mock, mod } = await load('trainee/lernfelder', {
        trainingCatalogLearningFields: [],
      });
      const res = await mod.GET(req('http://localhost/api/trainee/lernfelder'));
      expect(res.status).toBe(200);
      const filter = mock.filters('select', 'training_catalog_learning_fields');
      expect(filter.params).toEqual([FIAE]);
    });
  });
});
