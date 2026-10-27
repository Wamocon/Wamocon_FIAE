/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';
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
  mockSession,
  type FakeSession,
} from '../../../helpers/mockNext';

// The three routes of the transfer (dry-run, apply, rollback-sql) with the real
// service on the in-memory fakes of the data access: who may call them, that they
// are off in Production, what a bad id, a bad body and a wrong state answer, and the
// whole way from a dry run to an apply. The SQL is tried in transfer-db.test.ts, the
// session layer for all routes in route-guards.test.ts.

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const GOOD_ID = '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11';

const SUPER: FakeSession = fakeSession({
  id: USER,
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
  isAdmin: true,
});
const OTHER_SUPER: FakeSession = fakeSession({
  id: OTHER,
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
  isAdmin: true,
});
const PLATFORM_ADMIN: FakeSession = fakeSession({
  id: OTHER,
  role: 'ADMIN',
  isSuperAdmin: true,
  isAdmin: true,
  isPlatformOwner: true,
});
const TRAINER: FakeSession = fakeSession({ id: 'trainer-1' });

const API = '@/app/api/trainer/content-upload';

async function boot(session: FakeSession | null) {
  jest.resetModules();
  mockSession(session);
  const fx = await import('../../../helpers/uploadServiceFixtures');
  const ctx = fx.setup('public');
  const uploadDeps = jest.fn(() => ctx.deps);
  jest.doMock('@/lib/content-upload/staging/context', () => ({
    __esModule: true,
    uploadDeps,
    getUploadRepo: () => ctx.repo,
    getUploadStorage: () => ctx.storage,
  }));
  // the data access of the transfer: set per test by `use()`
  const transfer: { deps: any; pool: any } = { deps: null, pool: null };
  const transferDeps = jest.fn(() => transfer.deps);
  const poolQueryable = jest.fn(() => transfer.pool);
  jest.doMock('@/lib/content-upload/transfer/context', () => ({
    __esModule: true,
    transferDeps,
    poolQueryable,
  }));
  const route = {
    runs: (await import(`${API}/runs/route`)) as any,
    dry: (await import(`${API}/runs/[runId]/dry-run/route`)) as any,
    apply: (await import(`${API}/runs/[runId]/apply/route`)) as any,
    rollback: (await import(`${API}/runs/[runId]/rollback-sql/route`)) as any,
  };
  return { ctx, fx, route, uploadDeps, transferDeps, poolQueryable, transfer };
}
type Booted = Awaited<ReturnType<typeof boot>>;

const withRun = (runId: string) => ({ params: Promise.resolve({ runId }) });
const json = async (res: Response) => (await res.json()) as any;

function call(
  handler: (...a: any[]) => Promise<Response>,
  method: string,
  runId: string,
  options: { body?: unknown; query?: string } = {}
) {
  const request = makeRequest(
    method,
    `http://localhost/api/x${options.query ?? ''}`,
    { token: 't', body: options.body }
  );
  return handler(request, withRun(runId));
}

async function createRun(b: Booted) {
  const res = await b.route.runs.POST(
    makeRequest('POST', 'http://localhost/api/x', {
      token: 't',
      body: { label: 'Lauf', declarationAccepted: true },
    })
  );
  expect(res.status).toBe(201);
  return (await json(res)).run.id as string;
}

/** The transfer deps on memory fakes for a run of the upload repo. */
async function use(b: Booted, runId: string, files?: any[]) {
  const memory = await import('../../../helpers/memoryTransfer');
  const fixtures = await import('../../../helpers/transferFixtures');
  const list = files ?? (await fixtures.enablerFiles({ tree: true }));
  const h = memory.harness(list, { run: { id: runId } });
  // the people of the sessions are in the database of the engine
  h.db.profiles.push(
    { id: USER, role: 'SUPER_ADMIN' },
    { id: OTHER, role: 'SUPER_ADMIN' }
  );
  b.transfer.deps = h.deps;
  return h;
}

