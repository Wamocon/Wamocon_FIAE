// Probes of package U1 (docs/ki-upload-spike-verbindungsadapter.md): what a
// transaction mode pooler (PgBouncer here, Supavisor on port 6543 in Preview) does to the
// things the apply engine and the web apply rely on. Local only: loopback hosts, a
// scratch table in a throwaway database, no content of the app.
//
// Usage:
//   node scripts/spike/content-upload-pooler-probes.mjs \
//     --pooler postgresql://user:pw@127.0.0.1:<pooler port>/<db> \
//     --direct postgresql://user:pw@127.0.0.1:<database port>/<db> [--only p1,p3]
//
// Each probe prints one line "pN <name>: <observation>". Nothing is asserted: the
// output is the measurement, the document interprets it.

import { performance } from 'node:perf_hooks';
import pg from 'pg';
import postgres from 'postgres';

const LOOPBACK = new Set(['127.0.0.1', 'localhost', '[::1]']);
const THROWAWAY_DATABASE = /^(u1_|throwaway)/;

function parseArgs(argv) {
  const out = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].replace(/^--/, '');
    out[key] = argv[i + 1];
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));
if (!args.pooler || !args.direct) {
  console.error(
    'Usage: --pooler <local url> --direct <local url> [--only p1,p3]'
  );
  process.exit(2);
}
for (const value of [args.pooler, args.direct]) {
  const target = new URL(value);
  if (!LOOPBACK.has(target.hostname)) {
    console.error(
      `Refused: the host ${target.hostname} is not a loopback address.`
    );
    process.exit(1);
  }
  // A loopback address can also be an SSH tunnel to a real server: the probes
  // create and drop a table, so the database must be a throwaway one by name.
  if (!THROWAWAY_DATABASE.test(target.pathname.slice(1))) {
    console.error(
      'Refused: the database name must start with u1_ or throwaway (a throwaway database).'
    );
    process.exit(1);
  }
}
const only = args.only ? new Set(args.only.split(',')) : null;

const pgClient = async url => {
  const u = new URL(url);
  const client = new pg.Client({
    host: u.hostname,
    port: Number(u.port),
    user: decodeURIComponent(u.username),
    password: decodeURIComponent(u.password),
    database: u.pathname.slice(1),
    ssl: false,
  });
  await client.connect();
  return client;
};
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
/** A query that never answers (protocol out of step) counts as a failure after 5 s. */
const within = (promise, ms = 5000) =>
  Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error('no answer within 5 s')), ms)
    ),
  ]);
const say = (id, name, text) => console.log(`${id} ${name}: ${text}`);
const first = result => result.rows[0];

async function p1PreparedStatements() {
  // postgres-js with named prepared statements (its default for tagged queries)
  for (const prepare of [true, false]) {
    const sql = postgres(args.pooler, {
      max: 10,
      ssl: false,
      prepare,
      idle_timeout: 2,
    });
    let ok = 0;
    let total = 0;
    let firstError = '';
    // parallel rounds: the pooler hands the client connections to different server connections
    for (let round = 0; round < 5; round++) {
      await Promise.all(
        Array.from({ length: 40 }, async (_, i) => {
          total++;
          try {
            await within(sql`select ${i}::int as n, ${round}::int as r`);
            ok++;
          } catch (error) {
            firstError ||= `${error.code ?? ''} ${String(error.message).split('\n')[0]}`;
          }
        })
      );
    }
    await sql.end({ timeout: 1 });
    say(
      'p1',
      `prepared statements (tagged queries), prepare:${prepare}`,
      `${ok} of ${total} queries ok${firstError ? `, first error: ${firstError}` : ''}`
    );
  }
  // unsafe() with parameters (what the adapter and the engine send)
  const sql = postgres(args.pooler, {
    max: 10,
    ssl: false,
    prepare: true,
    idle_timeout: 2,
  });
  let ok = 0;
  for (let round = 0; round < 5; round++) {
    await Promise.all(
      Array.from({ length: 40 }, async (_, i) => {
        try {
          const rows = await within(sql.unsafe('select $1::int as n', [i]));
          if (rows[0].n === i) ok++;
        } catch {
          // counted as not ok
        }
      })
    );
  }
  await sql.end({ timeout: 2 });
  say(
    'p1',
    'unsafe() with parameters (prepare:true set), parallel',
    `${ok} of 200 queries ok`
  );
  // pg with a parameterised query: unnamed statement, no prepare
  const client = await pgClient(args.pooler);
  let pgOk = 0;
  for (let i = 0; i < 12; i++) {
    const r = await client.query('select $1::int as n', [i]);
    if (r.rows[0].n === i) pgOk++;
  }
  await client.end();
  say('p1', 'pg client, parameterised queries', `${pgOk} of 12 queries ok`);
}

