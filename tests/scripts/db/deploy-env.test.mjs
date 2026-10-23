// Tests for scripts/db/deploy-env.mjs (pure logic).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  SCHEMA_BY_TARGET,
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

test('a missing connection string and an unknown target are errors', () => {
  const env = parseEnv(pinSchema('', 'public'));
  assert.equal(checkDeployEnv({ target: 'production', env }).length, 1);
  assert.equal(checkDeployEnv({ target: 'staging', env }).length, 1);
});
