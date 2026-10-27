// The cost brake and the circuit breaker of the Sokrates stage
// (docs/ki-upload-konzept.md 6.3 "Schutzschalter", 9.1 T7). Pure.
//
//   RUN_CAP   the run used its calls
//   DAY_CAP   all runs together used the calls of the last 24 hours
//   FILE_CAP  the file used its calls (the second stage and a retry included)
//   BREAKER   the last N calls of the run all failed, the newest one less than the
//             cool-down ago: the stage of this run rests. After the cool-down the
//             next call is a trial. A failing trial closes the breaker again for the
//             cool-down, because the newest N are still all failures.
//
// A call that is refused before it is sent (guard) or skipped never counts: it
// cost nothing and is no sign of a broken server.

import type { KiLimits } from '@/lib/content-upload/ki/config';
import { FAILURE_STATUSES, type KiUsage } from '@/lib/content-upload/ki/repo';

export type BudgetBlock = 'RUN_CAP' | 'DAY_CAP' | 'FILE_CAP' | 'BREAKER';

/** Whether the stage of the run rests: failures in a row, the newest one recent. */
export function breakerOpen(limits: KiLimits, usage: KiUsage): boolean {
  if (limits.breakerFailures <= 0) return false;
  if (usage.recent.length < limits.breakerFailures) return false;
  const newest = usage.recent.slice(0, limits.breakerFailures);
  const allFailed = newest.every(c =>
    (FAILURE_STATUSES as readonly string[]).includes(c.status)
  );
  return allFailed && newest[0].ageSec < limits.breakerCooldownSec;
}

/** What stops the whole run, or null. */
export function runBlock(
  limits: KiLimits,
  usage: KiUsage
): Exclude<BudgetBlock, 'FILE_CAP'> | null {
  if (breakerOpen(limits, usage)) return 'BREAKER';
  if (usage.run >= limits.maxCallsPerRun) return 'RUN_CAP';
  if (usage.day >= limits.maxCallsPerDay) return 'DAY_CAP';
  return null;
}

/** What stops this file (including what stops the run), or null. */
export function fileBlock(
  limits: KiLimits,
  usage: KiUsage
): BudgetBlock | null {
  const run = runBlock(limits, usage);
  if (run) return run;
  if (usage.file >= limits.maxCallsPerFile) return 'FILE_CAP';
  return null;
}
