// Tests for scripts/import/fiae-component-folder.mjs (folder numbers of the FIAE delivery, old and final scheme).
// The folder trees are invented (only the names of the listing are rebuilt), no original file of the
// delivery is used or copied.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { FINAL_LISTING, OLD_LISTING } from './fiae-listing.mjs';

const {
  describeComponent,
  detectScheme,
  finalFolderNumber,
  folderNumberOf,
  listComponentFolders,
  parseComponentList,
  parseComponentNumber,
  parseFolderName,
  resolveComponentTokens,
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
// order index -> label number of the single components in the final numbering
const SINGLES = { 1: 1, 7: 7, 12: 12, 19: 13, 23: 14, 24: 15, 25: 16, 26: 17 };

const pad = n => String(n).padStart(2, '0');

test('the final listing: every folder gives its order index, all 26 are found', () => {
  const nrs = FINAL_LISTING.map(name => parseFolderName(name, 'new').nr);
  assert.equal(new Set(nrs).size, 26);
  // the listing runs by the label: 1, 2.1, 2.2, 3.1, 3.2, ... 12, 13 (19), 14 (23) ...
  assert.deepEqual(
    nrs,
    [
      1, 2, 13, 3, 14, 4, 15, 5, 16, 6, 17, 7, 8, 18, 9, 20, 10, 21, 11, 22, 12,
      19, 23, 24, 25, 26,
    ]
  );
});

test('the scheme is new when one folder has the dot notation, with or without a leading zero', () => {
  assert.equal(detectScheme(FINAL_LISTING), 'new');
  assert.equal(detectScheme(OLD_LISTING), 'old');
  assert.equal(detectScheme(['01_A', '2.1_B']), 'new');
  assert.equal(detectScheme(['01_A', '02.2_B']), 'new');
  assert.equal(detectScheme(['01_A', '13_B', 'Notizen']), 'old');
  assert.equal(detectScheme([]), 'old');
});

test('"13_" is the Vertiefung of 2 in the old scheme and Speicherlösungen (19) in the new one', () => {
  assert.equal(parseFolderName('13_X', 'old').nr, 13);
  assert.equal(parseFolderName('13_X', 'new').nr, 19);
  assert.equal(parseFolderName('13_X', 'new').key, '19');
  assert.equal(parseFolderName('19_X', 'old').nr, 19);
  assert.equal(parseFolderName('2.2_X', 'old').nr, 13);
  assert.equal(parseFolderName('02.2_X', 'new').nr, 13);
});

test('every pair in the new scheme: x.1 is the base, x.2 the Vertiefung, with a leading zero or without', () => {
  for (const [base, deep] of PAIRS) {
    for (const lead of [pad(base), String(base)]) {
      assert.equal(parseFolderName(`${lead}.1_T`, 'new').nr, base);
      assert.equal(parseFolderName(`${lead}.2_T`, 'new').nr, deep);
    }
    // the old scheme: the plain number is the order index
    assert.equal(parseFolderName(`${pad(base)}_T`, 'old').nr, base);
    assert.equal(parseFolderName(`${pad(deep)}_T`, 'old').nr, deep);
  }
});

test('the single components in the new scheme: 1, 7, 12 stay, 13 to 17 are 19, 23 to 26', () => {
  for (const [order, label] of Object.entries(SINGLES)) {
    assert.equal(parseFolderName(`${pad(label)}_T`, 'new').nr, Number(order));
    assert.equal(parseFolderName(`${label}_T`, 'new').nr, Number(order));
  }
  assert.equal(parseFolderName('01_T', 'new').nr, 1);
  assert.equal(parseFolderName('1_T', 'new').key, '01');
});

test('in the new scheme a plain 2 to 6, 8 to 11 and 18 to 26 and bad dot patterns are refused with a message', () => {
  for (const name of [
    '2_x',
    '02_x',
    '9_x',
    '11_x',
    '18_x',
    '19_x',
    '20_x',
    '23_x',
    '26_x',
    '27_x',
    '0_x',
    '2.3_x',
    '13.1_x',
    '13.2_x',
    '7.1_x',
    '9.3_x',
    '1.5_x',
  ]) {
    const parsed = parseFolderName(name, 'new');
    assert.equal(parsed.ok, false, name);
    assert.ok(parsed.reason.startsWith(name), parsed.reason);
  }
  assert.match(parseFolderName('2_x', 'new').reason, /final numbering/);
  assert.match(parseFolderName('2_x', 'new').reason, /mix/);
});

test('in the old scheme a pattern outside 1 to 26 is refused, a name without a number is no component folder', () => {
  assert.equal(parseFolderName('27_x', 'old').ok, false);
  assert.equal(parseFolderName('0_x', 'old').ok, false);
  assert.equal(parseFolderName('Notizen', 'old'), null);
  assert.equal(parseFolderName('_2_x', 'new'), null);
  assert.equal(parseFolderName('2.1', 'new'), null);
  assert.equal(parseFolderName('2x_y', 'old'), null);
});

test('folder numbers and the report names: label and, in brackets, the folder number of the scheme', () => {
  assert.equal(describeComponent(2), '2.1 (Ordner 02)');
  assert.equal(describeComponent(13), '2.2 (Ordner 13)');
  assert.equal(describeComponent(19), '13 (Ordner 19)');
  assert.equal(describeComponent(2, 'new'), '2.1 (Ordner 02.1)');
  assert.equal(describeComponent(13, 'new'), '2.2 (Ordner 02.2)');
  assert.equal(describeComponent(19, 'new'), '13 (Ordner 13)');
  assert.equal(describeComponent(26, 'new'), '17 (Ordner 17)');
  assert.equal(describeComponent(20, 'new'), '9.2 (Ordner 09.2)');
  assert.equal(folderNumberOf(1, 'new'), '01');
  assert.equal(finalFolderNumber(21), '10.2');
  assert.equal(finalFolderNumber(12), '12');
  assert.equal(finalFolderNumber(25), '16');
});

test('the options --components and --files keep the tokens, plain numbers resolve per scheme', () => {
  const list = parseComponentList('5, 13,2.1,2.2');
  assert.deepEqual(list.tokens, ['5', '13', '2.1', '2.2']);
  assert.equal(list.errors.length, 0);
  // old: the plain number is the order index
  assert.deepEqual(resolveComponentTokens(list.tokens, 'old').keys, [
    '05',
    '13',
    '02',
    '13',
  ]);
  // new: 5 is not allowed, 13 is Speicherlösungen (19)
  const resolved = resolveComponentTokens(list.tokens, 'new');
  assert.deepEqual(resolved.keys, ['19', '02', '13']);
  assert.equal(resolved.errors.length, 1);
  assert.match(resolved.errors[0], /"5"/);
  assert.deepEqual(resolveComponentTokens(['9.2', '07', '17'], 'new').keys, [
    '20',
    '07',
    '26',
  ]);
  const bad = parseComponentList('5,2.3,x,99');
  assert.deepEqual(bad.tokens, ['5']);
  assert.equal(bad.errors.length, 3);
  assert.equal(parseComponentNumber('99').ok, false);
});

/** Builds the folders of a listing in a throwaway directory (only the names). */
function build(names) {
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-num-'));
  for (const name of names) mkdirSync(path.join(root, name));
  return root;
}

test('the final listing is read as 26 components in the new scheme, in the order of the order index', () => {
  const root = build([...FINAL_LISTING, 'Notizen']);
  try {
    const { scheme, folders, problems } = listComponentFolders(root);
    assert.deepEqual(problems, []);
    assert.equal(scheme, 'new');
    assert.equal(folders.length, 26);
    assert.deepEqual(
      folders.map(f => f.nr),
      Array.from({ length: 26 }, (_, i) => i + 1)
    );
    assert.equal(
      folders[18].dirName,
      '13_Inbetriebnehmen von Speicherlösungen'
    );
    assert.equal(
      folders[12].dirName,
      '02.2_Informieren und Beraten von Kunden und Kundinnen'
    );
    assert.equal(folders[25].dirName, '17_Umweltschutz');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the old listing is read as 26 components in the old scheme', () => {
  const root = build(OLD_LISTING);
  try {
    const { scheme, folders, problems } = listComponentFolders(root);
    assert.deepEqual(problems, []);
    assert.equal(scheme, 'old');
    assert.deepEqual(
      folders.map(f => f.nr),
      Array.from({ length: 26 }, (_, i) => i + 1)
    );
    assert.equal(folders[12].dirName, '13_Titel 13');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a mix of both schemes in one folder is refused: old numbers in a new delivery', () => {
  // 02.1_ makes the delivery new, then the plain 02_ and 20_ of the old scheme are not allowed
  const root = build([
    '02.1_Informieren',
    '09_Programmieren',
    '20_Programmieren (Vertiefung)',
    '07_Erbringen',
  ]);
  try {
    const { scheme, folders, problems } = listComponentFolders(root);
    assert.equal(scheme, 'new');
    assert.deepEqual(
      folders.map(f => f.nr),
      [2, 7]
    );
    assert.equal(problems.length, 2);
    assert.ok(problems.some(p => /^09_Programmieren/.test(p)));
    assert.ok(problems.some(p => /^20_Programmieren/.test(p)));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('an unclear number and two folders for one component are problems', () => {
  const root = build([
    '02.1_Informieren',
    '2.1_Doppelt',
    '2.3_Falsch',
    '13.1_Falsch',
  ]);
  try {
    const { folders, problems } = listComponentFolders(root);
    assert.equal(folders.length, 1);
    assert.equal(problems.length, 3);
    assert.ok(problems.some(p => /2\.3_Falsch/.test(p)));
    assert.ok(problems.some(p => /13\.1_Falsch/.test(p)));
    assert.ok(
      problems.some(p =>
        /Two folders for the component 2\.1 \(Ordner 02\.1\)/.test(p)
      )
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
