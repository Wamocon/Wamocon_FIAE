// One run of the learning field import against an open connection: compare
// (check), dry run or real run. The caller has already checked that the
// connection fits the declared target (apply/target.ts) and passes it in.
//
//  - check:   read-only transaction, nothing is written, always rolled back
//  - dry-run: everything is executed in a write transaction (so constraints and
//             triggers speak), then rolled back
//  - apply:   the same, committed at the end
//
// The default of the script is dry-run. A real run needs the explicit mode. The
// transaction is the one of the content import (isolation repeatable read, lock
// and statement timeout, the same advisory lock), so the two imports never run
// at the same time.

import type { JobMode } from '../apply/job';
import { PgDb, withTransaction } from '../apply/pg-db';
import type { Queryable } from '../apply/pg-db';
import { executeLearningFieldPlan } from './engine';
import type { LearningFieldReport } from './engine';
import type { LearningFieldPlan } from './types';

export interface LearningFieldJobInput {
  mode: JobMode;
  updateExisting: boolean;
}

export async function runLearningFieldJob(
  client: Queryable,
  plan: LearningFieldPlan,
  input: LearningFieldJobInput
): Promise<LearningFieldReport> {
  const db = new PgDb(client);
  if (input.mode === 'check') {
    return withTransaction(
      client,
      { mode: 'read-only', finish: 'rollback' },
      () =>
        executeLearningFieldPlan(db, plan, {
          updateExisting: false,
          write: false,
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
      executeLearningFieldPlan(db, plan, {
        updateExisting: input.updateExisting,
        write: true,
      })
  );
}
