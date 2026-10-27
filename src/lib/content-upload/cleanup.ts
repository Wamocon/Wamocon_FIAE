// Cleaning up the staging area (concept section 4.6). No cron: it is started
// lazily when a run is created and by the route for administrators.
//
// What it does, in this order:
//   1. announced files that were never reported as done: after 24 hours they are
//      expired (a conditional update, so a file that is reported done in the same
//      moment wins)
//   2. runs that were never applied and are idle for 30 days are discarded (an
//      applied run is never touched automatically)
//   3. the objects of rejected and expired files, of discarded runs, and of applied
//      runs past their purge date are removed from the bucket; the row keeps a
//      marker that its object is gone
//   4. discarded runs past their purge date are deleted with their rows, but only
//      when every object is gone
//
// Orphans (objects in the bucket that no row knows) are the other half. The
// bucket is shared by Preview, local development and branch databases, so an
// environment without the rows of another one would take its files for orphans.
// They are therefore only LISTED, and deleted only by an explicit call and only
// when they are older than 7 days. Only objects of the exact path form of the
// schema are ever looked at.

import { LIMITS } from '@/lib/content-upload/config';
import {
  isStoragePathOfRun,
  parseUploadStoragePath,
} from '@/lib/content-upload/paths';
import type { UploadDeps } from '@/lib/content-upload/result';

const DAY_MS = 24 * 60 * 60 * 1000;
const REMOVE_CHUNK = 100;
const LIST_MAX = 5000;

export interface CleanupReport {
  expired: number;
  runsDiscarded: number;
  objectsRemoved: number;
  removalFailed: number;
  skippedInvalidPath: number;
  runsDeleted: number;
}

export interface CleanupOptions {
  /** Rows handled per step and round. */
  batch?: number;
  /** Rounds of object removal at most. */
  rounds?: number;
  /** Only the objects of this run. */
  runId?: string;
}

/** Removes the objects that have to go. Returns how many went, failed and were skipped. */
export async function removePendingObjects(
  deps: UploadDeps,
  options: CleanupOptions = {}
): Promise<
  Pick<CleanupReport, 'objectsRemoved' | 'removalFailed' | 'skippedInvalidPath'>
> {
  const batch = options.batch ?? REMOVE_CHUNK;
  const rounds = options.rounds ?? 5;
  const report = { objectsRemoved: 0, removalFailed: 0, skippedInvalidPath: 0 };

  for (let round = 0; round < rounds; round++) {
    const files = await deps.repo.filesNeedingObjectRemoval(
      batch,
      options.runId
    );
    if (files.length === 0) break;

    // A row whose path is not the exact form can name no object we may touch
    const valid = files.filter(f => isStoragePathOfRun(f.storagePath, f.runId));
    const invalid = files.filter(f => !valid.includes(f));
    if (invalid.length > 0) {
      await deps.repo.markObjectsDeleted(invalid.map(f => f.id));
      report.skippedInvalidPath += invalid.length;
    }
    if (valid.length > 0) {
      try {
        await deps.storage().remove(valid.map(f => f.storagePath));
        await deps.repo.markObjectsDeleted(valid.map(f => f.id));
        report.objectsRemoved += valid.length;
      } catch {
        // The rows stay, the next cleanup tries again. Do not loop on a failure.
        report.removalFailed += valid.length;
        break;
      }
    }
    if (files.length < batch) break;
  }
  return report;
}

export async function runCleanup(
  deps: UploadDeps,
  options: CleanupOptions = {}
): Promise<CleanupReport> {
  const batch = options.batch ?? REMOVE_CHUNK;
  const expired = await deps.repo.expireStaleAnnounced(
    LIMITS.expireAfterHours,
    batch
  );
  const discarded = await deps.repo.discardStaleRuns(
    LIMITS.orphanRunDays,
    LIMITS.discardedRowsDays,
    batch
  );
  const removal = await removePendingObjects(deps, options);
  const runsDeleted = await deps.repo.deleteRunsPastPurge(batch);
  return {
    expired,
    runsDiscarded: discarded.length,
    ...removal,
    runsDeleted,
  };
}

// ---------------------------------------------------------------------------
// Orphans in the bucket
// ---------------------------------------------------------------------------

export interface OrphanInfo {
  runId: string;
  fileId: string;
  ext: string;
  sizeBytes: number | null;
  createdAt: string | null;
  /** Older than the minimum age: only these may be deleted. */
  deletable: boolean;
}

interface FoundOrphan extends OrphanInfo {
  path: string;
}

async function findOrphans(
  deps: UploadDeps,
  now: number
): Promise<{ orphans: FoundOrphan[]; truncated: boolean }> {
  const objects = await deps.storage().list({ maxObjects: LIST_MAX });
  const parsed = objects.flatMap(o => {
    const p = parseUploadStoragePath(o.path);
    return p ? [{ object: o, parts: p }] : [];
  });
  const known = await deps.repo.knownStoragePaths(
    parsed.map(p => p.object.path)
  );
  const minAge = LIMITS.orphanObjectMinAgeDays * DAY_MS;
  const orphans = parsed
    .filter(p => !known.has(p.object.path))
    .map(p => ({
      path: p.object.path,
      runId: p.parts.runId,
      fileId: p.parts.fileId,
      ext: p.parts.ext,
      sizeBytes: p.object.size,
      createdAt: p.object.createdAt ? p.object.createdAt.toISOString() : null,
      // An object without a known age is never deleted
      deletable:
        p.object.createdAt !== null &&
        now - p.object.createdAt.getTime() >= minAge,
    }));
  return { orphans, truncated: objects.length >= LIST_MAX };
}

/** The orphans, without their paths (ids and sizes are enough to recognize them). */
export async function listOrphans(
  deps: UploadDeps,
  now: number = Date.now()
): Promise<{ orphans: OrphanInfo[]; truncated: boolean }> {
  const { orphans, truncated } = await findOrphans(deps, now);
  return {
    orphans: orphans.map(({ path: _path, ...info }) => info),
    truncated,
  };
}

/** Deletes the orphans older than 7 days. Only on an explicit call. */
export async function deleteOrphans(
  deps: UploadDeps,
  now: number = Date.now()
): Promise<{ deleted: number; skippedYoung: number; failed: number }> {
  const { orphans } = await findOrphans(deps, now);
  const old = orphans.filter(o => o.deletable);
  // Ask the rows once more right before deleting: a file announced in the
  // meantime is not an orphan
  const known = await deps.repo.knownStoragePaths(old.map(o => o.path));
  const paths = old.map(o => o.path).filter(p => !known.has(p));
  let deleted = 0;
  let failed = 0;
  for (let i = 0; i < paths.length; i += REMOVE_CHUNK) {
    const part = paths.slice(i, i + REMOVE_CHUNK);
    try {
      await deps.storage().remove(part);
      deleted += part.length;
    } catch {
      failed += part.length;
    }
  }
  return {
    deleted,
    skippedYoung: orphans.length - old.length,
    failed,
  };
}
