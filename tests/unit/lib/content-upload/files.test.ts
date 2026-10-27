/**
 * @jest-environment node
 */
import { LIMITS } from '@/lib/content-upload/config';
import {
  announceFiles,
  completeFiles,
  issueUploadUrls,
  listRunFiles,
  parseFileIds,
} from '@/lib/content-upload/files';
import { parseUploadStoragePath } from '@/lib/content-upload/paths';
import { resetRateLimits } from '@/lib/rate-limit';
import {
  OTHER_ADMIN,
  SUPER,
  docxBytes,
  entryFor,
  newRun,
  pdfBytes,
  setup,
} from '../../../helpers/uploadServiceFixtures';

beforeEach(() => {
  resetRateLimits();
});

async function announceOne(
  ctx: ReturnType<typeof setup>,
  runId: string,
  path: string,
  bytes: Uint8Array
) {
  const run = (await ctx.repo.getRun(runId))!;
  const result = await announceFiles(ctx.deps, run, {
    files: [entryFor(path, bytes)],
  });
  if (!result.ok) throw new Error(result.error);
  const item = result.data.results[0];
  if (!item.fileId) throw new Error(`not announced: ${item.code}`);
  return item.fileId;
}

describe('announceFiles', () => {
  it('announces files and lets the server choose the storage path', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const a = pdfBytes('a');
    const b = docxBytes('b');
    const result = await announceFiles(ctx.deps, run, {
      files: [
        entryFor('K1/Enabler/a.pdf', a),
        entryFor('K1/Enabler/b.docx', b),
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.counts).toEqual({
      announced: 2,
      merged: 0,
      existing: 0,
      rejected: 0,
    });
    expect(result.data.results.map(r => r.status)).toEqual([
      'announced',
      'announced',
    ]);
    // the answer names ids, never a storage path
    expect(JSON.stringify(result.data)).not.toContain('upload/');
    const rows = await ctx.repo.listFiles(run.id, { offset: 0, limit: 10 });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      const parsed = parseUploadStoragePath(row.storagePath, 'public');
      expect(parsed).toEqual({ runId: run.id, fileId: row.id, ext: row.ext });
    }
    expect((await ctx.repo.getRun(run.id))?.status).toBe('uploading');
  });

  it('never builds a storage path from what the user sent', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const bytes = pdfBytes('x');
    await announceFiles(ctx.deps, run, {
      files: [
        entryFor('../../etc/passwd.pdf', bytes),
        entryFor('C:\\Windows\\..\\evil%2e%2e.pdf', pdfBytes('y')),
      ],
    });
    const rows = await ctx.repo.listFiles(run.id, { offset: 0, limit: 10 });
    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.storagePath).toMatch(
        /^upload\/[0-9a-f-]{36}\/[0-9a-f-]{36}\.pdf$/
      );
      expect(row.storagePath).not.toContain('passwd');
      expect(row.storagePath).not.toContain('evil');
    }
    expect(rows.map(r => r.relPath).sort()).toEqual([
      'Windows/evil%2e%2e.pdf',
      'etc/passwd.pdf',
    ]);
  });

  it('reports a file that cannot be taken with its reason and goes on', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const good = pdfBytes('good');
    const result = await announceFiles(ctx.deps, run, {
      files: [
        entryFor('a/old.doc', good),
        {
          path: 'a/huge.pdf',
          size: LIMITS.maxFileBytes + 1,
          sha256: 'a'.repeat(64),
        },
        { path: 'a/nohash.pdf', size: 10, sha256: 'xyz' },
        entryFor('a/good.pdf', good),
        entryFor('a/~$lock.docx', docxBytes('l')),
        { path: 7, size: 1, sha256: 'a'.repeat(64) },
        null,
      ],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results.map(r => [r.index, r.status, r.code])).toEqual([
      [0, 'rejected', 'UNSUPPORTED_EXTENSION'],
      [1, 'rejected', 'TOO_LARGE'],
      [2, 'rejected', 'HASH_INVALID'],
      [3, 'announced', undefined],
      [4, 'rejected', 'TEMP_FILE'],
      [5, 'rejected', 'PATH_INVALID'],
      [6, 'rejected', 'ENTRY_INVALID'],
    ]);
    expect(result.data.counts).toMatchObject({ announced: 1, rejected: 6 });
    expect(
      await ctx.repo.listFiles(run.id, { offset: 0, limit: 10 })
    ).toHaveLength(1);
  });

  it('answers a file with no valid entry at all without touching the run', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const result = await announceFiles(ctx.deps, run, {
      files: [entryFor('a/x.xlsx', pdfBytes())],
    });
    expect(result.ok && result.data.counts.rejected).toBe(1);
    expect((await ctx.repo.getRun(run.id))?.status).toBe('draft');
  });

  it.each([
    [null],
    [{}],
    [{ files: [] }],
    [{ files: 'x' }],
    [{ files: Array.from({ length: 51 }, () => ({})) }],
  ])('answers 400 for the body %j', async body => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const result = await announceFiles(ctx.deps, run, body);
    expect(result).toMatchObject({ ok: false, status: 400 });
  });

  it('accepts exactly 50 files in one request', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const files = Array.from({ length: 50 }, (_, i) =>
      entryFor(`d/f${i}.pdf`, pdfBytes(`content ${i}`))
    );
    const result = await announceFiles(ctx.deps, run, { files });
    expect(result.ok && result.data.counts.announced).toBe(50);
  });

  it('is idempotent: announcing the same files again changes nothing', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const body = { files: [entryFor('a/x.pdf', pdfBytes('x'))] };
    const first = await announceFiles(ctx.deps, run, body);
    const second = await announceFiles(ctx.deps, run, body);
    expect(first.ok && second.ok).toBe(true);
    if (!first.ok || !second.ok) return;
    expect(second.data.results[0]).toMatchObject({
      status: 'existing',
      fileId: first.data.results[0].fileId,
      fileStatus: 'announced',
    });
    expect(
      await ctx.repo.listFiles(run.id, { offset: 0, limit: 10 })
    ).toHaveLength(1);
  });

  it('merges exact copies inside the run and keeps one object', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const bytes = pdfBytes('same');
    const result = await announceFiles(ctx.deps, run, {
      files: [entryFor('a/one.pdf', bytes), entryFor('b/copy.pdf', bytes)],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.results.map(r => r.status)).toEqual([
      'announced',
      'merged',
    ]);
    expect(result.data.results[1].duplicateOfId).toBe(
      result.data.results[0].fileId
    );
  });

  it('hints at a file that an earlier run applied', async () => {
    const ctx = setup();
    const first = await newRun(ctx.deps);
    const bytes = pdfBytes('known');
    const id = await announceOne(ctx, first.id, 'a/x.pdf', bytes);
    ctx.repo.forceFileStatus(id, 'applied');
    const second = await newRun(ctx.deps);
    const result = await announceFiles(ctx.deps, second, {
      files: [entryFor('other/x.pdf', bytes)],
    });
    expect(result.ok && result.data.results[0]).toMatchObject({
      status: 'announced',
      alreadyApplied: { runId: first.id },
    });
  });

  it('warns when the staging area is nearly full', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const fillers = [await newRun(ctx.deps), await newRun(ctx.deps)];
    // fill 1700 of 2048 MB with files that were announced earlier (a run holds 1 GB)
    for (let i = 0; i < 68; i++) {
      const other = fillers[i < 34 ? 0 : 1];
      const id = `00000000-0000-4000-8000-${String(i).padStart(12, '0')}`;
      await ctx.repo.announce(other.id, [
        {
          index: 0,
          id,
          relPath: `big${i}.pdf`,
          fileName: `big${i}.pdf`,
          ext: 'pdf',
          sizeBytes: 25 * 1024 * 1024,
          sha256: i.toString(16).padStart(64, '0'),
          clientMtimeMs: null,
          storagePath: `upload/${other.id}/${id}.pdf`,
        },
      ]);
    }
    const result = await announceFiles(ctx.deps, run, {
      files: [entryFor('a/x.pdf', pdfBytes('x'))],
    });
    expect(result.ok && result.data.warnings).toEqual([
      expect.objectContaining({ code: 'STAGING_NEAR_LIMIT' }),
    ]);
  });

  it.each(['processing', 'review', 'discarded', 'applied', 'failed'] as const)(
    'answers 409 for a run that is %s',
    async status => {
      const ctx = setup();
      const run = await newRun(ctx.deps);
      ctx.repo.forceRunStatus(run.id, status);
      const current = (await ctx.repo.getRun(run.id))!;
      const result = await announceFiles(ctx.deps, current, {
        files: [entryFor('a/x.pdf', pdfBytes())],
      });
      expect(result).toMatchObject({
        ok: false,
        status: 409,
        code: 'RUN_STATE',
      });
    }
  );

  it('answers 409 when the run changed after it was loaded', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    ctx.repo.forceRunStatus(run.id, 'discarded');
    // the caller still holds the old row (status draft)
    const result = await announceFiles(ctx.deps, run, {
      files: [entryFor('a/x.pdf', pdfBytes())],
    });
    expect(result).toMatchObject({ ok: false, status: 409 });
  });
});

