// The comparison of the supply with the database (docs/ki-upload-konzept.md 8.9): every
// classified file of a run gets a status per content key (new, unchanged, extended,
// differs, conflict), before a person decides anything and without writing anything.
//
// It is the plan builder and the two engines of the transfer, run the same way, with
// two differences:
//   - a file without a decision counts with the assignment of its proposal (the review
//     list shows the status next to the proposal, so the person decides with it)
//   - the transaction is read-only and the engines are called with write false
//
// The result is stored with every file (parse_summary.stock: status, counts, the
// assignment it was made for, the time) and answered as counts per status. Nothing of a
// file's text leaves here: codes and numbers only. The state of the run does not change.

import { executePlan } from '@/lib/content-import/apply/engine';
import { ImportAbort } from '@/lib/content-import/apply/db';
import { PgDb, withTransaction } from '@/lib/content-import/apply/pg-db';
import {
  checkTargetFacts,
  isLoopbackHost,
  type ApplyTarget,
} from '@/lib/content-import/apply/target';
import type { ItemEvent } from '@/lib/content-import/apply/types';
import { executeUseCasePlan } from '@/lib/content-import/use-cases/engine';
import { withReservedConnection } from '@/lib/content-upload/connection';
import { UPLOAD_CATALOG_CODE } from '@/lib/content-upload/staging/config';
import {
  fail,
  ok,
  type ServiceResult,
} from '@/lib/content-upload/staging/result';
import {
  buildTransferPlan,
  TransferPlanError,
} from '@/lib/content-upload/transfer/plan';
import { transferDecisions } from '@/lib/content-upload/transfer/preset';
import {
  FIXED_ENGINE_OPTIONS,
  PLAN_BUDGET_MS,
  readConnectionFacts,
  type TransferDeps,
} from '@/lib/content-upload/transfer/run';
import {
  assignmentFingerprint,
  stockOfFiles,
  toStockReport,
  toStockWrites,
} from '@/lib/content-upload/transfer/stock';
import type {
  ExcludedFile,
  StockReport,
  TransferFile,
} from '@/lib/content-upload/transfer/types';

/** Longest wait for a free connection of the pool. */
const RESERVE_TIMEOUT_MS = 10_000;

export interface CompareRequest {
  runId: string;
  /** The profile the engines check as author (a trainer or an admin). */
  callerId: string;
}

export interface CompareReport {
  stock: StockReport;
  /** Files that were compared. */
  compared: number;
  /** Files left out before the comparison, with a code (a copy, a duplicate that is not decided). */
  excluded: ExcludedFile[];
  /** Files whose status was stored for the list. */
  stored: number;
}

/**
 * Compares the files of a run in the state review with the database and stores the
 * status per file. Writes nothing to the content.
 */
