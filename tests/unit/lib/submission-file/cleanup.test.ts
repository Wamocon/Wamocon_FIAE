/**
 * @jest-environment node
 */
import { describe, expect, it, jest } from '@jest/globals';
import {
  CLEANUP_BATCH,
  FIAE_CATALOG_ID,
  ORPHAN_UPLOAD_MIN_AGE_MS,
  collectEntries,
  createCleanupStorage,
  loadCleanupFacts,
  parseCleanupArgs,
  planCleanup,
  renderCleanupReport,
  runCleanup,
  type CleanupFacts,
  type CleanupListEntry,
  type CleanupStorage,
} from '@/lib/submission-file/cleanup';
import {
  filePath,
  incomingPath,
  submissionFolder,
} from '@/lib/submission-file/rules';

const KFBM_CATALOG_ID = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';
const NOW = Date.UTC(2026, 9, 29, 12, 0, 0);
const HOUR = 60 * 60 * 1000;

const id = (n: number) =>
  `${String(n).padStart(8, '0')}-aaaa-4aaa-8aaa-${String(n).padStart(12, '0')}`;
// trainees and use cases of the tests
const T_ACTIVE = id(1);
const T_DEACTIVATED = id(2);
const T_GONE = id(3);
const T_UNKNOWN_FLAG = id(4);
const T_KFBM_ONLY = id(5);
const T_NO_ENROLLMENT = id(6);
const UC_FIAE = id(101);
const UC_KFBM = id(102);
const UC_GONE = id(103);

const folderOf = (
  trainee: string,
  useCase: string,
  schema: 'public' | 'public_preview' = 'public'
) =>
  submissionFolder(
    { organizationId: ORG, traineeId: trainee, useCaseId: useCase },
    schema
  ) as string;
const file = (
  trainee: string,
  useCase: string,
  schema: 'public' | 'public_preview' = 'public'
) => filePath(folderOf(trainee, useCase, schema), NOW - 5 * HOUR, 'a.pdf');
const upload = (
  trainee: string,
  useCase: string,
  n = 7,
  schema: 'public' | 'public_preview' = 'public'
) => incomingPath(folderOf(trainee, useCase, schema), `${id(n)}.pdf`);

const facts = (over: Partial<CleanupFacts> = {}): CleanupFacts => ({
  profiles: new Map([
    [T_ACTIVE, { isActive: true }],
    [T_DEACTIVATED, { isActive: false }],
    [T_UNKNOWN_FLAG, { isActive: null }],
    [T_KFBM_ONLY, { isActive: true }],
    [T_NO_ENROLLMENT, { isActive: true }],
  ]),
  useCases: new Map([
    [UC_FIAE, { catalogId: FIAE_CATALOG_ID }],
    [UC_KFBM, { catalogId: KFBM_CATALOG_ID }],
  ]),
  submissions: new Set([
    `${T_ACTIVE}:${UC_FIAE}`,
    `${T_DEACTIVATED}:${UC_FIAE}`,
  ]),
  enrollments: new Map([
    [T_ACTIVE, [FIAE_CATALOG_ID, KFBM_CATALOG_ID]],
    [T_DEACTIVATED, [FIAE_CATALOG_ID]],
    [T_UNKNOWN_FLAG, [FIAE_CATALOG_ID]],
    [T_KFBM_ONLY, [KFBM_CATALOG_ID]],
  ]),
  ...over,
});

const entry = (path: string, ageHours: number | null = 48) => ({
  path,
  createdAt: ageHours === null ? null : NOW - ageHours * HOUR,
});
const plan = (
  entries: Array<{ path: string; createdAt: number | null }>,
  over: Partial<CleanupFacts> = {},
  options: {
    includeDeactivated?: boolean;
    schema?: 'public' | 'public_preview';
  } = {}
) =>
  planCleanup(entries, facts(over), {
    schema: options.schema ?? 'public',
    now: NOW,
    includeDeactivated: options.includeDeactivated ?? false,
  });

