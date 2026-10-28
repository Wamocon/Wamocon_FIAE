/**
 * @jest-environment node
 */
import {
  canAccessRun,
  createRun,
  discardRun,
  fileDto,
  getRunWithProgress,
  listRuns,
  loadRun,
  parseCreateRunBody,
  runDto,
} from '@/lib/content-upload/staging/runs';
import { announceFiles } from '@/lib/content-upload/staging/files';
import { parseUploadStoragePath } from '@/lib/content-upload/staging/paths';
import {
  OTHER_ADMIN,
  OTHER_USER,
  SUPER,
  USER,
  entryFor,
  newRun,
  pdfBytes,
  setup,
} from '../../../helpers/uploadServiceFixtures';

const body = (overrides: Record<string, unknown> = {}) => ({
  label: 'KfBM Lehrtexte',
  declarationAccepted: true,
  ...overrides,
});

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
  jest.useRealTimers();
});

describe('parseCreateRunBody', () => {
  it('takes a label, the declaration and the defaults', () => {
    expect(parseCreateRunBody(body())).toEqual({
      ok: true,
      data: { label: 'KfBM Lehrtexte', kiEnabled: false },
    });
    expect(
      parseCreateRunBody(body({ kiEnabled: true, catalog: 'kfbm' }))
    ).toEqual({
      ok: true,
      data: { label: 'KfBM Lehrtexte', kiEnabled: true },
    });
  });

  it('trims the label and removes control and invisible characters', () => {
    expect(parseCreateRunBody(body({ label: '  ‮ab\u0000c​  ' }))).toEqual({
      ok: true,
      data: { label: 'abc', kiEnabled: false },
    });
  });

  it.each([
    [null, 400],
    ['x', 400],
    [[], 400],
    [body({ label: '' }), 400],
    [body({ label: '   ' }), 400],
    [body({ label: 'x'.repeat(121) }), 400],
    [body({ label: 5 }), 400],
    [{ declarationAccepted: true }, 400],
    [body({ declarationAccepted: false }), 400],
    [body({ declarationAccepted: 'true' }), 400],
    [{ label: 'x' }, 400],
    [body({ kiEnabled: 'yes' }), 400],
    [body({ catalog: 'FIAE' }), 400],
    [body({ catalog: 5 }), 400],
  ])('refuses %j with %i', (input, status) => {
    expect(parseCreateRunBody(input)).toMatchObject({ ok: false, status });
  });

  it('accepts a label of exactly 120 characters', () => {
    expect(parseCreateRunBody(body({ label: 'x'.repeat(120) })).ok).toBe(true);
  });

  it('names the declaration when it is missing', () => {
    expect(
      parseCreateRunBody(body({ declarationAccepted: false }))
    ).toMatchObject({
      code: 'DECLARATION_REQUIRED',
    });
  });
});

