// ReviewRepo on PostgreSQL through Drizzle (raw SQL with bound parameters, like
// staging/repo-pg.ts). What the SQL guarantees is listed in repo.ts. In short:
// decisions are written in one transaction under a lock on the row of the run, only
// in the state `review` and only for the version the caller saw, every write raises
// decisions_version and clears last_dry_run_hash, and a proposal is written only
// while the claim of the file is still the caller's.

import { sql, type SQL } from 'drizzle-orm';
import type {
  ApplyDecisionsInput,
  ApplyDecisionsResult,
  ReopenRunResult,
  ReviewRepo,
  RunStat,
  SkippedItem,
} from '@/lib/content-upload/review/repo';
import { REOPENABLE, lastPerFile } from '@/lib/content-upload/review/repo';
import { DECIDABLE } from '@/lib/content-upload/review/states';
import type {
  CatalogComponentRow,
  DecisionRecord,
  ProposalRecord,
  ProposalWrite,
  ReviewRecord,
} from '@/lib/content-upload/review/types';
import { mapFile, type SqlDb } from '@/lib/content-upload/staging/repo-pg';
import type { RunStatus } from '@/lib/content-upload/staging/status';
import { isUuid } from '@/lib/uuid';

type Row = Record<string, unknown>;

const MAX_IN_LIST = 500;

function rowsOf(result: unknown): Row[] {
  if (Array.isArray(result)) return result as Row[];
  return (result as { rows?: Row[] } | null | undefined)?.rows ?? [];
}

function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

const text = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

function list(values: readonly unknown[]): SQL {
  return sql.join(
    values.map(v => sql`${v}`),
    sql`, `
  );
}

function chunks<T>(values: readonly T[], size = MAX_IN_LIST): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size) {
    out.push(values.slice(i, i + size));
  }
  return out;
}

/** A lock or statement timeout ends the transaction instead of letting it wait for ever. */
async function limitWaiting(tx: SqlDb): Promise<void> {
  await tx.execute(sql`set local lock_timeout = '5s'`);
  await tx.execute(sql`set local statement_timeout = '30s'`);
  await tx.execute(sql`set local idle_in_transaction_session_timeout = '30s'`);
}

function mapProposal(r: Row): ProposalRecord | null {
  if (r.p_id === null || r.p_id === undefined) return null;
  const reasons = Array.isArray(r.p_reasons) ? r.p_reasons : [];
  return {
    id: String(r.p_id),
    fileId: String(r.id),
    source: String(r.p_source) as ProposalRecord['source'],
    docType: text(r.p_doc_type),
    componentCode: text(r.p_component_code),
    enablerCode: text(r.p_enabler_code),
    quizLevel: text(r.p_quiz_level),
    confidence: Number(r.p_confidence),
    band: String(r.p_band) as ProposalRecord['band'],
    reasons: reasons as ProposalRecord['reasons'],
    model: text(r.p_model),
    createdAt: toDate(r.p_created_at),
  };
}

function mapDecision(r: Row): DecisionRecord | null {
  if (r.d_id === null || r.d_id === undefined) return null;
  return {
    id: String(r.d_id),
    fileId: String(r.id),
    proposalId: text(r.d_proposal_id),
    decisionsVersion: Number(r.d_decisions_version),
    decidedById: String(r.d_decided_by_id),
    action: String(r.d_action) as DecisionRecord['action'],
    docType: text(r.d_doc_type),
    componentCode: text(r.d_component_code),
    enablerCode: text(r.d_enabler_code),
    quizLevel: text(r.d_quiz_level),
    dupChoice: text(r.d_dup_choice) as DecisionRecord['dupChoice'],
    note: text(r.d_note),
    decidedAt: toDate(r.d_decided_at),
  };
}

export class PgReviewRepo implements ReviewRepo {
  constructor(private readonly db: SqlDb) {}

