import { DEFAULT_LIMITS, type KiLimits } from '@/lib/content-upload/ki/config';
import { fileBlock, type BudgetBlock } from '@/lib/content-upload/ki/budget';
import type { KiCallStatus, KiUsage } from '@/lib/content-upload/ki/repo';

/**
 * Cost brake and circuit breaker of the AI stage of the plan document. It reuses
 * the pure rules of the content upload (ki/budget.ts) on a counter that lives in
 * the memory of the server process: the plan document has no table of its own
 * (no migration), and one admin reading a few documents is a small load. The
 * counter is per instance, so it is a brake and no exact meter, and it starts
 * from zero after a restart.
 *
 *  - PER_HOUR   calls in the last hour (the "run" of the rules)
 *  - PER_DAY    calls in the last 24 hours
 *  - PER_FILE   calls for one document (one call per chunk of text)
 *  - breaker    the last three calls all failed, the newest less than ten
 *               minutes ago: the stage rests, the next call afterwards is a trial
 */

export const PLAN_KI_LIMITS: Readonly<KiLimits> = Object.freeze({
  ...DEFAULT_LIMITS,
  maxCallsPerRun: 40,
  maxCallsPerDay: 150,
  maxCallsPerFile: 4,
  breakerFailures: 3,
  breakerCooldownSec: 600,
});

export type PlanBudgetBlock = BudgetBlock;

interface Call {
  at: number;
  status: KiCallStatus;
}

export interface PlanBudget {
  /** What stops a document that has already used `fileCalls` calls, or null. */
  block(fileCalls: number): PlanBudgetBlock | null;
  /** Records a call that reached the server. */
  record(status: KiCallStatus): void;
}

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

export function createPlanBudget(
  now: () => number = Date.now,
  limits: KiLimits = PLAN_KI_LIMITS
): PlanBudget {
  // newest first, nothing older than a day is kept
  let calls: Call[] = [];
  const usage = (fileCalls: number): KiUsage => {
    const t = now();
    calls = calls.filter(c => t - c.at < DAY_MS);
    return {
      run: calls.filter(c => t - c.at < HOUR_MS).length,
      day: calls.length,
      file: fileCalls,
      recent: calls.slice(0, limits.breakerFailures).map(c => ({
        status: c.status,
        ageSec: Math.max(0, Math.floor((t - c.at) / 1000)),
      })),
    };
  };
  return {
    block: fileCalls => fileBlock(limits, usage(fileCalls)),
    record(status) {
      calls = [{ at: now(), status }, ...calls].slice(0, 500);
    },
  };
}

/** The counter of this process. */
export const planBudget: PlanBudget = createPlanBudget();
