// KiRepo on PostgreSQL through Drizzle (raw SQL with bound parameters, like
// staging/repo-pg.ts). The time always comes from now() of the database, so
// instances with different clocks agree on the window of the day and on the
// cool-down of the breaker.

import { sql } from 'drizzle-orm';
import {
  CALL_STATUSES,
  type KiCallStatus,
  type KiCallWrite,
  type KiRepo,
  type KiUsage,
} from '@/lib/content-upload/ki/repo';
import type { SqlDb } from '@/lib/content-upload/staging/repo-pg';
import { isUuid } from '@/lib/uuid';

type Row = Record<string, unknown>;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return (result as { rows?: Row[] } | null | undefined)?.rows ?? [];
}

const reached = sql.join(
  CALL_STATUSES.map(s => sql`${s}`),
  sql`, `
);

export class PgKiRepo implements KiRepo {
  constructor(private readonly db: SqlDb) {}

  async recordCall(call: KiCallWrite): Promise<void> {
    if (!isUuid(call.runId) || !isUuid(call.fileId)) {
      throw new Error('The ids of a call have to be uuids');
    }
    // excerpt stays null: the hash and the length are what the log keeps
    await this.db.execute(
      sql`insert into content_upload_ki_calls
            (run_id, file_id, stage, model, endpoint_host, excerpt, excerpt_chars,
             excerpt_sha256, redactions, status, http_status, latency_ms,
             prompt_tokens, completion_tokens, attempt, answer_excerpt)
          values (${call.runId}::uuid, ${call.fileId}::uuid, ${call.stage},
                  ${call.model}, ${call.endpointHost}, null, ${call.excerptChars}::int,
                  ${call.excerptSha256}, ${call.redactions}::int, ${call.status},
                  ${call.httpStatus}::int, ${call.latencyMs}::int,
                  ${call.promptTokens}::int, ${call.completionTokens}::int,
                  ${call.attempt}::int, ${call.answer})`
    );
  }

  async usage(
    runId: string,
    fileId: string | null,
    recentLimit: number
  ): Promise<KiUsage> {
    if (!isUuid(runId)) return { run: 0, day: 0, file: 0, recent: [] };
    const fileKey = fileId !== null && isUuid(fileId) ? fileId : null;
    const counts = rowsOf(
      await this.db.execute(
        sql`select
              count(*) filter (where run_id = ${runId}::uuid)::int as run,
              count(*) filter (where requested_at >= now() - interval '24 hours')::int as day,
              count(*) filter (where ${fileKey}::uuid is not null and file_id = ${fileKey}::uuid)::int as file
            from content_upload_ki_calls
            where status in (${reached})`
      )
    )[0];
    const recent = rowsOf(
      await this.db.execute(
        sql`select status, extract(epoch from (now() - requested_at))::float8 as age_sec
            from content_upload_ki_calls
            where run_id = ${runId}::uuid and status in (${reached})
            order by requested_at desc, id desc
            limit ${Math.max(0, Math.floor(recentLimit))}::int`
      )
    );
    return {
      run: Number(counts?.run ?? 0),
      day: Number(counts?.day ?? 0),
      file: Number(counts?.file ?? 0),
      recent: recent.map(r => ({
        status: String(r.status) as KiCallStatus,
        ageSec: Math.max(0, Number(r.age_sec)),
      })),
    };
  }
}