describe('planCleanup, reason (a): unfinished upload without a file', () => {
  it('removes an upload in incoming/ that is older than 24 hours', () => {
    const old = upload(T_ACTIVE, UC_FIAE);
    const result = plan([entry(old, ORPHAN_UPLOAD_MIN_AGE_MS / HOUR + 1)]);
    expect(result.deletions).toEqual([{ path: old, reason: 'orphan' }]);
    expect(result.counts.orphan).toBe(1);
  });

  it('draws the line at exactly 24 hours', () => {
    const at = upload(T_ACTIVE, UC_FIAE, 11);
    const justYounger = upload(T_ACTIVE, UC_FIAE, 12);
    const result = plan([
      { path: at, createdAt: NOW - ORPHAN_UPLOAD_MIN_AGE_MS },
      { path: justYounger, createdAt: NOW - ORPHAN_UPLOAD_MIN_AGE_MS + 1 },
    ]);
    expect(result.deletions).toEqual([{ path: at, reason: 'orphan' }]);
    expect(result.counts.keptRunningUpload).toBe(1);
  });

  it('keeps an upload that is younger than 24 hours (it may still be running)', () => {
    const result = plan([entry(upload(T_ACTIVE, UC_FIAE), 23)]);
    expect(result.deletions).toEqual([]);
    expect(result.counts.keptRunningUpload).toBe(1);
  });

  it('keeps an upload whose age is not known', () => {
    const result = plan([entry(upload(T_ACTIVE, UC_FIAE), null)]);
    expect(result.deletions).toEqual([]);
    expect(result.counts.keptAgeUnknown).toBe(1);
  });

  it('keeps a file without a submission row while the training runs (a draft)', () => {
    const result = plan([entry(file(T_ACTIVE, UC_KFBM))]);
    expect(result.deletions).toEqual([]);
    expect(result.counts.keptDraft).toBe(1);
  });
});

describe('planCleanup, reason (b): submission, trainee or use case deleted', () => {
  it('removes the file of a trainee that does not exist any more', () => {
    const path = file(T_GONE, UC_FIAE);
    const result = plan([entry(path)]);
    expect(result.deletions).toEqual([{ path, reason: 'deleted' }]);
    expect(result.counts.deleted).toBe(1);
  });

  it('removes the file of a use case that does not exist any more', () => {
    const path = file(T_ACTIVE, UC_GONE);
    expect(plan([entry(path)]).deletions).toEqual([
      { path, reason: 'deleted' },
    ]);
  });

  it('removes a young upload of a deleted trainee at once (no 24 hour wait)', () => {
    const path = upload(T_GONE, UC_FIAE);
    expect(plan([entry(path, 1)]).deletions).toEqual([
      { path, reason: 'deleted' },
    ]);
  });
});

