// Local rehearsal of the KfBM rollout migrations on a throwaway Postgres.
//
// What it does (nothing else, nothing hosted):
//   1. starts ONE throwaway container (no published port, reached only through
//      "docker exec", removed at the end, also after an error; after a hard abort the
//      label wmc-rehearsal=1 finds a leftover, see docs/kfbm-rollout-probelauf.md),
//   2. builds a production-like starting schema: either from a structure file
//      the owner passes with --structure (a local dump, never stored in the
//      repository), or from the schema history in the repository
//      (src/db/migrations/drizzle replayed in file order, errors tolerated and
//      counted, see docs/kfbm-rollout-probelauf.md for the known gap),
//   3. applies the manual baseline (202606260001 and the hardening files before
//      20261024000100), loads invented sample rows, runs the V checks of
//      docs/kfbm-production-rollout-checks.sql,
//   4. exercises the rollout gate (scripts/db/rollout-gate.mjs and
//      baseline-guard.mjs) on a plan text, with the gate closed and open,
//   5. applies the gated migrations from 20261024000100 on, one transaction per
//      file, with the ledger row after each file, times every file, expects the
//      Super admin backfill to hold until the approval token is set,
//   6. runs the N checks, compares the row counts of the existing tables and
//      removes the container.
//
// KFBM_ROLLOUT_APPROVED is set only in the environment of the gate child process
// of this run. The script never reads a connection string, a password or a
// secret from the environment or from a file and never connects to a host: the
// database password of the container is random per run and is not printed.
//
// Usage (default: plan only, nothing is started):
//   node scripts/db/rehearse-rollout-local.mjs               print the plan
//   node scripts/db/rehearse-rollout-local.mjs --run         run the rehearsal
//   options: --image <name>        container image (default below, must exist locally)
//            --structure <file>    local structure dump instead of the repository history
//            --no-seed             skip the invented sample rows
//            --keep                keep the container (prints its name), for debugging
//            --json <file>         write the result as JSON
//            --pull                allow "docker pull" of a missing image
//
// Exit code 0 only if every expectation holds.

import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readLegacyEntries } from './migration-check.mjs';
import { GATED_FROM } from './rollout-gate.mjs';

const REPO = resolve(dirname(fileURLToPath(import.meta.url)), '../..');
export const DEFAULT_IMAGE = 'public.ecr.aws/supabase/postgres:17.11.0.006';
const APPROVAL_COMMENT =
  "comment on type public.user_role is 'super_admin_backfill=approved'";
const BACKFILL_VERSION = '20261025000000';
const STRICT_NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;
const LOOSE_NAME = /^(\d{12,14})_[a-z0-9_]+\.sql$/;

// ---------------------------------------------------------------------------
// Pure helpers (unit tested)
// ---------------------------------------------------------------------------

export function parseArgs(argv) {
  const opts = {
    run: false,
    help: false,
    image: DEFAULT_IMAGE,
    structure: null,
    seed: true,
    keep: false,
    json: null,
    pull: false,
    baselineOnly: false,
  };
  const value = (i, name) => {
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') opts.run = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--no-seed') opts.seed = false;
    else if (a === '--keep') opts.keep = true;
    else if (a === '--pull') opts.pull = true;
    else if (a === '--baseline-only') opts.baselineOnly = true;
    else if (a === '--image') {
      opts.image = value(i++, a);
      // an image name never starts with a dash, docker would read it as an option
      if (opts.image.startsWith('-'))
        throw new Error('--image needs an image name');
    } else if (a === '--structure') opts.structure = value(i++, a);
    else if (a === '--json') opts.json = value(i++, a);
    else throw new Error(`Unknown argument: ${a}`);
  }
  return opts;
}

/** Container names are generated, never taken from input. */
export function containerName(suffix = randomBytes(4).toString('hex')) {
  return `wmc-rehearsal-${suffix}`;
}

