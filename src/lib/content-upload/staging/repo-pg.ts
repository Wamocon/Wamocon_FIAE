// UploadRepo on PostgreSQL through Drizzle (raw SQL with bound parameters, the
// way src/lib/auth/attempt-limiter.ts does it).
//
// What the SQL guarantees, and the interface in repo.ts only names:
//
//  - Every status change is ONE conditional UPDATE ("... where status = $from").
//  - claimFiles is one statement: `update .. from (select .. for update skip
//    locked)`. Two callers at the same time never get the same row, and neither
//    waits for the other.
//  - finishClaim and releaseClaim only write when claim_id is still the one the
//    caller got, so a call that died and was replaced cannot overwrite the work
//    of its successor.
//  - announce and createRun run in a transaction under a lock (the row of the
//    run, an advisory lock for the whole staging area, an advisory lock per
//    person), so the limits cannot be passed by two requests at the same time.
//  - The time always comes from now() of the database.
//
// The object marker (parse_summary.objectDeleted) says that the object of a file
// is gone from the bucket. It is how the space of rejected, expired and removed
// files is given back and how the cleanup knows what is left to do.

import { sql, type SQL } from 'drizzle-orm';
import {
  existingKey,
  planAnnouncement,
  type AnnounceFacts,
  type Candidate,
  type PlannedItem,
} from '@/lib/content-upload/staging/announce';
import { LIMITS } from '@/lib/content-upload/staging/config';
import type {
  AnnounceRepoResult,
  ClaimOptions,
  CreateRunInput,
  CreateRunResult,
  FinishOptions,
  QueueState,
  TransitionOptions,
  UploadRepo,
  UrlRequestDecision,
} from '@/lib/content-upload/staging/repo';
import {
  ACTIVE_RUN_STATUSES,
  canTransitionFile,
  canTransitionRun,
  type FileStatus,
  type RunStatus,
} from '@/lib/content-upload/staging/status';
import type {
  FileRow,
  RunProgress,
  RunRow,
} from '@/lib/content-upload/staging/types';
import { isUuid } from '@/lib/uuid';

type Row = Record<string, unknown>;

/** The part of a Drizzle database the repository uses (also a transaction). */
export interface SqlDb {
  execute(query: SQL): PromiseLike<unknown>;
  transaction<T>(fn: (tx: SqlDb) => Promise<T>): Promise<T>;
}

/** Scope of the request counter in auth_attempts (see reserveUrlRequest). */
export const URL_REQUEST_SCOPE = 'content-upload-url';

const MAX_IN_LIST = 500;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  const rows = (result as { rows?: Row[] } | null | undefined)?.rows;
  return rows ?? [];
}

function toDate(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  return value instanceof Date ? value : new Date(String(value));
}

function toNumberOrNull(value: unknown): number | null {
  return value === null || value === undefined ? null : Number(value);
}

function mapRun(r: Row): RunRow {
  return {
    id: String(r.id),
    trainingCatalogId: String(r.training_catalog_id),
    createdById: String(r.created_by_id),
    label: String(r.label),
    status: r.status as RunStatus,
    kiEnabled: r.ki_enabled === true,
    declarationAcceptedAt: toDate(r.declaration_accepted_at)!,
    storagePrefix: String(r.storage_prefix),
    decisionsVersion: Number(r.decisions_version),
    createdAt: toDate(r.created_at)!,
    updatedAt: toDate(r.updated_at)!,
    finishedAt: toDate(r.finished_at),
    purgeAfter: toDate(r.purge_after),
  };
}

function mapFile(r: Row): FileRow {
  return {
    id: String(r.id),
    runId: String(r.run_id),
    relPath: String(r.rel_path),
    fileName: String(r.file_name),
    ext: r.ext as FileRow['ext'],
    sizeBytes: Number(r.size_bytes),
    sha256: String(r.sha256),
    clientMtimeMs: toNumberOrNull(r.client_mtime_ms),
    storagePath: String(r.storage_path),
    status: r.status as FileStatus,
    statusCode: r.status_code === null ? null : String(r.status_code),
    attempts: Number(r.attempts),
    lockedUntil: toDate(r.locked_until),
    claimId: r.claim_id === null ? null : String(r.claim_id),
    duplicateOfId:
      r.duplicate_of_id === null ? null : String(r.duplicate_of_id),
    docType: r.doc_type === null ? null : String(r.doc_type),
    pageCount: toNumberOrNull(r.page_count),
    charCount: toNumberOrNull(r.char_count),
    parseSummary:
      r.parse_summary === null || r.parse_summary === undefined
        ? null
        : (r.parse_summary as Record<string, unknown>),
    dupKey: r.dup_key === null ? null : String(r.dup_key),
    createdAt: toDate(r.created_at)!,
    completedAt: toDate(r.completed_at),
    processedAt: toDate(r.processed_at),
  };
}

