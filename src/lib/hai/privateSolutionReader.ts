/**
 * Reader of the private model solutions (PDF) for the HAI index.
 *
 * The model solutions of the KfBM lie in the PRIVATE bucket `content-solutions`.
 * A row of content_documents holds only a reference (`private://content-solutions/<path>`),
 * which is no address. This module turns ONE such reference into the bytes of the
 * file, with the secret key of the project, and nothing else:
 *
 *  - the object is checked again (bucket, folder of the target, strict path
 *    alphabet, .pdf), whatever the caller checked before
 *  - the key goes only to the https address of the own project (or the local
 *    storage of a local run), never to an address that comes from a row
 *  - a redirect is never followed, the request has a time limit, the size is
 *    limited (while reading, not only by the declared length)
 *  - the bytes must start like a PDF
 *  - an error never repeats the address, the path or the key
 *
 * It makes no model call and writes nothing. It is used by the reindex script
 * only (real run, switch HAI_TRAINER_SOLUTIONS on); the app itself never reads
 * the private bucket through this module.
 *
 * @module lib/hai/privateSolutionReader
 */

import {
  SOLUTIONS_BUCKET,
  SOLUTIONS_BUCKET_SETTINGS,
  checkConfirmStorageHost,
  checkStorageTarget,
} from '../content-import/documents/storage';
import { extractTextFromPdfBuffer, looksLikePdf } from './pdfBufferText';
import {
  parsePrivateSolutionObject,
  type PrivateSolutionObject,
} from './trainerSolutions';

/** The bucket allows 25 MB per file (SOLUTIONS_BUCKET_SETTINGS), so does the reader. */
export const SOLUTION_PDF_MAX_BYTES = SOLUTIONS_BUCKET_SETTINGS.fileSizeLimit;

/** A text above this is refused, not cut: one file must not become a cost trap. */
export const SOLUTION_TEXT_MAX_CHARS = 400_000;

const FETCH_TIMEOUT_MS = 30_000;
const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * The origin the key may be sent to: the https address of the hosted project
 * (no credentials, no port, not a loopback name), or, for a local run only, the
 * http address of the local storage. Everything else gives null.
 */
export function solutionStorageOrigin(
  supabaseUrl: string | null | undefined,
  allowLoopback = false
): string | null {
  if (!supabaseUrl) return null;
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    return null;
  }
  if (url.username || url.password) return null;
  const loopback = LOOPBACK.has(url.hostname);
  if (url.protocol === 'https:' && url.port === '' && !loopback) {
    return url.origin;
  }
  if (allowLoopback && url.protocol === 'http:' && loopback) return url.origin;
  return null;
}

export interface SolutionReaderConfig {
  /** NEXT_PUBLIC_SUPABASE_URL of the target. */
  supabaseUrl: string | null | undefined;
  /** Secret key of the project, only from the environment of the script. */
  secretKey: string | null | undefined;
  /** Folder of the target in the bucket (privateSolutionPrefix). */
  prefix: string;
  /** A local run reads from the local storage. */
  allowLoopback?: boolean;
  /** Tests replace the network. */
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  maxBytes?: number;
}

export type SolutionRead =
  | { ok: true; buffer: Buffer }
  | { ok: false; error: string };

const encodePath = (path: string) =>
  path.split('/').map(encodeURIComponent).join('/');

const fail = (error: string): { ok: false; error: string } => ({
  ok: false,
  error,
});

/** Reads a body up to `max` bytes, null when it is larger. */
async function readCapped(
  response: Response,
  max: number
): Promise<Buffer | null> {
  const reader = response.body?.getReader?.();
  if (!reader) {
    const bytes = Buffer.from(await response.arrayBuffer());
    return bytes.length > max ? null : bytes;
  }
  const parts: Uint8Array[] = [];
  let total = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.length;
    if (total > max) {
      await reader.cancel().catch(() => undefined);
      return null;
    }
    parts.push(value);
  }
  return Buffer.concat(parts.map(part => Buffer.from(part)));
}

/**
 * The bytes of one model solution. The object comes from planDocumentIndexing
 * and is checked again here.
 */
export async function readPrivateSolution(
  object: PrivateSolutionObject,
  config: SolutionReaderConfig
): Promise<SolutionRead> {
  const checked = parsePrivateSolutionObject(
    `private://${object.bucket}/${object.path}`,
    config.prefix
  );
  if (!checked.ok) return fail('The reference is not allowed.');

  const origin = solutionStorageOrigin(
    config.supabaseUrl,
    config.allowLoopback
  );
  if (!origin) return fail('The storage address is not allowed.');
  if (!config.secretKey) return fail('The secret key is missing.');

  const maxBytes = config.maxBytes ?? SOLUTION_PDF_MAX_BYTES;
  const doFetch = config.fetchImpl ?? fetch;
  const url = `${origin}/storage/v1/object/authenticated/${SOLUTIONS_BUCKET}/${encodePath(checked.object.path)}`;

  let response: Response;
  try {
    response = await doFetch(url, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        apikey: config.secretKey,
      },
      // a redirect would leave the checked address
      redirect: 'error',
      cache: 'no-store',
      signal: AbortSignal.timeout(config.timeoutMs ?? FETCH_TIMEOUT_MS),
    });
  } catch {
    return fail('The storage could not be reached.');
  }

  if (!response.ok || (response.status >= 300 && response.status < 400)) {
    return fail(`The storage refused the file (${response.status}).`);
  }
  const declared = Number(response.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > maxBytes) {
    return fail('The file is too large.');
  }

  let buffer: Buffer | null;
  try {
    buffer = await readCapped(response, maxBytes);
  } catch {
    return fail('The file could not be read.');
  }
  if (!buffer) return fail('The file is too large.');
  if (!looksLikePdf(buffer)) return fail('The file is no PDF.');
  return { ok: true, buffer };
}

export type SolutionTextRead =
  | { ok: true; text: string; pageCount: number }
  | { ok: false; error: string };

/** The cleaned text and the pages of one model solution. */
export async function readPrivateSolutionText(
  object: PrivateSolutionObject,
  config: SolutionReaderConfig
): Promise<SolutionTextRead> {
  const file = await readPrivateSolution(object, config);
  if (!file.ok) return file;
  const extracted = await extractTextFromPdfBuffer(file.buffer);
  if (!extracted.ok) return extracted;
  if (extracted.text.length > SOLUTION_TEXT_MAX_CHARS) {
    return fail('The text is too long.');
  }
  return extracted;
}

export interface SolutionStorageInput {
  target: 'preview' | 'production' | 'local';
  supabaseUrl: string | null | undefined;
  secretKey: string | null | undefined;
  /** Value of --confirm-storage-host. */
  confirmedHost: string | null | undefined;
}

/**
 * Reasons why a real run may not read the private bucket (empty = it may). The
 * key is sent to the storage address, and Preview and Production share one
 * project, so the person names the host that is meant and the run compares it.
 * A problem never repeats the key.
 */
export function solutionStorageProblems(input: SolutionStorageInput): string[] {
  const problems = [
    ...checkStorageTarget(
      input.target === 'local' ? 'local' : 'preview',
      input.supabaseUrl
    ),
  ];
  if (!solutionStorageOrigin(input.supabaseUrl, input.target === 'local')) {
    problems.push('The storage address is not allowed for this target.');
  }
  if (!input.secretKey) {
    problems.push(
      'The secret key of the project is missing (SUPABASE_SECRET_KEY).'
    );
  }
  problems.push(
    ...checkConfirmStorageHost(input.confirmedHost, input.supabaseUrl)
  );
  return [...new Set(problems)];
}
