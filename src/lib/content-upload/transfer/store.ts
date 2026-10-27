// The data access of the transfer: what the apply reads about a run and what it
// writes about itself (the gate, the protocol, the end state of the run).
//
// Two kinds of statements:
//   - outside the transaction of the engines, one statement each on the pool
//     (the gate, reading the decisions, the end state of a failed run)
//   - inside that transaction, on the reserved connection of the engines
//     (the protocol of an apply: the row of the apply, the rows it wrote, the
//     files and the run), so the content and its protocol commit together or not
//     at all
//
// Every change of a status is ONE conditional update ("... where status = <expected>"),
// the gate is the update of docs/ki-upload-konzept.md 8.2. All values are bound
// parameters, table and column names are fixed text in this file.

import type { Queryable } from '@/lib/content-import/apply/pg-db';
import type { TableName } from '@/lib/content-import/apply/tables';
import type { StoredStock } from '@/lib/content-upload/transfer/stock';
import type {
  ComponentFact,
  TransferFile,
} from '@/lib/content-upload/transfer/types';

export interface RunState {
  id: string;
  status: string;
  decisionsVersion: number;
  lastDryRunHash: string | null;
  createdById: string;
  catalogId: string;
  catalogCode: string;
  updatedAt: Date;
}

export interface ApplyRecord {
  runId: string;
  mode: 'dry_run' | 'apply';
  startedById: string;
  decisionsVersion: number;
  decisionsHash: string;
  updateExisting: boolean;
  status: 'ok' | 'conflict' | 'failed';
  counts: Record<string, unknown>;
  conflicts: Array<{ table: string; key: string; reason: string }>;
  startedAt: Date;
}

export interface AppliedRowInput {
  table: TableName;
  rowId: string;
  action: 'insert' | 'update';
  before: Record<string, unknown> | null;
  fileId: string | null;
}

/** The protocol statements of an apply, on the connection of its transaction. */
export interface ProtocolWriter {
  insertApply(record: ApplyRecord): Promise<string>;
  insertAppliedRows(
    applyId: string,
    rows: readonly AppliedRowInput[]
  ): Promise<void>;
  /** decided -> applied for the files that became rows. Returns how many changed. */
  markFilesApplied(runId: string, fileIds: readonly string[]): Promise<number>;
  /**
   * applying -> applied, finished_at now, purge_after now plus `purgeDays` (the
   * staging files of an applied run go after that, docs 4.6), and the dry run hash
   * is cleared so the next apply needs a new dry run. False if the run is not applying.
   */
  finishRunApplied(runId: string, purgeDays: number): Promise<boolean>;
  /**
   * Takes the stored status of the supply (parse_summary.stock) off every file of the
   * run: after an apply the database is another one and the old comparison is stale.
   */
  clearStock(runId: string): Promise<void>;
}

/** The status of the supply of one file, as it is stored. */
export interface StockWrite {
  fileId: string;
  stock: StoredStock;
}

export interface TransferStore {
  getRunState(runId: string): Promise<RunState | null>;
  /** Gives a run that has been applying for `minutes` back to review. */
  releaseStale(runId: string, minutes: number): Promise<boolean>;
  /**
   * The files of the run with their current decision. With `effective` every file that
   * has a decision or a proposal: a file without a decision counts as accepted with the
   * assignment of its proposal (the comparison of the supply, nothing is written).
   */
  loadFiles(
    runId: string,
    options?: { effective?: boolean }
  ): Promise<TransferFile[]>;
  /**
   * Stores the status of the supply per file, only while the run is in review. Returns
   * how many files were written.
   */
  saveStock(runId: string, entries: readonly StockWrite[]): Promise<number>;
  /** Takes the stored status of the supply off every file of the run. */
  clearStock(runId: string): Promise<void>;
  loadComponents(catalogId: string): Promise<ComponentFact[]>;
  /**
   * The gate: review -> applying, only if the decisions are still at `version`
   * and, for an apply, only if the last dry run hash is `requireHash`. One
   * statement, so two callers never both pass. True for the one that did.
   */
  beginApplying(
    runId: string,
    options: { version: number; requireHash: string | null }
  ): Promise<boolean>;
  /** applying -> review. `hash` is stored as the hash of the last good dry run (null clears it). */
  endApplying(runId: string, hash: string | null): Promise<boolean>;
  /** A row of the protocol outside the transaction of the engines (dry runs, failures). */
  recordAttempt(record: ApplyRecord): Promise<string>;
  /** The protocol statements on the connection of the transaction. */
  protocol(tx: Queryable): ProtocolWriter;
}

