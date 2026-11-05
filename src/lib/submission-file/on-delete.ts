// The files of submissions go at once when what they belong to is deleted: a trainee (admin
// route), a use case or a course (curriculum routes). The rows of use_case_submissions are
// removed by the database (on delete cascade), the file in the private bucket is not, so a
// route collects what to remove BEFORE it deletes, and removes the files AFTER the delete went
// through. A delete that fails (for example a profile that others still point at) keeps the
// files.
//
// The removal never fails the request: the delete of the database is done and the cleanup run
// (scripts/storage/cleanup-submission-files.mjs, reason "deleted") takes whatever is left, so a
// storage that does not answer costs nothing but a short delay. Nothing but a fixed text is
// logged, never an id or a name.
//
// What is found:
//  - trainee: every use case folder under `<org>/<trainee>` (drafts without a submission row
//    included), for the organization of the profile and for every organization named by a
//    submission row of the trainee
//  - use case, course: the folders named by the submission rows of the use cases (a draft
//    without a row is left to the cleanup run)
//
// Where the feature is off (Production) nothing is read and nothing is removed.

import { eq, inArray } from 'drizzle-orm';
import db from '@/db';
import { useCaseSubmissions, useCases } from '@/db/migrations/schemas/schema';
import { DB_SCHEMA } from '@/lib/db-schema';
import { isSubmissionFileEnabled } from '@/lib/submission-file/availability';
import {
  isUuidFolderName,
  traineeFolder,
  type SubmissionScope,
} from '@/lib/submission-file/rules';
import { removeFile } from '@/lib/submission-file/service';
import {
  createSubmissionStorage,
  type SubmissionFileStorage,
} from '@/lib/submission-file/storage';

export interface RemovalTargets {
  /** Exact scopes whose files go (from submission rows). */
  scopes: SubmissionScope[];
  /** Trainee folders whose use case sub folders are all read and removed. */
  trainees: Array<{ organizationId: string; traineeId: string }>;
}

/** Scopes removed at the same time. */
const CONCURRENCY = 8;

const none = (): RemovalTargets => ({ scopes: [], trainees: [] });

const scopeKey = (s: SubmissionScope) =>
  `${s.organizationId}/${s.traineeId}/${s.useCaseId}`;

async function guarded(
  what: () => Promise<RemovalTargets>
): Promise<RemovalTargets> {
  if (!isSubmissionFileEnabled()) return none();
  try {
    return await what();
  } catch {
    // the cleanup run finds the files later
    console.error(
      'Submission files: the targets of a removal could not be read'
    );
    return none();
  }
}

/** The files of one trainee, to be called before the profile is deleted. */
export function submissionFileTargetsOfTrainee(
  traineeId: string,
  organizationId: string | null
): Promise<RemovalTargets> {
  return guarded(async () => {
    const rows = await db
      .select({
        organizationId: useCaseSubmissions.organizationId,
        useCaseId: useCaseSubmissions.useCaseId,
      })
      .from(useCaseSubmissions)
      .where(eq(useCaseSubmissions.traineeId, traineeId as any));
    const organizations = new Set<string>(
      rows.map(row => String(row.organizationId))
    );
    if (organizationId) organizations.add(String(organizationId));
    return {
      scopes: rows.map(row => ({
        organizationId: String(row.organizationId),
        traineeId,
        useCaseId: String(row.useCaseId),
      })),
      trainees: [...organizations].map(org => ({
        organizationId: org,
        traineeId,
      })),
    };
  });
}

/** The files of the submissions of use cases, to be called before they are deleted. */
export function submissionFileTargetsOfUseCases(
  useCaseIds: readonly string[]
): Promise<RemovalTargets> {
  return guarded(async () => {
    if (useCaseIds.length === 0) return none();
    const rows = await db
      .select({
        organizationId: useCaseSubmissions.organizationId,
        traineeId: useCaseSubmissions.traineeId,
        useCaseId: useCaseSubmissions.useCaseId,
      })
      .from(useCaseSubmissions)
      .where(inArray(useCaseSubmissions.useCaseId, [...useCaseIds] as any[]));
    return {
      scopes: rows.map(row => ({
        organizationId: String(row.organizationId),
        traineeId: String(row.traineeId),
        useCaseId: String(row.useCaseId),
      })),
      trainees: [],
    };
  });
}

/** The files of the submissions of all use cases of a course, before the course is deleted. */
export function submissionFileTargetsOfCourse(
  courseId: string
): Promise<RemovalTargets> {
  return guarded(async () => {
    const rows = await db
      .select({ id: useCases.id })
      .from(useCases)
      .where(eq(useCases.courseId, courseId as any));
    return submissionFileTargetsOfUseCases(rows.map(row => String(row.id)));
  });
}

/**
 * Removes the files of the targets, after the delete of the database went through. Returns
 * the number of objects removed. Never throws.
 */
export async function removeSubmissionFiles(
  targets: RemovalTargets,
  deps: { storage?: SubmissionFileStorage } = {}
): Promise<number> {
  if (targets.scopes.length === 0 && targets.trainees.length === 0) return 0;
  if (!isSubmissionFileEnabled()) return 0;
  let removed = 0;
  let failures = 0;
  let storage: SubmissionFileStorage;
  try {
    storage = deps.storage ?? createSubmissionStorage();
  } catch {
    console.error(
      'Submission files: the storage is not available, the cleanup run takes it'
    );
    return 0;
  }
  const scopes = new Map(targets.scopes.map(s => [scopeKey(s), s]));
  for (const { organizationId, traineeId } of targets.trainees) {
    const folder = traineeFolder(organizationId, traineeId, DB_SCHEMA);
    if (!folder) continue;
    try {
      for (const name of await storage.listFolders(folder)) {
        if (!isUuidFolderName(name)) continue;
        const scope = { organizationId, traineeId, useCaseId: name };
        scopes.set(scopeKey(scope), scope);
      }
    } catch {
      failures += 1;
    }
  }
  // one scope that fails does not stop the others, a few at a time
  const all = [...scopes.values()];
  for (let i = 0; i < all.length; i += CONCURRENCY) {
    await Promise.all(
      all.slice(i, i + CONCURRENCY).map(async scope => {
        try {
          const result = await removeFile({ storage }, scope);
          if (result.ok) removed += result.value;
          else failures += 1;
        } catch {
          failures += 1;
        }
      })
    );
  }
  if (failures > 0) {
    console.error(
      `Submission files: ${failures} removal(s) failed, the cleanup run takes them`
    );
  }
  return removed;
}