  async listRecords(runId: string): Promise<ReviewRecord[]> {
    if (!isUuid(runId)) return [];
    const rows = rowsOf(
      await this.db.execute(
        sql`select f.*,
              p.id as p_id, p.source as p_source, p.doc_type as p_doc_type,
              p.component_code as p_component_code, p.enabler_code as p_enabler_code,
              p.quiz_level as p_quiz_level, p.confidence as p_confidence,
              p.band as p_band, p.reasons as p_reasons, p.model as p_model,
              p.created_at as p_created_at,
              d.id as d_id, d.proposal_id as d_proposal_id,
              d.decisions_version as d_decisions_version,
              d.decided_by_id as d_decided_by_id, d.action as d_action,
              d.doc_type as d_doc_type, d.component_code as d_component_code,
              d.enabler_code as d_enabler_code, d.quiz_level as d_quiz_level,
              d.dup_choice as d_dup_choice, d.note as d_note,
              d.decided_at as d_decided_at
            from content_upload_files f
            left join content_upload_proposals p on p.file_id = f.id and p.is_current
            left join content_upload_decisions d on d.file_id = f.id and d.is_current
            where f.run_id = ${runId}::uuid
            order by f.rel_path, f.id`
      )
    );
    return rows.map(r => ({
      file: mapFile(r),
      proposal: mapProposal(r),
      decision: mapDecision(r),
    }));
  }

  async runStats(runIds: readonly string[]): Promise<RunStat[]> {
    const ids = runIds.filter(isUuid);
    if (ids.length === 0) return [];
    const rows = rowsOf(
      await this.db.execute(
        sql`select r.id as run_id, p.full_name as created_by_name,
              (select count(*)::int from content_upload_files f
                 where f.run_id = r.id and f.status not in ('expired', 'merged')) as files,
              (select count(*)::int from content_upload_decisions d
                 where d.run_id = r.id and d.is_current) as decided
            from content_upload_runs r
            left join profiles p on p.id = r.created_by_id
            where r.id in (${list(ids)})`
      )
    );
    return rows.map(r => ({
      runId: String(r.run_id),
      files: Number(r.files),
      decided: Number(r.decided),
      createdByName: text(r.created_by_name),
    }));
  }

  async writeProposal(
    fileId: string,
    claimId: string,
    write: ProposalWrite
  ): Promise<boolean> {
    if (!isUuid(fileId) || !isUuid(claimId)) return false;
    return this.db.transaction(async tx => {
      await limitWaiting(tx);
      // The claim is checked under a lock on the file: a call that lost its claim
      // writes nothing, and the old proposal is retired only when the new one comes
      const held = rowsOf(
        await tx.execute(
          sql`select id from content_upload_files
              where id = ${fileId}::uuid and claim_id = ${claimId}::uuid
              for update`
        )
      );
      if (held.length === 0) return false;
      await tx.execute(
        sql`update content_upload_proposals set is_current = false
            where file_id = ${fileId}::uuid and is_current`
      );
      await tx.execute(
        sql`insert into content_upload_proposals
              (file_id, source, doc_type, component_code, enabler_code, quiz_level,
               confidence, band, reasons, model, is_current)
            values (${fileId}::uuid, ${write.source}, ${write.docType},
                    ${write.componentCode}, ${write.enablerCode}, ${write.quizLevel},
                    ${write.confidence}::numeric, ${write.band},
                    ${JSON.stringify(write.reasons)}::jsonb, ${write.model}, true)`
      );
      return true;
    });
  }

  async currentProposal(fileId: string): Promise<ProposalRecord | null> {
    if (!isUuid(fileId)) return null;
    const rows = rowsOf(
      await this.db.execute(
        sql`select ${fileId}::uuid as id,
              p.id as p_id, p.source as p_source, p.doc_type as p_doc_type,
              p.component_code as p_component_code, p.enabler_code as p_enabler_code,
              p.quiz_level as p_quiz_level, p.confidence as p_confidence,
              p.band as p_band, p.reasons as p_reasons, p.model as p_model,
              p.created_at as p_created_at
            from content_upload_proposals p
            where p.file_id = ${fileId}::uuid and p.is_current`
      )
    );
    return rows[0] ? mapProposal(rows[0]) : null;
  }