const text = (value: unknown) =>
  value === null || value === undefined ? null : String(value);

const MAX_ROWS_PER_INSERT = 1000;

function chunks<T>(values: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size)
    out.push(values.slice(i, i + size));
  return out;
}

export class PgProtocolWriter implements ProtocolWriter {
  constructor(private readonly q: Queryable) {}

  async insertApply(record: ApplyRecord): Promise<string> {
    // finished_at is taken inside the lock of the import: it is the order in which the
    // applies were written, which the rollback needs (started_at is the time of the request).
    // target_schema is the schema the connection works in: public locally, the
    // Preview schema in the Preview (the table checks the two names).
    const result = await this.q.query(
      `insert into content_upload_applies
         (run_id, mode, started_by_id, decisions_version, decisions_hash,
          update_existing, status, target_schema, counts, conflicts, started_at, finished_at)
       values ($1, $2, $3, $4, $5, $6, $7, current_schema(), $8::text::jsonb, $9::text::jsonb, $10::timestamptz, clock_timestamp())
       returning id`,
      [
        record.runId,
        record.mode,
        record.startedById,
        record.decisionsVersion,
        record.decisionsHash,
        record.updateExisting,
        record.status,
        JSON.stringify(record.counts),
        JSON.stringify(record.conflicts),
        record.startedAt.toISOString(),
      ]
    );
    return String(result.rows[0].id);
  }

  async insertAppliedRows(
    applyId: string,
    rows: readonly AppliedRowInput[]
  ): Promise<void> {
    for (const chunk of chunks(rows, MAX_ROWS_PER_INSERT)) {
      const values: unknown[] = [applyId];
      // ::text::jsonb: the text is the JSON, whatever the driver does with a JSON value
      const tuples = chunk.map(row => {
        values.push(
          row.table,
          row.rowId,
          row.action,
          row.before === null ? null : JSON.stringify(row.before),
          row.fileId
        );
        const n = values.length;
        return `($1, $${n - 4}, $${n - 3}::uuid, $${n - 2}, $${n - 1}::text::jsonb, $${n}::uuid)`;
      });
      await this.q.query(
        `insert into content_upload_applied_rows (apply_id, table_name, row_id, action, before, file_id)
         values ${tuples.join(', ')}`,
        values
      );
    }
  }

  async markFilesApplied(
    runId: string,
    fileIds: readonly string[]
  ): Promise<number> {
    if (fileIds.length === 0) return 0;
    const result = await this.q.query(
      `update content_upload_files
          set status = 'applied', processed_at = now()
        where run_id = $1 and id = any($2::uuid[]) and status = 'decided'`,
      [runId, [...fileIds]]
    );
    return result.rowCount ?? 0;
  }

  async finishRunApplied(runId: string, purgeDays: number): Promise<boolean> {
    const result = await this.q.query(
      `update content_upload_runs
          set status = 'applied', finished_at = now(),
              purge_after = now() + make_interval(days => $2::int),
              last_dry_run_hash = null, updated_at = now()
        where id = $1 and status = 'applying'
        returning id`,
      [runId, purgeDays]
    );
    return result.rows.length === 1;
  }

  async clearStock(runId: string): Promise<void> {
    await this.q.query(
      `update content_upload_files
          set parse_summary = parse_summary - 'stock'
        where run_id = $1 and (parse_summary -> 'stock') is not null`,
      [runId]
    );
  }
}

