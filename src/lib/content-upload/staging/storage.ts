// The staging bucket `content-upload` (private, 25 MB, PDF and docx, no policy
// for the API roles; created by the owner, this code never creates a bucket).
//
// Only the server talks to it, with the secret key of the project. The browser
// gets one signed upload url per file and nothing else. The rules (concept 4.3,
// 4.4, 9.1 T5, T6, T16):
//
//  - the server picks every path (src/lib/content-upload/paths.ts) and this
//    module checks the exact form again before EVERY access (guardUploadStorage),
//    so a path from a database row or from a bug can still not leave the one
//    shape of its schema
//  - signed upload urls are created WITHOUT `upsert: true`: an object that exists
//    is never overwritten, the creation fails instead (OBJECT_EXISTS)
//  - the server reads objects through a short lived signed url of its own and
//    only fetches the origin of its own project (readableStorageUrl), without
//    following redirects, and never more bytes than it asked for: the first
//    bytes for the type check, the whole file only up to a given limit
//  - nothing is listed or deleted outside the one folder form of the schema

import { createClient } from '@supabase/supabase-js';
import { DB_SCHEMA, type DbSchema } from '@/lib/db-schema';
import { getSupabaseSecretKey } from '@/lib/env';
import { readableStorageUrl } from '@/lib/document-storage';
import { UPLOAD_BUCKET } from '@/lib/content-upload/staging/config';
import { parseUploadStoragePath } from '@/lib/content-upload/staging/paths';

export type StorageErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_PATH'
  | 'TOO_LARGE'
  | 'READ_FAILED'
  | 'STORAGE_ERROR';

export class UploadStorageError extends Error {
  readonly code: StorageErrorCode;
  constructor(code: StorageErrorCode, message: string) {
    super(message);
    this.name = 'UploadStorageError';
    this.code = code;
  }
}

export type SignedUploadOutcome =
  | { ok: true; path: string; token: string; signedUrl: string }
  | { ok: false; path: string; code: 'OBJECT_EXISTS' | 'ERROR' };

export interface ProbeResult {
  /** Size of the whole object in bytes. */
  size: number;
  /** The first bytes (at most as many as asked for). */
  head: Uint8Array;
}

export interface StorageObject {
  path: string;
  size: number | null;
  createdAt: Date | null;
}

export interface UploadStorage {
  /** A signed upload url for one path. Never overwrites an object. */
  createSignedUploadUrl(path: string): Promise<SignedUploadOutcome>;
  /** Size and the first `headBytes` bytes, or null if there is no such object. */
  probe(path: string, headBytes: number): Promise<ProbeResult | null>;
  /** The whole object, at most `maxBytes` (TOO_LARGE above), or null if it does not exist. */
  download(path: string, maxBytes: number): Promise<Uint8Array | null>;
  /** Removes objects. A path that does not exist is not an error. */
  remove(paths: readonly string[]): Promise<void>;
  /** All objects of the staging folders of this schema (at most `maxObjects`). */
  list(options?: { maxObjects?: number }): Promise<StorageObject[]>;
}

// ---------------------------------------------------------------------------
// The guard: the exact path form before every access
// ---------------------------------------------------------------------------

export function guardUploadStorage(
  inner: UploadStorage,
  schema: DbSchema = DB_SCHEMA
): UploadStorage {
  const check = (path: string) => {
    if (parseUploadStoragePath(path, schema) === null) {
      throw new UploadStorageError(
        'INVALID_PATH',
        'The storage path is not one of the staging bucket.'
      );
    }
  };
  return {
    createSignedUploadUrl(path) {
      check(path);
      return inner.createSignedUploadUrl(path);
    },
    probe(path, headBytes) {
      check(path);
      return inner.probe(path, headBytes);
    },
    download(path, maxBytes) {
      check(path);
      return inner.download(path, maxBytes);
    },
    remove(paths) {
      paths.forEach(check);
      return inner.remove(paths);
    },
    list(options) {
      return inner.list(options);
    },
  };
}

// ---------------------------------------------------------------------------
// Supabase
// ---------------------------------------------------------------------------

export interface SupabaseStorageDeps {
  supabaseUrl?: string;
  secretKey?: string;
  schema?: DbSchema;
  fetchImpl?: typeof fetch;
  createClientImpl?: typeof createClient;
}

