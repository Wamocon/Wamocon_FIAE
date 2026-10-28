// The storage side of the PDF import: bucket names, the path of a file, the url that a
// row stores, and the adapter that puts a file into the storage.
//
// Two buckets:
//  - `content` (public, the bucket of FIAE): the teaching text, the scenario and the task.
//    The row stores the public url of the file, like every FIAE row, so the readers of the
//    trainee pages open it as they do for FIAE.
//  - `content-solutions` (PRIVATE): the model solutions. A public url would let anyone who
//    knows it read a solution. The row stores a reference of the form
//    private://content-solutions/<path>, never an http url. Only the trainer route of the
//    use case documents turns it into a short-lived signed url (src/lib/solution-storage.ts).
//
// The paths carry their own prefix: preview/kfbm/ for the Preview and kfbm/ for a local
// storage. The buckets are shared between Preview and Production, so nothing of this import
// can touch a path of Production.
//
// This module has no import of the app on purpose, the scripts under scripts/import load it
// directly with Node's type stripping.

import type { DocumentTarget, PdfKind } from './types';

export const CONTENT_BUCKET = 'content';
export const SOLUTIONS_BUCKET = 'content-solutions';
export const PRIVATE_SCHEME = 'private://';

/** What the owner has to set on the private bucket (a bucket is created by hand). */
export const SOLUTIONS_BUCKET_SETTINGS = {
  name: SOLUTIONS_BUCKET,
  public: false,
  fileSizeLimit: 25 * 1024 * 1024,
  allowedMimeTypes: ['application/pdf'],
} as const;

export function storagePrefix(target: DocumentTarget): string {
  return target === 'preview' ? 'preview/kfbm/' : 'kfbm/';
}

const FOLDERS: Record<PdfKind, string> = {
  enabler: 'enabler',
  scenario: 'szenario',
  usecase_task: 'aufgabe',
  usecase_solution: 'musterloesung',
};

export const bucketOf = (kind: PdfKind): string =>
  kind === 'usecase_solution' ? SOLUTIONS_BUCKET : CONTENT_BUCKET;

const FOLD: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ß: 'ss',
};

/** A file name that the storage takes: ASCII letters, digits, dot, underscore, hyphen. */
export function safeFileName(name: string): string {
  const folded = name
    .normalize('NFC')
    .replace(/[äöüÄÖÜß]/g, ch => FOLD[ch])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  const clean = folded
    .replace(/[^A-Za-z0-9._-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[._-]+/, '')
    .replace(/_+(\.[A-Za-z0-9]+)$/, '$1');
  return clean || 'document.pdf';
}

/** Path of the file in its bucket. */
export function storagePathFor(
  target: DocumentTarget,
  item: { enablerCode: string; kind: PdfKind; rel: string }
): string {
  const base = item.rel.split(/[\\/]+/).pop() as string;
  return `${storagePrefix(target)}${item.enablerCode}/${FOLDERS[item.kind]}/${safeFileName(base)}`;
}

/** The public url of an object, as the storage gives it out. */
export function publicObjectUrl(
  supabaseUrl: string,
  bucket: string,
  path: string
): string {
  return `${new URL(supabaseUrl).origin}/storage/v1/object/public/${bucket}/${path}`;
}

/** The reference that a row of a private object stores. */
export const privateReference = (bucket: string, path: string): string =>
  `${PRIVATE_SCHEME}${bucket}/${path}`;

/** Bucket and path of a private reference, or null when `value` is none. */
export function parsePrivateReference(
  value: unknown
): { bucket: string; path: string } | null {
  if (typeof value !== 'string' || !value.startsWith(PRIVATE_SCHEME)) {
    return null;
  }
  const rest = value.slice(PRIVATE_SCHEME.length);
  const slash = rest.indexOf('/');
  if (slash <= 0 || slash === rest.length - 1) return null;
  return { bucket: rest.slice(0, slash), path: rest.slice(slash + 1) };
}

/** The storage as far as the import uses it. Tests replace it with a fake. */
export interface StorageAdapter {
  exists(bucket: string, path: string): Promise<boolean>;
  /** Stores an object. With upsert false an existing path is an error. */
  put(
    bucket: string,
    path: string,
    bytes: Uint8Array,
    contentType: string,
    options: { upsert: boolean }
  ): Promise<void>;
  /** Removes objects. A path that does not exist is not an error. */
  remove(bucket: string, paths: readonly string[]): Promise<void>;
}

export class StorageError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'StorageError';
    this.code = code;
  }
}

