// Tests for scripts/import/fiae-component-folder.mjs (folder numbers of the FIAE delivery, old and new).
// The folder trees are invented, no original file of the delivery is used or copied.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const {
  describeComponent,
  listComponentFolders,
  parseComponentList,
  parseComponentNumber,
  parseFolderName,
} = await import('../../../scripts/import/fiae-component-folder.mjs');

const PAIRS = [
  [2, 13],
  [3, 14],
  [4, 15],
  [5, 16],
  [6, 17],
  [8, 18],
  [9, 20],
  [10, 21],
  [11, 22],
];
const SINGLES = [1, 7, 12, 19, 23, 24, 25, 26];

const pad = n => String(n).padStart(2, '0');

test('the old and the new spelling of every pair give the same order index', () => {
  for (const [base, deep] of PAIRS) {
    assert.equal(parseFolderName(`${pad(base)}_Titel`).nr, base);
    assert.equal(parseFolderName(`${base}.1_Titel`).nr, base);
    assert.equal(parseFolderName(`${pad(deep)}_Titel (Vertiefung)`).nr, deep);
    assert.equal(parseFolderName(`${base}.2_Titel (Vertiefung)`).nr, deep);
    assert.equal(parseFolderName(`${base}.1_Titel`).spelling, 'new');
    assert.equal(parseFolderName(`${pad(base)}_Titel`).spelling, 'old');
  }
});

test('the examples of the decision: 02_ and 2.1_ are 2, 13_ and 2.2_ are 13, 09_ and 9.1_ are 9, 20_ and 9.2_ are 20', () => {
  assert.equal(parseFolderName('02_A').nr, 2);
  assert.equal(parseFolderName('2.1_A').nr, 2);
  assert.equal(parseFolderName('13_A').nr, 13);
  assert.equal(parseFolderName('2.2_A').nr, 13);
  assert.equal(parseFolderName('09_A').nr, 9);
  assert.equal(parseFolderName('9.1_A').nr, 9);
  assert.equal(parseFolderName('20_A').nr, 20);
  assert.equal(parseFolderName('9.2_A').nr, 20);
  assert.equal(parseFolderName('9.2_A').key, '20');
});

test('a single component stays as it is, with or without a leading zero', () => {
  for (const n of SINGLES) {
    assert.equal(parseFolderName(`${n}_Titel`).nr, n);
    assert.equal(parseFolderName(`${pad(n)}_Titel`).nr, n);
    assert.equal(parseFolderName(`${pad(n)}_Titel`).key, pad(n));
  }
});

test('all 26 components can be reached in the old and the new spelling', () => {
  const seen = new Set();
  for (let n = 1; n <= 26; n++) {
    assert.equal(parseFolderName(`${pad(n)}_x`).nr, n);
    const label = describeComponent(n).split(' ')[0];
    assert.equal(parseFolderName(`${label}_x`).nr, n);
    seen.add(label);
  }
  assert.equal(seen.size, 26);
});

test('a pattern that is not clear is refused with a message, never guessed', () => {
  for (const name of [
    '2.3_x',
    '13.1_x',
    '13.2_x',
    '7.1_x',
    '9.3_x',
    '27_x',
    '0_x',
    '100_x',
    '1.5_x',
  ]) {
    const parsed = parseFolderName(name);
    assert.equal(parsed.ok, false, name);
    assert.ok(parsed.reason.startsWith(name), parsed.reason);
  }
  assert.match(parseFolderName('2.3_x').reason, /x\.1 and x\.2/);
});

test('a name without a number is no component folder', () => {
  assert.equal(parseFolderName('Notizen'), null);
  assert.equal(parseFolderName('_2_x'), null);
  assert.equal(parseFolderName('2.1'), null);
  assert.equal(parseFolderName('2x_y'), null);
});

test('the reports name the component in the new label and the folder number in brackets', () => {
  assert.equal(describeComponent(2), '2.1 (Ordner 02)');
  assert.equal(describeComponent('13'), '2.2 (Ordner 13)');
  assert.equal(describeComponent(20), '9.2 (Ordner 20)');
  assert.equal(describeComponent(7), '7 (Ordner 07)');
  assert.equal(describeComponent(26), '26 (Ordner 26)');
});

test('the options --components and --files read both spellings and refuse an unknown value', () => {
  assert.deepEqual(parseComponentList('5, 13,2.1,2.2').keys, [
    '05',
    '13',
    '02',
    '13',
  ]);
  assert.deepEqual(parseComponentList('9.2,07').keys, ['20', '07']);
  assert.equal(parseComponentList('5,13').errors.length, 0);
  const bad = parseComponentList('5,2.3,x');
  assert.deepEqual(bad.keys, ['05']);
  assert.equal(bad.errors.length, 2);
  assert.equal(parseComponentNumber('99').ok, false);
});

test('the folders under a root are listed with both spellings in one folder, in the order of the numbers', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-num-'));
  try {
    for (const name of [
      '01_Planen',
      '2.1_Informieren',
      '13_Informieren (Vertiefung)',
      '9.1_Programmieren',
      '9.2_Programmieren (Vertiefung)',
      '26_Umweltschutz',
      'Notizen',
    ])
      mkdirSync(path.join(root, name));
    const { folders, problems } = listComponentFolders(root);
    assert.deepEqual(problems, []);
    assert.deepEqual(
      folders.map(f => [f.nr, f.dirName]),
      [
        [1, '01_Planen'],
        [2, '2.1_Informieren'],
        [9, '9.1_Programmieren'],
        [13, '13_Informieren (Vertiefung)'],
        [20, '9.2_Programmieren (Vertiefung)'],
        [26, '26_Umweltschutz'],
      ]
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unclear number and two folders for one component are problems', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-num-'));
  try {
    for (const name of [
      '02_Informieren',
      '2.1_Informieren',
      '2.3_Falsch',
      '13.1_Falsch',
    ])
      mkdirSync(path.join(root, name));
    const { folders, problems } = listComponentFolders(root);
    assert.equal(folders.length, 1);
    assert.equal(problems.length, 3);
    assert.ok(problems.some(p => /2\.3_Falsch/.test(p)));
    assert.ok(problems.some(p => /13\.1_Falsch/.test(p)));
    assert.ok(
      problems.some(p =>
        /Two folders for the component 2\.1 \(Ordner 02\)/.test(p)
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
