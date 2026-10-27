// Upload runs: create, read with progress, list, discard (concept 1.3, 2.2, 2.3).
//
// A run belongs to the person who created it. Only that person sees it, and the
// platform wide SUPER_ADMIN sees all of them; for everybody else a run of
// another person does not exist (404, the same answer as for an unknown id).

import { randomUUID } from 'crypto';
import {
  LIMITS,
  UPLOAD_CATALOG_CODE,
} from '@/lib/content-upload/staging/config';
import {
  removePendingObjects,
  runCleanup,
} from '@/lib/content-upload/staging/cleanup';
import { runStoragePrefix } from '@/lib/content-upload/staging/paths';
import {
  fail,
  ok,
  type Caller,
  type ServiceResult,
  type UploadDeps,
} from '@/lib/content-upload/staging/result';
import type { RunStatus } from '@/lib/content-upload/staging/status';
import type {
  FileRow,
  RunProgress,
  RunRow,
} from '@/lib/content-upload/staging/types';
import { isUuid } from '@/lib/uuid';

export const RUN_NOT_FOUND = 'Run not found';

/** Longest time the cleanup that goes with a new run may take. */
const LAZY_CLEANUP_BUDGET_MS = 4000;

export interface RunDto {
  id: string;
  catalog: string;
  label: string;
  status: RunStatus;
  kiEnabled: boolean;
  decisionsVersion: number;
  createdById: string;
  createdAt: string;
  updatedAt: string;
}

/** The answer for a run. Never the storage prefix. */
export function runDto(run: RunRow): RunDto {
  return {
    id: run.id,
    catalog: UPLOAD_CATALOG_CODE,
    label: run.label,
    status: run.status,
    kiEnabled: run.kiEnabled,
    decisionsVersion: run.decisionsVersion,
    createdById: run.createdById,
    createdAt: run.createdAt.toISOString(),
    updatedAt: run.updatedAt.toISOString(),
  };
}

export interface FileDto {
  id: string;
  relPath: string;
  fileName: string;
  ext: string;
  sizeBytes: number;
  sha256: string;
  status: string;
  statusCode: string | null;
  duplicateOfId: string | null;
  docType: string | null;
  createdAt: string;
}

/** The answer for a file. Never the storage path, the claim or the parse summary. */
export function fileDto(file: FileRow): FileDto {
  return {
    id: file.id,
    relPath: file.relPath,
    fileName: file.fileName,
    ext: file.ext,
    sizeBytes: file.sizeBytes,
    sha256: file.sha256,
    status: file.status,
    statusCode: file.statusCode,
    duplicateOfId: file.duplicateOfId,
    docType: file.docType,
    createdAt: file.createdAt.toISOString(),
  };
}

/**
 * Only the creator sees a run, and the platform wide SUPER_ADMIN sees all.
 * (An ADMIN of the platform organization passes requireCurriculumEditor too,
 * but is not a SUPER_ADMIN by role: that person sees the own runs only.)
 */
export function canAccessRun(caller: Caller, run: Pick<RunRow, 'createdById'>) {
  return run.createdById === caller.id || caller.role === 'SUPER_ADMIN';
}

/** The run of a path id for this caller: 404 for a bad id, an unknown run and a foreign run. */
export async function loadRun(
  deps: UploadDeps,
  caller: Caller,
  runId: unknown
): Promise<ServiceResult<RunRow>> {
  if (!isUuid(runId)) return fail(404, RUN_NOT_FOUND);
  const run = await deps.repo.getRun(runId);
  if (!run || !canAccessRun(caller, run)) return fail(404, RUN_NOT_FOUND);
  return ok(run);
}

export interface CreateRunInput {
  label: string;
  kiEnabled: boolean;
}

/** `{ label, declarationAccepted: true, kiEnabled?, catalog? }` */
export function parseCreateRunBody(
  body: unknown
): ServiceResult<CreateRunInput> {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'The request body must be an object');
  }
  const input = body as Record<string, unknown>;

  const label =
    typeof input.label === 'string'
      ? input.label.replace(/[\p{Cc}\p{Cf}]/gu, '').trim()
      : '';
  if (label.length < 1 || label.length > LIMITS.maxLabelChars) {
    return fail(
      400,
      `label is required, 1 to ${LIMITS.maxLabelChars} characters`,
      'LABEL_INVALID'
    );
  }
  if (input.declarationAccepted !== true) {
    return fail(
      400,
      'The declaration that the files hold no customer documents must be accepted',
      'DECLARATION_REQUIRED'
    );
  }
  if (input.kiEnabled !== undefined && typeof input.kiEnabled !== 'boolean') {
    return fail(400, 'kiEnabled must be true or false', 'KI_INVALID');
  }
  if (
    input.catalog !== undefined &&
    (typeof input.catalog !== 'string' ||
      input.catalog.trim().toUpperCase() !== UPLOAD_CATALOG_CODE)
  ) {
    return fail(
      400,
      `Only the catalog ${UPLOAD_CATALOG_CODE} is supported`,
      'CATALOG_UNSUPPORTED'
    );
  }
  // The model stage is an opt in: a run without the choice does not send anything
  return ok({ label, kiEnabled: input.kiEnabled === true });
}

