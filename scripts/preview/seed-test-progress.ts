/**
 * Gives every active trainee of the Preview a state of work for testing (see
 * scripts/preview/lib/test-progress.ts and docs/preview-testdaten.md).
 *
 *   npm run preview:seed-progress -- --target preview
 *   npm run preview:seed-progress -- --target preview --apply --confirm-host <host>
 *   ... --email <a>,<b>   only these accounts
 *   ... --email <a> --level weit   give these accounts a level of their own (weit, mittel, bereit, anfang)
 */
import { main } from './lib/cli';

main('seed', process.argv.slice(2)).catch(error => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
