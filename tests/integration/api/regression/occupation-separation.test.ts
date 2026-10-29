/**
 * @jest-environment node
 */
import { readdirSync, readFileSync, statSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import { fakeSession, mockSession } from '../../../helpers/mockNext';

// Occupation separation (release test, phase 6). A FIAE trainee sees nothing of KfBM,
// a KfBM trainee nothing of FIAE, a trainee enrolled in both works in ONE of them at
// a time and can reach both. This runs the real catalog scope
// (src/lib/catalog/scope.ts) against a table mock. The mock ignores where(), so the
// proof is the rendered catalog condition of each read (mock.filters) and, for single
// records, the 404 for a record of the other occupation.
//
// Which routes are covered: the lists below run here with real fixtures. A scan of
// src/app/api names every GET route that uses the catalog filter, a route that is in
// neither the lists here nor in COVERED_ELSEWHERE fails the last test, so a new
// catalog route cannot go live without a separation test.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'org-1';
const ID = 'bbbbbbb3-0000-4000-8000-000000000003';

const catalogs = [
  { id: FIAE, code: 'FIAE', isActive: true },
  { id: KFBM, code: 'KFBM', isActive: true },
];
// the organization has both occupations enabled, so only the enrollment separates
const orgBoth = [
  { trainingCatalogId: FIAE, isEnabled: true },
  { trainingCatalogId: KFBM, isEnabled: true },
];
const orgFiae = [{ trainingCatalogId: FIAE, isEnabled: true }];
const orgKfbm = [{ trainingCatalogId: KFBM, isEnabled: true }];
const traineeProfile = {
  id: 't1',
  role: 'TRAINEE',
  organizationId: ORG,
  isPlatformOwner: false,
};

/** The scope check let the request through: not "not found", no server error. */
function expectReached(res: Response) {
  expect(res.status).not.toBe(404);
  expect(res.status).toBeLessThan(500);
}

type Person = 'fiae' | 'kfbm' | 'both';
const enrollments: Record<Person, any[]> = {
  fiae: [{ trainingCatalogId: FIAE, startDate: '2025-08-01' }],
  kfbm: [{ trainingCatalogId: KFBM, startDate: '2026-08-01' }],
  both: [
    { trainingCatalogId: FIAE, startDate: '2025-08-01' },
    { trainingCatalogId: KFBM, startDate: '2026-08-01' },
  ],
};

function req(url: string, catalog?: string, method = 'GET') {
  return {
    url,
    method,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-catalog' ? (catalog ?? null) : null,
    },
    json: async () => ({}),
  } as any;
}

async function load(
  route: string,
  tables: Record<string, any>,
  session: ReturnType<typeof fakeSession> | null
) {
  jest.resetModules();
  const mock = createTableDb({ trainingCatalogs: catalogs, ...tables });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    verifyPlatformOwner: async () => true,
    getUserOrgId: async () => ORG,
  }));
  // routes that only look at an optional session (learning fields) call
  // getSessionUser, which the shared helper does not replace
  jest.doMock('@/lib/auth/session', () => {
    const actual = jest.requireActual('@/lib/auth/session') as any;
    const { NextResponse } = jest.requireActual('next/server') as any;
    const guard = (allowed: (s: any) => boolean) => async () => {
      if (!session) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
      return allowed(session)
        ? session
        : NextResponse.json({ error: 'Forbidden' }, { status: 403 });
    };
    return {
      ...actual,
      getSessionUser: async () => session,
      requireUser: guard(() => true),
      requireTrainer: guard(s => s.isTrainerLevel),
    };
  });
  const mod = await import(`@/app/api/${route}/route`);
  return { mock, mod };
}

const traineeSessionObject = () =>
  fakeSession({
    id: 't1',
    role: 'TRAINEE',
    isTrainerLevel: false,
    organizationId: ORG,
  });
const trainer = () => fakeSession({ id: 'tr1', organizationId: ORG });

const traineeTables = (who: Person) => ({
  profiles: [traineeProfile],
  organizationCatalogs: orgBoth,
  traineeEnrollments: enrollments[who],
});

// ---------------------------------------------------------------------------
// Lists: the catalog condition of the read
// ---------------------------------------------------------------------------

