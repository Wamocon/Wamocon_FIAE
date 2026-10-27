/**
 * Removes the storage file of a document that is deleted, as far as that is
 * safe. The routes call it after the permission check, as a best effort step
 * (a failure never stops the delete of the row).
 *
 * The file is removed only when
 *  - it lies in the folder of the person who uploaded the document, in the own
 *    project and the bucket content (isOwnedStoragePath). The curriculum files
 *    of the bulk import and everything that does not have the form of an upload
 *    stay in the storage.
 *  - no other document and no enabler (ppt, scenario pdf, video) points to the
 *    same file. Without that check a second row with the same url would lose
 *    its file when the first one is deleted.
 *
 * The service key removes the file, so the decision must never rest on the url
 * alone. A failing check is an error here: the caller keeps the file.
 */

import { and, eq, ne, or, sql } from 'drizzle-orm';
import type { PgColumn } from 'drizzle-orm/pg-core';
import db from '@/db';
import { DB_OPTION } from '@/lib/db-schema';
import { getSupabasePublicKey, getSupabaseSecretKey } from '@/lib/env';
import { contentDocuments, enablers } from '@/db/migrations/schemas/schema';
import { DOCUMENT_BUCKET, isOwnedStoragePath } from '@/lib/document-storage';

export type DocumentFileRemoval =
  | 'removed'
  /** the file is not one that belongs to this document alone */
  | 'kept'
  /** not removable by rule, or the storage is not configured */
  | 'skipped';

/** Whether another row of the database points to the file at `path`. */
async function isFileReferenced(
  documentId: string,
  path: string
): Promise<boolean> {
  const endsWithPath = (column: PgColumn) =>
    sql`right(${column}, ${path.length}) = ${path}`;

  const [otherDocument] = await db
    .select({ id: contentDocuments.id })
    .from(contentDocuments)
    .where(
      and(
        ne(contentDocuments.id, documentId as any),
        or(
          eq(contentDocuments.storagePath, path),
          endsWithPath(contentDocuments.storageUrl)
        )
      )
    )
    .limit(1);
  if (otherDocument) return true;

  const [enabler] = await db
    .select({ id: enablers.id })
    .from(enablers)
    .where(
      or(
        endsWithPath(enablers.pptUrl),
        endsWithPath(enablers.scenarioPdfUrl),
        endsWithPath(enablers.videoUrl)
      )
    )
    .limit(1);
  return Boolean(enabler);
}

export async function removeDocumentFile(doc: {
  id: unknown;
  storageUrl?: unknown;
  uploadedById?: unknown;
}): Promise<DocumentFileRemoval> {
  const path = isOwnedStoragePath(doc);
  if (!path) return 'skipped';

  if (await isFileReferenced(String(doc.id), path)) return 'kept';

  const supabaseUrl =
    process.env.SUPABASE_URL_INTERNAL || process.env.NEXT_PUBLIC_SUPABASE_URL;
  const supabaseKey = getSupabaseSecretKey() || getSupabasePublicKey();
  if (!supabaseUrl || !supabaseKey) return 'skipped';

  const { createClient } = await import('@supabase/supabase-js');
  const supabase = createClient(supabaseUrl, supabaseKey, { db: DB_OPTION });
  const { error } = await supabase.storage.from(DOCUMENT_BUCKET).remove([path]);
  if (error) {
    // The storage answers with an error object, it does not throw
    console.warn('Document file was not removed from the storage');
    return 'skipped';
  }
  return 'removed';
}
