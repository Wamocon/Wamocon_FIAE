// The contract every UploadRepo has to keep. It runs against the in-memory
// repository on every test run (repo-memory.test.ts) and against the SQL
// repository when a throwaway database is given (repo-pg.test.ts, variable
// CONTENT_UPLOAD_TEST_DB), so the two cannot drift apart.

import { randomUUID } from 'crypto';
import type { Candidate } from '@/lib/content-upload/staging/announce';
import { LIMITS } from '@/lib/content-upload/staging/config';
import { uploadStoragePath } from '@/lib/content-upload/staging/paths';
import type { UploadRepo } from '@/lib/content-upload/staging/repo';
import type {
  FileStatus,
  RunStatus,
} from '@/lib/content-upload/staging/status';
import type { FileRow } from '@/lib/content-upload/staging/types';

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
const MB = 1024 * 1024;

export interface RepoHarness {
  repo: UploadRepo;
  /** Two persons that exist (profiles) and the id of the catalog KFBM. */
  userA: string;
  userB: string;
  catalogId: string;
  /** Moves the time of the repository forward. */
  advance(ms: number): Promise<void>;
  forceRunStatus(
    id: string,
    status: RunStatus,
    purgeAfterDays?: number
  ): Promise<void>;
  forceFileStatus(id: string, status: FileStatus): Promise<void>;
  addApply(
    runId: string,
    mode: 'dry_run' | 'apply',
    userId: string
  ): Promise<void>;
  /** All rows of the run, read directly (not through the repository). */
  rawFiles(runId: string): Promise<FileRow[]>;
  rawRunExists(runId: string): Promise<boolean>;
  close(): Promise<void>;
}

let counter = 0;
function sha(n: number): string {
  return n.toString(16).padStart(64, '0');
}

export function candidate(
  runId: string,
  n: number,
  overrides: Partial<Candidate> = {}
): Candidate {
  const id = randomUUID();
  const ext = overrides.ext ?? 'docx';
  return {
    index: n,
    id,
    relPath: `dir/f${n}.${ext}`,
    fileName: `f${n}.${ext}`,
    ext,
    sizeBytes: 1000,
    sha256: sha(n + 1),
    clientMtimeMs: null,
    storagePath: uploadStoragePath(runId, id, ext, 'public'),
    ...overrides,
  };
}

