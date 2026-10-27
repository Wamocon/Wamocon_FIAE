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

// The routes of the content upload (src/app/api/trainer/content-upload) on the
// in-memory repository and storage. The real session layer is tested for all of
// them in route-guards.test.ts (401, 403); here the guards are tried again with
// the fake session, together with the rest: the switch for Production, who owns
// a run, bad ids and bodies, the limits and the whole flow from the run to the
// verified file.

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const GOOD_ID = '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11';

const SUPER: FakeSession = fakeSession({
  id: USER,
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
  isAdmin: true,
});
// An ADMIN of the platform organization passes the curriculum guard (isSuperAdmin)
// but is not a SUPER_ADMIN by role
const PLATFORM_ADMIN: FakeSession = fakeSession({
  id: OTHER,
  role: 'ADMIN',
  isSuperAdmin: true,
  isAdmin: true,
  isPlatformOwner: true,
});
const OTHER_SUPER: FakeSession = fakeSession({
  id: OTHER,
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
  isAdmin: true,
});
const TRAINER: FakeSession = fakeSession({ id: 'trainer-1' });

const API = '@/app/api/trainer/content-upload';

type Handler = (...args: any[]) => Promise<Response>;

async function boot(
  session: FakeSession | null,
  options: { schema?: 'public' | 'public_preview' } = {}
) {
  jest.resetModules();
  mockSession(session);
  const schema = options.schema ?? 'public';
  if (schema === 'public_preview') {
    jest.doMock('@/lib/db-schema', () => {
      const actual = jest.requireActual('@/lib/db-schema') as any;
      return {
        ...actual,
        IS_PREVIEW_SCHEMA: true,
        DB_SCHEMA: 'public_preview',
      };
    });
  }
  const fx = await import('../../../helpers/uploadServiceFixtures');
  const ctx = fx.setup(schema);
  const uploadDeps = jest.fn(() => ctx.deps);
  // the pump route and the routes of the review list run on the review repository too
  const reviewDeps = jest.fn(() => ({ ...uploadDeps(), review: ctx.review }));
  jest.doMock('@/lib/content-upload/review/context', () => ({
    __esModule: true,
    reviewDeps,
    getReviewRepo: () => ctx.review,
  }));
  jest.doMock('@/lib/content-upload/staging/context', () => ({
    __esModule: true,
    uploadDeps,
    getUploadRepo: () => ctx.repo,
    getUploadStorage: () => ctx.storage,
  }));
  const route = {
    runs: (await import(`${API}/runs/route`)) as any,
    run: (await import(`${API}/runs/[runId]/route`)) as any,
    discard: (await import(`${API}/runs/[runId]/discard/route`)) as any,
    files: (await import(`${API}/runs/[runId]/files/route`)) as any,
    urls: (await import(`${API}/runs/[runId]/upload-urls/route`)) as any,
    complete: (await import(`${API}/runs/[runId]/complete/route`)) as any,
    pump: (await import(`${API}/runs/[runId]/pump/route`)) as any,
    cleanup: (await import(`${API}/cleanup/route`)) as any,
    overview: (await import(`${API}/overview/route`)) as any,
    review: (await import(`${API}/runs/[runId]/review/route`)) as any,
    options: (await import(`${API}/runs/[runId]/review/options/route`)) as any,
    duplicates: (await import(`${API}/runs/[runId]/review/duplicates/route`)) as any,
    decisions: (await import(`${API}/runs/[runId]/decisions/route`)) as any,
    reopen: (await import(`${API}/runs/[runId]/reopen/route`)) as any,
  };
  return { ctx, fx, route, uploadDeps, reviewDeps };
}

type Booted = Awaited<ReturnType<typeof boot>>;

function req(method: string, url: string, body?: unknown) {
  return makeRequest(method, `http://localhost${url}`, { token: 't', body });
}

function withRun(runId: string) {
  return { params: Promise.resolve({ runId }) };
}

async function json(res: Response) {
  return (await res.json()) as any;
}

/** Calls a handler; for a run route with the id of the run. */
async function call(
  handler: Handler,
  method: string,
  url: string,
  options: { body?: unknown; runId?: string } = {}
) {
  const request = req(method, url, options.body);
  return options.runId === undefined
    ? handler(request)
    : handler(request, withRun(options.runId));
}

async function createRunVia(b: Booted, label = 'Lauf 1') {
  const res = await call(b.route.runs.POST, 'POST', '/api/x', {
    body: { label, declarationAccepted: true },
  });
  expect(res.status).toBe(201);
  return (await json(res)).run as { id: string; status: string };
}

