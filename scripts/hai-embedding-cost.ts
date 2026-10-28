/**
 * Cost estimate of a HAI embedding run. Reads two JSON files (an inventory of
 * numbers and the price configuration) and prints. No network, no database, no
 * secrets, no model call. The logic is in src/lib/hai/embeddingCostCli.ts.
 *
 *   npx tsx scripts/hai-embedding-cost.ts --inventory <file.json> [--runs 2]
 *   npx tsx scripts/hai-embedding-cost.ts --help
 */

import { readFileSync } from 'fs';
import { runCostCli } from '../src/lib/hai/embeddingCostCli';

const result = runCostCli(process.argv.slice(2), file =>
  readFileSync(file, 'utf-8')
);
if (result.stdout) process.stdout.write(result.stdout);
if (result.stderr) process.stderr.write(result.stderr);
// no process.exit(): it can cut off piped output that is still being written
process.exitCode = result.exitCode;
