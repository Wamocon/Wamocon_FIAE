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
import fs from 'fs';
import path from 'path';
import { createTableDb } from '../../../helpers/mockDb';
import {
  makeRequest,
  mockCatalogScope,
  mockSupabaseAuth,
  sessionProfileRow,
} from '../../../helpers/mockNext';
import {
  GUARDED_ROUTES,
  type GuardedRoute,
} from '../../../helpers/guardedRoutes';

// Curriculum content (courses, enablers, use cases, quizzes, learning fields,
// modules, lessons and their assignments) may only be changed by the platform
// wide admin: role SUPER_ADMIN, or an ADMIN of the platform organization (that
// is isSuperAdmin in src/lib/auth/roles.ts). Every other member of the
// platform organization (trainer, TEMP_ADMIN) and everybody in a customer
// organization is answered with 403. Reading stays open to the trainer level.
// These tests run the real session layer (token check against a mocked
// Supabase auth and a mocked profile row), so the role and the organization
// come from the database row, never from the request.

const TOKEN = 'valid-token';
const CURRICULUM_403 =
  'Only platform administrators can manage curriculum content';

const ALL_CURRICULUM = GUARDED_ROUTES.filter(r => r.guard === 'curriculum');
// The content upload (trainer/content-upload) has its own tests; its handlers,
// reads included, are part of the rights check below
const CONTENT_UPLOAD = ALL_CURRICULUM.filter(r =>
  r.route.startsWith('trainer/content-upload/')
);
const WRITES = ALL_CURRICULUM;

// Read handlers of the same routes, they stay open to the trainer level
const READ_ROUTES = [
  'trainer/content/modules/[moduleId]',
  'trainer/courses',
  'trainer/courses/[courseId]',
  'trainer/courses/[courseId]/enablers',
  'trainer/courses/[courseId]/use-cases',
  'trainer/enablers/[enablerId]',
  'trainer/enablers/[enablerId]/quiz',
  'trainer/enablers/[enablerId]/quizzes',
  'trainer/enablers/[enablerId]/quizzes/[quizId]',
  'trainer/lernfelder',
  'trainer/lernfelder/[id]',
  'trainer/quizzes',
  'trainer/quizzes/[quizId]',
  'trainer/use-cases/[useCaseId]',
];
const READS = GUARDED_ROUTES.filter(
  r => r.method === 'GET' && READ_ROUTES.includes(r.route)
);

type Caller = { name: string; profile: Record<string, unknown> };

const ALLOWED: Caller[] = [
  {
    name: 'SUPER_ADMIN of the platform organization',
    profile: { role: 'SUPER_ADMIN', isPlatformOwner: true },
  },
  {
    name: 'SUPER_ADMIN without the platform flag',
    profile: { role: 'SUPER_ADMIN', isPlatformOwner: false },
  },
  {
    name: 'ADMIN of the platform organization',
    profile: { role: 'ADMIN', isPlatformOwner: true },
  },
];

const DENIED: Caller[] = [
  {
    name: 'TRAINER of the platform organization',
    profile: { role: 'TRAINER', isPlatformOwner: true },
  },
  {
    name: 'TEMP_ADMIN of the platform organization',
    profile: { role: 'TEMP_ADMIN', isPlatformOwner: true },
  },
  {
    name: 'ADMIN of a customer organization',
    profile: { role: 'ADMIN', isPlatformOwner: false },
  },
  {
    name: 'TEMP_ADMIN of a customer organization',
    profile: { role: 'TEMP_ADMIN', isPlatformOwner: false },
  },
  {
    name: 'TRAINER of a customer organization',
    profile: { role: 'TRAINER', isPlatformOwner: false },
  },
  {
    name: 'TRAINEE of the platform organization',
    profile: { role: 'TRAINEE', isPlatformOwner: true },
  },
  {
    name: 'TRAINEE of a customer organization',
    profile: { role: 'TRAINEE', isPlatformOwner: false },
  },
];

