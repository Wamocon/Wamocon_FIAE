// Rules for the optional file of a use case submission (Jira WMCNL-2810, step 3.7).
//
// A trainee may attach ONE file to the submission of a use case. The file lies in the
// PRIVATE bucket `submission-files` (created by the owner, no policy for the API roles,
// only the server reads and writes it with the secret key). What the client decides is
// the content of the file and its display name, nothing else:
//
//  - the storage path is built on the server from three ids it knows itself
//    (organization of the session, the session user, the use case that passed the
//    catalog check) and a timestamp. A path from the client does not exist.
//  - the name is cleaned to ASCII, the extension is one of the allowed ones, dots inside
//    the name become underscores (no hidden second extension like report.exe.pdf).
//  - the type is checked twice: the announced extension and size before the upload, the
//    bytes (signature) after the upload, before the file becomes visible for anyone.
//
// Paths (one form per schema, checked on the raw string, never decoded):
//
//   Production / local:  <org>/<trainee>/<use case>/incoming/<uuid>.<ext>
//                        <org>/<trainee>/<use case>/file/<timestamp>_<name>
//   Preview:             the same under preview/
//
// `incoming` holds a file that was uploaded but not yet checked. Only `file` is ever
// read, so an unchecked object can not be reached by anyone. The signature check works
// on the whole file (at most 10 MB), a zip based format is looked at inside.

import { DB_SCHEMA, withStoragePrefix, type DbSchema } from '@/lib/db-schema';

export const SUBMISSION_BUCKET = 'submission-files';

export const MEGABYTE = 1024 * 1024;
export const MAX_SUBMISSION_FILE_BYTES = 10 * MEGABYTE;

/** How long the link for the reader works. */
export const SIGNED_READ_SECONDS = 120;

export type SubmissionExt = 'pdf' | 'docx' | 'xlsx' | 'png' | 'jpg';

export const SUBMISSION_EXTENSIONS: readonly SubmissionExt[] = [
  'pdf',
  'docx',
  'xlsx',
  'png',
  'jpg',
];

const MIME: Record<SubmissionExt, string> = {
  pdf: 'application/pdf',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  png: 'image/png',
  jpg: 'image/jpeg',
};

/** The MIME type the browser has to send for an extension. */
export const mimeOf = (ext: SubmissionExt): string => MIME[ext];

/** What the owner sets on the private bucket (a bucket is created by hand). */
export const SUBMISSION_BUCKET_SETTINGS = {
  name: SUBMISSION_BUCKET,
  public: false,
  fileSizeLimit: MAX_SUBMISSION_FILE_BYTES,
  allowedMimeTypes: SUBMISSION_EXTENSIONS.map(ext => MIME[ext]),
} as const;

export type SubmissionRejection =
  | 'FILE_NAME_INVALID'
  | 'UNSUPPORTED_TYPE'
  | 'TYPE_MISMATCH'
  | 'EMPTY_FILE'
  | 'TOO_LARGE';

// ---------------------------------------------------------------------------
// The name
// ---------------------------------------------------------------------------

const FOLD: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  Ä: 'Ae',
  Ö: 'Oe',
  Ü: 'Ue',
  ß: 'ss',
};

const MAX_RAW_NAME = 255;
const MAX_BASE_CHARS = 80;
/** Control, format (zero width, direction override, soft hyphen, BOM) and separator characters. */
const INVISIBLE = /[\p{Cc}\p{Cf}\p{Zl}\p{Zp}]/gu;

/** The extension of a file name, lower case, `jpeg` counted as `jpg`; null if it is not an allowed one. */
export function extensionOf(fileName: string): SubmissionExt | null {
  const dot = fileName.lastIndexOf('.');
  if (dot < 0) return null;
  const raw = fileName.slice(dot + 1).toLowerCase();
  const ext = raw === 'jpeg' ? 'jpg' : raw;
  return (SUBMISSION_EXTENSIONS as readonly string[]).includes(ext)
    ? (ext as SubmissionExt)
    : null;
}

/**
 * The file name that is stored and shown: only the last part of a path, ASCII letters,
 * digits, underscore and hyphen in the base (at most 80 characters), `.` and the
 * normalized extension. Umlauts are written out (ä becomes ae). Never empty.
 */
export function sanitizeFileName(raw: string, ext: SubmissionExt): string {
  const last = raw.replace(/\\/g, '/').split('/').pop() ?? '';
  const withoutExt = last.replace(/\.[A-Za-z0-9]{1,8}$/, '');
  const folded = withoutExt
    .normalize('NFC')
    .replace(INVISIBLE, '')
    .replace(/[äöüÄÖÜß]/g, ch => FOLD[ch])
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '');
  const base = folded
    .replace(/[^A-Za-z0-9_-]+/g, '_')
    .replace(/_{2,}/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, MAX_BASE_CHARS)
    .replace(/[_-]+$/g, '');
  return `${base || 'abgabe'}.${ext}`;
}

