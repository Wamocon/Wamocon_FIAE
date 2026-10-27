// UploadStorage in memory, for the unit tests (no Supabase, no network).

import {
  UploadStorageError,
  guardUploadStorage,
  type ProbeResult,
  type SignedUploadOutcome,
  type StorageObject,
  type UploadStorage,
} from '@/lib/content-upload/staging/storage';

export class MemoryUploadStorage implements UploadStorage {
  objects = new Map<string, { bytes: Uint8Array; createdAt: Date }>();
  /** Every signed upload url that was asked for, with the upsert flag it got. */
  signed: { path: string; upsert: boolean }[] = [];
  removed: string[] = [];
  /** Paths whose removal fails (the whole call fails). */
  failRemoveFor = new Set<string>();
  failList = false;
  failProbe = false;

  put(path: string, bytes: Uint8Array | string, createdAt = new Date()) {
    this.objects.set(path, {
      bytes:
        typeof bytes === 'string' ? new TextEncoder().encode(bytes) : bytes,
      createdAt,
    });
  }

  async createSignedUploadUrl(path: string): Promise<SignedUploadOutcome> {
    this.signed.push({ path, upsert: false });
    if (this.objects.has(path))
      return { ok: false, path, code: 'OBJECT_EXISTS' };
    return {
      ok: true,
      path,
      token: `token-for-${path}`,
      signedUrl: `https://storage.example.test/upload/sign/${path}?token=t`,
    };
  }

  async probe(path: string, headBytes: number): Promise<ProbeResult | null> {
    if (this.failProbe) {
      throw new UploadStorageError(
        'READ_FAILED',
        'The object could not be read.'
      );
    }
    const object = this.objects.get(path);
    if (!object) return null;
    return {
      size: object.bytes.length,
      head: object.bytes.slice(0, headBytes),
    };
  }

  async download(path: string, maxBytes: number): Promise<Uint8Array | null> {
    const object = this.objects.get(path);
    if (!object) return null;
    if (object.bytes.length > maxBytes) {
      throw new UploadStorageError(
        'TOO_LARGE',
        'The object is larger than allowed.'
      );
    }
    return object.bytes.slice();
  }

  async remove(paths: readonly string[]): Promise<void> {
    if (paths.some(p => this.failRemoveFor.has(p))) {
      throw new UploadStorageError(
        'STORAGE_ERROR',
        'Objects could not be removed.'
      );
    }
    for (const path of paths) {
      this.objects.delete(path);
      this.removed.push(path);
    }
  }

  async list(): Promise<StorageObject[]> {
    if (this.failList) {
      throw new UploadStorageError(
        'STORAGE_ERROR',
        'The bucket could not be listed.'
      );
    }
    return [...this.objects.entries()].map(([path, o]) => ({
      path,
      size: o.bytes.length,
      createdAt: o.createdAt,
    }));
  }
}

/** The memory storage behind the path guard, like the real one. */
export function guardedMemoryStorage(
  schema: 'public' | 'public_preview' = 'public'
) {
  const inner = new MemoryUploadStorage();
  return { inner, storage: guardUploadStorage(inner, schema) };
}
