/**
 * Adds the single answers to the quiz submissions of an earlier seed that have none, so a
 * trainer sees the answers behind the score (see scripts/preview/lib/quiz-answers.ts and
 * docs/preview-testdaten.md). Only adds: nothing is deleted or overwritten, hand-made
 * submissions are not touched, the score stays as it is.
 *
 *   npm run preview:seed-answers -- --target preview
 *   npm run preview:seed-answers -- --target preview --apply --confirm-host <host>
 *   ... --email <a>,<b>   only these accounts
 *   ... --fix-scores      also set a score that no number of right answers gives (for
 *                         example 68 percent of 10 questions) to the one the answers give
 */
import { main } from './lib/cli';

main('answers', process.argv.slice(2)).catch(error => {
  console.error('Failed:', error instanceof Error ? error.message : error);
  process.exit(1);
});
