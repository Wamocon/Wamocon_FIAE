// Shared set-up of the content upload tests: the services on the in-memory
// repository and the in-memory storage, and small makers for files.

import { createHash } from 'crypto';
import { createRun } from '@/lib/content-upload/staging/runs';
import type { UploadDeps } from '@/lib/content-upload/staging/result';
import { guardUploadStorage } from '@/lib/content-upload/staging/storage';
import type { RunRow } from '@/lib/content-upload/staging/types';
import type { ReviewDeps } from '@/lib/content-upload/review/service';
import { MemoryKiRepo } from './memoryKiRepo';
import { MemoryReviewRepo } from './memoryReviewRepo';
import { MemoryUploadRepo } from './memoryUploadRepo';
import { MemoryUploadStorage } from './memoryUploadStorage';

export const USER = '11111111-1111-4111-8111-111111111111';
export const OTHER_USER = '22222222-2222-4222-8222-222222222222';

export const SUPER = { id: USER, role: 'SUPER_ADMIN' };
export const OTHER_ADMIN = { id: OTHER_USER, role: 'ADMIN' };

export function sha256(bytes: Uint8Array | string): string {
  return createHash('sha256').update(bytes).digest('hex');
}

/** The first bytes of a real PDF and of a docx (a zip), with a tail of text. */
export function pdfBytes(tail = 'body'): Uint8Array {
  return new TextEncoder().encode(`%PDF-1.7\n${tail}`);
}
export function docxBytes(tail = 'body'): Uint8Array {
  const head = Uint8Array.from([0x50, 0x4b, 0x03, 0x04]);
  const rest = new TextEncoder().encode(tail);
  const all = new Uint8Array(head.length + rest.length);
  all.set(head, 0);
  all.set(rest, head.length);
  return all;
}

export function setup(schema: 'public' | 'public_preview' = 'public') {
  const repo = new MemoryUploadRepo();
  const mem = new MemoryUploadStorage();
  const storage = guardUploadStorage(mem, schema);
  const deps: UploadDeps = {
    repo,
    storage: () => storage,
    clock: () => repo.now().getTime(),
  };
  // the review list on the same runs and files
  const review = new MemoryReviewRepo(repo);
  // the log of the model stage: the stage is off unless a test switches it on
  const ki = new MemoryKiRepo(() => repo.now().getTime());
  const reviewDeps: ReviewDeps = { ...deps, review, ki };
  return { repo, mem, storage, deps, review, ki, reviewDeps };
}

export async function newRun(
  deps: UploadDeps,
  caller = SUPER,
  label = 'A run'
): Promise<RunRow> {
  const created = await createRun(deps, caller, {
    label,
    declarationAccepted: true,
  });
  if (!created.ok)
    throw new Error(`could not create the run: ${created.error}`);
  return created.data;
}

/** An announce entry for content that is really there. */
export function entryFor(
  path: string,
  bytes: Uint8Array,
  lastModified = 1_700_000_000_000
) {
  return { path, size: bytes.length, sha256: sha256(bytes), lastModified };
}