/** Lifetime of the url the server reads an object with. */
const READ_URL_SECONDS = 60;
const READ_TIMEOUT_MS = 20_000;
const LIST_PAGE = 100;

const NOT_FOUND = /not.?found|does not exist|no such/i;
const ALREADY_EXISTS = /already exists|duplicate/i;

/** The bytes of `body` up to `limit`; `overflow` says there was more. */
async function readLimited(
  response: Response,
  limit: number
): Promise<{ bytes: Uint8Array; overflow: boolean }> {
  const reader = response.body?.getReader();
  if (!reader) {
    const all = new Uint8Array(await response.arrayBuffer());
    return all.length > limit
      ? { bytes: all.slice(0, limit), overflow: true }
      : { bytes: all, overflow: false };
  }
  const parts: Uint8Array[] = [];
  let total = 0;
  let overflow = false;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (total + value.length > limit) {
      parts.push(value.slice(0, limit - total));
      total = limit;
      overflow = true;
      break;
    }
    parts.push(value);
    total += value.length;
  }
  if (overflow) await reader.cancel().catch(() => undefined);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }
  return { bytes, overflow };
}

export class SupabaseUploadStorage implements UploadStorage {
  private readonly url: string;
  private readonly schema: DbSchema;
  private readonly client: ReturnType<typeof createClient>;
  private readonly fetchImpl: typeof fetch;

  constructor(deps: SupabaseStorageDeps = {}) {
    const url =
      deps.supabaseUrl ??
      (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
    const key = deps.secretKey ?? getSupabaseSecretKey();
    if (!url || !key) {
      throw new UploadStorageError(
        'NOT_CONFIGURED',
        'The storage is not configured.'
      );
    }
    this.url = url;
    this.schema = deps.schema ?? DB_SCHEMA;
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.client = (deps.createClientImpl ?? createClient)(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private bucket() {
    return this.client.storage.from(UPLOAD_BUCKET);
  }

  async createSignedUploadUrl(path: string): Promise<SignedUploadOutcome> {
    // upsert is false on purpose: an object that exists is never overwritten
    const { data, error } = await this.bucket().createSignedUploadUrl(path, {
      upsert: false,
    });
    if (error || !data) {
      const text = `${error?.message ?? ''} ${(error as any)?.statusCode ?? ''}`;
      return {
        ok: false,
        path,
        code:
          ALREADY_EXISTS.test(text) || /\b409\b/.test(text)
            ? 'OBJECT_EXISTS'
            : 'ERROR',
      };
    }
    return { ok: true, path, token: data.token, signedUrl: data.signedUrl };
  }

  /** A short lived read url of the own project, or null if the object is missing. */
  private async readUrl(path: string): Promise<string | null> {
    const { data, error } = await this.bucket().createSignedUrl(
      path,
      READ_URL_SECONDS
    );
    if (error || !data?.signedUrl) {
      if (error && NOT_FOUND.test(error.message)) return null;
      throw new UploadStorageError(
        'STORAGE_ERROR',
        'The storage did not answer.'
      );
    }
    const checked = readableStorageUrl(data.signedUrl, {
      supabaseUrl: this.url,
    });
    if (!checked.ok) {
      throw new UploadStorageError(
        'STORAGE_ERROR',
        'The storage returned an address outside of the own project.'
      );
    }
    return checked.url;
  }

  private async get(url: string, range?: string): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), READ_TIMEOUT_MS);
    try {
      return await this.fetchImpl(url, {
        method: 'GET',
        redirect: 'error',
        signal: controller.signal,
        headers: range ? { Range: range } : undefined,
      });
    } catch {
      throw new UploadStorageError(
        'READ_FAILED',
        'The object could not be read.'
      );
    } finally {
      clearTimeout(timer);
    }
  }