/** The 11 handlers, with how to call each one. */
function allHandlers(b: Booted, runId = GOOD_ID) {
  return [
    ['GET runs', () => call(b.route.runs.GET, 'GET', '/api/x')],
    [
      'POST runs',
      () =>
        call(b.route.runs.POST, 'POST', '/api/x', {
          body: { label: 'x', declarationAccepted: true },
        }),
    ],
    ['GET run', () => call(b.route.run.GET, 'GET', '/api/x', { runId })],
    [
      'POST discard',
      () => call(b.route.discard.POST, 'POST', '/api/x', { runId }),
    ],
    ['GET files', () => call(b.route.files.GET, 'GET', '/api/x', { runId })],
    [
      'POST files',
      () =>
        call(b.route.files.POST, 'POST', '/api/x', {
          runId,
          body: { files: [] },
        }),
    ],
    [
      'POST upload-urls',
      () =>
        call(b.route.urls.POST, 'POST', '/api/x', {
          runId,
          body: { fileIds: [GOOD_ID] },
        }),
    ],
    [
      'POST complete',
      () =>
        call(b.route.complete.POST, 'POST', '/api/x', {
          runId,
          body: { fileIds: [GOOD_ID] },
        }),
    ],
    ['POST pump', () => call(b.route.pump.POST, 'POST', '/api/x', { runId })],
    ['GET cleanup', () => call(b.route.cleanup.GET, 'GET', '/api/x')],
    [
      'POST cleanup',
      () => call(b.route.cleanup.POST, 'POST', '/api/x', { body: {} }),
    ],
    ['GET overview', () => call(b.route.overview.GET, 'GET', '/api/x')],
    ['GET review', () => call(b.route.review.GET, 'GET', '/api/x', { runId })],
    [
      'GET review options',
      () => call(b.route.options.GET, 'GET', '/api/x', { runId }),
    ],
    [
      'GET review duplicates',
      () => call(b.route.duplicates.GET, 'GET', '/api/x', { runId }),
    ],
    [
      'POST reopen',
      () => call(b.route.reopen.POST, 'POST', '/api/x', { runId, body: {} }),
    ],
    [
      'POST decisions',
      () =>
        call(b.route.decisions.POST, 'POST', '/api/x', {
          runId,
          body: { expectedVersion: 0, command: 'accept_high' },
        }),
    ],
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
  jest.dontMock('@/lib/db-schema');
});

