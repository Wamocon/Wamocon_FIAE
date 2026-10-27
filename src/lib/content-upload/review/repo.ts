// The data access of the review list as one interface (package U6), next to
// UploadRepo of the staging. Two implementations exist:
//
//   review/repo-pg.ts                  SQL through Drizzle, what the routes use
//   tests/helpers/memoryReviewRepo     the same rules in memory, held to them by
//                                      the same contract test
//
// The rules the SQL keeps and the interface only names:
//
//  - applyDecisions runs in one transaction under a lock on the row of the run.
//    It writes only in the state `review` (409 otherwise) and only when the
//    version the person saw is still the current one (409 otherwise). Every write
//    raises decisions_version by one and clears last_dry_run_hash: a dry run
//    that was made before is no longer valid (the hash itself and the apply are
//    package U7).
//  - A decision is a new row, the old one only loses is_current. Nothing is
//    deleted.
//  - writeProposal only writes while the claim of the file is still the
//    caller's, like finishClaim of the queue.

import type { RunStatus } from '@/lib/content-upload/staging/status';
import type {
  CatalogComponentRow,
  DecisionAction,
  DupChoice,
  ProposalRecord,
  ProposalWrite,
  ReviewRecord,
} from '@/lib/content-upload/review/types';

export interface DecisionWriteItem {
  fileId: string;
  /**
   * The current proposal the person saw. The item is skipped when the file has
   * another current proposal by now (a later pass of the queue).
   */
  proposalId: string | null;
  action: DecisionAction;
  docType: string | null;
  componentCode: string | null;
  enablerCode: string | null;
  quizLevel: string | null;
  dupChoice: DupChoice | null;
  note: string | null;
}

/** The last item of every file: two items for one file would be two current decisions. */
export function lastPerFile(
  items: readonly DecisionWriteItem[]
): DecisionWriteItem[] {
  const byFile = new Map<string, DecisionWriteItem>();
  for (const item of items) byFile.set(item.fileId, item);
  return [...byFile.values()];
}

export interface ApplyDecisionsInput {
  runId: string;
  /** decisions_version the person saw. */
  expectedVersion: number;
  decidedById: string;
  items: readonly DecisionWriteItem[];
}

export interface SkippedItem {
  fileId: string;
  code: 'FILE_NOT_FOUND' | 'FILE_STATE' | 'PROPOSAL_CHANGED';
}

export type ApplyDecisionsResult =
  | {
      ok: true;
      /** decisions_version after the write (unchanged when nothing was written). */
      version: number;
      written: number;
      skipped: SkippedItem[];
    }
  | { ok: false; reason: 'RUN_NOT_FOUND' }
  | { ok: false; reason: 'RUN_STATE'; status: RunStatus }
  | { ok: false; reason: 'VERSION_CONFLICT'; current: number };

export interface RunStat {
  runId: string;
  /** Files of the run that are not expired and not merged copies. */
  files: number;
  /** Files with a current decision. */
  decided: number;
  /** Name of the person who created the run (profiles.full_name), if known. */
  createdByName: string | null;
}

export type ReopenRunResult =
  | { ok: true; version: number }
  | { ok: false; reason: 'RUN_NOT_FOUND' }
  | { ok: false; reason: 'RUN_STATE'; status: RunStatus };

/** States a run can be taken back to review from (a further apply starts there). */
export const REOPENABLE: readonly RunStatus[] = ['applied', 'failed'];

export interface ReviewRepo {
  /**
   * Takes a run in the state applied or failed back to review, in one step: the
   * version of the decisions goes up and the hash of the last dry run is cleared,
   * like at every change of a decision, so a dry run made before cannot be used.
   */
  reopenRun(runId: string): Promise<ReopenRunResult>;
  /** Counts per run for the list of runs. */
  runStats(runIds: readonly string[]): Promise<RunStat[]>;
  /** Every file of the run with its current proposal and decision, by path. */
  listRecords(runId: string): Promise<ReviewRecord[]>;
  /**
   * Makes `write` the current proposal of the file, but only while `claimId` is
   * still the claim of the file. Returns false when the claim was lost.
   */
  writeProposal(
    fileId: string,
    claimId: string,
    write: ProposalWrite
  ): Promise<boolean>;
  /** The components of a catalog with their enablers (the positive list of the database). */
  catalogComponents(catalogId: string): Promise<CatalogComponentRow[]>;
  /** The current proposal of a file, or null (the Sokrates stage reads the rule proposal). */
  currentProposal(fileId: string): Promise<ProposalRecord | null>;
  /**
   * Texts of solutions that already stand in the database (rationales and correct
   * options of questions, documents for the trainer), at most `limit`, each at most
   * 5000 characters. They are only searched for in an excerpt, never sent.
   */
  existingSolutionTexts(limit: number): Promise<string[]>;
  applyDecisions(input: ApplyDecisionsInput): Promise<ApplyDecisionsResult>;
}