describe('createRun', () => {
  it('creates a draft for the catalog KFBM with the storage folder of the run', async () => {
    const ctx = setup();
    const result = await createRun(ctx.deps, SUPER, body());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const run = result.data;
    expect(run.status).toBe('draft');
    expect(run.createdById).toBe(USER);
    expect(run.trainingCatalogId).toBe('catalog-kfbm');
    expect(run.storagePrefix).toBe(`upload/${run.id}/`);
    // the opt in for the model stage is off unless the person chose it
    expect(run.kiEnabled).toBe(false);
    expect(run.declarationAcceptedAt).toBeInstanceOf(Date);
  });

  it('checks that the catalog exists', async () => {
    const ctx = setup();
    ctx.repo.catalogs.clear();
    const result = await createRun(ctx.deps, SUPER, body());
    expect(result).toMatchObject({
      ok: false,
      status: 404,
      code: 'CATALOG_MISSING',
    });
    expect(ctx.repo.runs.size).toBe(0);
  });

  it('refuses a fourth active run (429) and counts only active ones', async () => {
    const ctx = setup();
    const runs = [];
    for (let i = 0; i < 3; i++) runs.push(await newRun(ctx.deps));
    const fourth = await createRun(ctx.deps, SUPER, body());
    expect(fourth).toMatchObject({
      ok: false,
      status: 429,
      code: 'TOO_MANY_ACTIVE_RUNS',
    });
    // another person is not affected
    expect((await createRun(ctx.deps, OTHER_ADMIN, body())).ok).toBe(true);
    // a discarded run gives its place back
    await discardRun(ctx.deps, runs[0]);
    expect((await createRun(ctx.deps, SUPER, body())).ok).toBe(true);
  });

  it('holds the limit when runs are created at the same time', async () => {
    const ctx = setup();
    const results = await Promise.all(
      Array.from({ length: 6 }, () => createRun(ctx.deps, SUPER, body()))
    );
    expect(results.filter(r => r.ok)).toHaveLength(3);
    expect(results.filter(r => !r.ok)).toHaveLength(3);
  });

  it('does not create anything for a bad body', async () => {
    const ctx = setup();
    const create = jest.spyOn(ctx.repo, 'createRun');
    await createRun(ctx.deps, SUPER, { label: '' });
    expect(create).not.toHaveBeenCalled();
  });

  it('cleans up lazily when a run is created', async () => {
    const ctx = setup();
    const stale = await newRun(ctx.deps);
    ctx.repo.advance(31 * 24 * 3_600_000);
    await createRun(ctx.deps, SUPER, body());
    expect((await ctx.repo.getRun(stale.id))?.status).toBe('discarded');
  });

  it('still creates the run when the cleanup fails', async () => {
    const ctx = setup();
    jest
      .spyOn(ctx.repo, 'expireStaleAnnounced')
      .mockRejectedValue(new Error('storage down with detail'));
    const result = await createRun(ctx.deps, SUPER, body());
    expect(result.ok).toBe(true);
    const logged = JSON.stringify((console.error as jest.Mock).mock.calls);
    expect(logged).toContain('cleanup failed');
    expect(logged).not.toContain('detail');
  });

  it('does not wait longer than a few seconds for a cleanup that hangs', async () => {
    jest.useFakeTimers();
    const ctx = setup();
    jest
      .spyOn(ctx.repo, 'expireStaleAnnounced')
      .mockReturnValue(new Promise(() => undefined));
    const pending = createRun(ctx.deps, SUPER, body());
    await jest.advanceTimersByTimeAsync(4100);
    const result = await pending;
    expect(result.ok).toBe(true);
  });
});

describe('who sees a run (concept 1.3)', () => {
  it('the creator sees it, the SUPER_ADMIN sees all, everybody else sees none', () => {
    const run = { createdById: USER };
    expect(canAccessRun({ id: USER, role: 'ADMIN' }, run)).toBe(true);
    expect(canAccessRun({ id: OTHER_USER, role: 'SUPER_ADMIN' }, run)).toBe(
      true
    );
    // an ADMIN of the platform organization passes the curriculum guard but is
    // not a SUPER_ADMIN by role: foreign runs stay hidden from that person
    expect(canAccessRun({ id: OTHER_USER, role: 'ADMIN' }, run)).toBe(false);
    for (const role of ['TEMP_ADMIN', 'TRAINER', 'TRAINEE']) {
      expect(canAccessRun({ id: OTHER_USER, role }, run)).toBe(false);
    }
  });

  it('answers 404 for a bad id, an unknown run and a foreign run, all alike', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps, SUPER);
    const answers = [
      await loadRun(ctx.deps, OTHER_ADMIN, run.id),
      await loadRun(
        ctx.deps,
        OTHER_ADMIN,
        '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11'
      ),
      await loadRun(ctx.deps, OTHER_ADMIN, 'not-a-uuid'),
      await loadRun(ctx.deps, OTHER_ADMIN, undefined),
    ];
    for (const answer of answers) {
      expect(answer).toEqual({
        ok: false,
        status: 404,
        error: 'Run not found',
      });
    }
    expect((await loadRun(ctx.deps, SUPER, run.id)).ok).toBe(true);
    expect(
      (await loadRun(ctx.deps, { id: OTHER_USER, role: 'SUPER_ADMIN' }, run.id))
        .ok
    ).toBe(true);
  });

  it('lists the own runs, a SUPER_ADMIN lists all', async () => {
    const ctx = setup();
    const mine = await newRun(ctx.deps, OTHER_ADMIN);
    const theirs = await newRun(ctx.deps, SUPER);
    expect((await listRuns(ctx.deps, OTHER_ADMIN)).map(r => r.id)).toEqual([
      mine.id,
    ]);
    expect((await listRuns(ctx.deps, SUPER)).map(r => r.id).sort()).toEqual(
      [mine.id, theirs.id].sort()
    );
  });
});

