/**
 * The addresses of the files in the bucket `content`, as the browser gets them.
 *
 * The bucket is public today and becomes private at the go-live. The rows keep
 * their stored address (public url, private reference or bare path, see
 * contentPath.ts). Whatever leaves the server for a browser goes through this
 * module: the address of a file of the bucket content is replaced by a
 * short-lived SIGNED url. A signed url works for a public and for a private
 * bucket alike, so switching the bucket changes nothing for the people.
 *
 * What is signed: only objects of the bucket `content` of the own project, with
 * a path that passed the strict check of parseContentReference. Nothing is
 * signed from a path that arrives in a request: the callers hand in the value
 * of a database row that they have already selected for the person.
 *
 * What is not touched: an address that is no object of the bucket content (a
 * link to a video on another host, an empty value, the references of the private
 * bucket content-solutions, see solution-storage.ts).
 *
 * When signing is not possible (no secret key configured, the storage is down,
 * the object does not exist) a stored http(s) address is returned as it is, so
 * a public bucket keeps working, and a private reference gives an empty value.
 * A private reference never reaches a browser.
 */

import { createClient } from '@supabase/supabase-js';
import { getSupabaseSecretKey } from '@/lib/env';
import {
  CONTENT_BUCKET,
  isPrivateReference,
  parseContentReference,
  type ParseContentOptions,
} from '@/lib/storage/contentPath';

/** Shortest and longest lifetime of a signed url, in seconds (15 to 60 minutes). */
export const MIN_SIGNED_SECONDS = 900;
export const MAX_SIGNED_SECONDS = 3600;

/** Lifetime of the links in a list (the page may stay open for a while). */
export const LIST_SIGNED_SECONDS = 3600;

/** Lifetime of a link that is opened at once (the route of one document). */
export const ON_DEMAND_SIGNED_SECONDS = 900;

/** The part of the storage client that signing needs. Tests replace it. */
export interface ContentSigningClient {
  storage: {
    from(bucket: string): {
      createSignedUrls(
        paths: string[],
        expiresIn: number
      ): Promise<{
        data: Array<{
          path: string | null;
          signedUrl: string | null;
          error: unknown;
        }> | null;
        error: unknown;
      }>;
    };
  };
}

export interface ContentUrlDeps extends ParseContentOptions {
  client?: () => ContentSigningClient | null;
  /** Lifetime in seconds, kept between 15 and 60 minutes. Default: for a list. */
  expiresIn?: number;
  /**
   * A private reference of another bucket (the model solutions) becomes an
   * empty value instead of being passed on. For the routes that serve trainees,
   * which have no second pass like the trainer lists (solution-storage.ts).
   */
  hideOtherPrivate?: boolean;
}

export function clampSignedSeconds(seconds: number | undefined): number {
  const value = Number.isFinite(seconds)
    ? Math.trunc(seconds as number)
    : LIST_SIGNED_SECONDS;
  return Math.min(MAX_SIGNED_SECONDS, Math.max(MIN_SIGNED_SECONDS, value));
}

/**
 * The client with the secret key. The url is the public one of the project,
 * because the signed url carries it into the browser. Null without both values.
 */
export function defaultSigningClient(): ContentSigningClient | null {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL;
  const key = getSupabaseSecretKey();
  if (!url || !key) return null;
  return createClient(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  }) as unknown as ContentSigningClient;
}

/**
 * Signs the paths (one request for all of them). The result maps a path to its
 * signed url, a path that could not be signed is missing.
 */
async function signPaths(
  paths: readonly string[],
  deps: ContentUrlDeps
): Promise<Map<string, string>> {
  const signed = new Map<string, string>();
  if (paths.length === 0) return signed;
  try {
    const client = (deps.client ?? defaultSigningClient)();
    if (!client) return signed;
    const { data, error } = await client.storage
      .from(CONTENT_BUCKET)
      .createSignedUrls([...paths], clampSignedSeconds(deps.expiresIn));
    if (error || !data) {
      console.warn('Files of the content bucket could not be signed.');
      return signed;
    }
    for (const entry of data) {
      if (entry && !entry.error && entry.path && entry.signedUrl) {
        signed.set(entry.path, entry.signedUrl);
      }
    }
  } catch {
    console.warn('Files of the content bucket could not be signed.');
  }
  return signed;
}

/** What a browser gets when `raw` cannot be signed. */
function unsignedFallback(raw: unknown): string {
  if (typeof raw !== 'string') return '';
  // A private reference is no link. An invalid address of the own bucket stays
  // as stored (it works while the bucket is public).
  if (isPrivateReference(raw)) return '';
  return raw;
}

/**
 * The browser address of each value, in the order of `values`. A value that is
 * no object of the bucket content is returned as it is (see the top of the file).
 */
export async function signContentValues(
  values: readonly unknown[],
  deps: ContentUrlDeps = {}
): Promise<unknown[]> {
  const parsed = values.map(value => parseContentReference(value, deps));
  const paths = [
    ...new Set(
      parsed.flatMap(ref => (ref.kind === 'content' ? [ref.path] : []))
    ),
  ];
  const signed = await signPaths(paths, deps);

  return values.map((value, index) => {
    const ref = parsed[index];
    if (ref.kind === 'content') {
      return signed.get(ref.path) ?? unsignedFallback(value);
    }
    // Names the bucket content, but the path is not safe: never signed. It stays
    // as stored (works while the bucket is public), a reference becomes empty.
    if (ref.kind === 'invalid') return unsignedFallback(value);
    if (deps.hideOtherPrivate && isPrivateReference(value)) return '';
    return value;
  });
}

/** The browser address of one stored address, see signContentValues. */
export async function signContentUrl(
  raw: unknown,
  deps: ContentUrlDeps = {}
): Promise<string | null> {
  const [value] = await signContentValues([raw], deps);
  return typeof value === 'string' ? value : null;
}

/**
 * The rows with the addresses in `fields` replaced by their browser address.
 * Everything else of a row stays. Rows without such a field are returned as
 * they are, and no client is created when no value needs signing.
 */
export async function withSignedContentFields<T extends object>(
  rows: readonly T[],
  fields: readonly string[],
  deps: ContentUrlDeps = {}
): Promise<T[]> {
  const cells: Array<{ row: number; field: string; value: unknown }> = [];
  rows.forEach((row, rowIndex) => {
    for (const field of fields) {
      const value = (row as Record<string, unknown>)[field];
      if (typeof value === 'string' && value !== '') {
        cells.push({ row: rowIndex, field, value });
      }
    }
  });
  if (cells.length === 0) return [...rows];

  const replaced = await signContentValues(
    cells.map(cell => cell.value),
    deps
  );
  const out = rows.map(row => ({ ...row }) as Record<string, unknown>);
  cells.forEach((cell, index) => {
    out[cell.row][cell.field] = replaced[index];
  });
  return out as T[];
}

/** The rows of a document list with `storageUrl` signed. */
export function withSignedContentUrls<T extends { storageUrl?: unknown }>(
  rows: readonly T[],
  deps: ContentUrlDeps = {}
): Promise<T[]> {
  return withSignedContentFields(rows, ['storageUrl'], deps);
}
