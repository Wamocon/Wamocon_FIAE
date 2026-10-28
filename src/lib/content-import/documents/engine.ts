// The PDF import against a database and a storage: finds the enabler and the use case of
// every planned file, copies the file into the storage and writes the row of content_documents.
//
// The rows are the ones FIAE has for the same kind of document (docs of the owner, checked
// against the FIAE code and data):
//
//   enabler PDF    THEORY            ALL           at the enabler, public bucket
//   scenario PDF   EXERCISE          ALL           at the enabler, public bucket (the reader of the enabler
//                                                   page lists EXERCISE as the scenario part)
//   task PDF       TRAINEE_QUESTION  ALL           at the use case, public bucket
//   solution PDF   TRAINER_SOLUTION  TRAINER_ONLY  at the use case, PRIVATE bucket (see storage.ts)
//
// Rules:
//  - idempotent: a row is found by its parent (enabler or use case), its document type and its
//    title. A row that exists is left as it is and its file is not copied again. A second run
//    writes nothing. Files are never replaced unless the switch overwriteFiles is set, and then
//    only the file of a row that points to exactly the path of this import.
//  - the files are copied first, the rows are written second. A failure of a copy or of the
//    rows takes the copies of this run out again (never a file that existed before). The
//    caller (job.ts) rolls the transaction back.
//  - a dry run and a check never touch the storage.
//  - the content of a file is never read here except to compare its hash with the plan.

import { createHash } from 'node:crypto';

import { ImportAbort } from '../apply/db';
import type { Db, Row } from '../apply/db';
import type { Conflict, TableCount } from '../apply/types';
import {
  bucketOf,
  privateReference,
  publicObjectUrl,
  storagePathFor,
  type StorageAdapter,
} from './storage';
import type { DocumentPlan, DocumentTarget, PdfKind, PlanItem } from './types';

interface KindRow {
  documentType: string;
  visibility: string;
  parent: 'enabler' | 'use_case';
  orderIndex: number;
  title: (code: string) => string;
}

/** The rows of the four kinds. The titles are fixed: they are the key of a row. */
export const KIND_ROWS: Record<PdfKind, KindRow> = {
  enabler: {
    documentType: 'THEORY',
    visibility: 'ALL',
    parent: 'enabler',
    orderIndex: 0,
    // the same title as the original that the content upload copies (transfer/originals.ts),
    // so the two ways never write two rows for one text
    title: code => `Enabler ${code}: Lehrtext (Original PDF)`,
  },
  scenario: {
    documentType: 'EXERCISE',
    visibility: 'ALL',
    parent: 'enabler',
    // FIAE puts scenario documents behind the teaching texts (scripts/upload-szenarien.mjs)
    orderIndex: 100,
    title: code => `Szenario ${code} (PDF)`,
  },
  usecase_task: {
    documentType: 'TRAINEE_QUESTION',
    visibility: 'ALL',
    parent: 'use_case',
    orderIndex: 0,
    title: code => `Use Case ${code}: Aufgabe (PDF)`,
  },
  usecase_solution: {
    documentType: 'TRAINER_SOLUTION',
    visibility: 'TRAINER_ONLY',
    parent: 'use_case',
    orderIndex: 0,
    title: code => `Use Case ${code}: Musterlösung (PDF)`,
  },
};

export interface DocumentRunOptions {
  /** Profile that is entered as uploader of the rows. */
  createdBy: string;
  /** false = only compare. */
  write: boolean;
  /** true = copy the files into the storage (only a real run). */
  upload: boolean;
  /** Replace the file of a row that exists and the object that has no row yet. */
  overwriteFiles: boolean;
  target: DocumentTarget;
  /** https address of the project, needed for the public urls of a write. */
  supabaseUrl: string | null;
  /** Reads the file of an item again (hash checked against the plan). */
  bytesOf: (item: PlanItem) => Promise<Uint8Array>;
  /** Filled with every object this run created, so a caller can remove them. */
  created?: Array<{ bucket: string; path: string }>;
}

export interface SkippedItem {
  rel: string;
  enablerCode: string;
  kind: PdfKind;
  code: 'ENABLER_MISSING' | 'USE_CASE_MISSING';
}

export interface DocumentReport {
  tables: Record<string, TableCount>;
  uploads: { put: number; replaced: number };
  skipped: SkippedItem[];
  conflicts: Conflict[];
  wrote: boolean;
}

