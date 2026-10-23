// Stops a production migration if "supabase db push --dry-run" would apply a
// legacy file again that is already part of the production baseline.
//
// Why: the 12 digit legacy files marked "applied" in
// supabase/legacy-migrations.txt were applied to production by hand. If the
// ledger (supabase_migrations.schema_migrations) does not know their version,
// `db push` would run them a second time. That is the sign that the one-time
// baseline repair (supabase migration repair, see docs/release-prozess.md) was
// not done. A human fixes the ledger, this guard only reports.
//
// Usage: node scripts/db/baseline-guard.mjs --plan <file with the dry-run output>

import { existsSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { readLegacyEntries } from './migration-check.mjs';

const LEGACY_FILE = 'supabase/legacy-migrations.txt';

/**
 * @param {{ file: string, state: string }[]} entries legacy entries
 * @param {string} planText output of `supabase db push --dry-run`
 * @returns {string[]} baseline files that the plan would apply again
 */
export function appliedLegacyInPlan(entries, planText) {
  return entries
    .filter(e => e.state === 'applied')
    .filter(e => {
      const version = e.file.split('_')[0];
      return new RegExp(`(^|[^0-9])${version}_`).test(planText);
    })
    .map(e => e.file);
}

function main() {
  const i = process.argv.indexOf('--plan');
  const planFile = i > 0 ? process.argv[i + 1] : null;
  if (!planFile) {
    console.error('Usage: node scripts/db/baseline-guard.mjs --plan <file>');
    process.exit(2);
  }
  const entries = existsSync(LEGACY_FILE)
    ? readLegacyEntries(readFileSync(LEGACY_FILE, 'utf8'))
    : [];
  const hits = appliedLegacyInPlan(entries, readFileSync(planFile, 'utf8'));
  if (hits.length > 0) {
    console.error(
      `::error::The plan would apply baseline file(s) again: ${hits.join(', ')}. The ledger baseline repair is missing (docs/release-prozess.md). Nothing was changed.`
    );
    process.exit(1);
  }
  console.log('Baseline guard: no baseline file would be applied again.');
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
