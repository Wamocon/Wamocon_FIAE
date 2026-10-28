// Originals of enabler texts and of whole scenarios that go to the public document
// bucket (docs/ki-upload-konzept.md 8.5, entscheidung O2).
//
// Only two kinds of file may leave the private staging bucket: the original of an
// ENABLER TEXT (it holds no solution parts) and a WHOLE SCENARIO (decision of the owner
// of 29.10.2026: one file, solution approach and knowledge text included, trainees read
// all of it, like the scenario documents of FIAE). Quizzes, global quizzes and use
// cases hold solutions and stay in staging: a use case is split into a task and a
// private model solution. The person asks for each original by name when starting the
// dry run and the apply (a list of file ids), nothing is published by default. Before
// a file is taken on, this module reads it again and refuses it when
//
//   - it is neither (a Word file typed enabler or scenario, or a PDF that is the
//     original of an enabler text or of a scenario),
//   - the Word file has comments, tracked changes, text boxes or hidden text (the
//     guard only sees the text the parser reads, and these parts it does not), or
//     any feature that is more than a note; the PDF has any finding that is more than
//     a note (script, launch, embedded file, ...),
//   - a marker word of a solution, or a long solution text of a use case of the same plan,
//     stands in the text. A whole scenario may hold its own solution approach (its own
//     markers pass), but a quiz answer or a use case model solution in it stops the file.
//
// The refusal of one original never stops the run: the file stays in staging and the
// report names the reason. The copy to the bucket happens after the gate and before
// the transaction (the row needs the stored file), and a failed apply takes the
// copies out again.

import { createHash } from 'node:crypto';

import type { EnablerOriginal } from '@/lib/content-import/apply/types';
import { documentPublicUrl, documentStoragePath } from '@/lib/document-storage';
import { withStoragePrefix } from '@/lib/db-schema';
import { NON_SCENARIO_MARKERS, leakOf } from '@/lib/content-import/apply/guard';
import { hasSolutionMarker } from '@/lib/content-upload/patterns';
import { readDocx } from '@/lib/content-upload/read-docx';
import { readPdf } from '@/lib/content-upload/read-pdf';
import type {
  OriginalKind,
  OriginalPlan,
  OriginalRefusal,
  TransferFile,
} from '@/lib/content-upload/transfer/types';

const DOCX_MIME =
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const PDF_MIME = 'application/pdf';

/** Features of a Word file that keep the original out of the public bucket. */
const REFUSED_DOCX_CODES = new Set([
  'COMMENTS',
  'NOTES',
  'TRACKED_CHANGES',
  'TEXT_BOXES',
  'HIDDEN_TEXT',
]);

export type OriginalCheck =
  | { ok: true; pageCount: number | null }
  | { ok: false; code: string; reason: string };

const refuse = (code: string, reason: string): OriginalCheck => ({
  ok: false,
  code,
  reason,
});

/**
 * Reads the bytes of an original and decides whether it may be published.
 * `solutions` are the long solution texts of the plan (use case solutions),
 * searched in the text of an enabler text. A whole scenario is checked for what
 * hides in the file only: its solution approach is no secret. Never throws.
 */
