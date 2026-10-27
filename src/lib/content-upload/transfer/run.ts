// The dry run and the apply of a run (package U7 of docs/ki-upload-konzept.md,
// section 8). One function, two modes, the same path:
//
//   1. read the decisions and the components, build the plan (files are read and
//      parsed here, NO database connection is held)
//   2. the gate: one conditional update moves the run from review to applying. For an
//      apply it only passes if the hash of the dry run is the hash of THIS plan
//   3. one reserved connection, one transaction (isolation repeatable read, advisory
//      lock): check the target (host, schema, role), run the content engine and the
//      use case engine on the same connection, and for an apply write the protocol
//      (the apply, every row it wrote with its values before, the files, the run)
//   4. the transaction commits for an apply and rolls back for a dry run. Whatever
//      happens, the run leaves "applying" again: back to review (dry run, failure) or
//      to applied (committed apply)
//
// Fixed on purpose and by test: nothing is activated (activate false), the solution
// parts of scenarios and use cases are never written (the switches stay false). The
// engines never delete.
//
// A supply of content (docs 8.9): what is new is inserted and the missing questions of an
// existing quiz are added (extendQuizzes, always). A row that exists and differs from the
// file is NOT written, unless a person named exactly that file in replaceFiles. The run
// reports the status per file (new, unchanged, extended, differs, conflict) and stores it
// for the review list.

import { executePlan } from '@/lib/content-import/apply/engine';
import { ImportAbort, type Db } from '@/lib/content-import/apply/db';
import {
  PgDb,
  withTransaction,
  type Queryable,
} from '@/lib/content-import/apply/pg-db';
import {
  checkTargetFacts,
  isLoopbackHost,
  type ApplyTarget,
  type ConnectionFacts,
} from '@/lib/content-import/apply/target';
import type {
  Decisions,
  ItemEvent,
  TableCount,
} from '@/lib/content-import/apply/types';
import { scenarioSolutionTexts } from '@/lib/content-import/apply/guard';
import { solutionTextsOfUseCases } from '@/lib/content-import/use-cases/guard';
import { executeUseCasePlan } from '@/lib/content-import/use-cases/engine';
import {
  withReservedConnection,
  type ConnectionSource,
} from '@/lib/content-upload/connection';
import {
  LIMITS,
  UPLOAD_CATALOG_CODE,
} from '@/lib/content-upload/staging/config';
import {
  fail,
  ok,
  type ServiceResult,
} from '@/lib/content-upload/staging/result';
import { planAttribution } from '@/lib/content-upload/transfer/attribution';
import { decisionsHash } from '@/lib/content-upload/transfer/canonical';
import {
  assignmentFingerprint,
  countStock,
  stockOfFiles,
  updateFilterFor,
  type FileStock,
} from '@/lib/content-upload/transfer/stock';
import {
  copyOriginals,
  evaluateOriginals,
  toEnablerOriginals,
  type ContentBucketPort,
} from '@/lib/content-upload/transfer/originals';
import {
  buildTransferPlan,
  TransferPlanError,
} from '@/lib/content-upload/transfer/plan';
import { transferDecisions } from '@/lib/content-upload/transfer/preset';
import { RecordingDb } from '@/lib/content-upload/transfer/record';
import type {
  ApplyRecord,
  TransferStore,
} from '@/lib/content-upload/transfer/store';
import type {
  OriginalRefusal,
  StockReport,
  TransferFile,
  TransferMode,
  TransferReport,
} from '@/lib/content-upload/transfer/types';

/** A run that has been applying for this long is taken as aborted and given back. */
export const STALE_APPLYING_MINUTES = 15;

/**
 * Time the plan builder may spend reading and parsing files. The routes run for 60
 * seconds at most (maxDuration), the engines and the protocol need a few more.
 */
export const PLAN_BUDGET_MS = 40_000;

/** Time the copies of originals to the public bucket may take. */
const COPY_BUDGET_MS = 15_000;

/** Longest wait for a free connection of the pool. */
const RESERVE_TIMEOUT_MS = 10_000;