async function p2SessionState() {
  const a = await pgClient(args.pooler);
  await a.query("set statement_timeout = '7s'");
  const same = first(await a.query('show statement_timeout')).statement_timeout;
  await a.end();
  const b = await pgClient(args.pooler);
  const other = first(
    await b.query('show statement_timeout')
  ).statement_timeout;
  await b.end();
  say(
    'p2',
    'session level set (not local)',
    `client A sets 7s and sees ${same}; the next client B sees ${other} (leaked to another client: ${other === '7s'})`
  );
  const reset = await pgClient(args.direct);
  await reset.query('select 1');
  await reset.end();
  const c = await pgClient(args.pooler);
  await c.query('begin');
  await c.query("set local statement_timeout = '9s'");
  const inside = first(
    await c.query('show statement_timeout')
  ).statement_timeout;
  await c.query('commit');
  const after = first(
    await c.query('show statement_timeout')
  ).statement_timeout;
  await c.end();
  say(
    'p2',
    'set local inside begin..commit',
    `inside ${inside}, after commit ${after}`
  );
}

async function p3AdvisoryLocks() {
  const direct = await pgClient(args.direct);
  // session level lock taken through the pooler and the client leaves
  const a = await pgClient(args.pooler);
  await a.query('select pg_advisory_lock(777001)');
  await a.end();
  await sleep(300);
  const held = first(
    await direct.query(
      "select count(*)::int as n from pg_locks where locktype = 'advisory' and objid = 777001 and granted"
    )
  ).n;
  say(
    'p3',
    'session level advisory lock, client gone',
    `${held} lock(s) still held by a pooled server connection`
  );
  // clean up: release on every server connection of the pool by hand
  const holders = (
    await direct.query(
      "select pid from pg_locks where locktype = 'advisory' and objid = 777001 and granted"
    )
  ).rows;
  for (const { pid } of holders)
    await direct.query('select pg_terminate_backend($1)', [pid]);
  await sleep(300);
  // transaction level lock: two clients, the second must not get it while the first holds it
  const x = await pgClient(args.pooler);
  const y = await pgClient(args.pooler);
  await x.query('begin');
  const gotX = first(
    await x.query(
      "select pg_try_advisory_xact_lock(hashtext('u1-spike')) as locked"
    )
  ).locked;
  await y.query('begin');
  const gotY = first(
    await y.query(
      "select pg_try_advisory_xact_lock(hashtext('u1-spike')) as locked"
    )
  ).locked;
  await y.query('rollback');
  await x.query('commit');
  await y.query('begin');
  const gotYAfter = first(
    await y.query(
      "select pg_try_advisory_xact_lock(hashtext('u1-spike')) as locked"
    )
  ).locked;
  await y.query('rollback');
  await x.end();
  await y.end();
  say(
    'p3',
    'transaction level advisory lock (engine)',
    `first client ${gotX}, second client while held ${gotY}, second client after commit ${gotYAfter}`
  );
  await direct.end();
}

async function p4Pinning() {
  const sql = postgres(args.pooler, {
    max: 6,
    ssl: false,
    prepare: false,
    idle_timeout: 2,
  });
  // background traffic so that the pool has to hand server connections around
  let stop = false;
  const noise = Array.from({ length: 4 }, async () => {
    while (!stop) {
      await sql.unsafe('select pg_backend_pid()', []);
    }
  });
  const reserved = await sql.reserve();
  await reserved.unsafe('begin isolation level repeatable read read write', []);
  const pids = new Set();
  for (let i = 0; i < 40; i++) {
    pids.add(
      (await reserved.unsafe('select pg_backend_pid() as pid', []))[0].pid
    );
  }
  const iso = (await reserved.unsafe('show transaction_isolation', []))[0]
    .transaction_isolation;
  await reserved.unsafe('rollback', []);
  const outside = new Set();
  for (let i = 0; i < 20; i++) {
    outside.add(
      (await reserved.unsafe('select pg_backend_pid() as pid', []))[0].pid
    );
  }
  reserved.release();
  stop = true;
  await Promise.all(noise);
  await sql.end({ timeout: 2 });
  say(
    'p4',
    'server connection inside the transaction',
    `${pids.size} backend(s) for 40 statements, isolation ${iso}`
  );
  say(
    'p4',
    'server connections outside a transaction (same client)',
    `${outside.size} backend(s) for 20 statements`
  );
}