const LOOPBACK = new Set(['localhost', '127.0.0.1', '[::1]']);

/**
 * Problems with the storage address for a target (empty = fine). A local database gets a
 * local storage only, the Preview gets a hosted https project. Without this a local run
 * with the address of the hosted project in the environment would write into the shared
 * buckets.
 */
export function checkStorageTarget(
  target: DocumentTarget,
  supabaseUrl: string | null | undefined
): string[] {
  if (!supabaseUrl) {
    return ['NEXT_PUBLIC_SUPABASE_URL is not set, files cannot be stored.'];
  }
  let url: URL;
  try {
    url = new URL(supabaseUrl);
  } catch {
    return ['NEXT_PUBLIC_SUPABASE_URL is not an address.'];
  }
  if (url.username || url.password) {
    return ['The storage address must not carry credentials.'];
  }
  const loopback = LOOPBACK.has(url.hostname);
  if (target === 'local') {
    return loopback && url.protocol === 'http:'
      ? []
      : ['The target local needs a storage on this machine (http, localhost).'];
  }
  return !loopback && url.protocol === 'https:'
    ? []
    : ['The target preview needs the https address of the hosted project.'];
}

export interface SupabaseStorageDeps {
  url: string;
  /** The secret key of the project, only from the environment of the script. */
  key: string;
  fetchImpl?: typeof fetch;
}

const encodePath = (path: string) =>
  path.split('/').map(encodeURIComponent).join('/');

/**
 * The adapter for the storage API of Supabase over fetch. It never follows a redirect, never
 * logs and never puts the key or the address into an error.
 */
export function createSupabaseStorage(
  deps: SupabaseStorageDeps
): StorageAdapter {
  const origin = new URL(deps.url).origin;
  const doFetch = deps.fetchImpl ?? fetch;
  const headers = (extra: Record<string, string> = {}) => ({
    Authorization: `Bearer ${deps.key}`,
    apikey: deps.key,
    ...extra,
  });
  const call = (url: string, init: RequestInit) =>
    doFetch(url, { ...init, redirect: 'error' });
  const bad = (what: string, status: number) =>
    new StorageError(
      `HTTP_${status}`,
      `The storage refused ${what} (${status}).`
    );

  return {
    async exists(bucket, path) {
      const response = await call(
        `${origin}/storage/v1/object/info/${bucket}/${encodePath(path)}`,
        { method: 'GET', headers: headers() }
      );
      if (response.ok) return true;
      if (response.status === 404 || response.status === 400) return false;
      throw bad('the check of an object', response.status);
    },
    async put(bucket, path, bytes, contentType, options) {
      const response = await call(
        `${origin}/storage/v1/object/${bucket}/${encodePath(path)}`,
        {
          method: 'POST',
          headers: headers({
            'Content-Type': contentType,
            'x-upsert': options.upsert ? 'true' : 'false',
            'cache-control': 'max-age=3600',
          }),
          body: bytes as unknown as BodyInit,
        }
      );
      if (!response.ok) throw bad('an object', response.status);
    },
    async remove(bucket, paths) {
      if (paths.length === 0) return;
      const response = await call(`${origin}/storage/v1/object/${bucket}`, {
        method: 'DELETE',
        headers: headers({ 'Content-Type': 'application/json' }),
        body: JSON.stringify({ prefixes: paths }),
      });
      if (!response.ok) throw bad('the removal of objects', response.status);
    },
  };
}