function allHandlers(b: Booted, runId = GOOD_ID) {
  return [
    ['POST dry-run', () => call(b.route.dry.POST, 'POST', runId)],
    [
      'POST apply',
      () =>
        call(b.route.apply.POST, 'POST', runId, { body: { confirm: 'KFBM' } }),
    ],
    ['GET rollback-sql', () => call(b.route.rollback.GET, 'GET', runId)],
  ] as const;
}

const savedEnv = { ...process.env };
beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  delete process.env.VERCEL_ENV;
});
afterEach(() => {
  process.env = { ...savedEnv };
  jest.restoreAllMocks();
});

describe('guards: the session comes first', () => {
  it('answers 401 without a session and 403 for a trainer, before anything else', async () => {
    for (const [session, status] of [
      [null, 401],
      [TRAINER, 403],
    ] as const) {
      const b = await boot(session);
      for (const [name, run] of allHandlers(b)) {
        expect([name, (await run()).status]).toEqual([name, status]);
      }
      expect(b.uploadDeps).not.toHaveBeenCalled();
      expect(b.transferDeps).not.toHaveBeenCalled();
    }
  });

  it('still answers 401 and 403 in Production, the session is checked first', async () => {
    process.env.VERCEL_ENV = 'production';
    for (const [session, status] of [
      [null, 401],
      [TRAINER, 403],
    ] as const) {
      const b = await boot(session);
      for (const [name, run] of allHandlers(b)) {
        expect([name, (await run()).status]).toEqual([name, status]);
      }
    }
  });
});

describe('switched off outside of the Preview and local development', () => {
  it.each(['production', 'PRODUCTION', 'staging', 'something-new'])(
    'answers every route with 404 for VERCEL_ENV=%s, without any data access',
    async value => {
      process.env.VERCEL_ENV = value;
      const b = await boot(SUPER);
      for (const [name, run] of allHandlers(b)) {
        const res = await run();
        expect([name, res.status]).toEqual([name, 404]);
        expect(await json(res)).toEqual({
          error: 'The content upload is not available in this environment.',
        });
      }
      expect(b.uploadDeps).not.toHaveBeenCalled();
      expect(b.transferDeps).not.toHaveBeenCalled();
      expect(b.poolQueryable).not.toHaveBeenCalled();
    }
  );

  it('is off in a production build outside of Vercel and in a preview build on the wrong schema', async () => {
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = 'production';
    const b = await boot(SUPER);
    for (const [, run] of allHandlers(b))
      expect((await run()).status).toBe(404);
    delete env.NODE_ENV;
    env.VERCEL_ENV = 'preview';
    const c = await boot(SUPER);
    for (const [, run] of allHandlers(c))
      expect((await run()).status).toBe(404);
    expect(b.transferDeps).not.toHaveBeenCalled();
    expect(c.transferDeps).not.toHaveBeenCalled();
  });

  it('cannot be switched on by the request', async () => {
    process.env.VERCEL_ENV = 'production';
    const b = await boot(SUPER);
    const request = makeRequest(
      'POST',
      'http://localhost/api/x?VERCEL_ENV=preview&enabled=true',
      {
        token: 't',
        headers: { 'x-vercel-env': 'preview' },
        body: { VERCEL_ENV: 'preview', confirm: 'KFBM' },
      }
    );
    expect((await b.route.apply.POST(request, withRun(GOOD_ID))).status).toBe(
      404
    );
  });

  it('every route sets maxDuration on purpose', async () => {
    const b = await boot(SUPER);
    for (const key of ['dry', 'apply', 'rollback'] as const) {
      expect(b.route[key].maxDuration).toBe(60);
    }
  });
});

