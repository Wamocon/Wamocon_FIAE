// Spike of package U1 (docs/ki-upload-spike-verbindungsadapter.md): does the apply
// engine run on a RESERVED connection behind a transaction mode pooler, and how long
// does it take? Local only. The script refuses every host except a loopback address,
// reads no environment file and prints no content of the plan.
//
// Variants (how the engine reaches the database):
//   pg-direct       pg.Client on the database itself (what the import script does)
//   pg-pooler       pg.Client on the pooler (one client connection holds the transaction)
//   pgjs-pooler     postgres-js with sql.reserve() on the pooler, prepare: false
//                   (the adapter of src/lib/content-upload/connection.ts, the app setup)
//   pgjs-begin      postgres-js with sql.begin() and the engine sending its own begin,
//                   commit and rollback inside it (the setup that the concept ruled out;
//                   measured to see why it is fragile, see the document)
//
// Usage:
//   node scripts/spike/content-upload-connection.mjs --variant <name> \
//     --url postgresql://user:pw@127.0.0.1:<port>/<db> --plan <plan.json> \
//     --created-by <profile uuid> [--mode check|dry-run|apply] [--repeat 3] [--facts no] [--latency <ms>]
//
// The plan is the JSON of `npm run import:kfbm:apply -- plan ...`. It holds the texts
// of the source files: keep it out of the repository.

import { readFileSync } from 'node:fs';
import { performance } from 'node:perf_hooks';
import { runJob, validatePlan } from '../import/kfbm-apply-modules.mjs';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const THROWAWAY_DATABASE = /^(u1_|throwaway)/;
const VARIANTS = ['pg-direct', 'pg-pooler', 'pgjs-pooler', 'pgjs-begin'];

function parseArgs(argv) {
  const out = { mode: 'dry-run', repeat: 1, facts: true, latency: 0 };
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i];
    const value = argv[i + 1];
    if (key === '--variant') out.variant = value;
    else if (key === '--url') out.url = value;
    else if (key === '--plan') out.plan = value;
    else if (key === '--created-by') out.createdBy = value;
    else if (key === '--mode') out.mode = value;
    else if (key === '--repeat') out.repeat = Number(value);
    else if (key === '--facts') out.facts = value !== 'no';
    else if (key === '--latency') out.latency = Number(value);
    else throw new Error(`unknown option ${key}`);
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (
  !VARIANTS.includes(args.variant) ||
  !args.url ||
  !args.plan ||
  !args.createdBy ||
  !['check', 'dry-run', 'apply'].includes(args.mode)
) {
  console.error(
    'Usage: --variant <pg-direct|pg-pooler|pgjs-pooler|pgjs-begin> --url <local url> --plan <file> --created-by <uuid> [--mode check|dry-run|apply] [--repeat n]'
  );
  process.exit(2);
}
const url = new URL(args.url);
if (!LOOPBACK.has(url.hostname)) {
  console.error(
    `Refused: the host ${url.hostname} is not a loopback address. This spike runs against a local container only.`
  );
  process.exit(1);
}
// A loopback address can also be an SSH tunnel to a real server: the database must
// carry the name of a throwaway database (u1_... or throwaway...).
if (!THROWAWAY_DATABASE.test(url.pathname.slice(1))) {
  console.error(
    'Refused: the database name must start with u1_ or throwaway (a throwaway database).'
  );
  process.exit(1);
}

const plan = JSON.parse(readFileSync(args.plan, 'utf8'));
const problems = validatePlan(plan);
if (problems.length > 0) {
  console.error(
    `The plan is not valid (${problems.length} problem(s), first: ${problems.slice(0, 3).join('; ')}).`
  );
  process.exit(1);
}

const { withReservedConnection, fromPostgresJs } = await import(
  new URL('../../src/lib/content-upload/connection.ts', import.meta.url).href
);

const input = {
  mode: args.mode,
  createdBy: args.createdBy,
  updateExisting: false,
  activate: false,
  scenarioSolutions: false,
};

const totals = report =>
  Object.entries(report.tables)
    .map(
      ([name, c]) =>
        `${name}=${c.insert}/${c.update}/${c.unchanged}`
    )
    .join(' ');

/**
 * Counts the statements of a run and, with --latency, waits that many milliseconds
 * before each one (a stand-in for the round trip to a hosted database).
 */
function measured(client, counter) {
  return {
    async query(text, values) {
      counter.statements += 1;
      if (args.latency > 0) {
        await new Promise(resolve => setTimeout(resolve, args.latency));
      }
      return client.query(text, values);
    },
  };
}

async function run(rawClient) {
  const counter = { statements: 0 };
  const client = measured(rawClient, counter);
  // The facts of the connection (target check of the engine) are read first, on the same
  // connection, as the web apply has to do. --facts no skips it.
  const facts = args.facts
    ? (
        await client.query(
          'select current_schema() as schema, current_user as role, pg_backend_pid() as pid'
        )
      ).rows[0]
    : { schema: '-', role: '-', pid: 0 };
  const started = performance.now();
  const report = await runJob(client, plan, input);
  const ms = performance.now() - started;
  return { facts, report, ms, statements: counter.statements };
}

async function once() {
  if (args.variant === 'pg-direct' || args.variant === 'pg-pooler') {
    const { default: pg } = await import('pg');
    const client = new pg.Client({
      host: url.hostname,
      port: Number(url.port),
      user: decodeURIComponent(url.username),
      password: decodeURIComponent(url.password),
      database: url.pathname.slice(1),
      ssl: false,
    });
    const connectStarted = performance.now();
    await client.connect();
    const connectMs = performance.now() - connectStarted;
    try {
      return { connectMs, ...(await run(client)) };
    } finally {
      await client.end();
    }
  }
  const { default: postgres } = await import('postgres');
  const notices = [];
  const sql = postgres(args.url, {
    max: 4,
    idle_timeout: 5,
    connect_timeout: 15,
    ssl: false,
    prepare: false,
    onnotice: notice => notices.push(`${notice.code} ${notice.message}`),
  });
  try {
    const connectStarted = performance.now();
    let result;
    if (args.variant === 'pgjs-begin') {
      result = await sql.begin(tx =>
        run({
          async query(text, values) {
            const rows = await tx.unsafe(text, values ?? []);
            return { rows: Array.from(rows), rowCount: rows.count ?? null };
          },
        })
      );
      if (notices.length > 0) {
        console.log(`  server notices: ${[...new Set(notices)].join('; ')}`);
      }
    } else {
      result = await withReservedConnection(
        fromPostgresJs(sql),
        client => run(client),
        { reserveTimeoutMs: 15000 }
      );
    }
    return {
      connectMs: performance.now() - connectStarted - result.ms,
      ...result,
    };
  } finally {
    await sql.end({ timeout: 5 });
  }
}

for (let i = 1; i <= args.repeat; i++) {
  try {
    const { connectMs, facts, report, ms, statements } = await once();
    console.log(
      `${args.variant} ${args.mode} run ${i}: engine ${(ms / 1000).toFixed(2)} s, connect ${connectMs.toFixed(0)} ms, schema ${facts.schema}, role ${facts.role}, statements ${statements}, latency ${args.latency} ms, conflicts ${report.conflicts.length}, wrote ${report.wrote}`
    );
    if (i === 1) console.log(`  rows (new/updated/unchanged): ${totals(report)}`);
  } catch (error) {
    console.log(
      `${args.variant} ${args.mode} run ${i}: FAILED ${error.code ?? ''} ${String(error.message).split('\n')[0]}`
    );
    process.exitCode = 1;
  }
}
