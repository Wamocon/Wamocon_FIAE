/**
 * Reading a file of the bucket `content` on the server.
 *
 * The readers on the server (the PDF extraction of HAI, the logo of the
 * certificate) read the file with the secret key straight from the storage, not
 * over the public address. That works for a public and for a private bucket.
 *
 * Only a stored address that names an object of the bucket content of the own
 * project is read this way (parseContentReference). Without a secret key the
 * function answers `unavailable`, and the caller keeps the way it had before
 * (the checked public address, see readableStorageUrl in document-storage.ts).
 */

import { createClient } from '@supabase/supabase-js';
import { getSupabaseSecretKey } from '@/lib/env';
import {
  CONTENT_BUCKET,
  parseContentReference,
  type ParseContentOptions,
} from '@/lib/storage/contentPath';

/** The part of the storage client that reading needs. Tests replace it. */
export interface ContentReadingClient {
  storage: {
    from(bucket: string): {
      download(path: string): Promise<{
        data: { size?: number; arrayBuffer(): Promise<ArrayBuffer> } | null;
        error: unknown;
      }>;
    };
  };
}

export interface ContentReadDeps extends ParseContentOptions {
  client?: () => ContentReadingClient | null;
}

export type ContentRead =
  /** The bytes of the object. */
  | { status: 'ok'; buffer: Buffer }
  /** Not an object of the bucket content: the caller reads the address as before. */
  | { status: 'not-content' }
  /** An object of the bucket content, but no client (no secret key). */
  | { status: 'unavailable' }
  /** The storage refused, the object is missing or too large. */
  | { status: 'failed'; reason: string };

/**
 * The client with the secret key. The internal address of the storage is used
 * when there is one, the bytes never go to a browser.
 */
export function defaultReadingClient(): ContentReadingClient | null {
  const url =
    process.env.SUPABASE_URL_INTERNAL ||
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.SUPABASE_URL;
  const key = getSupabaseSecretKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ContentReadingClient;
}

/**
 * The bytes of the file that a stored address names, at most `maxBytes`. The
 * reason of a failure never repeats the address.
 */
export async function readContentObject(
  raw: unknown,
  maxBytes: number,
  deps: ContentReadDeps = {}
): Promise<ContentRead> {
  const ref = parseContentReference(raw, deps);
  if (ref.kind !== 'content') return { status: 'not-content' };

  let client: ContentReadingClient | null;
  try {
    client = (deps.client ?? defaultReadingClient)();
  } catch {
    return { status: 'unavailable' };
  }
  if (!client) return { status: 'unavailable' };

  try {
    const { data, error } = await client.storage
      .from(CONTENT_BUCKET)
      .download(ref.path);
    if (error || !data) {
      return {
        status: 'failed',
        reason: 'The storage did not return the file.',
      };
    }
    if (typeof data.size === 'number' && data.size > maxBytes) {
      return { status: 'failed', reason: 'The file is too large to read.' };
    }
    const buffer = Buffer.from(await data.arrayBuffer());
    if (buffer.length > maxBytes) {
      return { status: 'failed', reason: 'The file is too large to read.' };
    }
    return { status: 'ok', buffer };
  } catch {
    return { status: 'failed', reason: 'The storage could not be read.' };
  }
}
