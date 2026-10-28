// The body of the dry run and apply routes.
//
//   { replaceFiles?: string[],         ids of files whose DIFFERING rows are replaced (default: none,
//                                      only new rows and added questions are written)
//     publishOriginals?: string[],     ids of enabler text and whole scenario files whose original goes to the document bucket
//     confirm?: string }               apply only: the catalog code, typed by the person
//
// Strict: a field of another type is an error, an unknown field is ignored (the
// body is never merged into anything).

import { LIMITS } from '@/lib/content-upload/staging/config';
import {
  fail,
  ok,
  type ServiceResult,
} from '@/lib/content-upload/staging/result';
import { isUuid } from '@/lib/uuid';

/** Most originals one request can name. */
export const MAX_PUBLISH_ORIGINALS = 25;

/** Most files whose differing rows one request can replace: every file of a run. */
export const MAX_REPLACE_FILES = LIMITS.maxFilesPerRun;

export interface TransferBody {
  replaceFiles: string[];
  publishOriginals: string[];
  confirm?: string;
}

export function parseTransferBody(body: unknown): ServiceResult<TransferBody> {
  if (body === undefined || body === null) {
    return ok({ replaceFiles: [], publishOriginals: [] });
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'The request body must be an object', 'BODY_INVALID');
  }
  const input = body as Record<string, unknown>;
  let replaceFiles: string[] = [];
  if (input.replaceFiles !== undefined) {
    if (
      !Array.isArray(input.replaceFiles) ||
      input.replaceFiles.length > MAX_REPLACE_FILES ||
      !input.replaceFiles.every(isUuid)
    ) {
      return fail(
        400,
        `replaceFiles must be a list of at most ${MAX_REPLACE_FILES} file ids`,
        'BODY_INVALID'
      );
    }
    replaceFiles = [
      ...new Set((input.replaceFiles as string[]).map(id => id.toLowerCase())),
    ].sort();
  }
  let publishOriginals: string[] = [];
  if (input.publishOriginals !== undefined) {
    if (
      !Array.isArray(input.publishOriginals) ||
      input.publishOriginals.length > MAX_PUBLISH_ORIGINALS ||
      !input.publishOriginals.every(isUuid)
    ) {
      return fail(
        400,
        `publishOriginals must be a list of at most ${MAX_PUBLISH_ORIGINALS} file ids`,
        'BODY_INVALID'
      );
    }
    publishOriginals = [
      ...new Set(
        (input.publishOriginals as string[]).map(id => id.toLowerCase())
      ),
    ];
  }
  if (input.confirm !== undefined && typeof input.confirm !== 'string') {
    return fail(400, 'confirm must be a text', 'BODY_INVALID');
  }
  return ok({
    replaceFiles,
    publishOriginals,
    ...(typeof input.confirm === 'string' ? { confirm: input.confirm } : {}),
  });
}
