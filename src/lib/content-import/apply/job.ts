// One run of the apply step against an open connection: compare (check), dry
// run or real run. The caller has already checked that the connection fits the
// declared target (target.ts) and passes the connection in.
//
//  - check:   read-only transaction, nothing is written, always rolled back
//  - dry-run: everything is executed in a write transaction (so constraints and
//             triggers speak), then rolled back
//  - apply:   the same, committed at the end
//
// The default of the script is dry-run. A real run needs the explicit mode.

import { executePlan } from './engine';
import { PgDb, withTransaction } from './pg-db';
import type { Queryable } from './pg-db';
import type { ImportPlan, RunReport } from './types';

export type JobMode = 'check' | 'dry-run' | 'apply';

export interface JobInput {
  mode: JobMode;
  createdBy: string;
  updateExisting: boolean;
  /** is_active of new rows, from the decisions file. */
  activate: boolean;
  scenarioSolutions: boolean;
  /** Add the missing questions of quizzes that exist with fewer questions. */
  extendQuizzes?: boolean;
}

export async function runJob(
  client: Queryable,
  plan: ImportPlan,
  input: JobInput
): Promise<RunReport> {
  const db = new PgDb(client);
  if (input.mode === 'check') {
    return withTransaction(
      client,
      { mode: 'read-only', finish: 'rollback' },
      () =>
        executePlan(db, plan, {
          createdBy: input.createdBy,
          updateExisting: false,
          write: false,
          activate: input.activate,
          scenarioSolutions: input.scenarioSolutions,
          extendQuizzes: input.extendQuizzes,
        })
    );
  }
  return withTransaction(
    client,
    {
      mode: 'write',
      finish: input.mode === 'apply' ? 'commit' : 'rollback',
    },
    () =>
      executePlan(db, plan, {
        createdBy: input.createdBy,
        updateExisting: input.updateExisting,
        write: true,
        activate: input.activate,
        scenarioSolutions: input.scenarioSolutions,
        extendQuizzes: input.extendQuizzes,
      })
  );
}