// ---------------------------------------------------------------------------
// The announcement (before the upload)
// ---------------------------------------------------------------------------

export type AnnouncedFile = {
  ext: SubmissionExt;
  /** The cleaned display name with the extension. */
  fileName: string;
  size: number;
  contentType: string;
};

export type AnnounceCheck =
  | { ok: true; file: AnnouncedFile }
  | { ok: false; code: SubmissionRejection };

/**
 * Checks what the browser announces: name, size and MIME type. The MIME type is the one
 * the browser sends (it is only a hint, the bytes are checked after the upload), a
 * missing one is replaced by the type of the extension.
 */
export function checkAnnouncedFile(input: {
  fileName?: unknown;
  size?: unknown;
  contentType?: unknown;
}): AnnounceCheck {
  const { fileName, size, contentType } = input;
  if (
    typeof fileName !== 'string' ||
    fileName.trim() === '' ||
    fileName.length > MAX_RAW_NAME
  ) {
    return { ok: false, code: 'FILE_NAME_INVALID' };
  }
  const ext = extensionOf(fileName.trim());
  if (!ext) return { ok: false, code: 'UNSUPPORTED_TYPE' };
  if (typeof size !== 'number' || !Number.isInteger(size) || size < 1) {
    return { ok: false, code: 'EMPTY_FILE' };
  }
  if (size > MAX_SUBMISSION_FILE_BYTES) return { ok: false, code: 'TOO_LARGE' };
  const type =
    typeof contentType === 'string' && contentType.trim() !== ''
      ? contentType.trim().toLowerCase()
      : MIME[ext];
  if (type !== MIME[ext]) return { ok: false, code: 'TYPE_MISMATCH' };
  return {
    ok: true,
    file: {
      ext,
      fileName: sanitizeFileName(fileName.trim(), ext),
      size,
      contentType: type,
    },
  };
}

// ---------------------------------------------------------------------------
// The bytes (after the upload)
// ---------------------------------------------------------------------------

const PDF = [0x25, 0x50, 0x44, 0x46, 0x2d];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPG = [0xff, 0xd8, 0xff];
const ZIP = [0x50, 0x4b, 0x03, 0x04];

const startsWith = (bytes: Uint8Array, magic: readonly number[]) =>
  bytes.length >= magic.length && magic.every((b, i) => bytes[i] === b);

const contains = (bytes: Uint8Array, text: string) =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).includes(text);

/**
 * Whether the bytes are what the extension says. pdf, png and jpg by their signature,
 * docx and xlsx are zip files that hold the main part of their format (word/document.xml
 * or xl/workbook.xml) and the content types file; a document with a macro part
 * (vbaProject.bin), embedded objects or ActiveX parts is refused.
 */
export function matchesSignature(
  ext: SubmissionExt,
  bytes: Uint8Array
): boolean {
  switch (ext) {
    case 'pdf':
      return startsWith(bytes, PDF);
    case 'png':
      return startsWith(bytes, PNG);
    case 'jpg':
      return startsWith(bytes, JPG);
    case 'docx':
    case 'xlsx': {
      if (!startsWith(bytes, ZIP)) return false;
      // The names of the entries of a zip are stored uncompressed (local header and
      // central directory), so they can be searched in the bytes. The main part of the
      // format has to be there. Macros, embedded objects and ActiveX parts are refused:
      // they run or load something when the trainer opens the file.
      const main = ext === 'docx' ? 'word/document.xml' : 'xl/workbook.xml';
      return (
        contains(bytes, '[Content_Types].xml') &&
        contains(bytes, main) &&
        !contains(bytes, 'vbaProject.bin') &&
        !contains(bytes, '/embeddings/') &&
        !contains(bytes, '/activeX/')
      );
    }
  }
}

export type SignatureRejection =
  | 'NOT_A_PDF'
  | 'NOT_A_DOCX'
  | 'NOT_AN_XLSX'
  | 'NOT_A_PNG'
  | 'NOT_A_JPG';

export function signatureRejectionCode(ext: SubmissionExt): SignatureRejection {
  switch (ext) {
    case 'pdf':
      return 'NOT_A_PDF';
    case 'docx':
      return 'NOT_A_DOCX';
    case 'xlsx':
      return 'NOT_AN_XLSX';
    case 'png':
      return 'NOT_A_PNG';
    case 'jpg':
      return 'NOT_A_JPG';
  }
}

// ---------------------------------------------------------------------------
// The paths
// ---------------------------------------------------------------------------

export type SubmissionScope = {
  organizationId: string;
  traineeId: string;
  useCaseId: string;
};