type ListCase = {
  name: string;
  route: string;
  url: string;
  /** Table whose query carries the catalog condition. */
  table: string;
  extra?: Record<string, any>;
};

const TRAINEE_LISTS: ListCase[] = [
  {
    name: 'course list',
    route: 'trainee/courses',
    url: 'http://localhost/api/trainee/courses',
    table: 'courses',
    extra: { courseMembers: [{ userId: 't1', courseId: ID }], courses: [] },
  },
  {
    name: 'global quiz list',
    route: 'trainee/quizzes',
    url: 'http://localhost/api/trainee/quizzes',
    table: 'quiz_assignments',
    extra: { quizAssignments: [], quizzes: [] },
  },
  {
    name: 'learning fields',
    route: 'trainee/lernfelder',
    url: 'http://localhost/api/trainee/lernfelder',
    table: 'training_catalog_learning_fields',
    extra: { trainingCatalogLearningFields: [] },
  },
  {
    name: 'school learning fields',
    route: 'trainee/school/lernfelder',
    url: 'http://localhost/api/trainee/school/lernfelder',
    table: 'training_catalog_learning_fields',
    extra: { trainingCatalogLearningFields: [] },
  },
  {
    name: 'use case hours',
    route: 'trainee/use-case-hours',
    url: 'http://localhost/api/trainee/use-case-hours',
    table: 'training_use_cases',
    extra: { activityReports: [], trainingUseCases: [] },
  },
  {
    name: 'dashboard',
    route: 'trainee/dashboard',
    url: 'http://localhost/api/trainee/dashboard',
    table: 'course_members',
    extra: { courseMembers: [{ userId: 't1', courseId: ID }], courses: [] },
  },
];

function filterParams(mock: ReturnType<typeof createTableDb>, c: ListCase) {
  const { params } = mock.filters('select', c.table);
  return params.map(String);
}

describe('trainee read routes: the catalog condition follows the enrollment', () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each(TRAINEE_LISTS)('$name ($route)', c => {
    const run = async (who: Person, catalog?: string) => {
      const { mock, mod } = await load(
        c.route,
        { ...traineeTables(who), ...c.extra },
        traineeSessionObject()
      );
      const res = await mod.GET(req(c.url, catalog));
      return { res, mock };
    };

    it('a FIAE trainee reads FIAE only', async () => {
      const { res, mock } = await run('fiae');
      expect(res.status).toBe(200);
      const params = filterParams(mock, c);
      expect(params).toContain(FIAE);
      expect(params).not.toContain(KFBM);
    });

    it('a KfBM trainee reads KfBM only', async () => {
      const { res, mock } = await run('kfbm');
      expect(res.status).toBe(200);
      const params = filterParams(mock, c);
      expect(params).toContain(KFBM);
      expect(params).not.toContain(FIAE);
    });

    it('asking for the other occupation is refused (403) before any content is read', async () => {
      const toKfbm = await run('fiae', 'KFBM');
      expect(toKfbm.res.status).toBe(403);
      expect(toKfbm.mock.filters('select', c.table).sql).toBe('');
      const toFiae = await run('kfbm', 'FIAE');
      expect(toFiae.res.status).toBe(403);
      expect(toFiae.mock.filters('select', c.table).sql).toBe('');
    });

    it('a trainee of both works in one occupation at a time and reaches each by choice', async () => {
      // without a choice: the one enrolled in first, never both mixed
      const first = await run('both');
      expect(first.res.status).toBe(200);
      expect(filterParams(first.mock, c)).toEqual(
        expect.arrayContaining([FIAE])
      );
      expect(filterParams(first.mock, c)).not.toContain(KFBM);
      // with a choice: exactly that occupation
      const kfbm = await run('both', 'KFBM');
      expect(kfbm.res.status).toBe(200);
      expect(filterParams(kfbm.mock, c)).toContain(KFBM);
      expect(filterParams(kfbm.mock, c)).not.toContain(FIAE);
      const fiae = await run('both', 'FIAE');
      expect(fiae.res.status).toBe(200);
      expect(filterParams(fiae.mock, c)).toContain(FIAE);
      expect(filterParams(fiae.mock, c)).not.toContain(KFBM);
    });
  });
});