describe('listRunFiles', () => {
  it('lists id, cleaned path, size, hash and state, never the storage path', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    await announceOne(ctx, run.id, 'a/x.pdf', pdfBytes('x'));
    const result = await listRunFiles(ctx.deps, run, {});
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.files).toHaveLength(1);
    expect(Object.keys(result.data.files[0]).sort()).toEqual([
      'createdAt',
      'docType',
      'duplicateOfId',
      'ext',
      'fileName',
      'id',
      'relPath',
      'sha256',
      'sizeBytes',
      'status',
      'statusCode',
    ]);
    expect(JSON.stringify(result.data)).not.toContain('upload/');
  });

  it('pages with offset and limit and caps the page at 500', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const files = Array.from({ length: 5 }, (_, i) =>
      entryFor(`d/f${i}.pdf`, pdfBytes(`c${i}`))
    );
    await announceFiles(ctx.deps, run, { files });
    const page = await listRunFiles(ctx.deps, run, { offset: '2', limit: '2' });
    expect(page.ok && page.data.files).toHaveLength(2);
    const big = await listRunFiles(ctx.deps, run, { limit: '100000' });
    expect(big.ok && big.data.limit).toBe(500);
  });

  it.each([
    { offset: '-1' },
    { limit: '0' },
    { offset: 'x' },
    { limit: '1.5' },
  ])('answers 400 for %j', async query => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    expect(await listRunFiles(ctx.deps, run, query)).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});