/** Sorted migration files with their versions. */
export function listMigrations(names) {
  return names
    .filter(n => LOOSE_NAME.test(n))
    .map(file => ({ file, version: file.split('_')[0] }))
    .sort((a, b) =>
      a.version.padEnd(14, '0').localeCompare(b.version.padEnd(14, '0'))
    );
}

/**
 * Splits the migrations into the part that production already has by hand (legacy
 * files marked applied, hardening files older than the gate) and the gated part.
 */
export function classifyMigrations(
  names,
  legacyEntries,
  gatedFrom = GATED_FROM
) {
  const applied = new Set(
    legacyEntries.filter(e => e.state === 'applied').map(e => e.file)
  );
  const baseline = [];
  const gated = [];
  const unexpected = [];
  for (const m of listMigrations(names)) {
    if (m.version.length === 12) {
      (applied.has(m.file) ? baseline : unexpected).push(m);
    } else if (!STRICT_NAME.test(m.file)) {
      unexpected.push(m);
    } else if (m.version < gatedFrom) {
      baseline.push(m);
    } else {
      gated.push(m);
    }
  }
  return { baseline, gated, unexpected };
}

/** The history files of the schema in replay order (file name order). */
export function historyFiles(names) {
  return names.filter(n => /^\d{4}_.+\.sql$/.test(n)).sort();
}

/** Text that looks like the output of "supabase db push --dry-run". */
export function planText(files) {
  return `Would push these migrations:\n${files.map(f => ` • ${f}`).join('\n')}\n\nFinished supabase db push.\n`;
}

/** Splits docs/kfbm-production-rollout-checks.sql into its V and N checks. */
export function splitChecks(sqlText) {
  const lines = sqlText.split(/\r?\n/);
  const checks = [];
  let current = null;
  for (const line of lines) {
    const m = /^-- ([VN]\d{2}[a-z]?)\. /.exec(line);
    if (m) {
      current = { id: m[1], kind: m[1][0], lines: [line] };
      checks.push(current);
    } else if (current && /^-- =+$/.test(line)) {
      current = null;
    } else if (current) {
      current.lines.push(line);
    }
  }
  return checks.map(c => ({ id: c.id, kind: c.kind, sql: c.lines.join('\n') }));
}

/** Minimal CSV parser for psql --csv output. */
export function parseCsv(text) {
  const rows = [];
  let row = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') {
        field += '"';
        i++;
      } else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ',') {
      row.push(field);
      field = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else field += ch;
  }
  if (field !== '' || row.length) {
    row.push(field);
    rows.push(row);
  }
  return rows.filter(r => !(r.length === 1 && r[0] === ''));
}

/**
 * Expectations that hold in the local rehearsal. A check without an entry is
 * informational: it has to run without an error, the output is kept in the report.
 * Each function gets the parsed rows (header first) and returns an error text or null.
 */
export const EXPECTATIONS = {
  // The hardening files are applied by hand in production, authenticated must not
  // change the own role (the Super admin backfill relies on it)
  V03b: rows =>
    rows[1]?.[0] === 'f' ? null : 'authenticated can update profiles.role',
  // The catalog structure must not exist before the series
  N01: rows =>
    rows.length === 1
      ? null
      : `${rows.length - 1} ledger row(s) differ from the repository`,
  N02: rows => {
    const header = rows[0] ?? [];
    const col = header.indexOf('present');
    if (col < 0) return 'column "present" missing';
    const missing = rows.slice(1).filter(r => r[col] === 'f');
    return missing.length === 0
      ? null
      : `${missing.length} object(s) of the series missing`;
  },
};

/** What the data steps of the series must have produced from the sample rows of 10-seed.sql. */
export const EVIDENCE_SQL = `
  select (select count(*) from public.profiles where role = 'SUPER_ADMIN') as super_admins,
         (select count(*) from public.trainee_enrollments) as enrollments,
         (select count(*) from public.training_catalog_learning_fields) as learning_fields;`;

