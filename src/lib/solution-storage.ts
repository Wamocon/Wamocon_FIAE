/**
 * The model solutions (PDF) of the KfBM lie in the PRIVATE bucket `content-solutions`. A public
 * url of a solution would let everyone who knows it read it, so the row of a solution stores a
 * reference, private://content-solutions/<path>, and no url.
 *
 * Only the trainer list of the use case documents turns the reference into a signed url that is
 * valid for a few minutes. It is made on the server with the secret key, for a row that is
 * trainer-only, in the bucket content-solutions, with a path of a strict alphabet. Everywhere
 * else the reference is no link: the trainee routes never list a trainer-only row, and the
 * server never fetches it (readableStorageUrl refuses everything but http urls of the project).
 *
 * A failure gives an empty url: the page shows no link, and no reference reaches the browser.
 */

import { createClient } from '@supabase/supabase-js';
import {
  SOLUTIONS_BUCKET,
  parsePrivateReference,
} from '@/lib/content-import/documents/storage';
import { getSupabaseSecretKey } from '@/lib/env';

/** How long a signed url of a solution works. */
export const SIGNED_URL_SECONDS = 600;

/** The part of the storage client that signing needs. Tests replace it. */
export interface SigningClient {
  storage: {
    from(bucket: string): {
      createSignedUrl(
        path: string,
        expiresIn: number
      ): Promise<{
        data: { signedUrl: string } | null;
        error: unknown;
      }>;
    };
  };
}

export interface SolutionStorageDeps {
  client?: () => SigningClient | null;
}

const SAFE_PATH = /^[A-Za-z0-9._-]+(?:\/[A-Za-z0-9._-]+)*$/;

function defaultClient(): SigningClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = getSupabaseSecretKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as SigningClient;
}

/** The path inside the private bucket of a reference, or null when it may not be signed. */
function signablePath(row: {
  storageUrl?: unknown;
  visibility?: unknown;
}): string | null {
  if (row.visibility !== 'TRAINER_ONLY') return null;
  const reference = parsePrivateReference(row.storageUrl);
  if (!reference || reference.bucket !== SOLUTIONS_BUCKET) return null;
  const { path } = reference;
  if (!SAFE_PATH.test(path) || path.split('/').some(part => part === '..')) {
    return null;
  }
  return path;
}

const isPrivateReference = (value: unknown) =>
  parsePrivateReference(value) !== null;

/**
 * The rows with the private references replaced by signed urls (or by an empty url when a row
 * may not be signed or signing fails). Rows with another url are returned as they are.
 */
export async function withSignedSolutionUrls<
  T extends { storageUrl?: unknown; visibility?: unknown },
>(rows: readonly T[], deps: SolutionStorageDeps = {}): Promise<T[]> {
  if (!rows.some(row => isPrivateReference(row.storageUrl))) return [...rows];
  let client: SigningClient | null | undefined;
  const out: T[] = [];
  for (const row of rows) {
    if (!isPrivateReference(row.storageUrl)) {
      out.push(row);
      continue;
    }
    const path = signablePath(row);
    let signed = '';
    if (path) {
      try {
        if (client === undefined) client = (deps.client ?? defaultClient)();
        const result = client
          ? await client.storage
              .from(SOLUTIONS_BUCKET)
              .createSignedUrl(path, SIGNED_URL_SECONDS)
          : null;
        signed = result?.data?.signedUrl ?? '';
        if (!signed) console.warn('A solution could not be signed.');
      } catch {
        console.warn('A solution could not be signed.');
      }
    }
    // the storage path of a private object is no business of the browser either
    out.push({
      ...row,
      storageUrl: signed,
      ...('storagePath' in row ? { storagePath: null } : {}),
    });
  }
  return out;
}