const sha256Of = (bytes: Uint8Array) =>
  createHash('sha256').update(bytes).digest('hex');

const baseName = (rel: string) =>
  (rel.split(/[\\/]+/).pop() as string).normalize('NFC');

interface Work {
  item: PlanItem;
  kind: PdfKind;
  enablerCode: string;
  bucket: string;
  path: string;
  row: Row | null;
  /** The file is replaced (a row exists with this path, or an object without a row). */
  replace: boolean;
}

/**
 * Removes the objects a run created. Returns the objects that could not be removed
 * (bucket/path, no key and no address): they stay in the storage and have to be removed by hand,
 * the next run would find them as "object without a row".
 */
export async function removeCreated(
  storage: StorageAdapter,
  created: Array<{ bucket: string; path: string }>
): Promise<string[]> {
  const byBucket = new Map<string, string[]>();
  for (const { bucket, path } of created) {
    byBucket.set(bucket, [...(byBucket.get(bucket) ?? []), path]);
  }
  const left: string[] = [];
  for (const [bucket, paths] of byBucket) {
    try {
      await storage.remove(bucket, paths);
    } catch {
      left.push(...paths.map(path => `${bucket}/${path}`));
    }
  }
  return left;
}

/** The error of a failed run, with the objects that stay behind (if any). */
export function withOrphans(error: unknown, orphans: string[]): unknown {
  if (orphans.length > 0 && error instanceof Error) {
    (error as Error & { orphans?: string[] }).orphans = orphans;
  }
  return error;
}

