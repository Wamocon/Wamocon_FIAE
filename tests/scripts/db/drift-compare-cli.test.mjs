// Tests for scripts/db/drift-check.mjs, preview-compare.mjs and preview-cli.mjs
// (pure logic, no database, no CLI call).
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { driftFindings, readKnown } from '../../../scripts/db/drift-check.mjs';
import {
  decideComparison,
  differences,
  historyDifference,
  objects,
} from '../../../scripts/db/preview-compare.mjs';
import {
  LOGIN_REJECTED,
  readAnswer,
  targetFrom,
} from '../../../scripts/db/preview-cli.mjs';

const file = (version, checksum = 'c') => ({
  version,
  file: `${version}_x.sql`,
  checksum,
});

// ---- drift-check ------------------------------------------------------------

test('drift: everything in line gives no findings', () => {
  const r = driftFindings({
    files: [file('1')],
    public: ['1'],
    preview: [{ version: '1', checksum: 'c' }],
  });
  assert.deepEqual(r, { errors: [], notes: [] });
});

test('drift: applied without a file is an error, known versions are exempt', () => {
  const state = {
    files: [],
    public: ['20260626103015'],
    preview: [],
  };
  assert.equal(driftFindings(state).errors.length, 1);
  assert.equal(
    driftFindings({ ...state, known: ['20260626103015'] }).errors.length,
    0
  );
});

test('drift: file merged but not released is a note, strict makes it an error', () => {
  const state = {
    files: [file('1'), file('2')],
    public: ['1'],
    preview: [
      { version: '1', checksum: 'c' },
      { version: '2', checksum: 'c' },
    ],
  };
  const lenient = driftFindings(state);
  assert.equal(lenient.errors.length, 0);
  assert.equal(lenient.notes.length, 1);
  assert.equal(driftFindings({ ...state, strict: true }).errors.length, 1);
});

test('drift: file missing in public_preview and changed checksum are errors', () => {
  const missing = driftFindings({
    files: [file('1')],
    public: ['1'],
    preview: [],
  });
  assert.equal(missing.errors.length, 1);
  const changed = driftFindings({
    files: [file('1', 'new')],
    public: ['1'],
    preview: [{ version: '1', checksum: 'old' }],
  });
  assert.ok(changed.errors[0].includes('changed after'));
});

test('drift: baseline files are not expected in the public_preview ledger', () => {
  const state = { files: [file('1')], public: [], preview: [] };
  assert.equal(driftFindings({ ...state, public: null }).errors.length, 1);
  const r = driftFindings({ ...state, public: null, baseline: ['1'] });
  assert.deepEqual(r, { errors: [], notes: [] });
  // the public side still reports it (only the ledger repair fixes that)
  const strict = driftFindings({
    files: [file('1')],
    public: [],
    preview: [],
    baseline: ['1'],
    strict: true,
  });
  assert.equal(strict.errors.length, 1);
  assert.ok(strict.errors[0].includes('not applied in public'));
});

test('drift: versions only in public_preview are open branches (note)', () => {
  const r = driftFindings({
    files: [file('1')],
    public: ['1'],
    preview: [
      { version: '1', checksum: 'c' },
      { version: '9', checksum: 'x' },
    ],
  });
  assert.equal(r.errors.length, 0);
  assert.ok(r.notes[0].includes('9'));
});

test('drift: no history in public_preview is an error', () => {
  assert.equal(
    driftFindings({ files: [], public: [], preview: null }).errors.length,
    1
  );
});

test('drift: known list accepts 12 and 14 digits', () => {
  assert.deepEqual(
    readKnown('# x\n202606260001  # legacy\n20261027000000\nfoo\n'),
    ['202606260001', '20261027000000']
  );
});

// ---- preview-compare --------------------------------------------------------

