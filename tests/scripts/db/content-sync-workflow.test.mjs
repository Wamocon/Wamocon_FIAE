// Tests for the manual workflow "Content Sync": the input `catalog` and the
// arguments it passes to scripts/db/content-sync.mjs. The shell of the step is
// run for real with a stand-in for `node` that only prints its arguments, so
// the test sees exactly what the workflow would start. The shell blocks are
// read as text, so these tests also run in the job that has no installed
// dependencies (db-checks). The YAML structure is checked with js-yaml where
// it is installed.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const FILE = '.github/workflows/content-sync.yml';
const text = readFileSync(FILE, 'utf8').replace(/\r\n/g, '\n');

const yaml = await import('js-yaml').then(
  m => m.default ?? m,
  () => null
);
const yamlTest = (name, fn) =>
  test(name, { skip: yaml ? false : 'js-yaml is not installed' }, fn);
const hasBash = spawnSync('bash', ['-c', 'true']).status === 0;
const bashTest = (name, fn) =>
  test(name, { skip: hasBash ? false : 'bash is not available' }, fn);

/** Every `run: |` block with the name of its step, dedented. */
function runBlocks() {
  const lines = text.split('\n');
  const blocks = [];
  let name = '';
  for (let i = 0; i < lines.length; i++) {
    const named = /^\s*- name: (.+)$/.exec(lines[i]);
    if (named) name = named[1].trim();
    const start = /^(\s*)run: \|\s*$/.exec(lines[i]);
    if (!start) continue;
    const indent = start[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const line = lines[j];
      if (line.trim() !== '' && line.search(/\S/) <= indent) break;
      body.push(line.slice(indent + 2));
    }
    blocks.push({ name, script: body.join('\n').trimEnd() + '\n' });
  }
  return blocks;
}
const scriptOf = name => runBlocks().find(b => b.name === name).script;

/** Runs the shell of the step "Content sync" and returns the arguments of node. */
function run(env) {
  const script = scriptOf('Content sync');
  const stub = 'node() { for a in "$@"; do printf "ARG:%s\\n" "$a"; done; }';
  const result = spawnSync('bash', ['-e', '-c', `${stub}\n${script}`], {
    encoding: 'utf8',
    env: {
      PATH: process.env.PATH,
      APPLY: 'false',
      DIRECTION: 'preview-to-production',
      UPDATE_MODE: 'never',
      CATALOG: '',
      ...env,
    },
  });
  const args = result.stdout
    .split('\n')
    .filter(line => line.startsWith('ARG:'))
    .map(line => line.slice(4));
  return {
    args,
    status: result.status,
    stderr: result.stderr,
    stdout: result.stdout,
  };
}

yamlTest(
  'the workflow is valid YAML and the input catalog is optional text, empty by default',
  () => {
    const w = yaml.load(text);
    const input = w.on.workflow_dispatch.inputs.catalog;
    assert.equal(input.type, 'string');
    assert.equal(input.required, false);
    assert.equal(input.default, '');
    assert.match(input.description, /catalog/i);
    // the three older inputs are unchanged
    assert.equal(w.on.workflow_dispatch.inputs.apply.default, false);
    assert.equal(
      w.on.workflow_dispatch.inputs.direction.default,
      'preview-to-production'
    );
    assert.equal(w.on.workflow_dispatch.inputs.update_mode.default, 'never');
    assert.equal(w.jobs.sync.env.CATALOG, '${{ inputs.catalog }}');
  }
);

test('the catalog reaches the step through an environment variable, never through the script text', () => {
  assert.match(text, /^ {6}CATALOG: \$\{\{ inputs\.catalog \}\}$/m);
  const blocks = runBlocks();
  assert.ok(blocks.length >= 2);
  for (const block of blocks) {
    assert.ok(
      !/\$\{\{\s*inputs\./.test(block.script),
      `step ${block.name} puts an input into the script text`
    );
  }
});

bashTest('the shell of every step of the workflow parses', () => {
  for (const block of runBlocks()) {
    const result = spawnSync('bash', ['-n', '-c', block.script], {
      encoding: 'utf8',
    });
    assert.equal(result.status, 0, `${block.name}: ${result.stderr}`);
  }
});

bashTest(
  'without a catalog the arguments are those of before (dry run)',
  () => {
    const r = run({});
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.args, [
      'scripts/db/content-sync.mjs',
      '--linked',
      '--direction',
      'preview-to-production',
      '--update',
      'never',
    ]);
  }
);

bashTest(
  'without a catalog the arguments are those of before (apply, newer)',
  () => {
    const r = run({
      APPLY: 'true',
      DIRECTION: 'production-to-preview',
      UPDATE_MODE: 'newer',
    });
    assert.equal(r.status, 0, r.stderr);
    assert.deepEqual(r.args, [
      'scripts/db/content-sync.mjs',
      '--linked',
      '--direction',
      'production-to-preview',
      '--update',
      'configured',
      '--apply',
    ]);
  }
);

bashTest('a catalog code is passed as --catalog, dry run and apply', () => {
  const dry = run({ CATALOG: 'KFBM' });
  assert.equal(dry.status, 0, dry.stderr);
  assert.deepEqual(dry.args, [
    'scripts/db/content-sync.mjs',
    '--linked',
    '--direction',
    'preview-to-production',
    '--update',
    'never',
    '--catalog',
    'KFBM',
  ]);
  const apply = run({ CATALOG: 'KFBM', APPLY: 'true' });
  assert.equal(apply.status, 0, apply.stderr);
  assert.deepEqual(apply.args.slice(-3), ['--catalog', 'KFBM', '--apply']);
  assert.ok(
    run({ CATALOG: 'A.b_c-1' }).args.includes('A.b_c-1'),
    'letters, digits, dot, underscore and hyphen'
  );
});

bashTest('an invalid catalog code stops the step before node starts', () => {
  for (const bad of [
    'KFBM; echo hacked',
    "KF'BM",
    'KF BM',
    '$(id)',
    '`id`',
    '-KFBM',
    '.KFBM',
    'K'.repeat(65),
    'KFBM\nFIAE',
  ]) {
    const r = run({ CATALOG: bad });
    assert.notEqual(r.status, 0, JSON.stringify(bad));
    assert.match(
      r.stdout,
      /::error::Invalid catalog code/,
      JSON.stringify(bad)
    );
    assert.deepEqual(r.args, [], JSON.stringify(bad));
  }
});

test('the release workflow limits the content sync to the occupation KFBM (decision D18)', () => {
  const release = readFileSync(
    '.github/workflows/release-production.yml',
    'utf8'
  )
    .replace(/\r\n/g, '\n')
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n');
  // exactly one call of the sync, and it carries --catalog KFBM as a fixed value
  assert.equal(release.match(/content-sync\.mjs/g).length, 1);
  assert.equal(release.match(/--catalog/g).length, 1);
  assert.match(
    release,
    /content-sync\.mjs --linked --apply --direction preview-to-production --update never --catalog KFBM$/m
  );
  // the code is fixed in the file, never taken from an input or a variable
  assert.doesNotMatch(release, /--catalog\s+["']?\$/);
  // the release is started by a release event, so it has no input at all
  assert.doesNotMatch(release, /inputs\./);
});