/**
 * What every run passes to the engines, whatever the request says or the presets
 * file holds: nothing is activated and no solution part of a scenario or a use case
 * is written (concept 8.1 point 4, 8.4). A test fails when one of them changes.
 */
export const FIXED_ENGINE_OPTIONS = Object.freeze({
  activate: false,
  scenarioSolutions: false,
  useCaseSolutions: false,
  extendQuizzes: true,
} as const);

export interface TransferDeps {
  store: TransferStore;
  /** Reserved connections for the engines (connection.ts). */
  connections: ConnectionSource;
  /** The bytes of a staging object, or null when it is gone. */
  readBytes: (file: TransferFile) => Promise<Uint8Array | null>;
  /** Host of the connection string of the app (null when unreadable: the target is refused). */
  host: string | null;
  /** Presets. Default: scripts/import/kfbm-decisions.json (activation forced off). */
  decisions?: Decisions;
  /** The public bucket, asked for only when originals are copied. */
  contentBucket?: () => ContentBucketPort;
  /** The engine side of a connection. Default: PgDb. */
  makeDb?: (connection: Queryable) => Db;
  /** The facts of the connection. Default: one statement on it. */
  readFacts?: (
    connection: Queryable,
    host: string | null
  ) => Promise<ConnectionFacts>;
  clock?: () => Date;
  reserveTimeoutMs?: number;
  /** Time the plan builder may spend reading files, in milliseconds. */
  planBudgetMs?: number;
}

export interface TransferRequest {
  runId: string;
  /** The profile that is entered as author of the rows and as the one who applied. */
  callerId: string;
  mode: TransferMode;
  /**
   * Ids of the files whose differing rows are replaced by this run (the decision of a
   * person for exactly these files). Empty: only new rows and added questions are written.
   */
  replaceFiles: readonly string[];
  /** File ids of enabler texts whose original goes to the public document bucket. */
  publishOriginals: readonly string[];
  /** The catalog code, typed by the person. Required for an apply. */
  confirm?: string;
}

/** Facts of the connection the target check compares with (as scripts/import/kfbm-session.mjs). */
export async function readConnectionFacts(
  connection: Queryable,
  host: string | null
): Promise<ConnectionFacts> {
  const result = await connection.query(
    `select current_schema() as current_schema,
            current_user as current_role,
            session_user as session_role,
            (select n.nspname from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
              where c.oid = to_regclass('training_catalogs')) as resolved_schema,
            (exists (select 1 from pg_namespace
                      where nspname in ('public_preview', 'preview_meta'))
             or exists (select 1 from pg_roles
                         where rolname in ('app_preview', 'app_preview_migrator'))
            ) as has_preview_markers`
  );
  const row = result.rows[0] ?? {};
  const text = (value: unknown) =>
    value === null || value === undefined ? null : String(value);
  return {
    host,
    currentSchema: text(row.current_schema),
    resolvedSchema: text(row.resolved_schema),
    currentUser: text(row.current_role),
    sessionUser: text(row.session_role),
    hasPreviewMarkers: row.has_preview_markers === true,
  };
}

const addCounts = (a: TableCount, b: TableCount): TableCount => ({
  insert: a.insert + b.insert,
  update: a.update + b.update,
  unchanged: a.unchanged + b.unchanged,
});

function errorCodeOf(error: unknown): string {
  if (error instanceof ImportAbort) return error.code;
  const code =
    (error as { code?: unknown } | null)?.code ??
    (error as { cause?: { code?: unknown } } | null)?.cause?.code;
  return typeof code === 'string' ? code : 'UNEXPECTED';
}

/** Text of an abort for the person. The target check never names the host. */
function messageOf(abort: ImportAbort): string {
  if (abort.code === 'TARGET_REFUSED') {
    return 'The database does not fit the target: only a local database or the Preview is allowed.';
  }
  return abort.message.slice(0, 300);
}

const counted = (tables: Record<string, TableCount>) =>
  Object.fromEntries(
    Object.entries(tables).filter(
      ([, c]) => c.insert + c.update + c.unchanged > 0
    )
  );

