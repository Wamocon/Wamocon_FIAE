/**
 * @jest-environment node
 */
import {
  deleteOrphans,
  listOrphans,
  removePendingObjects,
  runCleanup,
} from '@/lib/content-upload/cleanup';
import { announceFiles, completeFiles } from '@/lib/content-upload/files';
import { discardRun } from '@/lib/content-upload/runs';
import {
  OTHER_ADMIN,
  SUPER,
  entryFor,
  newRun,
  pdfBytes,
  setup,
} from '../../../helpers/uploadServiceFixtures';

type Ctx = ReturnType<typeof setup>;

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const RUN = '0b8f4c1e-5d7a-4b1c-9d2e-1a2b3c4d5e6f';
const FILE = 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d';

/** Announces files and puts their objects into the storage (not reported as done). */
async function staged(ctx: Ctx, runId: string, count: number, tag = 's') {
  const run = (await ctx.repo.getRun(runId))!;
  const contents = Array.from({ length: count }, (_, i) =>
    pdfBytes(`${tag} ${i}`)
  );
  const result = await announceFiles(ctx.deps, run, {
    files: contents.map((b, i) => entryFor(`d/${tag}${i}.pdf`, b)),
  });
  if (!result.ok) throw new Error(result.error);
  const ids = result.data.results.map(r => r.fileId!);
  const rows = await ctx.repo.getFiles(runId, ids);
  for (const row of rows) {
    ctx.mem.put(row.storagePath, contents[ids.indexOf(row.id)]);
  }
  return { ids, paths: rows.map(r => r.storagePath), run };
}

async function uploadedFiles(
  ctx: Ctx,
  runId: string,
  count: number,
  tag = 'u'
) {
  const s = await staged(ctx, runId, count, tag);
  const done = await completeFiles(ctx.deps, s.run, { fileIds: s.ids });
  if (!done.ok) throw new Error(done.error);
  return s;
}

beforeEach(() => {
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});
afterEach(() => {
  jest.restoreAllMocks();
});