const TRAINER_LISTS: ListCase[] = [
  {
    name: 'course list',
    route: 'trainer/courses',
    url: 'http://localhost/api/trainer/courses',
    table: 'courses',
    extra: { courses: [] },
  },
  {
    name: 'quiz list',
    route: 'trainer/quizzes',
    url: 'http://localhost/api/trainer/quizzes',
    table: 'quizzes',
    extra: { quizzes: [] },
  },
  {
    name: 'learning fields',
    route: 'trainer/lernfelder',
    url: 'http://localhost/api/trainer/lernfelder',
    table: 'training_catalog_learning_fields',
    extra: { trainingCatalogLearningFields: [] },
  },
  {
    name: 'dashboard',
    route: 'trainer/dashboard',
    url: 'http://localhost/api/trainer/dashboard',
    table: 'courses',
    extra: { courses: [] },
  },
];

describe('trainer read routes: the catalog condition follows the organization', () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each(TRAINER_LISTS)('$name ($route)', c => {
    const run = async (org: any[], catalog?: string) => {
      const { mock, mod } = await load(
        c.route,
        { organizationCatalogs: org, ...c.extra },
        trainer()
      );
      const res = await mod.GET(req(c.url, catalog));
      return { res, mock };
    };

    it('a FIAE organization reads FIAE only, a KfBM organization KfBM only', async () => {
      const fiae = await run(orgFiae);
      expect(fiae.res.status).toBe(200);
      expect(filterParams(fiae.mock, c)).toContain(FIAE);
      expect(filterParams(fiae.mock, c)).not.toContain(KFBM);
      const kfbm = await run(orgKfbm);
      expect(kfbm.res.status).toBe(200);
      expect(filterParams(kfbm.mock, c)).toContain(KFBM);
      expect(filterParams(kfbm.mock, c)).not.toContain(FIAE);
    });

    it('the occupation of another organization is refused (403)', async () => {
      const res = await run(orgFiae, 'KFBM');
      expect(res.res.status).toBe(403);
      expect(res.mock.filters('select', c.table).sql).toBe('');
    });

    it('an organization with both reads both, narrowed by choice', async () => {
      const all = await run(orgBoth);
      expect(filterParams(all.mock, c)).toEqual(
        expect.arrayContaining([FIAE, KFBM])
      );
      const one = await run(orgBoth, 'KFBM');
      expect(filterParams(one.mock, c)).toContain(KFBM);
      expect(filterParams(one.mock, c)).not.toContain(FIAE);
    });
  });
});

// ---------------------------------------------------------------------------
// Single records: the record of the other occupation is "not found"
// ---------------------------------------------------------------------------

type DetailCase = {
  name: string;
  route: string;
  url: string;
  params: Record<string, string>;
  /** Table and key of the content record the scope check reads. */
  table: string;
  tableKey: string;
  /** More rows the route reads after the scope check. */
  more?: Record<string, any[]>;
  /** Fields the record needs besides id, catalog and isActive. */
  record?: Record<string, unknown>;
};

const E = 'bbbbbbb4-0000-4000-8000-000000000004';
const U = 'bbbbbbb5-0000-4000-8000-000000000005';
const Q = 'bbbbbbb1-0000-4000-8000-000000000001';

