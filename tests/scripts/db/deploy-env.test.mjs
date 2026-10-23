// Tests for scripts/db/deploy-env.mjs (pure logic).
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  SCHEMA_BY_TARGET,
  SENSITIVE_PLACEHOLDER,
  isPreviewRole,
  maskLines,
  checkDeployEnv,
  connectionUser,
  parseEnv,
  pinSchema,
} from '../../../scripts/db/deploy-env.mjs';

const PREVIEW_URL =
  'postgresql://app_preview.abcdefgh:PLACEHOLDER@aws-0-eu.pooler.supabase.com:5432/postgres';
const PROD_URL =
  'postgresql://postgres.abcdefgh:PLACEHOLDER@aws-0-eu.pooler.supabase.com:5432/postgres';

test('schema is derived from the target only', () => {
  assert.equal(SCHEMA_BY_TARGET.preview, 'public_preview');
  assert.equal(SCHEMA_BY_TARGET.production, 'public');
});

test('pinSchema replaces any existing value, also a wrong or empty one', () => {
  const text = [
    'DB_CONNECTION_STRING="x"',
    'NEXT_PUBLIC_DB_SCHEMA="public"',
    'export SUPABASE_DB_SCHEMA=public',
    'OTHER="1"',
  ].join('\n');
  const env = parseEnv(pinSchema(text, 'public_preview'));
  assert.equal(env.get('NEXT_PUBLIC_DB_SCHEMA'), 'public_preview');
  assert.equal(env.get('SUPABASE_DB_SCHEMA'), 'public_preview');
  assert.equal(env.get('OTHER'), '1');
  assert.equal(
    pinSchema(text, 'public_preview').match(/NEXT_PUBLIC_DB_SCHEMA/g).length,
    1
  );
});

test('pinSchema also works without any schema key', () => {
  const env = parseEnv(pinSchema('A="1"\n', 'public'));
  assert.equal(env.get('NEXT_PUBLIC_DB_SCHEMA'), 'public');
});

test('parseEnv ignores comments and reads quoted values', () => {
  const env = parseEnv('# A="1"\nB="two words"\nC=\'x\'\nD=plain\n');
  assert.equal(env.has('A'), false);
  assert.equal(env.get('B'), 'two words');
  assert.equal(env.get('C'), 'x');
  assert.equal(env.get('D'), 'plain');
});

test('connectionUser reads the user, null for garbage', () => {
  assert.equal(connectionUser(PREVIEW_URL), 'app_preview.abcdefgh');
  assert.equal(connectionUser('not a url'), null);
});

test('preview with the preview role and the pinned schema passes', () => {
  const env = parseEnv(
    pinSchema(`DB_CONNECTION_STRING="${PREVIEW_URL}"`, 'public_preview')
  );
  assert.deepEqual(checkDeployEnv({ target: 'preview', env }), []);
});

test('preview with the production role is refused', () => {
  const env = parseEnv(
    pinSchema(`DB_CONNECTION_STRING="${PROD_URL}"`, 'public_preview')
  );
  const errors = checkDeployEnv({ target: 'preview', env });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('app_preview'));
  assert.ok(!errors[0].includes('PLACEHOLDER'));
});

test('preview with a wrong schema value is refused', () => {
  const env = parseEnv(
    `DB_CONNECTION_STRING="${PREVIEW_URL}"\nNEXT_PUBLIC_DB_SCHEMA="public"\nSUPABASE_DB_SCHEMA="public_preview"\n`
  );
  assert.ok(checkDeployEnv({ target: 'preview', env }).length >= 1);
});

test('production with the preview role is refused, with the production role passes', () => {
  const bad = parseEnv(
    pinSchema(`DB_CONNECTION_STRING="${PREVIEW_URL}"`, 'public')
  );
  assert.equal(checkDeployEnv({ target: 'production', env: bad }).length, 1);
  const good = parseEnv(
    pinSchema(`DB_CONNECTION_STRING="${PROD_URL}"`, 'public')
  );
  assert.deepEqual(checkDeployEnv({ target: 'production', env: good }), []);
});

test('preview accepts the Vercel placeholder of a Sensitive variable, the role is left to the application', () => {
  assert.equal(SENSITIVE_PLACEHOLDER, '[SENSITIVE]');
  const env = parseEnv(
    pinSchema(
      `DB_CONNECTION_STRING="${SENSITIVE_PLACEHOLDER}"`,
      'public_preview'
    )
  );
  assert.deepEqual(checkDeployEnv({ target: 'preview', env }), []);
});

