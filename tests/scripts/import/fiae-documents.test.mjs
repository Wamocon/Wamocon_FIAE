// Tests for scripts/import/fiae-documents.mjs (FIAE documents of the Word delivery into the Preview).
// The folder tree is invented, no original file of the source is used or copied.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

const mod = await import('../../../scripts/import/fiae-documents.mjs');
const {
  parseArgs,
  similarity,
  matchEnablers,
  mapComponents,
  keyOfUseCaseFile,
  readSource,
  ascii,
} = mod;

test('every run needs the target preview, there is no production', () => {
  assert.ok(
    parseArgs(['plan', 'src']).errors.some(e => /--target preview/.test(e))
  );
  assert.ok(
    parseArgs(['plan', 'src', '--target', 'production']).errors.length > 0
  );
  assert.equal(
    parseArgs(['plan', 'src', '--target', 'preview']).errors.length,
    0
  );
});

test('a real run needs --apply, the storage host and the command run', () => {
  const noHost = parseArgs(['run', 'src', '--target', 'preview', '--apply']);
  assert.ok(noHost.errors.some(e => /confirm-storage-host/.test(e)));
  const onPlan = parseArgs([
    'plan',
    'src',
    '--target',
    'preview',
    '--apply',
    '--confirm-storage-host',
    'h',
  ]);
  assert.ok(onPlan.errors.some(e => /belongs to run/.test(e)));
  const ok = parseArgs([
    'run',
    'src',
    '--target',
    'preview',
    '--apply',
    '--confirm-storage-host',
    'h',
  ]);
  assert.equal(ok.errors.length, 0);
  assert.equal(ok.apply, true);
});

test('a dry run is the default and an unknown option is refused', () => {
  assert.equal(parseArgs(['run', 'src', '--target', 'preview']).apply, false);
  assert.ok(
    parseArgs(['run', 'src', '--target', 'preview', '--aply']).errors.some(e =>
      /Unknown option/.test(e)
    )
  );
  assert.ok(
    parseArgs(['run', 'src', '--target', 'preview', '--limit', 'x']).errors
      .length > 0
  );
  assert.deepEqual(
    parseArgs(['run', 'src', '--target', 'preview', '--components', '5,13'])
      .components,
    ['05', '13']
  );
});

test('the number and letter of a use case come out of every spelling of the file name', () => {
  assert.equal(keyOfUseCaseFile('1a_Use-Case_Grundsätze.docx'), '1A');
  assert.equal(keyOfUseCaseFile('Use Case_4b_ Programmiersprachen.docx'), '4B');
  assert.equal(keyOfUseCaseFile('Use Cases_6d- Kun.docx'), '6D');
  assert.equal(keyOfUseCaseFile('23a - Umweltbelastungen.docx'), '23A');
  assert.equal(keyOfUseCaseFile('[zu klären]24d_Ethik.docx'), null);
  assert.equal(keyOfUseCaseFile('Notizen.docx'), null);
});

test('similarity ignores soft hyphens, case and spelling marks and tells different titles apart', () => {
  assert.equal(
    similarity('Nut­zung digitaler Werkzeuge', 'nutzung digitaler werkzeuge'),
    1
  );
  assert.ok(
    similarity(
      'Marktgängige IT-Syteme kennen',
      'Marktgängige IT-Systeme kennen'
    ) > 0.9
  );
  assert.ok(
    similarity(
      'Merkmale und Methoden des Projektmanagements',
      'Umweltschutz und Green-IT'
    ) < 0.5
  );
});

test('enablers are matched by title, and the last few left over by order', () => {
  const folders = [
    { title: 'Merkmale und Methoden des Projektmanagements' },
    { title: 'Aktives Zuhören, Kommu-Modelle' },
    { title: 'Daten Sachverh. interpret. aufber.' },
  ];
  const db = [
    { id: 'a', title: 'Merkmale und Methoden des Projektmanagements' },
    {
      id: 'b',
      title:
        'Aktives Zuhören, Kommunikationsmodelle, Verkaufsgespräche, Analyse der Kundenbedürfnisse',
    },
    {
      id: 'c',
      title:
        'Daten und Sachverhalte interpretieren, multimedial aufbereiten und situationsgerecht präsentieren',
    },
  ];
  const m = matchEnablers(folders, db);
  assert.equal(m.get(0).e.id, 'a');
  assert.equal(m.size, 3);
  assert.equal(m.get(0).how, 'title');
  // four left over are too many to guess
  const many = matchEnablers(
    ['w1', 'x2', 'y3', 'z4'].map(t => ({ title: t })),
    ['q1', 'r2', 's3', 't4'].map(t => ({ id: t, title: t }))
  );
  assert.equal(many.size, 0);
});

