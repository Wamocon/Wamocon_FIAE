// One run of the use case import against an open connection: compare (check),
// dry run or real run. The caller has already checked that the connection fits
// the declared target (apply/target.ts) and passes it in.
//
//  - check:   read-only transaction, nothing is written, always rolled back
//  - dry-run: everything is executed in a write transaction (so constraints and
//             triggers speak), then rolled back
//  - apply:   the same, committed at the end
//
// The default of the script is dry-run. A real run needs the explicit mode. The
// transaction is the one of the content import (isolation repeatable read, lock
// and statement timeout, the same advisory lock), so the imports never run at
// the same time.

import { ImportAbort } from '../apply/db';
import type { JobMode } from '../apply/job';
import type { ApplyTarget } from '../apply/target';
import { PgDb, withTransaction } from '../apply/pg-db';
import type { Queryable } from '../apply/pg-db';
import { executeUseCasePlan } from './engine';
import type { UseCaseReport } from './engine';
import type { UseCasePlan } from './types';

export interface UseCaseJobInput {
  mode: JobMode;
  /** The declared target, the solutions are only allowed for local. */
  target: ApplyTarget;
  createdBy: string;
  updateExisting: boolean;
  /** is_active of new use cases, from the decisions file. */
  activate: boolean;
  /** Also write the trainer-only solution rows (never for the Preview). */
  solutions: boolean;
}

export async function runUseCaseJob(
  client: Queryable,
  plan: UseCasePlan,
  input: UseCaseJobInput
): Promise<UseCaseReport> {
  // The argument check already refuses the switch for the Preview, this is the
  // second lock for a caller that does not come through the arguments.
  if (input.solutions && input.target !== 'local') {
    throw new ImportAbort(
      'SOLUTIONS_NOT_LOCAL',
      'The model solutions may only be written to a local database. Nothing was written.'
    );
  }
  const db = new PgDb(client);
  if (input.mode === 'check') {
    return withTransaction(
      client,
      { mode: 'read-only', finish: 'rollback' },
      () =>
        executeUseCasePlan(db, plan, {
          createdBy: input.createdBy,
          updateExisting: false,
          write: false,
          activate: input.activate,
          solutions: input.solutions,
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
      executeUseCasePlan(db, plan, {
        createdBy: input.createdBy,
        updateExisting: input.updateExisting,
        write: true,
        activate: input.activate,
        solutions: input.solutions,
      })
  );
}
