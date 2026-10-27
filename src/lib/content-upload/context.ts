// What the routes of the content upload run on: the SQL repository over the
// database of the app and the storage of this deployment. Both are created on
// first use, so loading a route never needs a connection or a key. Tests replace
// this module with the in-memory versions.

import db from '@/db';
import { PgUploadRepo } from '@/lib/content-upload/repo-pg';
import type { UploadRepo } from '@/lib/content-upload/repo';
import type { UploadDeps } from '@/lib/content-upload/result';
import {
  createUploadStorage,
  type UploadStorage,
} from '@/lib/content-upload/storage';

let repo: UploadRepo | undefined;
let storage: UploadStorage | undefined;

export function getUploadRepo(): UploadRepo {
  repo ??= new PgUploadRepo(db as any);
  return repo;
}

/** Throws UploadStorageError NOT_CONFIGURED when the project url or key is missing. */
export function getUploadStorage(): UploadStorage {
  storage ??= createUploadStorage();
  return storage;
}

export function uploadDeps(): UploadDeps {
  return { repo: getUploadRepo(), storage: getUploadStorage };
}
