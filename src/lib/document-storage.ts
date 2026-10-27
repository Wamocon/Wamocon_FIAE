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

// ---------------------------------------------------------------------------
// Reading: the server fetches the file of a stored document
// ---------------------------------------------------------------------------
//
// documentStoragePath() above is the rule for what a person may WRITE into a
// document row. The server also READS the file (PageIndex, the ingestion of
// solutions) with fetch(), and the rows it reads can be old: a row may hold
// any url, which would make the server call that url (blind SSRF). The rule
// for reading is wider, because the curriculum files of the import live in
// other folders, but it only ever leads to the own Supabase project.

const MAX_READ_URL_LENGTH = 2048;

/** Visible ASCII only: no blanks, control characters or non-ASCII. */
const NOT_PRINTABLE_ASCII = /[^\x21-\x7e]/;

/**
 * `/storage/v1/object/(public|sign)/<bucket>/<path>`: a conservative alphabet,
 * no empty segments, and no dot segment (checked separately).
 */
const READ_PATH_PATTERN =
  /^\/storage\/v1\/object\/(public|sign)\/[A-Za-z0-9_-]{1,100}\/[A-Za-z0-9._~%!$&'()*+,;=:@-]+(?:\/[A-Za-z0-9._~%!$&'()*+,;=:@-]+)*$/;

/** The token of a signed url, the only query that is read. */
const SIGN_QUERY_PATTERN = /^\?token=[A-Za-z0-9._-]{1,1500}$/;

/** Encoded dot, slash, backslash and NUL: they can hide a path traversal. */
const ENCODED_TRAVERSAL = /%2e|%2f|%5c|%00/i;

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);

export type ReadableStorageUrl =
  | { ok: true; url: string }
  | { ok: false; reason: string };

/**
 * `https://host` of the own project for reading. Only https on the default
 * port and without credentials. The exception is the local Supabase of the
 * Supabase CLI (http on the own machine), never in production.
 */
function readOrigin(supabaseUrl: string | null | undefined): string | null {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    if (url.username || url.password) return null;
    if (url.protocol === 'https:' && url.port === '') return url.origin;
    if (
      url.protocol === 'http:' &&
      process.env.NODE_ENV !== 'production' &&
      LOOPBACK_HOSTS.has(url.hostname)
    ) {
      return url.origin;
    }
    return null;
  } catch {
    return null;
  }
}

function refuse(reason: string): ReadableStorageUrl {
  return { ok: false, reason };
}

/**
 * Whether the server may fetch `raw` (the storage url of a document row) and
 * the url to fetch. The reason of a refusal never repeats the value.
 *
 * Accepted:
 *  - the object url of the own project: `<project url>/storage/v1/object/public/…`
 *    or `…/object/sign/…?token=…`, any bucket, any folder
 *  - the bare path of an upload, `[preview/]<id>/<timestamp>_<name>`, which is
 *    turned into the public url in the bucket `content`
 *
 * Everything else is refused: other hosts, other schemes, credentials in the
 * url, ports, other paths of the project (rest, auth, admin), dot segments,
 * encoded separators, fragments and queries (except the token of a signed
 * url), local file paths.
 *
 * The check is done on the raw string: it has to start with the origin of the
 * project, so `https://project@evil` and `https://project.evil` cannot pass,
 * and the parsed url must give back exactly the same path, so a normalization
 * cannot move the request out of /storage/v1/object/.
 *
 * The caller must also fetch with `redirect: 'error'`: a redirect of the
 * storage would leave the checked host.
 */
export function readableStorageUrl(
  raw: unknown,
  options: DocumentStorageOptions = {}
): ReadableStorageUrl {
  if (typeof raw !== 'string' || raw === '') {
    return refuse('The storage url is missing or not a text.');
  }
  if (raw.length > MAX_READ_URL_LENGTH) {
    return refuse('The storage url is too long.');
  }
  if (NOT_PRINTABLE_ASCII.test(raw)) {
    return refuse('The storage url contains characters that are not allowed.');
  }

  const origin = readOrigin(
    options.supabaseUrl === undefined
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : options.supabaseUrl
  );
  if (!origin) {
    return refuse(
      'The own Supabase project is not configured for https, files are not read.'
    );
  }

  // A bare path of an upload becomes the public url of the own project
  if (!/^[A-Za-z][A-Za-z0-9+.-]*:|^[\\/]/.test(raw)) {
    const folder = withStoragePrefix('', options.schema);
    const file = raw.startsWith(folder) ? raw.slice(folder.length) : null;
    const parts = file === null ? null : file.split('/');
    if (
      parts &&
      parts.length === 2 &&
      OWNER_PATTERN.test(parts[0]) &&
      FILE_PATTERN.test(parts[1])
    ) {
      return { ok: true, url: `${origin}${PUBLIC_OBJECT_PATH}${raw}` };
    }
    return refuse('The storage reference is not a file of the own project.');
  }

  if (!raw.startsWith(`${origin}/`)) {
    return refuse('The storage url does not belong to the own project.');
  }
  if (raw.includes('#')) {
    return refuse('The storage url must not carry a fragment.');
  }

  const rest = raw.slice(origin.length);
  const queryStart = rest.indexOf('?');
  const path = queryStart === -1 ? rest : rest.slice(0, queryStart);
  const query = queryStart === -1 ? '' : rest.slice(queryStart);

  const pathMatch = READ_PATH_PATTERN.exec(path);
  if (!pathMatch) {
    return refuse('The storage url is not an object url of the storage.');
  }
  if (
    ENCODED_TRAVERSAL.test(path) ||
    path.split('/').some(segment => segment === '.' || segment === '..')
  ) {
    return refuse('The storage url contains a path traversal.');
  }
  if (pathMatch[1] === 'sign' ? !SIGN_QUERY_PATTERN.test(query) : query) {
    return refuse('The storage url carries a query that is not allowed.');
  }

  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return refuse('The storage url cannot be parsed.');
  }
  if (
    parsed.origin !== origin ||
    parsed.username ||
    parsed.password ||
    parsed.pathname !== path ||
    parsed.search !== query
  ) {
    return refuse('The storage url is not normalized, it is not read.');
  }

  return { ok: true, url: raw };
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