const TRAINEE_DETAILS: DetailCase[] = [
  {
    name: 'course',
    route: 'trainee/courses/[courseId]',
    url: `http://localhost/api/trainee/courses/${ID}`,
    params: { courseId: ID },
    table: 'courses',
    tableKey: 'courses',
  },
  {
    name: 'enabler',
    route: 'trainee/enablers/[enablerId]',
    url: `http://localhost/api/trainee/enablers/${E}`,
    params: { enablerId: E },
    table: 'enablers',
    tableKey: 'enablers',
  },
  {
    name: 'enabler documents',
    route: 'trainee/enablers/[enablerId]/documents',
    url: `http://localhost/api/trainee/enablers/${E}/documents`,
    params: { enablerId: E },
    table: 'enablers',
    tableKey: 'enablers',
  },
  {
    name: 'enabler quiz list',
    route: 'trainee/enablers/[enablerId]/quizzes',
    url: `http://localhost/api/trainee/enablers/${E}/quizzes`,
    params: { enablerId: E },
    table: 'enablers',
    tableKey: 'enablers',
  },
  {
    name: 'enabler quiz by level',
    route: 'trainee/enablers/[enablerId]/quizzes/[difficulty]',
    url: `http://localhost/api/trainee/enablers/${E}/quizzes/LOW`,
    params: { enablerId: E, difficulty: 'LOW' },
    table: 'enablers',
    tableKey: 'enablers',
  },
  {
    name: 'enabler single quiz',
    route: 'trainee/enablers/[enablerId]/quiz',
    url: `http://localhost/api/trainee/enablers/${E}/quiz`,
    params: { enablerId: E },
    table: 'enablers',
    tableKey: 'enablers',
  },
  {
    name: 'use case',
    route: 'trainee/use-cases/[useCaseId]',
    url: `http://localhost/api/trainee/use-cases/${U}`,
    params: { useCaseId: U },
    table: 'use_cases',
    tableKey: 'useCases',
  },
  {
    name: 'use case documents',
    route: 'trainee/use-cases/[useCaseId]/documents',
    url: `http://localhost/api/trainee/use-cases/${U}/documents`,
    params: { useCaseId: U },
    table: 'use_cases',
    tableKey: 'useCases',
  },
  {
    name: 'global quiz',
    route: 'trainee/quizzes/[quizId]',
    url: `http://localhost/api/trainee/quizzes/${Q}`,
    params: { quizId: Q },
    table: 'quizzes',
    tableKey: 'quizzes',
    record: { quizType: 'GLOBAL' },
    more: {
      quizAssignments: [{ id: 'a1', quizId: Q, traineeId: 't1' }],
      questions: [],
      options: [],
    },
  },
];

describe('trainee single records: content of the other occupation is not found', () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each(TRAINEE_DETAILS)('$name ($route)', c => {
    const run = async (who: Person, recordCatalog: string) => {
      const { mod } = await load(
        c.route,
        {
          ...traineeTables(who),
          ...c.more,
          [c.tableKey]: [
            {
              id: Object.values(c.params)[0],
              trainingCatalogId: recordCatalog,
              isActive: true,
              ...c.record,
            },
          ],
        },
        traineeSessionObject()
      );
      return mod.GET(req(c.url), {
        params: Promise.resolve(c.params),
      });
    };

    it('a FIAE trainee gets 404 for a KfBM record and passes the scope check for a FIAE record', async () => {
      const foreign = await run('fiae', KFBM);
      expect(foreign.status).toBe(404);
      expect(await foreign.json()).toEqual({ error: 'Not found' });
      expectReached(await run('fiae', FIAE));
    });

    it('a KfBM trainee gets 404 for a FIAE record and passes the scope check for a KfBM record', async () => {
      const foreign = await run('kfbm', FIAE);
      expect(foreign.status).toBe(404);
      expect(await foreign.json()).toEqual({ error: 'Not found' });
      expectReached(await run('kfbm', KFBM));
    });

    it('a trainee of both reaches the record of either occupation', async () => {
      expectReached(await run('both', FIAE));
      expectReached(await run('both', KFBM));
    });
  });
});

const TRAINER_DETAILS: DetailCase[] = [
  {
    name: 'course',
    route: 'trainer/courses/[courseId]',
    url: `http://localhost/api/trainer/courses/${ID}`,
    params: { courseId: ID },
    table: 'courses',
    tableKey: 'courses',
  },
  {
    name: 'enabler',
    route: 'trainer/enablers/[enablerId]',
    url: `http://localhost/api/trainer/enablers/${E}`,
    params: { enablerId: E },
    table: 'enablers',
    tableKey: 'enablers',
  },
  {
    name: 'use case',
    route: 'trainer/use-cases/[useCaseId]',
    url: `http://localhost/api/trainer/use-cases/${U}`,
    params: { useCaseId: U },
    table: 'use_cases',
    tableKey: 'useCases',
  },
  {
    name: 'quiz',
    route: 'trainer/quizzes/[quizId]',
    url: `http://localhost/api/trainer/quizzes/${Q}`,
    params: { quizId: Q },
    table: 'quizzes',
    tableKey: 'quizzes',
  },
];