export async function runTransfer(
  deps: TransferDeps,
  request: TransferRequest
): Promise<ServiceResult<TransferReport>> {
  const { store } = deps;
  const clock = deps.clock ?? (() => new Date());
  const started = clock();
  const { runId, mode } = request;
  const replaceFiles = [...new Set(request.replaceFiles)].sort();
  const replaceSet: ReadonlySet<string> = new Set(replaceFiles);

  if (mode === 'apply' && request.confirm !== UPLOAD_CATALOG_CODE) {
    return fail(
      400,
      `Type the catalog code ${UPLOAD_CATALOG_CODE} to confirm the apply`,
      'CONFIRM_REQUIRED'
    );
  }

  let state = await store.getRunState(runId);
  if (!state) return fail(404, 'Run not found');
  if (
    state.status === 'applying' &&
    (await store.releaseStale(runId, STALE_APPLYING_MINUTES))
  ) {
    state = (await store.getRunState(runId)) ?? state;
  }
  if (state.status !== 'review') {
    return fail(
      409,
      `A run in the state ${state.status} cannot be ${mode === 'apply' ? 'applied' : 'tried'}`,
      'RUN_STATE'
    );
  }
  if (state.catalogCode !== UPLOAD_CATALOG_CODE) {
    return fail(
      409,
      `Only the catalog ${UPLOAD_CATALOG_CODE} can be transferred`,
      'CATALOG_UNSUPPORTED'
    );
  }

  // 1. The plan, without a connection of the engines --------------------------------
  const decisions = deps.decisions ?? transferDecisions();
  const files = await store.loadFiles(runId);
  const components = await store.loadComponents(state.catalogId);
  let plan: Awaited<ReturnType<typeof buildTransferPlan>>;
  try {
    plan = await buildTransferPlan({
      files,
      components,
      decisions,
      readBytes: deps.readBytes,
      now: started,
      deadline: Date.now() + (deps.planBudgetMs ?? PLAN_BUDGET_MS),
    });
  } catch (error) {
    if (error instanceof TransferPlanError) {
      return fail(
        422,
        'The plan could not be built in time. Transfer fewer files per run.',
        'PLAN_TOO_LARGE'
      );
    }
    throw error;
  }
  const itemCount =
    plan.counts.components +
    plan.counts.enablers +
    plan.counts.scenarios +
    plan.counts.quizzes +
    plan.useCaseCounts.useCases;
  if (itemCount === 0 && request.publishOriginals.length === 0) {
    return fail(
      409,
      'Nothing in this run can be transferred: no accepted file became an item of the plan',
      'NOTHING_TO_TRANSFER'
    );
  }

  const plannedIds = new Set(plan.plannedFiles.map(f => f.id));
  if (replaceFiles.some(id => !plannedIds.has(id))) {
    return fail(
      409,
      'A file to replace is not part of this transfer: it must be accepted and become an item of the plan',
      'REPLACE_NOT_PLANNED'
    );
  }
  const fileById = new Map(files.map(f => [f.id, f]));
  const evaluated =
    request.publishOriginals.length > 0
      ? await evaluateOriginals({
          requested: request.publishOriginals,
          files,
          readBytes: deps.readBytes,
          solutions: [
            ...scenarioSolutionTexts(plan.importPlan),
            ...solutionTextsOfUseCases(plan.useCasePlan.useCases),
          ],
          plannedFileIds: new Set(plan.plannedFiles.map(f => f.id)),
        })
      : { plans: [], refused: [] as OriginalRefusal[] };
  // The engine input of the originals. One that gets no valid path is refused here, so the
  // hash, the engine and the report all speak of the same list.
  const apply = mode === 'apply';
  const forEngine = toEnablerOriginals(
    evaluated.plans,
    request.callerId,
    apply ? clock().getTime() : 0
  );
  const originals = {
    plans: forEngine.map(e => e.plan),
    refused: [
      ...evaluated.refused,
      ...evaluated.plans
        .filter(p => !forEngine.some(e => e.plan === p))
        .map(p => ({
          fileId: p.fileId,
          code: 'PATH_INVALID',
          reason: 'No valid path in the document bucket for this file.',
        })),
    ],
  };
  const hash = decisionsHash({
    decisions,
    importPlan: plan.importPlan,
    useCasePlan: plan.useCasePlan,
    options: { replaceFiles },
    files: plan.plannedFiles,
    originals: originals.plans.map(p => ({
      id: p.fileId,
      sha256: p.sha256,
      enablerCode: p.enablerCode,
    })),
  });

  // 2. The gate -------------------------------------------------------------------------
  const passed = await store.beginApplying(runId, {
    version: state.decisionsVersion,
    requireHash: mode === 'apply' ? hash : null,
  });
  if (!passed) {
    const now = await store.getRunState(runId);
    if (
      now?.status === 'review' &&
      now.decisionsVersion === state.decisionsVersion
    ) {
      return fail(
        409,
        'Run a dry run without conflicts for exactly this state first',
        'DRY_RUN_REQUIRED'
      );
    }
    if (now?.status === 'review') {
      return fail(
        409,
        'The decisions changed while the plan was built, try again',
        'STALE_DECISIONS'
      );
    }
    return fail(
      409,
      `A run in the state ${now?.status ?? 'unknown'} cannot be ${mode === 'apply' ? 'applied' : 'tried'}`,
      'RUN_STATE'
    );
  }

  // 3. and 4. The transaction ---------------------------------------------------------------
  const target: ApplyTarget = isLoopbackHost(deps.host) ? 'local' : 'preview';
  const attempt = (
    status: ApplyRecord['status'],
    counts: Record<string, unknown>,
    conflicts: ApplyRecord['conflicts']
  ): ApplyRecord => ({
    runId,
    mode,
    startedById: request.callerId,
    decisionsVersion: state.decisionsVersion,
    decisionsHash: hash,
    updateExisting: replaceFiles.length > 0,
    status,
    counts,
    conflicts,
    startedAt: started,
  });

  const events: ItemEvent[] = [];
  const planRefs = {
    importPlan: plan.importPlan,
    useCasePlan: plan.useCasePlan,
    fileOfSource: plan.fileOfSource,
  };
  const fileFilter = updateFilterFor(planRefs, replaceSet);
  const engineSwitches = {
    createdBy: request.callerId,
    updateExisting: replaceSet.size > 0,
    write: true,
    activate: FIXED_ENGINE_OPTIONS.activate,
    observe: (event: ItemEvent) => {
      events.push(event);
    },
    updateFilter: (table: string, key: string) => fileFilter(table, key),
  };
  const stockOf = (
    skipped?: ReadonlyArray<{ useCaseCode: string }>
  ): Map<string, FileStock> =>
    stockOfFiles({ ...planRefs, events, useCasesSkippedInDb: skipped });
  const stockReport = (stock: ReadonlyMap<string, FileStock>): StockReport => ({
    counts: countStock(stock),
    files: [...stock]
      .map(([fileId, value]) => ({
        fileId,
        fileName: fileById.get(fileId)?.fileName ?? '',
        ...value,
      }))
      .sort((a, b) => (a.fileId < b.fileId ? -1 : 1)),
  });
  /** Keeps the status per file for the review list (a dry run only, in the state review). */
  const rememberStock = async (stock: ReadonlyMap<string, FileStock>) => {
    const at = clock().toISOString();
    await safely(() =>
      store.saveStock(
        runId,
        [...stock].map(([fileId, value]) => ({
          fileId,
          stock: {
            ...value,
            assign: assignmentFingerprint(
              (fileById.get(fileId) as TransferFile).decision
            ),
            at,
          },
        }))
      )
    );
  };

  let copied: string[] = [];
  let keepHash: string | null = null;
  try {
    const done = await withReservedConnection(
      deps.connections,
      connection =>
        withTransaction(
          connection,
          { mode: 'write', finish: apply ? 'commit' : 'rollback' },
          async () => {
            const facts = await (deps.readFacts ?? readConnectionFacts)(
              connection,
              deps.host
            );
            const problems = checkTargetFacts(target, facts);
            if (problems.length > 0) {
              throw new ImportAbort('TARGET_REFUSED', problems.join(' '));
            }
            // The copies for the public bucket come after the target check and right before
            // the engines: a refused target or a conflict of the plan never reaches the
            // bucket, and a failure after this point takes the copies out again (below).
            if (apply && forEngine.length > 0) {
              if (!deps.contentBucket) {
                throw new Error('The document bucket is not available.');
              }
              copied = await copyOriginals(
                deps.contentBucket(),
                forEngine.map(({ plan: o, original }) => ({
                  file: fileById.get(o.fileId) as TransferFile,
                  original,
                })),
                deps.readBytes,
                { deadline: Date.now() + COPY_BUDGET_MS }
              );
            }
            const db = new RecordingDb(
              (deps.makeDb ?? (c => new PgDb(c)))(connection),
              planAttribution({
                importPlan: plan.importPlan,
                useCasePlan: plan.useCasePlan,
                fileOfSource: plan.fileOfSource,
                fileOfOriginalTitle: new Map(
                  forEngine.map(({ plan: o, original }) => [
                    original.title,
                    o.fileId,
                  ])
                ),
              })
            );
            const importReport = await executePlan(db, plan.importPlan, {
              ...engineSwitches,
              scenarioSolutions: FIXED_ENGINE_OPTIONS.scenarioSolutions,
              extendQuizzes: FIXED_ENGINE_OPTIONS.extendQuizzes,
              enablerOriginals: forEngine.map(e => e.original),
            });
            // The use case engine needs the enablers: it runs on the same connection
            // and sees the ones the first engine has just written.
            const useCaseReport =
              plan.useCasePlan.useCases.length > 0
                ? await executeUseCasePlan(db, plan.useCasePlan, {
                    ...engineSwitches,
                    solutions: FIXED_ENGINE_OPTIONS.useCaseSolutions,
                  })
                : null;
            const tables: Record<string, TableCount> = {
              ...importReport.tables,
            };
            if (useCaseReport) {
              tables.use_cases = useCaseReport.tables.use_cases;
              tables.content_documents = addCounts(
                tables.content_documents,
                useCaseReport.tables.content_documents
              );
            }
            let applyId: string | null = null;
            if (apply) {
              const writer = store.protocol(connection);
              applyId = await writer.insertApply(
                attempt(
                  'ok',
                  summary(
                    tables,
                    plan.skipped.length,
                    plan.excluded.length,
                    forEngine.length
                  ),
                  []
                )
              );
              await writer.insertAppliedRows(
                applyId,
                db.written.map(w => ({
                  table: w.table,
                  rowId: w.rowId,
                  action: w.action,
                  before: w.before,
                  fileId: w.fileId,
                }))
              );
              await writer.markFilesApplied(
                runId,
                plan.plannedFiles.map(f => f.id)
              );
              // The database is another one now, the comparisons made before are stale
              await writer.clearStock(runId);
              if (
                !(await writer.finishRunApplied(runId, LIMITS.appliedFilesDays))
              ) {
                throw new ImportAbort(
                  'RUN_STATE',
                  'The run is no longer applying. Nothing was written.'
                );
              }
            }
            return {
              importReport,
              useCaseReport,
              tables,
              applyId,
              storedPaths: db.storedPaths,
            };
          }
        ),
      { reserveTimeoutMs: deps.reserveTimeoutMs ?? RESERVE_TIMEOUT_MS }
    );
    // A copy whose row was not written (the row existed already) is not needed
    if (apply && copied.some(path => !done.storedPaths.has(path))) {
      await safely(async () => {
        await (deps.contentBucket as () => ContentBucketPort)().remove(
          copied.filter(path => !done.storedPaths.has(path))
        );
      });
    }

    const stock = stockOf(done.useCaseReport?.skipped);
    const report: TransferReport = {
      mode,
      status: 'ok',
      applyId: done.applyId,
      decisionsHash: hash,
      decisionsVersion: state.decisionsVersion,
      replaceFiles,
      stock: stockReport(stock),
      extended: done.importReport.extended ?? [],
      tables: counted(done.tables),
      conflicts: [],
      differences: [
        ...done.importReport.differences,
        ...(done.useCaseReport?.differences ?? []),
      ],
      skipped: plan.skipped,
      excluded: plan.excluded,
      useCasesSkippedInDb: done.useCaseReport?.skipped ?? [],
      originals: {
        published: apply ? done.storedPaths.size : forEngine.length,
        refused: originals.refused,
      },
      wrote: apply,
      readyToApply: !apply,
    };
    if (!apply) {
      report.applyId = await store.recordAttempt(
        attempt(
          'ok',
          summary(
            done.tables,
            plan.skipped.length,
            plan.excluded.length,
            forEngine.length
          ),
          []
        )
      );
      await store.endApplying(runId, hash);
      await rememberStock(stock);
    }
    return ok(report);
  } catch (error) {
    const abort = error instanceof ImportAbort ? error : null;
    const conflicts = abort?.code === 'CONFLICTS' ? abort.conflicts : [];
    const code = errorCodeOf(error);
    // Nothing was written: a repeated call can pass the gate again with the same dry run
    if (
      apply &&
      (code === 'LOCKED' ||
        code === 'CONNECTION_RESERVE_TIMEOUT' ||
        code === '55P03' ||
        code === '57014' ||
        code === '40001')
    ) {
      keepHash = hash;
    }
    // Did the COMMIT happen although the call failed (the answer was lost)? The run says
    // so: it is applied. If the state cannot be read the answer is "maybe", and then the
    // copies in the bucket stay (a file without a row is less harm than a row without a file).
    const after = apply
      ? await store.getRunState(runId).catch(() => undefined)
      : null;
    const maybeCommitted =
      apply && !abort && (after === undefined || after?.status === 'applied');
    if (copied.length > 0 && !maybeCommitted) {
      await safely(async () => {
        await (deps.contentBucket as () => ContentBucketPort)().remove(copied);
      });
    }
    // Log the attempt and give the run back. Each step alone, so one failing does not hide
    // the other nor the real error. endApplying only changes a run that is applying: a
    // committed apply (status applied) is left alone.
    if (!maybeCommitted) {
      await safely(() =>
        store.recordAttempt(
          attempt(
            abort?.code === 'CONFLICTS' ? 'conflict' : 'failed',
            { errorCode: code },
            conflicts.map(c => ({
              table: c.table,
              key: c.key,
              reason: c.reason,
            }))
          )
        )
      );
    }
    await safely(() => store.endApplying(runId, keepHash));
    if (maybeCommitted) {
      return fail(
        500,
        'The result of the apply is uncertain: check the protocol of the run before you repeat it',
        'COMMIT_UNCERTAIN'
      );
    }
    if (abort?.code === 'CONFLICTS') {
      // The engines compared everything before they stopped: the files say which one conflicts
      const stock = stockOf();
      await rememberStock(stock);
      return ok({
        mode,
        status: 'conflict',
        applyId: null,
        decisionsHash: hash,
        decisionsVersion: state.decisionsVersion,
        replaceFiles,
        stock: stockReport(stock),
        extended: [],
        tables: {},
        conflicts,
        differences: [],
        skipped: plan.skipped,
        excluded: plan.excluded,
        useCasesSkippedInDb: [],
        originals: { published: 0, refused: originals.refused },
        wrote: false,
        readyToApply: false,
      });
    }
    if (abort) {
      return fail(
        409,
        messageOf(abort),
        abort.code === 'LOCKED' ? 'IMPORT_LOCKED' : abort.code
      );
    }
    throw error;
  }
}

/** Runs a clean up step that must not hide the error that is being handled. */
async function safely(step: () => Promise<unknown>): Promise<void> {
  try {
    await step();
  } catch (error) {
    console.error('[content-upload] clean up step failed', errorCodeOf(error));
  }
}

/** The counters of an apply row: numbers only, never a text of a file. */
function summary(
  tables: Record<string, TableCount>,
  skipped: number,
  excluded: number,
  originals: number
): Record<string, unknown> {
  return { tables: counted(tables), skipped, excluded, originals };
}