describe('parseFileIds', () => {
  const id = '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11';
  it('takes 1 to 50 uuids, without duplicates, lower cased', () => {
    expect(parseFileIds({ fileIds: [id, id.toUpperCase()] })).toEqual({
      ok: true,
      data: [id],
    });
  });
  it.each([
    [null],
    [{}],
    [{ fileIds: [] }],
    [{ fileIds: 'x' }],
    [{ fileIds: ['nope'] }],
    [{ fileIds: [id, 5] }],
    [{ fileIds: Array.from({ length: 51 }, () => id) }],
  ])('refuses %j', body => {
    expect(parseFileIds(body)).toMatchObject({ ok: false, status: 400 });
  });
});

describe('issueUploadUrls', () => {
  it('makes a signed url per announced file, without upsert', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const a = await announceOne(ctx, run.id, 'a/a.pdf', pdfBytes('a'));
    const b = await announceOne(ctx, run.id, 'a/b.docx', docxBytes('b'));
    const result = await issueUploadUrls(ctx.deps, SUPER, run, {
      fileIds: [a, b],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.data.items).toHaveLength(2);
    for (const item of result.data.items) {
      expect(item.ok).toBe(true);
      if (!item.ok) continue;
      expect(parseUploadStoragePath(item.path, 'public')?.runId).toBe(run.id);
      expect(item.token).toContain('token-for-');
    }
    expect(ctx.mem.signed).toHaveLength(2);
    expect(ctx.mem.signed.every(s => s.upsert === false)).toBe(true);
  });

  it('makes no url for a file of another run, an unknown file or one that is not announced', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const other = await newRun(ctx.deps, OTHER_ADMIN);
    const mine = await announceOne(ctx, run.id, 'a/a.pdf', pdfBytes('a'));
    const foreign = await announceOne(ctx, other.id, 'a/b.pdf', pdfBytes('b'));
    const uploaded = await announceOne(ctx, run.id, 'a/c.pdf', pdfBytes('c'));
    await ctx.repo.transitionFile(run.id, uploaded, 'announced', 'uploaded');
    const unknown = '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11';
    const result = await issueUploadUrls(ctx.deps, SUPER, run, {
      fileIds: [mine, foreign, uploaded, unknown],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const byId = Object.fromEntries(result.data.items.map(i => [i.fileId, i]));
    expect(byId[mine].ok).toBe(true);
    expect(byId[foreign]).toEqual({
      fileId: foreign,
      ok: false,
      code: 'NOT_FOUND',
    });
    expect(byId[uploaded]).toEqual({
      fileId: uploaded,
      ok: false,
      code: 'NOT_ANNOUNCED',
    });
    expect(byId[unknown]).toEqual({
      fileId: unknown,
      ok: false,
      code: 'NOT_FOUND',
    });
    // only one path went to the storage
    expect(ctx.mem.signed).toHaveLength(1);
  });

  it('makes no url for a discarded run or one that is no longer open', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const id = await announceOne(ctx, run.id, 'a/a.pdf', pdfBytes('a'));
    for (const status of ['discarded', 'processing', 'review'] as const) {
      ctx.repo.forceRunStatus(run.id, status);
      const current = (await ctx.repo.getRun(run.id))!;
      expect(
        await issueUploadUrls(ctx.deps, SUPER, current, { fileIds: [id] })
      ).toMatchObject({ ok: false, status: 409, code: 'RUN_STATE' });
    }
    expect(ctx.mem.signed).toEqual([]);
  });

  it('reports an object that already exists and a storage that fails, per file', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const a = await announceOne(ctx, run.id, 'a/a.pdf', pdfBytes('a'));
    const b = await announceOne(ctx, run.id, 'a/b.pdf', pdfBytes('b'));
    const rows = await ctx.repo.getFiles(run.id, [a]);
    ctx.mem.put(rows[0].storagePath, pdfBytes('a'));
    const first = await issueUploadUrls(ctx.deps, SUPER, run, {
      fileIds: [a, b],
    });
    expect(
      first.ok && first.data.items.map(i => (i.ok ? 'ok' : i.code))
    ).toEqual(['OBJECT_EXISTS', 'ok']);
    const failing = {
      ...ctx.deps,
      storage: () => {
        throw new Error('not configured');
      },
    };
    const second = await issueUploadUrls(failing, SUPER, run, { fileIds: [b] });
    expect(second.ok && second.data.items[0]).toEqual({
      fileId: b,
      ok: false,
      code: 'STORAGE_UNAVAILABLE',
    });
  });

  it('answers 400 for a bad body', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    expect(
      await issueUploadUrls(ctx.deps, SUPER, run, { fileIds: ['x'] })
    ).toMatchObject({
      ok: false,
      status: 400,
    });
  });

  it('allows 60 requests per minute from the database counter and refuses the 61st', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const id = await announceOne(ctx, run.id, 'a/a.pdf', pdfBytes('a'));
    // the counter of the database is used up by earlier requests (other instances)
    for (let i = 0; i < 60; i++) await ctx.repo.reserveUrlRequest(SUPER.id);
    const result = await issueUploadUrls(ctx.deps, SUPER, run, {
      fileIds: [id],
    });
    expect(result).toMatchObject({
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
    });
    expect(result.ok === false && result.retryAfterSec).toBeGreaterThanOrEqual(
      1
    );
    expect(ctx.mem.signed).toEqual([]);
    // a different person is not affected
    const other = await newRun(ctx.deps, OTHER_ADMIN);
    const otherId = await announceOne(ctx, other.id, 'a/b.pdf', pdfBytes('b'));
    const ok = await issueUploadUrls(ctx.deps, OTHER_ADMIN, other, {
      fileIds: [otherId],
    });
    expect(ok.ok).toBe(true);
  });

  it('also limits bursts on the instance, before the database is asked', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const id = await announceOne(ctx, run.id, 'a/a.pdf', pdfBytes('a'));
    const reserve = jest.spyOn(ctx.repo, 'reserveUrlRequest');
    for (let i = 0; i < 60; i++) {
      const r = await issueUploadUrls(ctx.deps, SUPER, run, { fileIds: [id] });
      expect(r.ok).toBe(true);
    }
    expect(reserve).toHaveBeenCalledTimes(60);
    const refused = await issueUploadUrls(ctx.deps, SUPER, run, {
      fileIds: [id],
    });
    expect(refused).toMatchObject({
      ok: false,
      status: 429,
      code: 'RATE_LIMITED',
    });
    // the 61st never reached the database counter
    expect(reserve).toHaveBeenCalledTimes(60);
  });
});