describe('runCleanup', () => {
  it('expires files that were never reported as done after 24 hours and removes their objects', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const stale = await staged(ctx, run.id, 2, 'stale');
    const done = await uploadedFiles(ctx, run.id, 1, 'done');
    ctx.repo.advance(25 * HOUR);
    const fresh = await staged(ctx, run.id, 1, 'fresh');

    const report = await runCleanup(ctx.deps);
    expect(report).toMatchObject({
      expired: 2,
      objectsRemoved: 2,
      removalFailed: 0,
      runsDiscarded: 0,
    });
    for (const path of stale.paths)
      expect(ctx.mem.objects.has(path)).toBe(false);
    for (const row of await ctx.repo.getFiles(run.id, stale.ids)) {
      expect(row.status).toBe('expired');
      expect(row.parseSummary).toEqual({ objectDeleted: true });
    }
    // the file that was reported done and the fresh one stay
    expect(ctx.mem.objects.has(done.paths[0])).toBe(true);
    expect(ctx.mem.objects.has(fresh.paths[0])).toBe(true);
    // a second call has nothing to do
    expect(await runCleanup(ctx.deps)).toMatchObject({
      expired: 0,
      objectsRemoved: 0,
    });
  });

  it('removes the object of a rejected file that could not be removed at the time', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const s = await staged(ctx, run.id, 1);
    ctx.mem.put(s.paths[0], pdfBytes('a different, longer content'));
    ctx.mem.failRemoveFor.add(s.paths[0]);
    await completeFiles(ctx.deps, s.run, { fileIds: s.ids });
    expect((await ctx.repo.getFiles(run.id, s.ids))[0].status).toBe('rejected');
    expect(ctx.mem.objects.has(s.paths[0])).toBe(true);
    ctx.mem.failRemoveFor.clear();
    const report = await runCleanup(ctx.deps);
    expect(report.objectsRemoved).toBe(1);
    expect(ctx.mem.objects.has(s.paths[0])).toBe(false);
  });

  it('discards a run that was never applied and idle for 30 days, then removes its objects and rows', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const s = await uploadedFiles(ctx, run.id, 2);
    ctx.repo.advance(31 * DAY);
    const first = await runCleanup(ctx.deps);
    expect(first).toMatchObject({ runsDiscarded: 1, objectsRemoved: 2 });
    expect((await ctx.repo.getRun(run.id))?.status).toBe('discarded');
    for (const path of s.paths) expect(ctx.mem.objects.has(path)).toBe(false);
    // the rows stay for 7 days
    expect(await ctx.repo.getRun(run.id)).not.toBeNull();
    ctx.repo.advance(8 * DAY);
    const second = await runCleanup(ctx.deps);
    expect(second.runsDeleted).toBe(1);
    expect(await ctx.repo.getRun(run.id)).toBeNull();
  });

  it('never discards an applied run, and keeps a run with an apply for ever', async () => {
    const ctx = setup();
    const applied = await newRun(ctx.deps);
    await uploadedFiles(ctx, applied.id, 1, 'a');
    ctx.repo.forceRunStatus(applied.id, 'applied');
    const reviewed = await newRun(ctx.deps);
    await uploadedFiles(ctx, reviewed.id, 1, 'r');
    ctx.repo.forceRunStatus(reviewed.id, 'review');
    ctx.repo.addApply(reviewed.id, 'apply');
    const objectsBefore = ctx.mem.objects.size;
    ctx.repo.advance(400 * DAY);
    const report = await runCleanup(ctx.deps);
    expect(report.runsDiscarded).toBe(0);
    expect((await ctx.repo.getRun(applied.id))?.status).toBe('applied');
    expect((await ctx.repo.getRun(reviewed.id))?.status).toBe('review');
    // no purge date was set for the applied run: its files stay
    expect(ctx.mem.objects.size).toBe(objectsBefore);
  });

  it('removes the staging files of an applied run 30 days after the apply', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const s = await uploadedFiles(ctx, run.id, 2);
    ctx.repo.forceRunStatus(run.id, 'applied', 30);
    ctx.repo.advance(29 * DAY);
    expect((await runCleanup(ctx.deps)).objectsRemoved).toBe(0);
    ctx.repo.advance(2 * DAY);
    expect((await runCleanup(ctx.deps)).objectsRemoved).toBe(2);
    for (const path of s.paths) expect(ctx.mem.objects.has(path)).toBe(false);
    // the run and its rows stay (the log of the apply)
    expect((await ctx.repo.getRun(run.id))?.status).toBe('applied');
  });

  it('keeps the rows and tries again when the storage fails', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const s = await uploadedFiles(ctx, run.id, 2);
    await ctx.repo.transitionRun(run.id, ['uploading'], 'discarded', {
      purgeAfterDays: 7,
    });
    ctx.mem.failRemoveFor.add(s.paths[0]);
    const failed = await runCleanup(ctx.deps);
    expect(failed.removalFailed).toBe(2);
    expect(failed.objectsRemoved).toBe(0);
    for (const row of await ctx.repo.getFiles(run.id, s.ids)) {
      expect(row.parseSummary).toBeNull();
    }
    // the rows are not deleted while an object is left
    ctx.repo.advance(8 * DAY);
    expect((await runCleanup(ctx.deps)).runsDeleted).toBe(0);
    ctx.mem.failRemoveFor.clear();
    const ok = await runCleanup(ctx.deps);
    expect(ok.objectsRemoved).toBe(2);
    // all objects are gone and the purge date has passed: the rows go too
    expect(ok.runsDeleted).toBe(1);
  });

  it('never asks the storage for a path that is not the exact form of its own run', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const s = await uploadedFiles(ctx, run.id, 2);
    // a row with a path of another run and one that is no staging path at all
    const [a, b] = s.ids.map(id => ctx.repo.files.get(id)!);
    a.storagePath = `upload/${RUN}/${FILE}.pdf`;
    b.storagePath = 'content/some-other-bucket-file.pdf';
    await ctx.repo.transitionRun(run.id, ['uploading'], 'discarded');
    const remove = jest.spyOn(ctx.mem, 'remove');
    const report = await runCleanup(ctx.deps);
    expect(report.skippedInvalidPath).toBe(2);
    expect(remove).not.toHaveBeenCalled();
    expect(report.objectsRemoved).toBe(0);
  });

  it('handles a batch at a time and stops after the rounds it was given', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    await uploadedFiles(ctx, run.id, 10);
    await ctx.repo.transitionRun(run.id, ['uploading'], 'discarded');
    const some = await removePendingObjects(ctx.deps, { batch: 3, rounds: 2 });
    expect(some.objectsRemoved).toBe(6);
    const rest = await removePendingObjects(ctx.deps, { batch: 3, rounds: 10 });
    expect(rest.objectsRemoved).toBe(4);
  });

  it('can be limited to one run', async () => {
    const ctx = setup();
    const a = await newRun(ctx.deps);
    const b = await newRun(ctx.deps, OTHER_ADMIN);
    const sa = await uploadedFiles(ctx, a.id, 1, 'a');
    const sb = await uploadedFiles(ctx, b.id, 1, 'b');
    await ctx.repo.transitionRun(a.id, ['uploading'], 'discarded');
    await ctx.repo.transitionRun(b.id, ['uploading'], 'discarded');
    await removePendingObjects(ctx.deps, { runId: a.id });
    expect(ctx.mem.objects.has(sa.paths[0])).toBe(false);
    expect(ctx.mem.objects.has(sb.paths[0])).toBe(true);
  });
});