describe('trainer single records: content of the other occupation is not found', () => {
  beforeEach(() => jest.clearAllMocks());

  describe.each(TRAINER_DETAILS)('$name ($route)', c => {
    const run = async (org: any[], recordCatalog: string) => {
      const { mod } = await load(
        c.route,
        {
          organizationCatalogs: org,
          [c.tableKey]: [
            {
              id: Object.values(c.params)[0],
              trainingCatalogId: recordCatalog,
            },
          ],
        },
        trainer()
      );
      return mod.GET(req(c.url), { params: Promise.resolve(c.params) });
    };

    it('a FIAE organization gets 404 for a KfBM record, a KfBM organization for a FIAE record', async () => {
      expect((await run(orgFiae, KFBM)).status).toBe(404);
      expect((await run(orgKfbm, FIAE)).status).toBe(404);
      expectReached(await run(orgFiae, FIAE));
      expectReached(await run(orgKfbm, KFBM));
    });

    it('an organization with both reaches both', async () => {
      expectReached(await run(orgBoth, FIAE));
      expectReached(await run(orgBoth, KFBM));
    });
  });
});

// ---------------------------------------------------------------------------
// The occupations a person may choose from
// ---------------------------------------------------------------------------

describe('the occupation list of the person (me/catalogs)', () => {
  beforeEach(() => jest.clearAllMocks());

  const codes = async (who: Person) => {
    const { mod } = await load(
      'me/catalogs',
      { ...traineeTables(who) },
      traineeSessionObject()
    );
    const res = await mod.GET(req('http://localhost/api/me/catalogs'));
    expect(res.status).toBe(200);
    const body = await res.json();
    return (body.catalogs as { code: string }[]).map(c => c.code);
  };

  it('a FIAE trainee sees FIAE only, a KfBM trainee KfBM only', async () => {
    expect(await codes('fiae')).toEqual(['FIAE']);
    expect(await codes('kfbm')).toEqual(['KFBM']);
  });

  it('a trainee of two occupations sees both', async () => {
    expect((await codes('both')).sort()).toEqual(['FIAE', 'KFBM']);
  });
});

// ---------------------------------------------------------------------------
// Completeness: every GET route with a catalog filter is covered
// ---------------------------------------------------------------------------

// Routes that use the catalog filter and are separated by a test of their own
const COVERED_ELSEWHERE: Record<string, string> = {
  'activity-reports/[id]':
    'tests/integration/api/activity-reports/catalog-phase-plan.test.ts',
  'activity-reports':
    'tests/integration/api/activity-reports/session-access.test.ts',
  'trainer/profile': 'tests/integration/api/trainer/profile.test.ts',
  'trainer/reviews':
    'tests/integration/api/trainer/scope-trainee-reads.test.ts',
  'trainer/quiz-submissions/[submissionId]':
    'tests/integration/api/trainer/quiz-submission-review.get.test.ts',
  'breadcrumb/label':
    'tests/integration/api/activity-reports/session-access.test.ts',
  'hai/chat': 'tests/integration/api/hai/chat-persona.test.ts',
  'me/catalogs': 'tests/integration/api/catalog/me-catalogs.test.ts',
  'trainee/quizzes/[quizId]/submit':
    'tests/integration/api/catalog/isolation.test.ts',
  'trainer/activity-reports':
    'tests/integration/api/trainer/activity-reports-catalog.test.ts',
  'trainer/lernfelder/[id]': 'tests/integration/api/catalog/isolation.test.ts',
  'trainer/quiz-members':
    'tests/integration/api/trainer/scope-trainer-assignments.test.ts',
  'trainer/quiz-submissions':
    'tests/integration/api/trainer/scope-quiz-submissions.test.ts',
  'trainer/enablers/[enablerId]/documents':
    'tests/integration/api/trainer/documents-scope.test.ts',
  'trainer/use-cases/[useCaseId]/documents':
    'tests/integration/api/trainer/documents-scope.test.ts',
};