describe('planCleanup, reason (c): the training of the trainee has ended', () => {
  it('keeps the file of a deactivated trainee by default (a deactivation can be temporary)', () => {
    const result = plan([entry(file(T_DEACTIVATED, UC_FIAE))]);
    expect(result.deletions).toEqual([]);
    expect(result.counts.keptActive).toBe(1);
  });

  it('removes the file of a deactivated trainee with --include-deactivated', () => {
    const path = file(T_DEACTIVATED, UC_FIAE);
    const result = plan([entry(path)], {}, { includeDeactivated: true });
    expect(result.deletions).toEqual([{ path, reason: 'ended' }]);
    expect(result.counts.ended).toBe(1);
  });

  it('keeps a young upload of a deactivated trainee by default, and ends it with the switch', () => {
    const path = upload(T_DEACTIVATED, UC_FIAE);
    expect(plan([entry(path, 1)]).deletions).toEqual([]);
    expect(
      plan([entry(path, 1)], {}, { includeDeactivated: true }).deletions
    ).toEqual([{ path, reason: 'ended' }]);
  });

  it('does not treat an unknown flag as a deactivation', () => {
    const result = plan(
      [entry(file(T_UNKNOWN_FLAG, UC_FIAE))],
      {},
      { includeDeactivated: true }
    );
    expect(result.deletions).toEqual([]);
  });

  it('removes the file of a use case whose occupation the trainee is no longer enrolled in', () => {
    const path = file(T_KFBM_ONLY, UC_FIAE);
    expect(plan([entry(path)]).deletions).toEqual([{ path, reason: 'ended' }]);
  });

  it('keeps the file when the trainee has an enrollment in the occupation of the use case', () => {
    const result = plan([
      entry(file(T_ACTIVE, UC_FIAE)),
      entry(file(T_ACTIVE, UC_KFBM)),
    ]);
    expect(result.deletions).toEqual([]);
    expect(result.counts.keptActive).toBe(1);
    expect(result.counts.keptDraft).toBe(1);
  });

  it('counts a trainee without an enrollment as enrolled in FIAE, like the app does', () => {
    const fiae = plan([entry(file(T_NO_ENROLLMENT, UC_FIAE))]);
    expect(fiae.deletions).toEqual([]);
    const kfbm = file(T_NO_ENROLLMENT, UC_KFBM);
    expect(plan([entry(kfbm)]).deletions).toEqual([
      { path: kfbm, reason: 'ended' },
    ]);
  });

  it('applies the end of the training to a young upload as well', () => {
    const path = upload(T_KFBM_ONLY, UC_FIAE);
    expect(plan([entry(path, 1)]).deletions).toEqual([
      { path, reason: 'ended' },
    ]);
  });
});

describe('planCleanup, what is never removed', () => {
  it('keeps the file of an active trainee with a submission', () => {
    const result = plan([entry(file(T_ACTIVE, UC_FIAE))]);
    expect(result.deletions).toEqual([]);
    expect(result.counts.keptActive).toBe(1);
  });

  it('never removes a path that is not exactly the form of the bucket', () => {
    const bad = [
      '../etc/passwd',
      `${ORG}/${T_GONE}/${UC_FIAE}/other/x.pdf`,
      `${ORG}/${T_GONE}/${UC_FIAE}/file/12345_a.exe`,
      `preview/${ORG}/${T_GONE}/${UC_FIAE}/file/1761700000000_a.pdf`,
    ];
    const result = plan(bad.map(path => entry(path)));
    expect(result.deletions).toEqual([]);
    expect(result.counts.invalidPath).toBe(bad.length);
  });

  it('uses the preview form of the paths for the preview schema only', () => {
    const preview = file(T_GONE, UC_FIAE, 'public_preview');
    const production = file(T_GONE, UC_FIAE, 'public');
    const result = plan(
      [entry(preview), entry(production)],
      {},
      { schema: 'public_preview' }
    );
    expect(result.deletions).toEqual([{ path: preview, reason: 'deleted' }]);
    expect(result.counts.invalidPath).toBe(1);
  });

  it('counts every entry exactly once', () => {
    const result = plan([
      entry(file(T_ACTIVE, UC_FIAE)),
      entry(file(T_GONE, UC_FIAE)),
      entry(upload(T_ACTIVE, UC_FIAE), 30),
      entry('x'),
    ]);
    const c = result.counts;
    expect(c.found).toBe(4);
    expect(
      c.orphan +
        c.deleted +
        c.ended +
        c.keptActive +
        c.keptDraft +
        c.keptRunningUpload +
        c.keptAgeUnknown +
        c.invalidPath
    ).toBe(4);
  });
});

// ---------------------------------------------------------------------------
// The storage behind the run (in memory)
// ---------------------------------------------------------------------------