export class PgTransferStore implements TransferStore {
  constructor(private readonly q: Queryable) {}

  async getRunState(runId: string): Promise<RunState | null> {
    const result = await this.q.query(
      `select r.id, r.status, r.decisions_version, r.last_dry_run_hash,
              r.created_by_id, r.training_catalog_id, c.code as catalog_code, r.updated_at
         from content_upload_runs r
         join training_catalogs c on c.id = r.training_catalog_id
        where r.id = $1`,
      [runId]
    );
    const r = result.rows[0];
    if (!r) return null;
    return {
      id: String(r.id),
      status: String(r.status),
      decisionsVersion: Number(r.decisions_version),
      lastDryRunHash: text(r.last_dry_run_hash),
      createdById: String(r.created_by_id),
      catalogId: String(r.training_catalog_id),
      catalogCode: String(r.catalog_code),
      updatedAt:
        r.updated_at instanceof Date
          ? r.updated_at
          : new Date(String(r.updated_at)),
    };
  }

  async releaseStale(runId: string, minutes: number): Promise<boolean> {
    const result = await this.q.query(
      `update content_upload_runs
          set status = 'review', last_dry_run_hash = null, updated_at = now()
        where id = $1 and status = 'applying'
          and updated_at < now() - make_interval(mins => $2::int)
        returning id`,
      [runId, minutes]
    );
    return result.rows.length === 1;
  }

  async loadFiles(
    runId: string,
    options: { effective?: boolean } = {}
  ): Promise<TransferFile[]> {
    // The decision must belong to the same run as the file (the database does not
    // check that, the application does, docs 9.2). Only files that have an object
    // after the extraction can be part of a transfer.
    // With `effective` a file without a decision takes the assignment of its current
    // proposal as an acceptance (never written anywhere: only the comparison uses it).
    const effective = options.effective === true;
    const result = await this.q.query(
      `select f.id, f.rel_path, f.file_name, f.ext, f.size_bytes, f.sha256,
              f.client_mtime_ms,
              (extract(epoch from f.created_at) * 1000)::bigint as created_ms,
              f.storage_path, f.status, f.dup_key,
              (coalesce(f.parse_summary ->> 'objectDeleted', '') = 'true') as object_deleted,
              d.id as decision_id, d.action, d.doc_type, d.component_code,
              d.enabler_code, d.quiz_level, d.dup_choice, d.decisions_version,
              p.id as proposal_id, p.doc_type as p_doc_type,
              p.component_code as p_component_code,
              p.enabler_code as p_enabler_code, p.quiz_level as p_quiz_level
         from content_upload_files f
         ${effective ? 'left ' : ''}join content_upload_decisions d
           on d.file_id = f.id and d.run_id = f.run_id and d.is_current
         ${effective ? 'left join content_upload_proposals p on p.file_id = f.id and p.is_current' : 'left join content_upload_proposals p on false'}
        where f.run_id = $1
          and f.status in ('proposed_rules', 'unclear', 'proposed_ki', 'decided', 'applied')
          ${effective ? 'and (d.id is not null or p.id is not null)' : ''}
        order by f.id`,
      [runId]
    );
    return result.rows.map(r => ({
      id: String(r.id),
      relPath: String(r.rel_path),
      fileName: String(r.file_name),
      ext: String(r.ext) as 'docx' | 'pdf',
      sizeBytes: Number(r.size_bytes),
      sha256: String(r.sha256),
      mtimeMs:
        r.client_mtime_ms !== null && r.client_mtime_ms !== undefined
          ? Number(r.client_mtime_ms)
          : Number(r.created_ms),
      storagePath: String(r.storage_path),
      status: String(r.status),
      dupKey: text(r.dup_key),
      objectDeleted: r.object_deleted === true,
      decision:
        r.decision_id !== null && r.decision_id !== undefined
          ? {
              id: String(r.decision_id),
              action: String(r.action) as 'accept' | 'reject' | 'defer',
              docType: text(r.doc_type),
              componentCode: text(r.component_code),
              enablerCode: text(r.enabler_code),
              quizLevel: text(r.quiz_level),
              dupChoice: text(r.dup_choice) as 'keep' | 'skip' | null,
              decisionsVersion: Number(r.decisions_version),
            }
          : {
              // no decision yet: the proposal counts as accepted (effective only)
              id: String(r.proposal_id),
              action: 'accept' as const,
              docType: text(r.p_doc_type),
              componentCode: text(r.p_component_code),
              enablerCode: text(r.p_enabler_code),
              quizLevel: text(r.p_quiz_level),
              dupChoice: null,
              decisionsVersion: 0,
            },
    }));
  }

