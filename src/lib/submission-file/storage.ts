// The private bucket `submission-files` as far as the submission file needs it.
//
// Only the server talks to it, with the secret key of the project (this code never
// creates a bucket, the owner does, see SUBMISSION_BUCKET_SETTINGS). The browser gets one
// signed upload url for one path the server picked, and a short lived read link for one
// object. Every call checks the exact path form again (guardSubmissionStorage), so a path
// from a bug can still not leave the two folders of one scope.

import { createClient } from '@supabase/supabase-js';
import { DB_SCHEMA, type DbSchema } from '@/lib/db-schema';
import { getSupabaseSecretKey } from '@/lib/env';
import {
  SUBMISSION_BUCKET,
  isSubmissionFolder,
  isTraineeFolder,
  parseSubmissionPath,
} from '@/lib/submission-file/rules';

export type SubmissionStorageErrorCode =
  | 'NOT_CONFIGURED'
  | 'INVALID_PATH'
  | 'STORAGE_ERROR';

export class SubmissionStorageError extends Error {
  readonly code: SubmissionStorageErrorCode;
  constructor(code: SubmissionStorageErrorCode, message: string) {
    super(message);
    this.name = 'SubmissionStorageError';
    this.code = code;
  }
}

export type SignedUpload =
  | { ok: true; token: string }
  | { ok: false; code: 'OBJECT_EXISTS' | 'ERROR' };

export interface StoredObject {
  /** The name inside the folder. */
  name: string;
  size: number | null;
}

export interface SubmissionFileStorage {
  /** A signed upload url for one path. Never overwrites an object. */
  createSignedUploadUrl(path: string): Promise<SignedUpload>;
  /** The objects directly inside one folder (`…/incoming` or `…/file`). */
  list(folder: string): Promise<StoredObject[]>;
  /** The names of the sub folders of one trainee folder (`<org>/<trainee>`): the use cases. */
  listFolders(traineeFolder: string): Promise<string[]>;
  /** The whole object, or null if there is no such object. */
  download(path: string): Promise<Uint8Array | null>;
  /** Moves an object, the target must not exist. */
  move(from: string, to: string): Promise<void>;
  /** Removes objects. A path that does not exist is not an error. */
  remove(paths: readonly string[]): Promise<void>;
  /** A short lived read link that forces a download under `downloadName`, or null. */
  createSignedUrl(
    path: string,
    seconds: number,
    downloadName: string
  ): Promise<string | null>;
}

export function guardSubmissionStorage(
  inner: SubmissionFileStorage,
  schema: DbSchema = DB_SCHEMA
): SubmissionFileStorage {
  const path = (value: string) => {
    if (parseSubmissionPath(value, schema) === null) {
      throw new SubmissionStorageError(
        'INVALID_PATH',
        'The storage path is not one of the submission bucket.'
      );
    }
  };
  return {
    createSignedUploadUrl(value) {
      path(value);
      return inner.createSignedUploadUrl(value);
    },
    list(folder) {
      if (!isSubmissionFolder(folder, schema)) {
        throw new SubmissionStorageError(
          'INVALID_PATH',
          'The storage folder is not one of the submission bucket.'
        );
      }
      return inner.list(folder);
    },
    listFolders(folder) {
      if (!isTraineeFolder(folder, schema)) {
        throw new SubmissionStorageError(
          'INVALID_PATH',
          'The storage folder is not a trainee folder of the submission bucket.'
        );
      }
      return inner.listFolders(folder);
    },
    download(value) {
      path(value);
      return inner.download(value);
    },
    move(from, to) {
      path(from);
      path(to);
      return inner.move(from, to);
    },
    remove(paths) {
      paths.forEach(path);
      return inner.remove(paths);
    },
    createSignedUrl(value, seconds, downloadName) {
      path(value);
      return inner.createSignedUrl(value, seconds, downloadName);
    },
  };
}

export interface SupabaseSubmissionStorageDeps {
  supabaseUrl?: string;
  secretKey?: string;
  schema?: DbSchema;
  createClientImpl?: typeof createClient;
}

const LIST_LIMIT = 100;
/** More use case folders than this under one trainee do not exist. */
const MAX_FOLDERS = 5000;
const NOT_FOUND = /not.?found|does not exist|no such/i;
const ALREADY_EXISTS = /already exists|duplicate/i;

class SupabaseSubmissionStorage implements SubmissionFileStorage {
  private readonly client: ReturnType<typeof createClient>;

