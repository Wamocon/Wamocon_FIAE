// Announcing files (concept 4.3 steps 1 and 2, limits of 4.5).
//
// The browser announces up to 50 files per request: relative path, size, SHA-256
// and change time. What the server does with them is split in three pure
// steps so every rule can be tested without a database:
//
//   parseAnnounceBody / validateEntry   shape of the request, one verdict per file
//   planAnnouncement                    limits, copies, repeats, hints (this file)
//   repo.announce                       writes the plan in one transaction
//
// A file that cannot be taken (wrong extension, too large, over a limit) is
// reported with a stable reason code and never stops the others. An announce
// that is sent twice is idempotent: the same relative path with the same hash
// is the same file.

import { LIMITS } from '@/lib/content-upload/config';
import { cleanRelativePath, type UploadExt } from '@/lib/content-upload/paths';

const SHA256 = /^[0-9a-f]{64}$/;
/** Year 2100: a change time beyond that is not a real one. */
const MAX_MTIME_MS = 4_102_444_800_000;

export type EntryRejectionCode =
  | 'ENTRY_INVALID'
  | 'PATH_INVALID'
  | 'PATH_EMPTY'
  | 'PATH_TOO_LONG'
  | 'PATH_TOO_DEEP'
  | 'FILE_NAME_TOO_LONG'
  | 'UNSUPPORTED_EXTENSION'
  | 'TEMP_FILE'
  | 'SIZE_INVALID'
  | 'EMPTY_FILE'
  | 'TOO_LARGE'
  | 'HASH_INVALID'
  | 'RUN_FILE_LIMIT'
  | 'RUN_SIZE_LIMIT'
  | 'STAGING_FULL';

export interface ValidatedEntry {
  index: number;
  relPath: string;
  fileName: string;
  ext: UploadExt;
  sizeBytes: number;
  sha256: string;
  clientMtimeMs: number | null;
}

export type EntryVerdict =
  | { ok: true; entry: ValidatedEntry }
  | { ok: false; index: number; code: EntryRejectionCode; relPath?: string };

export type AnnounceBody =
  | { ok: true; entries: unknown[] }
  | { ok: false; error: string };

/** The shape of the request: `{ files: [1 to 50 entries] }`. */
export function parseAnnounceBody(body: unknown): AnnounceBody {
  const files =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { files?: unknown }).files
      : undefined;
  if (!Array.isArray(files) || files.length === 0) {
    return { ok: false, error: 'files must be a list with at least one entry' };
  }
  if (files.length > LIMITS.maxFilesPerRequest) {
    return {
      ok: false,
      error: `At most ${LIMITS.maxFilesPerRequest} files per request`,
    };
  }
  return { ok: true, entries: files };
}

/** One entry: cleaned path, size, hash and change time, or the reason it is refused. */
export function validateEntry(raw: unknown, index: number): EntryVerdict {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return { ok: false, index, code: 'ENTRY_INVALID' };
  }
  const input = raw as Record<string, unknown>;

  const cleaned = cleanRelativePath(input.path);
  if (!cleaned.ok) {
    return cleaned.relPath === undefined
      ? { ok: false, index, code: cleaned.code }
      : { ok: false, index, code: cleaned.code, relPath: cleaned.relPath };
  }

  const size = input.size;
  if (typeof size !== 'number' || !Number.isSafeInteger(size) || size < 0) {
    return { ok: false, index, code: 'SIZE_INVALID', relPath: cleaned.relPath };
  }
  if (size === 0) {
    return { ok: false, index, code: 'EMPTY_FILE', relPath: cleaned.relPath };
  }
  if (size > LIMITS.maxFileBytes) {
    return { ok: false, index, code: 'TOO_LARGE', relPath: cleaned.relPath };
  }

  const sha256 =
    typeof input.sha256 === 'string' ? input.sha256.toLowerCase() : '';
  if (!SHA256.test(sha256)) {
    return { ok: false, index, code: 'HASH_INVALID', relPath: cleaned.relPath };
  }

  const mtime = input.lastModified;
  const clientMtimeMs =
    typeof mtime === 'number' &&
    Number.isSafeInteger(mtime) &&
    mtime >= 0 &&
    mtime <= MAX_MTIME_MS
      ? mtime
      : null;

  return {
    ok: true,
    entry: {
      index,
      relPath: cleaned.relPath,
      fileName: cleaned.fileName,
      ext: cleaned.ext,
      sizeBytes: size,
      sha256,
      clientMtimeMs,
    },
  };
}

// ---------------------------------------------------------------------------
// The plan
// ---------------------------------------------------------------------------

/** A validated entry with the ids and the storage path the server chose for it. */
export interface Candidate extends ValidatedEntry {
  /** Id of the new file row (a uuid the server generated). */
  id: string;
  /** Storage path made from the run id and this id. */
  storagePath: string;
}

export interface ExistingFile {
  id: string;
  status: string;
  storagePath: string;
}

