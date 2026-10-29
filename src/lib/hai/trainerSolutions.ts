/**
 * Trainer solutions in the HAI index: the KfBM model solutions (PDF files in
 * the PRIVATE bucket `content-solutions`) may be used by TRAINERS in the HAI,
 * and by nobody else. This is a decision of the owner (29.10.2026), and it stays
 * OFF until the owner switches it on.
 *
 * Pure module (no server imports, no network, no database), shared by the
 * reindex script, the search and the chat routes.
 *
 * The switch. HAI_TRAINER_SOLUTIONS=on turns the whole feature on, anything
 * else (also unset, "true", "1") leaves it off. Off means: the reindex does not
 * read the private bucket, the search never returns such a chunk, and no chat
 * history that holds one is used as context. Turning it on is a transfer of the
 * model solutions to the model provider (embedding of the text, and the
 * retrieved parts go to the chat model in the answer context).
 *
 * The marker. A chunk that comes from the private bucket carries
 * metadata.trainerSolution = true. The search excludes every such chunk unless
 * the caller is a trainer AND the switch is on (see buildScopeCondition).
 *
 * @module lib/hai/trainerSolutions
 */

import {
  SOLUTIONS_BUCKET,
  parsePrivateReference,
  storagePrefix,
} from '../content-import/documents/storage';

/** Name of the environment variable that switches the feature on. */
export const TRAINER_SOLUTIONS_ENV = 'HAI_TRAINER_SOLUTIONS';

/** metadata key of a chunk that holds text of a model solution of the private bucket. */
export const TRAINER_SOLUTION_CHUNK_KEY = 'trainerSolution';

/** metadata key of a chat session or message that was answered with such text. */
export const TRAINER_KNOWLEDGE_KEY = 'trainerKnowledge';

/**
 * Name of the model solution files in the plan of a dry run and in the cost
 * estimate. They are counted apart from every other source, because they are
 * the only text that goes to the model provider by a decision of the owner.
 */
export const TRAINER_SOLUTION_SOURCE_LABEL =
  'document (trainer solution PDFs, not chunks)';

/**
 * Whether the owner switched the feature on. Only the value "on" counts (a bare
 * "true" or "1" is no decision), surrounding blanks and the case are ignored.
 */
export function isTrainerSolutionsEnabled(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    String(env[TRAINER_SOLUTIONS_ENV] ?? '')
      .trim()
      .toLowerCase() === 'on'
  );
}

/** Name of the environment variable that routes such turns to Sokrates only. */
export const TRAINER_SOLUTIONS_CHAT_ENV = 'HAI_TRAINER_SOLUTIONS_CHAT';

/**
 * Whether a turn that holds trainer knowledge is answered by Sokrates only
 * (HAI_TRAINER_SOLUTIONS_CHAT=sokrates). Default: no, the normal chat chain
 * answers (Gemini, with Sokrates as the only fallback).
 */
export function trainerSolutionsChatSokratesOnly(
  env: Record<string, string | undefined> = process.env
): boolean {
  return (
    String(env[TRAINER_SOLUTIONS_CHAT_ENV] ?? '')
      .trim()
      .toLowerCase() === 'sokrates'
  );
}

function flagged(metadata: unknown, key: string): boolean {
  if (metadata === null || typeof metadata !== 'object') return false;
  const value = (metadata as Record<string, unknown>)[key];
  return value === true || value === 'true';
}

/** Whether a chunk (its metadata) holds text of a model solution of the private bucket. */
export function isTrainerSolutionChunk(metadata: unknown): boolean {
  return flagged(metadata, TRAINER_SOLUTION_CHUNK_KEY);
}

/** Whether a chat session or message (its metadata) was answered with trainer solutions. */
export function hasTrainerKnowledge(metadata: unknown): boolean {
  return flagged(metadata, TRAINER_KNOWLEDGE_KEY);
}

/**
 * Whether a search may return chunks of trainer solutions: only for the trainer
 * audience, and only when the access carries the permission explicitly (it is
 * set by resolveRetrievalAccess from the role in the database and the switch,
 * never from a request).
 */
export function searchMayUseTrainerSolutions(scope: {
  audience?: string;
  includeTrainerSolutions?: boolean;
}): boolean {
  return scope.audience === 'trainer' && scope.includeTrainerSolutions === true;
}

/**
 * The folder in the bucket that a target may read. Preview and Production share
 * the buckets, so a run reads its own folder only.
 */
export function privateSolutionPrefix(
  target: 'preview' | 'production' | 'local'
): string {
  return storagePrefix(target === 'preview' ? 'preview' : 'local');
}

/** The object of a private model solution. */
export interface PrivateSolutionObject {
  bucket: typeof SOLUTIONS_BUCKET;
  path: string;
}

export type PrivateSolutionParse =
  | { ok: true; object: PrivateSolutionObject }
  | { ok: false; reason: string };

/** Strict alphabet of a path in the bucket (the one the import writes). */
const SAFE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;
const MAX_PATH_LENGTH = 300;

/**
 * Checks the stored reference of a model solution (`private://content-solutions/<path>`)
 * and gives the object to read, or a reason. The value is checked as it is
 * (no trimming, no decoding), and the reason never repeats it.
 *
 *  - the bucket is exactly `content-solutions`
 *  - the path lies inside `prefix` (the folder of the target, see
 *    privateSolutionPrefix) and has only letters, digits, dot, underscore,
 *    hyphen and the separator; no empty, `.` or `..` segment, no query, no
 *    encoded character
 *  - the file name ends in `.pdf`
 */
export function parsePrivateSolutionObject(
  storageUrl: unknown,
  prefix: string
): PrivateSolutionParse {
  const reference = parsePrivateReference(storageUrl);
  if (!reference) return { ok: false, reason: 'not a private reference' };
  if (reference.bucket !== SOLUTIONS_BUCKET) {
    return { ok: false, reason: 'not the bucket of the model solutions' };
  }
  const { path } = reference;
  if (
    path.length > MAX_PATH_LENGTH ||
    !SAFE_PATH.test(path) ||
    path.split('/').some(part => part === '.' || part === '..')
  ) {
    return { ok: false, reason: 'the path is not allowed' };
  }
  if (!path.startsWith(prefix) || path.length === prefix.length) {
    return {
      ok: false,
      reason: 'the path is outside the folder of the target',
    };
  }
  if (!/\.pdf$/i.test(path)) {
    return { ok: false, reason: 'the file is no pdf' };
  }
  return { ok: true, object: { bucket: SOLUTIONS_BUCKET, path } };
}
