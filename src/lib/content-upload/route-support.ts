// Helpers of the routes under src/app/api/trainer/content-upload.
//
// Every handler of the upload starts the same way, in this order:
//
//   const session = await requireCurriculumEditor(request);   401 / 403
//   if (isErrorResponse(session)) return session;
//   const off = contentUploadDisabledResponse();               404 in Production
//   if (off) return off;
//
// Only then does it read a body, look at a path id or touch a database (a test
// reads the source of every handler and checks this order).

import { NextResponse } from 'next/server';
import { UploadStorageError } from '@/lib/content-upload/storage';
import type { ServiceResult } from '@/lib/content-upload/result';

/** The answer of a service result: its data, or the failure with its status. */
export function respond<T>(
  result: ServiceResult<T>,
  successStatus = 200
): NextResponse {
  if (result.ok)
    return NextResponse.json(result.data, { status: successStatus });
  return NextResponse.json(
    { error: result.error, ...(result.code ? { code: result.code } : {}) },
    {
      status: result.status,
      ...(result.retryAfterSec !== undefined
        ? { headers: { 'Retry-After': String(result.retryAfterSec) } }
        : {}),
    }
  );
}

/** The JSON body of a request, or the 400 for a body that is none. */
export async function readJsonBody(request: {
  json(): Promise<unknown>;
}): Promise<
  { ok: true; body: unknown } | { ok: false; response: NextResponse }
> {
  try {
    return { ok: true, body: await request.json() };
  } catch {
    return {
      ok: false,
      response: NextResponse.json(
        { error: 'The request body is not valid JSON', code: 'BODY_INVALID' },
        { status: 400 }
      ),
    };
  }
}

/** Name or code of an error for the log. Never its message: it may hold a query, a path or a hash. */
export function errorSummary(error: unknown): string {
  if (error instanceof UploadStorageError)
    return `UploadStorageError:${error.code}`;
  if (error instanceof Error) {
    const code =
      (error as { code?: unknown }).code ??
      (error as { cause?: { code?: unknown } }).cause?.code;
    return typeof code === 'string' ? `${error.name}:${code}` : error.name;
  }
  return 'unknown';
}

/** The answer for an error nobody planned for: no detail, only the log has a name. */
export function uploadErrorResponse(error: unknown): NextResponse {
  console.error('[content-upload] route failed', errorSummary(error));
  if (error instanceof UploadStorageError && error.code === 'NOT_CONFIGURED') {
    return NextResponse.json(
      {
        error: 'The file storage is not available',
        code: 'STORAGE_UNAVAILABLE',
      },
      { status: 503 }
    );
  }
  return NextResponse.json({ error: 'Internal Server Error' }, { status: 500 });
}