export async function createRun(
  deps: UploadDeps,
  caller: Caller,
  body: unknown
): Promise<ServiceResult<RunRow>> {
  const parsed = parseCreateRunBody(body);
  if (!parsed.ok) return parsed;

  const catalogId = await deps.repo.catalogIdByCode(UPLOAD_CATALOG_CODE);
  if (!catalogId) {
    return fail(
      404,
      `The catalog ${UPLOAD_CATALOG_CODE} does not exist in this environment`,
      'CATALOG_MISSING'
    );
  }
  const id = randomUUID();
  const created = await deps.repo.createRun(
    {
      id,
      catalogId,
      createdById: caller.id,
      label: parsed.data.label,
      kiEnabled: parsed.data.kiEnabled,
      storagePrefix: runStoragePrefix(id),
    },
    LIMITS.maxActiveRunsPerPerson
  );
  if (!created.ok) {
    return fail(
      429,
      `At most ${LIMITS.maxActiveRunsPerPerson} runs can be active at the same time, discard or finish one first`,
      'TOO_MANY_ACTIVE_RUNS'
    );
  }

  await lazyCleanup(deps);
  return ok(created.run);
}

/**
 * The cleanup that goes with every new run (no cron). It must never stop the
 * run from being created: a failure or a slow bucket only means the next call
 * does the work.
 */
async function lazyCleanup(deps: UploadDeps): Promise<void> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    await Promise.race([
      runCleanup(deps, { batch: 50, rounds: 2 }),
      new Promise<void>(resolve => {
        timer = setTimeout(resolve, LAZY_CLEANUP_BUDGET_MS);
      }),
    ]);
  } catch (error) {
    console.error('[content-upload] cleanup failed', errorName(error));
  } finally {
    clearTimeout(timer);
  }
}

function errorName(error: unknown): string {
  return error instanceof Error ? error.name : 'Error';
}

export interface RunWithProgress {
  run: RunDto;
  progress: RunProgress;
  limits: {
    maxFilesPerRequest: number;
    maxFileBytes: number;
    maxFilesPerRun: number;
    maxRunBytes: number;
  };
}

export async function getRunWithProgress(
  deps: UploadDeps,
  run: RunRow
): Promise<RunWithProgress> {
  const progress = await deps.repo.runProgress(run.id);
  return {
    run: runDto(run),
    progress,
    limits: {
      maxFilesPerRequest: LIMITS.maxFilesPerRequest,
      maxFileBytes: LIMITS.maxFileBytes,
      maxFilesPerRun: LIMITS.maxFilesPerRun,
      maxRunBytes: LIMITS.maxRunBytes,
    },
  };
}

export async function listRuns(
  deps: UploadDeps,
  caller: Caller
): Promise<RunRow[]> {
  return deps.repo.listRuns({
    createdById: caller.role === 'SUPER_ADMIN' ? undefined : caller.id,
    limit: 50,
  });
}

/** States from which a run may be discarded (applying is not one of them). */
const DISCARDABLE: readonly RunStatus[] = [
  'draft',
  'uploading',
  'processing',
  'review',
  'applied',
  'failed',
];

/**
 * Discards a run: its objects go at once (as far as the bucket answers, the
 * cleanup does the rest), its rows after 7 days. Discarding twice is fine.
 */
export async function discardRun(
  deps: UploadDeps,
  run: RunRow
): Promise<ServiceResult<RunRow>> {
  const discarded = await deps.repo.transitionRun(
    run.id,
    DISCARDABLE,
    'discarded',
    { purgeAfterDays: LIMITS.discardedRowsDays }
  );
  if (!discarded) {
    const current = await deps.repo.getRun(run.id);
    if (current?.status === 'discarded') return ok(current);
    return fail(
      409,
      `A run in the state ${current?.status ?? 'unknown'} cannot be discarded`,
      'RUN_STATE'
    );
  }
  try {
    await removePendingObjects(deps, {
      batch: 100,
      rounds: 3,
      runId: run.id,
    });
  } catch (error) {
    // The run is discarded, the cleanup removes what is left
    console.error('[content-upload] removing objects failed', errorName(error));
  }
  return ok(discarded);
}
