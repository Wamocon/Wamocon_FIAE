// Files of a run: announce, list, signed upload urls, report as done.
// Concept 4.3 (flow of the upload), 4.4 (paths), 4.5 (limits), 9.1 T6 and T16.

import { randomUUID } from 'crypto';
import {
  parseAnnounceBody,
  validateEntry,
  type AnnounceWarning,
  type Candidate,
} from '@/lib/content-upload/staging/announce';
import { LIMITS } from '@/lib/content-upload/staging/config';
import {
  MAGIC_HEAD_BYTES,
  magicRejectionCode,
  matchesMagic,
} from '@/lib/content-upload/staging/magic';
import {
  isStoragePathOfRun,
  uploadStoragePath,
} from '@/lib/content-upload/staging/paths';
import { mapLimit } from '@/lib/content-upload/staging/pool';
import {
  fail,
  ok,
  type Caller,
  type ServiceResult,
  type UploadDeps,
} from '@/lib/content-upload/staging/result';
import type { RunStatus } from '@/lib/content-upload/staging/status';
import type { FileRow, RunRow } from '@/lib/content-upload/staging/types';
import { fileDto, type FileDto } from '@/lib/content-upload/staging/runs';
import { checkRateLimit } from '@/lib/rate-limit';
import { isUuid } from '@/lib/uuid';

/** States in which files may still be announced and uploaded. */
const OPEN_FOR_FILES: readonly RunStatus[] = ['draft', 'uploading'];
/** States in which an upload may still be reported as done. */
const OPEN_FOR_COMPLETION: readonly RunStatus[] = [
  'draft',
  'uploading',
  'processing',
  'review',
];

const STORAGE_CONCURRENCY = 4;

function runStateFailure(run: RunRow, what: string) {
  return fail(
    409,
    `${what} is not possible while the run is ${run.status}`,
    'RUN_STATE'
  );
}

// ---------------------------------------------------------------------------
// Announce
// ---------------------------------------------------------------------------

export interface AnnounceItemResult {
  index: number;
  status: 'announced' | 'merged' | 'existing' | 'rejected';
  relPath?: string;
  fileId?: string;
  /** Status of the file that already existed (status `existing`). */
  fileStatus?: string;
  /** The main file of an exact copy (status `merged`). */
  duplicateOfId?: string;
  /** Why a file was refused (status `rejected`). */
  code?: string;
  /** The same content was applied by an earlier run (only a hint). */
  alreadyApplied?: { runId: string };
}

export interface AnnounceResponse {
  results: AnnounceItemResult[];
  counts: {
    announced: number;
    merged: number;
    existing: number;
    rejected: number;
  };
  warnings: AnnounceWarning[];
}

export async function announceFiles(
  deps: UploadDeps,
  run: RunRow,
  body: unknown
): Promise<ServiceResult<AnnounceResponse>> {
  const parsed = parseAnnounceBody(body);
  if (!parsed.ok) return fail(400, parsed.error, 'BODY_INVALID');
  if (!OPEN_FOR_FILES.includes(run.status)) {
    return runStateFailure(run, 'Announcing files');
  }

  const results: AnnounceItemResult[] = new Array(parsed.entries.length);
  const candidates: Candidate[] = [];
  parsed.entries.forEach((raw, index) => {
    const verdict = validateEntry(raw, index);
    if (!verdict.ok) {
      results[index] = {
        index,
        status: 'rejected',
        code: verdict.code,
        ...(verdict.relPath ? { relPath: verdict.relPath } : {}),
      };
      return;
    }
    const id = randomUUID();
    candidates.push({
      ...verdict.entry,
      id,
      // The server picks the storage path, from two uuids and the extension
      storagePath: uploadStoragePath(run.id, id, verdict.entry.ext),
    });
  });

  let warnings: AnnounceWarning[] = [];
  if (candidates.length > 0) {
    const written = await deps.repo.announce(run.id, candidates);
    if (!written.ok) {
      if (written.reason === 'RUN_NOT_FOUND') return fail(404, 'Run not found');
      return fail(
        409,
        `Announcing files is not possible while the run is ${written.status}`,
        'RUN_STATE'
      );
    }
    warnings = written.plan.warnings;
    for (const item of written.plan.items) {
      const hint = item.alreadyAppliedInRunId
        ? { alreadyApplied: { runId: item.alreadyAppliedInRunId } }
        : {};
      switch (item.kind) {
        case 'insert':
          results[item.index] = {
            index: item.index,
            status: 'announced',
            relPath: item.candidate.relPath,
            fileId: item.candidate.id,
            ...hint,
          };
          break;
        case 'merge':
          results[item.index] = {
            index: item.index,
            status: 'merged',
            relPath: item.candidate.relPath,
            fileId: item.candidate.id,
            duplicateOfId: item.duplicateOfId,
            ...hint,
          };
          break;
        case 'revive':
          results[item.index] = {
            index: item.index,
            status: 'announced',
            fileId: item.fileId,
            ...hint,
          };
          break;
        case 'existing':
          results[item.index] = {
            index: item.index,
            status: 'existing',
            fileId: item.fileId,
            fileStatus: item.status,
            ...hint,
          };
          break;
        case 'reject':
          results[item.index] = {
            index: item.index,
            status: 'rejected',
            code: item.code,
          };
          break;
      }
    }
  }

  const counts = { announced: 0, merged: 0, existing: 0, rejected: 0 };
  for (const r of results) counts[r.status] += 1;
  return ok({ results, counts, warnings });
}

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

