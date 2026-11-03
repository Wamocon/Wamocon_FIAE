// Tests for scripts/import/fiae-documents.mjs (FIAE documents of the Word delivery into the Preview).
// The folder tree is invented, no original file of the source is used or copied.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

import { FINAL_LISTING, OLD_LISTING } from './fiae-listing.mjs';

const mod = await import('../../../scripts/import/fiae-documents.mjs');
const {
  parseArgs,
  similarity,
  matchEnablers,
  mapComponents,
  keyOfUseCaseFile,
  readSource,
  ascii,
  topicOf,
  docTitleOf,
  sameTopic,
  newScenarioTitle,
  scenarioTitleFix,
  planEnablerOrder,
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
    ['5', '13']
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

test('a task version with a solution part is recognized, one without is not', async t => {
  let JSZip;
  try {
    ({ default: JSZip } = await import('jszip'));
  } catch {
    t.skip('jszip is not installed');
    return;
  }
  const { hasSolutionPart } = await import('../../../scripts/import/fiae-documents.mjs');
  const docx = async paragraphs => {
    const zip = new JSZip();
    zip.file(
      'word/document.xml',
      `<w:document><w:body>${paragraphs.map(x => `<w:p><w:r><w:t>${x}</w:t></w:r></w:p>`).join('')}</w:body></w:document>`
    );
    return zip.generateAsync({ type: 'nodebuffer' });
  };
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-task-'));
  try {
    writeFileSync(path.join(root, 'task.docx'), await docx(['Ausgangslage:', 'Aufgabenstellung:', 'Weg zum Ziel:']));
    writeFileSync(path.join(root, 'sol.docx'), await docx(['Ausgangslage:', 'Musterlösung', 'Zu 1. Planung']));
    assert.equal(await hasSolutionPart(path.join(root, 'task.docx')), false);
    assert.equal(await hasSolutionPart(path.join(root, 'sol.docx')), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------- numbering of the folders (02.11.2026)

/** A folder tree: per order index the folder name, one enabler with a scenario part and a use case. */
function writeTree(root, names) {
  const dirs = {};
  for (const [nr, name] of Object.entries(names)) {
    const comp = path.join(root, name);
    const enabler = path.join(comp, 'Enablers', '01_Grundlagen');
    mkdirSync(path.join(enabler, 'Szenario parts'), { recursive: true });
    writeFileSync(path.join(enabler, '01_Grundlagen.docx'), `main ${nr}`);
    writeFileSync(
      path.join(enabler, 'Szenario parts', 'Part1_eins.docx'),
      `part ${nr}`
    );
    mkdirSync(path.join(comp, 'Use_Cases'), { recursive: true });
    writeFileSync(
      path.join(comp, 'Use_Cases', '1a_Use-Case_A.docx'),
      `uc ${nr}`
    );
    dirs[nr] = comp;
  }
  return dirs;
}

/** What a plan sees of a source: component, enablers, parts and use cases, without the folder names. */
const shape = comps =>
  comps.map(c => ({
    nr: c.nr,
    key: c.key,
    enablers: c.enablers.map(e => [
      e.key,
      e.parts.map(p => p.n),
      e.main !== null,
    ]),
    useCases: c.useCases.map(u => u.key),
  }));

test('the old and the final folder names lead to the same plan', () => {
  const oldRoot = mkdtempSync(path.join(tmpdir(), 'fiae-old-'));
  const newRoot = mkdtempSync(path.join(tmpdir(), 'fiae-new-'));
  try {
    // order index -> name: 1 and 7 single, 2 and 13 a pair, 19 Speicherlösungen, 26 Umweltschutz
    writeTree(oldRoot, {
      1: '01_Planen',
      2: '02_Informieren und Beraten',
      7: '07_Erbringen',
      13: '13_Informieren und Beraten (Vertiefung)',
      19: '19_Inbetriebnehmen von Speicherlösungen',
      26: '26_Umweltschutz',
    });
    writeTree(newRoot, {
      1: '01_Planen',
      2: '02.1_Informieren und Beraten',
      7: '07_Erbringen',
      13: '02.2_Informieren und Beraten (Vertiefung)',
      19: '13_Inbetriebnehmen von Speicherlösungen',
      26: '17_Umweltschutz',
    });
    const a = readSource(oldRoot);
    const b = readSource(newRoot);
    assert.deepEqual(shape(a), shape(b));
    assert.deepEqual(
      a.map(c => c.nr),
      [1, 2, 7, 13, 19, 26]
    );
    assert.deepEqual(
      a.map(c => c.scheme),
      Array(6).fill('old')
    );
    assert.deepEqual(
      b.map(c => c.scheme),
      Array(6).fill('new')
    );
    // the reports name the label and, in brackets, the folder number of the delivery
    assert.equal(a[3].name, '2.2 (Ordner 13)');
    assert.equal(b[3].name, '2.2 (Ordner 02.2)');
    assert.equal(a[4].name, '13 (Ordner 19)');
    assert.equal(b[4].name, '13 (Ordner 13)');
    assert.equal(b[5].name, '17 (Ordner 17)');
  } finally {
    rmSync(oldRoot, { recursive: true, force: true });
    rmSync(newRoot, { recursive: true, force: true });
  }
});

test('"13_" is a Vertiefung in an old delivery and Speicherlösungen in a final one', () => {
  const oldRoot = mkdtempSync(path.join(tmpdir(), 'fiae-old-'));
  const newRoot = mkdtempSync(path.join(tmpdir(), 'fiae-new-'));
  try {
    mkdirSync(path.join(oldRoot, '13_Foo'));
    mkdirSync(path.join(newRoot, '13_Foo'));
    mkdirSync(path.join(newRoot, '02.1_Bar'));
    assert.deepEqual(
      readSource(oldRoot).map(c => [c.nr, c.key]),
      [[13, '13']]
    );
    assert.deepEqual(
      readSource(newRoot).map(c => [c.nr, c.key]),
      [
        [2, '02'],
        [19, '19'],
      ]
    );
  } finally {
    rmSync(oldRoot, { recursive: true, force: true });
    rmSync(newRoot, { recursive: true, force: true });
  }
});

test('a folder of the final numbering is matched to its course', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-mix-'));
  try {
    writeTree(root, {
      2: '02.1_Informieren und Beraten von Kunden (§4 Absatz 2 Nr 2)',
      13: '02.2_Informieren und Beraten von Kunden und Kundinnen',
    });
    const comps = readSource(root);
    assert.deepEqual(
      comps.map(c => c.key),
      ['02', '13']
    );
    const { map, problems } = mapComponents(comps, [
      {
        id: 'a',
        title: 'Informieren und Beraten von Kunden (§ 4 Abs. 2 Nr. 2)',
      },
      {
        id: 'b',
        title:
          'Informieren und Beraten von Kunden (Vertiefung) (§ 4 Abs. 2 Nr. 2 J2)',
      },
    ]);
    assert.deepEqual(problems, []);
    assert.equal(map.get(2).id, 'a');
    assert.equal(map.get(13).id, 'b');
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('the final listing of 26 folders is read completely, the old listing too', () => {
  const finalRoot = mkdtempSync(path.join(tmpdir(), 'fiae-final-'));
  const oldRoot = mkdtempSync(path.join(tmpdir(), 'fiae-old26-'));
  try {
    for (const name of FINAL_LISTING) mkdirSync(path.join(finalRoot, name));
    for (const name of OLD_LISTING) mkdirSync(path.join(oldRoot, name));
    const all = Array.from({ length: 26 }, (_, i) => i + 1);
    const f = readSource(finalRoot);
    const o = readSource(oldRoot);
    assert.deepEqual(
      f.map(c => c.nr),
      all
    );
    assert.deepEqual(
      o.map(c => c.nr),
      all
    );
    // the final names: 13 is order index 19, 17 is 26
    assert.equal(f[18].name, '13 (Ordner 13)');
    assert.equal(f[25].name, '17 (Ordner 17)');
    assert.equal(f[12].name, '2.2 (Ordner 02.2)');
  } finally {
    rmSync(finalRoot, { recursive: true, force: true });
    rmSync(oldRoot, { recursive: true, force: true });
  }
});

test('an unknown pattern, a mix of both numberings or two folders for one component stop the read with a message', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'fiae-bad-'));
  try {
    mkdirSync(path.join(root, '2.3_Falsch'));
    assert.throws(() => readSource(root), /not clear.*2\.3_Falsch/);
    rmSync(path.join(root, '2.3_Falsch'), { recursive: true });
    mkdirSync(path.join(root, '13.1_Falsch'));
    assert.throws(() => readSource(root), /13\.1_Falsch/);
    rmSync(path.join(root, '13.1_Falsch'), { recursive: true });
    // old plain numbers next to a dot notation: the delivery is final, so 09_ and 20_ are a mix
    mkdirSync(path.join(root, '02.1_Informieren'));
    mkdirSync(path.join(root, '09_Programmieren'));
    mkdirSync(path.join(root, '20_Programmieren (Vertiefung)'));
    assert.throws(
      () => readSource(root),
      /09_Programmieren.*not allowed in the final numbering.*20_Programmieren/
    );
    rmSync(path.join(root, '09_Programmieren'), { recursive: true });
    rmSync(path.join(root, '20_Programmieren (Vertiefung)'), {
      recursive: true,
    });
    mkdirSync(path.join(root, '2.1_Doppelt'));
    assert.throws(
      () => readSource(root),
      /Two folders for the component 2\.1 \(Ordner 02\.1\)/
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('--components keeps the tokens as typed and refuses a value that is no number', () => {
  assert.deepEqual(
    parseArgs([
      'run',
      'src',
      '--target',
      'preview',
      '--components',
      '2.1,2.2,5,13',
    ]).components,
    ['2.1', '2.2', '5', '13']
  );
  const bad = parseArgs([
    'run',
    'src',
    '--target',
    'preview',
    '--components',
    '2.3',
  ]);
  assert.ok(bad.errors.some(e => /--components/.test(e) && /2\.3/.test(e)));
});

// ---------------------------------------------------------------- enabler order and scenario titles

test('the topic of a scenario file comes from its first paragraph, a heading "Behandelte Themen" says nothing', () => {
  assert.equal(
    docTitleOf([
      '# Enabler Scenario: Software-Entwicklungsmodelle und Architekturen',
      'Fragenkomplex (Komponente) 4',
    ]),
    'Software-Entwicklungsmodelle und Architekturen'
  );
  assert.equal(
    docTitleOf(['Shells und Datentypen', 'Behandelte Themen']),
    'Shells und Datentypen'
  );
  assert.equal(docTitleOf(['Behandelte Themen:', 'Arbeitsschutz']), null);
  assert.equal(docTitleOf([]), null);
  assert.equal(topicOf('Part_KORRIGIERT'), 'Part');
  assert.equal(topicOf('KORRIGIERT'), '');
});

test('a shortened file name or a longer heading is the same topic, another topic is not', () => {
  assert.ok(sameTopic('Der Markt', 'Der Markt: Theorie, Modelle und Realität'));
  assert.ok(
    sameTopic('Systemnahe Grundlagen und Hardware', 'Systemnahe Grundlagen und Hard')
  );
  assert.ok(
    !sameTopic('Vertiefte Programmierkonzepte', 'Software-Entwicklungsmodelle')
  );
  assert.ok(!sameTopic('', 'Etwas'));
});

test('a row that shows the title of another topic gets the title of its file (K4 enabler 3, Part 7 to 9)', () => {
  const base = { number: 7, suffix: '', slug: 'Software-Entwicklungsmodelle' };
  // the file name alone shows that the title is wrong, the heading of the Word file is then needed
  assert.equal(
    scenarioTitleFix({ ...base, current: 'Szenario: Part 7: Vertiefte Programmierkonzepte' }),
    'READ_FILE'
  );
  assert.equal(
    scenarioTitleFix({
      ...base,
      current: 'Szenario: Part 7: Vertiefte Programmierkonzepte',
      docTitle: 'Software-Entwicklungsmodelle und Architekturen',
    }),
    'Szenario: Part 7: Software-Entwicklungsmodelle und Architekturen'
  );
  // a title that fits the file name stays, without reading the file
  assert.equal(
    scenarioTitleFix({ ...base, current: 'Szenario: Part 7: Software-Entwicklungsmodelle' }),
    null
  );
  // a file name that says nothing (Part4_KORRIGIERT) is decided by the heading
  const bare = { number: 4, suffix: '', slug: 'KORRIGIERT' };
  assert.equal(
    scenarioTitleFix({ ...bare, current: 'Szenario: Part 4: Alt', docTitle: 'Systemstart und Partitionierung' }),
    'Szenario: Part 4: Systemstart und Partitionierung'
  );
  assert.equal(
    scenarioTitleFix({ ...bare, current: 'Szenario: Part 4: Systemstart', docTitle: 'Systemstart und Partitionierung' }),
    null
  );
  // no topic anywhere: the title is left alone
  assert.equal(
    scenarioTitleFix({ ...bare, current: 'Szenario: Part 4: Alt', docTitle: null }),
    null
  );
  // the letter of a part (5a) stays in the title
  assert.equal(
    scenarioTitleFix({ number: 5, suffix: 'a', slug: 'Datenanalyse_KORR', current: 'Szenario: Part 5a: Netz', docTitle: undefined }),
    'READ_FILE'
  );
});

test('a new scenario part gets the full heading when the file name is a shortened form of it', () => {
  assert.equal(
    newScenarioTitle({ number: 3, suffix: '', slug: 'Spezialthema_Künstliche_Intell', docTitle: 'Spezialthema Künstliche Intelligenz' }),
    'Szenario: Part 3: Spezialthema Künstliche Intelligenz'
  );
  assert.equal(
    newScenarioTitle({ number: 4, suffix: '', slug: 'Korrigiert', docTitle: 'Strategische Entscheidungen' }),
    'Szenario: Part 4: Strategische Entscheidungen'
  );
  assert.equal(
    newScenarioTitle({ number: 2, suffix: 'b', slug: 'Netzzugang_KORR', docTitle: null }),
    'Szenario: Part 2b: Netzzugang'
  );
});

test('an enabler whose folder number differs is moved (Peer 2 Peer on 13 instead of 04)', () => {
  const folders = [
    { nr: 1, folder: '01_a' },
    { nr: 2, folder: '02_b' },
    { nr: 3, folder: '03_c' },
    { nr: 4, folder: '04_Peer' },
    { nr: 5, folder: '05_d' },
    { nr: 13, folder: '13_Handbuch' },
  ];
  const db = [
    { id: 'a', order_index: 1 },
    { id: 'b', order_index: 2 },
    { id: 'c', order_index: 3 },
    { id: 'd', order_index: 5 },
    { id: 'p', order_index: 13 },
    { id: 'h', order_index: 14 },
  ];
  const ids = ['a', 'b', 'c', 'p', 'd', 'h'];
  const matched = new Map(
    ids.map((id, i) => [i, { e: db.find(x => x.id === id), how: 'title' }])
  );
  const plan = planEnablerOrder(folders, matched, db);
  assert.equal(plan.clear, true);
  assert.deepEqual(
    plan.fixes.map(f => [f.enabler.id, f.from, f.to]),
    [
      ['p', 13, 4],
      ['h', 14, 13],
    ]
  );
  // nothing to do when the order is right
  const same = planEnablerOrder(
    folders.slice(0, 3),
    new Map([0, 1, 2].map(i => [i, { e: db[i], how: 'title' }])),
    db.slice(0, 3)
  );
  assert.deepEqual(same, { clear: true, why: null, fixes: [] });
});

test('the order is not touched when two folders carry one number or when it would clash', () => {
  const dup = planEnablerOrder(
    [
      { nr: 5, folder: '05a_x' },
      { nr: 5, folder: '05b_y' },
    ],
    new Map(),
    []
  );
  assert.equal(dup.clear, false);
  assert.deepEqual(dup.fixes, []);
  // the folder wants number 2 for 'x', but a Preview enabler that is not in the folder holds it
  const db = [
    { id: 'x', order_index: 7 },
    { id: 'other', order_index: 2 },
  ];
  const clash = planEnablerOrder(
    [{ nr: 2, folder: '02_x' }],
    new Map([[0, { e: db[0], how: 'title' }]]),
    db
  );
  assert.equal(clash.clear, false);
  assert.deepEqual(clash.fixes, []);
});