export async function checkOriginalBytes(
  ext: 'docx' | 'pdf',
  bytes: Uint8Array,
  solutions: readonly string[],
  kind: OriginalKind = 'enabler'
): Promise<OriginalCheck> {
  let text: string;
  let pageCount: number | null = null;
  if (ext === 'docx') {
    const read = await readDocx(bytes);
    if (read.status !== 'ok') {
      return refuse(
        'ORIGINAL_UNREADABLE',
        'The Word file could not be read again.'
      );
    }
    const features = read.findings.filter(
      f => f.severity !== 'info' || REFUSED_DOCX_CODES.has(f.code)
    );
    if (features.length > 0) {
      return refuse(
        'ORIGINAL_FEATURES',
        'The Word file has comments, tracked changes, text boxes, hidden text or embedded parts.'
      );
    }
    text = read.paragraphs.map(p => p.text).join('\n');
  } else {
    const read = await readPdf(bytes);
    if (read.status !== 'ok') {
      return refuse('ORIGINAL_UNREADABLE', 'The PDF could not be read again.');
    }
    if (read.findings.some(f => f.severity !== 'info')) {
      return refuse(
        'ORIGINAL_FEATURES',
        'The PDF holds a script, an action or an embedded file.'
      );
    }
    text = read.text;
    pageCount = read.pageCount;
  }
  if (kind === 'scenario') {
    // A whole scenario holds its solution approach on purpose, so its own markers and its own
    // texts pass. What never belongs to a scenario still stops the file: the answers of a quiz,
    // the model solution of a use case and the long solution texts of the use cases of the plan.
    // A file typed as a scenario by mistake (a quiz, a use case) does not reach the bucket.
    const leak = leakOf(text, solutions, { markers: NON_SCENARIO_MARKERS });
    if (leak) {
      return leak === 'contains a solution text'
        ? refuse(
            'SOLUTION_TEXT',
            'The text holds a solution text of this transfer.'
          )
        : refuse(
            'SOLUTION_MARKER',
            'The text shows a quiz answer or the model solution of a use case.'
          );
    }
    return { ok: true, pageCount };
  }
  if (hasSolutionMarker(text)) {
    return refuse(
      'SOLUTION_MARKER',
      'The text shows a marker word of a solution.'
    );
  }
  if (leakOf(text, solutions)) {
    return refuse(
      'SOLUTION_TEXT',
      'The text holds a solution text of this transfer.'
    );
  }
  return { ok: true, pageCount };
}

/**
 * What a file is the original of, and at which enabler: the teaching text or the whole
 * scenario. Null when it is neither (a quiz, a use case, a file that is not accepted).
 * A use case never is, in no format: its task and its model solution stay apart.
 */
export function originalOf(
  file: TransferFile
): { kind: OriginalKind; enablerCode: string } | null {
  const d = file.decision;
  if (d.action !== 'accept' || !d.enablerCode) return null;
  if (file.ext === 'docx') {
    if (d.docType === 'enabler') {
      return { kind: 'enabler', enablerCode: d.enablerCode };
    }
    if (d.docType === 'scenario') {
      return { kind: 'scenario', enablerCode: d.enablerCode };
    }
  }
  if (d.docType === 'pdf_original' && file.ext === 'pdf') {
    const key = file.dupKey ?? '';
    if (key.startsWith('pdf:enabler:')) {
      return { kind: 'enabler', enablerCode: d.enablerCode };
    }
    if (key.startsWith('pdf:scenario:')) {
      return { kind: 'scenario', enablerCode: d.enablerCode };
    }
  }
  return null;
}

/** The enabler text a file is the original of, or null when it is no such file. */
export function enablerOfOriginal(file: TransferFile): string | null {
  const original = originalOf(file);
  return original?.kind === 'enabler' ? original.enablerCode : null;
}

export interface EvaluateOriginalsInput {
  /** File ids the person asked to publish. */
  requested: readonly string[];
  files: readonly TransferFile[];
  readBytes: (file: TransferFile) => Promise<Uint8Array | null>;
  /**
   * Long solution texts of the plans: the use case solutions (not the rationales, a
   * Lehrtext may repeat them, and not the scenarios, which are public).
   */
  solutions: readonly string[];
  /**
   * Solution parts of the scenarios of the plan. Only a teaching text must not repeat them, the
   * whole scenario shows its own. Optional: a caller without a plan of scenarios names none.
   */
  scenarioSolutions?: readonly string[];
  /**
   * Files that became an item of the plan. A Word file that the plan left out (an
   * unresolved duplicate, a file the planner skipped) is not published either: its
   * text did not pass the plan.
   */
  plannedFileIds: ReadonlySet<string>;
}