  async probe(path: string, headBytes: number): Promise<ProbeResult | null> {
    const url = await this.readUrl(path);
    if (url === null) return null;
    const response = await this.get(
      url,
      `bytes=0-${Math.max(0, headBytes - 1)}`
    );
    try {
      if (response.status === 404 || response.status === 400) return null;
      if (response.status === 416) {
        // A range on an empty object: the size is the part after the slash
        const total = /\/(\d+)$/.exec(
          response.headers.get('content-range') ?? ''
        );
        if (total && Number(total[1]) === 0) {
          return { size: 0, head: new Uint8Array(0) };
        }
        throw new UploadStorageError(
          'READ_FAILED',
          'The object could not be read.'
        );
      }
      if (response.status !== 206 && response.status !== 200) {
        throw new UploadStorageError(
          'READ_FAILED',
          'The object could not be read.'
        );
      }
      let size: number;
      if (response.status === 206) {
        const total = /\/(\d+)$/.exec(
          response.headers.get('content-range') ?? ''
        );
        if (!total) {
          throw new UploadStorageError(
            'READ_FAILED',
            'The size of the object is unknown.'
          );
        }
        size = Number(total[1]);
      } else {
        // The server ignored the range: the length of the whole body is the size
        const length = response.headers.get('content-length');
        if (length === null || !/^\d+$/.test(length)) {
          throw new UploadStorageError(
            'READ_FAILED',
            'The size of the object is unknown.'
          );
        }
        size = Number(length);
      }
      const { bytes } = await readLimited(response, headBytes);
      return { size, head: bytes };
    } finally {
      // Never leave an unread body behind (a 200 may be 25 MB)
      await response.body?.cancel().catch(() => undefined);
    }
  }

  async download(path: string, maxBytes: number): Promise<Uint8Array | null> {
    const url = await this.readUrl(path);
    if (url === null) return null;
    const response = await this.get(url);
    try {
      if (response.status === 404 || response.status === 400) return null;
      if (response.status !== 200) {
        throw new UploadStorageError(
          'READ_FAILED',
          'The object could not be read.'
        );
      }
      const length = response.headers.get('content-length');
      if (
        length !== null &&
        /^\d+$/.test(length) &&
        Number(length) > maxBytes
      ) {
        throw new UploadStorageError(
          'TOO_LARGE',
          'The object is larger than allowed.'
        );
      }
      const { bytes, overflow } = await readLimited(response, maxBytes);
      if (overflow) {
        throw new UploadStorageError(
          'TOO_LARGE',
          'The object is larger than allowed.'
        );
      }
      return bytes;
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  }

  async remove(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.bucket().remove([...paths]);
    if (error) {
      throw new UploadStorageError(
        'STORAGE_ERROR',
        'Objects could not be removed.'
      );
    }
  }

  async list(options: { maxObjects?: number } = {}): Promise<StorageObject[]> {
    const maxObjects = options.maxObjects ?? 5000;
    const root = this.schema === 'public_preview' ? 'preview/upload' : 'upload';
    return this.listUnder(root, maxObjects);
  }

  /** Lists `<root>/<run folder>/<file>` and nothing deeper. */
  private async listUnder(
    root: string,
    maxObjects: number
  ): Promise<StorageObject[]> {
    const folders: string[] = [];
    for (let offset = 0; ; offset += LIST_PAGE) {
      const { data, error } = await this.bucket().list(root, {
        limit: LIST_PAGE,
        offset,
      });
      if (error)
        throw new UploadStorageError(
          'STORAGE_ERROR',
          'The bucket could not be listed.'
        );
      if (!data || data.length === 0) break;
      for (const entry of data) {
        // a folder has no id
        if (entry.id === null || entry.id === undefined)
          folders.push(entry.name);
      }
      if (data.length < LIST_PAGE) break;
      if (folders.length >= maxObjects) break;
    }
    const objects: StorageObject[] = [];
    for (const folder of folders) {
      for (let offset = 0; ; offset += LIST_PAGE) {
        const { data, error } = await this.bucket().list(`${root}/${folder}`, {
          limit: LIST_PAGE,
          offset,
        });
        if (error)
          throw new UploadStorageError(
            'STORAGE_ERROR',
            'The bucket could not be listed.'
          );
        if (!data || data.length === 0) break;
        for (const entry of data) {
          if (entry.id === null || entry.id === undefined) continue;
          const size = (entry.metadata as { size?: unknown } | null)?.size;
          objects.push({
            path: `${root}/${folder}/${entry.name}`,
            size: typeof size === 'number' ? size : null,
            createdAt: entry.created_at ? new Date(entry.created_at) : null,
          });
          if (objects.length >= maxObjects) return objects;
        }
        if (data.length < LIST_PAGE) break;
      }
    }
    return objects;
  }
}

/** The storage of this deployment: Supabase behind the path guard. */
export function createUploadStorage(
  deps: SupabaseStorageDeps = {}
): UploadStorage {
  return guardUploadStorage(
    new SupabaseUploadStorage(deps),
    deps.schema ?? DB_SCHEMA
  );
}