  constructor(deps: SupabaseSubmissionStorageDeps) {
    const url =
      deps.supabaseUrl ??
      (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
    const key = deps.secretKey ?? getSupabaseSecretKey();
    if (!url || !key) {
      throw new SubmissionStorageError(
        'NOT_CONFIGURED',
        'The storage is not configured.'
      );
    }
    this.client = (deps.createClientImpl ?? createClient)(url, key, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }

  private bucket() {
    return this.client.storage.from(SUBMISSION_BUCKET);
  }

  async createSignedUploadUrl(path: string): Promise<SignedUpload> {
    // upsert is false on purpose: an object that exists is never overwritten
    const { data, error } = await this.bucket().createSignedUploadUrl(path, {
      upsert: false,
    });
    if (error || !data) {
      const text = `${error?.message ?? ''} ${(error as { statusCode?: unknown } | null)?.statusCode ?? ''}`;
      return {
        ok: false,
        code:
          ALREADY_EXISTS.test(text) || /\b409\b/.test(text)
            ? 'OBJECT_EXISTS'
            : 'ERROR',
      };
    }
    return { ok: true, token: data.token };
  }

  async list(folder: string): Promise<StoredObject[]> {
    const { data, error } = await this.bucket().list(folder, {
      limit: LIST_LIMIT,
    });
    if (error) {
      throw new SubmissionStorageError(
        'STORAGE_ERROR',
        'The folder could not be listed.'
      );
    }
    const objects: StoredObject[] = [];
    for (const entry of data ?? []) {
      // a folder has no id
      if (entry.id === null || entry.id === undefined) continue;
      const size = (entry.metadata as { size?: unknown } | null)?.size;
      objects.push({
        name: entry.name,
        size: typeof size === 'number' ? size : null,
      });
    }
    return objects;
  }

  async listFolders(traineeFolder: string): Promise<string[]> {
    const names: string[] = [];
    // one folder per use case the trainee ever touched, so read page after page
    for (let offset = 0; offset < MAX_FOLDERS; offset += LIST_LIMIT) {
      const { data, error } = await this.bucket().list(traineeFolder, {
        limit: LIST_LIMIT,
        offset,
      });
      if (error) {
        throw new SubmissionStorageError(
          'STORAGE_ERROR',
          'The folder could not be listed.'
        );
      }
      const page = data ?? [];
      // a folder has no id, an object does
      for (const entry of page) {
        if (entry.id === null || entry.id === undefined) {
          names.push(entry.name);
        }
      }
      if (page.length < LIST_LIMIT) return names;
    }
    throw new SubmissionStorageError(
      'STORAGE_ERROR',
      'The folder has more entries than expected.'
    );
  }

  async download(path: string): Promise<Uint8Array | null> {
    const { data, error } = await this.bucket().download(path);
    if (error || !data) {
      if (error && NOT_FOUND.test(error.message)) return null;
      throw new SubmissionStorageError(
        'STORAGE_ERROR',
        'The object could not be read.'
      );
    }
    return new Uint8Array(await data.arrayBuffer());
  }

  async move(from: string, to: string): Promise<void> {
    const { error } = await this.bucket().move(from, to);
    if (error) {
      throw new SubmissionStorageError(
        'STORAGE_ERROR',
        'The object could not be moved.'
      );
    }
  }

  async remove(paths: readonly string[]): Promise<void> {
    if (paths.length === 0) return;
    const { error } = await this.bucket().remove([...paths]);
    if (error) {
      throw new SubmissionStorageError(
        'STORAGE_ERROR',
        'Objects could not be removed.'
      );
    }
  }

  async createSignedUrl(
    path: string,
    seconds: number,
    downloadName: string
  ): Promise<string | null> {
    const { data, error } = await this.bucket().createSignedUrl(path, seconds, {
      download: downloadName,
    });
    if (error || !data?.signedUrl) {
      if (error && NOT_FOUND.test(error.message)) return null;
      throw new SubmissionStorageError(
        'STORAGE_ERROR',
        'The storage did not answer.'
      );
    }
    return data.signedUrl;
  }
}

/** The storage of this deployment: Supabase behind the path guard. */
export function createSubmissionStorage(
  deps: SupabaseSubmissionStorageDeps = {}
): SubmissionFileStorage {
  return guardSubmissionStorage(
    new SupabaseSubmissionStorage(deps),
    deps.schema ?? DB_SCHEMA
  );
}
