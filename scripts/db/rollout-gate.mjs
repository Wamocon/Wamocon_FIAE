// Stops a production migration if "supabase db push --dry-run" would apply
// migrations of the unreleased KfBM work while the rollout is not approved.
//
// Why: master carries the migrations of the KfBM rebuild (version 20261024000100
// and newer) before they may reach production. A merge never touches production,
// but a release applies everything that is pending. Without this gate a release
// created for another reason would migrate the catalog and then stop at the gated
// backfill, half way. The owner decides when the rollout happens (runbook
// docs/production-schema-migration.md) and then sets the repository variable
// KFBM_ROLLOUT_APPROVED to "true". Until then a release whose plan contains such a
// file fails here, BEFORE anything is applied. A release without such a file is
// not affected.
//
// Usage: KFBM_ROLLOUT_APPROVED=<value> node scripts/db/rollout-gate.mjs --plan <file with the dry-run output>

import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

/** The first migration of the KfBM rebuild. This and every newer version is gated. */
export const GATED_FROM = '20261024000100';

/**
 * @param {string} planText output of `supabase db push --dry-run`
 * @param {string} from first gated version
 * @returns {string[]} file names in the plan that belong to the gated work
 */
export function gatedInPlan(planText, from = GATED_FROM) {
  const files = [
    ...planText.matchAll(/(?<![0-9])\d{14}_[A-Za-z0-9_]+\.sql/g),
  ].map(match => match[0]);
  return [...new Set(files)].filter(file => file.slice(0, 14) >= from);
}

/**
 * Only the exact value "true" approves. Anything else, also "TRUE", "yes" or an
 * unset variable, keeps the gate closed.
 * @param {string} planText
 * @param {string | undefined} approved value of KFBM_ROLLOUT_APPROVED
 * @returns {{ ok: boolean, blocked: string[] }}
 */
export function rolloutGate(planText, approved) {
  const blocked = gatedInPlan(planText);
  if (blocked.length === 0) return { ok: true, blocked };
  return { ok: approved === 'true', blocked };
}

function main() {
  const i = process.argv.indexOf('--plan');
  const planFile = i > 0 ? process.argv[i + 1] : null;
  if (!planFile) {
    console.error('Usage: node scripts/db/rollout-gate.mjs --plan <file>');
    process.exit(2);
  }
  const { ok, blocked } = rolloutGate(
    readFileSync(planFile, 'utf8'),
    process.env.KFBM_ROLLOUT_APPROVED
  );
  if (!ok) {
    console.error(
      `::error::The plan would apply migrations of the KfBM rebuild (${blocked.length} file(s), first: ${blocked[0]}), but the rollout is not approved. Nothing was changed. The owner approves by setting the repository variable KFBM_ROLLOUT_APPROVED to true (docs/production-schema-migration.md).`
    );
    process.exit(1);
  }
  console.log(
    blocked.length === 0
      ? 'Rollout gate: the plan contains no migration of the KfBM rebuild.'
      : `Rollout gate: ${blocked.length} migration(s) of the KfBM rebuild, the rollout is approved.`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
