// Security review follow-up: Preview jobs never see a Production token, the
// connection string never reaches a log. Static checks of the workflows and
// actions (text based, no YAML library needed) plus the pure helpers.
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import { driftFindings } from '../../../scripts/db/drift-check.mjs';
import {
  mask,
  remember,
  targetFrom,
} from '../../../scripts/db/preview-cli.mjs';

const read = path => readFileSync(path, 'utf8');
/** Text without comment lines (comments may mention the token on purpose). */
const code = text =>
  text
    .split('\n')
    .filter(l => !/^\s*#/.test(l))
    .join('\n');
/** The text of one job of a workflow file. */
function job(path, name) {
  const text = code(read(path));
  const start = text.search(new RegExp(`^  ${name}:\\s*$`, 'm'));
  assert.ok(start >= 0, `${path}: job ${name}`);
  const rest = text.slice(start + 1);
  const next = rest.search(/^\s{2}[a-z][\w-]*:\s*$/m);
  return next < 0 ? rest : rest.slice(0, next + 1);
}

const PREVIEW_ONLY = [
  ['.github/workflows/preview-migration.yml', 'migrate'],
  ['.github/workflows/deploy-preview.yml', 'migrate'],
  ['.github/workflows/deploy-preview.yml', 'deploy'],
  ['.github/workflows/preview-reset.yml', 'rebuild'],
  ['.github/workflows/db-drift.yml', 'preview-drift'],
];

test('Preview jobs run in the environment Preview and never see the Production token', () => {
  for (const [path, name] of PREVIEW_ONLY) {
    const block = job(path, name);
    assert.ok(
      /environment:\s*Preview\b/.test(block),
      `${path} ${name}: environment`
    );
    assert.ok(
      !block.includes('SUPABASE_ACCESS_TOKEN'),
      `${path} ${name}: token`
    );
    assert.ok(
      !block.includes('./.github/actions/db-setup'),
      `${path} ${name}: db-setup links with the token`
    );
    assert.ok(
      !/--linked/.test(block),
      `${path} ${name}: --linked needs the token`
    );
    assert.ok(
      !/SUPABASE_PROJECT_REF_PROD/.test(block),
      `${path} ${name}: project ref`
    );
  }
});

test('the actions used by Preview jobs need no token and no link', () => {
  for (const path of [
    '.github/actions/preview-migrate/action.yml',
    '.github/actions/cli-setup/action.yml',
  ]) {
    const text = code(read(path));
    assert.ok(!text.includes('SUPABASE_ACCESS_TOKEN'), path);
    assert.ok(!text.includes('db-setup'), path);
    assert.ok(!/--linked|supabase.*link/.test(text), path);
  }
  const migrate = code(read('.github/actions/preview-migrate/action.yml'));
  assert.ok(migrate.includes('--db-url-env PREVIEW_DB_URL'));
});

test('Preview jobs use the connection string of the migration role', () => {
  for (const [path, name] of [
    ['.github/workflows/preview-migration.yml', 'migrate'],
    ['.github/workflows/deploy-preview.yml', 'migrate'],
    ['.github/workflows/preview-reset.yml', 'rebuild'],
    ['.github/workflows/db-drift.yml', 'preview-drift'],
  ]) {
    assert.ok(
      job(path, name).includes('PREVIEW_DB_URL: ${{ secrets.PREVIEW_DB_URL }}'),
      `${path} ${name}`
    );
  }
});

test('only Production jobs use the token and the environment Production', () => {
  for (const [path, name] of [
    ['.github/workflows/preview-reset.yml', 'snapshot'],
    ['.github/workflows/db-drift.yml', 'production-drift'],
    ['.github/workflows/release-production.yml', 'migrate'],
    ['.github/workflows/release-production.yml', 'content-sync'],
    ['.github/workflows/content-sync.yml', 'sync'],
    ['.github/workflows/deploy-production.yml', 'deploy'],
  ]) {
    const block = job(path, name);
    assert.ok(/environment:\s*Production\b/.test(block), `${path} ${name}`);
    assert.ok(block.includes('SUPABASE_ACCESS_TOKEN'), `${path} ${name}`);
  }
});

test('a push or pull request never reaches Production: workflows with Production access start only by hand, by release or by schedule', () => {
  // The rule of the owner: merging into master must never migrate or deploy Production.
  const dir = '.github/workflows';
  const withProduction = [];
  for (const file of readdirSync(dir).filter(f => f.endsWith('.yml'))) {
    const text = code(read(`${dir}/${file}`));
    if (!/SUPABASE_ACCESS_TOKEN|environment:\s*Production/.test(text)) continue;
    withProduction.push(file);
    const start = text.search(/^on:/m);
    assert.ok(start >= 0, `${file}: no trigger block`);
    const triggers = text
      .slice(start)
      .split(/^(?:jobs|concurrency|permissions|env):/m)[0];
    assert.ok(
      !/^\s{2}(push|pull_request|pull_request_target|workflow_run):/m.test(
        triggers
      ),
      `${file}: a push or pull request can start a workflow with Production access`
    );
  }
  // not vacuous: the release and the manual Production deploy are among them
  assert.ok(withProduction.includes('release-production.yml'));
  assert.ok(withProduction.includes('deploy-production.yml'));
});

test('the daily drift run is Preview only, the Production comparison is manual', () => {
  const text = code(read('.github/workflows/db-drift.yml'));
  const production = job('.github/workflows/db-drift.yml', 'production-drift');
  assert.ok(/github\.event_name == 'workflow_dispatch'/.test(production));
  assert.ok(/inputs\.compare_production == true/.test(production));
  assert.ok(text.includes('cron:'));
  assert.ok(
    job('.github/workflows/db-drift.yml', 'preview-drift').includes(
      '--preview-only'
    )
  );
});

test('the Preview reset hands the structure of public over as an artifact, read only', () => {
  const snapshot = job('.github/workflows/preview-reset.yml', 'snapshot');
  assert.ok(snapshot.includes('preview-migrate.mjs snapshot --linked'));
  assert.ok(snapshot.includes('upload-artifact'));
  assert.ok(!/\bexecute\b/.test(snapshot.replace(/environment/g, '')));
  const rebuild = job('.github/workflows/preview-reset.yml', 'rebuild');
  assert.ok(rebuild.includes('needs: snapshot'));
  assert.ok(rebuild.includes('download-artifact'));
  assert.ok(rebuild.includes('--snapshot preview-snapshot'));
});

test('workflows with pipes use bash with pipefail', () => {
  for (const path of [
    '.github/workflows/preview-reset.yml',
    '.github/workflows/db-drift.yml',
    '.github/actions/preview-migrate/action.yml',
  ]) {
    const text = code(read(path));
    const steps = text.split(/\n\s*- (?=name:|uses:)/);
    for (const step of steps) {
      if (!/\|\s*tee\b/.test(step)) continue;
      assert.ok(/shell:\s*bash/.test(step), `${path}: shell bash`);
      assert.ok(/set -o pipefail|PIPESTATUS/.test(step), `${path}: pipefail`);
    }
  }
});

test('--db-url-env reads the connection string from the environment', () => {
  process.env.TEST_DB_URL_FOR_TARGET =
    'postgresql://u.ref:ZZpasswordZZ@h:5432/db';
  assert.deepEqual(targetFrom(['--db-url-env', 'TEST_DB_URL_FOR_TARGET']), [
    '--db-url',
    'postgresql://u.ref:ZZpasswordZZ@h:5432/db',
  ]);
  delete process.env.TEST_DB_URL_FOR_TARGET;
  assert.throws(
    () => targetFrom(['--db-url-env', 'TEST_DB_URL_FOR_TARGET']),
    /not set/
  );
  assert.throws(() => targetFrom(['--db-url-env']), /not set/);
});

test('the connection string and its password are masked in every text', () => {
  remember('postgresql://user.ref:S3cretPw@host:5432/postgres');
  const text = mask(
    'failed: postgresql://user.ref:S3cretPw@host:5432/postgres, password S3cretPw'
  );
  assert.ok(!text.includes('S3cretPw'));
  assert.ok(text.includes('***'));
  assert.equal(mask('nothing to hide'), 'nothing to hide');
});

test('drift check without public (Preview only) reports file and checksum findings only', () => {
  const files = [{ version: '1', file: '1_a.sql', checksum: 'c' }];
  const r = driftFindings({
    files,
    public: null,
    preview: [{ version: '9', checksum: 'x' }],
  });
  // no "not applied in public" note, no "applied without file" error for public
  assert.ok(r.errors.some(e => e.includes('not applied in public_preview')));
  assert.ok(!r.notes.some(n => n.includes('not applied in public (')));
  assert.ok(!r.errors.some(e => e.includes('applied in public,')));
  const ok = driftFindings({
    files,
    public: null,
    preview: [{ version: '1', checksum: 'c' }],
  });
  assert.deepEqual(ok.errors, []);
});

test('every Production job checks that the commit is part of master', () => {
  for (const [path, name] of [
    ['.github/workflows/release-production.yml', 'migrate'],
    ['.github/workflows/release-production.yml', 'content-sync'],
    ['.github/workflows/release-production.yml', 'deploy'],
    ['.github/workflows/content-sync.yml', 'sync'],
    ['.github/workflows/deploy-production.yml', 'deploy'],
  ]) {
    const block = job(path, name);
    assert.ok(
      block.includes('./.github/actions/require-master'),
      `${path} ${name}`
    );
    assert.ok(/fetch-depth:\s*0/.test(block), `${path} ${name}: full history`);
  }
  const action = code(read('.github/actions/require-master/action.yml'));
  assert.ok(action.includes('git merge-base --is-ancestor'));
  assert.ok(action.includes('is-shallow-repository'));
});

test('manual Production workflows only start from the workflow file of master', () => {
  for (const [path, name] of [
    ['.github/workflows/content-sync.yml', 'sync'],
    ['.github/workflows/deploy-production.yml', 'deploy'],
    ['.github/workflows/preview-reset.yml', 'snapshot'],
    ['.github/workflows/db-drift.yml', 'production-drift'],
  ]) {
    assert.ok(
      job(path, name).includes("github.ref == 'refs/heads/master'"),
      `${path} ${name}`
    );
  }
});
