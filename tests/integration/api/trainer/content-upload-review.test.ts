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

// The routes of the review list (src/app/api/trainer/content-upload: overview,
// review, review/options, review/duplicates, decisions) on the in-memory
// repositories and storage, with real (invented) Word files that went through the
// real steps of the queue. The guards of all of them (401, 403, 404 in Production)
// are tried for every handler in content-upload.test.ts; here: what they answer.

const USER = '11111111-1111-4111-8111-111111111111';
const OTHER = '22222222-2222-4222-8222-222222222222';
const MISSING = '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11';

const SUPER: FakeSession = fakeSession({
  id: USER,
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
const OTHER_SUPER: FakeSession = fakeSession({
  id: OTHER,
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
  isAdmin: true,
});

const API = '@/app/api/trainer/content-upload';

async function boot(session: FakeSession | null) {
  jest.resetModules();
  mockSession(session);
  const fx = await import('../../../helpers/uploadServiceFixtures');
  const rv = await import('../../../helpers/reviewFixtures');
  const ctx = fx.setup('public');
  ctx.review.components = rv.DB_COMPONENTS;
  const uploadDeps = jest.fn(() => ctx.deps);
  const reviewDeps = jest.fn(() => ({ ...uploadDeps(), review: ctx.review }));
  jest.doMock('@/lib/content-upload/staging/context', () => ({
    __esModule: true,
    uploadDeps,
    getUploadRepo: () => ctx.repo,
    getUploadStorage: () => ctx.storage,
  }));
  jest.doMock('@/lib/content-upload/review/context', () => ({
    __esModule: true,
    reviewDeps,
    getReviewRepo: () => ctx.review,
  }));
  const route = {
    overview: (await import(`${API}/overview/route`)) as any,
    review: (await import(`${API}/runs/[runId]/review/route`)) as any,
    options: (await import(`${API}/runs/[runId]/review/options/route`)) as any,
    duplicates: (await import(
      `${API}/runs/[runId]/review/duplicates/route`
    )) as any,
    decisions: (await import(`${API}/runs/[runId]/decisions/route`)) as any,
    pump: (await import(`${API}/runs/[runId]/pump/route`)) as any,
    reopen: (await import(`${API}/runs/[runId]/reopen/route`)) as any,
  };
  return { ctx, fx, rv, route, uploadDeps, reviewDeps };
}
type Booted = Awaited<ReturnType<typeof boot>>;

const withRun = (runId: string) => ({ params: Promise.resolve({ runId }) });
const json = async (res: Response) => (await res.json()) as any;

function get(handler: any, runId: string | null, query = '') {
  const request = makeRequest('GET', `http://localhost/api/x${query}`, {
    token: 't',
  });
  return runId === null ? handler(request) : handler(request, withRun(runId));
}
function post(handler: any, runId: string, body: unknown) {
  return handler(
    makeRequest('POST', 'http://localhost/api/x', { token: 't', body }),
    withRun(runId)
  );
}

/** A run of the creator in the state review with a quiz (two versions), an enabler text and a loose file. */
async function seed(b: Booted, creator = USER) {
  const { rv, fx, ctx } = b;
  const run = await fx.newRun(ctx.deps, { id: creator, role: 'SUPER_ADMIN' });
  await rv.uploadFiles(ctx, run, [
    await rv.quizFile('1a', 'Low', { lastModified: Date.UTC(2026, 8, 3) }),
    await rv.quizFile('1a', 'Low', {
      name: '1a_Quiz_Low_v2.docx',
      lastModified: Date.UTC(2026, 9, 12),
      questions: 4,
    }),
    await rv.enablerFile('1a'),
    await rv.unknownFile(),
  ]);
  await rv.processAll(ctx, run.id);
  return (await ctx.repo.getRun(run.id))!;
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

describe('GET review', () => {
  it('answers the first page with counts, facets and the version, and nothing of the files themselves', async () => {
    const b = await boot(SUPER);
    const run = await seed(b);
    const res = await get(b.route.review.GET, run.id);
    expect(res.status).toBe(200);
    const body = await json(res);
    expect(body).toMatchObject({
      version: 0,
      page: 1,
      pageSize: 50,
      pages: 1,
      matching: 4,
      run: { id: run.id, status: 'review', catalog: 'KFBM' },
      counts: { total: 4, duplicates: 2, low: 1, acceptableHigh: 1 },
      facets: { components: ['K1'], docTypes: ['enabler', 'quiz'] },
    });
    expect(body.rows).toHaveLength(4);
    const text = JSON.stringify(body);
    for (const word of [
      'upload/',
      'storagePath',
      'claimId',
      'parseSummary',
      'sha256',
      'ZEBRAKANAL',
      'QUOKKA',
    ]) {
      expect(text).not.toContain(word);
    }
  });

  it('filters and pages by the query string and ignores what it does not know', async () => {
    const b = await boot(SUPER);
    const run = await seed(b);
    const quiz = await json(
      await get(b.route.review.GET, run.id, '?type=quiz')
    );
    expect(quiz.matching).toBe(2);
    const dup = await json(
      await get(b.route.review.GET, run.id, '?duplicates=1&sort=name')
    );
    expect(dup.rows.map((r: any) => r.fileName)).toEqual([
      '1a_Quiz_Low.docx',
      '1a_Quiz_Low_v2.docx',
    ]);
    const low = await json(
      await get(b.route.review.GET, run.id, '?band=low&status=open')
    );
    expect(low.rows.map((r: any) => r.fileName)).toEqual(['Sicherung.docx']);
    const small = await json(
      await get(b.route.review.GET, run.id, '?pageSize=2&page=2&sort=path')
    );
    expect(small).toMatchObject({ page: 2, pages: 2, matching: 4 });
    expect(small.rows).toHaveLength(2);
    const junk = await json(
      await get(
        b.route.review.GET,
        run.id,
        "?band=x'--&status=%00&type=;drop&page=abc"
      )
    );
    expect(junk.matching).toBe(4);
    // the counts always describe the whole run, not the filter
    expect(low.counts.total).toBe(4);
  });

  it('answers 404 for a run of somebody else, an unknown run and a bad id, the same for all three', async () => {
    const b = await boot(PLATFORM_ADMIN);
    const run = await seed(b, USER);
    for (const id of [run.id, MISSING, 'nope']) {
      const res = await get(b.route.review.GET, id);
      expect([
        id === run.id ? 'foreign' : id,
        res.status,
        await json(res),
      ]).toEqual([
        id === run.id ? 'foreign' : id,
        404,
        { error: 'Run not found' },
      ]);
    }
  });

  it('lets a SUPER_ADMIN read the run of somebody else', async () => {
    const b = await boot(OTHER_SUPER);
    const run = await seed(b, USER);
    expect((await get(b.route.review.GET, run.id)).status).toBe(200);
  });

  it('shows a run that is still being processed (the list is there, the decisions are not)', async () => {
    const b = await boot(SUPER);
    const run = await seed(b);
    b.ctx.repo.forceRunStatus(run.id, 'processing');
    const body = await json(await get(b.route.review.GET, run.id));
    expect(body.run.status).toBe('processing');
    expect(body.rows).toHaveLength(4);
  });
});

describe('GET review/options and review/duplicates', () => {
  it('offers the positive list for the selects', async () => {
    const b = await boot(SUPER);
    const run = await seed(b);
    const body = await json(await get(b.route.options.GET, run.id));
    expect(body.docTypes).not.toContain('other');
    expect(body.components.map((c: any) => c.code)).toEqual([
      'K1',
      'K6.1',
      'K12',
    ]);
    expect(body.components[0].enablers.map((e: any) => e.code)).toEqual([
      'K1-a',
      'K1-b',
      'K1-c',
    ]);
  });

  it('lists the group of versions with the suggestion', async () => {
    const b = await boot(SUPER);
    const run = await seed(b);
    const body = await json(await get(b.route.duplicates.GET, run.id));
    expect(body.version).toBe(0);
    expect(body.groups).toHaveLength(1);
    expect(body.groups[0]).toMatchObject({
      key: 'quiz:1a:low',
      ambiguous: false,
    });
    expect(body.groups[0].members.find((m: any) => m.suggested).fileName).toBe(
      '1a_Quiz_Low_v2.docx'
    );
    expect(JSON.stringify(body)).not.toContain('upload/');
  });

  it("answer 404 for a run that is not the caller's", async () => {
    const b = await boot(PLATFORM_ADMIN);
    const run = await seed(b, USER);
    expect((await get(b.route.options.GET, run.id)).status).toBe(404);
    expect((await get(b.route.duplicates.GET, run.id)).status).toBe(404);
  });
});

describe('POST decisions', () => {
  it('writes the safe proposals, raises the version and answers with what it did', async () => {
    const b = await boot(SUPER);
    const run = await seed(b);
    const res = await post(b.route.decisions.POST, run.id, {
      expectedVersion: 0,
      command: 'accept_high',
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      version: 1,
      written: 1,
      skipped: [],
      eligible: 1,
    });
    const list = await json(await get(b.route.review.GET, run.id));
    expect(list.version).toBe(1);
    expect(list.counts.accepted).toBe(1);
    const row = list.rows.find((r: any) => r.decision);
    expect(row.decision).toMatchObject({
      action: 'accept',
      docType: 'enabler',
    });
    expect(row.status).toBe('decided');
  });

  it('keeps one version of a document and skips the other (duplicate view)', async () => {
    const b = await boot(SUPER);
    const run = await seed(b);
    const { groups } = await json(await get(b.route.duplicates.GET, run.id));
    const keep = groups[0].members.find((m: any) => m.suggested);
    const res = await post(b.route.decisions.POST, run.id, {
      expectedVersion: 0,
      command: 'duplicate',
      key: groups[0].key,
      keepFileId: keep.fileId,
    });
    expect(res.status).toBe(200);
    expect((await json(res)).written).toBe(2);
    const after = await json(await get(b.route.duplicates.GET, run.id));
    expect(after.groups[0].resolved).toBe(true);
  });

  it('answers 409 VERSION_CONFLICT for a stale version and writes nothing', async () => {
    const b = await boot(SUPER);
    const run = await seed(b);
    await post(b.route.decisions.POST, run.id, {
      expectedVersion: 0,
      command: 'accept_high',
    });
    const res = await post(b.route.decisions.POST, run.id, {
      expectedVersion: 0,
      command: 'bulk',
      action: 'reject',
      fileIds: [MISSING],
    });
    expect(res.status).toBe(409);
    expect((await json(res)).code).toBe('VERSION_CONFLICT');
    expect(b.ctx.review.decisionRows).toHaveLength(1);
  });

  it.each([
    'uploading',
    'processing',
    'applying',
    'applied',
    'discarded',
  ] as const)(
    'answers 409 RUN_STATE for a run in the state %s',
    async status => {
      const b = await boot(SUPER);
      const run = await seed(b);
      b.ctx.repo.forceRunStatus(run.id, status);
      const res = await post(b.route.decisions.POST, run.id, {
        expectedVersion: 0,
        command: 'accept_high',
      });
      expect(res.status).toBe(409);
      expect((await json(res)).code).toBe('RUN_STATE');
      expect(b.ctx.review.decisionRows).toHaveLength(0);
    }
  );

  it('does not take a file that is not in the run: it is skipped, nothing is written', async () => {
    const b = await boot(SUPER);
    const run = await seed(b);
    const res = await post(b.route.decisions.POST, run.id, {
      expectedVersion: 0,
      command: 'bulk',
      action: 'defer',
      fileIds: [MISSING],
    });
    expect(res.status).toBe(200);
    expect(await json(res)).toEqual({
      version: 0,
      written: 0,
      skipped: [{ fileId: MISSING, code: 'FILE_NOT_FOUND' }],
    });
  });

  it.each([
    ['not an object', 'text'],
    ['no command', { expectedVersion: 0 }],
    ['an unknown command', { expectedVersion: 0, command: 'drop' }],
    ['a version as text', { expectedVersion: '0', command: 'accept_high' }],
  ])('answers 400 for a body that is %s', async (_name, body) => {
    const b = await boot(SUPER);
    const run = await seed(b);
    const res = await post(b.route.decisions.POST, run.id, body);
    expect(res.status).toBe(400);
    expect((await json(res)).code).toBe('BODY_INVALID');
  });

  it('answers 400 for a body that is no JSON at all', async () => {
    const b = await boot(SUPER);
    const run = await seed(b);
    const request = new Request('http://localhost/api/x', {
      method: 'POST',
      body: '{nope',
      headers: { authorization: 'Bearer t' },
    });
    const res = await b.route.decisions.POST(request as any, withRun(run.id));
    expect(res.status).toBe(400);
  });

  it('answers 404 for a run of somebody else, a bad id and an unknown run, before it reads the body', async () => {
    const b = await boot(PLATFORM_ADMIN);
    const run = await seed(b, USER);
    for (const id of [run.id, MISSING, 'nope']) {
      const res = await post(b.route.decisions.POST, id, {
        expectedVersion: 0,
        command: 'accept_high',
      });
      expect([id, res.status]).toEqual([id, 404]);
    }
    expect(b.ctx.review.decisionRows).toHaveLength(0);
  });

  it('lets a SUPER_ADMIN decide in the run of somebody else, the decision names the decider', async () => {
    const b = await boot(OTHER_SUPER);
    const run = await seed(b, USER);
    const res = await post(b.route.decisions.POST, run.id, {
      expectedVersion: 0,
      command: 'accept_high',
    });
    expect(res.status).toBe(200);
    expect(b.ctx.review.decisionRows[0].decidedById).toBe(OTHER);
  });

  it('limits the number of requests per person and minute', async () => {
    const b = await boot(SUPER);
    const run = await seed(b);
    let last = 0;
    for (let i = 0; i < 70; i += 1) {
      last = (
        await post(b.route.decisions.POST, run.id, {
          expectedVersion: 99,
          command: 'accept_high',
        })
      ).status;
      if (last === 429) break;
    }
    expect(last).toBe(429);
  });
});

describe('POST reopen ("Erneut prüfen")', () => {
  it.each(['applied', 'failed'] as const)(
    'takes a run in the state %s back to review, raises the version and clears the hash of the dry run',
    async status => {
      const b = await boot(SUPER);
      const run = await seed(b);
      b.ctx.repo.forceRunStatus(run.id, status);
      b.ctx.review.dryRunHash.set(run.id, 'hash-of-a-dry-run');
      const res = await post(b.route.reopen.POST, run.id, {});
      expect(res.status).toBe(200);
      expect(await json(res)).toEqual({ version: 1 });
      expect((await b.ctx.repo.getRun(run.id))!.status).toBe('review');
      expect(b.ctx.review.dryRunHash.get(run.id)).toBeNull();
      // a decision made for the old version is refused afterwards
      const stale = await post(b.route.decisions.POST, run.id, {
        expectedVersion: 0,
        command: 'accept_high',
      });
      expect(stale.status).toBe(409);
      expect((await json(stale)).code).toBe('VERSION_CONFLICT');
    }
  );

  it.each(['draft', 'uploading', 'processing', 'review', 'applying', 'discarded'] as const)(
    'answers 409 RUN_STATE for a run in the state %s and changes nothing',
    async status => {
      const b = await boot(SUPER);
      const run = await seed(b);
      b.ctx.repo.forceRunStatus(run.id, status);
      b.ctx.review.dryRunHash.set(run.id, 'keep');
      const res = await post(b.route.reopen.POST, run.id, {});
      expect(res.status).toBe(409);
      expect((await json(res)).code).toBe('RUN_STATE');
      expect((await b.ctx.repo.getRun(run.id))!.decisionsVersion).toBe(0);
      expect(b.ctx.review.dryRunHash.get(run.id)).toBe('keep');
    }
  );

  it('answers 404 for the run of somebody else and for a bad id', async () => {
    const b = await boot(PLATFORM_ADMIN);
    const run = await seed(b, USER);
    b.ctx.repo.forceRunStatus(run.id, 'applied');
    for (const id of [run.id, MISSING, 'nope']) {
      expect((await post(b.route.reopen.POST, id, {})).status).toBe(404);
    }
    expect((await b.ctx.repo.getRun(run.id))!.status).toBe('applied');
  });
});

describe('GET overview', () => {
  it('lists the own runs with the counts of files and decisions', async () => {
    const b = await boot(SUPER);
    const run = await seed(b);
    await post(b.route.decisions.POST, run.id, {
      expectedVersion: 0,
      command: 'accept_high',
    });
    const body = await json(await get(b.route.overview.GET, null));
    expect(body.runs).toHaveLength(1);
    expect(body.runs[0]).toMatchObject({
      id: run.id,
      status: 'review',
      fileCount: 4,
      decidedCount: 1,
      createdById: USER,
    });
    expect(JSON.stringify(body)).not.toContain('upload/');
  });

  it('shows a SUPER_ADMIN every run and an ADMIN of the platform only the own ones', async () => {
    const b = await boot(OTHER_SUPER);
    await seed(b, USER);
    expect(
      (await json(await get(b.route.overview.GET, null))).runs
    ).toHaveLength(1);
    const c = await boot(PLATFORM_ADMIN);
    await seed(c, USER);
    expect(
      (await json(await get(c.route.overview.GET, null))).runs
    ).toHaveLength(0);
  });
});

describe('the pump route runs the steps of the review', () => {
  it('leads the files of a run to proposals and the run to the review state', async () => {
    const b = await boot(SUPER);
    const { rv, fx, ctx } = b;
    const run = await fx.newRun(ctx.deps, { id: USER, role: 'SUPER_ADMIN' });
    await rv.uploadFiles(ctx, run, [
      await rv.quizFile('1a'),
      await rv.unknownFile(),
    ]);
    let body: any = {};
    for (let i = 0; i < 10 && !body.done; i += 1) {
      const res = await post(b.route.pump.POST, run.id, { closeUpload: true });
      expect(res.status).toBe(200);
      body = await json(res);
    }
    expect(body).toMatchObject({ done: true, runStatus: 'review' });
    const records = await ctx.review.listRecords(run.id);
    expect(records.map(r => r.file.status).sort()).toEqual([
      'proposed_rules',
      'unclear',
    ]);
    expect(records.every(r => r.proposal !== null)).toBe(true);
  });
});

describe('a quiz JSON file and an Excel mapping file through the routes (UP2)', () => {
  it('leads them through the pump and the list to a decision, and shows numbers only', async () => {
    const b = await boot(SUPER);
    const { rv, fx, ctx } = b;
    const seeds = await import('../../../helpers/jsonXlsxSeeds');
    const run = await fx.newRun(ctx.deps, { id: USER, role: 'SUPER_ADMIN' });
    await rv.uploadFiles(ctx, run, [
      seeds.lessonJsonSeed(),
      await seeds.mappingSeed(),
      seeds.rawSeed('x/kaputt.json', '{ nicht lesbar'),
    ]);
    let pumped: any = {};
    for (let i = 0; i < 10 && !pumped.done; i += 1) {
      const res = await post(b.route.pump.POST, run.id, { closeUpload: true });
      expect(res.status).toBe(200);
      pumped = await json(res);
    }
    expect(pumped).toMatchObject({ done: true, runStatus: 'review', rejected: 1 });

    const listed = await json(await get(b.route.review.GET, run.id));
    expect(listed.rows.map((r: any) => [r.ext, r.status, r.statusCode]).sort()).toEqual([
      ['json', 'proposed_rules', null],
      ['json', 'rejected', 'NOT_JSON'],
      ['xlsx', 'proposed_rules', null],
    ]);
    const quiz = listed.rows.find((r: any) => r.proposal?.docType === 'quiz');
    expect(quiz.contents).toMatchObject({
      kind: 'quiz_json',
      variant: 'lesson',
      numbers: { quizzes: 5, sets: 15, questions: 150 },
    });
    const mapping = listed.rows.find((r: any) => r.proposal?.docType === 'other');
    expect(mapping.contents).toMatchObject({ kind: 'mapping_xlsx' });
    const text = JSON.stringify(listed);
    expect(text).not.toMatch(/Erfundene Frage|ZETA|Position a|upload\//);
    expect(listed.counts).toMatchObject({ total: 3, high: 2, problems: 1 });

    const decided = await post(b.route.decisions.POST, run.id, {
      expectedVersion: listed.version,
      command: 'accept_high',
    });
    expect(decided.status).toBe(200);
    expect(await json(decided)).toMatchObject({ written: 2, eligible: 2 });
    const wrong = await post(b.route.decisions.POST, run.id, {
      expectedVersion: listed.version + 1,
      command: 'assign',
      fileIds: [quiz.id],
      assignment: { componentCode: 'K1', enablerCode: 'K1-a', quizLevel: 'low' },
    });
    expect(await json(wrong)).toMatchObject({
      written: 0,
      skipped: [{ fileId: quiz.id, code: 'ASSIGNMENT_INVALID' }],
    });
  });
});

describe('the new handlers keep the order of the others: session, switch, then the rest', () => {
  const base = path.join(process.cwd(), 'src/app/api/trainer/content-upload');
  const files = [
    'overview/route.ts',
    'runs/[runId]/review/route.ts',
    'runs/[runId]/review/options/route.ts',
    'runs/[runId]/review/duplicates/route.ts',
    'runs/[runId]/decisions/route.ts',
    'runs/[runId]/reopen/route.ts',
  ];

  it.each(files)('%s', file => {
    const source = fs.readFileSync(path.join(base, file), 'utf8');
    const session = source.indexOf('await requireCurriculumEditor(');
    const off = source.indexOf('const off = contentUploadDisabledResponse();');
    const returnsOff = source.indexOf('if (off) return off;');
    expect(session).toBeGreaterThan(-1);
    expect(off).toBeGreaterThan(session);
    const before = source.slice(0, returnsOff);
    for (const forbidden of [
      'await params',
      'request.json',
      'readJsonBody(',
      'reviewDeps(',
      'uploadDeps(',
    ]) {
      expect([forbidden, before.includes(forbidden)]).toEqual([
        forbidden,
        false,
      ]);
    }
  });

  it('the review code never calls a model, the embeddings or the PDF reader that fetches urls', () => {
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
        const full = path.join(dir, e.name);
        return e.isDirectory()
          ? walk(full)
          : /\.tsx?$/.test(e.name)
            ? [full]
            : [];
      });
    const sources = walk(
      path.join(process.cwd(), 'src/lib/content-upload/review')
    );
    expect(sources.length).toBeGreaterThan(8);
    for (const file of sources) {
      const source = fs.readFileSync(file, 'utf8');
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
        'buildExcerpt',
      ]) {
        expect([
          path.basename(file),
          forbidden,
          source.includes(forbidden),
        ]).toEqual([path.basename(file), forbidden, false]);
      }
    }
  });
});