function byCreated(a: FileRow, b: FileRow): number {
  return (
    a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
  );
}

/** `$1, $2, ...` for a list of values. */
function list(values: readonly unknown[]): SQL {
  return sql.join(
    values.map(v => sql`${v}`),
    sql`, `
  );
}

/** `column in (...)`, or false for an empty list. */
function inList(column: SQL, values: readonly unknown[]): SQL {
  return values.length === 0 ? sql`false` : sql`${column} in (${list(values)})`;
}

function chunks<T>(values: readonly T[], size = MAX_IN_LIST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

/** "The object of this file is still in the bucket" as a condition on the alias `f`. */
const OBJECT_KEPT = sql.raw(
  "coalesce(f.parse_summary ->> 'objectDeleted', '') <> 'true'"
);

/**
 * First statement of a transaction that takes locks: nobody waits for a lock
 * for ever. A transaction that stalls (a function that died after BEGIN) would
 * otherwise hold the lock of the whole staging area and every announce of every
 * person would queue behind it. SET LOCAL ends with the transaction, which is
 * what a transaction mode pooler needs. A timeout surfaces as 55P03 or 57014.
 */
async function limitWaiting(tx: SqlDb): Promise<void> {
  await tx.execute(sql`set local lock_timeout = '5s'`);
  await tx.execute(sql`set local statement_timeout = '30s'`);
  await tx.execute(sql`set local idle_in_transaction_session_timeout = '30s'`);
}

export class PgUploadRepo implements UploadRepo {
  constructor(private readonly db: SqlDb) {}

  // ---- runs ----------------------------------------------------------------

  async catalogIdByCode(code: string): Promise<string | null> {
    const rows = rowsOf(
      await this.db.execute(
        sql`select id from training_catalogs where code = ${code} limit 1`
      )
    );
    return rows[0] ? String(rows[0].id) : null;
  }

  async createRun(
    input: CreateRunInput,
    maxActive: number
  ): Promise<CreateRunResult> {
    return this.db.transaction(async tx => {
      await limitWaiting(tx);
      // One person creates one run at a time: the count below cannot be passed
      // by two requests that see the same number
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${`content-upload:runs:${input.createdById}`}, 0))`
      );
      const counted = rowsOf(
        await tx.execute(
          sql`select count(*)::int as n from content_upload_runs
              where created_by_id = ${input.createdById}::uuid
                and ${inList(sql`status`, ACTIVE_RUN_STATUSES)}`
        )
      );
      if (Number(counted[0]?.n ?? 0) >= maxActive) {
        return { ok: false, reason: 'TOO_MANY_ACTIVE_RUNS' } as const;
      }
      const rows = rowsOf(
        await tx.execute(
          sql`insert into content_upload_runs
                (id, training_catalog_id, created_by_id, label, status, ki_enabled,
                 declaration_accepted_at, storage_prefix)
              values
                (${input.id}::uuid, ${input.catalogId}::uuid, ${input.createdById}::uuid,
                 ${input.label}, 'draft', ${input.kiEnabled}, now(), ${input.storagePrefix})
              returning *`
        )
      );
      return { ok: true, run: mapRun(rows[0]) } as const;
    });
  }

  async getRun(id: string): Promise<RunRow | null> {
    if (!isUuid(id)) return null;
    const rows = rowsOf(
      await this.db.execute(
        sql`select * from content_upload_runs where id = ${id}::uuid`
      )
    );
    return rows[0] ? mapRun(rows[0]) : null;
  }

  async listRuns(options: {
    createdById?: string;
    limit: number;
  }): Promise<RunRow[]> {
    const rows = rowsOf(
      await this.db.execute(
        options.createdById
          ? sql`select * from content_upload_runs
                where created_by_id = ${options.createdById}::uuid
                order by created_at desc, id desc limit ${options.limit}::int`
          : sql`select * from content_upload_runs
                order by created_at desc, id desc limit ${options.limit}::int`
      )
    );
    return rows.map(mapRun);
  }

  async transitionRun(
    id: string,
    from: readonly RunStatus[],
    to: RunStatus,
    options: { purgeAfterDays?: number } = {}
  ): Promise<RunRow | null> {
    for (const f of from) {
      if (!canTransitionRun(f, to)) {
        throw new Error(`Run status ${f} -> ${to} is not a transition`);
      }
    }
    if (!isUuid(id)) return null;
    const days = options.purgeAfterDays ?? null;
    const rows = rowsOf(
      await this.db.execute(
        sql`update content_upload_runs
            set status = ${to}, updated_at = now(),
                purge_after = case when ${days}::int is null then purge_after
                                   else now() + make_interval(days => ${days}::int) end
            where id = ${id}::uuid and ${inList(sql`status`, from)}
            returning *`
      )
    );
    return rows[0] ? mapRun(rows[0]) : null;
  }

  async touchRun(id: string): Promise<void> {
    if (!isUuid(id)) return;
    await this.db.execute(
      sql`update content_upload_runs set updated_at = now() where id = ${id}::uuid`
    );
  }

  async runProgress(runId: string): Promise<RunProgress> {
    const counts: RunProgress['counts'] = {};
    let totalFiles = 0;
    let totalBytes = 0;
    if (!isUuid(runId)) return { counts, totalFiles, totalBytes };
    const rows = rowsOf(
      await this.db.execute(
        sql`select status, count(*)::int as n, coalesce(sum(size_bytes), 0)::bigint as bytes
            from content_upload_files where run_id = ${runId}::uuid group by status`
      )
    );
    for (const r of rows) {
      counts[r.status as FileStatus] = Number(r.n);
      totalFiles += Number(r.n);
      totalBytes += Number(r.bytes);
    }
    return { counts, totalFiles, totalBytes };
  }

  // ---- files ---------------------------------------------------------------

  async announce(
    runId: string,
    candidates: readonly Candidate[]
  ): Promise<AnnounceRepoResult> {
    if (!isUuid(runId)) return { ok: false, reason: 'RUN_NOT_FOUND' };
    return this.db.transaction(async tx => {
      await limitWaiting(tx);
      // The row of the run: announces of one run go one after the other
      const runRows = rowsOf(
        await tx.execute(
          sql`select status from content_upload_runs where id = ${runId}::uuid for update`
        )
      );
      if (!runRows[0]) return { ok: false, reason: 'RUN_NOT_FOUND' } as const;
      const status = runRows[0].status as RunStatus;
      if (status !== 'draft' && status !== 'uploading') {
        return { ok: false, reason: 'RUN_STATE', status } as const;
      }
      // The space of the whole staging area is shared by all runs
      await tx.execute(
        sql`select pg_advisory_xact_lock(hashtextextended(${'content-upload:staging'}, 0))`
      );

      const facts = await this.readAnnounceFacts(tx, runId, candidates);
      const plan = planAnnouncement(candidates, facts, LIMITS);

      const rows = plan.items.filter(
        (i): i is Extract<PlannedItem, { kind: 'insert' | 'merge' }> =>
          i.kind === 'insert' || i.kind === 'merge'
      );
      if (rows.length > 0) {
        const values = sql.join(
          rows.map(item => {
            const c = item.candidate;
            const merged = item.kind === 'merge';
            const duplicateOf = merged ? item.duplicateOfId : null;
            return sql`(${c.id}::uuid, ${runId}::uuid, ${c.relPath}, ${c.fileName}, ${c.ext},
                        ${c.sizeBytes}::bigint, ${c.sha256}, ${c.clientMtimeMs}::bigint,
                        ${c.storagePath}, ${merged ? 'merged' : 'announced'},
                        ${duplicateOf}::uuid)`;
          }),
          sql`, `
        );
        await tx.execute(
          sql`insert into content_upload_files
                (id, run_id, rel_path, file_name, ext, size_bytes, sha256,
                 client_mtime_ms, storage_path, status, duplicate_of_id)
              values ${values}`
        );
      }
      const reviveIds = plan.items.flatMap(i =>
        i.kind === 'revive' ? [i.fileId] : []
      );
      let revived = 0;
      if (reviveIds.length > 0) {
        revived = rowsOf(
          await tx.execute(
            sql`update content_upload_files
                set status = 'announced', created_at = now(), completed_at = null,
                    status_code = null, attempts = 0, claim_id = null,
                    locked_until = null, processed_at = null, parse_summary = null
                where run_id = ${runId}::uuid and status = 'expired'
                  and id in (${list(reviveIds)})
                returning id`
          )
        ).length;
      }
      // A file that is announced again is alive: its 24 hours start over
      const aliveIds = plan.items.flatMap(i =>
        i.kind === 'existing' && i.status === 'announced' ? [i.fileId] : []
      );
      if (aliveIds.length > 0) {
        await tx.execute(
          sql`update content_upload_files set created_at = now()
              where run_id = ${runId}::uuid and status = 'announced'
                and id in (${list(aliveIds)})`
        );
      }
      if (rows.length + revived > 0) {
        await tx.execute(
          sql`update content_upload_runs
              set status = case when status = 'draft' then 'uploading' else status end,
                  updated_at = now()
              where id = ${runId}::uuid`
        );
      }
      return { ok: true, plan } as const;
    });
  }

  private async readAnnounceFacts(
    tx: SqlDb,
    runId: string,
    candidates: readonly Candidate[]
  ): Promise<AnnounceFacts> {
    const totals = rowsOf(
      await tx.execute(
        sql`select count(*) filter (where f.status <> 'expired')::int as files,
                   coalesce(sum(f.size_bytes) filter (where f.status <> 'merged' and ${OBJECT_KEPT}), 0)::bigint as bytes
            from content_upload_files f where f.run_id = ${runId}::uuid`
      )
    )[0];
    const staging = rowsOf(
      await tx.execute(
        sql`select coalesce(sum(f.size_bytes), 0)::bigint as bytes
            from content_upload_files f where f.status <> 'merged' and ${OBJECT_KEPT}`
      )
    )[0];

    const existing: AnnounceFacts['existing'] = new Map();
    const mainBySha: AnnounceFacts['mainBySha'] = new Map();
    const appliedBySha: AnnounceFacts['appliedBySha'] = new Map();
    if (candidates.length > 0) {
      const pairs = sql.join(
        candidates.map(c => sql`(${c.relPath}, ${c.sha256})`),
        sql`, `
      );
      for (const r of rowsOf(
        await tx.execute(
          sql`select id, rel_path, sha256, status, storage_path from content_upload_files
              where run_id = ${runId}::uuid and (rel_path, sha256) in (${pairs})`
        )
      )) {
        existing.set(existingKey(String(r.rel_path), String(r.sha256)), {
          id: String(r.id),
          status: String(r.status),
          storagePath: String(r.storage_path),
        });
      }
      const shas = [...new Set(candidates.map(c => c.sha256))];
      for (const r of rowsOf(
        await tx.execute(
          sql`select distinct on (sha256) sha256, id from content_upload_files
              where run_id = ${runId}::uuid and sha256 in (${list(shas)})
                and status not in ('merged', 'expired', 'rejected')
              order by sha256, created_at, id`
        )
      )) {
        mainBySha.set(String(r.sha256), String(r.id));
      }
      for (const r of rowsOf(
        await tx.execute(
          sql`select distinct on (sha256) sha256, run_id from content_upload_files
              where sha256 in (${list(shas)}) and status = 'applied'
              order by sha256, created_at desc`
        )
      )) {
        appliedBySha.set(String(r.sha256), String(r.run_id));
      }
    }
    return {
      runFileCount: Number(totals?.files ?? 0),
      runBytes: Number(totals?.bytes ?? 0),
      stagingBytes: Number(staging?.bytes ?? 0),
      existing,
      mainBySha,
      appliedBySha,
    };
  }

  async listFiles(
    runId: string,
    options: { offset: number; limit: number }
  ): Promise<FileRow[]> {
    if (!isUuid(runId)) return [];
    const rows = rowsOf(
      await this.db.execute(
        sql`select * from content_upload_files where run_id = ${runId}::uuid
            order by created_at, id offset ${options.offset}::bigint limit ${options.limit}::int`
      )
    );
    return rows.map(mapFile);
  }

  async getFiles(runId: string, ids: readonly string[]): Promise<FileRow[]> {
    const valid = ids.filter(isUuid);
    if (!isUuid(runId) || valid.length === 0) return [];
    const out: FileRow[] = [];
    for (const part of chunks(valid)) {
      const rows = rowsOf(
        await this.db.execute(
          sql`select * from content_upload_files
              where run_id = ${runId}::uuid and id in (${list(part)})`
        )
      );
      out.push(...rows.map(mapFile));
    }
    return out.sort(byCreated);
  }

  async transitionFile(
    runId: string,
    fileId: string,
    from: FileStatus,
    to: FileStatus,
    options: TransitionOptions = {}
  ): Promise<FileRow | null> {
    if (!canTransitionFile(from, to)) {
      throw new Error(`File status ${from} -> ${to} is not a transition`);
    }
    if (!isUuid(runId) || !isUuid(fileId)) return null;
    const rows = rowsOf(
      await this.db.execute(
        sql`update content_upload_files
            set status = ${to}, status_code = ${options.code ?? null},
                completed_at = case when ${options.completed === true} then now() else completed_at end,
                parse_summary = case when ${options.objectDeleted === true}
                  then coalesce(parse_summary, '{}'::jsonb) || jsonb_build_object('objectDeleted', true)
                  else parse_summary end
            where id = ${fileId}::uuid and run_id = ${runId}::uuid and status = ${from}
            returning *`
      )
    );
    return rows[0] ? mapFile(rows[0]) : null;
  }

  // ---- queue ---------------------------------------------------------------

  async claimFiles(runId: string, options: ClaimOptions): Promise<FileRow[]> {
    if (!isUuid(runId) || options.statuses.length === 0) return [];
    const rows = rowsOf(
      await this.db.execute(
        sql`update content_upload_files f
            set claim_id = gen_random_uuid(),
                locked_until = now() + make_interval(secs => ${options.lockSeconds}::double precision),
                attempts = f.attempts + 1
            from (
              select c.id from content_upload_files c
              where c.run_id = ${runId}::uuid
                and ${inList(sql`c.status`, options.statuses)}
                and (c.locked_until is null or c.locked_until < now())
                and c.attempts < ${options.maxAttempts}::int
                and exists (
                  select 1 from content_upload_runs r
                  where r.id = c.run_id and r.status in ('uploading', 'processing', 'review')
                )
              order by c.created_at, c.id
              limit ${options.limit}::int
              for no key update of c skip locked
            ) picked
            where f.id = picked.id
            returning f.*`
      )
    );
    return rows.map(mapFile).sort(byCreated);
  }

  async finishClaim(
    fileId: string,
    claimId: string,
    from: FileStatus,
    to: FileStatus,
    options: FinishOptions = {}
  ): Promise<boolean> {
    if (!canTransitionFile(from, to)) {
      throw new Error(`File status ${from} -> ${to} is not a transition`);
    }
    if (!isUuid(fileId) || !isUuid(claimId)) return false;
    const patch = options.patch ?? {};
    const summary = patch.parseSummary
      ? JSON.stringify(patch.parseSummary)
      : null;
    const rows = rowsOf(
      await this.db.execute(
        sql`update content_upload_files
            set status = ${to}, status_code = ${options.code ?? null},
                attempts = 0, claim_id = null, locked_until = null, processed_at = now(),
                doc_type = coalesce(${patch.docType ?? null}::text, doc_type),
                page_count = coalesce(${patch.pageCount ?? null}::int, page_count),
                char_count = coalesce(${patch.charCount ?? null}::int, char_count),
                dup_key = coalesce(${patch.dupKey ?? null}::text, dup_key),
                parse_summary = case when ${summary}::jsonb is null then parse_summary
                  else coalesce(parse_summary, '{}'::jsonb) || ${summary}::jsonb end
            where id = ${fileId}::uuid and claim_id = ${claimId}::uuid and status = ${from}
            returning id`
      )
    );
    return rows.length === 1;
  }

  async releaseClaim(
    fileId: string,
    claimId: string,
    delaySeconds = 0
  ): Promise<boolean> {
    if (!isUuid(fileId) || !isUuid(claimId)) return false;
    const rows = rowsOf(
      await this.db.execute(
        sql`update content_upload_files set claim_id = null,
              locked_until = case when ${delaySeconds}::double precision > 0
                then now() + make_interval(secs => ${delaySeconds}::double precision)
                else null end
            where id = ${fileId}::uuid and claim_id = ${claimId}::uuid
            returning id`
      )
    );
    return rows.length === 1;
  }

  async failExhausted(
    runId: string,
    statuses: readonly FileStatus[],
    maxAttempts: number,
    code: string
  ): Promise<number> {
    const failable = statuses.filter(s => canTransitionFile(s, 'failed'));
    if (!isUuid(runId) || failable.length === 0) return 0;
    const rows = rowsOf(
      await this.db.execute(
        sql`update content_upload_files
            set status = 'failed', status_code = ${code}, claim_id = null, locked_until = null
            where run_id = ${runId}::uuid and ${inList(sql`status`, failable)}
              and attempts >= ${maxAttempts}::int
              and (locked_until is null or locked_until < now())
            returning id`
      )
    );
    return rows.length;
  }

  async queueState(
    runId: string,
    statuses: readonly FileStatus[],
    maxAttempts: number
  ): Promise<QueueState> {
    if (!isUuid(runId)) return { announced: 0, claimable: 0, locked: 0 };
    const inStatuses = inList(sql`status`, statuses);
    const row = rowsOf(
      await this.db.execute(
        sql`select
              count(*) filter (where status = 'announced')::int as announced,
              count(*) filter (where ${inStatuses}
                and (locked_until is null or locked_until < now())
                and attempts < ${maxAttempts}::int)::int as claimable,
              count(*) filter (where ${inStatuses} and locked_until >= now())::int as locked
            from content_upload_files where run_id = ${runId}::uuid`
      )
    )[0];
    return {
      announced: Number(row?.announced ?? 0),
      claimable: Number(row?.claimable ?? 0),
      locked: Number(row?.locked ?? 0),
    };
  }

  // ---- rate limit ----------------------------------------------------------

  /**
   * One statement counts the request in a fixed window and says whether it may
   * go on. The counter lives in auth_attempts (a table that already exists, so
   * no migration is needed): scope 'content-upload-url', subject 'user:<id>',
   * `failures` is the number of requests in the window and `last_attempt_at`
   * the start of the window. The row of another scope (the admin PIN) is never
   * touched.
   */
  async reserveUrlRequest(profileId: string): Promise<UrlRequestDecision> {
    const subject = `user:${profileId}`;
    const window = LIMITS.signedUrlWindowSeconds;
    const limit = LIMITS.signedUrlRequestsPerWindow;
    const expired = sql`a.last_attempt_at <= now() - make_interval(secs => ${window}::double precision)`;
    const rows = rowsOf(
      await this.db.execute(
        sql`insert into auth_attempts as a
              (scope, subject, failures, locked_until, last_attempt_at, last_allowed)
            values (${URL_REQUEST_SCOPE}, ${subject}, 1, null, now(), true)
            on conflict (scope, subject) do update set
              failures = case when ${expired} then 1 else a.failures + 1 end,
              last_attempt_at = case when ${expired} then now() else a.last_attempt_at end,
              last_allowed = (case when ${expired} then 1 else a.failures + 1 end) <= ${limit}::int
            returning failures, last_allowed,
              greatest(1, ceil(extract(epoch from (
                last_attempt_at + make_interval(secs => ${window}::double precision) - now()
              ))))::int as retry_after`
      )
    );
    const row = rows[0];
    if (!row) throw new Error('The request counter gave no answer');
    const allowed = row.last_allowed === true;
    return {
      allowed,
      retryAfterSec: allowed ? 0 : Math.max(1, Number(row.retry_after ?? 1)),
      count: Number(row.failures),
    };
  }

  // ---- cleanup -------------------------------------------------------------

  async expireStaleAnnounced(hours: number, limit: number): Promise<number> {
    const rows = rowsOf(
      await this.db.execute(
        sql`update content_upload_files set status = 'expired'
            where id in (
              select c.id from content_upload_files c
              where c.status = 'announced'
                and c.created_at < now() - make_interval(hours => ${hours}::int)
              order by c.created_at, c.id
              limit ${limit}::int
              for no key update of c skip locked
            )
            returning id`
      )
    );
    return rows.length;
  }

  async filesNeedingObjectRemoval(
    limit: number,
    runId?: string
  ): Promise<FileRow[]> {
    if (runId !== undefined && !isUuid(runId)) return [];
    const onlyRun = runId ? sql`and f.run_id = ${runId}::uuid` : sql``;
    const rows = rowsOf(
      await this.db.execute(
        sql`select f.* from content_upload_files f
            join content_upload_runs r on r.id = f.run_id
            where f.status <> 'merged' and ${OBJECT_KEPT} ${onlyRun}
              and (
                f.status in ('rejected', 'expired')
                or r.status = 'discarded'
                or (r.status = 'applied' and r.purge_after is not null and r.purge_after < now())
              )
            order by f.created_at, f.id
            limit ${limit}::int`
      )
    );
    return rows.map(mapFile);
  }

  /**
   * Writes the marker only for rows that still need their object removed (the
   * same condition as filesNeedingObjectRemoval). A file that came back to life
   * in the meantime (revived, announced again) is left alone.
   */
  async markObjectsDeleted(fileIds: readonly string[]): Promise<void> {
    for (const part of chunks(fileIds.filter(isUuid))) {
      await this.db.execute(
        sql`update content_upload_files f
            set parse_summary = coalesce(f.parse_summary, '{}'::jsonb) || jsonb_build_object('objectDeleted', true)
            from content_upload_runs r
            where r.id = f.run_id and f.id in (${list(part)}) and f.status <> 'merged'
              and (
                f.status in ('rejected', 'expired')
                or r.status = 'discarded'
                or (r.status = 'applied' and r.purge_after is not null and r.purge_after < now())
              )`
      );
    }
  }

  async discardStaleRuns(
    idleDays: number,
    rowsDays: number,
    limit: number
  ): Promise<string[]> {
    const rows = rowsOf(
      await this.db.execute(
        sql`update content_upload_runs
            set status = 'discarded', updated_at = now(),
                purge_after = now() + make_interval(days => ${rowsDays}::int)
            where id in (
              select r.id from content_upload_runs r
              where r.status in ('draft', 'uploading', 'processing', 'review', 'failed')
                and r.updated_at < now() - make_interval(days => ${idleDays}::int)
                and not exists (
                  select 1 from content_upload_applies a
                  where a.run_id = r.id and a.mode = 'apply'
                )
              order by r.updated_at
              limit ${limit}::int
              for update of r skip locked
            )
            returning id`
      )
    );
    return rows.map(r => String(r.id));
  }

  async deleteRunsPastPurge(limit: number): Promise<number> {
    const eligible = sql`
      select r.id from content_upload_runs r
      where r.status = 'discarded'
        and r.purge_after is not null and r.purge_after < now()
        and not exists (
          select 1 from content_upload_applies a
          where a.run_id = r.id and a.mode = 'apply'
        )
        and not exists (
          select 1 from content_upload_files f
          where f.run_id = r.id and f.status <> 'merged' and ${OBJECT_KEPT}
        )
      order by r.purge_after
      limit ${limit}::int`;
    // The log of a dry run changes nothing in the content tables: it does not
    // keep a discarded run alive. (An apply does, its rows are the rollback basis.)
    await this.db.execute(
      sql`delete from content_upload_applies
          where mode = 'dry_run' and run_id in (${eligible})`
    );
    const rows = rowsOf(
      await this.db.execute(
        sql`delete from content_upload_runs
            where id in (
              select r.id from content_upload_runs r
              where r.status = 'discarded'
                and r.purge_after is not null and r.purge_after < now()
                and not exists (select 1 from content_upload_applies a where a.run_id = r.id)
                and not exists (
                  select 1 from content_upload_files f
                  where f.run_id = r.id and f.status <> 'merged' and ${OBJECT_KEPT}
                )
              order by r.purge_after
              limit ${limit}::int
              for update of r skip locked
            )
            returning id`
      )
    );
    return rows.length;
  }

  async knownStoragePaths(paths: readonly string[]): Promise<Set<string>> {
    const known = new Set<string>();
    for (const part of chunks(paths)) {
      const rows = rowsOf(
        await this.db.execute(
          sql`select storage_path from content_upload_files
              where storage_path in (${list(part)})`
        )
      );
      for (const r of rows) known.add(String(r.storage_path));
    }
    return known;
  }
}