describe('who owns the run', () => {
  const routes = (b: Booted) => (id: string) =>
    [
      ['POST dry-run', () => call(b.route.dry.POST, 'POST', id)],
      [
        'POST apply',
        () =>
          call(b.route.apply.POST, 'POST', id, { body: { confirm: 'KFBM' } }),
      ],
      ['GET rollback-sql', () => call(b.route.rollback.GET, 'GET', id)],
    ] as const;

  it('answers 404 for a bad id and for an unknown run, and the same for the run of another person', async () => {
    const b = await boot(PLATFORM_ADMIN);
    await use(b, GOOD_ID);
    const foreign = await b.fx.newRun(
      b.ctx.deps,
      { id: USER, role: 'SUPER_ADMIN' },
      'fremd'
    );
    for (const id of ['{bad}', GOOD_ID, foreign.id]) {
      for (const [name, run] of routes(b)(id)) {
        const res = await run();
        expect([name, res.status, await json(res)]).toEqual([
          name,
          404,
          { error: 'Run not found' },
        ]);
      }
    }
    expect(b.transferDeps).not.toHaveBeenCalled();
    expect((await b.ctx.repo.getRun(foreign.id))?.status).toBe('draft');
  });

  it('lets a SUPER_ADMIN work on the run of another person', async () => {
    const b = await boot(OTHER_SUPER);
    const foreign = await b.fx.newRun(
      b.ctx.deps,
      { id: USER, role: 'ADMIN' },
      'fremd'
    );
    await use(b, foreign.id);
    expect((await call(b.route.dry.POST, 'POST', foreign.id)).status).toBe(200);
  });
});