  async latestRuleProposal(fileId: string): Promise<ProposalRecord | null> {
    if (!isUuid(fileId)) return null;
    const rows = rowsOf(
      await this.db.execute(
        sql`select ${fileId}::uuid as id,
              p.id as p_id, p.source as p_source, p.doc_type as p_doc_type,
              p.component_code as p_component_code, p.enabler_code as p_enabler_code,
              p.quiz_level as p_quiz_level, p.confidence as p_confidence,
              p.band as p_band, p.reasons as p_reasons, p.model as p_model,
              p.created_at as p_created_at
            from content_upload_proposals p
            where p.file_id = ${fileId}::uuid and p.source <> 'ki'
            order by p.created_at desc, p.id desc
            limit 1`
      )
    );
    return rows[0] ? mapProposal(rows[0]) : null;
  }

  async existingSolutionTexts(limit: number): Promise<string[]> {
    const rows = rowsOf(
      await this.db.execute(
        sql`select t from (
              select left(explanation, 5000) as t from options
                where explanation is not null and char_length(explanation) >= 20
              union all
              select left(option_text, 5000) from options
                where is_correct and char_length(option_text) >= 20
              union all
              select left(description, 5000) from content_documents
                where document_type = 'TRAINER_SOLUTION'
                  and description is not null and char_length(description) >= 20
            ) s
            limit ${Math.max(0, Math.floor(limit))}::int`
      )
    );
    return rows.map(r => String(r.t));
  }

  async catalogComponents(catalogId: string): Promise<CatalogComponentRow[]> {
    if (!isUuid(catalogId)) return [];
    const components = rowsOf(
      await this.db.execute(
        sql`select code, title, kind, phase from training_components
            where training_catalog_id = ${catalogId}::uuid
            order by order_index, code`
      )
    );
    const enablers = rowsOf(
      await this.db.execute(
        sql`select e.code as code, e.title as title, tc.code as component_code
            from enablers e
            join courses c on c.id = e.course_id
            join training_components tc
              on tc.id = c.training_component_id
             and tc.training_catalog_id = c.training_catalog_id
            where tc.training_catalog_id = ${catalogId}::uuid
              and e.code is not null
            order by e.code`
      )
    );
    const byComponent = new Map<
      string,
      { code: string; title: string | null }[]
    >();
    for (const e of enablers) {
      const key = String(e.component_code);
      const entry = { code: String(e.code), title: text(e.title) };
      const existing = byComponent.get(key);
      if (existing) existing.push(entry);
      else byComponent.set(key, [entry]);
    }
    return components.map(c => ({
      code: String(c.code),
      title: text(c.title),
      kind: text(c.kind) as CatalogComponentRow['kind'],
      phase: c.phase === null || c.phase === undefined ? null : Number(c.phase),
      enablers: byComponent.get(String(c.code)) ?? [],
    }));
  }

  async reopenRun(runId: string): Promise<ReopenRunResult> {
    if (!isUuid(runId)) return { ok: false, reason: 'RUN_NOT_FOUND' };
    return this.db.transaction(async tx => {
      await limitWaiting(tx);
      const rows = rowsOf(
        await tx.execute(
          sql`select status from content_upload_runs
              where id = ${runId}::uuid for update`
        )
      );
      if (rows.length === 0) return { ok: false, reason: 'RUN_NOT_FOUND' };
      const status = String(rows[0].status) as RunStatus;
      if (!(REOPENABLE as readonly string[]).includes(status)) {
        return { ok: false, reason: 'RUN_STATE', status };
      }
      const updated = rowsOf(
        await tx.execute(
          sql`update content_upload_runs
              set status = 'review',
                  decisions_version = decisions_version + 1,
                  last_dry_run_hash = null,
                  updated_at = now()
              where id = ${runId}::uuid
              returning decisions_version`
        )
      );
      return { ok: true, version: Number(updated[0].decisions_version) };
    });
  }