describe('completeFiles', () => {
  async function prepared(path: string, bytes: Uint8Array, stored = bytes) {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const id = await announceOne(ctx, run.id, path, bytes);
    const [row] = await ctx.repo.getFiles(run.id, [id]);
    ctx.mem.put(row.storagePath, stored);
    return { ctx, run, id, row };
  }

  it.each([
    ['a/x.pdf', pdfBytes('x')],
    ['a/x.docx', docxBytes('x')],
  ])('queues a good file (%s)', async (path, bytes) => {
    const { ctx, run, id } = await prepared(path, bytes);
    const result = await completeFiles(ctx.deps, run, { fileIds: [id] });
    expect(result.ok && result.data.results).toEqual([
      { fileId: id, status: 'uploaded' },
    ]);
    const [row] = await ctx.repo.getFiles(run.id, [id]);
    expect(row.status).toBe('uploaded');
    expect(row.completedAt).toBeInstanceOf(Date);
  });

  it('rejects a file whose size differs and deletes the object', async () => {
    const bytes = pdfBytes('announced');
    const { ctx, run, id, row } = await prepared(
      'a/x.pdf',
      bytes,
      pdfBytes('announced and more')
    );
    const result = await completeFiles(ctx.deps, run, { fileIds: [id] });
    expect(result.ok && result.data.results).toEqual([
      { fileId: id, status: 'rejected', code: 'SIZE_MISMATCH' },
    ]);
    expect(ctx.mem.objects.has(row.storagePath)).toBe(false);
    const [after] = await ctx.repo.getFiles(run.id, [id]);
    expect(after.status).toBe('rejected');
    expect(after.statusCode).toBe('SIZE_MISMATCH');
    expect(after.parseSummary).toEqual({ objectDeleted: true });
  });

  it.each([
    ['a/x.pdf', 'NOT_A_PDF', () => docxBytes('same length..')],
    ['a/x.docx', 'NOT_A_DOCX', () => pdfBytes('same length..')],
  ])(
    'rejects wrong magic bytes (%s) and deletes the object',
    async (path, code, other) => {
      const stored = other();
      // announce with the size of what is stored, so only the type is wrong
      const ctx = setup();
      const run = await newRun(ctx.deps);
      const result = await announceFiles(ctx.deps, run, {
        files: [entryFor(path, stored)],
      });
      const id = result.ok ? result.data.results[0].fileId! : '';
      const [row] = await ctx.repo.getFiles(run.id, [id]);
      ctx.mem.put(row.storagePath, stored);
      const done = await completeFiles(ctx.deps, run, { fileIds: [id] });
      expect(done.ok && done.data.results).toEqual([
        { fileId: id, status: 'rejected', code },
      ]);
      expect(ctx.mem.objects.has(row.storagePath)).toBe(false);
    }
  );

  it('keeps a file announced when its object is not there yet', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const id = await announceOne(ctx, run.id, 'a/x.pdf', pdfBytes('x'));
    const result = await completeFiles(ctx.deps, run, { fileIds: [id] });
    expect(result.ok && result.data.results).toEqual([
      { fileId: id, status: 'announced', code: 'OBJECT_MISSING' },
    ]);
  });

  it('keeps a file announced when the storage cannot be read', async () => {
    const { ctx, run, id } = await prepared('a/x.pdf', pdfBytes('x'));
    ctx.mem.failProbe = true;
    const result = await completeFiles(ctx.deps, run, { fileIds: [id] });
    expect(result.ok && result.data.results).toEqual([
      { fileId: id, status: 'announced', code: 'STORAGE_UNAVAILABLE' },
    ]);
  });

  it('rejects anyway when the object cannot be removed, and leaves the marker out', async () => {
    const { ctx, run, id, row } = await prepared(
      'a/x.pdf',
      pdfBytes('abc'),
      pdfBytes('abcd')
    );
    ctx.mem.failRemoveFor.add(row.storagePath);
    const result = await completeFiles(ctx.deps, run, { fileIds: [id] });
    expect(result.ok && result.data.results[0]).toMatchObject({
      status: 'rejected',
      code: 'SIZE_MISMATCH',
    });
    const [after] = await ctx.repo.getFiles(run.id, [id]);
    expect(after.parseSummary).toBeNull();
    // the cleanup still finds it
    expect(
      (await ctx.repo.filesNeedingObjectRemoval(10)).map(f => f.id)
    ).toEqual([id]);
  });

  it('is idempotent: a second report returns the state it is in', async () => {
    const { ctx, run, id } = await prepared('a/x.pdf', pdfBytes('x'));
    await completeFiles(ctx.deps, run, { fileIds: [id] });
    const again = await completeFiles(ctx.deps, run, { fileIds: [id] });
    expect(again.ok && again.data.results).toEqual([
      { fileId: id, status: 'uploaded' },
    ]);
  });

  it('is safe when two reports for the same file arrive at the same time', async () => {
    const { ctx, run, id } = await prepared('a/x.pdf', pdfBytes('x'));
    const transition = jest.spyOn(ctx.repo, 'transitionFile');
    const [a, b] = await Promise.all([
      completeFiles(ctx.deps, run, { fileIds: [id] }),
      completeFiles(ctx.deps, run, { fileIds: [id] }),
    ]);
    expect(a.ok && a.data.results[0].status).toBe('uploaded');
    expect(b.ok && b.data.results[0].status).toBe('uploaded');
    const [row] = await ctx.repo.getFiles(run.id, [id]);
    expect(row.status).toBe('uploaded');
    expect(transition.mock.calls.length).toBeGreaterThanOrEqual(1);
  });

  it('answers per file: unknown, foreign, expired and merged files', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const other = await newRun(ctx.deps, OTHER_ADMIN);
    const foreign = await announceOne(ctx, other.id, 'a/f.pdf', pdfBytes('f'));
    const same = pdfBytes('same');
    const first = await announceFiles(ctx.deps, run, {
      files: [entryFor('a/one.pdf', same), entryFor('b/copy.pdf', same)],
    });
    const mergedId = first.ok ? first.data.results[1].fileId! : '';
    const unknown = '8b1d1c52-6f3e-4b5a-9d63-2f6a1c0a9e11';
    const result = await completeFiles(ctx.deps, run, {
      fileIds: [foreign, unknown, mergedId],
    });
    expect(result.ok && result.data.results).toEqual([
      { fileId: foreign, status: 'unknown', code: 'NOT_FOUND' },
      { fileId: unknown, status: 'unknown', code: 'NOT_FOUND' },
      { fileId: mergedId, status: 'merged' },
    ]);
    // the foreign file was not touched
    const [row] = await ctx.repo.getFiles(other.id, [foreign]);
    expect(row.status).toBe('announced');
  });

  it('answers 409 for a run that is discarded', async () => {
    const { ctx, run, id } = await prepared('a/x.pdf', pdfBytes('x'));
    ctx.repo.forceRunStatus(run.id, 'discarded');
    const current = (await ctx.repo.getRun(run.id))!;
    expect(
      await completeFiles(ctx.deps, current, { fileIds: [id] })
    ).toMatchObject({
      ok: false,
      status: 409,
    });
  });

  it('still takes a late report while the run is already processing', async () => {
    const { ctx, run, id } = await prepared('a/x.pdf', pdfBytes('x'));
    ctx.repo.forceRunStatus(run.id, 'processing');
    const current = (await ctx.repo.getRun(run.id))!;
    const result = await completeFiles(ctx.deps, current, { fileIds: [id] });
    expect(result.ok && result.data.results[0].status).toBe('uploaded');
  });

  it('answers 400 for a bad body', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    expect(await completeFiles(ctx.deps, run, {})).toMatchObject({
      ok: false,
      status: 400,
    });
  });
});
