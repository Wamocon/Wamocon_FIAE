// ReviewRepo in memory, for the unit tests. It works on the runs and files of a
// MemoryUploadRepo and follows the rules of the SQL implementation
// (src/lib/content-upload/review/repo-pg.ts), held to them by the same contract
// test (tests/unit/lib/content-upload/review-contract.ts).

import { randomUUID } from 'crypto';
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
import type { MemoryUploadRepo } from './memoryUploadRepo';

type StoredProposal = ProposalRecord & { isCurrent: boolean };

export class MemoryReviewRepo implements ReviewRepo {
  proposals: StoredProposal[] = [];
  /** All rows, also the retired ones (the history). */
  decisionRows: (DecisionRecord & { runId: string; isCurrent: boolean })[] = [];
  /** The components of the catalog KFBM of the memory repository. */
  components: CatalogComponentRow[] = [];
  catalogId = 'catalog-kfbm';
  names = new Map<string, string>();
  /** Set by the tests: last_dry_run_hash of the runs (U7 writes it, U6 only clears it). */
  dryRunHash = new Map<string, string | null>();

  constructor(readonly upload: MemoryUploadRepo) {}

  private async tick() {
    await Promise.resolve();
  }

  currentProposal(fileId: string): ProposalRecord | null {
    return this.proposals.find(p => p.fileId === fileId && p.isCurrent) ?? null;
  }

  currentDecision(fileId: string) {
    return (
      this.decisionRows.find(d => d.fileId === fileId && d.isCurrent) ?? null
    );
  }

  /** Test helper: a current proposal without a claim. */
  addProposal(fileId: string, write: ProposalWrite): ProposalRecord {
    for (const p of this.proposals) {
      if (p.fileId === fileId) p.isCurrent = false;
    }
    const record: StoredProposal = {
      id: randomUUID(),
      fileId,
      ...write,
      createdAt: this.upload.now(),
      isCurrent: true,
    };
    this.proposals.push(record);
    return record;
  }

  async listRecords(runId: string): Promise<ReviewRecord[]> {
    await this.tick();
    return [...this.upload.files.values()]
      .filter(f => f.runId === runId)
      .sort(
        (a, b) =>
          (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0) ||
          (a.id < b.id ? -1 : 1)
      )
      .map(file => ({
        file: {
          ...file,
          parseSummary: file.parseSummary ? { ...file.parseSummary } : null,
        },
        proposal: this.currentProposal(file.id),
        decision: this.currentDecision(file.id),
      }));
  }

  async runStats(runIds: readonly string[]): Promise<RunStat[]> {
    await this.tick();
    return runIds
      .filter(id => this.upload.runs.has(id))
      .map(runId => {
        const run = this.upload.runs.get(runId)!;
        const files = [...this.upload.files.values()].filter(
          f =>
            f.runId === runId && f.status !== 'expired' && f.status !== 'merged'
        ).length;
        const decided = this.decisionRows.filter(
          d => d.runId === runId && d.isCurrent
        ).length;
        return {
          runId,
          files,
          decided,
          createdByName: this.names.get(run.createdById) ?? null,
        };
      });
  }

  async writeProposal(
    fileId: string,
    claimId: string,
    write: ProposalWrite
  ): Promise<boolean> {
    await this.tick();
    const file = this.upload.files.get(fileId);
    if (!file || file.claimId !== claimId) return false;
    this.addProposal(fileId, write);
    return true;
  }

  async catalogComponents(catalogId: string): Promise<CatalogComponentRow[]> {
    await this.tick();
    if (catalogId !== this.catalogId) return [];
    return this.components.map(c => ({ ...c, enablers: [...c.enablers] }));
  }

  async reopenRun(runId: string): Promise<ReopenRunResult> {
    await this.tick();
    const run = this.upload.runs.get(runId);
    if (!run) return { ok: false, reason: 'RUN_NOT_FOUND' };
    if (!(REOPENABLE as readonly string[]).includes(run.status)) {
      return { ok: false, reason: 'RUN_STATE', status: run.status };
    }
    run.status = 'review';
    run.decisionsVersion += 1;
    run.updatedAt = this.upload.now();
    this.dryRunHash.set(run.id, null);
    return { ok: true, version: run.decisionsVersion };
  }

  async applyDecisions(
    input: ApplyDecisionsInput
  ): Promise<ApplyDecisionsResult> {
    await this.tick();
    const run = this.upload.runs.get(input.runId);
    if (!run) return { ok: false, reason: 'RUN_NOT_FOUND' };
    if (run.status !== 'review') {
      return { ok: false, reason: 'RUN_STATE', status: run.status };
    }
    if (run.decisionsVersion !== input.expectedVersion) {
      return {
        ok: false,
        reason: 'VERSION_CONFLICT',
        current: run.decisionsVersion,
      };
    }
    const skipped: SkippedItem[] = [];
    const valid = lastPerFile(input.items).filter(item => {
      const file = this.upload.files.get(item.fileId);
      if (!file || file.runId !== input.runId) {
        skipped.push({ fileId: item.fileId, code: 'FILE_NOT_FOUND' });
        return false;
      }
      if (!(DECIDABLE as readonly string[]).includes(file.status)) {
        skipped.push({ fileId: item.fileId, code: 'FILE_STATE' });
        return false;
      }
      if ((this.currentProposal(file.id)?.id ?? null) !== item.proposalId) {
        skipped.push({ fileId: item.fileId, code: 'PROPOSAL_CHANGED' });
        return false;
      }
      return true;
    });
    if (valid.length === 0) {
      return {
        ok: true,
        version: run.decisionsVersion,
        written: 0,
        skipped,
      };
    }
    for (const item of valid) {
      for (const d of this.decisionRows) {
        if (d.fileId === item.fileId) d.isCurrent = false;
      }
      this.decisionRows.push({
        id: randomUUID(),
        runId: input.runId,
        fileId: item.fileId,
        proposalId: item.proposalId,
        decisionsVersion: input.expectedVersion,
        decidedById: input.decidedById,
        action: item.action,
        docType: item.docType,
        componentCode: item.componentCode,
        enablerCode: item.enablerCode,
        quizLevel: item.quizLevel,
        dupChoice: item.dupChoice,
        note: item.note,
        decidedAt: this.upload.now(),
        isCurrent: true,
      });
      const file = this.upload.files.get(item.fileId)!;
      if (
        file.status === 'proposed_rules' ||
        file.status === 'unclear' ||
        file.status === 'proposed_ki'
      ) {
        file.status = 'decided';
      }
    }
    run.decisionsVersion += 1;
    run.updatedAt = this.upload.now();
    this.dryRunHash.set(run.id, null);
    return {
      ok: true,
      version: run.decisionsVersion,
      written: valid.length,
      skipped,
    };
  }
}
