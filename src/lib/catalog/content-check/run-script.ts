/**
 * Runs the script checks for one catalog: reads the snapshot (one statement per
 * group of rules), the statistics of the catalog with its targets (one statement,
 * the counting rules of the statistics page) and applies the rules. Read only.
 */

import {
  buildCatalogStats,
  loadStatsRows,
  type StatsExecutor,
} from '@/lib/catalog/content-stats';
import {
  loadContentSnapshot,
  type ContentSnapshot,
  type SnapshotExecutor,
} from '@/lib/catalog/content-check/snapshot';
import { runScriptRules } from '@/lib/catalog/content-check/script-checks';
import type { Finding } from '@/lib/catalog/content-check/types';

export interface ScriptCheckResult {
  catalogId: string;
  catalogCode: string;
  findings: Finding[];
  /** The snapshot, kept for the AI review (it reads titles from it). */
  snapshot: ContentSnapshot;
}

/** The script findings of one catalog, or null when the catalog does not exist. */
export async function runScriptChecks(
  q: SnapshotExecutor & StatsExecutor,
  catalogId: string
): Promise<ScriptCheckResult | null> {
  const snapshot = await loadContentSnapshot(q, catalogId);
  if (!snapshot) return null;
  const rows = await loadStatsRows(q, [catalogId]);
  const stats = rows[0] ? buildCatalogStats(rows[0], true) : null;
  return {
    catalogId,
    catalogCode: snapshot.catalog.code,
    findings: runScriptRules(snapshot, stats),
    snapshot,
  };
}
