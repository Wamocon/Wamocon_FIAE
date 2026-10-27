// Paths of the content upload (concept section 4.4).
//
// Two different things are called a path here and they never meet:
//
//  - the RELATIVE PATH of a file as the browser announced it
//    (webkitRelativePath). It is cleaned and then only stored and shown, and it
//    feeds the path rule of the classification. It is never a storage path.
//  - the STORAGE PATH of the object in the private bucket. The server picks it
//    from two uuids it generated itself, never from user input, and accepts
//    exactly one form per schema, checked on the raw string (rules of
//    src/lib/document-storage.ts: strict alphabet, no decoding, no dot
//    segments, no queries, no nesting).
//
//      Production / local:  upload/<run uuid>/<file uuid>.<docx|pdf>
//      Preview:             preview/upload/<run uuid>/<file uuid>.<docx|pdf>
//
// There is no pattern with an optional prefix: a Preview that accepted the
// Production form (or the reverse) could touch the objects of the other one in
// the shared bucket.

import { DB_SCHEMA, withStoragePrefix, type DbSchema } from '@/lib/db-schema';
import { LIMITS } from '@/lib/content-upload/staging/config';

export type UploadExt = 'docx' | 'pdf';

const EXTENSIONS: readonly UploadExt[] = ['docx', 'pdf'];

// ---------------------------------------------------------------------------
// Relative path of an announced file
// ---------------------------------------------------------------------------

export type PathRejection =
  | 'PATH_INVALID'
  | 'PATH_EMPTY'
  | 'PATH_TOO_LONG'
  | 'PATH_TOO_DEEP'
  | 'FILE_NAME_TOO_LONG'
  | 'UNSUPPORTED_EXTENSION'
  | 'TEMP_FILE';

export type CleanedPath =
  | { ok: true; relPath: string; fileName: string; ext: UploadExt }
  // relPath is the cleaned value, where there is one worth reporting
  | { ok: false; code: PathRejection; relPath?: string };

/** Longest raw value that is cleaned at all (four times the cleaned limit). */
const MAX_RAW_CHARS = LIMITS.maxRelPathChars * 4;

/** Control, format (zero width, direction override, soft hyphen, BOM) and line or paragraph separator characters. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

const DRIVE_LETTER = /^[A-Za-z]:/;

function hasLoneSurrogate(text: string): boolean {
  for (let i = 0; i < text.length; i++) {
    const unit = text.charCodeAt(i);
    if (unit >= 0xd800 && unit <= 0xdbff) {
      const next = text.charCodeAt(i + 1);
      if (!(next >= 0xdc00 && next <= 0xdfff)) return true;
      i += 1;
    } else if (unit >= 0xdc00 && unit <= 0xdfff) {
      return true;
    }
  }
  return false;
}

/**
 * Cleans the relative path that the browser announced: Unicode NFC, control
 * and invisible characters removed, separators unified, drive letter, empty
 * segments and `.` and `..` segments removed (dropped, never resolved), at most
 * 12 segments and 500 characters. The file name is the last segment, at most
 * 200 characters, with the extension docx or pdf. Anything else is a rejection
 * with a stable code, which the caller reports for that one file.
 *
 * Nothing is decoded: `%2e%2e` stays text and is harmless because the value is
 * only ever shown as text, never used as a path.
 */
export function cleanRelativePath(raw: unknown): CleanedPath {
  if (typeof raw !== 'string') return { ok: false, code: 'PATH_INVALID' };
  if (raw.length > MAX_RAW_CHARS) return { ok: false, code: 'PATH_TOO_LONG' };

  // A lone surrogate is no text: the database would store it as U+FFFD and the
  // path would no longer find itself again (announcing twice must be harmless)
  if (hasLoneSurrogate(raw)) return { ok: false, code: 'PATH_INVALID' };

  const text = raw.normalize('NFC').replace(INVISIBLE, '').replace(/\\/g, '/');
  const segments: string[] = [];
  text.split('/').forEach((part, index) => {
    let segment = part.trim();
    // A drive letter only counts at the very start of the path
    if (index === 0) segment = segment.replace(DRIVE_LETTER, '').trim();
    if (segment === '' || segment === '.' || segment === '..') return;
    segments.push(segment);
  });

  if (segments.length === 0) return { ok: false, code: 'PATH_EMPTY' };
  if (segments.length > LIMITS.maxPathSegments) {
    return { ok: false, code: 'PATH_TOO_DEEP' };
  }
  const relPath = segments.join('/');
  if (relPath.length > LIMITS.maxRelPathChars) {
    return { ok: false, code: 'PATH_TOO_LONG' };
  }

  const fileName = segments[segments.length - 1];
  if (fileName.length > LIMITS.maxFileNameChars) {
    return { ok: false, code: 'FILE_NAME_TOO_LONG', relPath };
  }
  if (fileName.startsWith('~$'))
    return { ok: false, code: 'TEMP_FILE', relPath };

  const dot = fileName.lastIndexOf('.');
  const ext = dot === -1 ? '' : fileName.slice(dot + 1).toLowerCase();
  if (!(EXTENSIONS as readonly string[]).includes(ext)) {
    return { ok: false, code: 'UNSUPPORTED_EXTENSION', relPath };
  }
  return { ok: true, relPath, fileName, ext: ext as UploadExt };
}

// ---------------------------------------------------------------------------
// Storage path in the staging bucket
// ---------------------------------------------------------------------------

const UUID = '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_ONLY = new RegExp(`^${UUID}$`);

function escapeRegex(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\/]/g, '\\$&');
}

/** The one pattern of a schema, built from withStoragePrefix (see the header). */
function storagePattern(schema: DbSchema): RegExp {
  const root = escapeRegex(withStoragePrefix('upload/', schema));
  return new RegExp(`^${root}(${UUID})/(${UUID})\\.(docx|pdf)$`);
}

/** `[preview/]upload/<run uuid>/`, the folder of one run. */
export function runStoragePrefix(
  runId: string,
  schema: DbSchema = DB_SCHEMA
): string {
  if (!UUID_ONLY.test(runId)) {
    throw new Error('The run id is not a lower case uuid');
  }
  return withStoragePrefix(`upload/${runId}/`, schema);
}

/**
 * The storage path of one file. Only two lower case uuids and one of the two
 * extensions go in, so the result cannot carry anything of a user.
 */
export function uploadStoragePath(
  runId: string,
  fileId: string,
  ext: UploadExt,
  schema: DbSchema = DB_SCHEMA
): string {
  if (!UUID_ONLY.test(fileId)) {
    throw new Error('The file id is not a lower case uuid');
  }
  if (!(EXTENSIONS as readonly string[]).includes(ext)) {
    throw new Error('The extension is not docx or pdf');
  }
  return `${runStoragePrefix(runId, schema)}${fileId}.${ext}`;
}

export type ParsedStoragePath = {
  runId: string;
  fileId: string;
  ext: UploadExt;
};

/** The parts of a staging path, or null if it is not exactly the form of the schema. */
export function parseUploadStoragePath(
  path: unknown,
  schema: DbSchema = DB_SCHEMA
): ParsedStoragePath | null {
  if (typeof path !== 'string') return null;
  const match = storagePattern(schema).exec(path);
  if (!match) return null;
  return { runId: match[1], fileId: match[2], ext: match[3] as UploadExt };
}

/** Whether `path` has the exact form and lies in the folder of the run. */
export function isStoragePathOfRun(
  path: unknown,
  runId: string,
  schema: DbSchema = DB_SCHEMA
): boolean {
  const parsed = parseUploadStoragePath(path, schema);
  return parsed !== null && parsed.runId === runId;
}