/** Decides every requested original. The answer is the same for the same files. */
export async function evaluateOriginals(
  input: EvaluateOriginalsInput
): Promise<{ plans: OriginalPlan[]; refused: OriginalRefusal[] }> {
  const byId = new Map(input.files.map(f => [f.id, f]));
  const plans: OriginalPlan[] = [];
  const refused: OriginalRefusal[] = [];
  const taken = new Set<string>();
  for (const id of [...new Set(input.requested)].sort()) {
    const file = byId.get(id);
    if (!file) {
      refused.push({
        fileId: id,
        code: 'FILE_NOT_FOUND',
        reason: 'The file is not part of this run.',
      });
      continue;
    }
    const found = originalOf(file);
    const enablerCode = found?.enablerCode ?? null;
    const kind = found?.kind ?? 'enabler';
    // only a Word file or a PDF can be an original (a JSON or Excel file never is)
    const ext = file.ext === 'docx' || file.ext === 'pdf' ? file.ext : null;
    if (!enablerCode || !ext) {
      refused.push({
        fileId: id,
        code: 'NOT_AN_ENABLER_TEXT',
        reason:
          'Only the original of an accepted enabler text or a whole scenario may go to the public bucket.',
      });
      continue;
    }
    if (file.decision.dupChoice === 'skip' || file.objectDeleted) {
      refused.push({
        fileId: id,
        code: 'FILE_NOT_USABLE',
        reason: 'The file was skipped or is no longer in the staging bucket.',
      });
      continue;
    }
    if (ext === 'docx' && !input.plannedFileIds.has(file.id)) {
      refused.push({
        fileId: id,
        code: 'NOT_IN_PLAN',
        reason: 'The file did not become an item of the plan.',
      });
      continue;
    }
    const slot = `${kind}:${enablerCode}:${ext}`;
    if (taken.has(slot)) {
      refused.push({
        fileId: id,
        code: 'DUPLICATE_ORIGINAL',
        reason: 'Another original of this enabler and format was chosen.',
      });
      continue;
    }
    let bytes: Uint8Array | null;
    try {
      bytes = await input.readBytes(file);
    } catch {
      bytes = null;
    }
    if (!bytes) {
      refused.push({
        fileId: id,
        code: 'FILE_NOT_USABLE',
        reason: 'The file could not be read from the staging bucket.',
      });
      continue;
    }
    const check = await checkOriginalBytes(
      ext,
      bytes,
      kind === 'scenario'
        ? input.solutions
        : [...input.solutions, ...(input.scenarioSolutions ?? [])],
      kind
    );
    if (!check.ok) {
      refused.push({ fileId: id, code: check.code, reason: check.reason });
      continue;
    }
    taken.add(slot);
    plans.push({
      fileId: id,
      sha256: file.sha256,
      enablerCode,
      ext,
      ...(kind === 'scenario' ? { kind } : {}),
      sizeBytes: file.sizeBytes,
      pageCount: check.pageCount,
    });
  }
  return { plans, refused };
}

/**
 * Title of the document row of an original. The title is the key of the row, so it is the
 * title the PDF import writes for the same file (documents/engine.ts KIND_ROWS): both ways
 * meet one row and never write two. A whole scenario as a Word file has a title of its own.
 */
export function originalTitle(
  enablerCode: string,
  ext: 'docx' | 'pdf',
  kind: OriginalKind = 'enabler'
) {
  if (kind === 'scenario') {
    return `Szenario ${enablerCode} (${ext === 'pdf' ? 'PDF' : 'Word'})`;
  }
  return `Enabler ${enablerCode}: Lehrtext (Original ${ext === 'pdf' ? 'PDF' : 'Word'})`;
}

/** The exercise document of a scenario stands behind the teaching texts (as in the PDF import). */
const SCENARIO_ORDER_INDEX = 100;

const SAFE_NAME = /[^A-Za-z0-9._-]/g;

