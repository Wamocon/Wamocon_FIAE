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

const { applyRenames, main, parseArgs, planRenames, rollbackRenames } =
  await import('../../../scripts/import/fiae-folder-renumber.mjs');

const OLD = [
  '01_Planen, Vorbereiten',
  '02_Informieren und Beraten',
  '07_Erbringen',
  '09_Programmieren',
  '13_Informieren und Beraten (Vertiefung)',
  '19_Netzwerk',
  '20_Programmieren (Vertiefung)',
  '23_Berufsbildung',
];
const NEW = [
  '01_Planen, Vorbereiten',
  '2.1_Informieren und Beraten',
  '07_Erbringen',
  '9.1_Programmieren',
  '2.2_Informieren und Beraten (Vertiefung)',
  '19_Netzwerk',
  '9.2_Programmieren (Vertiefung)',
  '23_Berufsbildung',
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

test('the plan names old and new and changes nothing: pairs are renamed, singles stay', () => {
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
      ['keep', 'rename', 'keep', 'rename', 'rename', 'keep', 'rename', 'keep']
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

test('apply renames only the pairs, leaves every file untouched and writes the log', () => {
  const { base, root, log } = makeRoot();
  try {
    const { renamed } = applyRenames(root, log);
    assert.equal(renamed.length, 4);
    assert.deepEqual(names(root), [...NEW, 'Hinweis.txt'].sort());
    // the files inside are exactly where and what they were
    assert.equal(
      readFileSync(
        path.join(
          root,
          '2.1_Informieren und Beraten',
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
    assert.equal(written.renamed.length, 4);
    assert.deepEqual(written.renamed[0], {
      from: '02_Informieren und Beraten',
      to: '2.1_Informieren und Beraten',
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
    assert.equal(restored.length, 4);
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
    writeFileSync(path.join(root, '2.1_INFORMIEREN UND BERATEN'), 'Datei');
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

test('apply stops on an unclear number or two folders for one component, nothing is renamed', () => {
  const { base, root, log } = makeRoot();
  try {
    mkdirSync(path.join(root, '2.3_Falsch'));
    const before = names(root);
    assert.throws(
      () => applyRenames(root, log),
      /Nothing renamed.*2\.3_Falsch/
    );
    assert.deepEqual(names(root), before);
    rmSync(path.join(root, '2.3_Falsch'), { recursive: true });
    mkdirSync(path.join(root, '2.1_Doppelt'));
    assert.throws(
      () => applyRenames(root, log),
      /Two folders for the component 2\.1/
    );
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

test('folders already in the new spelling stay, a second apply finds nothing to do', () => {
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
    assert.deepEqual(readdirSync(path.join(root, '2.1_Informieren')).sort(), [
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
          l.includes('2.1_Informieren und Beraten')
      )
    );
    assert.ok(run.lines.some(l => /4 to rename/.test(l)));
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
