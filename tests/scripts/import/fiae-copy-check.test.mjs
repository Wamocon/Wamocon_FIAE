// Tests for scripts/import/fiae-copy-check.mjs (a Vertiefung enabler that is a byte copy of the base course).
// The folder trees are invented, no original file of the delivery is used or copied.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const { describeCopy, findBaseCopies, main } =
  await import('../../../scripts/import/fiae-copy-check.mjs');
const { readSource } =
  await import('../../../scripts/import/fiae-documents.mjs');

/** One enabler folder with its main file; `text` is the content (same text, same bytes). */
function enabler(root, comp, folder, text) {
  const dir = path.join(root, comp, 'Enablers', folder);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, `${folder}.docx`), text);
}

test('a copy of the base course is found by SHA-256, an own text and a unique text are not', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-copy-'));
  try {
    // 2.2 is order index 13 (the Vertiefung of 2.1), so the base is 02
    enabler(root, '02_Informieren', '01_Grund', 'same text');
    enabler(root, '02_Informieren', '02_Zweit', 'base only');
    enabler(root, '13_Informieren (Vertiefung)', '01_Grund', 'same text');
    enabler(root, '13_Informieren (Vertiefung)', '02_Zweit', 'own text');
    enabler(root, '13_Informieren (Vertiefung)', '03_Eigen', 'unique');
    const copies = findBaseCopies(readSource(root));
    assert.equal(copies.length, 1);
    assert.deepEqual(
      [
        copies[0].deepNr,
        copies[0].baseNr,
        copies[0].enabler,
        copies[0].baseEnabler,
      ],
      [13, 2, '01', '01']
    );
    assert.match(describeCopy(copies[0]), /Kopie des Grundkurses/);
    assert.match(
      describeCopy(copies[0]),
      /2\.2 \(Ordner 13\).*2\.1 \(Ordner 02\)/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the copy is found whatever the enabler number, with both spellings of the folders', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-copy-'));
  try {
    // base in the old spelling (11), Vertiefung in the new one (2.2 would be 13), so use 11 > 22
    enabler(root, '11_Sicherstellen der Qualität', '04_Letzter', 'same text');
    enabler(
      root,
      '22_Sicherstellen der Qualität (Vertiefung)',
      '01_Erster',
      'same text'
    );
    const copies = findBaseCopies(readSource(root));
    assert.equal(copies.length, 1);
    assert.deepEqual([copies[0].enabler, copies[0].baseEnabler], ['01', '04']);
    assert.equal(copies[0].deepNr, 22);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('only the Vertiefung is checked, a base component and a single component are never reported', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-copy-'));
  try {
    enabler(root, '12_Einzeln', '01_A', 'same text');
    enabler(root, '12_Einzeln', '02_B', 'same text');
    enabler(root, '03_Beurteilen', '01_A', 'same text');
    enabler(root, '03_Beurteilen', '02_B', 'same text');
    assert.deepEqual(findBaseCopies(readSource(root)), []);
    // limited to other components: a copy in 14 is not looked at
    enabler(root, '14_Beurteilen (Vertiefung)', '01_A', 'same text');
    assert.equal(findBaseCopies(readSource(root)).length, 1);
    assert.equal(findBaseCopies(readSource(root), new Set([22])).length, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the check command reports the copies and answers 1, no copy answers 0, a wrong call 2', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-copy-'));
  const lines = [];
  const original = console.log;
  console.log = (...a) => lines.push(a.join(' '));
  try {
    enabler(root, '02.1_Informieren', '01_Grund', 'copy');
    enabler(root, '02.2_Informieren (Vertiefung)', '01_Grund', 'copy');
    assert.equal(await main([root]), 1);
    assert.ok(lines.some(l => /Kopie des Grundkurses/.test(l)));
    enabler(root, '02.2_Informieren (Vertiefung)', '01_Grund', 'an own text');
    assert.equal(await main([root]), 0);
  } finally {
    console.log = original;
    rmSync(root, { recursive: true, force: true });
  }
  const error = console.error;
  console.error = () => undefined;
  try {
    assert.equal(await main([]), 2);
  } finally {
    console.error = error;
  }
});

test('the final numbering: copies of 3.2 and 11.2 are named with the label and the final folder number', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-copy-'));
  try {
    enabler(root, '03.1_Beurteilen', '02_Eins', 'copy of three');
    enabler(root, '03.2_Beurteilen', '02_Eins', 'copy of three');
    enabler(root, '03.2_Beurteilen', '03_Zwei', 'own text');
    enabler(root, '11.1_Sicherstellen', '01_Plan', 'copy of eleven');
    enabler(root, '11.2_Sicherstellen', '01_Plan', 'copy of eleven');
    // a single component is never compared (13 is Speicherlösungen here, not a Vertiefung)
    enabler(root, '12_Vernetzt', '01_A', 'same');
    enabler(root, '13_Speicher', '01_A', 'same');
    const copies = findBaseCopies(readSource(root));
    assert.deepEqual(
      copies.map(c => [c.deepNr, c.baseNr, c.enabler]),
      [
        [14, 3, '02'],
        [22, 11, '01'],
      ]
    );
    assert.match(
      describeCopy(copies[0]),
      /3\.2 \(Ordner 03\.2\) \/ 02 .*3\.1 \(Ordner 03\.1\)/
    );
    assert.match(describeCopy(copies[1]), /11\.2 \(Ordner 11\.2\)/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