/**
 * Path of the copy in the bucket `content`, in the one form the delete route of
 * documents accepts: [preview/]<id of the person who applies>/<timestamp>_<name>.
 * Null when the owner id or the name do not give a valid path.
 */
export function originalStoragePath(
  ownerId: string,
  plan: Pick<OriginalPlan, 'enablerCode' | 'ext' | 'kind'>,
  timestamp: number
): string | null {
  const part = plan.kind === 'scenario' ? 'szenario' : 'lehrtext';
  const name = `${plan.enablerCode.replace(SAFE_NAME, '_')}_${part}.${plan.ext}`;
  const path = withStoragePrefix(`${ownerId}/${timestamp}_${name}`);
  return documentStoragePath(path, ownerId) === path ? path : null;
}

/**
 * The engine input for the originals, each with the plan it comes from.
 * `timestamp` 0 is a dry run: the path is only a stand-in, nothing is stored.
 */
export function toEnablerOriginals(
  plans: readonly OriginalPlan[],
  ownerId: string,
  timestamp: number
): Array<{ plan: OriginalPlan; original: EnablerOriginal }> {
  const out: Array<{ plan: OriginalPlan; original: EnablerOriginal }> = [];
  for (const plan of plans) {
    const path = originalStoragePath(ownerId, plan, timestamp);
    if (!path) continue;
    const scenario = plan.kind === 'scenario';
    out.push({
      plan,
      original: {
        enablerCode: plan.enablerCode,
        documentType: scenario ? 'EXERCISE' : 'THEORY',
        orderIndex: scenario ? SCENARIO_ORDER_INDEX : 0,
        title: originalTitle(plan.enablerCode, plan.ext, plan.kind),
        fileName: path.slice(path.lastIndexOf('/') + 1),
        fileSize: plan.sizeBytes,
        mimeType: plan.ext === 'pdf' ? PDF_MIME : DOCX_MIME,
        storageUrl: documentPublicUrl(path),
        storagePath: path,
        pageCount: plan.pageCount,
      },
    });
  }
  return out;
}

/** The public bucket as far as the transfer touches it. */
export interface ContentBucketPort {
  /** Stores an object. Never replaces one (an existing path is an error). */
  put(path: string, bytes: Uint8Array, contentType: string): Promise<void>;
  /** Removes objects. A path that does not exist is not an error. */
  remove(paths: readonly string[]): Promise<void>;
}

export class OriginalsError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.name = 'OriginalsError';
    this.code = code;
  }
}

const sha256Of = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

/**
 * Copies the originals from staging to the document bucket. Every object is
 * read again and its hash compared with the one of the file row (the staging
 * object cannot be replaced, so a difference is an error, not a race). On any
 * error the copies made so far are removed and the error is thrown.
 */
export async function copyOriginals(
  port: ContentBucketPort,
  items: ReadonlyArray<{
    file: TransferFile;
    original: EnablerOriginal;
  }>,
  readBytes: (file: TransferFile) => Promise<Uint8Array | null>,
  options: { deadline?: number } = {}
): Promise<string[]> {
  const stored: string[] = [];
  try {
    for (const { file, original } of items) {
      if (options.deadline !== undefined && Date.now() > options.deadline) {
        throw new OriginalsError(
          'COPY_TIMEOUT',
          'The originals could not be copied in the time that is left.'
        );
      }
      const bytes = await readBytes(file);
      if (!bytes) {
        throw new OriginalsError('ORIGINAL_MISSING', 'A staging file is gone.');
      }
      if (sha256Of(bytes) !== file.sha256) {
        throw new OriginalsError(
          'ORIGINAL_HASH',
          'A staging file does not match its hash.'
        );
      }
      await port.put(original.storagePath, bytes, original.mimeType);
      stored.push(original.storagePath);
    }
  } catch (error) {
    await port.remove(stored).catch(() => undefined);
    throw error;
  }
  return stored;
}