test('compare: schema name and -preview buckets are aligned', () => {
  const dump = [
    '-- Name: t; Type: TABLE; Schema: public_preview; Owner: postgres',
    'CREATE TABLE public_preview.t (id int);',
    '',
    '-- Name: SCHEMA public_preview; Type: ACL; Schema: -; Owner: postgres',
    'GRANT USAGE ON SCHEMA public_preview TO anon;',
  ].join('\n');
  const other = [
    '-- Name: t; Type: TABLE; Schema: public; Owner: postgres',
    'CREATE TABLE public.t (id int);',
  ].join('\n');
  assert.deepEqual(differences(objects(other), objects(dump)), []);
});

test('compare: differences are reported with kind and object', () => {
  const a = new Map([
    ['TABLE t', 'x'],
    ['TABLE u', 'y'],
  ]);
  const b = new Map([
    ['TABLE t', 'z'],
    ['TABLE v', 'w'],
  ]);
  const kinds = differences(a, b).map(d => d.kind);
  assert.deepEqual(kinds.sort(), [
    'differs',
    'missing in public_preview',
    'only in public_preview',
  ]);
});

test('compare: foreign keys to auth.* are not part of the comparison', () => {
  const fk = schema =>
    [
      `-- Name: profiles profiles_id_fkey; Type: FK CONSTRAINT; Schema: ${schema}; Owner: postgres`,
      `ALTER TABLE ONLY ${schema}.profiles`,
      '    ADD CONSTRAINT profiles_id_fkey FOREIGN KEY (id) REFERENCES auth.users(id);',
    ].join('\n');
  // public has the key, public_preview cannot create it (no rights on auth)
  assert.deepEqual(differences(objects(fk('public')), objects('')), []);
  const own = schema =>
    [
      `-- Name: a a_b_fkey; Type: FK CONSTRAINT; Schema: ${schema}; Owner: postgres`,
      `ALTER TABLE ONLY ${schema}.a`,
      `    ADD CONSTRAINT a_b_fkey FOREIGN KEY (b) REFERENCES ${schema}.b(id);`,
    ].join('\n');
  assert.equal(differences(objects(own('public')), objects('')).length, 1);
});

test('compare: history difference and decision', () => {
  assert.deepEqual(historyDifference(['1', '2'], ['2', '3']), {
    onlyPreview: ['3'],
    onlyPublic: ['1'],
  });
  assert.equal(decideComparison(['1'], ['1']).compare, true);
  const d = decideComparison(['1'], ['1', '2'], { inCi: true });
  assert.equal(d.compare, false);
  assert.ok(d.lines[0].startsWith('::warning::'));
});

// ---- preview-cli ------------------------------------------------------------

test('cli: target is read from the arguments', () => {
  assert.deepEqual(targetFrom(['--linked']), ['--linked']);
  assert.deepEqual(targetFrom(['--local']), ['--local']);
  assert.deepEqual(targetFrom(['--db-url', 'postgres://x']), [
    '--db-url',
    'postgres://x',
  ]);
  assert.equal(targetFrom([]), null);
});

test('cli: login rejected is recognised, other errors are not', () => {
  assert.ok(
    LOGIN_REJECTED.test(
      'password authentication failed for user "cli_login_postgres"'
    )
  );
  assert.ok(LOGIN_REJECTED.test('DbConfigConnectTempRoleError'));
  assert.ok(!LOGIN_REJECTED.test('syntax error at or near'));
});

test('cli: answers are read as array or as object with rows', () => {
  assert.deepEqual(readAnswer('[{"a":1}]'), [{ a: 1 }]);
  assert.deepEqual(readAnswer('x {"rows":[{"a":1}]} y'), [{ a: 1 }]);
  assert.deepEqual(readAnswer('', { emptyAllowed: true }), []);
});

test('cli: an answer without the expected shape is an error, not an empty result', () => {
  assert.throws(() => readAnswer('no json here'));
  assert.throws(() => readAnswer('{"unexpected":true}'));
  assert.throws(() => readAnswer('[{"a":'));
});
