// Tests for scripts/db/rehearse-rollout-local.mjs. No Docker is needed here: the pure
// helpers, the plan output and the safety properties of the script text are checked.
// The rehearsal itself runs by hand (docs/kfbm-rollout-probelauf.md).
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { readLegacyEntries } from '../../../scripts/db/migration-check.mjs';
import { appliedLegacyInPlan } from '../../../scripts/db/baseline-guard.mjs';
import {
  GATED_FROM,
  gatedInPlan,
  rolloutGate,
} from '../../../scripts/db/rollout-gate.mjs';
import {
  DEFAULT_IMAGE,
  EXPECTATIONS,
  classifyMigrations,
  compareCounts,
  containerName,
  dockerBaseEnv,
  countErrors,
  evidenceProblem,
  firstError,
  historyFiles,
  isLocalDockerHost,
  parseArgs,
  parseCsv,
  planText,
  splitChecks,
} from '../../../scripts/db/rehearse-rollout-local.mjs';

const SCRIPT = 'scripts/db/rehearse-rollout-local.mjs';
const source = readFileSync(SCRIPT, 'utf8');
const migrationNames = readdirSync('supabase/migrations');
const legacy = readLegacyEntries(
  readFileSync('supabase/legacy-migrations.txt', 'utf8')
);

test('the default is the plan: nothing starts without --run', () => {
  assert.equal(parseArgs([]).run, false);
  const out = spawnSync(process.execPath, [SCRIPT], { encoding: 'utf8' });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /nothing is started without --run/);
  assert.match(out.stdout, /20261024000100/);
});

test('--help prints the usage and starts nothing', () => {
  const out = spawnSync(process.execPath, [SCRIPT, '--help'], {
    encoding: 'utf8',
  });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /--structure/);
});

test('parseArgs knows its options and rejects the rest', () => {
  const opts = parseArgs([
    '--run',
    '--no-seed',
    '--keep',
    '--pull',
    '--baseline-only',
    '--image',
    'x/y:1',
    '--structure',
    'a.sql',
    '--json',
    'o.json',
  ]);
  assert.deepEqual(opts, {
    run: true,
    help: false,
    image: 'x/y:1',
    structure: 'a.sql',
    seed: false,
    keep: true,
    json: 'o.json',
    pull: true,
    baselineOnly: true,
  });
  assert.equal(parseArgs([]).image, DEFAULT_IMAGE);
  assert.throws(() => parseArgs(['--db-url', 'x']), /Unknown argument/);
  assert.throws(() => parseArgs(['--image']), /needs a value/);
  assert.throws(() => parseArgs(['--image', '--run']), /needs a value/);
});

test('the container name is generated and carries the rehearsal prefix', () => {
  assert.match(containerName(), /^wmc-rehearsal-[0-9a-f]{8}$/);
  assert.notEqual(containerName(), containerName());
});

test('the repository migrations split into baseline and gated files', () => {
  const { baseline, gated, unexpected } = classifyMigrations(
    migrationNames,
    legacy
  );
  assert.deepEqual(unexpected, []);
  assert.ok(gated.length >= 28);
  assert.equal(gated[0].version, GATED_FROM);
  assert.ok(gated.every(m => m.version >= GATED_FROM));
  assert.ok(baseline.every(m => m.version.padEnd(14, '0') < GATED_FROM));
  assert.ok(baseline.some(m => m.file.startsWith('202606260001_')));
  assert.equal(baseline.length + gated.length, migrationNames.length);
  // sorted: the legacy 12 digit version comes first
  assert.equal(baseline[0].version, '202606260001');
});

test('a pending legacy file or a malformed name is reported, not applied', () => {
  const { unexpected } = classifyMigrations(
    ['202701010001_new_legacy.sql', '2026102400_bad.sql', 'readme.md'],
    []
  );
  assert.deepEqual(
    unexpected.map(m => m.file),
    ['202701010001_new_legacy.sql']
  );
});