function memoryStorage(
  initial: Array<{ path: string; createdAt: number | null }>
) {
  const objects = new Map(initial.map(e => [e.path, e.createdAt]));
  const removeCalls: string[][] = [];
  let failRemove = false;
  const storage: CleanupStorage = {
    async listFolder(prefix): Promise<CleanupListEntry[]> {
      const base = prefix === '' ? '' : `${prefix}/`;
      const names = new Map<string, CleanupListEntry>();
      for (const [path, createdAt] of objects) {
        if (!path.startsWith(base)) continue;
        const rest = path.slice(base.length);
        const [head, ...tail] = rest.split('/');
        if (tail.length === 0) {
          names.set(head, { name: head, isFolder: false, createdAt });
        } else if (!names.has(head)) {
          names.set(head, { name: head, isFolder: true, createdAt: null });
        }
      }
      return [...names.values()];
    },
    async remove(paths) {
      removeCalls.push([...paths]);
      if (failRemove) throw new Error('storage down');
      paths.forEach(path => objects.delete(path));
    },
  };
  return {
    storage,
    objects,
    removeCalls,
    failRemoves: () => {
      failRemove = true;
    },
  };
}

describe('collectEntries', () => {
  it('walks org, trainee, use case and the two folders, and nothing else', async () => {
    const good = [file(T_ACTIVE, UC_FIAE), upload(T_ACTIVE, UC_FIAE)];
    const stray = [
      // not a uuid on the second level, a wrong folder, a deeper path
      `${ORG}/not-a-uuid/${UC_FIAE}/file/1761700000000_a.pdf`,
      `${ORG}/${T_ACTIVE}/${UC_FIAE}/other/x.pdf`,
      `${ORG}/${T_ACTIVE}/${UC_FIAE}/file/deeper/1761700000000_a.pdf`,
      'readme.txt',
    ];
    const { storage } = memoryStorage(
      [...good, ...stray].map(path => ({ path, createdAt: NOW }))
    );
    const entries = await collectEntries(storage, 'public');
    expect(entries.map(e => e.path).sort()).toEqual([...good].sort());
  });

  it('reads the preview objects only under preview/ and the production ones only at the root', async () => {
    const preview = file(T_ACTIVE, UC_FIAE, 'public_preview');
    const production = file(T_ACTIVE, UC_FIAE, 'public');
    const { storage } = memoryStorage([
      { path: preview, createdAt: NOW },
      { path: production, createdAt: NOW },
    ]);
    expect(
      (await collectEntries(storage, 'public_preview')).map(e => e.path)
    ).toEqual([preview]);
    expect((await collectEntries(storage, 'public')).map(e => e.path)).toEqual([
      production,
    ]);
  });

  it('is empty for an empty bucket', async () => {
    expect(await collectEntries(memoryStorage([]).storage, 'public')).toEqual(
      []
    );
  });
});

// ---------------------------------------------------------------------------
// The whole run with a stored database and storage
// ---------------------------------------------------------------------------

