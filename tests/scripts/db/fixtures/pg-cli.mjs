// Stand-in for the Supabase CLI against a LOCAL throwaway Postgres. It
// understands only what scripts/db/preview-migrate.mjs needs for apply and
// rebuild: "db query --db-url <url> -f <file> --output-format json --agent no".
// Use it with SUPABASE_CLI=tests/scripts/db/fixtures/pg-cli.mjs (the helper
// scripts/db/preview-cli.mjs starts a path that ends in .js or .mjs with node).
//
// Safety: it refuses every host except localhost, so it can never reach a
// hosted project by accident.

import { readFileSync } from 'node:fs';
import pg from 'pg';

const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

async function main() {
  const args = process.argv.slice(2);
  if (args[0] !== 'db' || args[1] !== 'query') {
    throw new Error(`pg-cli supports only "db query", got: ${args.join(' ')}`);
  }
  const url = argValue(args, '--db-url');
  const file = argValue(args, '-f');
  if (!url || !file) throw new Error('--db-url and -f are required');
  const host = new URL(url).hostname;
  if (!LOCAL_HOSTS.has(host)) {
    throw new Error(`pg-cli only talks to a local database, not to ${host}`);
  }
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    // Simple query protocol: several statements per file are allowed
    const result = await client.query(readFileSync(file, 'utf8'));
    const last = Array.isArray(result) ? result.at(-1) : result;
    process.stdout.write(JSON.stringify(last?.rows ?? []));
  } finally {
    await client.end();
  }
}

main().catch(e => {
  process.stderr.write(`${e.message}\n`);
  process.exit(1);
});