describe('answers do not leak', () => {
  it('runDto has no storage prefix', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const dto = runDto(run);
    expect(JSON.stringify(dto)).not.toContain('upload/');
    expect(dto).toMatchObject({
      id: run.id,
      catalog: 'KFBM',
      label: 'A run',
      status: 'draft',
      kiEnabled: false,
      createdById: USER,
    });
    expect(Object.keys(dto)).not.toContain('storagePrefix');
  });

  it('fileDto has no storage path, no claim and no parse summary', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    await announceFiles(ctx.deps, run, {
      files: [entryFor('a/x.pdf', pdfBytes('x'))],
    });
    const [row] = await ctx.repo.listFiles(run.id, { offset: 0, limit: 10 });
    const dto = fileDto(row);
    expect(parseUploadStoragePath(row.storagePath, 'public')).not.toBeNull();
    for (const key of [
      'storagePath',
      'claimId',
      'lockedUntil',
      'parseSummary',
    ]) {
      expect(Object.keys(dto)).not.toContain(key);
    }
    expect(JSON.stringify(dto)).not.toContain('upload/');
  });
});

describe('getRunWithProgress', () => {
  it('returns the counters per state and the limits the browser needs', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    await announceFiles(ctx.deps, run, {
      files: [
        entryFor('a/x.pdf', pdfBytes('x')),
        entryFor('a/y.pdf', pdfBytes('y')),
      ],
    });
    const result = await getRunWithProgress(
      ctx.deps,
      (await ctx.repo.getRun(run.id))!
    );
    expect(result.progress.counts).toEqual({ announced: 2 });
    expect(result.progress.totalFiles).toBe(2);
    expect(result.run.status).toBe('uploading');
    expect(result.limits).toEqual({
      maxFilesPerRequest: 50,
      maxFileBytes: 25 * 1024 * 1024,
      maxFileBytesByExt: {
        docx: 25 * 1024 * 1024,
        pdf: 25 * 1024 * 1024,
        json: 32 * 1024 * 1024,
        xlsx: 5 * 1024 * 1024,
      },
      maxFilesPerRun: 1500,
      maxRunBytes: 1024 ** 3,
    });
  });
});

describe('discardRun', () => {
  it.each([
    'draft',
    'uploading',
    'processing',
    'review',
    'applied',
    'failed',
  ] as const)(
    'discards a run that is %s and sets the purge date',
    async status => {
      const ctx = setup();
      const run = await newRun(ctx.deps);
      ctx.repo.forceRunStatus(run.id, status);
      const result = await discardRun(
        ctx.deps,
        (await ctx.repo.getRun(run.id))!
      );
      expect(result.ok && result.data.status).toBe('discarded');
      expect(result.ok && result.data.purgeAfter).toBeInstanceOf(Date);
    }
  );

  it('is harmless a second time', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    await discardRun(ctx.deps, run);
    const again = await discardRun(ctx.deps, (await ctx.repo.getRun(run.id))!);
    expect(again.ok && again.data.status).toBe('discarded');
  });

  it('answers 409 while an apply is running', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    ctx.repo.forceRunStatus(run.id, 'applying');
    const result = await discardRun(ctx.deps, (await ctx.repo.getRun(run.id))!);
    expect(result).toMatchObject({ ok: false, status: 409, code: 'RUN_STATE' });
    expect((await ctx.repo.getRun(run.id))?.status).toBe('applying');
  });

  it('is done even when the storage is not reachable', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const failing = {
      ...ctx.deps,
      storage: () => {
        throw new Error('not configured');
      },
    };
    await announceFiles(ctx.deps, run, {
      files: [entryFor('a/x.pdf', pdfBytes('x'))],
    });
    const result = await discardRun(failing, (await ctx.repo.getRun(run.id))!);
    expect(result.ok && result.data.status).toBe('discarded');
  });
});
