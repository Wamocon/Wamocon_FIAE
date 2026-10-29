// The steps of the submission file, independent of the routes (they check who may ask).
//
//   announce   the browser says name, size and type; the server answers with a signed
//              upload url for a path in `incoming/` (an older, unchecked upload of the
//              same use case is removed first)
//   complete   after the browser has uploaded: the server reads the object, checks size
//              and bytes, and only then moves it to `file/`, where a reader can find it.
//              The file that was there before is removed, so there is always one file.
//   get        the newest file of the folder, with a short lived link on request
//   remove     the file and any unchecked upload
//
// A failed check removes the object at once.

import {
  MAX_SUBMISSION_FILE_BYTES,
  SIGNED_READ_SECONDS,
  SUBMISSION_BUCKET,
  checkAnnouncedFile,
  fileFolder,
  filePath,
  incomingFolder,
  incomingPath,
  matchesSignature,
  parseSubmissionPath,
  parseUploadId,
  sanitizeFileName,
  signatureRejectionCode,
  submissionFolder,
  type SubmissionScope,
} from '@/lib/submission-file/rules';
import type { SubmissionFileStorage } from '@/lib/submission-file/storage';
import { DB_SCHEMA, type DbSchema } from '@/lib/db-schema';

export type ServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; status: number; code: string };

const ok = <T>(value: T): ServiceResult<T> => ({ ok: true, value });
const fail = (status: number, code: string): ServiceResult<never> => ({
  ok: false,
  status,
  code,
});

export interface SubmissionFileDeps {
  storage: SubmissionFileStorage;
  schema?: DbSchema;
  now?: () => number;
  newId?: () => string;
}

const clock = (deps: SubmissionFileDeps) => (deps.now ?? Date.now)();
const schemaOf = (deps: SubmissionFileDeps) => deps.schema ?? DB_SCHEMA;

function folderOf(deps: SubmissionFileDeps, scope: SubmissionScope) {
  return submissionFolder(scope, schemaOf(deps));
}

/** Names inside `file/` that belong to the exact form, newest first. */
async function filesOf(
  deps: SubmissionFileDeps,
  folder: string
): Promise<
  Array<{
    path: string;
    fileName: string;
    uploadedAt: number;
    size: number | null;
  }>
> {
  const objects = await deps.storage.list(fileFolder(folder));
  const rows = [];
  for (const object of objects) {
    const path = `${fileFolder(folder)}/${object.name}`;
    const parsed = parseSubmissionPath(path, schemaOf(deps));
    if (parsed?.kind !== 'file') continue;
    rows.push({
      path,
      fileName: parsed.fileName,
      uploadedAt: parsed.uploadedAt,
      size: object.size,
    });
  }
  return rows.sort((a, b) => b.uploadedAt - a.uploadedAt);
}

/** Names inside `incoming/` that belong to the exact form. */
async function waitingOf(
  deps: SubmissionFileDeps,
  folder: string
): Promise<Array<{ path: string; name: string; size: number | null }>> {
  const objects = await deps.storage.list(incomingFolder(folder));
  return objects
    .map(object => ({
      path: incomingPath(folder, object.name),
      name: object.name,
      size: object.size,
    }))
    .filter(
      object =>
        parseSubmissionPath(object.path, schemaOf(deps))?.kind === 'incoming'
    );
}

export interface AnnounceValue {
  bucket: string;
  uploadId: string;
  /** Path and token for uploadToSignedUrl of the storage client of the browser. */
  path: string;
  token: string;
  fileName: string;
  contentType: string;
  maxBytes: number;
}

export async function announceUpload(
  deps: SubmissionFileDeps,
  scope: SubmissionScope,
  input: { fileName?: unknown; size?: unknown; contentType?: unknown }
): Promise<ServiceResult<AnnounceValue>> {
  const checked = checkAnnouncedFile(input);
  if (!checked.ok) {
    return fail(checked.code === 'TOO_LARGE' ? 413 : 400, checked.code);
  }
  const folder = folderOf(deps, scope);
  if (!folder) return fail(400, 'INVALID_SCOPE');

  // An upload that was never completed is of no use any more
  const stale = await waitingOf(deps, folder);
  await deps.storage.remove(stale.map(object => object.path));

  const uploadId = `${(deps.newId ?? (() => crypto.randomUUID()))()}.${checked.file.ext}`;
  const path = incomingPath(folder, uploadId);
  const signed = await deps.storage.createSignedUploadUrl(path);
  if (!signed.ok) return fail(503, 'UPLOAD_URL_FAILED');
  return ok({
    bucket: SUBMISSION_BUCKET,
    uploadId,
    path,
    token: signed.token,
    fileName: checked.file.fileName,
    contentType: checked.file.contentType,
    maxBytes: MAX_SUBMISSION_FILE_BYTES,
  });
}