describe('runCleanup', () => {
  const seed = () =>
    memoryStorage([
      // stays: active trainee with a submission, a draft, a running upload
      { path: file(T_ACTIVE, UC_FIAE), createdAt: NOW - 5 * HOUR },
      { path: file(T_ACTIVE, UC_KFBM), createdAt: NOW - 5 * HOUR },
      { path: upload(T_ACTIVE, UC_FIAE, 8), createdAt: NOW - 2 * HOUR },
      // (a) an upload that never finished
      { path: upload(T_ACTIVE, UC_FIAE, 9), createdAt: NOW - 30 * HOUR },
      // (b) deleted trainee
      { path: file(T_GONE, UC_FIAE), createdAt: NOW - 5 * HOUR },
      // (c) ended training
      { path: file(T_DEACTIVATED, UC_FIAE), createdAt: NOW - 5 * HOUR },
    ]);
  const loadFacts = jest.fn(async () => facts());
  const run = (storage: CleanupStorage, apply: boolean) =>
    runCleanup({
      storage,
      loadFacts,
      schema: 'public',
      apply,
      includeDeactivated: true,
      now: () => NOW,
    });

  it('a dry run counts the three reasons and removes nothing', async () => {
    const mem = seed();
    const before = mem.objects.size;
    const counts = await run(mem.storage, false);
    expect(counts).toMatchObject({
      found: 6,
      orphan: 1,
      deleted: 1,
      ended: 1,
      keptActive: 1,
      keptDraft: 1,
      keptRunningUpload: 1,
      removed: 0,
      failed: 0,
    });
    expect(mem.removeCalls).toEqual([]);
    expect(mem.objects.size).toBe(before);
  });

  it('a real run removes exactly the three reasons and keeps the active files', async () => {
    const mem = seed();
    const counts = await run(mem.storage, true);
    expect(counts.removed).toBe(3);
    expect([...mem.objects.keys()].sort()).toEqual(
      [
        file(T_ACTIVE, UC_FIAE),
        file(T_ACTIVE, UC_KFBM),
        upload(T_ACTIVE, UC_FIAE, 8),
      ].sort()
    );
  });

  it('is idempotent: a second run finds nothing to remove and calls remove for nothing', async () => {
    const mem = seed();
    await run(mem.storage, true);
    mem.removeCalls.length = 0;
    const counts = await run(mem.storage, true);
    expect(counts).toMatchObject({
      found: 3,
      orphan: 0,
      deleted: 0,
      ended: 0,
      removed: 0,
      failed: 0,
    });
    expect(mem.removeCalls).toEqual([]);
  });

  it('asks the database only for the ids that occur in the storage', async () => {
    const mem = seed();
    loadFacts.mockClear();
    await run(mem.storage, false);
    const [ids] = loadFacts.mock.calls[0] as unknown as [
      { traineeIds: string[]; useCaseIds: string[] },
    ];
    expect(ids.traineeIds.sort()).toEqual(
      [T_ACTIVE, T_DEACTIVATED, T_GONE].sort()
    );
    expect(ids.useCaseIds.sort()).toEqual([UC_FIAE, UC_KFBM].sort());
  });

  it('does not ask the database and removes nothing for an empty bucket', async () => {
    loadFacts.mockClear();
    const counts = await run(memoryStorage([]).storage, true);
    expect(counts.found).toBe(0);
    expect(loadFacts).not.toHaveBeenCalled();
  });

  it('removes in batches and counts a batch that fails', async () => {
    const many = Array.from({ length: CLEANUP_BATCH + 5 }, (_, i) => ({
      path: file(id(1000 + i), UC_FIAE),
      createdAt: NOW - HOUR,
    }));
    const mem = memoryStorage(many);
    const counts = await run(mem.storage, true);
    expect(counts.removed).toBe(CLEANUP_BATCH + 5);
    expect(mem.removeCalls.map(call => call.length)).toEqual([
      CLEANUP_BATCH,
      5,
    ]);

    const failing = memoryStorage(many);
    failing.failRemoves();
    const failedCounts = await run(failing.storage, true);
    expect(failedCounts.removed).toBe(0);
    expect(failedCounts.failed).toBe(CLEANUP_BATCH + 5);
  });

  it('never hands a path of another form to the storage', async () => {
    // inside the right tree, but not the form of an object of this bucket
    const strange = [
      `${ORG}/${T_GONE}/${UC_FIAE}/file/evil.exe`,
      `${ORG}/${T_GONE}/${UC_FIAE}/file/1761700000000_a.exe`,
      `${ORG}/${T_GONE}/${UC_FIAE}/incoming/not-a-uuid.pdf`,
    ];
    const mem = memoryStorage([
      { path: file(T_GONE, UC_FIAE), createdAt: NOW },
      ...strange.map(path => ({ path, createdAt: NOW })),
    ]);
    const counts = await run(mem.storage, true);
    expect(counts.invalidPath).toBe(3);
    expect(counts.removed).toBe(1);
    expect(mem.removeCalls).toEqual([[file(T_GONE, UC_FIAE)]]);
    for (const path of strange) expect(mem.objects.has(path)).toBe(true);
  });

  it('refuses a real run when the database knows none of the trainees', async () => {
    const mem = seed();
    const empty = jest.fn(async () => ({
      profiles: new Map(),
      useCases: new Map(),
      submissions: new Set<string>(),
      enrollments: new Map(),
    }));
    await expect(
      runCleanup({
        storage: mem.storage,
        loadFacts: empty,
        schema: 'public',
        apply: true,
        includeDeactivated: false,
        now: () => NOW,
      })
    ).rejects.toMatchObject({ code: 'DATABASE_UNKNOWN' });
    expect(mem.removeCalls).toEqual([]);
    // a dry run only counts
    const counts = await runCleanup({
      storage: mem.storage,
      loadFacts: empty,
      schema: 'public',
      apply: false,
      includeDeactivated: false,
      now: () => NOW,
    });
    expect(counts.deleted).toBe(6);
  });
});

