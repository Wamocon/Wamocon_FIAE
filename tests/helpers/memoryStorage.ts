// A storage in memory for the tests of the PDF import: it implements StorageAdapter
// (src/lib/content-import/documents/storage.ts) and records every call. It never talks to a
// network. A test makes it fail at one place with `failPutAt` or `failRemove`.
import type { StorageAdapter } from '@/lib/content-import/documents/storage';

export class MemoryStorage implements StorageAdapter {
  objects = new Map<string, Uint8Array>();
  contentTypes = new Map<string, string>();
  calls: string[] = [];
  /** Number of the put call (1 based) that throws. */
  failPutAt: number | null = null;
  failRemove = false;
  private puts = 0;

  private key(bucket: string, path: string) {
    return `${bucket}/${path}`;
  }

  async exists(bucket: string, path: string) {
    this.calls.push(`exists ${this.key(bucket, path)}`);
    return this.objects.has(this.key(bucket, path));
  }

  async put(
    bucket: string,
    path: string,
    bytes: Uint8Array,
    contentType: string,
    options: { upsert: boolean }
  ) {
    this.puts += 1;
    this.calls.push(`put ${this.key(bucket, path)} upsert=${options.upsert}`);
    if (this.failPutAt === this.puts) throw new Error('storage put failed');
    if (this.objects.has(this.key(bucket, path)) && !options.upsert) {
      throw new Error('object exists');
    }
    this.objects.set(this.key(bucket, path), bytes);
    this.contentTypes.set(this.key(bucket, path), contentType);
  }

  async remove(bucket: string, paths: readonly string[]) {
    this.calls.push(`remove ${paths.map(p => this.key(bucket, p)).join(',')}`);
    if (this.failRemove) throw new Error('storage remove failed');
    for (const path of paths) this.objects.delete(this.key(bucket, path));
  }
}
