/**
 * Which storage files a document row may point to.
 *
 * The upload of a document (components/trainer/PdfUploader.tsx) writes the file
 * from the browser to the bucket `content` under
 *
 *   [preview/]<id of the uploader>/<timestamp>_<file name with [A-Za-z0-9.-_]>
 *
 * and sends the public url of that file to the document routes. The server
 * trusted that url: the delete route removes the file with the service key, so
 * a document that was created with the url of a foreign file turned the delete
 * into a way to remove that foreign file.
 *
 * The rule now: a document may point to exactly the form above, for the person
 * who creates it, in the own Supabase project. Everything else is refused:
 * other folders (the curriculum files of the bulk import, the folder of
 * another person), other buckets, other hosts, other schemes, dot segments,
 * encoded characters, query strings, nested paths.
 *
 * The check works on the raw string and a strict alphabet, it never decodes or
 * normalizes. A url parser would resolve `..` and `%2e%2e` into a path that
 * looks fine.
 */

import { withStoragePrefix, type DbSchema } from '@/lib/db-schema';

/** The bucket of the document files. */
export const DOCUMENT_BUCKET = 'content';

const PUBLIC_OBJECT_PATH = `/storage/v1/object/public/${DOCUMENT_BUCKET}/`;

/** Ids of people: a uuid, but only the alphabet is checked here. */
const OWNER_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

/** `<timestamp>_<name>`, the name written by the uploader. */
const FILE_PATTERN = /^\d{1,20}_[A-Za-z0-9._-]{1,200}$/;

export type DocumentStorageOptions = {
  /**
   * The Supabase url of this deployment. Default: NEXT_PUBLIC_SUPABASE_URL,
   * the one the browser uploads to. Without it no url is accepted (the bare
   * path still is).
   */
  supabaseUrl?: string | null;
  /** The database schema, which decides about the preview/ prefix. */
  schema?: DbSchema;
};

/** `https://host[:port]` of the configured project, or null. */
function projectOrigin(supabaseUrl: string | null | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    return url.origin;
  } catch {
    return null;
  }
}

/**
 * The path inside the bucket for a storage reference that an uploader with the
 * id `ownerId` may have produced, or null. `raw` is the public url or the bare
 * path.
 */
export function documentStoragePath(
  raw: unknown,
  ownerId: string,
  options: DocumentStorageOptions = {}
): string | null {
  if (typeof raw !== 'string' || !OWNER_PATTERN.test(ownerId)) return null;

  let path = raw;
  if (/^[A-Za-z][A-Za-z0-9+.-]*:|^\/\//.test(raw)) {
    // A url: only the public object url of the own project
    const origin = projectOrigin(
      options.supabaseUrl === undefined
        ? process.env.NEXT_PUBLIC_SUPABASE_URL
        : options.supabaseUrl
    );
    if (!origin) return null;
    const prefix = `${origin}${PUBLIC_OBJECT_PATH}`;
    if (!raw.startsWith(prefix)) return null;
    path = raw.slice(prefix.length);
  }

  // Exactly [preview/]<owner>/<file>, nothing before, between or after
  const expectedFolder = withStoragePrefix(`${ownerId}/`, options.schema);
  if (!path.startsWith(expectedFolder)) return null;
  const file = path.slice(expectedFolder.length);
  if (!FILE_PATTERN.test(file)) return null;
  return path;
}

/**
 * The public url of a validated path, as the browser gets it from the storage.
 * Documents are stored with this url (the viewers and the text extraction
 * fetch it), also when the request carried the bare path. Without a configured
 * project url the path is returned unchanged.
 */
export function documentPublicUrl(
  path: string,
  options: DocumentStorageOptions = {}
): string {
  const origin = projectOrigin(
    options.supabaseUrl === undefined
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : options.supabaseUrl
  );
  return origin ? `${origin}${PUBLIC_OBJECT_PATH}${path}` : path;
}

/**
 * The path inside the bucket of the file of a stored document, but only when
 * the file lies in the folder of the person who uploaded the document. Only
 * such a file may be removed from the storage together with the document. The
 * files of the curriculum import, of another person or of another project give
 * null: they stay.
 */
export function isOwnedStoragePath(
  doc: { storageUrl?: unknown; uploadedById?: unknown },
  options: DocumentStorageOptions = {}
): string | null {
  if (typeof doc.uploadedById !== 'string' || !doc.uploadedById) return null;
  return documentStoragePath(doc.storageUrl, doc.uploadedById, options);
}