export async function executeDocumentPlan(
  db: Db,
  storage: StorageAdapter,
  plan: DocumentPlan,
  options: DocumentRunOptions
): Promise<DocumentReport> {
  const created = options.created ?? [];
  const catalog = await db.findCatalog('KFBM');
  if (!catalog) {
    throw new ImportAbort(
      'NO_CATALOG',
      'The catalog KFBM is not in the target.'
    );
  }
  if (options.write) {
    if (!(await db.findProfile(options.createdBy))) {
      throw new ImportAbort(
        'NO_AUTHOR',
        'The profile of --created-by is not in the target. Nothing was written.'
      );
    }
    if (!options.supabaseUrl) {
      throw new ImportAbort(
        'NO_STORAGE_URL',
        'The address of the storage is missing. Nothing was written.'
      );
    }
  }

  const enablers = await db.select('enablers', {
    training_catalog_id: catalog.id,
  });
  if (enablers.length === 0) {
    throw new ImportAbort(
      'NO_ENABLERS',
      'The target has no enablers of the KfBM. Run the content import first.'
    );
  }
  const enablerByCode = new Map(enablers.map(e => [String(e.code), e]));
  const useCases = await db.select('use_cases', {
    training_catalog_id: catalog.id,
  });
  const useCaseByEnabler = new Map(
    useCases
      .filter(u => u.enabler_id != null)
      .map(u => [String(u.enabler_id), u])
  );

  const counts: TableCount = { insert: 0, update: 0, unchanged: 0 };
  const skipped: SkippedItem[] = [];
  const conflicts: Conflict[] = [];

  // Which parent each item hangs on --------------------------------------------------
  const parents: Array<{
    item: PlanItem;
    kind: PdfKind;
    code: string;
    id: string;
  }> = [];
  for (const item of plan.items) {
    if (item.status !== 'ok' || !item.kind || !item.enablerCode) continue;
    const enabler = enablerByCode.get(item.enablerCode);
    const spec = KIND_ROWS[item.kind];
    if (!enabler) {
      skipped.push({
        rel: item.rel,
        enablerCode: item.enablerCode,
        kind: item.kind,
        code: 'ENABLER_MISSING',
      });
      continue;
    }
    if (spec.parent === 'enabler') {
      parents.push({
        item,
        kind: item.kind,
        code: item.enablerCode,
        id: String(enabler.id),
      });
      continue;
    }
    const useCase = useCaseByEnabler.get(String(enabler.id));
    if (!useCase) {
      skipped.push({
        rel: item.rel,
        enablerCode: item.enablerCode,
        kind: item.kind,
        code: 'USE_CASE_MISSING',
      });
      continue;
    }
    parents.push({
      item,
      kind: item.kind,
      code: item.enablerCode,
      id: String(useCase.id),
    });
  }

  // The rows that exist ----------------------------------------------------------------
  const enablerIds = parents
    .filter(p => KIND_ROWS[p.kind].parent === 'enabler')
    .map(p => p.id);
  const useCaseIds = parents
    .filter(p => KIND_ROWS[p.kind].parent === 'use_case')
    .map(p => p.id);
  const existing: Row[] = [
    ...(enablerIds.length > 0
      ? await db.select('content_documents', {
          enabler_id: [...new Set(enablerIds)],
        })
      : []),
    ...(useCaseIds.length > 0
      ? await db.select('content_documents', {
          use_case_id: [...new Set(useCaseIds)],
        })
      : []),
  ];

  const work: Work[] = [];
  for (const { item, kind, code, id } of parents) {
    const spec = KIND_ROWS[kind];
    const title = spec.title(code);
    const parentColumn =
      spec.parent === 'enabler' ? 'enabler_id' : 'use_case_id';
    const bucket = bucketOf(kind);
    const path = storagePathFor(options.target, {
      enablerCode: code,
      kind,
      rel: item.rel,
    });
    const found = existing.find(
      d =>
        String(d[parentColumn]) === id &&
        d.document_type === spec.documentType &&
        d.title === title
    );
    if (found) {
      if (found.visibility !== spec.visibility) {
        conflicts.push({
          table: 'content_documents',
          key: `${code}:${title}`,
          reason: 'The document exists with another visibility than the plan',
        });
        continue;
      }
      counts.unchanged += 1;
      // the file of an existing row is only replaced with the switch, and only when the row
      // points to exactly the path of this import
      if (options.overwriteFiles && found.storage_path === path) {
        work.push({
          item,
          kind,
          enablerCode: code,
          bucket,
          path,
          row: null,
          replace: true,
        });
      }
      continue;
    }
    const storageUrl =
      kind === 'usecase_solution'
        ? privateReference(bucket, path)
        : options.supabaseUrl
          ? publicObjectUrl(options.supabaseUrl, bucket, path)
          : '';
    work.push({
      item,
      kind,
      enablerCode: code,
      bucket,
      path,
      replace: false,
      row: {
        enabler_id: spec.parent === 'enabler' ? id : null,
        use_case_id: spec.parent === 'use_case' ? id : null,
        course_id: null,
        organization_id: null,
        title,
        description: null,
        document_type: spec.documentType,
        visibility: spec.visibility,
        file_name: baseName(item.rel),
        file_size: item.size,
        mime_type: 'application/pdf',
        storage_url: storageUrl,
        storage_path: path,
        page_count: item.pageCount,
        order_index: spec.orderIndex,
        uploaded_by_id: options.createdBy,
      },
    });
    counts.insert += 1;
  }

  const uploads = { put: 0, replaced: 0 };
  const report = (wrote: boolean): DocumentReport => ({
    tables: { content_documents: counts },
    uploads,
    skipped,
    conflicts,
    wrote,
  });

  if (!options.write) return report(false);

  // A file in the storage without its row: stop before the first copy unless it may be replaced
  if (options.upload) {
    for (const w of work) {
      if (w.replace || !w.row) continue;
      if (await storage.exists(w.bucket, w.path)) {
        if (options.overwriteFiles) {
          w.replace = true;
        } else {
          conflicts.push({
            table: 'storage',
            key: `${w.bucket}/${w.path}`,
            reason:
              'The object exists but has no row. It is not replaced without --overwrite-files',
          });
        }
      }
    }
  }
  if (conflicts.length > 0) {
    throw new ImportAbort(
      'CONFLICTS',
      `${conflicts.length} conflict(s) between the plan and the target. Nothing was written.`,
      conflicts
    );
  }

  try {
    if (options.upload) {
      for (const w of work) {
        const bytes = await options.bytesOf(w.item);
        if (w.item.sha256 && sha256Of(bytes) !== w.item.sha256) {
          throw new ImportAbort(
            'FILE_CHANGED',
            'A file changed after the plan was made. Nothing was kept, make the plan again.'
          );
        }
        await storage.put(w.bucket, w.path, bytes, 'application/pdf', {
          upsert: w.replace,
        });
        uploads.put += 1;
        if (w.replace) {
          uploads.replaced += 1;
        } else {
          created.push({ bucket: w.bucket, path: w.path });
        }
      }
    }
    const rows = work.flatMap(w => (w.row ? [w.row] : []));
    if (rows.length > 0) await db.insert('content_documents', rows);
  } catch (error) {
    throw withOrphans(error, await removeCreated(storage, created));
  }
  return report(true);
}
