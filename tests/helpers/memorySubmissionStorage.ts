import {
  guardSubmissionStorage,
  type SignedUpload,
  type StoredObject,
  type SubmissionFileStorage,
} from '@/lib/submission-file/storage';
import type { DbSchema } from '@/lib/db-schema';

/**
 * An in-memory bucket for the submission file, behind the same path guard as the real
 * storage. `objects` is the content by path; `calls` records the paths that were asked for.
 */
export function createMemorySubmissionStorage(
  schema: DbSchema = 'public'
): SubmissionFileStorage & {
  objects: Map<string, Uint8Array>;
  signedFor: string[];
  failNext: (operation: keyof SubmissionFileStorage) => void;
} {
  const objects = new Map<string, Uint8Array>();
  const signedFor: string[] = [];
  const failures = new Set<string>();
  const check = (operation: string) => {
    if (failures.delete(operation)) throw new Error(`${operation} failed`);
  };

  const inner: SubmissionFileStorage = {
    async createSignedUploadUrl(path): Promise<SignedUpload> {
      check('createSignedUploadUrl');
      if (objects.has(path)) return { ok: false, code: 'OBJECT_EXISTS' };
      signedFor.push(path);
      return { ok: true, token: `token-for-${path}` };
    },
    async list(folder): Promise<StoredObject[]> {
      check('list');
      const prefix = `${folder}/`;
      return [...objects.entries()]
        .filter(([path]) => path.startsWith(prefix))
        .map(([path, bytes]) => ({
          name: path.slice(prefix.length),
          size: bytes.length,
        }));
    },
    async listFolders(folder): Promise<string[]> {
      check('listFolders');
      const prefix = `${folder}/`;
      return [
        ...new Set(
          [...objects.keys()]
            .filter(path => path.startsWith(prefix))
            .map(path => path.slice(prefix.length))
            // only sub folders, like the real storage (an object has no sub path)
            .filter(rest => rest.includes('/'))
            .map(rest => rest.split('/')[0])
        ),
      ];
    },
    async download(path) {
      check('download');
      return objects.get(path) ?? null;
    },
    async move(from, to) {
      check('move');
      const bytes = objects.get(from);
      if (!bytes) throw new Error('missing');
      if (objects.has(to)) throw new Error('exists');
      objects.delete(from);
      objects.set(to, bytes);
    },
    async remove(paths) {
      check('remove');
      paths.forEach(path => objects.delete(path));
    },
    async createSignedUrl(path, seconds, downloadName) {
      check('createSignedUrl');
      return objects.has(path)
        ? `https://storage.example.invalid/${path}?t=${seconds}&download=${downloadName}`
        : null;
    },
  };

  return Object.assign(guardSubmissionStorage(inner, schema), {
    objects,
    signedFor,
    failNext: (operation: keyof SubmissionFileStorage) => {
      failures.add(operation);
    },
  });
}

export const PDF_BYTES = new TextEncoder().encode('%PDF-1.7 test file');
