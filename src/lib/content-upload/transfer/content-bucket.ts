// The public bucket `content` as far as the transfer writes to it: the copies of
// enabler text originals (docs/ki-upload-konzept.md 8.5), and nothing else.
//
// The bucket is shared between Preview and Production and public, so the rules
// are strict:
//   - only the exact form of src/lib/document-storage.ts is written or removed:
//     [preview/]<id of the person who applied>/<timestamp>_<ascii name>, checked
//     before every call (a path from anywhere else throws)
//   - an object is never replaced (upsert false)
//   - the secret key of the project is used on the server only
// The transfer calls this only for originals that a person asked for by name and
// that passed the checks of originals.ts. Tests replace it with a fake.

import { createClient } from '@supabase/supabase-js';
import { getSupabaseSecretKey } from '@/lib/env';
import { DB_SCHEMA, PREVIEW_STORAGE_PREFIX } from '@/lib/db-schema';
import { DOCUMENT_BUCKET, documentStoragePath } from '@/lib/document-storage';
import {
  OriginalsError,
  type ContentBucketPort,
} from '@/lib/content-upload/transfer/originals';

/** Owner id of a path in the exact form, or null. */
function ownerOf(path: string): string | null {
  const folder =
    DB_SCHEMA === 'public_preview' && path.startsWith(PREVIEW_STORAGE_PREFIX)
      ? path.slice(PREVIEW_STORAGE_PREFIX.length)
      : path;
  const owner = folder.split('/')[0];
  return owner && documentStoragePath(path, owner) === path ? owner : null;
}

function checked(path: string): string {
  if (ownerOf(path) === null) {
    throw new OriginalsError(
      'INVALID_PATH',
      'The path is not one of the document bucket.'
    );
  }
  return path;
}

export interface ContentBucketDeps {
  supabaseUrl?: string;
  secretKey?: string;
  createClientImpl?: typeof createClient;
}

export function createContentBucket(
  deps: ContentBucketDeps = {}
): ContentBucketPort {
  const url =
    deps.supabaseUrl ??
    (process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL);
  const key = deps.secretKey ?? getSupabaseSecretKey();
  if (!url || !key) {
    throw new OriginalsError(
      'NOT_CONFIGURED',
      'The document storage is not configured.'
    );
  }
  const client = (deps.createClientImpl ?? createClient)(url, key, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const bucket = () => client.storage.from(DOCUMENT_BUCKET);
  return {
    async put(path, bytes, contentType) {
      const { error } = await bucket().upload(checked(path), bytes, {
        contentType,
        upsert: false,
      });
      if (error) {
        throw new OriginalsError(
          'PUT_FAILED',
          'The document bucket did not take the file.'
        );
      }
    },
    async remove(paths) {
      if (paths.length === 0) return;
      const { error } = await bucket().remove(paths.map(checked));
      if (error) {
        throw new OriginalsError(
          'REMOVE_FAILED',
          'Files could not be removed from the document bucket.'
        );
      }
    },
  };
}