const MAX_LIST_PAGE = 500;
/** Far more than a run can hold (1500 files, copies included). */
const MAX_LIST_OFFSET = 100_000;

export async function listRunFiles(
  deps: UploadDeps,
  run: RunRow,
  query: { offset?: unknown; limit?: unknown }
): Promise<ServiceResult<{ files: FileDto[]; offset: number; limit: number }>> {
  const number = (value: unknown, fallback: number) => {
    if (value === undefined || value === null || value === '') return fallback;
    const n = Number(value);
    return Number.isInteger(n) && n >= 0 ? n : NaN;
  };
  const offset = number(query.offset, 0);
  const limit = number(query.limit, 200);
  if (
    Number.isNaN(offset) ||
    Number.isNaN(limit) ||
    limit < 1 ||
    offset > MAX_LIST_OFFSET
  ) {
    return fail(400, 'offset and limit must be whole numbers', 'QUERY_INVALID');
  }
  const page = Math.min(limit, MAX_LIST_PAGE);
  const files = await deps.repo.listFiles(run.id, { offset, limit: page });
  return ok({ files: files.map(fileDto), offset, limit: page });
}

// ---------------------------------------------------------------------------
// File ids of a request
// ---------------------------------------------------------------------------

export function parseFileIds(body: unknown): ServiceResult<string[]> {
  const ids =
    body && typeof body === 'object' && !Array.isArray(body)
      ? (body as { fileIds?: unknown }).fileIds
      : undefined;
  if (!Array.isArray(ids) || ids.length === 0) {
    return fail(
      400,
      'fileIds must be a list with at least one id',
      'BODY_INVALID'
    );
  }
  if (ids.length > LIMITS.maxFilesPerRequest) {
    return fail(
      400,
      `At most ${LIMITS.maxFilesPerRequest} files per request`,
      'BODY_INVALID'
    );
  }
  if (!ids.every(isUuid)) {
    return fail(400, 'Invalid fileIds', 'BODY_INVALID');
  }
  return ok([...new Set(ids.map(id => id.toLowerCase()))]);
}

// ---------------------------------------------------------------------------
// Signed upload urls
// ---------------------------------------------------------------------------

export type UploadUrlItem =
  | {
      fileId: string;
      ok: true;
      /** The path the signed url is for: the one exception to "no paths in answers". */
      path: string;
      token: string;
      signedUrl: string;
    }
  | { fileId: string; ok: false; code: string };

/**
 * Signed upload urls for up to 50 files of a run, made only now, right before
 * the upload (their life is set by Supabase, so they are not made in advance).
 * Only files of this run in the state `announced` get one, never one for a
 * foreign or discarded run. 60 requests per minute and person: a counter in the
 * database (valid across instances) and one in the memory of the instance.
 */
export async function issueUploadUrls(
  deps: UploadDeps,
  caller: Caller,
  run: RunRow,
  body: unknown
): Promise<ServiceResult<{ items: UploadUrlItem[] }>> {
  const parsed = parseFileIds(body);
  if (!parsed.ok) return parsed;
  if (!OPEN_FOR_FILES.includes(run.status)) {
    return runStateFailure(run, 'Signed upload urls');
  }

  const burst = checkRateLimit(`content-upload-url:${caller.id}`, {
    limit: LIMITS.signedUrlRequestsPerWindow,
    windowMs: LIMITS.signedUrlWindowSeconds * 1000,
  });
  if (!burst.allowed) {
    return fail(429, 'Too many requests for upload urls', 'RATE_LIMITED', {
      retryAfterSec: burst.retryAfterSec,
    });
  }
  const counted = await deps.repo.reserveUrlRequest(caller.id);
  if (!counted.allowed) {
    return fail(429, 'Too many requests for upload urls', 'RATE_LIMITED', {
      retryAfterSec: counted.retryAfterSec,
    });
  }

  const files = new Map(
    (await deps.repo.getFiles(run.id, parsed.data)).map(f => [f.id, f])
  );
  const items = await mapLimit(
    parsed.data,
    STORAGE_CONCURRENCY,
    async (fileId): Promise<UploadUrlItem> => {
      const file = files.get(fileId);
      // A file of another run is as unknown as one that does not exist
      if (!file) return { fileId, ok: false, code: 'NOT_FOUND' };
      if (file.status !== 'announced') {
        return { fileId, ok: false, code: 'NOT_ANNOUNCED' };
      }
      if (!isStoragePathOfRun(file.storagePath, run.id)) {
        return { fileId, ok: false, code: 'INVALID_PATH' };
      }
      let outcome;
      try {
        outcome = await deps.storage().createSignedUploadUrl(file.storagePath);
      } catch {
        return { fileId, ok: false, code: 'STORAGE_UNAVAILABLE' };
      }
      if (!outcome.ok) return { fileId, ok: false, code: outcome.code };
      return {
        fileId,
        ok: true,
        path: outcome.path,
        token: outcome.token,
        signedUrl: outcome.signedUrl,
      };
    }
  );
  return ok({ items });
}