export interface StoredFile {
  fileName: string;
  size: number | null;
  uploadedAt: string;
}

export async function completeUpload(
  deps: SubmissionFileDeps,
  scope: SubmissionScope,
  input: { uploadId?: unknown; fileName?: unknown }
): Promise<ServiceResult<StoredFile>> {
  const upload = parseUploadId(input.uploadId);
  if (!upload) return fail(400, 'INVALID_UPLOAD');
  const folder = folderOf(deps, scope);
  if (!folder) return fail(400, 'INVALID_SCOPE');

  const uploadId = `${upload.uuid}.${upload.ext}`;
  const path = incomingPath(folder, uploadId);
  const waiting = (await waitingOf(deps, folder)).find(
    object => object.name === uploadId
  );
  if (!waiting) return fail(409, 'NOT_UPLOADED');

  const reject = async (status: number, code: string) => {
    await deps.storage.remove([path]);
    return fail(status, code);
  };
  if (waiting.size === 0) return reject(400, 'EMPTY_FILE');
  // fail closed: a size that the storage does not report is not a size within the limit
  if (waiting.size === null) return reject(400, 'EMPTY_FILE');
  if (waiting.size > MAX_SUBMISSION_FILE_BYTES) return reject(413, 'TOO_LARGE');
  const bytes = await deps.storage.download(path);
  if (!bytes) return fail(409, 'NOT_UPLOADED');
  if (bytes.length === 0) return reject(400, 'EMPTY_FILE');
  if (bytes.length > MAX_SUBMISSION_FILE_BYTES) return reject(413, 'TOO_LARGE');
  if (!matchesSignature(upload.ext, bytes)) {
    return reject(422, signatureRejectionCode(upload.ext));
  }

  const uploadedAt = clock(deps);
  const fileName = sanitizeFileName(
    typeof input.fileName === 'string' ? input.fileName : '',
    upload.ext
  );
  const target = filePath(folder, uploadedAt, fileName);
  await deps.storage.move(path, target);
  // one file per submission: everything but the new file goes. The list is read after
  // the move, so a second upload that finished at the same time is cleaned up as well
  const others = (await filesOf(deps, folder)).filter(
    file => file.path !== target
  );
  await deps.storage.remove(others.map(file => file.path));
  return ok({
    fileName,
    size: bytes.length,
    uploadedAt: new Date(uploadedAt).toISOString(),
  });
}

export interface FileInfo extends StoredFile {
  /** A read link that works for SIGNED_READ_SECONDS, only when asked for. */
  url?: string;
}

export async function getFile(
  deps: SubmissionFileDeps,
  scope: SubmissionScope,
  options: { withLink?: boolean } = {}
): Promise<ServiceResult<FileInfo | null>> {
  const folder = folderOf(deps, scope);
  if (!folder) return fail(400, 'INVALID_SCOPE');
  const [newest] = await filesOf(deps, folder);
  if (!newest) return ok(null);
  const info: FileInfo = {
    fileName: newest.fileName,
    size: newest.size,
    uploadedAt: new Date(newest.uploadedAt).toISOString(),
  };
  if (options.withLink) {
    const url = await deps.storage.createSignedUrl(
      newest.path,
      SIGNED_READ_SECONDS,
      newest.fileName
    );
    if (!url) return ok(null);
    info.url = url;
  }
  return ok(info);
}

export async function removeFile(
  deps: SubmissionFileDeps,
  scope: SubmissionScope
): Promise<ServiceResult<number>> {
  const folder = folderOf(deps, scope);
  if (!folder) return fail(400, 'INVALID_SCOPE');
  const files = await filesOf(deps, folder);
  const waiting = await waitingOf(deps, folder);
  const paths = [
    ...files.map(file => file.path),
    ...waiting.map(object => object.path),
  ];
  await deps.storage.remove(paths);
  return ok(paths.length);
}