test('the parent and the Vertiefung of a component get their own course', () => {
  const courses = [
    { id: 'a', title: 'Informieren und Beraten von Kunden (§ 4 Abs. 2 Nr. 2)' },
    {
      id: 'b',
      title:
        'Informieren und Beraten von Kunden (Vertiefung) (§ 4 Abs. 2 Nr. 2 J2)',
    },
  ];
  const { map, problems } = mapComponents(
    [
      {
        nr: 2,
        title: '02_Informieren und Beraten von Kunden (§4 Absatz 2 Nr 2)',
      },
      { nr: 13, title: '13_Informieren und Beraten von Kunden und Kundinnen' },
    ],
    courses
  );
  assert.deepEqual(problems, []);
  assert.equal(map.get(2).id, 'a');
  assert.equal(map.get(13).id, 'b');
});

test('two components that claim one course are refused', () => {
  const { problems } = mapComponents(
    [
      { nr: 3, title: '03_Beurteilen marktgängiger IT-Systeme' },
      { nr: 4, title: '04_Beurteilen marktgängiger IT-Systeme' },
    ],
    [
      {
        id: 'a',
        title: 'Beurteilen marktgängiger IT-Systeme (§ 4 Abs. 2 Nr. 3)',
      },
    ]
  );
  assert.ok(problems.some(p => /same course/.test(p)));
});

test('the source folder is read as components, enablers with scenario parts and use case files', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-src-'));
  try {
    const comp = path.join(
      root,
      '05_Durchführen und Dokumentieren (§4 Abs 2 Nr 5)'
    );
    const enabler = path.join(
      comp,
      'Enablers',
      '01_Grundverständnis nachweisen'
    );
    mkdirSync(path.join(enabler, 'Szenario parts'), { recursive: true });
    writeFileSync(
      path.join(enabler, '01_Grundverständnis nachweisen.docx'),
      'x'
    );
    writeFileSync(path.join(enabler, 'Szenario parts', 'Part2_zwei.docx'), 'x');
    writeFileSync(path.join(enabler, 'Szenario parts', 'Part1_eins.docx'), 'x');
    mkdirSync(path.join(comp, 'Use_Cases', 'Ohne Musterlösung'), {
      recursive: true,
    });
    writeFileSync(path.join(comp, 'Use_Cases', '5a_Use-Case_A.docx'), 'x');
    writeFileSync(
      path.join(comp, 'Use_Cases', 'Ohne Musterlösung', '5a_Use-Case_A.docx'),
      'x'
    );
    const [c] = readSource(root);
    assert.equal(c.nr, 5);
    assert.equal(c.key, '05');
    assert.equal(c.enablers.length, 1);
    assert.equal(c.enablers[0].key, '01');
    assert.ok(
      c.enablers[0].main.endsWith('01_Grundverständnis nachweisen.docx')
    );
    assert.deepEqual(
      c.enablers[0].parts.map(p => p.n),
      [1, 2]
    );
    assert.equal(c.useCases.length, 1);
    assert.equal(c.useCases[0].key, '5A');
    assert.equal(c.withoutSolution.length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the storage path of a file has no umlaut, no space and no soft hyphen', () => {
  const p = ascii('Nut­zung der Qualitätswerkzeuge für Maßnahmen');
  assert.match(p, /^[A-Za-z0-9_]+$/);
  assert.ok(p.includes('Massnahmen'.slice(0, 3)));
});

test('Part5a and Part5b are two scenario parts, not twice part 5', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-src-'));
  try {
    const enabler = path.join(
      root,
      '04_Entwickeln',
      'Enablers',
      '01_IT-Systeme konzeptionieren'
    );
    mkdirSync(path.join(enabler, 'Szenario parts'), { recursive: true });
    writeFileSync(
      path.join(enabler, '01_IT-Systeme konzeptionieren.docx'),
      'x'
    );
    for (const name of [
      'Part5b_Netzzugang_KORR.docx',
      'Part5a_Datenanalyse_KORR.docx',
      'Part4_Hardware_KORR.docx',
    ]) {
      writeFileSync(path.join(enabler, 'Szenario parts', name), 'x');
    }
    const [c] = readSource(root);
    const parts = c.enablers[0].parts;
    assert.deepEqual(
      parts.map(p => `${p.n}${p.sfx}`),
      ['4', '5a', '5b']
    );
    assert.equal(parts[1].slug, 'Datenanalyse_KORR');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a rollback needs no storage host, a real run does', () => {
  const rollback = parseArgs([
    'rollback',
    'report.json',
    '--target',
    'preview',
    '--apply',
  ]);
  assert.equal(rollback.errors.length, 0);
  const run = parseArgs(['run', 'src', '--target', 'preview', '--apply']);
  assert.ok(run.errors.some(e => /confirm-storage-host/.test(e)));
});