test('the history replay uses the numbered sql files in name order', () => {
  const names = historyFiles([
    '0002_b.sql',
    'meta',
    '0001_pretty_skin.sql',
    '0001_add.sql',
    'arbeitszeugnis_schema.sql',
  ]);
  assert.deepEqual(names, [
    '0001_add.sql',
    '0001_pretty_skin.sql',
    '0002_b.sql',
  ]);
  const real = historyFiles(readdirSync('src/db/migrations/drizzle'));
  assert.ok(real.length > 50);
  assert.equal(real[0], '0000_keen_kinsey_walden.sql');
});

test('the plan text is accepted by the real gate and guard', () => {
  const { gated } = classifyMigrations(migrationNames, legacy);
  const text = planText(gated.map(m => m.file));
  assert.match(text, /^Would push these migrations:/);
  assert.ok(text.includes(gated[0].file));
  // every gated file is recognised by the gate, and the closed gate stops the plan
  assert.deepEqual(
    gatedInPlan(text),
    gated.map(m => m.file)
  );
  assert.equal(rolloutGate(text, undefined).ok, false);
  assert.equal(rolloutGate(text, 'true').ok, true);
  // a plan of gated files holds no baseline file
  assert.deepEqual(appliedLegacyInPlan(legacy, text), []);
  // the legacy file itself would be caught
  assert.deepEqual(
    appliedLegacyInPlan(
      legacy,
      planText(['202606260001_schema_only_ausbildung_duration.sql'])
    ),
    ['202606260001_schema_only_ausbildung_duration.sql']
  );
});

test('docker is used on this machine only', () => {
  assert.equal(isLocalDockerHost('npipe:////./pipe/docker_engine\n'), true);
  assert.equal(isLocalDockerHost('unix:///var/run/docker.sock'), true);
  assert.equal(isLocalDockerHost('tcp://10.0.0.5:2375'), false);
  assert.equal(isLocalDockerHost('ssh://user@host'), false);
  assert.equal(isLocalDockerHost(''), false);
  const env = dockerBaseEnv({
    DOCKER_HOST: 'tcp://x:1',
    DOCKER_CONTEXT: 'remote',
    PATH: 'p',
  });
  assert.deepEqual(env, { PATH: 'p' });
});

test('an image name that looks like an option is refused', () => {
  assert.throws(() => parseArgs(['--image', '-v/:/h']), /image name/);
});