describe('the dry run and the apply', () => {
  it('runs a dry run (200) and then the apply with the typed catalog code', async () => {
    const b = await boot(SUPER);
    const runId = await createRun(b);
    const h = await use(b, runId);
    const dry = await call(b.route.dry.POST, 'POST', runId);
    expect(dry.status).toBe(200);
    const report = await json(dry);
    expect(report).toMatchObject({
      mode: 'dry_run',
      status: 'ok',
      readyToApply: true,
      wrote: false,
    });
    expect(h.db.totalRows()).toBe(0);
    // no text of a file in the answer
    expect(JSON.stringify(report)).not.toMatch(
      /ZEBRAKANAL|QUOKKA|WOMBAT|OKAPI/
    );

    const apply = await call(b.route.apply.POST, 'POST', runId, {
      body: { confirm: 'KFBM' },
    });
    expect(apply.status).toBe(200);
    expect(await json(apply)).toMatchObject({
      mode: 'apply',
      status: 'ok',
      wrote: true,
    });
    expect(h.db.count('enablers')).toBe(1);
    // the caller is the author of the rows and the one who applied
    expect(h.store.attempts.at(-1)?.startedById).toBe(USER);
  });

  it('takes the switches of the body into the call', async () => {
    const b = await boot(SUPER);
    const runId = await createRun(b);
    const h = await use(b, runId);
    const res = await call(b.route.dry.POST, 'POST', runId, {
      body: { updateExisting: true },
    });
    expect((await json(res)).updateExisting).toBe(true);
    expect(h.store.attempts[0].updateExisting).toBe(true);
  });

  it('answers 400 for a body that is wrong and does nothing', async () => {
    const b = await boot(SUPER);
    const runId = await createRun(b);
    const h = await use(b, runId);
    for (const body of [
      { updateExisting: 'yes' },
      { publishOriginals: 'a' },
      { publishOriginals: ['nope'] },
      [],
      'x',
    ]) {
      const res = await call(b.route.dry.POST, 'POST', runId, { body });
      expect([JSON.stringify(body), res.status]).toEqual([
        JSON.stringify(body),
        400,
      ]);
      expect((await json(res)).code).toBe('BODY_INVALID');
    }
    expect(h.timeline.events).toEqual([]);
    // the apply has no optional body
    const noBody = await b.route.apply.POST(
      {
        ...makeRequest('POST', 'http://localhost/api/x', { token: 't' }),
        json: async () => {
          throw new Error('no body');
        },
      },
      withRun(runId)
    );
    expect(noBody.status).toBe(400);
    expect((await json(noBody)).code).toBe('BODY_INVALID');
  });

  it('answers a dry run without a body, with a body that is not JSON too', async () => {
    const b = await boot(SUPER);
    const runId = await createRun(b);
    await use(b, runId);
    const res = await b.route.dry.POST(
      {
        ...makeRequest('POST', 'http://localhost/api/x', { token: 't' }),
        json: async () => {
          throw new Error('not json');
        },
      },
      withRun(runId)
    );
    expect(res.status).toBe(200);
  });

  it('answers 400 without the catalog code and 409 without a dry run, and writes nothing', async () => {
    const b = await boot(SUPER);
    const runId = await createRun(b);
    const h = await use(b, runId);
    const none = await call(b.route.apply.POST, 'POST', runId, { body: {} });
    expect([none.status, (await json(none)).code]).toEqual([
      400,
      'CONFIRM_REQUIRED',
    ]);
    const early = await call(b.route.apply.POST, 'POST', runId, {
      body: { confirm: 'KFBM' },
    });
    expect([early.status, (await json(early)).code]).toEqual([
      409,
      'DRY_RUN_REQUIRED',
    ]);
    expect(h.db.totalRows()).toBe(0);
  });

  it('answers 409 with the report when the apply meets conflicts', async () => {
    const b = await boot(SUPER);
    const runId = await createRun(b);
    const h = await use(b, runId);
    await call(b.route.dry.POST, 'POST', runId);
    const { ImportAbort } = await import('@/lib/content-import/apply/db');
    h.deps.makeDb = () => {
      throw new ImportAbort('CONFLICTS', 'x', [
        { table: 'quizzes', key: 'K4-a-low', reason: 'another number' },
      ]);
    };
    const res = await call(b.route.apply.POST, 'POST', runId, {
      body: { confirm: 'KFBM' },
    });
    expect(res.status).toBe(409);
    expect(await json(res)).toMatchObject({
      status: 'conflict',
      wrote: false,
      conflicts: [{ table: 'quizzes' }],
    });
  });

  it('answers with the status and the code of the service for a run in another state', async () => {
    const b = await boot(SUPER);
    const runId = await createRun(b);
    const h = await use(b, runId);
    h.store.state = { ...h.store.state, status: 'processing' };
    const res = await call(b.route.dry.POST, 'POST', runId);
    expect([res.status, (await json(res)).code]).toEqual([409, 'RUN_STATE']);
  });

  it('limits how often a person can start a transfer', async () => {
    const b = await boot(SUPER);
    const runId = await createRun(b);
    await use(b, runId);
    const statuses: number[] = [];
    for (let i = 0; i < 12; i += 1) {
      statuses.push((await call(b.route.dry.POST, 'POST', runId)).status);
    }
    expect(statuses.slice(0, 10).every(s => s !== 429)).toBe(true);
    expect(statuses.slice(10)).toEqual([429, 429]);
    // the apply counts in the same window
    const res = await call(b.route.apply.POST, 'POST', runId, {
      body: { confirm: 'KFBM' },
    });
    expect(res.status).toBe(429);
    expect(res.headers.get('Retry-After')).toBeTruthy();
  });

  it('answers 503 busy for a lock timeout of the database and 500 without detail for the rest', async () => {
    const b = await boot(SUPER);
    const runId = await createRun(b);
    const h = await use(b, runId);
    h.store.getRunState = async () => {
      throw Object.assign(new Error('lock timeout on secret_table'), {
        code: '55P03',
      });
    };
    const busy = await call(b.route.dry.POST, 'POST', runId);
    expect(busy.status).toBe(503);
    for (const code of ['40001', '40P01', 'CONNECTION_RESERVE_TIMEOUT']) {
      h.store.getRunState = async () => {
        throw Object.assign(new Error('x'), { code });
      };
      expect([
        code,
        (await call(b.route.dry.POST, 'POST', runId)).status,
      ]).toEqual([code, 503]);
    }
    h.store.getRunState = async () => {
      throw new Error('select * from secret_table failed');
    };
    const broken = await call(b.route.dry.POST, 'POST', runId);
    expect(broken.status).toBe(500);
    expect(JSON.stringify(await json(broken))).not.toContain('secret_table');
  });
});