export async function compareStock(
  deps: TransferDeps,
  request: CompareRequest
): Promise<ServiceResult<CompareReport>> {
  const { store } = deps;
  const clock = deps.clock ?? (() => new Date());
  const { runId } = request;

  const state = await store.getRunState(runId);
  if (!state) return fail(404, 'Run not found');
  if (state.status !== 'review') {
    return fail(
      409,
      `A run in the state ${state.status} cannot be compared with the database`,
      'RUN_STATE'
    );
  }
  if (state.catalogCode !== UPLOAD_CATALOG_CODE) {
    return fail(
      409,
      `Only the catalog ${UPLOAD_CATALOG_CODE} can be compared`,
      'CATALOG_UNSUPPORTED'
    );
  }

  const decisions = deps.decisions ?? transferDecisions();
  const files = await store.loadFiles(runId, { effective: true });
  const components = await store.loadComponents(state.catalogId);
  const enablers = await store.loadEnablers(state.catalogId);
  let plan: Awaited<ReturnType<typeof buildTransferPlan>>;
  try {
    plan = await buildTransferPlan({
      files,
      components,
      enablers,
      decisions,
      readBytes: deps.readBytes,
      now: clock(),
      deadline: Date.now() + (deps.planBudgetMs ?? PLAN_BUDGET_MS),
    });
  } catch (error) {
    if (error instanceof TransferPlanError) {
      return fail(
        422,
        'The files could not be read in time. Compare fewer files per run.',
        'PLAN_TOO_LARGE'
      );
    }
    throw error;
  }

  const events: ItemEvent[] = [];
  let useCasesSkipped: Array<{ useCaseCode: string }> = [];
  const target: ApplyTarget = isLoopbackHost(deps.host) ? 'local' : 'preview';
  const hasItems =
    plan.importPlan.enablers.length +
      plan.importPlan.scenarios.length +
      plan.importPlan.quizzes.length +
      plan.useCasePlan.useCases.length >
    0;
  if (hasItems) {
    try {
      await withReservedConnection(
        deps.connections,
        connection =>
          withTransaction(
            connection,
            { mode: 'read-only', finish: 'rollback' },
            async () => {
              const facts = await (deps.readFacts ?? readConnectionFacts)(
                connection,
                deps.host
              );
              const problems = checkTargetFacts(target, facts);
              if (problems.length > 0) {
                throw new ImportAbort('TARGET_REFUSED', problems.join(' '));
              }
              const db = (deps.makeDb ?? (c => new PgDb(c)))(connection);
              const observe = (event: ItemEvent) => {
                events.push(event);
              };
              await executePlan(db, plan.importPlan, {
                createdBy: request.callerId,
                updateExisting: false,
                write: false,
                activate: FIXED_ENGINE_OPTIONS.activate,
                scenarioSolutions: FIXED_ENGINE_OPTIONS.scenarioSolutions,
                extendQuizzes: FIXED_ENGINE_OPTIONS.extendQuizzes,
                observe,
              });
              if (plan.useCasePlan.useCases.length > 0) {
                try {
                  const report = await executeUseCasePlan(
                    db,
                    plan.useCasePlan,
                    {
                      createdBy: request.callerId,
                      updateExisting: false,
                      write: false,
                      activate: FIXED_ENGINE_OPTIONS.activate,
                      solutions: FIXED_ENGINE_OPTIONS.useCaseSolutions,
                      observe,
                    }
                  );
                  useCasesSkipped = report.skipped;
                } catch (error) {
                  // A catalog without any enabler: every use case waits for its enabler
                  if (
                    error instanceof ImportAbort &&
                    error.code === 'NO_ENABLERS'
                  ) {
                    useCasesSkipped = plan.useCasePlan.useCases.map(u => ({
                      useCaseCode: u.code,
                    }));
                  } else {
                    throw error;
                  }
                }
              }
            }
          ),
        { reserveTimeoutMs: deps.reserveTimeoutMs ?? RESERVE_TIMEOUT_MS }
      );
    } catch (error) {
      if (error instanceof ImportAbort) {
        return fail(
          409,
          error.code === 'TARGET_REFUSED'
            ? 'The database does not fit the target: only a local database or the Preview is allowed.'
            : error.message.slice(0, 300),
          error.code
        );
      }
      throw error;
    }
  }

  const stock = stockOfFiles({
    events,
    importPlan: plan.importPlan,
    useCasePlan: plan.useCasePlan,
    fileOfSource: plan.fileOfSource,
    useCasesSkippedInDb: useCasesSkipped,
  });
  const fileById = new Map<string, TransferFile>(files.map(f => [f.id, f]));
  // The comparison replaces what an earlier one stored, in one statement: a file that
  // is left out now (a duplicate that is open again) must not keep an old status
  const stored = await store.replaceStock(
    runId,
    toStockWrites(
      stock,
      id => {
        const file = fileById.get(id);
        return file ? assignmentFingerprint(file.decision) : undefined;
      },
      clock().toISOString()
    )
  );
  return ok({
    stock: toStockReport(stock, id => fileById.get(id)?.fileName),
    compared: stock.size,
    excluded: plan.excluded,
    stored,
  });
}
