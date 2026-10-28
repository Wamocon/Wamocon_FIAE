// One run of the PDF import against an open connection and a storage: compare (check), dry
// run or real run. The caller has already checked that the connection fits the declared
// target (apply/target.ts) and passes it in.
//
//  - check:   read-only transaction, nothing is written, the storage is not touched
//  - dry-run: the rows are written in a transaction (so constraints and triggers speak), then
//             rolled back. The storage is not touched.
//  - apply:   the files are copied, the rows are written and the transaction is committed. When
//             anything fails, also the commit, the files this run created are removed again.
//
// The transaction is the one of the content import (repeatable read, lock and statement timeout,
// the same advisory lock), so the imports never run at the same time.

import { ImportAbort } from '../apply/db';
import type { JobMode } from '../apply/job';
import { PgDb, withTransaction } from '../apply/pg-db';
import type { Queryable } from '../apply/pg-db';
import {
  executeDocumentPlan,
  removeCreated,
  type DocumentReport,
} from './engine';
import { checkStorageTarget, type StorageAdapter } from './storage';
import type { DocumentPlan, DocumentTarget, PlanItem } from './types';

export interface DocumentJobInput {
  mode: JobMode;
  target: DocumentTarget;
  createdBy: string;
  overwriteFiles: boolean;
  /** https address of the storage project (NEXT_PUBLIC_SUPABASE_URL). */
  supabaseUrl: string | null;
  bytesOf: (item: PlanItem) => Promise<Uint8Array>;
}

export async function runDocumentJob(
  client: Queryable,
  storage: StorageAdapter,
  plan: DocumentPlan,
  input: DocumentJobInput
): Promise<DocumentReport> {
  const db = new PgDb(client);
  const base = {
    createdBy: input.createdBy,
    overwriteFiles: input.overwriteFiles,
    target: input.target,
    supabaseUrl: input.supabaseUrl,
    bytesOf: input.bytesOf,
  };
  if (input.mode === 'check') {
    return withTransaction(
      client,
      { mode: 'read-only', finish: 'rollback' },
      () =>
        executeDocumentPlan(db, storage, plan, {
          ...base,
          write: false,
          upload: false,
        })
    );
  }
  if (input.mode === 'dry-run') {
    return withTransaction(client, { mode: 'write', finish: 'rollback' }, () =>
      executeDocumentPlan(db, storage, plan, {
        ...base,
        write: true,
        upload: false,
      })
    );
  }
  // The second lock for a caller that does not come through the arguments: a local database
  // never gets the hosted storage, the Preview never a local one.
  const problems = checkStorageTarget(input.target, input.supabaseUrl);
  if (problems.length > 0) {
    throw new ImportAbort(
      'STORAGE_TARGET',
      `${problems.join(' ')} Nothing was written.`
    );
  }
  const created: Array<{ bucket: string; path: string }> = [];
  try {
    return await withTransaction(
      client,
      { mode: 'write', finish: 'commit' },
      () =>
        executeDocumentPlan(db, storage, plan, {
          ...base,
          write: true,
          upload: true,
          created,
        })
    );
  } catch (error) {
    // also a failed commit: the rows are not there, so the files must not stay
    await removeCreated(storage, created);
    throw error;
  }
}
