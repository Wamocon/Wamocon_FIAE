/**
 * The optional hook for the comparison with the uploaded plan document.
 *
 * The plan part of the content check lives in another module,
 * src/lib/catalog/content-plan/plan-check.ts, which exports
 *
 *   planFindings(catalogId: string): Promise<Finding[]>
 *
 * and returns findings with `source: 'plan'`. This hook loads that module when
 * it exists. When it does not exist (it is built separately), the answer is
 * "no plan check" and the report simply has no plan findings: nothing fails and
 * the run is marked as not having run the plan part.
 *
 * `require` inside a try block on purpose: the bundler treats a missing module
 * there as optional (a warning, no build error), and Jest resolves the same
 * path through its module mapper. A module that exists but throws when it is
 * loaded is NOT swallowed, the caller reports it.
 */

import type { Finding } from '@/lib/catalog/content-check/types';

export type PlanFindingsFn = (catalogId: string) => Promise<Finding[]>;

const PLAN_MODULE = '@/lib/catalog/content-plan/plan-check';

/**
 * The error of a module that is not there. Node, the bundler and Jest word it
 * differently (Jest says "Could not locate module ... mapped as" for an alias),
 * so the name of the module and one of the known phrasings must match.
 */
function isMissingModule(error: unknown): boolean {
  const e = error as { code?: unknown; message?: unknown } | null;
  if (typeof e?.message !== 'string') return false;
  if (!e.message.includes('content-plan/plan-check')) return false;
  return (
    e.code === 'MODULE_NOT_FOUND' ||
    /Cannot find module|Could not locate module/.test(e.message)
  );
}

/**
 * Loads the module. The `require` stands lexically inside the try block, that is
 * what makes the bundler treat a missing module as optional (a warning, no build
 * error).
 */
function requirePlanModule(): unknown {
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    return require('@/lib/catalog/content-plan/plan-check');
  } catch (error) {
    if (isMissingModule(error)) return null;
    throw error;
  }
}

/**
 * The plan check function, or null when the module does not exist (yet).
 * `load` is replaced in the tests only.
 */
export function loadPlanFindings(
  load: () => unknown = requirePlanModule
): PlanFindingsFn | null {
  try {
    const mod = load() as { planFindings?: unknown } | null;
    return typeof mod?.planFindings === 'function'
      ? (mod.planFindings as PlanFindingsFn)
      : null;
  } catch (error) {
    if (isMissingModule(error)) return null;
    throw error;
  }
}

/** The path the hook looks for, for messages and tests. */
export const PLAN_CHECK_MODULE = PLAN_MODULE;