// ---------------------------------------------------------------------------
// Reported as done
// ---------------------------------------------------------------------------

export interface CompleteItem {
  fileId: string;
  /** The status of the file after the call. */
  status: string;
  code?: string;
}

/**
 * The browser says the upload of up to 50 files is done. For each file the
 * server checks that the object exists and has the announced size, reads its
 * first bytes (a range, never the whole file) and compares them with the
 * extension. Then the file is `uploaded`, and the queue picks it up. A file
 * with the wrong size or the wrong magic bytes is rejected and its object
 * deleted. The SHA-256 cannot be compared here without reading the whole file
 * (the storage knows no SHA-256), so the queue does it in its first step.
 * Calling it twice for a file is fine.
 */
export async function completeFiles(
  deps: UploadDeps,
  run: RunRow,
  body: unknown
): Promise<ServiceResult<{ results: CompleteItem[] }>> {
  const parsed = parseFileIds(body);
  if (!parsed.ok) return parsed;
  if (!OPEN_FOR_COMPLETION.includes(run.status)) {
    return runStateFailure(run, 'Reporting an upload as done');
  }

  const files = new Map(
    (await deps.repo.getFiles(run.id, parsed.data)).map(f => [f.id, f])
  );
  const results = await mapLimit(parsed.data, STORAGE_CONCURRENCY, fileId =>
    completeOne(deps, run, fileId, files.get(fileId))
  );
  await deps.repo.touchRun(run.id);
  return ok({ results });
}

async function currentState(
  deps: UploadDeps,
  run: RunRow,
  fileId: string
): Promise<CompleteItem> {
  const [current] = await deps.repo.getFiles(run.id, [fileId]);
  return current
    ? {
        fileId,
        status: current.status,
        ...(current.statusCode ? { code: current.statusCode } : {}),
      }
    : { fileId, status: 'unknown', code: 'NOT_FOUND' };
}

async function completeOne(
  deps: UploadDeps,
  run: RunRow,
  fileId: string,
  file: FileRow | undefined
): Promise<CompleteItem> {
  if (!file) return { fileId, status: 'unknown', code: 'NOT_FOUND' };
  // Reported before, or already moved on: the answer is the state it is in
  if (file.status !== 'announced') {
    return {
      fileId,
      status: file.status,
      ...(file.statusCode ? { code: file.statusCode } : {}),
    };
  }
  if (!isStoragePathOfRun(file.storagePath, run.id)) {
    return { fileId, status: 'announced', code: 'INVALID_PATH' };
  }

  let probe;
  try {
    probe = await deps.storage().probe(file.storagePath, MAGIC_HEAD_BYTES);
  } catch {
    return { fileId, status: 'announced', code: 'STORAGE_UNAVAILABLE' };
  }
  if (!probe) return { fileId, status: 'announced', code: 'OBJECT_MISSING' };

  const reason =
    probe.size !== file.sizeBytes
      ? 'SIZE_MISMATCH'
      : matchesMagic(file.ext, probe.head)
        ? null
        : magicRejectionCode(file.ext);
  if (reason) return rejectUpload(deps, run, file, reason);

  const moved = await deps.repo.transitionFile(
    run.id,
    file.id,
    'announced',
    'uploaded',
    { completed: true }
  );
  return moved
    ? { fileId, status: 'uploaded' }
    : currentState(deps, run, fileId);
}

async function rejectUpload(
  deps: UploadDeps,
  run: RunRow,
  file: FileRow,
  code: string
): Promise<CompleteItem> {
  // The object goes first. If it cannot be removed the file is rejected anyway
  // and the cleanup removes the object later (no marker is written then).
  let removed = false;
  try {
    await deps.storage().remove([file.storagePath]);
    removed = true;
  } catch {
    removed = false;
  }
  const moved = await deps.repo.transitionFile(
    run.id,
    file.id,
    'announced',
    'rejected',
    { code, objectDeleted: removed }
  );
  if (!moved) return currentState(deps, run, file.id);
  return { fileId: file.id, status: 'rejected', code };
}