/** [super admins, enrollments, copied learning fields] -> error text or null. */
export function evidenceProblem([superAdmins, enrollments, learningFields]) {
  const problems = [];
  if (superAdmins !== 1)
    problems.push(
      `expected 1 Super admin of the platform organization, found ${superAdmins}`
    );
  if (enrollments !== 3)
    problems.push(
      `expected 3 enrollments (one per trainee), found ${enrollments}`
    );
  if (learningFields < 2)
    problems.push(
      `expected the 2 learning fields copied, found ${learningFields}`
    );
  return problems.join('; ');
}

/** Compares row counts before and after: nothing may disappear. */
export function compareCounts(before, after) {
  const lost = [];
  const changed = [];
  for (const [table, count] of Object.entries(before)) {
    const now = after[table];
    if (now === undefined) {
      // a table the series turns into a view keeps its rows as <table>_legacy
      const legacy = after[`${table}_legacy`];
      if (legacy !== undefined && legacy >= count)
        changed.push(
          `${table} (renamed to ${table}_legacy, ${count} rows kept)`
        );
      else lost.push(`${table} (table gone)`);
    } else if (now < count) lost.push(`${table} (${count} -> ${now})`);
    else if (now !== count) changed.push(`${table} (${count} -> ${now})`);
  }
  return { lost, changed };
}

/** Failure text of a psql run, the first error line only (no values, no secrets). */
export function firstError(stderr) {
  const line = String(stderr)
    .split(/\r?\n/)
    .find(l => /ERROR:|FATAL:/.test(l));
  return line ? line.replace(/^.*?(ERROR:|FATAL:)/, '$1').trim() : '';
}

export function countErrors(stderr) {
  return String(stderr)
    .split(/\r?\n/)
    .filter(l => /ERROR:/.test(l)).length;
}

export function describePlan(opts, files) {
  const lines = [
    'Plan of the local rollout rehearsal (nothing is started without --run):',
    `  1. start one throwaway container from ${opts.image} (no published port)`,
    opts.structure
      ? `  2. load the structure file ${opts.structure} (never stored in the repository)`
      : `  2. build the starting schema by replaying ${files.history} history file(s) of src/db/migrations/drizzle`,
    `  3. apply the manual baseline: ${files.baseline} file(s) (legacy and hardening files before ${GATED_FROM})`,
    opts.seed ? '  4. load invented sample rows' : '  4. (sample rows skipped)',
    '  5. run the V checks of docs/kfbm-production-rollout-checks.sql',
    '  6. exercise rollout-gate and baseline-guard on a plan text, gate closed and open',
    `  7. apply ${files.gated} gated migration(s) from ${GATED_FROM} on, one transaction each, timed;`,
    `     the Super admin backfill (${BACKFILL_VERSION}) must hold until the approval token is set`,
    '  8. run the N checks, compare the row counts of the existing tables',
    '  9. remove the container',
    'Run it with --run. It needs Docker and the image present locally (or --pull).',
  ];
  return lines.join('\n');
}

// ---------------------------------------------------------------------------
// Docker access
// ---------------------------------------------------------------------------

const DOCKER_TIMEOUT_MS = 10 * 60 * 1000;

/** Only a daemon on this machine is used: a unix socket or a Windows named pipe. */
export function isLocalDockerHost(host) {
  return /^(unix:\/\/|npipe:\/\/)/.test(String(host ?? '').trim());
}

/** The environment of the docker calls, without a way to point them at another daemon. */
export function dockerBaseEnv(env = process.env) {
  const copy = { ...env };
  delete copy.DOCKER_HOST;
  delete copy.DOCKER_CONTEXT;
  return copy;
}