describe('discardRun removes the objects at once', () => {
  it('removes the objects of the run and no others', async () => {
    const ctx = setup();
    const a = await newRun(ctx.deps);
    const b = await newRun(ctx.deps);
    const sa = await uploadedFiles(ctx, a.id, 2, 'a');
    const sb = await uploadedFiles(ctx, b.id, 2, 'b');
    const result = await discardRun(ctx.deps, (await ctx.repo.getRun(a.id))!);
    expect(result.ok && result.data.status).toBe('discarded');
    for (const path of sa.paths) expect(ctx.mem.objects.has(path)).toBe(false);
    for (const path of sb.paths) expect(ctx.mem.objects.has(path)).toBe(true);
  });
});

describe('orphans in the bucket', () => {
  function put(ctx: Ctx, path: string, ageDays: number) {
    ctx.mem.put(path, pdfBytes('orphan'), new Date(Date.now() - ageDays * DAY));
  }
  const orphanPath = (run: string, file: string) => `upload/${run}/${file}.pdf`;

  it('only lists objects without a row and does not name the path', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const known = await staged(ctx, run.id, 1);
    put(ctx, orphanPath(RUN, FILE), 10);
    const listed = await listOrphans(ctx.deps);
    expect(listed.orphans).toEqual([
      {
        runId: RUN,
        fileId: FILE,
        ext: 'pdf',
        sizeBytes: pdfBytes('orphan').length,
        createdAt: expect.any(String),
        deletable: true,
      },
    ]);
    expect(JSON.stringify(listed)).not.toContain('upload/');
    expect(listed.truncated).toBe(false);
    // nothing was deleted
    expect(ctx.mem.objects.has(known.paths[0])).toBe(true);
    expect(ctx.mem.objects.has(orphanPath(RUN, FILE))).toBe(true);
  });

  it('is not deleted by the cleanup, by a discard or by a new run', async () => {
    const ctx = setup();
    put(ctx, orphanPath(RUN, FILE), 100);
    const run = await newRun(ctx.deps);
    await runCleanup(ctx.deps);
    await discardRun(ctx.deps, (await ctx.repo.getRun(run.id))!);
    await removePendingObjects(ctx.deps);
    expect(ctx.mem.objects.has(orphanPath(RUN, FILE))).toBe(true);
    expect(ctx.mem.removed).toEqual([]);
  });

  it('deletes only objects older than 7 days, and only on the explicit call', async () => {
    const ctx = setup();
    const old = orphanPath(RUN, FILE);
    const young = orphanPath(RUN, 'b1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d');
    const edge = orphanPath(RUN, 'c1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d');
    put(ctx, old, 8);
    put(ctx, young, 6);
    put(ctx, edge, 7.01);
    const result = await deleteOrphans(ctx.deps);
    expect(result).toEqual({ deleted: 2, skippedYoung: 1, failed: 0 });
    expect(ctx.mem.objects.has(old)).toBe(false);
    expect(ctx.mem.objects.has(edge)).toBe(false);
    expect(ctx.mem.objects.has(young)).toBe(true);
  });

  it('never deletes an object without a known age', async () => {
    const ctx = setup();
    const path = orphanPath(RUN, FILE);
    ctx.mem.put(path, pdfBytes('x'), undefined as any);
    ctx.mem.objects.get(path)!.createdAt = null as any;
    const result = await deleteOrphans(ctx.deps);
    expect(result.deleted).toBe(0);
    expect(ctx.mem.objects.has(path)).toBe(true);
  });

  it('never touches an object that has a row, however old', async () => {
    const ctx = setup();
    const run = await newRun(ctx.deps);
    const s = await staged(ctx, run.id, 1);
    ctx.mem.objects.get(s.paths[0])!.createdAt = new Date(
      Date.now() - 400 * DAY
    );
    const result = await deleteOrphans(ctx.deps);
    expect(result.deleted).toBe(0);
    expect(ctx.mem.objects.has(s.paths[0])).toBe(true);
  });

  it('asks the rows once more right before deleting (a file announced in the meantime)', async () => {
    const ctx = setup();
    const path = orphanPath(RUN, FILE);
    put(ctx, path, 30);
    const known = jest
      .spyOn(ctx.repo, 'knownStoragePaths')
      .mockResolvedValueOnce(new Set())
      .mockResolvedValueOnce(new Set([path]));
    const result = await deleteOrphans(ctx.deps);
    expect(known).toHaveBeenCalledTimes(2);
    expect(result.deleted).toBe(0);
    expect(ctx.mem.objects.has(path)).toBe(true);
  });

  it('ignores every object that is not the exact staging form of this schema', async () => {
    const ctx = setup();
    // Preview objects in a Production look, other buckets, loose files, wrong names
    for (const path of [
      `preview/upload/${RUN}/${FILE}.pdf`,
      `content/${FILE}.pdf`,
      `upload/${RUN}/${FILE}.exe`,
      `upload/${RUN}/sub/${FILE}.pdf`,
      `upload/${FILE}.pdf`,
      `${RUN}/${FILE}.pdf`,
    ]) {
      put(ctx, path, 100);
    }
    expect((await listOrphans(ctx.deps)).orphans).toEqual([]);
    const result = await deleteOrphans(ctx.deps);
    expect(result).toEqual({ deleted: 0, skippedYoung: 0, failed: 0 });
    expect(ctx.mem.objects.size).toBe(6);
    expect(ctx.mem.removed).toEqual([]);
  });

  it('counts a failed removal and goes on with the next chunk', async () => {
    const ctx = setup();
    const path = orphanPath(RUN, FILE);
    put(ctx, path, 30);
    ctx.mem.failRemoveFor.add(path);
    const result = await deleteOrphans(ctx.deps);
    expect(result).toEqual({ deleted: 0, skippedYoung: 0, failed: 1 });
  });

  it('says when the listing was cut off', async () => {
    const ctx = setup();
    jest.spyOn(ctx.mem, 'list').mockResolvedValueOnce(
      Array.from({ length: 5000 }, () => ({
        path: orphanPath(RUN, FILE),
        size: 1,
        createdAt: new Date(),
      }))
    );
    expect((await listOrphans(ctx.deps)).truncated).toBe(true);
  });
});

describe('what the cleanup does not do', () => {
  it('never lists, removes or touches anything for a run of another person without a row', async () => {
    const ctx = setup();
    const mine = await newRun(ctx.deps, SUPER);
    const theirs = await newRun(ctx.deps, OTHER_ADMIN);
    const s = await uploadedFiles(ctx, theirs.id, 1);
    await runCleanup(ctx.deps);
    expect(ctx.mem.objects.has(s.paths[0])).toBe(true);
    expect((await ctx.repo.getRun(mine.id))?.status).toBe('draft');
  });
});
