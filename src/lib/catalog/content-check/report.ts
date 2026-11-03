/**
 * Builds the content check report of one catalog: the script checks (always),
 * the AI review (only on request and only where it may run) and the plan check
 * (when the module exists). Read only, nothing is stored.
 */

import {
  runKiReview,
  type KiReviewOptions,
  type KiReviewResult,
} from '@/lib/catalog/content-check/ki-review';
import {
  loadPlanFindings,
  type PlanFindingsFn,
} from '@/lib/catalog/content-check/plan-hook';
import { runScriptChecks } from '@/lib/catalog/content-check/run-script';
import type { SnapshotExecutor } from '@/lib/catalog/content-check/snapshot';
import type { StatsExecutor } from '@/lib/catalog/content-stats';
import type {
  ContentCheckReport,
  Finding,
  FindingSeverity,
} from '@/lib/catalog/content-check/types';

export interface ReportOptions {
  /** Run the AI review as well. */
  ki: boolean;
  /** Options of the AI review (the tests replace the client and the environment). */
  kiOptions?: KiReviewOptions;
  /** Replaces the AI review. Only the tests pass it. */
  runKi?: typeof runKiReview;
  /** Replaces the loader of the plan hook. Only the tests pass it. */
  planLoader?: () => PlanFindingsFn | null;
  now?: () => Date;
}

const SEVERITY_ORDER: Record<FindingSeverity, number> = {
  error: 0,
  warning: 1,
  info: 2,
};

/** What the script checks do not cover, said in every report. */
export const NOT_CHECKED_NOTE =
  'Nicht geprüft: ob die Dateien im Speicher vorhanden sind (das prüft der Knopf "Dateien prüfen" an einer Stichprobe). Byte-gleiche Kopien meldet die Prüfsumme nur bei Dokumenten, für die sie schon gesetzt ist, sonst gilt der Hinweis auf gleiche Größe und Seitenzahl.';

export const PLAN_FAILED_NOTE =
  'Der Vergleich mit dem Plan-Dokument ist fehlgeschlagen und fehlt im Bericht.';

/** Counts by severity. */
export function countBySeverity(
  findings: readonly Finding[]
): Record<FindingSeverity, number> {
  const counts: Record<FindingSeverity, number> = {
    error: 0,
    warning: 0,
    info: 0,
  };
  for (const f of findings) counts[f.severity] += 1;
  return counts;
}

/** Errors first, then warnings, then notes. Stable: the order of the rules stays inside a severity. */
export function sortFindings(findings: readonly Finding[]): Finding[] {
  return [...findings].sort(
    (a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity]
  );
}

/** A finding of the plan module in the form the report promises: source plan, a known severity. */
function normalizePlanFinding(value: unknown): Finding | null {
  if (value === null || typeof value !== 'object') return null;
  const f = value as Partial<Finding>;
  if (
    typeof f.rule !== 'string' ||
    typeof f.summary !== 'string' ||
    (f.severity !== 'error' &&
      f.severity !== 'warning' &&
      f.severity !== 'info')
  ) {
    return null;
  }
  return {
    rule: f.rule,
    severity: f.severity,
    source: 'plan',
    category: typeof f.category === 'string' ? f.category : 'plan',
    summary: f.summary,
    ...(typeof f.details === 'string' ? { details: f.details } : {}),
    refs: Array.isArray(f.refs) ? f.refs.slice(0, 20) : [],
    ...(typeof f.hint === 'string' ? { hint: f.hint } : {}),
  };
}

/** The report of one catalog, or null when the catalog does not exist. */
export async function buildContentCheckReport(
  q: SnapshotExecutor & StatsExecutor,
  catalogId: string,
  options: ReportOptions
): Promise<ContentCheckReport | null> {
  const script = await runScriptChecks(q, catalogId);
  if (!script) return null;

  const findings: Finding[] = [...script.findings];
  const notes: string[] = [NOT_CHECKED_NOTE];
  const ran = { script: true, ki: false, plan: false };

  if (options.ki) {
    const review: KiReviewResult = await (options.runKi ?? runKiReview)(
      script.snapshot,
      options.kiOptions
    );
    findings.push(...review.findings);
    notes.push(...review.notes);
    ran.ki = review.ran;
  }

  // The plan part is optional: no module means no plan findings, not an error
  try {
    const planFindings = (options.planLoader ?? loadPlanFindings)();
    if (planFindings) {
      const list = await planFindings(catalogId);
      for (const item of list) {
        const finding = normalizePlanFinding(item);
        if (finding) findings.push(finding);
      }
      // without a plan and without targets the plan part only says so (rule plan.none): it did not really run
      ran.plan = !(list.length === 1 && list[0].rule === 'plan.none');
    }
  } catch {
    notes.push(PLAN_FAILED_NOTE);
  }

  const sorted = sortFindings(findings);
  return {
    catalogId,
    catalogCode: script.catalogCode,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    findings: sorted,
    counts: countBySeverity(sorted),
    ran,
    notes,
  };
}
