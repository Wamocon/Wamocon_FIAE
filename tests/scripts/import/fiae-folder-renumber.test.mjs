// Tests for scripts/import/fiae-folder-renumber.mjs (rename of the component folders, old to new numbering).
// Throwaway folders only, no original folder or file of the delivery is touched.
import assert from 'node:assert/strict';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { FINAL_LISTING, OLD_LISTING } from './fiae-listing.mjs';

const { applyRenames, main, parseArgs, planRenames, rollbackRenames } =
  await import('../../../scripts/import/fiae-folder-renumber.mjs');

// an old delivery (the number is the order index) and what the tool makes of it
const OLD = [
  '01_Planen, Vorbereiten',
  '02_Informieren und Beraten',
  '07_Erbringen',
  '09_Programmieren',
  '13_Informieren und Beraten (Vertiefung)',
  '19_Netzwerk',
  '20_Programmieren (Vertiefung)',
  '23_Berufsbildung',
  '26_Umweltschutz',
];
const NEW = [
  '01_Planen, Vorbereiten',
  '02.1_Informieren und Beraten',
  '07_Erbringen',
  '09.1_Programmieren',
  '02.2_Informieren und Beraten (Vertiefung)',
  '13_Netzwerk',
  '09.2_Programmieren (Vertiefung)',
  '14_Berufsbildung',
  '17_Umweltschutz',
];

/** A throwaway delivery: the component folders with one file inside each, and a loose file next to them. */
function makeRoot(names = OLD) {
  const base = mkdtempSync(path.join(tmpdir(), 'fiae-ren-'));
  const root = path.join(base, 'Komponenten');
  mkdirSync(root);
  for (const n of names) {
    mkdirSync(path.join(root, n, 'Enablers'), { recursive: true });
    writeFileSync(
      path.join(root, n, 'Enablers', 'inhalt.txt'),
      `Inhalt von ${n}`
    );
  }
  writeFileSync(path.join(root, 'Hinweis.txt'), 'bleibt');
  return { base, root, log: path.join(base, 'protokoll.json') };
}

const names = root => readdirSync(root).sort();
const quiet = fn => {
  const out = console.log;
  const err = console.error;
  const lines = [];
  console.log = (...a) => lines.push(a.join(' '));
  console.error = (...a) => lines.push(a.join(' '));
  try {
    return { result: fn(), lines };
  } finally {
    console.log = out;
    console.error = err;
  }
};