describe('renderCleanupReport', () => {
  it('shows numbers only, no id, no path, no name', async () => {
    const mem = memoryStorage([
      { path: file(T_GONE, UC_FIAE), createdAt: NOW },
    ]);
    const counts = await runCleanup({
      storage: mem.storage,
      loadFacts: async () => facts(),
      schema: 'public',
      apply: false,
      includeDeactivated: false,
      now: () => NOW,
    });
    const text = renderCleanupReport(counts, {
      mode: 'dry-run',
      target: 'local',
      schema: 'public',
    });
    expect(text).toMatch(/dry-run/);
    expect(text).toMatch(/deleted\s*:\s*1/);
    expect(text).not.toContain(T_GONE);
    expect(text).not.toContain(ORG);
    expect(text).not.toMatch(/\.pdf/);
    expect(text).toMatch(/nothing was removed/i);
  });

  it('says what was removed for a real run', () => {
    const text = renderCleanupReport(
      {
        found: 3,
        orphan: 1,
        deleted: 1,
        ended: 1,
        keptActive: 0,
        keptDraft: 0,
        keptRunningUpload: 0,
        keptAgeUnknown: 0,
        invalidPath: 0,
        removed: 3,
        failed: 0,
      },
      { mode: 'apply', target: 'preview', schema: 'public_preview' }
    );
    expect(text).toMatch(/removed\s*:\s*3/);
  });
});

// ---------------------------------------------------------------------------
// The arguments
// ---------------------------------------------------------------------------