async function p5SqlBegin() {
  const direct = await pgClient(args.direct);
  const idleInTransaction = async () =>
    first(
      await direct.query(
        "select count(*)::int as n from pg_stat_activity where datname = current_database() and state = 'idle in transaction'"
      )
    ).n;
  const pool = postgres(args.pooler, {
    max: 3,
    ssl: false,
    prepare: false,
    idle_timeout: 20,
  });
  try {
    await pool.unsafe('begin isolation level repeatable read', []);
    say('p5', 'unsafe(begin) on the pool (no reserve)', 'accepted');
  } catch (error) {
    say(
      'p5',
      'unsafe(begin) on the pool (no reserve)',
      `${error.code} ${error.message}`
    );
  }
  await sleep(300);
  say(
    'p5',
    'after that error',
    `${await idleInTransaction()} backend(s) idle in transaction (the BEGIN was executed before the error)`
  );
  await pool.end({ timeout: 2 });
  await sleep(300);
  for (const [label, target] of [
    ['direct', args.direct],
    ['pooler', args.pooler],
  ]) {
    const fresh = postgres(target, {
      max: 2,
      ssl: false,
      prepare: false,
      idle_timeout: 2,
      onnotice: () => undefined,
    });
    try {
      const iso = await fresh.begin(async tx => {
        await tx.unsafe('begin isolation level repeatable read', []);
        return (await tx.unsafe('show transaction_isolation', []))[0]
          .transaction_isolation;
      });
      say(
        'p5',
        `nested begin inside sql.begin(), ${label}`,
        `isolation actually in effect: ${iso} (requested repeatable read)`
      );
    } catch (error) {
      say(
        'p5',
        `nested begin inside sql.begin(), ${label}`,
        `${error.code ?? ''} ${error.message}`
      );
    }
    await fresh.end({ timeout: 2 });
  }
  const sql = postgres(args.pooler, {
    max: 3,
    ssl: false,
    prepare: false,
    idle_timeout: 2,
  });
  const reserved = await sql.reserve();
  await reserved.unsafe('begin isolation level repeatable read read write', []);
  const iso = (await reserved.unsafe('show transaction_isolation', []))[0]
    .transaction_isolation;
  await reserved.unsafe('rollback', []);
  reserved.release();
  say('p5', 'begin on sql.reserve()', `isolation in effect: ${iso}`);
  await sql.end({ timeout: 2 });
  await direct.end();
}

async function p6PoolSlots() {
  // How long does a long transaction block everybody else when the pool is small?
  const direct = await pgClient(args.direct);
  const size = Number(
    first(
      await direct.query("select current_setting('max_connections')::int as n")
    ).n
  );
  await direct.end();
  const holders = [];
  const slots = Number(args.poolsize ?? 5);
  for (let i = 0; i < slots; i++) {
    const c = await pgClient(args.pooler);
    await c.query('begin');
    await c.query('select 1');
    holders.push(c);
  }
  const waiter = await pgClient(args.pooler);
  const started = performance.now();
  const release = (async () => {
    await sleep(2500);
    for (const c of holders) await c.query('commit');
  })();
  await waiter.query('select 1');
  const waited = performance.now() - started;
  await release;
  for (const c of holders) await c.end();
  await waiter.end();
  say(
    'p6',
    `${slots} open transactions fill the pool, a 6th client asks for a connection`,
    `answered after ${(waited / 1000).toFixed(1)} s (max_connections of the database: ${size})`
  );
}

async function p7ClientGone() {
  const direct = await pgClient(args.direct);
  await direct.query(
    'create table if not exists public.u1_probe (id serial primary key, note text)'
  );
  await direct.query('truncate public.u1_probe');
  const a = await pgClient(args.pooler);
  await a.query('begin');
  await a.query(
    "insert into public.u1_probe (note) values ('client dies before commit')"
  );
  a.on('error', () => undefined);
  a.connection.stream.destroy();
  await sleep(1000);
  const rows = first(
    await direct.query('select count(*)::int as n from public.u1_probe')
  ).n;
  const idle = first(
    await direct.query(
      "select count(*)::int as n from pg_stat_activity where datname = current_database() and state = 'idle in transaction'"
    )
  ).n;
  say(
    'p7',
    'client connection dies inside the transaction',
    `rows kept: ${rows}, backends left idle in transaction: ${idle}`
  );
  await direct.query('drop table public.u1_probe');
  await direct.end();
}

const probes = {
  p1: p1PreparedStatements,
  p2: p2SessionState,
  p3: p3AdvisoryLocks,
  p4: p4Pinning,
  p5: p5SqlBegin,
  p6: p6PoolSlots,
  p7: p7ClientGone,
};
for (const [id, probe] of Object.entries(probes)) {
  if (only && !only.has(id)) continue;
  try {
    await probe();
  } catch (error) {
    say(
      id,
      'FAILED',
      `${error.code ?? ''} ${String(error.message).split('\n')[0]}`
    );
  }
}