async function loadHandler(
  entry: GuardedRoute,
  profile: Record<string, unknown>
) {
  jest.resetModules();
  mockSupabaseAuth({ [TOKEN]: { id: 'session-user' } });
  mockCatalogScope();
  const mock = createTableDb({ profiles: [sessionProfileRow(profile)] });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import(`@/app/api/${entry.route}/route`);
  return {
    handler: mod[entry.method] as (...args: any[]) => Promise<Response>,
    mock,
  };
}

function buildCall(entry: GuardedRoute, token: string | null) {
  const url = entry.route.replace(/\[(\w+)\]/g, 'dummy-$1');
  const request = makeRequest(entry.method, `http://localhost/api/${url}`, {
    token,
    body: {},
  });
  const params = Object.fromEntries(
    entry.params.map(name => [name, `dummy-${name}`])
  );
  return [request, { params: Promise.resolve(params) }] as const;
}

const isCurriculumRefusal = async (res: Response) =>
  res.status === 403 && (await res.clone().json()).error === CURRICULUM_403;

describe('curriculum write rights', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    process.env.RESEND_API_KEY = 're_test_key';
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('knows every curriculum write handler (25), the 20 of the content upload and the read handlers', () => {
    expect(WRITES.length - CONTENT_UPLOAD.length).toBe(25);
    expect(CONTENT_UPLOAD.length).toBe(20);
    expect(READS.length).toBe(READ_ROUTES.length);
  });

  describe.each(WRITES)('$method /api/$route', entry => {
    it('401 without a token, nothing is read', async () => {
      const { handler, mock } = await loadHandler(entry, {});
      const res = await handler(...buildCall(entry, null));
      expect(res.status).toBe(401);
      expect(mock.db.select).not.toHaveBeenCalled();
    });

    it.each(DENIED)('403 for $name, nothing is written', async caller => {
      const { handler, mock } = await loadHandler(entry, caller.profile);
      const res = await handler(...buildCall(entry, TOKEN));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: CURRICULUM_403 });
      // Only the session lookup ran, the handler stopped before any other query
      expect(mock.db.select).toHaveBeenCalledTimes(1);
      expect(mock.db.insert).not.toHaveBeenCalled();
      expect(mock.db.update).not.toHaveBeenCalled();
      expect(mock.db.delete).not.toHaveBeenCalled();
      expect(mock.db.transaction).not.toHaveBeenCalled();
    });

    it.each(ALLOWED)('$name passes the rights check', async caller => {
      const { handler } = await loadHandler(entry, caller.profile);
      const res = await handler(...buildCall(entry, TOKEN));
      expect(res.status).not.toBe(401);
      expect(await isCurriculumRefusal(res)).toBe(false);
    });

    it('does not take the role from the request', async () => {
      // A trainer who sends admin hints in header, query and body stays a trainer
      const { handler } = await loadHandler(entry, {
        role: 'TRAINER',
        isPlatformOwner: true,
      });
      const url = entry.route.replace(/\[(\w+)\]/g, 'dummy-$1');
      const request = makeRequest(
        entry.method,
        `http://localhost/api/${url}?role=SUPER_ADMIN&isPlatformOwner=true`,
        {
          token: TOKEN,
          headers: { 'x-user-role': 'SUPER_ADMIN' },
          body: { role: 'SUPER_ADMIN', isPlatformOwner: true },
        }
      );
      const params = Object.fromEntries(
        entry.params.map(name => [name, `dummy-${name}`])
      );
      const res = await handler(request, { params: Promise.resolve(params) });
      expect(res.status).toBe(403);
    });
  });

  describe.each(READS)(
    '$method /api/$route (read access is unchanged)',
    entry => {
      it.each([
        {
          name: 'TRAINER of the platform organization',
          profile: { role: 'TRAINER', isPlatformOwner: true },
        },
        {
          name: 'TRAINER of a customer organization',
          profile: { role: 'TRAINER', isPlatformOwner: false },
        },
        {
          name: 'TEMP_ADMIN of a customer organization',
          profile: { role: 'TEMP_ADMIN', isPlatformOwner: false },
        },
      ])('a $name may still read', async caller => {
        const { handler } = await loadHandler(entry, caller.profile);
        const res = await handler(...buildCall(entry, TOKEN));
        expect(res.status).not.toBe(401);
        expect(res.status).not.toBe(403);
      });
    }
  );
});