describe('parseCleanupArgs', () => {
  it('defaults to a dry run and needs a target', () => {
    expect(parseCleanupArgs([])).toEqual({
      ok: false,
      errors: ['--target local|preview is required'],
    });
    const ok = parseCleanupArgs(['--target', 'local']);
    expect(ok).toEqual({
      ok: true,
      args: {
        target: 'local',
        apply: false,
        confirmHost: null,
        confirmStorageHost: null,
        includeDeactivated: false,
      },
    });
  });

  it('needs --confirm-storage-host for a real run, and --confirm-host in the preview', () => {
    const local = parseCleanupArgs(['--target', 'local', '--apply']);
    expect(local.ok).toBe(false);
    expect(JSON.stringify(local)).toMatch(/--confirm-storage-host/);
    const preview = parseCleanupArgs([
      '--target=preview',
      '--apply',
      '--confirm-storage-host',
      'Project.Supabase.example',
    ]);
    expect(preview.ok).toBe(false);
    expect(JSON.stringify(preview)).toMatch(/--confirm-host/);
    const full = parseCleanupArgs([
      '--target',
      'preview',
      '--apply',
      '--confirm-storage-host',
      'Project.Supabase.example',
      '--confirm-host',
      'DB.example',
      '--include-deactivated',
    ]);
    expect(full).toEqual({
      ok: true,
      args: {
        target: 'preview',
        apply: true,
        confirmHost: 'db.example',
        confirmStorageHost: 'project.supabase.example',
        includeDeactivated: true,
      },
    });
  });

  it('refuses the confirmations without --apply', () => {
    const result = parseCleanupArgs([
      '--target',
      'local',
      '--confirm-storage-host',
      'localhost:54321',
    ]);
    expect(result.ok).toBe(false);
    expect(JSON.stringify(result)).toMatch(/belongs to --apply/);
  });

  it('refuses production in every form, and unknown or doubled arguments', () => {
    for (const argv of [
      ['--target', 'production'],
      ['--target=Production'],
      ['--production'],
    ]) {
      const result = parseCleanupArgs(argv);
      expect(result.ok).toBe(false);
      expect(JSON.stringify(result)).toMatch(/Production is not supported/);
    }
    for (const argv of [
      ['--target', 'local', '--bucket', 'other'],
      ['--target', 'local', 'extra'],
      ['--target', 'local', '--target', 'preview'],
      ['--target'],
      ['--target', 'staging'],
      ['--target', 'local', '--apply=yes'],
    ]) {
      expect(parseCleanupArgs(argv).ok).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// The storage API
// ---------------------------------------------------------------------------

describe('createCleanupStorage', () => {
  const URL_BASE = 'https://project.supabase.example.invalid';

  it('lists page by page from the private bucket only, and marks folders', async () => {
    const calls: Array<{ url: string; body: any }> = [];
    const pages = [
      Array.from({ length: 100 }, (_, i) => ({ name: `f${i}`, id: null })),
      [
        { name: 'o.pdf', id: 'x', created_at: '2026-10-28T10:00:00.000Z' },
        { name: 'bad', id: 'y', created_at: 'not a date' },
        { name: 'none', id: 'z' },
      ],
    ];
    const fetchImpl = jest.fn(async (url: any, init: any) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response(JSON.stringify(pages.shift()), { status: 200 });
    });
    const storage = createCleanupStorage({
      url: URL_BASE,
      key: 'secret-key',
      fetchImpl: fetchImpl as any,
    });
    const entries = await storage.listFolder('preview');
    expect(entries).toHaveLength(103);
    expect(entries[0]).toEqual({ name: 'f0', isFolder: true, createdAt: null });
    expect(entries[100]).toEqual({
      name: 'o.pdf',
      isFolder: false,
      createdAt: Date.parse('2026-10-28T10:00:00.000Z'),
    });
    expect(entries[101].createdAt).toBeNull();
    expect(entries[102].createdAt).toBeNull();
    expect(calls.map(c => c.url)).toEqual([
      `${URL_BASE}/storage/v1/object/list/submission-files`,
      `${URL_BASE}/storage/v1/object/list/submission-files`,
    ]);
    expect(calls[0].body).toMatchObject({
      prefix: 'preview',
      limit: 100,
      offset: 0,
    });
    expect(calls[1].body).toMatchObject({ offset: 100 });
    const init = fetchImpl.mock.calls[0][1] as any;
    expect(init.redirect).toBe('error');
    expect(init.headers.Authorization).toBe('Bearer secret-key');
  });

  it('removes only paths of the exact form, from the private bucket only', async () => {
    const fetchImpl = jest.fn(async () => new Response('{}', { status: 200 }));
    const storage = createCleanupStorage({
      url: URL_BASE,
      key: 'k',
      fetchImpl: fetchImpl as any,
      schema: 'public',
    });
    const good = file(T_GONE, UC_FIAE);
    await storage.remove([good]);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, any];
    expect(url).toBe(`${URL_BASE}/storage/v1/object/submission-files`);
    expect(init.method).toBe('DELETE');
    expect(JSON.parse(init.body)).toEqual({ prefixes: [good] });
    await expect(storage.remove([good, '../x'])).rejects.toMatchObject({
      code: 'INVALID_PATH',
    });
    await expect(
      storage.remove([file(T_GONE, UC_FIAE, 'public_preview')])
    ).rejects.toMatchObject({ code: 'INVALID_PATH' });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    await storage.remove([]);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('fails with a message that holds neither the key nor the address', async () => {
    const storage = createCleanupStorage({
      url: URL_BASE,
      key: 'secret-key',
      fetchImpl: (async () => new Response('x', { status: 500 })) as any,
    });
    const error = await storage.listFolder('').catch(e => e);
    expect(error.message).toMatch(/500/);
    expect(error.message).not.toContain('secret-key');
    expect(error.message).not.toContain('project.supabase');
    const removing = await storage
      .remove([file(T_GONE, UC_FIAE)])
      .catch(e => e);
    expect(removing.message).toMatch(/500/);
  });

  it('stops a folder that never ends', async () => {
    const fetchImpl = async () =>
      new Response(
        JSON.stringify(
          Array.from({ length: 100 }, (_, i) => ({ name: `f${i}`, id: null }))
        ),
        { status: 200 }
      );
    const storage = createCleanupStorage({
      url: URL_BASE,
      key: 'k',
      fetchImpl: fetchImpl as any,
    });
    await expect(storage.listFolder('')).rejects.toMatchObject({
      code: 'TOO_MANY_ENTRIES',
    });
  });

  it('refuses an answer that is no list', async () => {
    const storage = createCleanupStorage({
      url: URL_BASE,
      key: 'k',
      fetchImpl: (async () => new Response('{"a":1}', { status: 200 })) as any,
    });
    await expect(storage.listFolder('')).rejects.toMatchObject({
      code: 'BAD_ANSWER',
    });
  });
});

// ---------------------------------------------------------------------------
// The facts from the database
// ---------------------------------------------------------------------------

describe('loadCleanupFacts', () => {
  it('reads profiles, use cases, submissions and enrollments for the ids given', async () => {
    const calls: Array<{ sql: string; params: unknown[] }> = [];
    const query = jest.fn(async (sql: string, params: unknown[]) => {
      calls.push({ sql, params });
      if (/from profiles/.test(sql)) {
        return { rows: [{ id: T_ACTIVE, is_active: true }] };
      }
      if (/from use_cases/.test(sql)) {
        return { rows: [{ id: UC_KFBM, catalog_id: KFBM_CATALOG_ID }] };
      }
      if (/from use_case_submissions/.test(sql)) {
        return { rows: [{ trainee_id: T_ACTIVE, use_case_id: UC_KFBM }] };
      }
      return {
        rows: [
          { trainee_id: T_ACTIVE, catalog_id: FIAE_CATALOG_ID },
          { trainee_id: T_ACTIVE, catalog_id: KFBM_CATALOG_ID },
        ],
      };
    });
    const loaded = await loadCleanupFacts(query, {
      traineeIds: [T_ACTIVE],
      useCaseIds: [UC_KFBM],
    });
    expect(loaded.profiles.get(T_ACTIVE)).toEqual({ isActive: true });
    expect(loaded.useCases.get(UC_KFBM)).toEqual({
      catalogId: KFBM_CATALOG_ID,
    });
    expect(loaded.submissions.has(`${T_ACTIVE}:${UC_KFBM}`)).toBe(true);
    expect(loaded.enrollments.get(T_ACTIVE)).toEqual([
      FIAE_CATALOG_ID,
      KFBM_CATALOG_ID,
    ]);
    // read only, parameters instead of text in the statement
    for (const call of calls) {
      expect(call.sql.trim().toLowerCase().startsWith('select')).toBe(true);
      expect(call.sql).not.toContain(T_ACTIVE);
    }
  });

  it('does not query for an empty id list', async () => {
    const query = jest.fn(async () => ({ rows: [] }));
    const loaded = await loadCleanupFacts(query, {
      traineeIds: [],
      useCaseIds: [],
    });
    expect(query).not.toHaveBeenCalled();
    expect(loaded.profiles.size).toBe(0);
  });

  it('maps an is_active that is neither true nor false to null', async () => {
    const query = jest.fn(async (sql: string) =>
      /from profiles/.test(sql)
        ? { rows: [{ id: T_ACTIVE, is_active: null }] }
        : { rows: [] }
    );
    const loaded = await loadCleanupFacts(query, {
      traineeIds: [T_ACTIVE],
      useCaseIds: [UC_FIAE],
    });
    expect(loaded.profiles.get(T_ACTIVE)).toEqual({ isActive: null });
  });
});