  async saveStock(
    runId: string,
    entries: readonly StockWrite[]
  ): Promise<number> {
    let written = 0;
    for (const chunk of chunks(entries, 500)) {
      const result = await this.q.query(
        `update content_upload_files f
            set parse_summary = coalesce(f.parse_summary, '{}'::jsonb)
                                || jsonb_build_object('stock', v.stock::text::jsonb)
           from (select unnest($2::uuid[]) as id, unnest($3::text[]) as stock) v
          where f.run_id = $1 and f.id = v.id
            and f.status in ('proposed_rules', 'unclear', 'proposed_ki', 'decided')
            and exists (select 1 from content_upload_runs r
                         where r.id = $1 and r.status = 'review')`,
        [
          runId,
          chunk.map(e => e.fileId),
          chunk.map(e => JSON.stringify(e.stock)),
        ]
      );
      written += result.rowCount ?? 0;
    }
    return written;
  }

  async loadComponents(catalogId: string): Promise<ComponentFact[]> {
    const result = await this.q.query(
      `select code, title, description, kind::text as kind, phase
         from training_components
        where training_catalog_id = $1 and code is not null`,
      [catalogId]
    );
    return result.rows.map(r => ({
      code: String(r.code),
      title: String(r.title),
      reference: text(r.description),
      kind: text(r.kind),
      phase: r.phase === null || r.phase === undefined ? null : Number(r.phase),
    }));
  }

  async beginApplying(
    runId: string,
    options: { version: number; requireHash: string | null }
  ): Promise<boolean> {
    const hashCondition =
      options.requireHash === null ? '' : 'and last_dry_run_hash = $3';
    const result = await this.q.query(
      `update content_upload_runs
          set status = 'applying', updated_at = now()
        where id = $1 and status = 'review' and decisions_version = $2
          ${hashCondition}
        returning id`,
      options.requireHash === null
        ? [runId, options.version]
        : [runId, options.version, options.requireHash]
    );
    return result.rows.length === 1;
  }

  async endApplying(runId: string, hash: string | null): Promise<boolean> {
    const result = await this.q.query(
      `update content_upload_runs
          set status = 'review', last_dry_run_hash = $2, updated_at = now()
        where id = $1 and status = 'applying'
        returning id`,
      [runId, hash]
    );
    return result.rows.length === 1;
  }

  clearStock(runId: string): Promise<void> {
    return new PgProtocolWriter(this.q).clearStock(runId);
  }

  recordAttempt(record: ApplyRecord): Promise<string> {
    return new PgProtocolWriter(this.q).insertApply(record);
  }

  protocol(tx: Queryable): ProtocolWriter {
    return new PgProtocolWriter(tx);
  }
}

/** The part of a postgres-js client that the plain (pooled) queries use. */
export interface PostgresJsPool {
  unsafe(
    query: string,
    parameters?: unknown[]
  ): PromiseLike<ArrayLike<Record<string, unknown>> & { count?: number }>;
}

/**
 * Statements on the pool, one connection each, no transaction. Only for the
 * single statements of the store outside the transaction of the engines.
 */
export function queryableOfPool(sql: PostgresJsPool): Queryable {
  return {
    async query(queryText, values) {
      const result = await sql.unsafe(queryText, values ?? []);
      return { rows: Array.from(result), rowCount: result.count ?? null };
    },
  };
}