export function runRepoContract(
  label: string,
  make: () => Promise<RepoHarness>
) {
  describe(`UploadRepo contract: ${label}`, () => {
    let h: RepoHarness;
    let repo: UploadRepo;

    beforeEach(async () => {
      h = await make();
      repo = h.repo;
    });
    afterEach(async () => {
      await h.close();
    });

    async function newRun(user = h.userA, max = 100) {
      const id = randomUUID();
      const result = await repo.createRun(
        {
          id,
          catalogId: h.catalogId,
          createdById: user,
          label: `run ${++counter}`,
          kiEnabled: true,
          storagePrefix: `upload/${id}/`,
        },
        max
      );
      if (!result.ok) throw new Error('could not create the run');
      return result.run;
    }

    async function announceN(runId: string, count: number, offset = 0) {
      const cs = Array.from({ length: count }, (_, i) =>
        candidate(runId, offset + i)
      );
      const result = await repo.announce(runId, cs);
      if (!result.ok) throw new Error(`announce failed: ${result.reason}`);
      return { cs, plan: result.plan };
    }

    /** Announces n files and reports them as uploaded. */
    async function uploaded(runId: string, count: number, offset = 0) {
      const { cs } = await announceN(runId, count, offset);
      for (const c of cs) {
        const row = await repo.transitionFile(
          runId,
          c.id,
          'announced',
          'uploaded',
          { completed: true }
        );
        expect(row?.status).toBe('uploaded');
      }
      return cs;
    }

    // ---- runs ---------------------------------------------------------------

    describe('runs', () => {
      it('finds the catalog by code', async () => {
        expect(await repo.catalogIdByCode('KFBM')).toBe(h.catalogId);
        expect(await repo.catalogIdByCode('NOPE')).toBeNull();
      });

      it('creates a run as a draft with the given values', async () => {
        const run = await newRun();
        expect(run.status).toBe('draft');
        expect(run.createdById).toBe(h.userA);
        expect(run.trainingCatalogId).toBe(h.catalogId);
        expect(run.kiEnabled).toBe(true);
        expect(run.decisionsVersion).toBe(0);
        expect(run.storagePrefix).toBe(`upload/${run.id}/`);
        expect(run.declarationAcceptedAt).toBeInstanceOf(Date);
        const read = await repo.getRun(run.id);
        expect(read?.label).toBe(run.label);
        expect(await repo.getRun(randomUUID())).toBeNull();
      });

      it('allows three active runs per person, the fourth is refused', async () => {
        for (let i = 0; i < 3; i++) await newRun(h.userA, 3);
        const id = randomUUID();
        const fourth = await repo.createRun(
          {
            id,
            catalogId: h.catalogId,
            createdById: h.userA,
            label: 'fourth',
            kiEnabled: false,
            storagePrefix: `upload/${id}/`,
          },
          3
        );
        expect(fourth).toEqual({ ok: false, reason: 'TOO_MANY_ACTIVE_RUNS' });
        // another person is not affected
        const other = await newRun(h.userB, 3);
        expect(other.createdById).toBe(h.userB);
      });

      it('does not count discarded or applied runs as active', async () => {
        const a = await newRun(h.userA, 3);
        const b = await newRun(h.userA, 3);
        const c = await newRun(h.userA, 3);
        await h.forceRunStatus(a.id, 'discarded');
        await h.forceRunStatus(b.id, 'applied');
        const d = await newRun(h.userA, 3);
        expect(d.status).toBe('draft');
        expect(c.status).toBe('draft');
      });

      it('holds the limit when runs are created at the same time', async () => {
        const results = await Promise.all(
          Array.from({ length: 8 }, async (_, i) => {
            const id = randomUUID();
            return repo.createRun(
              {
                id,
                catalogId: h.catalogId,
                createdById: h.userA,
                label: `parallel ${i}`,
                kiEnabled: true,
                storagePrefix: `upload/${id}/`,
              },
              3
            );
          })
        );
        expect(results.filter(r => r.ok)).toHaveLength(3);
        expect(results.filter(r => !r.ok)).toHaveLength(5);
      });

      it('lists the runs of a person, newest first, or all', async () => {
        const first = await newRun(h.userA);
        await h.advance(1000);
        const second = await newRun(h.userA);
        await h.advance(1000);
        const foreign = await newRun(h.userB);
        const mine = await repo.listRuns({ createdById: h.userA, limit: 10 });
        expect(mine.map(r => r.id)).toEqual([second.id, first.id]);
        const all = await repo.listRuns({ limit: 10 });
        expect(all.map(r => r.id)).toEqual([foreign.id, second.id, first.id]);
        expect(await repo.listRuns({ limit: 2 })).toHaveLength(2);
      });

      it('moves a run only from the expected state, to a state of the model', async () => {
        const run = await newRun();
        expect(
          await repo.transitionRun(run.id, ['review'], 'processing')
        ).toBeNull();
        const moved = await repo.transitionRun(run.id, ['draft'], 'uploading');
        expect(moved?.status).toBe('uploading');
        // not a transition of the model
        await expect(
          repo.transitionRun(run.id, ['uploading'], 'review')
        ).rejects.toThrow();
        // the second caller finds it moved
        expect(
          await repo.transitionRun(run.id, ['draft'], 'uploading')
        ).toBeNull();
        expect(
          await repo.transitionRun(randomUUID(), ['draft'], 'uploading')
        ).toBeNull();
      });

      it('marks activity, which keeps an idle run alive', async () => {
        const run = await newRun();
        await h.advance(2000);
        const idle = (await repo.getRun(run.id))!.updatedAt.getTime();
        await repo.touchRun(run.id);
        const after = (await repo.getRun(run.id))!.updatedAt.getTime();
        expect(after - idle).toBeGreaterThanOrEqual(1900);
        await repo.touchRun(randomUUID());
        await repo.touchRun('not-a-uuid');
      });

      it('sets purge_after when a run is discarded', async () => {
        const run = await newRun();
        const discarded = await repo.transitionRun(
          run.id,
          ['draft'],
          'discarded',
          { purgeAfterDays: 7 }
        );
        expect(discarded?.status).toBe('discarded');
        expect(discarded?.purgeAfter).toBeInstanceOf(Date);
        expect(
          (discarded!.purgeAfter!.getTime() - discarded!.updatedAt.getTime()) /
            DAY
        ).toBeCloseTo(7, 1);
      });
    });

    // ---- announce ----------------------------------------------------------

    describe('announce', () => {
      it('writes the new files as announced and opens the run for upload', async () => {
        const run = await newRun();
        const { cs, plan } = await announceN(run.id, 3);
        expect(plan.items.map(i => i.kind)).toEqual([
          'insert',
          'insert',
          'insert',
        ]);
        const rows = await repo.listFiles(run.id, { offset: 0, limit: 10 });
        expect(rows).toHaveLength(3);
        expect(rows.every(r => r.status === 'announced')).toBe(true);
        expect(rows.map(r => r.id).sort()).toEqual(cs.map(c => c.id).sort());
        const first = rows.find(r => r.id === cs[0].id)!;
        expect(first.relPath).toBe(cs[0].relPath);
        expect(first.fileName).toBe(cs[0].fileName);
        expect(first.ext).toBe('docx');
        expect(first.sizeBytes).toBe(1000);
        expect(first.sha256).toBe(cs[0].sha256);
        expect(first.storagePath).toBe(cs[0].storagePath);
        expect(first.attempts).toBe(0);
        expect(first.claimId).toBeNull();
        expect((await repo.getRun(run.id))?.status).toBe('uploading');
      });

      it('answers a second announce of the same files with the existing ones', async () => {
        const run = await newRun();
        const { cs } = await announceN(run.id, 2);
        const again = await repo.announce(
          run.id,
          cs.map((c, i) =>
            candidate(run.id, i, {
              relPath: c.relPath,
              sha256: c.sha256,
            })
          )
        );
        expect(again.ok && again.plan.items.map(i => i.kind)).toEqual([
          'existing',
          'existing',
        ]);
        expect(
          again.ok &&
            again.plan.items.map(i => (i.kind === 'existing' ? i.fileId : ''))
        ).toEqual(cs.map(c => c.id));
        expect(
          await repo.listFiles(run.id, { offset: 0, limit: 10 })
        ).toHaveLength(2);
      });

      it('merges an exact copy and gives it no object of its own', async () => {
        const run = await newRun();
        const main = candidate(run.id, 1, { relPath: 'a/main.docx' });
        const copy = candidate(run.id, 2, {
          relPath: 'b/copy.docx',
          sha256: main.sha256,
        });
        const result = await repo.announce(run.id, [main, copy]);
        expect(result.ok && result.plan.items.map(i => i.kind)).toEqual([
          'insert',
          'merge',
        ]);
        const rows = await repo.getFiles(run.id, [main.id, copy.id]);
        const merged = rows.find(r => r.id === copy.id)!;
        expect(merged.status).toBe('merged');
        expect(merged.duplicateOfId).toBe(main.id);
        // a copy of a later request merges into the main file as well
        const late = candidate(run.id, 3, {
          relPath: 'c/late.docx',
          sha256: main.sha256,
        });
        const again = await repo.announce(run.id, [late]);
        expect(again.ok && again.plan.items[0]).toMatchObject({
          kind: 'merge',
          duplicateOfId: main.id,
        });
      });

      it('lets an expired file come back under its old id', async () => {
        const run = await newRun();
        const { cs } = await announceN(run.id, 1);
        await h.advance(25 * HOUR);
        expect(await repo.expireStaleAnnounced(24, 100)).toBe(1);
        const again = await repo.announce(run.id, [
          candidate(run.id, 0, {
            relPath: cs[0].relPath,
            sha256: cs[0].sha256,
          }),
        ]);
        expect(again.ok && again.plan.items[0]).toMatchObject({
          kind: 'revive',
          fileId: cs[0].id,
        });
        const [row] = await repo.getFiles(run.id, [cs[0].id]);
        expect(row.status).toBe('announced');
        expect(row.storagePath).toBe(cs[0].storagePath);
      });

      it('refuses a run that is not open for files', async () => {
        const run = await newRun();
        await repo.transitionRun(run.id, ['draft'], 'discarded');
        const result = await repo.announce(run.id, [candidate(run.id, 1)]);
        expect(result).toEqual({
          ok: false,
          reason: 'RUN_STATE',
          status: 'discarded',
        });
        expect(
          await repo.announce(randomUUID(), [candidate(run.id, 1)])
        ).toEqual({ ok: false, reason: 'RUN_NOT_FOUND' });
      });

      it('does not write twice when the same announce runs at the same time', async () => {
        const run = await newRun();
        const make = () =>
          Array.from({ length: 10 }, (_, i) => candidate(run.id, i));
        const results = await Promise.all(
          Array.from({ length: 4 }, () => repo.announce(run.id, make()))
        );
        expect(results.every(r => r.ok)).toBe(true);
        expect(
          await repo.listFiles(run.id, { offset: 0, limit: 100 })
        ).toHaveLength(10);
        const inserts = results.flatMap(r =>
          r.ok ? r.plan.items.filter(i => i.kind === 'insert') : []
        );
        expect(inserts).toHaveLength(10);
      });

      it('holds the byte limit of a run', async () => {
        const run = await newRun();
        const size = 25 * MB;
        const cs = Array.from({ length: 41 }, (_, i) =>
          candidate(run.id, i, { sizeBytes: size })
        );
        const result = await repo.announce(run.id, cs);
        expect(result.ok).toBe(true);
        const kinds = result.ok ? result.plan.items.map(i => i.kind) : [];
        expect(kinds.filter(k => k === 'insert')).toHaveLength(40);
        expect(result.ok && result.plan.items[40]).toMatchObject({
          kind: 'reject',
          code: 'RUN_SIZE_LIMIT',
        });
        // the bytes count over several requests
        const more = await repo.announce(run.id, [
          candidate(run.id, 99, { sizeBytes: size }),
        ]);
        expect(more.ok && more.plan.items[0]).toMatchObject({
          kind: 'reject',
          code: 'RUN_SIZE_LIMIT',
        });
      });

      it('holds the staging limit over all runs and warns before it', async () => {
        const size = 25 * MB;
        const bigRun = async (offset: number, files: number) => {
          const run = await newRun(h.userA, 100);
          const cs = Array.from({ length: files }, (_, i) =>
            candidate(run.id, offset + i, { sizeBytes: size })
          );
          const result = await repo.announce(run.id, cs);
          return { run, result };
        };
        // 2 x 1000 MB of 2048 MB, then 25 MB steps
        await bigRun(0, 40);
        const second = await bigRun(1000, 40);
        expect(second.result.ok && second.result.plan.warnings).toEqual([
          expect.objectContaining({ code: 'STAGING_NEAR_LIMIT' }),
        ]);
        const third = await newRun(h.userA, 100);
        const cs = Array.from({ length: 3 }, (_, i) =>
          candidate(third.id, 2000 + i, { sizeBytes: size })
        );
        const result = await repo.announce(third.id, cs);
        const kinds = result.ok ? result.plan.items.map(i => i.kind) : [];
        // 2000 + 25 = 2025 MB fits, 2025 + 25 = 2050 MB is over 2048 MB
        expect(kinds).toEqual(['insert', 'reject', 'reject']);
        expect(result.ok && result.plan.items[1]).toMatchObject({
          code: 'STAGING_FULL',
        });
      });

      it('does not count a file whose object is gone', async () => {
        const run = await newRun();
        const size = 25 * MB;
        const cs = Array.from({ length: 40 }, (_, i) =>
          candidate(run.id, i, { sizeBytes: size })
        );
        await repo.announce(run.id, cs);
        const extra = candidate(run.id, 77, { sizeBytes: size });
        const full = await repo.announce(run.id, [extra]);
        expect(full.ok && full.plan.items[0].kind).toBe('reject');
        // one file is rejected and its object deleted: the space is free again
        await repo.transitionFile(run.id, cs[0].id, 'announced', 'rejected', {
          code: 'NOT_A_DOCX',
          objectDeleted: true,
        });
        const retry = await repo.announce(run.id, [extra]);
        expect(retry.ok && retry.plan.items[0].kind).toBe('insert');
      });

      it('hints at a hash that an earlier run applied', async () => {
        const first = await newRun();
        const c = candidate(first.id, 1);
        await repo.announce(first.id, [c]);
        await h.forceFileStatus(c.id, 'applied');
        const second = await newRun();
        const again = candidate(second.id, 1);
        const result = await repo.announce(second.id, [again]);
        expect(result.ok && result.plan.items[0]).toMatchObject({
          kind: 'insert',
          alreadyAppliedInRunId: first.id,
        });
      });
    });

    // ---- files ---------------------------------------------------------------

    describe('files', () => {
      it('moves a file only from the expected state and only in its run', async () => {
        const run = await newRun();
        const other = await newRun();
        const [c] = (await announceN(run.id, 1)).cs;
        expect(
          await repo.transitionFile(other.id, c.id, 'announced', 'uploaded')
        ).toBeNull();
        expect(
          await repo
            .transitionFile(run.id, c.id, 'uploaded', 'verified')
            .catch(() => 'threw')
        ).toBeNull();
        const done = await repo.transitionFile(
          run.id,
          c.id,
          'announced',
          'uploaded',
          { completed: true }
        );
        expect(done?.status).toBe('uploaded');
        expect(done?.completedAt).toBeInstanceOf(Date);
        // a second report of the same file changes nothing
        expect(
          await repo.transitionFile(run.id, c.id, 'announced', 'uploaded')
        ).toBeNull();
        await expect(
          repo.transitionFile(run.id, c.id, 'uploaded', 'applied')
        ).rejects.toThrow();
      });

      it('stores the code and the object marker of a rejection', async () => {
        const run = await newRun();
        const [c] = (await announceN(run.id, 1)).cs;
        const rejected = await repo.transitionFile(
          run.id,
          c.id,
          'announced',
          'rejected',
          { code: 'SIZE_MISMATCH', objectDeleted: true }
        );
        expect(rejected?.status).toBe('rejected');
        expect(rejected?.statusCode).toBe('SIZE_MISMATCH');
        expect(rejected?.parseSummary).toEqual({ objectDeleted: true });
      });

      it('reads only files of the run it was asked for', async () => {
        const run = await newRun();
        const other = await newRun();
        const a = (await announceN(run.id, 2)).cs;
        const b = (await announceN(other.id, 1, 50)).cs;
        const got = await repo.getFiles(run.id, [
          a[0].id,
          b[0].id,
          randomUUID(),
        ]);
        expect(got.map(r => r.id)).toEqual([a[0].id]);
        const page = await repo.listFiles(run.id, { offset: 1, limit: 1 });
        expect(page).toHaveLength(1);
        expect(await repo.getFiles(run.id, [])).toEqual([]);
      });

      it('counts the files of a run by state', async () => {
        const run = await newRun();
        const cs = await uploaded(run.id, 3);
        await repo.transitionFile(run.id, cs[0].id, 'uploaded', 'rejected', {
          code: 'X',
        });
        await announceN(run.id, 2, 10);
        const progress = await repo.runProgress(run.id);
        expect(progress.counts).toEqual({
          uploaded: 2,
          rejected: 1,
          announced: 2,
        });
        expect(progress.totalFiles).toBe(5);
        expect(progress.totalBytes).toBe(5000);
      });
    });

    // ---- queue ---------------------------------------------------------------

    describe('queue', () => {
      const claim = (runId: string, extra: Record<string, unknown> = {}) =>
        repo.claimFiles(runId, {
          statuses: ['uploaded'],
          limit: 10,
          lockSeconds: 60,
          maxAttempts: 3,
          ...extra,
        });

      it('claims files with a new claim id, a lock and one more attempt', async () => {
        const run = await newRun();
        await uploaded(run.id, 3);
        const claimed = await claim(run.id, { limit: 2 });
        expect(claimed).toHaveLength(2);
        for (const f of claimed) {
          expect(f.claimId).toMatch(/^[0-9a-f-]{36}$/);
          expect(f.attempts).toBe(1);
          expect(f.lockedUntil).toBeInstanceOf(Date);
        }
        expect(claimed[0].claimId).not.toBe(claimed[1].claimId);
        // the rest is still there, the claimed ones are held
        const next = await claim(run.id);
        expect(next).toHaveLength(1);
        expect(await claim(run.id)).toHaveLength(0);
      });

      it('takes files in the order of the announcement', async () => {
        const run = await newRun();
        const first = (await uploaded(run.id, 1, 0))[0];
        await h.advance(1000);
        const second = (await uploaded(run.id, 1, 1))[0];
        const claimed = await claim(run.id, { limit: 1 });
        expect(claimed[0].id).toBe(first.id);
        const more = await claim(run.id, { limit: 1 });
        expect(more[0].id).toBe(second.id);
      });

      it('claims only the states it is asked for and only runs that work', async () => {
        const run = await newRun();
        await uploaded(run.id, 1);
        await announceN(run.id, 2, 10);
        expect(await claim(run.id, { statuses: ['verified'] })).toHaveLength(0);
        expect(await claim(run.id)).toHaveLength(1);
        const dead = await newRun();
        await uploaded(dead.id, 1);
        await repo.transitionRun(dead.id, ['uploading'], 'discarded');
        expect(await claim(dead.id)).toHaveLength(0);
        expect(await claim(randomUUID())).toHaveLength(0);
      });

      it('never gives one file to two callers at the same time', async () => {
        const run = await newRun();
        const cs = await uploaded(run.id, 25);
        const seen: string[] = [];
        await Promise.all(
          Array.from({ length: 8 }, async () => {
            for (;;) {
              const got = await claim(run.id, { limit: 3 });
              if (got.length === 0) return;
              seen.push(...got.map(f => f.id));
            }
          })
        );
        expect(seen).toHaveLength(25);
        expect(new Set(seen).size).toBe(25);
        expect([...seen].sort()).toEqual(cs.map(c => c.id).sort());
      });

      it('ends a claim only with the claim id of the caller', async () => {
        const run = await newRun();
        await uploaded(run.id, 1);
        const [f] = await claim(run.id);
        expect(
          await repo.finishClaim(f.id, randomUUID(), 'uploaded', 'verified')
        ).toBe(false);
        // the file is not in the state the caller expects
        expect(
          await repo.finishClaim(f.id, f.claimId!, 'verified', 'extracted')
        ).toBe(false);
        // not a transition of the model
        await expect(
          repo.finishClaim(f.id, f.claimId!, 'uploaded', 'applied')
        ).rejects.toThrow();
        expect(
          await repo.finishClaim(f.id, f.claimId!, 'uploaded', 'verified', {
            patch: {
              docType: 'quiz',
              pageCount: 3,
              charCount: 400,
              dupKey: 'quiz:1a:low',
              parseSummary: { questions: 20 },
            },
          })
        ).toBe(true);
        const [row] = await repo.getFiles(run.id, [f.id]);
        expect(row.status).toBe('verified');
        expect(row.attempts).toBe(0);
        expect(row.claimId).toBeNull();
        expect(row.lockedUntil).toBeNull();
        expect(row.processedAt).toBeInstanceOf(Date);
        expect(row.docType).toBe('quiz');
        expect(row.pageCount).toBe(3);
        expect(row.charCount).toBe(400);
        expect(row.dupKey).toBe('quiz:1a:low');
        expect(row.parseSummary).toEqual({ questions: 20 });
        // the claim is spent
        expect(
          await repo.finishClaim(f.id, f.claimId!, 'uploaded', 'verified')
        ).toBe(false);
      });

      it('writes a failure with its code', async () => {
        const run = await newRun();
        await uploaded(run.id, 1);
        const [f] = await claim(run.id);
        expect(
          await repo.finishClaim(f.id, f.claimId!, 'uploaded', 'failed', {
            code: 'STEP_ERROR',
          })
        ).toBe(true);
        const [row] = await repo.getFiles(run.id, [f.id]);
        expect(row.status).toBe('failed');
        expect(row.statusCode).toBe('STEP_ERROR');
      });

      it('takes a file again after its claim expired, and the old claim is dead', async () => {
        const run = await newRun();
        await uploaded(run.id, 1);
        const [first] = await claim(run.id, { lockSeconds: 60 });
        expect(await claim(run.id)).toHaveLength(0);
        await h.advance(61_000);
        const [second] = await claim(run.id);
        expect(second.id).toBe(first.id);
        expect(second.claimId).not.toBe(first.claimId);
        expect(second.attempts).toBe(2);
        // the call that died cannot overwrite the result of its successor
        expect(
          await repo.finishClaim(
            first.id,
            first.claimId!,
            'uploaded',
            'verified'
          )
        ).toBe(false);
        expect(
          await repo.finishClaim(
            second.id,
            second.claimId!,
            'uploaded',
            'verified'
          )
        ).toBe(true);
      });

      it('stops handing out a file that used up its attempts', async () => {
        const run = await newRun();
        await uploaded(run.id, 1);
        for (let i = 1; i <= 3; i++) {
          const got = await claim(run.id);
          expect(got).toHaveLength(1);
          expect(got[0].attempts).toBe(i);
          await h.advance(61_000);
        }
        expect(await claim(run.id)).toHaveLength(0);
        const state = await repo.queueState(run.id, ['uploaded'], 3);
        expect(state).toEqual({ announced: 0, claimable: 0, locked: 0 });
      });

      it('gives a claim back for another attempt without losing the count', async () => {
        const run = await newRun();
        await uploaded(run.id, 1);
        const [f] = await claim(run.id);
        expect(await repo.releaseClaim(f.id, randomUUID())).toBe(false);
        expect(await repo.releaseClaim(f.id, f.claimId!)).toBe(true);
        const [again] = await claim(run.id);
        expect(again.attempts).toBe(2);
      });

      it('can keep a released file locked for a delay before the next attempt', async () => {
        const run = await newRun();
        await uploaded(run.id, 1);
        const [f] = await claim(run.id);
        expect(await repo.releaseClaim(f.id, f.claimId!, 10)).toBe(true);
        expect(await claim(run.id)).toHaveLength(0);
        expect(await repo.queueState(run.id, ['uploaded'], 3)).toEqual({
          announced: 0,
          claimable: 0,
          locked: 1,
        });
        await h.advance(11_000);
        const [again] = await claim(run.id);
        expect(again.id).toBe(f.id);
        expect(again.attempts).toBe(2);
      });

      it('fails files that ran out of attempts once their lock has expired', async () => {
        const run = await newRun();
        await uploaded(run.id, 2);
        // file 1: three attempts, the last one died
        for (let i = 0; i < 3; i++) {
          const got = await repo.claimFiles(run.id, {
            statuses: ['uploaded'],
            limit: 1,
            lockSeconds: 60,
            maxAttempts: 3,
          });
          expect(got).toHaveLength(1);
          if (i < 2) await h.advance(61_000);
        }
        // while the last claim still holds nothing is failed
        expect(
          await repo.failExhausted(run.id, ['uploaded'], 3, 'TIMEOUT')
        ).toBe(0);
        await h.advance(61_000);
        expect(
          await repo.failExhausted(run.id, ['uploaded'], 3, 'TIMEOUT')
        ).toBe(1);
        const failed = (
          await repo.listFiles(run.id, { offset: 0, limit: 10 })
        ).filter(f => f.status === 'failed');
        expect(failed).toHaveLength(1);
        expect(failed[0].statusCode).toBe('TIMEOUT');
        expect(failed[0].claimId).toBeNull();
        // the second file still has its attempts
        expect(
          await repo.failExhausted(run.id, ['uploaded'], 3, 'TIMEOUT')
        ).toBe(0);
      });

      it('reports what is waiting, claimable and held', async () => {
        const run = await newRun();
        await uploaded(run.id, 3);
        await announceN(run.id, 2, 10);
        expect(await repo.queueState(run.id, ['uploaded'], 3)).toEqual({
          announced: 2,
          claimable: 3,
          locked: 0,
        });
        await claim(run.id, { limit: 2 });
        expect(await repo.queueState(run.id, ['uploaded'], 3)).toEqual({
          announced: 2,
          claimable: 1,
          locked: 2,
        });
        expect(await repo.queueState(run.id, [], 3)).toEqual({
          announced: 2,
          claimable: 0,
          locked: 0,
        });
      });
    });

    // ---- rate limit ------------------------------------------------------------

    describe('url request counter', () => {
      it('lets 60 requests per minute through and refuses the 61st', async () => {
        for (let i = 1; i <= 60; i++) {
          const d = await repo.reserveUrlRequest(h.userA);
          expect(d.allowed).toBe(true);
          expect(d.count).toBe(i);
        }
        const refused = await repo.reserveUrlRequest(h.userA);
        expect(refused.allowed).toBe(false);
        expect(refused.retryAfterSec).toBeGreaterThanOrEqual(1);
        expect(refused.retryAfterSec).toBeLessThanOrEqual(60);
        // another person has an own counter
        expect((await repo.reserveUrlRequest(h.userB)).allowed).toBe(true);
      });

      it('starts a new window after a minute', async () => {
        for (let i = 0; i < 61; i++) await repo.reserveUrlRequest(h.userA);
        expect((await repo.reserveUrlRequest(h.userA)).allowed).toBe(false);
        await h.advance(61_000);
        const d = await repo.reserveUrlRequest(h.userA);
        expect(d.allowed).toBe(true);
        expect(d.count).toBe(1);
      });

      it('counts requests that arrive at the same time one by one', async () => {
        const results = await Promise.all(
          Array.from({ length: 70 }, () => repo.reserveUrlRequest(h.userA))
        );
        expect(results.filter(r => r.allowed)).toHaveLength(60);
        expect(results.filter(r => !r.allowed)).toHaveLength(10);
      });
    });

    // ---- cleanup -----------------------------------------------------------------

    describe('cleanup', () => {
      it('expires announced files after 24 hours and leaves the others', async () => {
        const run = await newRun();
        const [old] = (await announceN(run.id, 1, 0)).cs;
        const [done] = await uploaded(run.id, 1, 1);
        await h.advance(25 * HOUR);
        const [young] = (await announceN(run.id, 1, 2)).cs;
        expect(await repo.expireStaleAnnounced(24, 100)).toBe(1);
        const rows = await repo.getFiles(run.id, [old.id, done.id, young.id]);
        const status = Object.fromEntries(rows.map(r => [r.id, r.status]));
        expect(status).toEqual({
          [old.id]: 'expired',
          [done.id]: 'uploaded',
          [young.id]: 'announced',
        });
        expect(await repo.expireStaleAnnounced(24, 100)).toBe(0);
      });

      it('respects the batch limit when it expires files', async () => {
        const run = await newRun();
        await announceN(run.id, 5);
        await h.advance(25 * HOUR);
        expect(await repo.expireStaleAnnounced(24, 3)).toBe(3);
        expect(await repo.expireStaleAnnounced(24, 3)).toBe(2);
      });

      it('finds the files whose object has to go', async () => {
        const live = await newRun();
        const liveFiles = await uploaded(live.id, 1, 0);
        const rejectedOne = (await announceN(live.id, 1, 1)).cs[0];
        await repo.transitionFile(
          live.id,
          rejectedOne.id,
          'announced',
          'rejected',
          {
            code: 'NOT_A_PDF',
          }
        );
        const copy = candidate(live.id, 99, {
          relPath: 'x/copy.docx',
          sha256: liveFiles[0].sha256,
        });
        await repo.announce(live.id, [copy]);

        const discarded = await newRun();
        const discardedFiles = await uploaded(discarded.id, 2, 10);
        await repo.transitionRun(discarded.id, ['uploading'], 'discarded', {
          purgeAfterDays: 7,
        });

        const applied = await newRun();
        const appliedFiles = await uploaded(applied.id, 1, 20);
        await h.forceRunStatus(applied.id, 'applied', 30);

        const need = await repo.filesNeedingObjectRemoval(100);
        const ids = need.map(f => f.id).sort();
        // rejected without marker and the two files of the discarded run; the
        // applied run is not due yet, the live file and the merged copy stay
        expect(ids).toEqual(
          [rejectedOne.id, ...discardedFiles.map(c => c.id)].sort()
        );

        await h.advance(31 * DAY);
        const due = await repo.filesNeedingObjectRemoval(100);
        expect(due.map(f => f.id)).toContain(appliedFiles[0].id);

        await repo.markObjectsDeleted(due.map(f => f.id));
        expect(await repo.filesNeedingObjectRemoval(100)).toEqual([]);
        expect(
          (await repo.getFiles(live.id, [liveFiles[0].id]))[0].status
        ).toBe('uploaded');
      });

      it('can look at the objects of one run only', async () => {
        const a = await newRun();
        const b = await newRun();
        const aFiles = await uploaded(a.id, 2, 0);
        await uploaded(b.id, 2, 10);
        await repo.transitionRun(a.id, ['uploading'], 'discarded');
        await repo.transitionRun(b.id, ['uploading'], 'discarded');
        const only = await repo.filesNeedingObjectRemoval(100, a.id);
        expect(only.map(f => f.id).sort()).toEqual(
          aFiles.map(c => c.id).sort()
        );
        expect(await repo.filesNeedingObjectRemoval(100)).toHaveLength(4);
        expect(await repo.filesNeedingObjectRemoval(100, 'not-a-uuid')).toEqual(
          []
        );
      });

      it('limits the batch of files to remove', async () => {
        const run = await newRun();
        await uploaded(run.id, 5);
        await repo.transitionRun(run.id, ['uploading'], 'discarded');
        expect(await repo.filesNeedingObjectRemoval(2)).toHaveLength(2);
      });

      it('discards runs that were never applied and idle for 30 days', async () => {
        const idle = await newRun();
        const applied = await newRun();
        const reviewWithApply = await newRun();
        const stillBusy = await newRun();
        await h.forceRunStatus(applied.id, 'applied');
        await h.forceRunStatus(reviewWithApply.id, 'review');
        await h.addApply(reviewWithApply.id, 'apply', h.userA);
        await h.advance(31 * DAY);
        // activity keeps a run alive
        await repo.transitionRun(stillBusy.id, ['draft'], 'uploading');
        const ids = await repo.discardStaleRuns(30, 7, 100);
        expect(ids).toEqual([idle.id]);
        const run = (await repo.getRun(idle.id))!;
        expect(run.status).toBe('discarded');
        expect(run.purgeAfter).toBeInstanceOf(Date);
        expect((await repo.getRun(applied.id))?.status).toBe('applied');
        expect((await repo.getRun(reviewWithApply.id))?.status).toBe('review');
        expect((await repo.getRun(stillBusy.id))?.status).toBe('uploading');
        expect(await repo.discardStaleRuns(30, 7, 100)).toEqual([]);
      });

      it('a dry run alone does not protect an idle run', async () => {
        const run = await newRun();
        await h.forceRunStatus(run.id, 'review');
        await h.addApply(run.id, 'dry_run', h.userA);
        await h.advance(31 * DAY);
        expect(await repo.discardStaleRuns(30, 7, 100)).toEqual([run.id]);
      });

      it('deletes the rows of a discarded run after 7 days, when its objects are gone', async () => {
        const run = await newRun();
        const cs = await uploaded(run.id, 2);
        await repo.transitionRun(run.id, ['uploading'], 'discarded', {
          purgeAfterDays: 7,
        });
        await h.advance(8 * DAY);
        // the objects are still there: the rows are needed to remove them
        expect(await repo.deleteRunsPastPurge(10)).toBe(0);
        expect(await h.rawRunExists(run.id)).toBe(true);
        await repo.markObjectsDeleted(cs.map(c => c.id));
        expect(await repo.deleteRunsPastPurge(10)).toBe(1);
        expect(await h.rawRunExists(run.id)).toBe(false);
        expect(await h.rawFiles(run.id)).toEqual([]);
      });

      it('keeps a discarded run before its time and a run with applies for ever', async () => {
        const young = await newRun();
        await repo.transitionRun(young.id, ['draft'], 'discarded', {
          purgeAfterDays: 7,
        });
        const withApply = await newRun();
        await repo.transitionRun(withApply.id, ['draft'], 'discarded', {
          purgeAfterDays: 7,
        });
        await h.addApply(withApply.id, 'apply', h.userA);
        const open = await newRun();
        await h.advance(6 * DAY);
        expect(await repo.deleteRunsPastPurge(10)).toBe(0);
        await h.advance(2 * DAY);
        expect(await repo.deleteRunsPastPurge(10)).toBe(1);
        expect(await h.rawRunExists(young.id)).toBe(false);
        expect(await h.rawRunExists(withApply.id)).toBe(true);
        expect(await h.rawRunExists(open.id)).toBe(true);
      });

      it('lets a file that is announced again live another 24 hours', async () => {
        const run = await newRun();
        const [c] = (await announceN(run.id, 1)).cs;
        await h.advance(23 * HOUR);
        const again = await repo.announce(run.id, [
          candidate(run.id, 0, { relPath: c.relPath, sha256: c.sha256 }),
        ]);
        expect(again.ok && again.plan.items[0].kind).toBe('existing');
        await h.advance(2 * HOUR);
        expect(await repo.expireStaleAnnounced(24, 100)).toBe(0);
        await h.advance(23 * HOUR);
        expect(await repo.expireStaleAnnounced(24, 100)).toBe(1);
      });

      it('does not mark the object of a file that came back to life as gone', async () => {
        const run = await newRun();
        const [c] = (await announceN(run.id, 1)).cs;
        await h.advance(25 * HOUR);
        expect(await repo.expireStaleAnnounced(24, 100)).toBe(1);
        const [stale] = await repo.filesNeedingObjectRemoval(10);
        // the file is announced again while its object is being removed
        await repo.announce(run.id, [
          candidate(run.id, 0, { relPath: c.relPath, sha256: c.sha256 }),
        ]);
        await repo.markObjectsDeleted([stale.id]);
        const [row] = await repo.getFiles(run.id, [c.id]);
        expect(row.status).toBe('announced');
        expect(row.parseSummary).toBeNull();
      });

      it('deletes a discarded run whose only log is a dry run, but keeps one with an apply', async () => {
        const dry = await newRun();
        const applied = await newRun();
        await repo.transitionRun(dry.id, ['draft'], 'discarded', {
          purgeAfterDays: 7,
        });
        await repo.transitionRun(applied.id, ['draft'], 'discarded', {
          purgeAfterDays: 7,
        });
        await h.addApply(dry.id, 'dry_run', h.userA);
        await h.addApply(applied.id, 'dry_run', h.userA);
        await h.addApply(applied.id, 'apply', h.userA);
        await h.advance(8 * DAY);
        expect(await repo.deleteRunsPastPurge(10)).toBe(1);
        expect(await h.rawRunExists(dry.id)).toBe(false);
        expect(await h.rawRunExists(applied.id)).toBe(true);
      });

      it('says which storage paths belong to a file row', async () => {
        const run = await newRun();
        const [c] = (await announceN(run.id, 1)).cs;
        const known = await repo.knownStoragePaths([
          c.storagePath,
          'upload/x/y.pdf',
        ]);
        expect([...known]).toEqual([c.storagePath]);
        expect([...(await repo.knownStoragePaths([]))]).toEqual([]);
      });
    });

    describe('limits of a run', () => {
      it('holds 1500 files in one run', async () => {
        const run = await newRun();
        for (let i = 0; i < 30; i++) {
          const cs = Array.from({ length: 50 }, (_, j) =>
            candidate(run.id, i * 50 + j)
          );
          const r = await repo.announce(run.id, cs);
          expect(r.ok && r.plan.items.every(it => it.kind === 'insert')).toBe(
            true
          );
        }
        const over = await repo.announce(run.id, [candidate(run.id, 5000)]);
        expect(over.ok && over.plan.items[0]).toMatchObject({
          kind: 'reject',
          code: 'RUN_FILE_LIMIT',
        });
        expect(LIMITS.maxFilesPerRun).toBe(1500);
      });
    });
  });
}
