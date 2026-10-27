// The answer of a service function of the content upload: either the data or a
// failure with the HTTP status, a text for the person and a stable code. The
// routes turn it into a response (route-support.ts). A failure never carries
// text of a database, a storage or a file.

import type { UploadRepo } from '@/lib/content-upload/staging/repo';
import type { UploadStorage } from '@/lib/content-upload/staging/storage';

export interface Failure {
  ok: false;
  status: number;
  error: string;
  code?: string;
  retryAfterSec?: number;
}

export type ServiceResult<T> = { ok: true; data: T } | Failure;

export function ok<T>(data: T): ServiceResult<T> {
  return { ok: true, data };
}

export function fail(
  status: number,
  error: string,
  code?: string,
  extra: { retryAfterSec?: number } = {}
): Failure {
  return { ok: false, status, error, ...(code ? { code } : {}), ...extra };
}

/** What every service needs: the data access and, when it is used, the storage. */
export interface UploadDeps {
  repo: UploadRepo;
  /** Created on first use: most calls never touch the bucket. */
  storage: () => UploadStorage;
  /** Clock in milliseconds, for time budgets. */
  clock?: () => number;
}

/** Who is asking: the session of the route. */
export interface Caller {
  id: string;
  role: string;
}
