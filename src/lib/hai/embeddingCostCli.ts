/**
 * Command line of the embedding cost estimate (scripts/hai-embedding-cost.ts).
 * The logic lives here so a test can run it: the only thing it gets from the
 * outside is a function that reads a file as text. No network, no database, no
 * environment, no model call.
 *
 * @module lib/hai/embeddingCostCli
 */

import {
  estimateEmbeddingCost,
  formatCostReport,
  parseInventory,
  parsePricingConfig,
} from './embeddingCost';

export const DEFAULT_PRICING_FILE = 'scripts/config/hai-embedding-pricing.json';

export interface CliResult {
  exitCode: 0 | 2;
  stdout: string;
  stderr: string;
}

const HELP = `Estimate the embedding cost of a HAI reindex (no model call, no network, no database).

Usage:
  npx tsx scripts/hai-embedding-cost.ts --inventory <file.json> [options]

  --inventory <file>     numbers to price: { "groups": [...] } typed by hand, or the
                         log of a dry run of scripts/reindex-gemini.ts (logs/reindex-*.json)
  --which <part>         of a dry run log: "changes" (default, what a real run embeds
                         now) or "inventory" (everything the index holds afterwards)
  --pricing <file>       price configuration (default ${DEFAULT_PRICING_FILE})
  --runs <n>             how often the inventory is embedded (Preview and Production = 2)
  --eur-per-usd <rate>   also show euro (overrides eurPerUsd of the configuration)
  --json                 print the estimate as JSON
  --help
`;

const VALUE_OPTIONS = new Set([
  '--inventory',
  '--which',
  '--pricing',
  '--runs',
  '--eur-per-usd',
]);
const FLAGS = new Set(['--json', '--help']);

function refuse(message: string): CliResult {
  return { exitCode: 2, stdout: '', stderr: `${message}\n` };
}

export function runCostCli(
  argv: string[],
  readFile: (file: string) => string
): CliResult {
  const flags = new Set<string>();
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const token = argv[i];
    if (FLAGS.has(token)) {
      flags.add(token);
    } else if (VALUE_OPTIONS.has(token)) {
      const value = argv[++i];
      if (value === undefined || value.startsWith('--')) {
        return refuse(`${token} needs a value`);
      }
      values.set(token, value);
    } else {
      return refuse(`Unknown argument: ${token}`);
    }
  }

  if (flags.has('--help')) return { exitCode: 0, stdout: HELP, stderr: '' };

  const inventoryFile = values.get('--inventory');
  if (!inventoryFile) return refuse('--inventory <file> is required');

  const which = values.get('--which') ?? 'changes';
  if (which !== 'changes' && which !== 'inventory') {
    return refuse('--which must be changes or inventory');
  }

  const runs = values.has('--runs') ? Number(values.get('--runs')) : 1;
  if (!Number.isInteger(runs) || runs < 1) {
    return refuse('--runs must be a whole number of 1 or more');
  }

  let eurPerUsd: number | null = null;
  if (values.has('--eur-per-usd')) {
    eurPerUsd = Number(values.get('--eur-per-usd'));
    if (!Number.isFinite(eurPerUsd) || eurPerUsd <= 0) {
      return refuse('--eur-per-usd must be a number above zero');
    }
  }

  // The message of JSON.parse can quote a piece of the file: say the file only
  const readJson = (file: string): unknown => {
    const content = readFile(file);
    try {
      return JSON.parse(content);
    } catch {
      throw new Error(`${file} is no valid JSON`);
    }
  };

  try {
    const pricing = parsePricingConfig(
      readJson(values.get('--pricing') ?? DEFAULT_PRICING_FILE)
    );
    if (eurPerUsd !== null) pricing.eurPerUsd = eurPerUsd;
    const inventory = parseInventory(readJson(inventoryFile), which);
    const estimate = estimateEmbeddingCost(inventory, pricing, { runs });
    const stdout = flags.has('--json')
      ? `${JSON.stringify(estimate, null, 2)}\n`
      : `${formatCostReport(estimate, pricing)}\n`;
    return { exitCode: 0, stdout, stderr: '' };
  } catch (error) {
    return refuse(error instanceof Error ? error.message : String(error));
  }
}