describe('curriculum write handlers use the new check (source scan)', () => {
  // A route file that writes a curriculum table must guard every write handler
  // with requireCurriculumEditor. A new file is found by the scan, so the rule
  // cannot be forgotten. The two document routes hold curriculum documents
  // (no organization, or the platform organization) next to documents of a
  // customer organization, which the trainer of that organization may still
  // change. They apply the rule with the organization of the document
  // (src/lib/auth/document-scope.ts) and are checked by their own scan below.
  const DOCUMENT_ROUTES = [
    'enablers/[enablerId]/documents/route.ts',
    'use-cases/[useCaseId]/documents/route.ts',
  ];
  const tables =
    'courses|courseSkills|skills|enablers|useCases|trainingCatalogLearningFields|' +
    'trainingCatalogContentMappings|contentDocuments|quizzes|enablerQuizzes|' +
    'enablerQuizLinks|questions|options|modules|lessons|subLessons|lernfelder|' +
    'lernfeldMappings|trainingComponents|trainingUseCases|trainingCatalogs|learningFields|lf';
  const writesCurriculum = new RegExp(
    `\\.(insert|update|delete)\\(\\s*(${tables})\\b|createLearningField\\(`
  );
  const base = path.join(process.cwd(), 'src/app/api/trainer');

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name === 'route.ts' ? [full] : [];
    });
  }

  function handlers(source: string) {
    const parts = source.split(/(?=export async function )/);
    return parts.flatMap(part => {
      const m = /^export async function (GET|POST|PUT|PATCH|DELETE)\b/.exec(
        part
      );
      return m ? [{ method: m[1], body: part }] : [];
    });
  }

  const files = walk(base).filter(f => {
    const rel = path.relative(base, f).split(path.sep).join('/');
    return (
      !DOCUMENT_ROUTES.includes(rel) &&
      writesCurriculum.test(fs.readFileSync(f, 'utf8'))
    );
  });

  describe.each(DOCUMENT_ROUTES)(
    '%s applies the curriculum rule by the organization of the document',
    rel => {
      const source = fs.readFileSync(path.join(base, rel), 'utf8');
      const byMethod = Object.fromEntries(
        handlers(source).map(h => [h.method, h.body])
      );

      it('checks canCreateDocument on POST and canDeleteDocument on DELETE', () => {
        expect(byMethod.POST).toContain('canCreateDocument(');
        expect(byMethod.DELETE).toContain('canDeleteDocument(');
      });

      it('refuses a curriculum document with the curriculum message', () => {
        expect(byMethod.POST).toContain('CURRICULUM_WRITE_FORBIDDEN');
      });

      it('limits the list to the organizations of the person', () => {
        expect(byMethod.GET).toContain('documentVisibilityCondition(');
      });

      it('does not use the platform flag of the person', () => {
        expect(source).not.toContain('verifyPlatformOwner');
      });

      it('has no write handler besides POST and DELETE', () => {
        expect(Object.keys(byMethod).sort()).toEqual(['DELETE', 'GET', 'POST']);
      });
    }
  );

  it('finds the curriculum route files', () => {
    expect(files.length).toBeGreaterThanOrEqual(17);
  });

  it.each(
    files.map(f => [path.relative(base, f).split(path.sep).join('/'), f])
  )(
    '%s guards every write handler with requireCurriculumEditor',
    (_rel, file) => {
      const source = fs.readFileSync(file, 'utf8');
      const writeHandlers = handlers(source).filter(h => h.method !== 'GET');
      expect(writeHandlers.length).toBeGreaterThan(0);
      for (const h of writeHandlers) {
        expect(
          `${h.method}: ${h.body.includes('requireCurriculumEditor(')}`
        ).toBe(`${h.method}: true`);
        expect(h.body).not.toContain('verifyPlatformOwner');
        expect(h.body).not.toContain('requireTrainer(');
      }
    }
  );
});