describe('the rollback text', () => {
  async function withRollback(answer: unknown) {
    const b = await boot(SUPER);
    const runId = await createRun(b);
    jest.doMock('@/lib/content-upload/transfer/rollback', () => {
      const actual = jest.requireActual(
        '@/lib/content-upload/transfer/rollback'
      ) as any;
      return {
        ...actual,
        rollbackAnswer: jest.fn(async () => {
          if (answer === 'protocol-error') {
            throw new actual.RollbackSqlError('row 7 of options has a bad id');
          }
          return answer;
        }),
      };
    });
    jest.resetModules();
    const again = await boot(SUPER);
    const id = await createRun(again);
    return { b: again, runId: id };
  }

  it('hands out what the service made, and only reads', async () => {
    const { b, runId } = await withRollback({
      applyId: GOOD_ID,
      sql: 'begin;',
      blockers: [],
    });
    const res = await call(b.route.rollback.GET, 'GET', runId);
    expect(res.status).toBe(200);
    expect(await json(res)).toMatchObject({ applyId: GOOD_ID, sql: 'begin;' });
    expect(b.transferDeps).not.toHaveBeenCalled();
    expect(b.poolQueryable).toHaveBeenCalled();
  });

  it('answers 404 without an apply and 409 for a protocol that cannot be turned into SQL', async () => {
    const none = await withRollback(null);
    const res = await call(none.b.route.rollback.GET, 'GET', none.runId);
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe('NO_APPLY');

    const bad = await withRollback('protocol-error');
    const res2 = await call(bad.b.route.rollback.GET, 'GET', bad.runId);
    expect(res2.status).toBe(409);
    const body2 = await json(res2);
    expect(body2.code).toBe('PROTOCOL_INVALID');
    expect(JSON.stringify(body2)).not.toContain('row 7');
  });

  it('answers 400 for an apply id that is none', async () => {
    const { b, runId } = await withRollback(null);
    const res = await call(b.route.rollback.GET, 'GET', runId, {
      query: '?applyId=nope',
    });
    expect([res.status, (await json(res)).code]).toEqual([
      400,
      'APPLY_INVALID',
    ]);
  });

  it('passes a valid apply id on, in lower case', async () => {
    const b = await boot(SUPER);
    const runId = await createRun(b);
    const calls: any[] = [];
    jest.doMock('@/lib/content-upload/transfer/rollback', () => {
      const actual = jest.requireActual(
        '@/lib/content-upload/transfer/rollback'
      ) as any;
      return {
        ...actual,
        rollbackAnswer: jest.fn(async (...args: any[]) => {
          calls.push(args);
          return { applyId: args[1].applyId, sql: null, blockers: [] };
        }),
      };
    });
    jest.resetModules();
    const c = await boot(SUPER);
    const id = await createRun(c);
    const res = await call(c.route.rollback.GET, 'GET', id, {
      query: `?applyId=${GOOD_ID.toUpperCase()}`,
    });
    expect(res.status).toBe(200);
    expect(calls[0][1]).toEqual({ runId: id, applyId: GOOD_ID });
    expect(runId).toBeTruthy();
  });
});

describe('the sources of the routes', () => {
  const base = path.join(
    process.cwd(),
    'src/app/api/trainer/content-upload/runs/[runId]'
  );
  const files = ['dry-run', 'apply', 'rollback-sql'].map(name =>
    path.join(base, name, 'route.ts')
  );

  it.each(files.map(f => [path.basename(path.dirname(f)), f]))(
    '%s uses only the curriculum guard and checks the switch right after it',
    (_name, file) => {
      const source = fs.readFileSync(file, 'utf8');
      expect(source).toContain('await requireCurriculumEditor(request)');
      expect(source.indexOf('requireCurriculumEditor(request)')).toBeLessThan(
        source.indexOf('contentUploadDisabledResponse()')
      );
      expect(source.indexOf('if (off) return off;')).toBeLessThan(
        source.indexOf('await params')
      );
      expect(source).toMatch(/export const maxDuration = \d+;/);
      for (const forbidden of [
        'requireTrainer(',
        'requireUser(',
        'auth.admin',
        'process.env',
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  );

  it('only the apply route can write, and only the dry run and the apply start a transfer', () => {
    const [dry, apply, rollback] = files.map(f => fs.readFileSync(f, 'utf8'));
    expect(dry).toContain("mode: 'dry_run'");
    expect(apply).toContain("mode: 'apply'");
    expect(rollback).not.toContain('runTransfer');
    expect(rollback).not.toContain('transferDeps');
    expect(rollback).toContain('export async function GET');
    expect(rollback).not.toMatch(
      /export async function (POST|PUT|PATCH|DELETE)/
    );
  });
});
