// The body of the dry run and apply routes.
//
//   { updateExisting?: boolean,        update rows that exist and differ (per apply, off by default)
//     publishOriginals?: string[],     ids of enabler text files whose original goes to the document bucket
//     confirm?: string }               apply only: the catalog code, typed by the person
//
// Strict: a field of another type is an error, an unknown field is ignored (the
// body is never merged into anything).

import {
  fail,
  ok,
  type ServiceResult,
} from '@/lib/content-upload/staging/result';
import { isUuid } from '@/lib/uuid';

/** Most originals one request can name. */
export const MAX_PUBLISH_ORIGINALS = 25;

export interface TransferBody {
  updateExisting: boolean;
  publishOriginals: string[];
  confirm?: string;
}

export function parseTransferBody(body: unknown): ServiceResult<TransferBody> {
  if (body === undefined || body === null) {
    return ok({ updateExisting: false, publishOriginals: [] });
  }
  if (typeof body !== 'object' || Array.isArray(body)) {
    return fail(400, 'The request body must be an object', 'BODY_INVALID');
  }
  const input = body as Record<string, unknown>;
  if (
    input.updateExisting !== undefined &&
    typeof input.updateExisting !== 'boolean'
  ) {
    return fail(400, 'updateExisting must be true or false', 'BODY_INVALID');
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
    updateExisting: input.updateExisting === true,
    publishOriginals,
    ...(typeof input.confirm === 'string' ? { confirm: input.confirm } : {}),
  });
}