/** `<org>/<trainee>/<use case>` with the prefix of the schema; null if an id is no uuid. */
export function submissionFolder(
  scope: SubmissionScope,
  schema: DbSchema = DB_SCHEMA
): string | null {
  const { organizationId, traineeId, useCaseId } = scope;
  if (![organizationId, traineeId, useCaseId].every(id => UUID_ONLY.test(id))) {
    return null;
  }
  return withStoragePrefix(
    `${organizationId.toLowerCase()}/${traineeId.toLowerCase()}/${useCaseId.toLowerCase()}`,
    schema
  );
}

const UUID_PART =
  '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}';
const UUID_ONLY = new RegExp(`^${UUID_PART}$`, 'i');
const EXT_PART = SUBMISSION_EXTENSIONS.join('|');
const NAME_PART = '[A-Za-z0-9_-]{1,80}\\.(?:' + EXT_PART + ')';

const patterns = (schema: DbSchema) => {
  const prefix = schema === 'public_preview' ? 'preview/' : '';
  const folder = `${prefix}(${UUID_PART})/(${UUID_PART})/(${UUID_PART})`;
  return {
    incoming: new RegExp(`^${folder}/incoming/(${UUID_PART})\\.(${EXT_PART})$`),
    file: new RegExp(`^${folder}/file/(\\d{10,16})_(${NAME_PART})$`),
    incomingFolder: new RegExp(`^${folder}/incoming$`),
    fileFolder: new RegExp(`^${folder}/file$`),
    traineeFolder: new RegExp(`^${prefix}(${UUID_PART})/(${UUID_PART})$`),
  };
};

export type ParsedPath =
  | {
      kind: 'incoming';
      scope: SubmissionScope;
      uploadId: string;
      ext: SubmissionExt;
    }
  | {
      kind: 'file';
      scope: SubmissionScope;
      uploadedAt: number;
      fileName: string;
    };

const scopeOf = (m: RegExpExecArray): SubmissionScope => ({
  organizationId: m[1],
  traineeId: m[2],
  useCaseId: m[3],
});

/** The parts of a storage path of an object, or null if it is not exactly one of the two forms. */
export function parseSubmissionPath(
  path: string,
  schema: DbSchema = DB_SCHEMA
): ParsedPath | null {
  if (typeof path !== 'string') return null;
  const p = patterns(schema);
  const incoming = p.incoming.exec(path);
  if (incoming) {
    return {
      kind: 'incoming',
      scope: scopeOf(incoming),
      uploadId: `${incoming[4]}.${incoming[5]}`,
      ext: incoming[5] as SubmissionExt,
    };
  }
  const file = p.file.exec(path);
  if (file) {
    return {
      kind: 'file',
      scope: scopeOf(file),
      uploadedAt: Number(file[4]),
      fileName: file[5],
    };
  }
  return null;
}

/** Whether `path` is exactly the folder `…/incoming` or `…/file` of a scope. */
export function isSubmissionFolder(
  path: string,
  schema: DbSchema = DB_SCHEMA
): boolean {
  const p = patterns(schema);
  return p.incomingFolder.test(path) || p.fileFolder.test(path);
}

/**
 * The folder of one trainee, `<org>/<trainee>` with the prefix of the schema, or null if
 * an id is no uuid. It holds one sub folder per use case.
 */
export function traineeFolder(
  organizationId: string,
  traineeId: string,
  schema: DbSchema = DB_SCHEMA
): string | null {
  if (![organizationId, traineeId].every(id => UUID_ONLY.test(id))) return null;
  return withStoragePrefix(
    `${organizationId.toLowerCase()}/${traineeId.toLowerCase()}`,
    schema
  );
}

/** Whether `path` is exactly the folder `<org>/<trainee>` (with the prefix of the schema). */
export function isTraineeFolder(
  path: string,
  schema: DbSchema = DB_SCHEMA
): boolean {
  return patterns(schema).traineeFolder.test(path);
}

const UUID_LOWER = new RegExp(`^${UUID_PART}$`);

/** Whether `name` is the name of an organization, trainee or use case folder (a uuid in lower case). */
export const isUuidFolderName = (name: string): boolean =>
  UUID_LOWER.test(name);

/** The id of an upload as the browser gets it back: `<uuid>.<ext>`. */
export function parseUploadId(
  value: unknown
): { uuid: string; ext: SubmissionExt } | null {
  if (typeof value !== 'string') return null;
  const m = new RegExp(`^(${UUID_PART})\\.(${EXT_PART})$`).exec(value);
  return m ? { uuid: m[1], ext: m[2] as SubmissionExt } : null;
}

export const incomingPath = (folder: string, uploadId: string) =>
  `${folder}/incoming/${uploadId}`;
export const incomingFolder = (folder: string) => `${folder}/incoming`;
export const fileFolder = (folder: string) => `${folder}/file`;
export const filePath = (
  folder: string,
  uploadedAt: number,
  fileName: string
) => `${folder}/file/${uploadedAt}_${fileName}`;