// Sub routes that run the same content scope check as a route tested above: the
// check is the one function requireContentScope with the same kind of record,
// the last test of this file compares the kinds in the route files
const SHARES_PARENT_SCOPE: Record<string, string[]> = {
  'trainer/courses/[courseId]/enablers': ['trainer/courses/[courseId]'],
  'trainer/courses/[courseId]/members': ['trainer/courses/[courseId]'],
  'trainer/courses/[courseId]/use-cases': ['trainer/courses/[courseId]'],
  'trainer/enablers/[enablerId]/quiz': ['trainer/enablers/[enablerId]'],
  'trainer/enablers/[enablerId]/quizzes': ['trainer/enablers/[enablerId]'],
  'trainer/enablers/[enablerId]/quizzes/[quizId]': [
    'trainer/enablers/[enablerId]',
    'trainer/quizzes/[quizId]',
  ],
};

const CATALOG_MARKERS =
  /requireCatalogScope|requireCatalogScopeForUser|requireContentScope|requireContentScopeForUser|catalogCondition|getCatalogScope/;

function routeFiles(dir: string): string[] {
  return readdirSync(dir).flatMap(name => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return routeFiles(path);
    return name === 'route.ts' ? [path] : [];
  });
}

describe('completeness of the separation tests', () => {
  const API = join(process.cwd(), 'src/app/api');
  const catalogGetRoutes = routeFiles(API)
    .filter(file => {
      const text = readFileSync(file, 'utf8');
      return (
        /export\s+(async\s+)?function\s+GET/.test(text) &&
        CATALOG_MARKERS.test(text)
      );
    })
    .map(file =>
      file
        .slice(API.length + 1)
        .replace(/\\/g, '/')
        .replace(/\/route\.ts$/, '')
    )
    .sort();

  const covered = new Set([
    ...TRAINEE_LISTS.map(c => c.route),
    ...TRAINEE_DETAILS.map(c => c.route),
    ...TRAINER_LISTS.map(c => c.route),
    ...TRAINER_DETAILS.map(c => c.route),
    ...Object.keys(COVERED_ELSEWHERE),
    ...Object.keys(SHARES_PARENT_SCOPE),
  ]);

  it('finds the catalog routes it expects (the scan itself works)', () => {
    expect(catalogGetRoutes.length).toBeGreaterThan(30);
    expect(catalogGetRoutes).toContain('trainee/courses');
    expect(catalogGetRoutes).toContain('trainer/courses');
  });

  it('every GET route with a catalog filter has a separation test', () => {
    const missing = catalogGetRoutes.filter(route => !covered.has(route));
    expect(missing).toEqual([]);
  });

  it('every entry of the lists belongs to a route that still exists and still uses the filter', () => {
    const stale = [...covered].filter(
      route => !catalogGetRoutes.includes(route)
    );
    expect(stale).toEqual([]);
  });

  it('the tests named for the other routes exist and mention the route', () => {
    for (const [route, file] of Object.entries(COVERED_ELSEWHERE)) {
      expect(existsSync(join(process.cwd(), file))).toBe(true);
      const text = readFileSync(join(process.cwd(), file), 'utf8');
      const leaf = route.split('/').filter(part => !part.startsWith('['));
      expect(text).toContain(leaf[leaf.length - 1]);
    }
  });

  it('a sub route that shares the scope check of its parent uses the same kinds of record', () => {
    const kindsOf = (route: string) => {
      const text = readFileSync(
        join(process.cwd(), 'src/app/api', route, 'route.ts'),
        'utf8'
      );
      return new Set(
        [
          ...text.matchAll(
            /requireContentScope(?:ForUser)?\(\s*[^,]+,\s*[^,]+,\s*'(\w+)'/g
          ),
        ].map(m => m[1])
      );
    };
    for (const [route, parents] of Object.entries(SHARES_PARENT_SCOPE)) {
      for (const parent of parents) expect(covered.has(parent)).toBe(true);
      const own = kindsOf(route);
      expect(own.size).toBeGreaterThan(0);
      const parentKinds = new Set(parents.flatMap(p => [...kindsOf(p)]));
      for (const kind of own) expect(parentKinds.has(kind)).toBe(true);
    }
  });
});
