/**
 * The bytes of a learning document for the viewer of a trainee.
 *
 * A trainee does not get the address of a file (the bucket content is public
 * until the go-live, see docs/dokumentschutz.md). The viewer asks one of the
 * routes under /api/trainee/.../content, and the route answers with the bytes
 * of the file, read on the server with the secret key (contentRead.ts). This
 * module is the part that turns a stored address (the value of a row that the
 * route has already authorized) into that answer.
 *
 * Only an object of the bucket `content` of the own project is read. A link to
 * another host, another bucket and a model solution of the private bucket are
 * never fetched on behalf of a trainee, and a path never comes from a request.
 */

import { NextResponse } from 'next/server';
import { readableStorageUrl } from '@/lib/document-storage';
import { parseContentReference } from '@/lib/storage/contentPath';
import { readContentObject } from '@/lib/storage/contentRead';

/** A file above this is not served (the same limit as the PDF reader of HAI). */
export const MAX_TRAINEE_FILE_BYTES = 50 * 1024 * 1024;

const FETCH_TIMEOUT_MS = 30_000;
const CHUNK_BYTES = 64 * 1024;

const NOT_FOUND = { error: 'Not found' };

export const notFoundResponse = () =>
  NextResponse.json(NOT_FOUND, { status: 404 });

type FileBytes =
  | { ok: true; buffer: Buffer }
  | { ok: false; status: 404 | 413 | 502 };

/**
 * The bytes of the file that `storedAddress` names. Reads straight from the
 * storage with the secret key. Without a key the checked public address of the
 * own project is fetched (while the bucket is public), never a redirect.
 */
async function readBytes(storedAddress: unknown): Promise<FileBytes> {
  // The bucket content only: anything else is no file of a trainee
  if (parseContentReference(storedAddress).kind !== 'content') {
    return { ok: false, status: 404 };
  }

  const direct = await readContentObject(storedAddress, MAX_TRAINEE_FILE_BYTES);
  if (direct.status === 'ok') return { ok: true, buffer: direct.buffer };
  if (direct.status === 'failed') return { ok: false, status: 502 };
  if (direct.status === 'not-content') return { ok: false, status: 404 };

  // unavailable: no secret key on this deployment
  const readable = readableStorageUrl(storedAddress);
  if (!readable.ok) return { ok: false, status: 404 };
  try {
    const response = await fetch(readable.url, {
      cache: 'no-store',
      redirect: 'error',
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) return { ok: false, status: 502 };
    const declared = Number(response.headers?.get?.('content-length'));
    if (Number.isFinite(declared) && declared > MAX_TRAINEE_FILE_BYTES) {
      return { ok: false, status: 413 };
    }
    const buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > MAX_TRAINEE_FILE_BYTES) {
      return { ok: false, status: 413 };
    }
    return { ok: true, buffer };
  } catch {
    return { ok: false, status: 502 };
  }
}

/** Whether the bytes are a PDF (the header may follow a few bytes of noise). */
export function looksLikePdf(buffer: Buffer): boolean {
  return buffer.subarray(0, 1024).includes('%PDF-');
}

/**
 * The headers of the answer: shown in the page (inline) and without a file
 * name, so the browser has nothing to offer as a name when somebody saves it.
 * `no-store` keeps the bytes out of the shared and the disk cache.
 */
export function inlinePdfHeaders(length: number): Record<string, string> {
  return {
    'Content-Type': 'application/pdf',
    'Content-Disposition': 'inline',
    'Cache-Control': 'private, no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Length': String(length),
  };
}

/** The body as a stream, so that a large file is not bound by the size limit of a buffered answer. */
function streamOf(buffer: Buffer): ReadableStream<Uint8Array> {
  let offset = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= buffer.length) {
        controller.close();
        return;
      }
      const end = Math.min(offset + CHUNK_BYTES, buffer.length);
      controller.enqueue(new Uint8Array(buffer.subarray(offset, end)));
      offset = end;
    },
  });
}

/**
 * The answer of a content route: the PDF behind `storedAddress`, or a 404
 * that tells nothing (a missing file, a link to another host and a file that
 * is no PDF look the same), a 413 for a file that is too large, a 502 when the
 * storage did not answer. The stored address is never part of an answer.
 */
export async function traineePdfResponse(
  storedAddress: unknown
): Promise<Response> {
  const file = await readBytes(storedAddress);
  if (!file.ok) {
    if (file.status === 404) return notFoundResponse();
    return NextResponse.json(
      {
        error:
          file.status === 413
            ? 'The file is too large'
            : 'The file storage did not answer',
      },
      { status: file.status, headers: { 'Cache-Control': 'private, no-store' } }
    );
  }
  if (!looksLikePdf(file.buffer)) return notFoundResponse();
  return new Response(streamOf(file.buffer), {
    status: 200,
    headers: inlinePdfHeaders(file.buffer.length),
  });
}
