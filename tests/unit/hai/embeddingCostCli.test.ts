/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { runCostCli } from '@/lib/hai/embeddingCostCli';

// Command line of the cost estimate. It reads two files and prints: no
// network, no database, no model call.

const PRICING = fs.readFileSync(
  path.join(process.cwd(), 'scripts', 'config', 'hai-embedding-pricing.json'),
  'utf-8'
);

const INVENTORY = JSON.stringify({
  groups: [
    {
      sourceType: 'enabler',
      catalog: 'KFBM',
      visibility: 'all',
      unit: 'chunks',
      chunks: 100,
      chars: 40000,
    },
  ],
});

function files(map: Record<string, string>) {
  return (file: string) => {
    if (!(file in map)) throw new Error(`ENOENT ${file}`);
    return map[file];
  };
}

const DEFAULT_PRICING = 'scripts/config/hai-embedding-pricing.json';

describe('runCostCli', () => {
  const read = files({ 'inv.json': INVENTORY, [DEFAULT_PRICING]: PRICING });

  it('prints the report for an inventory with the default prices', () => {
    const out = runCostCli(['--inventory', 'inv.json'], read);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('Embedding cost estimate');
    expect(out.stdout).toContain('gemini-embedding-001');
    expect(out.stdout).toContain('100 chunks');
  });

  it('prints JSON with --json', () => {
    const out = runCostCli(['--inventory', 'inv.json', '--json'], read);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.totals.chunks).toBe(100);
    expect(parsed.costs[0].model).toBe('gemini-embedding-001');
  });

  it('takes the runs and the exchange rate', () => {
    const out = runCostCli(
      ['--inventory', 'inv.json', '--runs', '2', '--eur-per-usd', '0.9'],
      read
    );
    expect(out.stdout).toContain('Runs: 2');
    expect(out.stdout).toContain('EUR (standard)');
  });

  it('takes another price file', () => {
    const custom = JSON.stringify({
      ...JSON.parse(PRICING),
      defaultModel: 'gemini-embedding-2',
    });
    const out = runCostCli(
      ['--inventory', 'inv.json', '--pricing', 'p.json'],
      files({ 'inv.json': INVENTORY, 'p.json': custom })
    );
    expect(out.exitCode).toBe(0);
    expect(out.stdout.indexOf('gemini-embedding-2')).toBeLessThan(
      out.stdout.indexOf('gemini-embedding-001')
    );
  });

  it('reads the log of a dry run and picks the inventory with --which', () => {
    const row = (chunks: number) => ({
      sourceType: 'quiz',
      catalog: 'KFBM',
      visibility: 'all',
      unit: 'chunks',
      chunks,
      chars: chunks * 100,
      pages: 0,
    });
    const log = JSON.stringify({
      plan: { inventory: [row(9)], changes: [row(4)] },
    });
    const both = files({ 'log.json': log, [DEFAULT_PRICING]: PRICING });
    expect(
      JSON.parse(runCostCli(['--inventory', 'log.json', '--json'], both).stdout)
        .totals.chunks
    ).toBe(4);
    expect(
      JSON.parse(
        runCostCli(
          ['--inventory', 'log.json', '--which', 'inventory', '--json'],
          both
        ).stdout
      ).totals.chunks
    ).toBe(9);
  });

  it('prices only the trainer solutions of a dry run with --which trainer-solutions', () => {
    const row = {
      sourceType: 'document (trainer solution PDFs, not chunks)',
      catalog: 'KFBM',
      visibility: 'trainer',
      unit: 'files',
      chunks: 8,
      chars: 0,
      pages: 40,
    };
    const log = JSON.stringify({
      plan: { inventory: [], changes: [], trainerSolutions: [row] },
    });
    const both = files({ 'log.json': log, [DEFAULT_PRICING]: PRICING });
    const out = runCostCli(
      ['--inventory', 'log.json', '--which', 'trainer-solutions', '--json'],
      both
    );
    expect(out.exitCode).toBe(0);
    const parsed = JSON.parse(out.stdout);
    expect(parsed.totals.files).toBe(8);
    expect(parsed.groups[0].sourceType).toContain('trainer solution');
  });

  it.each([
    [[], /--inventory/],
    [['--inventory'], /needs a value/],
    [['--inventory', 'inv.json', '--runs', '0'], /--runs/],
    [['--inventory', 'inv.json', '--runs', 'x'], /--runs/],
    [['--inventory', 'inv.json', '--eur-per-usd', '-1'], /--eur-per-usd/],
    [['--inventory', 'inv.json', '--which', 'all'], /--which/],
    [['--inventory', 'inv.json', '--apply'], /Unknown argument/],
    [['--inventory', 'missing.json'], /missing\.json/],
  ])('refuses %j with exit code 2', (argv, message) => {
    const out = runCostCli(argv as string[], read);
    expect(out.exitCode).toBe(2);
    expect(out.stderr).toMatch(message);
    expect(out.stdout).toBe('');
  });

  it('refuses a file that is no JSON or no inventory', () => {
    const out = runCostCli(
      ['--inventory', 'bad.json'],
      files({ 'bad.json': '{nope', [DEFAULT_PRICING]: PRICING })
    );
    expect(out.exitCode).toBe(2);
    // the message names the file, not a snippet of its content
    expect(out.stderr).toMatch(/bad\.json is no valid JSON/);
    expect(out.stderr).not.toContain('nope');
    const empty = runCostCli(
      ['--inventory', 'empty.json'],
      files({ 'empty.json': '{}', [DEFAULT_PRICING]: PRICING })
    );
    expect(empty.exitCode).toBe(2);
    expect(empty.stderr).toMatch(/inventory/i);
  });

  it('prints the help and exits 0', () => {
    const out = runCostCli(['--help'], read);
    expect(out.exitCode).toBe(0);
    expect(out.stdout).toContain('--inventory');
  });
});

describe('scripts/hai-embedding-cost.ts', () => {
  const script = fs.readFileSync(
    path.join(process.cwd(), 'scripts', 'hai-embedding-cost.ts'),
    'utf-8'
  );

  it('touches neither network nor database nor secrets', () => {
    expect(script).not.toMatch(/postgres|dotenv|haiDb|@\/db/);
    expect(script).not.toMatch(/fetch\(|https?:\/\/|XMLHttpRequest|node:http/);
    expect(script).not.toMatch(/process\.env/);
    expect(script).not.toMatch(/GEMINI|API_KEY/);
  });

  it('hands only fs.readFileSync to the cli', () => {
    expect(script).toMatch(/runCostCli\(process\.argv\.slice\(2\)/);
    expect(script).toMatch(/readFileSync/);
  });
});