describe('guards: the session comes first', () => {
  it('answers 401 without a session and 403 for a trainer, before anything else happens', async () => {
    for (const [session, status] of [
      [null, 401],
      [TRAINER, 403],
    ] as const) {
      const b = await boot(session);
      for (const [name, run] of allHandlers(b)) {
        const res = await run();
        expect([name, res.status]).toEqual([name, status]);
      }
      // not even the data access was set up
      expect(b.uploadDeps).not.toHaveBeenCalled();
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

describe('switched off in Production', () => {
  it.each(['production', 'PRODUCTION', 'staging', 'something-new'])(
    'answers every route with 404 and a clear message for VERCEL_ENV=%s, without touching data',
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
      expect(b.ctx.repo.runs.size).toBe(0);
      expect(b.ctx.mem.signed).toEqual([]);
    }
  );

  it('is off in a production build outside of Vercel too', async () => {
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = 'production';
    const b = await boot(SUPER);
    for (const [name, run] of allHandlers(b)) {
      expect([name, (await run()).status]).toEqual([name, 404]);
    }
    expect(b.uploadDeps).not.toHaveBeenCalled();
  });

  it('is off in a preview build that is not on the preview schema', async () => {
    process.env.VERCEL_ENV = 'preview';
    const b = await boot(SUPER);
    for (const [name, run] of allHandlers(b)) {
      expect([name, (await run()).status]).toEqual([name, 404]);
    }
    expect(b.uploadDeps).not.toHaveBeenCalled();
  });

  it('cannot be switched on by the request: no header, query or body turns it on', async () => {
    process.env.VERCEL_ENV = 'production';
    const b = await boot(SUPER);
    const request = makeRequest(
      'POST',
      'http://localhost/api/x?enabled=true&VERCEL_ENV=preview',
      {
        token: 't',
        headers: {
          'x-vercel-env': 'preview',
          'x-forwarded-host': 'preview.example',
        },
        body: { VERCEL_ENV: 'preview', label: 'x', declarationAccepted: true },
      }
    );
    expect((await b.route.runs.POST(request)).status).toBe(404);
  });

  it('is on in a preview build on the preview schema, with the preview prefix in every path', async () => {
    process.env.VERCEL_ENV = 'preview';
    const b = await boot(SUPER, { schema: 'public_preview' });
    const run = await createRunVia(b);
    const bytes = b.fx.pdfBytes('x');
    const res = await call(b.route.files.POST, 'POST', '/api/x', {
      runId: run.id,
      body: { files: [b.fx.entryFor('a/x.pdf', bytes)] },
    });
    expect(res.status).toBe(200);
    const [row] = await b.ctx.repo.listFiles(run.id, { offset: 0, limit: 5 });
    expect(row.storagePath).toBe(`preview/upload/${run.id}/${row.id}.pdf`);
    const run2 = (await b.ctx.repo.getRun(run.id))!;
    expect(run2.storagePrefix).toBe(`preview/upload/${run.id}/`);
  });
});

describe('runs: create, list, read, discard', () => {
  it('creates a run (201) without a storage prefix in the answer', async () => {
    const b = await boot(SUPER);
    const res = await call(b.route.runs.POST, 'POST', '/api/x', {
      body: { label: '  KfBM  ', declarationAccepted: true, kiEnabled: false },
    });
    expect(res.status).toBe(201);
    const body = await json(res);
    expect(body.run).toMatchObject({
      catalog: 'KFBM',
      label: 'KfBM',
      status: 'draft',
      kiEnabled: false,
      createdById: USER,
    });
    expect(JSON.stringify(body)).not.toContain('upload/');
  });

  it.each([
    [{ label: 'x' }, 'DECLARATION_REQUIRED'],
    [{ label: '', declarationAccepted: true }, 'LABEL_INVALID'],
    [
      { label: 'x', declarationAccepted: true, catalog: 'FIAE' },
      'CATALOG_UNSUPPORTED',
    ],
  ])('answers 400 for the body %j', async (body, code) => {
    const b = await boot(SUPER);
    const res = await call(b.route.runs.POST, 'POST', '/api/x', { body });
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe(code);
  });

  it('answers 400 for a body that is not JSON', async () => {
    const b = await boot(SUPER);
    const request = req('POST', '/api/x');
    request.json = async () => {
      throw new SyntaxError('Unexpected token');
    };
    const res = await b.route.runs.POST(request);
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('BODY_INVALID');
  });

  it('answers 404 when the catalog does not exist in this environment', async () => {
    const b = await boot(SUPER);
    b.ctx.repo.catalogs.clear();
    const res = await call(b.route.runs.POST, 'POST', '/api/x', {
      body: { label: 'x', declarationAccepted: true },
    });
    expect(res.status).toBe(404);
    expect((await json(res)).code).toBe('CATALOG_MISSING');
  });

  it('answers 429 for the fourth active run', async () => {
    const b = await boot(SUPER);
    for (let i = 0; i < 3; i++) await createRunVia(b, `Lauf ${i}`);
    const res = await call(b.route.runs.POST, 'POST', '/api/x', {
      body: { label: 'vier', declarationAccepted: true },
    });
    expect(res.status).toBe(429);
    expect((await json(res)).code).toBe('TOO_MANY_ACTIVE_RUNS');
  });

  it('reads a run with the counters per state and the limits', async () => {
    const b = await boot(SUPER);
    const run = await createRunVia(b);
    const res = await call(b.route.run.GET, 'GET', '/api/x', { runId: run.id });
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body.run.id).toBe(run.id);
    expect(body.progress).toEqual({ counts: {}, totalFiles: 0, totalBytes: 0 });
    expect(body.limits.maxFilesPerRequest).toBe(50);
  });

  it('lists the own runs and a SUPER_ADMIN lists all of them', async () => {
    const b = await boot(SUPER);
    await createRunVia(b, 'meins');
    const foreign = await b.fx.newRun(
      b.ctx.deps,
      { id: OTHER, role: 'ADMIN' },
      'fremd'
    );
    const all = await json(await call(b.route.runs.GET, 'GET', '/api/x'));
    expect(all.runs.map((r: any) => r.label).sort()).toEqual([
      'fremd',
      'meins',
    ]);

    const p = await boot(PLATFORM_ADMIN);
    await createRunVia(p, 'eigener');
    await p.fx.newRun(
      p.ctx.deps,
      { id: USER, role: 'SUPER_ADMIN' },
      'des Superadmins'
    );
    const own = await json(await call(p.route.runs.GET, 'GET', '/api/x'));
    expect(own.runs.map((r: any) => r.label)).toEqual(['eigener']);
    expect(foreign.id).toBeTruthy();
  });

  it('discards a run, twice without harm, and not while it is applying', async () => {
    const b = await boot(SUPER);
    const run = await createRunVia(b);
    const first = await call(b.route.discard.POST, 'POST', '/api/x', {
      runId: run.id,
    });
    expect(first.status).toBe(200);
    expect((await json(first)).run.status).toBe('discarded');
    const second = await call(b.route.discard.POST, 'POST', '/api/x', {
      runId: run.id,
    });
    expect(second.status).toBe(200);

    const other = await createRunVia(b, 'zwei');
    b.ctx.repo.forceRunStatus(other.id, 'applying');
    const blocked = await call(b.route.discard.POST, 'POST', '/api/x', {
      runId: other.id,
    });
    expect(blocked.status).toBe(409);
  });
});

describe('who sees a run', () => {
  const runRoutes = (b: Booted) =>
    [
      [
        'GET run',
        (id: string) => call(b.route.run.GET, 'GET', '/api/x', { runId: id }),
      ],
      [
        'POST discard',
        (id: string) =>
          call(b.route.discard.POST, 'POST', '/api/x', { runId: id }),
      ],
      [
        'GET files',
        (id: string) => call(b.route.files.GET, 'GET', '/api/x', { runId: id }),
      ],
      [
        'POST files',
        (id: string) =>
          call(b.route.files.POST, 'POST', '/api/x', {
            runId: id,
            body: { files: [] },
          }),
      ],
      [
        'POST upload-urls',
        (id: string) =>
          call(b.route.urls.POST, 'POST', '/api/x', {
            runId: id,
            body: { fileIds: [GOOD_ID] },
          }),
      ],
      [
        'POST complete',
        (id: string) =>
          call(b.route.complete.POST, 'POST', '/api/x', {
            runId: id,
            body: { fileIds: [GOOD_ID] },
          }),
      ],
      [
        'POST pump',
        (id: string) =>
          call(b.route.pump.POST, 'POST', '/api/x', { runId: id }),
      ],
    ] as const;

  it('answers 404 for the run of another person on every route, and does not touch it', async () => {
    const b = await boot(PLATFORM_ADMIN);
    const foreign = await b.fx.newRun(
      b.ctx.deps,
      { id: USER, role: 'SUPER_ADMIN' },
      'fremd'
    );
    for (const [name, run] of runRoutes(b)) {
      const res = await run(foreign.id);
      expect([name, res.status]).toEqual([name, 404]);
      expect(await json(res)).toEqual({ error: 'Run not found' });
    }
    expect((await b.ctx.repo.getRun(foreign.id))?.status).toBe('draft');
    expect(b.ctx.mem.signed).toEqual([]);
  });

  it('answers the same 404 for an unknown run as for a foreign one', async () => {
    const b = await boot(PLATFORM_ADMIN);
    for (const [name, run] of runRoutes(b)) {
      const res = await run(GOOD_ID);
      expect([name, res.status, await json(res)]).toEqual([
        name,
        404,
        { error: 'Run not found' },
      ]);
    }
  });

  it('lets a SUPER_ADMIN work on the run of another person', async () => {
    const b = await boot(OTHER_SUPER);
    const foreign = await b.fx.newRun(
      b.ctx.deps,
      { id: USER, role: 'ADMIN' },
      'fremd'
    );
    const res = await call(b.route.run.GET, 'GET', '/api/x', {
      runId: foreign.id,
    });
    expect(res.status).toBe(200);
    const discard = await call(b.route.discard.POST, 'POST', '/api/x', {
      runId: foreign.id,
    });
    expect(discard.status).toBe(200);
  });

  it.each([
    'not-an-id',
    "x'; drop table content_upload_runs; --",
    '../../etc',
    '123',
  ])(
    'answers 404 for the path id %j without asking the data access',
    async bad => {
      const b = await boot(SUPER);
      for (const [name, run] of runRoutes(b)) {
        const res = await run(bad);
        expect([name, res.status]).toEqual([name, 404]);
        expect(JSON.stringify(await json(res))).not.toContain('drop table');
      }
    }
  );
});

describe('the whole flow: run, announce, upload, report, process', () => {
  it('takes files from the announcement to the end of the queue, and leaks no path on the way', async () => {
    const b = await boot(SUPER);
    const { pdfBytes, docxBytes, entryFor } = b.fx;
    const run = await createRunVia(b);

    const good = pdfBytes('lehrtext');
    const doc = docxBytes('quiz');
    const same = pdfBytes('lehrtext');
    const announce = await call(b.route.files.POST, 'POST', '/api/x', {
      runId: run.id,
      body: {
        files: [
          entryFor('K1/Enabler/a.pdf', good),
          entryFor('K1/Quiz/b.docx', doc),
          entryFor('Kopie/a.pdf', same),
          entryFor('K1/Tabelle.csv', good),
        ],
      },
    });
    expect(announce.status).toBe(200);
    const announced = await json(announce);
    expect(announced.counts).toEqual({
      announced: 2,
      merged: 1,
      existing: 0,
      rejected: 1,
    });
    expect(announced.results.map((r: any) => r.status)).toEqual([
      'announced',
      'announced',
      'merged',
      'rejected',
    ]);
    expect(announced.results[3].code).toBe('UNSUPPORTED_EXTENSION');
    expect(JSON.stringify(announced)).not.toContain('upload/');

    const [idA, idB] = [
      announced.results[0].fileId,
      announced.results[1].fileId,
    ];
    const urlsRes = await call(b.route.urls.POST, 'POST', '/api/x', {
      runId: run.id,
      body: { fileIds: [idA, idB] },
    });
    expect(urlsRes.status).toBe(200);
    const urls = await json(urlsRes);
    expect(urls.items.every((i: any) => i.ok)).toBe(true);
    expect(urls.items[0].path).toMatch(
      new RegExp(`^upload/${run.id}/${idA}\\.pdf$`)
    );
    expect(b.ctx.mem.signed.every(s => s.upsert === false)).toBe(true);

    // the browser uploads straight into the bucket
    b.ctx.mem.put(urls.items[0].path, good);
    b.ctx.mem.put(urls.items[1].path, doc);

    const completeRes = await call(b.route.complete.POST, 'POST', '/api/x', {
      runId: run.id,
      body: { fileIds: [idA, idB] },
    });
    expect(completeRes.status).toBe(200);
    const complete = await json(completeRes);
    expect(complete.results).toEqual([
      { fileId: idA, status: 'uploaded' },
      { fileId: idB, status: 'uploaded' },
    ]);

    const pumpRes = await call(b.route.pump.POST, 'POST', '/api/x', {
      runId: run.id,
      body: { closeUpload: true },
    });
    expect(pumpRes.status).toBe(200);
    const pumped = await json(pumpRes);
    // two steps per file: the check of the upload, then the reading. The bytes of
    // this test are no real documents, so the reading ends them as failed or
    // rejected (the review of a readable run is tried in content-upload-review)
    expect(pumped).toMatchObject({
      processed: 4,
      advanced: 2,
      done: true,
      runStatus: 'review',
    });
    expect(pumped.failed + pumped.rejected).toBe(2);

    const progress = await json(
      await call(b.route.run.GET, 'GET', '/api/x', { runId: run.id })
    );
    expect(progress.run.status).toBe('review');
    const counts = progress.progress.counts;
    expect(counts.merged).toBe(1);
    expect((counts.failed ?? 0) + (counts.rejected ?? 0)).toBe(2);
    expect(counts.verified).toBeUndefined();

    const listed = await json(
      await call(b.route.files.GET, 'GET', '/api/x?limit=10', { runId: run.id })
    );
    const statuses = listed.files.map((f: any) => f.status).sort();
    expect(statuses).toHaveLength(3);
    expect(statuses).toContain('merged');
    expect(
      statuses.filter((s: string) => s === 'failed' || s === 'rejected')
    ).toHaveLength(2);
    for (const answer of [announced, complete, pumped, progress, listed]) {
      const text = JSON.stringify(answer);
      expect(text).not.toContain('upload/');
      expect(text).not.toContain('claimId');
    }
  });

  it('resumes: the list of the run says what is still missing', async () => {
    const b = await boot(SUPER);
    const run = await createRunVia(b);
    const files = [1, 2, 3].map(i =>
      b.fx.entryFor(`d/f${i}.pdf`, b.fx.pdfBytes(`n${i}`))
    );
    const first = await json(
      await call(b.route.files.POST, 'POST', '/api/x', {
        runId: run.id,
        body: { files },
      })
    );
    // the page is reloaded and the browser announces the same files again
    const again = await json(
      await call(b.route.files.POST, 'POST', '/api/x', {
        runId: run.id,
        body: { files },
      })
    );
    expect(again.counts).toEqual({
      announced: 0,
      merged: 0,
      existing: 3,
      rejected: 0,
    });
    expect(again.results.map((r: any) => r.fileId)).toEqual(
      first.results.map((r: any) => r.fileId)
    );
    expect(again.results.every((r: any) => r.fileStatus === 'announced')).toBe(
      true
    );
  });
});

describe('bodies and limits', () => {
  it('answers 400 for more than 50 files, an empty list and a bad id list', async () => {
    const b = await boot(SUPER);
    const run = await createRunVia(b);
    const many = Array.from({ length: 51 }, (_, i) =>
      b.fx.entryFor(`d/f${i}.pdf`, b.fx.pdfBytes(`n${i}`))
    );
    for (const [handler, body] of [
      [b.route.files.POST, { files: many }],
      [b.route.files.POST, { files: [] }],
      [b.route.files.POST, null],
      [b.route.urls.POST, { fileIds: ['x'] }],
      [
        b.route.urls.POST,
        { fileIds: Array.from({ length: 51 }, () => GOOD_ID) },
      ],
      [b.route.complete.POST, {}],
    ] as const) {
      const res = await call(handler, 'POST', '/api/x', {
        runId: run.id,
        body,
      });
      expect(res.status).toBe(400);
    }
  });

  it('reports a file over the limits and goes on', async () => {
    const b = await boot(SUPER);
    const run = await createRunVia(b);
    const res = await call(b.route.files.POST, 'POST', '/api/x', {
      runId: run.id,
      body: {
        files: [
          {
            path: 'a/big.pdf',
            size: 25 * 1024 * 1024 + 1,
            sha256: 'a'.repeat(64),
          },
          b.fx.entryFor('a/ok.pdf', b.fx.pdfBytes('ok')),
        ],
      },
    });
    const body = await json(res);
    expect(body.results.map((r: any) => [r.status, r.code])).toEqual([
      ['rejected', 'TOO_LARGE'],
      ['announced', undefined],
    ]);
  });

  it('answers 429 with Retry-After when signed urls are asked for too often', async () => {
    const b = await boot(SUPER);
    const run = await createRunVia(b);
    const files = await json(
      await call(b.route.files.POST, 'POST', '/api/x', {
        runId: run.id,
        body: { files: [b.fx.entryFor('a/x.pdf', b.fx.pdfBytes('x'))] },
      })
    );
    const id = files.results[0].fileId;
    let last: Response | undefined;
    for (let i = 0; i < 61; i++) {
      last = await call(b.route.urls.POST, 'POST', '/api/x', {
        runId: run.id,
        body: { fileIds: [id] },
      });
    }
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
    expect((await json(last!)).code).toBe('RATE_LIMITED');
    expect(b.ctx.mem.signed).toHaveLength(60);
  });

  it('refuses to announce, sign and report in a run that is discarded (409)', async () => {
    const b = await boot(SUPER);
    const run = await createRunVia(b);
    await call(b.route.discard.POST, 'POST', '/api/x', { runId: run.id });
    for (const [handler, body] of [
      [
        b.route.files.POST,
        { files: [b.fx.entryFor('a/x.pdf', b.fx.pdfBytes('x'))] },
      ],
      [b.route.urls.POST, { fileIds: [GOOD_ID] }],
      [b.route.complete.POST, { fileIds: [GOOD_ID] }],
    ] as const) {
      const res = await call(handler, 'POST', '/api/x', {
        runId: run.id,
        body,
      });
      expect(res.status).toBe(409);
    }
    expect(b.ctx.mem.signed).toEqual([]);
  });

  it('rejects a file with the wrong magic bytes and deletes the object', async () => {
    const b = await boot(SUPER);
    const run = await createRunVia(b);
    const pdf = b.fx.pdfBytes('same size.');
    const imposter = b.fx.docxBytes('same size.');
    expect(pdf.length).not.toBe(imposter.length - 1);
    const announced = await json(
      await call(b.route.files.POST, 'POST', '/api/x', {
        runId: run.id,
        body: { files: [b.fx.entryFor('a/x.pdf', imposter)] },
      })
    );
    const id = announced.results[0].fileId;
    const [row] = await b.ctx.repo.getFiles(run.id, [id]);
    b.ctx.mem.put(row.storagePath, imposter);
    const res = await json(
      await call(b.route.complete.POST, 'POST', '/api/x', {
        runId: run.id,
        body: { fileIds: [id] },
      })
    );
    expect(res.results).toEqual([
      { fileId: id, status: 'rejected', code: 'NOT_A_PDF' },
    ]);
    expect(b.ctx.mem.objects.has(row.storagePath)).toBe(false);
  });
});

describe('pump route', () => {
  it('needs no body, and refuses a run that is not being processed', async () => {
    const b = await boot(SUPER);
    const run = await createRunVia(b);
    // a draft run has nothing to process
    const draft = await call(b.route.pump.POST, 'POST', '/api/x', {
      runId: run.id,
    });
    expect(draft.status).toBe(409);
    expect((await json(draft)).code).toBe('RUN_STATE');

    await b.fx.newRun(b.ctx.deps);
    const request = req('POST', '/api/x');
    request.json = async () => {
      throw new SyntaxError('no body');
    };
    const upload = await b.fx.newRun(b.ctx.deps);
    b.ctx.repo.forceRunStatus(upload.id, 'uploading');
    const res = await b.route.pump.POST(request, withRun(upload.id));
    expect(res.status).toBe(200);
    expect((await json(res)).processed).toBe(0);
  });

  it('is exported with a duration the platform can honor', async () => {
    const b = await boot(SUPER);
    expect(b.route.pump.maxDuration).toBe(60);
    expect(b.route.cleanup.maxDuration).toBe(60);
  });
});

describe('cleanup route', () => {
  it('lists orphans without deleting, and cleans up on POST', async () => {
    const b = await boot(SUPER);
    const run = await createRunVia(b);
    const RUN = '0b8f4c1e-5d7a-4b1c-9d2e-1a2b3c4d5e6f';
    const FILE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    b.ctx.mem.put(
      `upload/${RUN}/${FILE}.pdf`,
      b.fx.pdfBytes('orphan'),
      new Date(Date.now() - 30 * 24 * 3_600_000)
    );
    const listed = await json(await call(b.route.cleanup.GET, 'GET', '/api/x'));
    expect(listed.orphans).toHaveLength(1);
    expect(listed.orphans[0]).toMatchObject({
      runId: RUN,
      fileId: FILE,
      deletable: true,
    });
    expect(JSON.stringify(listed)).not.toContain('upload/');
    expect(b.ctx.mem.objects.size).toBe(1);

    const cleaned = await call(b.route.cleanup.POST, 'POST', '/api/x', {
      body: {},
    });
    expect(cleaned.status).toBe(200);
    expect(await json(cleaned)).toMatchObject({
      expired: 0,
      objectsRemoved: 0,
    });
    // the orphan is still there: a cleanup never deletes orphans
    expect(b.ctx.mem.objects.size).toBe(1);
    expect(run.id).toBeTruthy();

    const deleted = await json(
      await call(b.route.cleanup.POST, 'POST', '/api/x', {
        body: { action: 'delete_orphans' },
      })
    );
    expect(deleted).toEqual({ deleted: 1, skippedYoung: 0, failed: 0 });
    expect(b.ctx.mem.objects.size).toBe(0);
  });

  it('lists and deletes orphans only for a SUPER_ADMIN by role', async () => {
    const b = await boot(PLATFORM_ADMIN);
    const RUN = '0b8f4c1e-5d7a-4b1c-9d2e-1a2b3c4d5e6f';
    const FILE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';
    const old = new Date(Date.now() - 30 * 24 * 3_600_000);
    b.ctx.mem.put(`upload/${RUN}/${FILE}.pdf`, b.fx.pdfBytes('o'), old);
    const list = await call(b.route.cleanup.GET, 'GET', '/api/x');
    expect(list.status).toBe(403);
    const del = await call(b.route.cleanup.POST, 'POST', '/api/x', {
      body: { action: 'delete_orphans' },
    });
    expect(del.status).toBe(403);
    expect(b.ctx.mem.objects.size).toBe(1);
    // the normal cleanup stays open to every curriculum editor
    const run = await call(b.route.cleanup.POST, 'POST', '/api/x', {
      body: {},
    });
    expect(run.status).toBe(200);
    expect(b.ctx.mem.objects.size).toBe(1);
  });

  it('answers a lock timeout of the database with 503 and Retry-After', async () => {
    const b = await boot(SUPER);
    jest
      .spyOn(b.ctx.repo, 'listRuns')
      .mockRejectedValue(
        Object.assign(new Error('x'), { cause: { code: '55P03' } })
      );
    const res = await call(b.route.runs.GET, 'GET', '/api/x');
    expect(res.status).toBe(503);
    expect(res.headers.get('Retry-After')).toBe('5');
    expect((await json(res)).code).toBe('BUSY');
  });

  it('limits the pump calls of one person', async () => {
    const b = await boot(SUPER);
    const run = await createRunVia(b);
    b.ctx.repo.forceRunStatus(run.id, 'uploading');
    let last: Response | undefined;
    for (let i = 0; i < 121; i++) {
      last = await call(b.route.pump.POST, 'POST', '/api/x', { runId: run.id });
    }
    expect(last!.status).toBe(429);
    expect(Number(last!.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
  });

  it('answers 400 for an action it does not know and 503 without a storage', async () => {
    const b = await boot(SUPER);
    const bad = await call(b.route.cleanup.POST, 'POST', '/api/x', {
      body: { action: 'delete_everything' },
    });
    expect(bad.status).toBe(400);

    const { UploadStorageError } =
      await import('@/lib/content-upload/staging/storage');
    b.ctx.deps.storage = () => {
      throw new UploadStorageError('NOT_CONFIGURED', 'not configured');
    };
    const res = await call(b.route.cleanup.GET, 'GET', '/api/x');
    expect(res.status).toBe(503);
    expect((await json(res)).code).toBe('STORAGE_UNAVAILABLE');
  });
});

describe('errors do not leak', () => {
  it('answers 500 without any text of the failure and logs only its name', async () => {
    const b = await boot(SUPER);
    jest
      .spyOn(b.ctx.repo, 'listRuns')
      .mockRejectedValue(
        new Error(
          'select * from content_upload_runs where sha256 = abc123 failed at 10.0.0.5'
        )
      );
    const res = await call(b.route.runs.GET, 'GET', '/api/x');
    expect(res.status).toBe(500);
    expect(await json(res)).toEqual({ error: 'Internal Server Error' });
    const logged = JSON.stringify((console.error as jest.Mock).mock.calls);
    expect(logged).toContain('route failed');
    expect(logged).not.toContain('abc123');
    expect(logged).not.toContain('10.0.0.5');
  });
});

describe('every handler of the content upload checks the session, then the switch, then the rest', () => {
  const base = path.join(process.cwd(), 'src/app/api/trainer/content-upload');

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walk(full);
      return entry.name === 'route.ts' ? [full] : [];
    });
  }

  const files = walk(base);

  it('finds the eighteen route files with their twenty one handlers', () => {
    expect(files).toHaveLength(18);
    const handlers = files.flatMap(f => [
      ...fs
        .readFileSync(f, 'utf8')
        .matchAll(/export async function (GET|POST|PUT|PATCH|DELETE)\b/g),
    ]);
    expect(handlers).toHaveLength(21);
  });

  it.each(
    files.map(f => [path.relative(base, f).split(path.sep).join('/'), f])
  )('%s', (_name, file) => {
    const source = fs.readFileSync(file, 'utf8');
    const parts = source.split(/(?=export async function )/).slice(1);
    expect(parts.length).toBeGreaterThan(0);
    for (const body of parts) {
      const session = body.indexOf('await requireCurriculumEditor(');
      const returnsSession = body.indexOf(
        'if (isErrorResponse(session)) return session;'
      );
      const off = body.indexOf('const off = contentUploadDisabledResponse();');
      const returnsOff = body.indexOf('if (off) return off;');
      expect(session).toBeGreaterThan(-1);
      expect(returnsSession).toBeGreaterThan(session);
      expect(off).toBeGreaterThan(returnsSession);
      expect(returnsOff).toBeGreaterThan(off);
      // nothing else runs before the switch: no params, no body, no data access
      const before = body.slice(0, returnsOff);
      for (const forbidden of [
        'await params',
        'request.json',
        'readJsonBody(',
        'uploadDeps(',
        'db.',
        'repo.',
      ]) {
        expect([forbidden, before.includes(forbidden)]).toEqual([
          forbidden,
          false,
        ]);
      }
      // and the old guards are not used
      expect(body).not.toContain('requireTrainer(');
      expect(body).not.toContain('requireUser(');
    }
  });

  it('the routes never call a model, the embeddings or the PDF reader that fetches urls', () => {
    const roots = [
      base,
      path.join(process.cwd(), 'src/lib/content-upload/staging'),
    ];
    const sources = roots
      .flatMap(walkAll)
      .map(f => [f, fs.readFileSync(f, 'utf8')] as const);
    expect(sources.length).toBeGreaterThan(10);
    for (const [file, source] of sources) {
      for (const forbidden of [
        'chatWithFallback',
        'getChatProvider',
        'hai/embeddings',
        'extractTextFromPDF',
        'extractTextByPage',
        'auth.admin',
        '@anthropic-ai/sdk',
        '@google/generative-ai',
        'openrouter',
        'OPENAI_',
      ]) {
        expect([
          path.basename(file),
          forbidden,
          source.includes(forbidden),
        ]).toEqual([path.basename(file), forbidden, false]);
      }
    }
  });

  function walkAll(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return walkAll(full);
      return /\.tsx?$/.test(entry.name) ? [full] : [];
    });
  }
});