/** The state the plan needs, read inside the transaction of the announce. */
export interface AnnounceFacts {
  /** Rows of the run that are not expired. */
  runFileCount: number;
  /** Bytes of the files of the run that have an object (not merged, not expired). */
  runBytes: number;
  /** Bytes of all runs together in the staging bucket. */
  stagingBytes: number;
  /** Rows of this run by `<relPath>\u0000<sha256>`. */
  existing: Map<string, ExistingFile>;
  /** sha256 to the id of a file of this run that carries the object of that content. */
  mainBySha: Map<string, string>;
  /** sha256 to the id of an earlier run that applied a file with this content. */
  appliedBySha: Map<string, string>;
}

export type PlannedItem = (
  | { kind: 'existing'; index: number; fileId: string; status: string }
  | { kind: 'revive'; index: number; fileId: string; storagePath: string }
  | { kind: 'insert'; index: number; candidate: Candidate }
  | {
      kind: 'merge';
      index: number;
      candidate: Candidate;
      duplicateOfId: string;
    }
  | { kind: 'reject'; index: number; code: EntryRejectionCode }
) & { alreadyAppliedInRunId?: string };

export interface AnnounceWarning {
  code: 'STAGING_NEAR_LIMIT';
  usedBytes: number;
  limitBytes: number;
}

export interface AnnouncePlan {
  items: PlannedItem[];
  warnings: AnnounceWarning[];
}

export function existingKey(relPath: string, sha256: string): string {
  return `${relPath}\u0000${sha256}`;
}

/**
 * Decides what happens to each candidate, in request order, so a later small
 * file can still get in after a large one was refused for a limit. Exact copies
 * inside the run are merged (no object, no bytes, but a row), a repeat of an
 * announce is the existing file, a file that expired comes back under its old
 * id. Nothing here touches a database.
 */
export function planAnnouncement(
  candidates: readonly Candidate[],
  facts: AnnounceFacts,
  limits: {
    maxFilesPerRun: number;
    maxRunBytes: number;
    maxStagingBytes: number;
    stagingWarnRatio: number;
  } = LIMITS
): AnnouncePlan {
  let files = facts.runFileCount;
  let runBytes = facts.runBytes;
  let stagingBytes = facts.stagingBytes;
  const existing = new Map(facts.existing);
  const mainBySha = new Map(facts.mainBySha);
  const items: PlannedItem[] = [];

  for (const c of candidates) {
    const hint = facts.appliedBySha.get(c.sha256);
    const withHint = <T extends PlannedItem>(item: T): T =>
      hint === undefined ? item : { ...item, alreadyAppliedInRunId: hint };
    const key = existingKey(c.relPath, c.sha256);
    const known = existing.get(key);

    if (known && known.status !== 'expired') {
      items.push(
        withHint({
          kind: 'existing',
          index: c.index,
          fileId: known.id,
          status: known.status,
        })
      );
      continue;
    }

    if (files >= limits.maxFilesPerRun) {
      items.push(
        withHint({ kind: 'reject', index: c.index, code: 'RUN_FILE_LIMIT' })
      );
      continue;
    }

    if (known) {
      // Expired: the same file comes back, under its old id and path
      if (runBytes + c.sizeBytes > limits.maxRunBytes) {
        items.push(
          withHint({ kind: 'reject', index: c.index, code: 'RUN_SIZE_LIMIT' })
        );
        continue;
      }
      if (stagingBytes + c.sizeBytes > limits.maxStagingBytes) {
        items.push(
          withHint({ kind: 'reject', index: c.index, code: 'STAGING_FULL' })
        );
        continue;
      }
      files += 1;
      runBytes += c.sizeBytes;
      stagingBytes += c.sizeBytes;
      existing.set(key, { ...known, status: 'announced' });
      if (!mainBySha.has(c.sha256)) mainBySha.set(c.sha256, known.id);
      items.push(
        withHint({
          kind: 'revive',
          index: c.index,
          fileId: known.id,
          storagePath: known.storagePath,
        })
      );
      continue;
    }

    const main = mainBySha.get(c.sha256);
    if (main !== undefined) {
      files += 1;
      existing.set(key, { id: c.id, status: 'merged', storagePath: '' });
      items.push(
        withHint({
          kind: 'merge',
          index: c.index,
          candidate: c,
          duplicateOfId: main,
        })
      );
      continue;
    }

    if (runBytes + c.sizeBytes > limits.maxRunBytes) {
      items.push(
        withHint({ kind: 'reject', index: c.index, code: 'RUN_SIZE_LIMIT' })
      );
      continue;
    }
    if (stagingBytes + c.sizeBytes > limits.maxStagingBytes) {
      items.push(
        withHint({ kind: 'reject', index: c.index, code: 'STAGING_FULL' })
      );
      continue;
    }
    files += 1;
    runBytes += c.sizeBytes;
    stagingBytes += c.sizeBytes;
    existing.set(key, {
      id: c.id,
      status: 'announced',
      storagePath: c.storagePath,
    });
    mainBySha.set(c.sha256, c.id);
    items.push(withHint({ kind: 'insert', index: c.index, candidate: c }));
  }

  const warnings: AnnounceWarning[] = [];
  if (stagingBytes >= limits.maxStagingBytes * limits.stagingWarnRatio) {
    warnings.push({
      code: 'STAGING_NEAR_LIMIT',
      usedBytes: stagingBytes,
      limitBytes: limits.maxStagingBytes,
    });
  }
  return { items, warnings };
}