function docker(args, { input, env, timeout } = {}) {
  const r = spawnSync('docker', args, {
    input,
    encoding: 'utf8',
    env: env ?? dockerBaseEnv(),
    timeout: timeout ?? DOCKER_TIMEOUT_MS,
    maxBuffer: 256 * 1024 * 1024,
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? '',
  };
}

function dockerAvailable() {
  if (docker(['version', '--format', '{{.Server.Version}}']).status !== 0) {
    return false;
  }
  // a remote context would run the container, the schema and a structure dump elsewhere
  const host = docker([
    'context',
    'inspect',
    '--format',
    '{{.Endpoints.docker.Host}}',
  ]);
  return host.status === 0 && isLocalDockerHost(host.stdout);
}

function imagePresent(image) {
  return docker(['image', 'inspect', image]).status === 0;
}

class Rehearsal {
  constructor(name, adminUser) {
    this.name = name;
    this.adminUser = adminUser;
    this.removed = false;
  }

  /** Runs psql in the container as `user`, SQL on stdin. */
  psql(user, sql, flags = []) {
    return docker(
      [
        'exec',
        '-i',
        this.name,
        'psql',
        '-U',
        user,
        '-d',
        'postgres',
        '-X',
        '-q',
        '-P',
        'pager=off',
        ...flags,
        '-f',
        '-',
      ],
      { input: sql }
    );
  }

  /** As the application role (postgres), stop at the first error, one transaction. */
  file(sql) {
    return this.psql('postgres', sql, ['-v', 'ON_ERROR_STOP=1', '-1']);
  }

  /** As the application role, keep going on errors (history replay). */
  tolerant(sql) {
    return this.psql('postgres', sql, ['-v', 'ON_ERROR_STOP=0']);
  }

  query(sql) {
    return this.psql('postgres', sql, ['-v', 'ON_ERROR_STOP=1', '--csv']);
  }

  remove() {
    if (this.removed) return;
    docker(['rm', '-f', '-v', this.name]);
    this.removed = true;
  }
}

// ---------------------------------------------------------------------------
// The rehearsal
// ---------------------------------------------------------------------------

const rootFile = (...p) => join(REPO, ...p);
const readSql = (...p) => readFileSync(rootFile(...p), 'utf8');

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function waitReady(r) {
  let ok = 0;
  for (let i = 0; i < 60; i++) {
    const probe = r.psql(r.adminUser, 'select 1;', ['-At']);
    ok = probe.status === 0 ? ok + 1 : 0;
    if (ok >= 3) return true;
    await sleep(2000);
  }
  return false;
}

function rowCounts(r) {
  const res = r.query(`
    select table_name,
           (xpath('/row/c/text()', query_to_xml(
              format('select count(*) as c from public.%I', table_name), false, true, '')))[1]::text::bigint as n
    from information_schema.tables
    where table_schema = 'public' and table_type = 'BASE TABLE'
    order by table_name;`);
  if (res.status !== 0) return null;
  const rows = parseCsv(res.stdout).slice(1);
  return Object.fromEntries(rows.map(([t, n]) => [t, Number(n)]));
}

function gateChild(script, planFile, approved) {
  const env = { ...process.env };
  delete env.KFBM_ROLLOUT_APPROVED;
  // the approval value exists only in the environment of this child process
  if (approved) env.KFBM_ROLLOUT_APPROVED = 'true';
  const r = spawnSync(
    process.execPath,
    [rootFile('scripts/db', script), '--plan', planFile],
    {
      cwd: REPO,
      env,
      encoding: 'utf8',
    }
  );
  return { status: r.status ?? 1, stderr: r.stderr ?? '' };
}

export async function rehearse(opts, log = console.log) {
  const steps = [];
  const step = (name, ok, detail = '', ms = null) => {
    steps.push({ name, ok, detail, ms });
    log(
      `${ok ? 'OK    ' : 'FEHLER'} ${name}${ms === null ? '' : ` (${(ms / 1000).toFixed(1)} s)`}${detail ? `: ${detail}` : ''}`
    );
    return ok;
  };
  const timed = fn => {
    const t = Date.now();
    const value = fn();
    return [value, Date.now() - t];
  };

  const names = readdirSync(rootFile('supabase/migrations'));
  const legacy = readLegacyEntries(readSql('supabase/legacy-migrations.txt'));
  const { baseline, gated, unexpected } = classifyMigrations(names, legacy);
  const started = Date.now();
  const adminUser = /supabase\/postgres/.test(opts.image)
    ? 'supabase_admin'
    : 'postgres';
  const r = new Rehearsal(containerName(), adminUser);
  const work = mkdtempSync(join(tmpdir(), 'wmc-rehearsal-'));
  // Runs only while the script is idle (a synchronous docker call cannot be
  // interrupted), a hard abort leaves the labelled container behind
  const onSignal = () => {
    if (!opts.keep) r.remove();
    rmSync(work, { recursive: true, force: true });
    process.exit(130);
  };
  process.once('SIGINT', onSignal);
  process.once('SIGTERM', onSignal);

  const result = {
    steps,
    migrations: [],
    checks: [],
    counts: null,
    totalMs: 0,
    image: opts.image,
  };
  try {
    await (async () => {
      if (
        !step(
          'preflight: no unexpected migration file',
          unexpected.length === 0,
          unexpected.map(m => m.file).join(', ')
        )
      ) {
        return;
      }
      if (!step('preflight: docker reachable', dockerAvailable())) return;
      if (!imagePresent(opts.image)) {
        if (!opts.pull) {
          step(
            'preflight: image present locally',
            false,
            `${opts.image} is missing, pull it first or pass --pull`
          );
          return;
        }
        const pulled = docker(['pull', opts.image]);
        if (
          !step(
            'preflight: image pulled',
            pulled.status === 0,
            firstError(pulled.stderr)
          )
        )
          return;
      }

      // 1. container
      const password = randomBytes(18).toString('hex');
      const [start, startMs] = timed(() =>
        docker(
          [
            'run',
            '-d',
            '--name',
            r.name,
            '--label',
            'wmc-rehearsal=1',
            '--network',
            'none',
            '-e',
            'POSTGRES_PASSWORD',
            opts.image,
          ],
          { env: { ...dockerBaseEnv(), POSTGRES_PASSWORD: password } }
        )
      );
      if (
        !step(
          'container started',
          start.status === 0,
          start.status === 0 ? r.name : firstError(start.stderr),
          startMs
        )
      )
        return;
      const waitStart = Date.now();
      const ready = await waitReady(r);
      if (!step('database ready', ready, '', Date.now() - waitStart)) return;

      // 2. prep and starting schema
      const prep = r.psql(
        r.adminUser,
        readSql('scripts/db/rehearsal/00-prep.sql'),
        ['-v', 'ON_ERROR_STOP=1']
      );
      if (
        !step(
          'prep (roles, auth and storage stubs, vector, ledger table)',
          prep.status === 0,
          firstError(prep.stderr)
        )
      )
        return;

      if (opts.structure) {
        const [load, ms] = timed(() =>
          r.tolerant(readFileSync(opts.structure, 'utf8'))
        );
        step(
          'starting schema from the structure file',
          true,
          `${countErrors(load.stderr)} tolerated error(s)`,
          ms
        );
      } else {
        const dir = rootFile('src/db/migrations/drizzle');
        const files = historyFiles(readdirSync(dir));
        let errors = 0;
        const [, ms] = timed(() => {
          for (const f of files)
            errors += countErrors(
              r.tolerant(readFileSync(join(dir, f), 'utf8')).stderr
            );
        });
        step(
          'starting schema from the repository history',
          true,
          `${files.length} file(s), ${errors} tolerated error(s)`,
          ms
        );
        result.historyErrors = errors;
        const gaps = r.psql(
          'postgres',
          readSql('scripts/db/rehearsal/05-baseline-gaps.sql'),
          ['-v', 'ON_ERROR_STOP=1', '-1']
        );
        if (
          !step(
            'known gaps of the history closed (05-baseline-gaps.sql)',
            gaps.status === 0,
            firstError(gaps.stderr)
          )
        )
          return;
      }

      // 3. manual baseline
      for (const m of baseline) {
        if (opts.structure && m.version.length === 12) {
          // the structure dump already contains the effect of the legacy file
          r.psql(
            'postgres',
            `insert into supabase_migrations.schema_migrations (version, name) values ('${m.version}', '${m.file.slice(m.version.length + 1, -4)}') on conflict do nothing;`
          );
          continue;
        }
        const [res, ms] = timed(() =>
          r.file(readSql('supabase/migrations', m.file))
        );
        if (
          !step(
            `baseline ${m.file}`,
            res.status === 0,
            firstError(res.stderr),
            ms
          )
        )
          return;
        ledger(r, m);
      }

      // 4. sample rows
      if (opts.seed) {
        const seed = r.psql(
          'postgres',
          readSql('scripts/db/rehearsal/10-seed.sql'),
          ['-v', 'ON_ERROR_STOP=1', '-1']
        );
        step(
          'invented sample rows',
          seed.status === 0,
          firstError(seed.stderr)
        );
      }
      const before = rowCounts(r);

      // 5. V checks
      const checks = splitChecks(
        readSql('docs/kfbm-production-rollout-checks.sql')
      );
      runChecks(
        r,
        checks.filter(c => c.kind === 'V'),
        result,
        step
      );
      if (opts.baselineOnly) return;

      // 6. gate
      const gatedNames = gated.map(m => m.file);
      const plan = join(work, 'plan.txt');
      writeFileSync(plan, planText(gatedNames));
      step(
        'rollout gate closed stops the plan',
        (() => {
          // exit 1 AND the message of the gate, a crash alone does not count
          const closed = gateChild('rollout-gate.mjs', plan, false);
          return (
            closed.status === 1 && /rollout is not approved/.test(closed.stderr)
          );
        })()
      );
      step(
        'rollout gate approved lets the plan pass',
        gateChild('rollout-gate.mjs', plan, true).status === 0
      );
      step(
        'baseline guard finds no baseline file in the plan',
        gateChild('baseline-guard.mjs', plan, false).status === 0
      );

      // 7. gated migrations
      let allApplied = true;
      for (const m of gated) {
        const sql = readSql('supabase/migrations', m.file);
        if (m.version === BACKFILL_VERSION) {
          const held = r.file(sql);
          const holds =
            held.status !== 0 &&
            /Gate closed: the app release/.test(held.stderr);
          step(
            `${m.file} holds while the approval token is missing`,
            holds,
            holds ? '' : 'the gate did not hold'
          );
          result.migrations.push({ file: m.file, held: holds });
          r.psql('postgres', `${APPROVAL_COMMENT};`, ['-v', 'ON_ERROR_STOP=1']);
        }
        const [res, ms] = timed(() => r.file(sql));
        const ok = res.status === 0;
        step(`apply ${m.file}`, ok, firstError(res.stderr), ms);
        result.migrations.push({ file: m.file, ok, ms });
        if (!ok) {
          allApplied = false;
          break;
        }
        ledger(r, m);
      }
      if (!allApplied) return;

      // 8. N checks and counts
      runChecks(
        r,
        checks.filter(c => c.kind === 'N'),
        result,
        step
      );
      const after = rowCounts(r);
      if (before && after) {
        const { lost, changed } = compareCounts(before, after);
        result.counts = { tables: Object.keys(before).length, lost, changed };
        step(
          'row counts of the existing tables: none lost',
          lost.length === 0,
          lost.join('; ')
        );
        log(
          `       changed by the series: ${changed.length ? changed.join('; ') : 'none'}`
        );
      } else {
        step('row counts of the existing tables', false, 'could not be read');
      }
      if (opts.seed) {
        const evidence = r.query(EVIDENCE_SQL);
        const row = evidence.status === 0 ? parseCsv(evidence.stdout)[1] : null;
        const problem = row
          ? evidenceProblem(row.map(Number))
          : firstError(evidence.stderr);
        step(
          'data steps worked on the sample rows',
          !problem,
          problem ||
            `super admins ${row[0]}, enrollments ${row[1]}, copied learning fields ${row[2]}`
        );
      }
    })();
  } finally {
    if (opts.keep)
      log(`container kept: ${r.name} (remove with: docker rm -f -v ${r.name})`);
    else {
      r.remove();
      const gone = docker(['ps', '-a', '-q', '--filter', `name=^${r.name}$`]);
      step('container removed', gone.stdout.trim() === '');
    }
    rmSync(work, { recursive: true, force: true });
    process.off('SIGINT', onSignal);
    process.off('SIGTERM', onSignal);
  }
  return finish();

  function finish() {
    result.totalMs = Date.now() - started;
    result.ok = steps.every(s => s.ok);
    log(
      `${result.ok ? 'OK' : 'FEHLER'} overall: ${steps.filter(s => s.ok).length}/${steps.length} step(s) ok, ${(result.totalMs / 1000).toFixed(1)} s`
    );
    return result;
  }
}

function ledger(r, m) {
  const name = m.file.slice(m.version.length + 1, -4);
  const res = r.psql(
    'postgres',
    `insert into supabase_migrations.schema_migrations (version, name) values ('${m.version}', '${name}') on conflict do nothing;`,
    ['-v', 'ON_ERROR_STOP=1']
  );
  // a missing ledger row would make N01 meaningless, so stop (the container is
  // removed by the caller's finally block)
  if (res.status !== 0) throw new Error('ledger row could not be written');
}

function runChecks(r, checks, result, step) {
  for (const c of checks) {
    const res = r.psql('postgres', c.sql, ['-v', 'ON_ERROR_STOP=1', '--csv']);
    if (res.status !== 0) {
      result.checks.push({
        id: c.id,
        ok: false,
        detail: firstError(res.stderr),
      });
      step(`check ${c.id}`, false, firstError(res.stderr));
      continue;
    }
    const rows = parseCsv(res.stdout);
    const expect = EXPECTATIONS[c.id];
    const problem = expect ? expect(rows) : null;
    result.checks.push({
      id: c.id,
      ok: !problem,
      rows: Math.max(rows.length - 1, 0),
      expected: Boolean(expect),
      detail: problem ?? '',
    });
    step(
      `check ${c.id}`,
      !problem,
      problem ??
        `${Math.max(rows.length - 1, 0)} row(s)${expect ? ', expectation met' : ', informational'}`
    );
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `Local rehearsal of the KfBM rollout migrations on a throwaway Postgres container.
Default prints the plan. --run starts the rehearsal (needs Docker, image present locally).
Options: --image <name>  --structure <file>  --no-seed  --keep  --json <file>  --pull
See the header of this file and docs/kfbm-rollout-probelauf.md.`;

async function main() {
  let opts;
  try {
    opts = parseArgs(process.argv.slice(2));
  } catch (err) {
    console.error(err.message);
    process.exit(2);
  }
  if (opts.help) {
    console.log(HELP);
    return;
  }
  const names = readdirSync(rootFile('supabase/migrations'));
  const legacy = readLegacyEntries(readSql('supabase/legacy-migrations.txt'));
  const { baseline, gated } = classifyMigrations(names, legacy);
  if (!opts.run) {
    const history = historyFiles(
      readdirSync(rootFile('src/db/migrations/drizzle'))
    ).length;
    console.log(
      describePlan(opts, {
        history,
        baseline: baseline.length,
        gated: gated.length,
      })
    );
    return;
  }
  if (opts.structure && !existsSync(opts.structure)) {
    console.error('The structure file does not exist.');
    process.exit(2);
  }
  const result = await rehearse(opts);
  if (opts.json) writeFileSync(opts.json, JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch(() => {
    // a fixed message only: an error text could carry a path or a value
    console.error('The rehearsal stopped unexpectedly.');
    process.exit(2);
  });
}
