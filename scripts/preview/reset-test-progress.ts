/**
 * Puts the test accounts of the Preview back to the baseline after a test: removes what the
 * test created (progress tables and uploaded files) and seeds the baseline again (see
 * scripts/preview/lib/test-progress.ts and docs/preview-testdaten.md).
 *
 *   npm run preview:reset-progress -- --target preview
 *   npm run preview:reset-progress -- --target preview --apply --confirm-host <host>
 *   ... --email <a>,<b>   only these accounts
 *   ... --clear-only      remove, do not seed again
 *   ... --keep-files      leave the uploaded files
 */
import { main } from './lib/cli';

main('reset', process.argv.slice(2)).catch(error => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