  async applyDecisions(
    input: ApplyDecisionsInput
  ): Promise<ApplyDecisionsResult> {
    if (!isUuid(input.runId)) return { ok: false, reason: 'RUN_NOT_FOUND' };
    return this.db.transaction(async tx => {
      await limitWaiting(tx);
      const runRows = rowsOf(
        await tx.execute(
          sql`select status, decisions_version from content_upload_runs
              where id = ${input.runId}::uuid for update`
        )
      );
      if (runRows.length === 0) return { ok: false, reason: 'RUN_NOT_FOUND' };
      const status = String(runRows[0].status) as RunStatus;
      const current = Number(runRows[0].decisions_version);
      if (status !== 'review')
        return { ok: false, reason: 'RUN_STATE', status };
      if (current !== input.expectedVersion) {
        return { ok: false, reason: 'VERSION_CONFLICT', current };
      }

      // What the files are like now (under the lock of the run)
      const known = new Map<
        string,
        { status: string; proposalId: string | null }
      >();
      const items = lastPerFile(input.items);
      const wanted = items.map(i => i.fileId).filter(isUuid);
      for (const part of chunks(wanted)) {
        const rows = rowsOf(
          await tx.execute(
            sql`select f.id, f.status, p.id as proposal_id
                from content_upload_files f
                left join content_upload_proposals p on p.file_id = f.id and p.is_current
                where f.run_id = ${input.runId}::uuid and f.id in (${list(part)})
                for update of f`
          )
        );
        for (const r of rows) {
          known.set(String(r.id), {
            status: String(r.status),
            proposalId: text(r.proposal_id),
          });
        }
      }

      const skipped: SkippedItem[] = [];
      const valid = items.filter(item => {
        const file = known.get(item.fileId);
        if (!file) {
          skipped.push({ fileId: item.fileId, code: 'FILE_NOT_FOUND' });
          return false;
        }
        if (!(DECIDABLE as readonly string[]).includes(file.status)) {
          skipped.push({ fileId: item.fileId, code: 'FILE_STATE' });
          return false;
        }
        if (file.proposalId !== item.proposalId) {
          skipped.push({ fileId: item.fileId, code: 'PROPOSAL_CHANGED' });
          return false;
        }
        return true;
      });
      if (valid.length === 0) {
        return { ok: true, version: current, written: 0, skipped };
      }

      for (const part of chunks(valid)) {
        await tx.execute(
          sql`update content_upload_decisions set is_current = false
              where is_current and file_id in (${list(part.map(i => i.fileId))})`
        );
        const values = sql.join(
          part.map(
            i =>
              sql`(${input.runId}::uuid, ${i.fileId}::uuid, ${i.proposalId}::uuid,
                   ${input.expectedVersion}::int, ${input.decidedById}::uuid,
                   ${i.action}, ${i.docType}, ${i.componentCode}, ${i.enablerCode},
                   ${i.quizLevel}, ${i.dupChoice}, ${i.note}, true)`
          ),
          sql`, `
        );
        await tx.execute(
          sql`insert into content_upload_decisions
                (run_id, file_id, proposal_id, decisions_version, decided_by_id,
                 action, doc_type, component_code, enabler_code, quiz_level,
                 dup_choice, note, is_current)
              values ${values}`
        );
        await tx.execute(
          sql`update content_upload_files set status = 'decided'
              where run_id = ${input.runId}::uuid
                and id in (${list(part.map(i => i.fileId))})
                and status in ('proposed_rules', 'unclear', 'proposed_ki')`
        );
      }
      // Any change of a decision makes an earlier dry run invalid
      const bumped = rowsOf(
        await tx.execute(
          sql`update content_upload_runs
              set decisions_version = decisions_version + 1,
                  last_dry_run_hash = null,
                  updated_at = now()
              where id = ${input.runId}::uuid
              returning decisions_version`
        )
      );
      return {
        ok: true,
        version: Number(bumped[0].decisions_version),
        written: valid.length,
        skipped,
      };
    });
  }
}
