/**
 * Which object of the bucket `content` a stored address names.
 *
 * The bucket `content` is public today and becomes private at the go-live.
 * Rows (content_documents.storage_url, enablers.scenario_pdf_url, ppt_url,
 * video_url) store the address of a file in one of these forms:
 *
 *  - the public url of the own project,
 *      <project url>/storage/v1/object/public/content/<path>
 *  - a signed url of the own project that was saved by mistake,
 *      <project url>/storage/v1/object/sign/content/<path>?token=...
 *    (only the path is used, the token is dropped),
 *  - the private reference private://content/<path>,
 *  - the bare path inside the bucket, [preview/]<folder>/<file>.
 *
 * This module only reads the form and checks the path. It makes no request and
 * has no import of the app, so the scripts under scripts/ can load it directly
 * with Node's type stripping.
 *
 * The path is checked on the raw string with a strict alphabet. It is never
 * decoded or normalized: a url parser would resolve `..` and `%2e%2e` into a
 * path that looks fine. A path that does not fit the alphabet is "invalid" and
 * is never signed or read. The files of the uploads and of the imports use this
 * alphabet only (safeFileName, the uploader of the trainer pages).
 */

/** The bucket of the document files. */
export const CONTENT_BUCKET = 'content';

/** Scheme of a private reference (see content-import/documents/storage.ts). */
export const PRIVATE_SCHEME = 'private://';

const OBJECT_PATH = '/storage/v1/object/';

const MAX_RAW_LENGTH = 2048;
const MAX_PATH_LENGTH = 512;
const MAX_SEGMENTS = 12;

const SEGMENT = /^[A-Za-z0-9._-]{1,200}$/;

/** `?token=` of a signed url, the only query that is accepted. */
const SIGN_QUERY = /^\?token=[A-Za-z0-9._-]{1,1500}$/;

export type ContentReferenceForm = 'public' | 'signed' | 'private' | 'path';

export type ContentReference =
  /** An object of the bucket content, `path` passed the check. */
  | { kind: 'content'; path: string; form: ContentReferenceForm }
  /** It names the bucket content, but not safely: never signed, never read. */
  | { kind: 'invalid' }
  /** No object of the bucket content: empty, an external link, another bucket. */
  | { kind: 'other' };

/** `https://host[:port]` of the project, or null (only http and https). */
export function projectOrigin(
  supabaseUrl: string | null | undefined
): string | null {
  if (!supabaseUrl) return null;
  try {
    const url = new URL(supabaseUrl);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password) return null;
    return url.origin;
  } catch {
    return null;
  }
}

/** Whether `path` is a safe path inside the bucket (strict alphabet, no dot segments). */
export function isSafeContentPath(path: unknown): path is string {
  if (typeof path !== 'string' || path === '') return false;
  if (path.length > MAX_PATH_LENGTH) return false;
  const segments = path.split('/');
  if (segments.length > MAX_SEGMENTS) return false;
  return segments.every(
    segment => SEGMENT.test(segment) && segment !== '.' && segment !== '..'
  );
}

function fromPath(path: string, form: ContentReferenceForm): ContentReference {
  return isSafeContentPath(path)
    ? { kind: 'content', path, form }
    : { kind: 'invalid' };
}

export type ParseContentOptions = {
  /** The Supabase url of this deployment. Default: NEXT_PUBLIC_SUPABASE_URL. */
  supabaseUrl?: string | null;
};

/**
 * What a stored address is. Only the own project and the bucket content count:
 * a url of another host, another bucket, another scheme or any other path of
 * the project (rest, auth) is "other" and stays as it is.
 */
export function parseContentReference(
  raw: unknown,
  options: ParseContentOptions = {}
): ContentReference {
  if (typeof raw !== 'string') return { kind: 'other' };
  if (raw === '' || raw.trim() === '') return { kind: 'other' };
  if (raw.length > MAX_RAW_LENGTH) return { kind: 'invalid' };
  // Anything with a blank, a control character or a non-ASCII character in it
  // is not an address this module understands
  if (/[^\x21-\x7e]/.test(raw)) return { kind: 'other' };

  if (raw.startsWith(PRIVATE_SCHEME)) {
    const rest = raw.slice(PRIVATE_SCHEME.length);
    const slash = rest.indexOf('/');
    if (slash <= 0) return { kind: 'other' };
    if (rest.slice(0, slash) !== CONTENT_BUCKET) return { kind: 'other' };
    return fromPath(rest.slice(slash + 1), 'private');
  }

  // Another scheme, or a protocol relative or rooted address
  if (/^[A-Za-z][A-Za-z0-9+.-]*:|^[\\/]/.test(raw)) {
    const origin = projectOrigin(
      options.supabaseUrl === undefined
        ? process.env.NEXT_PUBLIC_SUPABASE_URL
        : options.supabaseUrl
    );
    if (!origin || !raw.startsWith(`${origin}${OBJECT_PATH}`)) {
      return { kind: 'other' };
    }
    const rest = raw.slice(origin.length + OBJECT_PATH.length);
    const match = /^(public|sign)\/([A-Za-z0-9_-]{1,100})\/(.+)$/.exec(rest);
    if (!match || match[2] !== CONTENT_BUCKET) return { kind: 'other' };

    const form = match[1] === 'sign' ? 'signed' : 'public';
    let path = match[3];
    const queryStart = path.indexOf('?');
    if (queryStart !== -1) {
      const query = path.slice(queryStart);
      path = path.slice(0, queryStart);
      if (form !== 'signed' || !SIGN_QUERY.test(query)) {
        return { kind: 'invalid' };
      }
    } else if (form === 'signed') {
      return { kind: 'invalid' };
    }
    return fromPath(path, form);
  }

  return fromPath(raw, 'path');
}

/** The reference that a row of a private object of the bucket content stores. */
export function contentPrivateReference(path: string): string {
  return `${PRIVATE_SCHEME}${CONTENT_BUCKET}/${path}`;
}

/** Whether `value` is a private reference of any bucket. */
export function isPrivateReference(value: unknown): boolean {
  return typeof value === 'string' && /^\s*private:\/\//i.test(value);
}

/**
 * Whether a trainee may be handed the row: no private reference, except one of
 * the bucket content (the teaching material, signed on the way out). The model
 * solutions (private://content-solutions/) stay trainer material.
 */
export function isTraineeFileReference(value: unknown): boolean {
  if (!isPrivateReference(value)) return true;
  return (
    typeof value === 'string' &&
    value.startsWith(`${PRIVATE_SCHEME}${CONTENT_BUCKET}/`)
  );
}

/**
 * The stored form of an address that arrives from a trainer: a signed url of
 * the own project (which expires) becomes the public url of the same file, so
 * a link taken from a page never ends up in a row. Everything else is returned
 * unchanged.
 */
export function canonicalStoredAddress(
  raw: string,
  options: ParseContentOptions = {}
): string {
  const ref = parseContentReference(raw, options);
  if (ref.kind !== 'content' || ref.form !== 'signed') return raw;
  const origin = projectOrigin(
    options.supabaseUrl === undefined
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : options.supabaseUrl
  );
  return origin
    ? `${origin}${OBJECT_PATH}public/${CONTENT_BUCKET}/${ref.path}`
    : raw;
}
