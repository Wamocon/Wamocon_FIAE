// Tests for scripts/db/rollout-gate.mjs and its place in the release workflow.
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  GATED_FROM,
  gatedInPlan,
  rolloutGate,
} from '../../../scripts/db/rollout-gate.mjs';

const plan = files =>
  `Would push these migrations:\n${files.map(f => ` • ${f}`).join('\n')}\n\nFinished supabase db push.`;

const HARDENING = [
  '20261023100000_security_lock_unused_tables.sql',
  '20261023200000_security_profiles_column_privileges.sql',
  '20261023300100_security_profiles_protect_columns_v2.sql',
];
const CATALOG = [
  '20261024000100_training_catalog_curriculum.sql',
  '20261024001500_user_role_super_admin_value.sql',
  '20261025000000_super_admin_backfill.sql',
  '20261025000100_security_revoke_public_create.sql',
];

test('the gate starts at the first migration of the KfBM rebuild', () => {
  assert.equal(GATED_FROM, '20261024000100');
});

test('hardening files before the rebuild are not gated', () => {
  assert.deepEqual(gatedInPlan(plan(HARDENING)), []);
  assert.deepEqual(rolloutGate(plan(HARDENING), undefined), {
    ok: true,
    blocked: [],
  });
});

test('an up to date plan and an empty plan are not gated', () => {
  assert.equal(
    rolloutGate('Remote database is up to date.', undefined).ok,
    true
  );
  assert.equal(rolloutGate('', undefined).ok, true);
});

test('every file of the rebuild and every newer one is gated', () => {
  const later = '20261101000000_some_later_change.sql';
  assert.deepEqual(gatedInPlan(plan([...HARDENING, ...CATALOG, later])), [
    ...CATALOG,
    later,
  ]);
  // the first file itself is gated, the one before it is not
  assert.deepEqual(gatedInPlan(plan(['20261024000099_x.sql'])), []);
  assert.deepEqual(gatedInPlan(plan(['20261024000100_x.sql'])), [
    '20261024000100_x.sql',
  ]);
});

test('the model gap files of the KfBM content import are gated, production is not migrated', () => {
  const gaps = [
    '20261028000100_course_training_component_link.sql',
    '20261028000200_quiz_code_and_link_catalog_check.sql',
    '20261028000300_use_case_letter_unique_option_order.sql',
  ];
  assert.deepEqual(gatedInPlan(plan([...HARDENING, ...gaps])), gaps);
  assert.equal(rolloutGate(plan(gaps), undefined).ok, false);
  assert.equal(rolloutGate(plan(gaps), 'false').ok, false);
  assert.equal(rolloutGate(plan(gaps), 'true').ok, true);
});

test('a plan with the rebuild is blocked unless the value is exactly true', () => {
  const text = plan([...HARDENING, ...CATALOG]);
  for (const value of [
    undefined,
    '',
    'false',
    'TRUE',
    'True',
    'yes',
    '1',
    ' true',
  ]) {
    const result = rolloutGate(text, value);
    assert.equal(result.ok, false, `value ${JSON.stringify(value)}`);
    assert.deepEqual(result.blocked, CATALOG);
  }
  assert.equal(rolloutGate(text, 'true').ok, true);
});

test('a file name is counted once even if the plan names it twice', () => {
  const text = `${plan(CATALOG)}\n${plan(CATALOG)}`;
  assert.deepEqual(gatedInPlan(text), CATALOG);
});

test('digits in front of a version do not form a gated version', () => {
  assert.deepEqual(gatedInPlan('x120261024000100_a.sql'), []);
});

test('the release workflow runs the gate after the dry run and before anything is applied', () => {
  const text = readFileSync('.github/workflows/release-production.yml', 'utf8')
    .split('\n')
    .filter(line => !/^\s*#/.test(line))
    .join('\n');
  const dry = text.indexOf('name: Dry run');
  const gate = text.indexOf('scripts/db/rollout-gate.mjs --plan dry-run.txt');
  const apply = text.indexOf('name: Apply migrations to public');
  assert.ok(
    dry > 0 && gate > dry && apply > gate,
    'order dry run, gate, apply'
  );
  // the approval comes from the repository variable, never from the workflow itself
  assert.match(
    text,
    /KFBM_ROLLOUT_APPROVED: \$\{\{ vars\.KFBM_ROLLOUT_APPROVED \}\}/
  );
  assert.doesNotMatch(text, /KFBM_ROLLOUT_APPROVED: ['"]?true/);
});

test('only the release workflow migrates public, so this is the one place for the gate', () => {
  for (const file of ['deploy-production.yml', 'content-sync.yml']) {
    const text = readFileSync(`.github/workflows/${file}`, 'utf8');
    assert.doesNotMatch(text, /db push --linked(?! --dry-run)/, file);
  }
});