test('the checks file splits into V01 to V14b and N01 to N12', () => {
  const checks = splitChecks(
    readFileSync('docs/kfbm-production-rollout-checks.sql', 'utf8')
  );
  const ids = checks.map(c => c.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(checks.filter(c => c.kind === 'V').length >= 14);
  assert.ok(checks.filter(c => c.kind === 'N').length >= 12);
  for (const id of ['V01', 'V03b', 'V11', 'V14b', 'N01', 'N02', 'N12']) {
    assert.ok(ids.includes(id), id);
  }
  for (const c of checks) assert.match(c.sql, /\bselect\b/i);
  // read-only: no write statement in any check
  for (const c of checks) {
    const code = c.sql
      .split('\n')
      .filter(l => !l.trim().startsWith('--'))
      .join('\n');
    assert.doesNotMatch(
      code,
      /^\s*(insert|update|delete|drop|alter|truncate|create|grant)\b/im,
      c.id
    );
  }
});

test('parseCsv handles quotes, commas and line breaks in fields', () => {
  assert.deepEqual(parseCsv('a,b\n1,"x, y"\n2,"say ""hi"""\n'), [
    ['a', 'b'],
    ['1', 'x, y'],
    ['2', 'say "hi"'],
  ]);
  assert.deepEqual(parseCsv('a\n"two\nlines"\n'), [['a'], ['two\nlines']]);
  assert.deepEqual(parseCsv(''), []);
});

test('expectations: N01 empty, N02 without a missing object, V03b false', () => {
  assert.equal(EXPECTATIONS.N01([['version']]), null);
  assert.match(EXPECTATIONS.N01([['version'], ['2026']]), /1 ledger row/);
  assert.equal(
    EXPECTATIONS.N02([
      ['object', 'present'],
      ['a', 't'],
      ['b', 't'],
    ]),
    null
  );
  assert.match(
    EXPECTATIONS.N02([
      ['object', 'present'],
      ['a', 'f'],
    ]),
    /1 object/
  );
  assert.match(EXPECTATIONS.N02([['x']]), /present/);
  assert.equal(EXPECTATIONS.V03b([['c'], ['f']]), null);
  assert.match(EXPECTATIONS.V03b([['c'], ['t']]), /can update/);
});

test('compareCounts: a lost row fails, a renamed legacy table and new rows pass', () => {
  const before = { a: 3, b: 2, lernfelder: 4, gone: 1, shrunk: 5 };
  const after = {
    a: 3,
    b: 7,
    lernfelder_legacy: 4,
    shrunk: 4,
    fresh: 1,
  };
  const { lost, changed } = compareCounts(before, after);
  assert.deepEqual(lost, ['gone (table gone)', 'shrunk (5 -> 4)']);
  assert.deepEqual(changed, [
    'b (2 -> 7)',
    'lernfelder (renamed to lernfelder_legacy, 4 rows kept)',
  ]);
  assert.deepEqual(compareCounts({ t: 2 }, { t: 2 }), {
    lost: [],
    changed: [],
  });
  // a legacy copy with fewer rows is a loss
  assert.deepEqual(compareCounts({ x: 3 }, { x_legacy: 2 }).lost, [
    'x (table gone)',
  ]);
});

test('evidence of the data steps', () => {
  assert.equal(evidenceProblem([1, 3, 2]), '');
  assert.match(evidenceProblem([0, 3, 2]), /Super admin/);
  assert.match(evidenceProblem([1, 2, 2]), /enrollments/);
  assert.match(evidenceProblem([1, 3, 0]), /learning fields/);
});

test('psql output helpers keep only the error line and count errors', () => {
  const err = 'psql:x:3: ERROR:  relation "t" does not exist\nLINE 1: select\n';
  assert.equal(firstError(err), 'ERROR:  relation "t" does not exist');
  assert.equal(firstError(''), '');
  assert.equal(countErrors(`${err}psql: ERROR:  again\n`), 2);
});

test('safety: no hosted access, no secrets read, the gate token only for the child', () => {
  // no single environment variable is read, the environment is only handed on
  const reads = [...source.matchAll(/process\.env\.([A-Za-z_]+)/g)].map(
    m => m[1]
  );
  assert.deepEqual(reads, []);
  // the gate token is the only variable the script sets, and it deletes any inherited one first
  assert.deepEqual(
    [
      ...new Set([...source.matchAll(/env\.([A-Z_]{4,})/g)].map(m => m[1])),
    ].sort(),
    ['KFBM_ROLLOUT_APPROVED', 'POSTGRES_PASSWORD']
      .filter(n => source.includes(`env.${n}`))
      .sort()
  );
  assert.match(source, /delete env\.KFBM_ROLLOUT_APPROVED/);
  assert.doesNotMatch(
    source,
    /DATABASE_URL|DB_CONNECTION_STRING|SUPABASE_|\.env\.local|\bfetch\(/
  );
  assert.doesNotMatch(source, /from 'node:(http|https|net|dns|tls)'/);
  // docker without a shell, no published port, a generated password that is never printed
  assert.doesNotMatch(source, /shell:\s*true/);
  assert.match(source, /import \{ spawnSync \} from 'node:child_process'/);
  assert.doesNotMatch(source, /'-p'|--publish/);
  // and the container has no network at all
  assert.match(source, /'--network',\s*'none'/);
  assert.doesNotMatch(source, /log\([^)]*password/i);
  // the container is always removed unless --keep
  assert.match(source, /r\.remove\(\)/);
  // the approval token is set on the child environment only
  assert.match(source, /if \(approved\) env\.KFBM_ROLLOUT_APPROVED = 'true'/);
});

test('the helper sql files exist and are limited to the throwaway container', () => {
  for (const f of ['00-prep.sql', '05-baseline-gaps.sql', '10-seed.sql']) {
    const text = readFileSync(`scripts/db/rehearsal/${f}`, 'utf8');
    assert.ok(text.length > 100, f);
    assert.doesNotMatch(text, /@(?!example\.invalid)[a-z0-9-]+\.[a-z]{2,}/i, f);
  }
});