test('the plan names old and new and changes nothing: pairs get the dot notation, singles are numbered on', () => {
  const { base, root } = makeRoot();
  try {
    const before = names(root);
    const { items, problems } = planRenames(root);
    assert.deepEqual(problems, []);
    assert.deepEqual(
      items.map(i => i.to),
      NEW
    );
    assert.deepEqual(
      items.map(i => i.action),
      [
        'keep',
        'rename',
        'keep',
        'rename',
        'rename',
        'rename',
        'rename',
        'rename',
        'rename',
      ]
    );
    assert.deepEqual(names(root), before);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('plan is the default of the command and apply needs a log file', () => {
  assert.equal(parseArgs(['plan', 'x']).errors.length, 0);
  assert.ok(parseArgs(['apply', 'x']).errors.some(e => /--log/.test(e)));
  assert.equal(parseArgs(['apply', 'x', '--log', 'l.json']).errors.length, 0);
  assert.equal(parseArgs(['rollback', 'l.json']).errors.length, 0);
  assert.ok(parseArgs(['rollback']).errors.length > 0);
  assert.ok(
    parseArgs(['plan', 'x', '--log', 'l.json']).errors.some(e =>
      /belongs to apply/.test(e)
    )
  );
  assert.ok(parseArgs(['delete', 'x']).errors.length > 0);
  assert.ok(
    parseArgs(['plan', 'x', '--force']).errors.some(e =>
      /Unknown option/.test(e)
    )
  );
  const { result, lines } = quiet(() => main(['plan']));
  assert.equal(result, 2);
  assert.ok(lines.some(l => /folder of the components is missing/.test(l)));
});

test('apply renames to the final numbering, leaves every file untouched and writes the log', () => {
  const { base, root, log } = makeRoot();
  try {
    const { renamed } = applyRenames(root, log);
    assert.equal(renamed.length, 7);
    assert.deepEqual(names(root), [...NEW, 'Hinweis.txt'].sort());
    // the files inside are exactly where and what they were
    assert.equal(
      readFileSync(
        path.join(
          root,
          '02.1_Informieren und Beraten',
          'Enablers',
          'inhalt.txt'
        ),
        'utf8'
      ),
      'Inhalt von 02_Informieren und Beraten'
    );
    assert.equal(
      readFileSync(path.join(root, 'Hinweis.txt'), 'utf8'),
      'bleibt'
    );
    const written = JSON.parse(readFileSync(log, 'utf8'));
    assert.equal(written.renamed.length, 7);
    assert.deepEqual(written.renamed[0], {
      from: '02_Informieren und Beraten',
      to: '02.1_Informieren und Beraten',
    });
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('rollback gives every folder its old name again, then a second rollback is refused', () => {
  const { base, root, log } = makeRoot();
  try {
    const before = names(root);
    applyRenames(root, log);
    const { restored } = rollbackRenames(log);
    assert.equal(restored.length, 7);
    assert.deepEqual(names(root), before);
    assert.equal(
      readFileSync(
        path.join(
          root,
          '13_Informieren und Beraten (Vertiefung)',
          'Enablers',
          'inhalt.txt'
        ),
        'utf8'
      ),
      'Inhalt von 13_Informieren und Beraten (Vertiefung)'
    );
    assert.throws(() => rollbackRenames(log), /Nothing renamed back/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('apply stops before the first rename when a target name already exists, in any case', () => {
  const { base, root, log } = makeRoot();
  try {
    // the new spelling of 13 with other letter case is another number spelling: the target is taken
    mkdirSync(path.join(root, '2.2_INFORMIEREN UND BERATEN (VERTIEFUNG)'));
    const before = names(root);
    const { problems } = planRenames(root);
    assert.ok(problems.length > 0);
    assert.throws(() => applyRenames(root, log), /Nothing renamed/);
    assert.deepEqual(names(root), before);
    assert.equal(existsSync(log), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a loose file with the target name (any letter case) stops apply with the message that it exists', () => {
  const { base, root, log } = makeRoot();
  try {
    writeFileSync(path.join(root, '02.1_INFORMIEREN UND BERATEN'), 'Datei');
    const before = names(root);
    const { problems } = planRenames(root);
    assert.ok(problems.some(p => /already exists/.test(p)));
    assert.throws(
      () => applyRenames(root, log),
      /Nothing renamed.*already exists/
    );
    assert.deepEqual(names(root), before);
    assert.equal(existsSync(log), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('apply stops on an unclear number, a mix of both numberings or two folders for one component, nothing is renamed', () => {
  const { base, root, log } = makeRoot();
  try {
    const before = names(root);
    // an unclear number
    mkdirSync(path.join(root, '2.3_Falsch'));
    assert.throws(
      () => applyRenames(root, log),
      /Nothing renamed.*2\.3_Falsch/
    );
    rmSync(path.join(root, '2.3_Falsch'), { recursive: true });
    // a folder with the dot notation makes the delivery final: the plain old numbers are a mix
    mkdirSync(path.join(root, '02.1_Doppelt'));
    assert.throws(
      () => applyRenames(root, log),
      /Nothing renamed.*not allowed in the final numbering/
    );
    rmSync(path.join(root, '02.1_Doppelt'), { recursive: true });
    // two folders for one component
    mkdirSync(path.join(root, '02 Doppelt'));
    assert.throws(
      () => applyRenames(root, log),
      /Two folders for the component 2\.1 \(Ordner 02\)/
    );
    rmSync(path.join(root, '02 Doppelt'), { recursive: true });
    assert.deepEqual(names(root), before);
    assert.equal(existsSync(log), false);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('apply refuses to overwrite an existing log file', () => {
  const { base, root, log } = makeRoot();
  try {
    writeFileSync(log, 'old log');
    const before = names(root);
    assert.throws(() => applyRenames(root, log), /already exists/);
    assert.deepEqual(names(root), before);
    assert.equal(readFileSync(log, 'utf8'), 'old log');
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a delivery with the final numbering stays as it is, a second apply finds nothing to do', () => {
  const { base, root, log } = makeRoot(NEW);
  try {
    const { items } = planRenames(root);
    assert.deepEqual(
      items.map(i => i.to),
      NEW
    );
    assert.equal(items.filter(i => i.action === 'rename').length, 0);
    const { renamed } = applyRenames(root, log);
    assert.equal(renamed.length, 0);
    assert.deepEqual(names(root), [...NEW, 'Hinweis.txt'].sort());
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('only the folders directly under the given folder are renamed, not folders further down', () => {
  const { base, root, log } = makeRoot(['02_Informieren']);
  try {
    mkdirSync(path.join(root, '02_Informieren', '13_Unterordner'));
    applyRenames(root, log);
    assert.deepEqual(readdirSync(path.join(root, '02.1_Informieren')).sort(), [
      '13_Unterordner',
      'Enablers',
    ]);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('a log that is no log of this tool is refused', () => {
  const { base, log } = makeRoot();
  try {
    writeFileSync(log, JSON.stringify({ hello: 1 }));
    assert.throws(() => rollbackRenames(log), /no log of this tool/);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the command: plan lists and changes nothing, apply renames, rollback restores', () => {
  const { base, root, log } = makeRoot();
  try {
    const before = names(root);
    let run = quiet(() => main(['plan', root]));
    assert.equal(run.result, 0);
    assert.ok(
      run.lines.some(
        l =>
          l.includes('02_Informieren und Beraten') &&
          l.includes('02.1_Informieren und Beraten')
      )
    );
    assert.ok(run.lines.some(l => /7 to rename/.test(l)));
    assert.deepEqual(names(root), before);
    run = quiet(() => main(['apply', root, '--log', log]));
    assert.equal(run.result, 0);
    assert.deepEqual(names(root), [...NEW, 'Hinweis.txt'].sort());
    run = quiet(() => main(['rollback', log]));
    assert.equal(run.result, 0);
    assert.deepEqual(names(root), before);
    run = quiet(() => main(['plan', path.join(base, 'gibt-es-nicht')]));
    assert.equal(run.result, 1);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});

test('the 26 old folders become the 26 folders of the final listing (numbers only)', () => {
  const { base, root } = makeRoot([]);
  try {
    for (const name of OLD_LISTING) mkdirSync(path.join(root, name));
    const { items, problems } = planRenames(root);
    assert.deepEqual(problems, []);
    assert.equal(items.length, 26);
    // the number in front of the title is the number of the final listing
    const finalNumbers = FINAL_LISTING.map(name => name.split('_')[0]);
    assert.deepEqual(
      items.map(i => i.to.split('_')[0]).sort(),
      [...finalNumbers].sort()
    );
    const byOrder = Object.fromEntries(items.map(i => [i.nr, i.to]));
    assert.equal(byOrder[2], '02.1_Titel 2');
    assert.equal(byOrder[13], '02.2_Titel 13');
    assert.equal(byOrder[19], '13_Titel 19');
    assert.equal(byOrder[23], '14_Titel 23');
    assert.equal(byOrder[26], '17_Titel 26');
    assert.equal(items.filter(i => i.action === 'keep').length, 3);
  } finally {
    rmSync(base, { recursive: true, force: true });
  }
});