test('production never accepts the placeholder: its connection must be readable', () => {
  const env = parseEnv(
    pinSchema(`DB_CONNECTION_STRING="${SENSITIVE_PLACEHOLDER}"`, 'public')
  );
  const errors = checkDeployEnv({ target: 'production', env });
  assert.equal(errors.length, 1);
  assert.ok(errors[0].includes('cannot be parsed'));
});

test('the placeholder lets nothing else through: a readable wrong role and a wrong schema are still refused', () => {
  const wrongRole = parseEnv(
    pinSchema(`DB_CONNECTION_STRING="${PROD_URL}"`, 'public_preview')
  );
  assert.equal(checkDeployEnv({ target: 'preview', env: wrongRole }).length, 1);
  const wrongSchema = parseEnv(
    `DB_CONNECTION_STRING="${SENSITIVE_PLACEHOLDER}"\nNEXT_PUBLIC_DB_SCHEMA="public"\nSUPABASE_DB_SCHEMA="public"\n`
  );
  assert.ok(
    checkDeployEnv({ target: 'preview', env: wrongSchema }).length >= 1
  );
});

test('a missing connection string and an unknown target are errors', () => {
  const env = parseEnv(pinSchema('', 'public'));
  assert.equal(checkDeployEnv({ target: 'production', env }).length, 1);
  assert.equal(checkDeployEnv({ target: 'staging', env }).length, 1);
});

test('the Preview role is checked exactly', () => {
  assert.ok(isPreviewRole('app_preview'));
  assert.ok(isPreviewRole('app_preview.abcdefgh'));
  for (const user of [
    'app_preview_migrator',
    'app_preview_migrator.abcdefgh',
    'app_previewx',
    'app_preview.',
    'postgres.abcdefgh',
  ]) {
    assert.equal(isPreviewRole(user), false, user);
  }
});

test('Preview refuses the migration role as the app role, Production refuses both', () => {
  const migrator =
    'postgresql://app_preview_migrator.abcdefgh:PLACEHOLDER@h:5432/postgres';
  const envPreview = parseEnv(
    pinSchema(`DB_CONNECTION_STRING="${migrator}"`, 'public_preview')
  );
  assert.equal(
    checkDeployEnv({ target: 'preview', env: envPreview }).length,
    1
  );
  const envProd = parseEnv(
    pinSchema(`DB_CONNECTION_STRING="${migrator}"`, 'public')
  );
  assert.equal(
    checkDeployEnv({ target: 'production', env: envProd }).length,
    1
  );
});

test('maskLines masks secrets and the password of a URL, not public values or the schema pin', () => {
  const env = parseEnv(
    [
      'DB_CONNECTION_STRING="postgresql://app_preview.abcdefgh:Pw%2Fsecret99@h:5432/postgres"',
      'SUPABASE_SECRET_KEY="sb_secret_abcdefghijkl"',
      'NEXT_PUBLIC_SUPABASE_URL="https://abcdefgh.supabase.co"',
      'NEXT_PUBLIC_DB_SCHEMA="public_preview"',
      'SUPABASE_DB_SCHEMA="public_preview"',
      'VERCEL_ENV="preview"',
      'SHORT="abc"',
      'NODE_ENV="production"',
    ].join('\n')
  );
  const lines = maskLines(env);
  assert.ok(lines.every(l => l.startsWith('::add-mask::')));
  const values = lines.map(l => l.slice('::add-mask::'.length));
  assert.ok(values.includes('sb_secret_abcdefghijkl'));
  assert.ok(
    values.includes(
      'postgresql://app_preview.abcdefgh:Pw%2Fsecret99@h:5432/postgres'
    )
  );
  assert.ok(values.includes('Pw%2Fsecret99') || values.includes('Pw/secret99'));
  assert.ok(!values.some(v => v.includes('supabase.co')));
  assert.ok(!values.includes('public_preview'));
  assert.ok(!values.includes('abc'));
  assert.ok(!values.includes('preview'));
  // no key name next to a value
  assert.ok(
    !lines.some(l => /SUPABASE_SECRET_KEY|DB_CONNECTION_STRING/.test(l))
  );
});

test('the deploy action masks first and never prints the full Vercel log', () => {
  const action = readFileSync(
    '.github/actions/vercel-deploy/action.yml',
    'utf8'
  )
    .split('\n')
    .filter(l => !/^\s*#/.test(l))
    .join('\n');
  const mask = action.indexOf('--mask-only');
  const pin = action.indexOf('--github-env');
  const build = action.indexOf('vercel build');
  assert.ok(mask > 0 && mask < pin && pin < build);
  assert.ok(!/cat vercel-deploy\.log/.test(action));
  assert.ok(!/FULL VERCEL DEPLOY LOG/.test(action));
  assert.ok(/tail -n \d+ vercel-deploy\.log/.test(action));
});
