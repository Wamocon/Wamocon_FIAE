// Tests for scripts/import/kfbm-inventory.mjs (pure logic and the folder walk,
// no network, no database). All paths and sizes are invented.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import {
  EXPECTED,
  buildInventory,
  renderSummary,
} from '../../../scripts/import/kfbm-inventory.mjs';
import {
  isPlaceholderAttr,
  walkSource,
} from '../../../scripts/import/kfbm-source.mjs';

const T1 =
  'Komponente Teil 1 (1-15 Monate)/01 - Informationsmanagement anwenden (§ 4 Abs. 2 Nr. 1)';
const T2 =
  'Komponente Teil 2 (16-36 Monate)/06.2 - Auftragsbearbeitung durchführen (§ 4 Abs. 2 Nr. 6)';
const K18 =
  'Komponente Teil 2 (16-36 Monate)/18 - Verwaltung (§ 4 Abs. 3 Nr. 9)';
const WAHL =
  'Komponente Teil 2 (16-36 Monate)/12 - kaufmännische Abläufe (§ 4 Abs. 3 Nr. 3)';

const entry = (
  rel,
  size = 1000,
  mtime = '2026-08-01T10:00:00.000Z',
  placeholder = false
) => ({
  rel,
  size,
  mtimeMs: Date.parse(mtime),
  attributes: placeholder ? 0x400000 : 32,
  placeholder,
});

function fullEnabler(base, id, folder) {
  return [
    entry(`${base}/Enablers/${folder}/${id}.docx`, 5000),
    entry(`${base}/Enablers/${folder}/Quiz/${id}_Quiz_Low.docx`),
    entry(`${base}/Enablers/${folder}/Quiz/${id}_Quiz_Medium.docx`),
    entry(`${base}/Enablers/${folder}/Quiz/${id}_Quiz_High.docx`),
    entry(`${base}/Enablers/${folder}/Szenario/Szenario_${id}.docx`),
  ];
}

const tree = () => [
  ...fullEnabler(T1, '1a', '1a_Thema eins'),
  // 1b: two quizzes only, no scenario
  entry(`${T1}/Enablers/1b_Thema zwei/1b.docx`),
  entry(`${T1}/Enablers/1b_Thema zwei/Quiz/1b_Quiz_Low.docx`),
  entry(`${T1}/Enablers/1b_Thema zwei/Quiz/1b_Quiz_Medium.docx`),
  // 6d: two enabler texts (a duplicate) and one archive file
  entry(
    `${T2}/Enablers/6d_Auftrag/6d_Auftrag_v2.docx`,
    150000,
    '2026-10-23T10:00:00.000Z'
  ),
  entry(
    `${T2}/Enablers/6d_Auftrag/6d_Fehlzeiten_v3.docx`,
    650000,
    '2026-10-26T12:00:00.000Z',
    true
  ),
  entry(`${T2}/Enablers/6d_Auftrag/6d_Old_To_Delete.docx`, 200000),
  // an elective component and the excluded K18
  ...fullEnabler(WAHL, '12a', '12a) Buchungen'),
  entry(`${K18}/Enablers/18a) Kunden/18a).docx`),
  // global quizzes: the same one twice, a PDF and the overview
  entry(
    '00_Global_Quizze/Word/01_Global_Quiz_Informationsmanagement_anwenden.docx',
    320000,
    '2026-10-22T11:00:00.000Z'
  ),
  entry(
    `${T1}/Global Quiz/01_Global_Quiz_Informationsmanagement_anwenden.docx`,
    330000,
    '2026-10-22T12:00:00.000Z'
  ),
  entry(
    '00_Global_Quizze/PDF/06.2_Global_Quiz_Auftragsbearbeitung_durchführen.pdf',
    90000
  ),
  entry('00_Global_Quizze/00_Uebersicht_Global_Quizze.md', 11415),
  // files that fit no scheme
  entry(`${T1}/Enablers/1a_Thema eins/Quiz/Fragen_final.docx`),
  entry('Sonstiges/notiz.docx'),
];

test('placeholder attributes are recognized', () => {
  assert.equal(isPlaceholderAttr(0x400000), true);
  assert.equal(isPlaceholderAttr(0x40000), true);
  assert.equal(isPlaceholderAttr(0x1000), true);
  assert.equal(isPlaceholderAttr(32), false);
  assert.equal(isPlaceholderAttr(null), false);
});

test('the expected numbers are those of the plan', () => {
  assert.deepEqual(EXPECTED, {
    components: 27,
    enablers: 226,
    scenarios: 226,
    globalQuizzes: 27,
    electives: 9,
    quizzes: 678,
  });
});

test('counts unique keys, K18 stays out of the totals', () => {
  const inv = buildInventory(tree());
  assert.equal(inv.totals.files, 23);
  assert.deepEqual(inv.counts, {
    components: 3,
    enablers: 4,
    enablerIds: 4,
    scenarios: 2,
    quizzes: 8,
    globalQuizzes: 1,
    electives: 1,
    useCases: 0,
    globalQuizPdfs: 1,
  });
  assert.equal(inv.excluded.files, 1);
  assert.deepEqual(inv.excluded.components, ['18']);
});

test('compares the counts with the expected values', () => {
  const inv = buildInventory(tree());
  const row = name => inv.expectations.find(r => r.name === name);
  assert.deepEqual(row('enablers'), {
    name: 'enablers',
    expected: 226,
    actual: 4,
    ok: false,
  });
  const small = buildInventory(tree(), {
    expected: {
      components: 3,
      enablers: 4,
      scenarios: 2,
      globalQuizzes: 1,
      electives: 1,
      quizzes: 8,
    },
  });
  assert.ok(small.expectations.every(r => r.ok));
});

test('lists missing blocks per enabler', () => {
  const inv = buildInventory(tree());
  const byId = Object.fromEntries(inv.missing.map(m => [m.enablerKey, m]));
  assert.deepEqual(Object.keys(byId).sort(), ['1b', '6.2d']);
  assert.deepEqual(byId['6.2d'].missing, [
    'quiz:low',
    'quiz:medium',
    'quiz:high',
    'scenario',
  ]);
  assert.deepEqual(byId['1b'].missing, ['quiz:high', 'scenario']);
});

test('an enabler that has only an archive or only a text counts as missing blocks', () => {
  const only = buildInventory([
    entry(`${T1}/Enablers/1c_Nur Text/1c.docx`),
    entry(`${T1}/Enablers/1d_Nur Szenario/Szenario/Szenario_1d.docx`),
  ]);
  const byId = Object.fromEntries(only.missing.map(m => [m.enablerKey, m]));
  assert.deepEqual(byId['1c'].missing, [
    'quiz:low',
    'quiz:medium',
    'quiz:high',
    'scenario',
  ]);
  assert.deepEqual(byId['1d'].missing, [
    'enabler',
    'quiz:low',
    'quiz:medium',
    'quiz:high',
  ]);
});

test('a scenario file with an unrecognized name does not count as the scenario', () => {
  const inv = buildInventory([
    entry(`${T1}/Enablers/1e_Thema/1e.docx`),
    entry(`${T1}/Enablers/1e_Thema/Quiz/1e_Quiz_Low.docx`),
    entry(`${T1}/Enablers/1e_Thema/Quiz/1e_Quiz_Medium.docx`),
    entry(`${T1}/Enablers/1e_Thema/Quiz/1e_Quiz_High.docx`),
    entry(`${T1}/Enablers/1e_Thema/Szenario/Notizen.docx`),
  ]);
  assert.deepEqual(inv.missing, [
    { enablerKey: '1e', component: '01', missing: ['scenario'] },
  ]);
  assert.equal(inv.counts.scenarios, 0);
  assert.equal(inv.misfits.length, 1);
});

test('finds duplicates and recommends the newest version', () => {
  const inv = buildInventory(tree());
  const keys = inv.duplicates.map(d => d.key).sort();
  assert.deepEqual(keys, ['enabler:6.2d', 'global-quiz:01']);

  const enabler = inv.duplicates.find(d => d.key === 'enabler:6.2d');
  assert.equal(enabler.files.length, 2);
  assert.match(enabler.recommended, /6d_Fehlzeiten_v3\.docx$/);
  assert.equal(enabler.namesDiffer, true);
  assert.equal(enabler.sameSize, false);
  assert.deepEqual(
    enabler.files.map(f => f.size).sort((a, b) => a - b),
    [150000, 650000]
  );
  assert.ok(enabler.files.every(f => typeof f.mtime === 'string'));
  assert.match(enabler.reason, /v3/);

  const global = inv.duplicates.find(d => d.key === 'global-quiz:01');
  assert.match(global.recommended, /^Komponente Teil 1/);
  assert.equal(global.namesDiffer, false);
});

test('archive files are listed apart and never duplicates', () => {
  const inv = buildInventory(tree());
  assert.equal(inv.archive.length, 1);
  assert.match(inv.archive[0], /Old_To_Delete/);
  assert.ok(!inv.duplicates.some(d => d.files.some(f => /Old_To/.test(f.rel))));
});

test('lists files that fit no scheme with their reasons', () => {
  const inv = buildInventory(tree());
  const byRel = Object.fromEntries(inv.misfits.map(m => [m.rel, m.issues]));
  assert.deepEqual(Object.keys(byRel).length, 2);
  assert.ok(
    byRel[`${T1}/Enablers/1a_Thema eins/Quiz/Fragen_final.docx`].includes(
      'file-name-unrecognized'
    )
  );
  assert.ok(byRel['Sonstiges/notiz.docx'].includes('unknown-group'));
});

test('counts placeholders and groups the components', () => {
  const inv = buildInventory(tree());
  assert.equal(inv.totals.placeholders, 1);
  assert.equal(inv.totals.placeholderBytes, 650000);
  assert.equal(inv.totals.byExtension.docx, 21);
  assert.equal(inv.totals.byExtension.pdf, 1);
  const keys = inv.components.map(c => c.key);
  assert.deepEqual(keys, ['01', '06.2', '12', '18']);
  const k12 = inv.components.find(c => c.key === '12');
  assert.equal(k12.group, 'wahl');
  assert.equal(k12.elective, true);
  assert.deepEqual(k12.quizzes, { low: 1, medium: 1, high: 1 });
  const k01 = inv.components.find(c => c.key === '01');
  assert.equal(k01.title, 'Informationsmanagement anwenden');
  assert.equal(k01.enablers, 2);
  assert.equal(k01.scenarios, 1);
  assert.equal(k01.globalQuiz, true);
  assert.equal(inv.components.find(c => c.key === '18').excluded, true);
});

test('finds siblings that repeat a file name of the source (names and sizes only)', () => {
  const inv = buildInventory(tree(), {
    siblings: [
      {
        name: 'Szenarien',
        files: [
          { rel: 'Szenario_1a.docx', size: 1000, mtimeMs: 1 },
          { rel: 'Szenario_12a.docx', size: 777, mtimeMs: 1 },
          { rel: 'neu.docx', size: 1, mtimeMs: 1 },
        ],
      },
      { name: 'Excels', files: [], error: 'ENOENT' },
    ],
  });
  const folder = inv.siblings.find(s => s.name === 'Szenarien');
  assert.equal(folder.files, 3);
  assert.equal(folder.bytes, 1778);
  assert.equal(folder.duplicates.length, 2);
  const a = folder.duplicates.find(d => /Szenario_1a/.test(d.rel));
  assert.equal(a.sameSize, true);
  const b = folder.duplicates.find(d => /Szenario_12a/.test(d.rel));
  assert.equal(b.sameSize, false);
  assert.equal(inv.siblings.find(s => s.name === 'Excels').error, 'ENOENT');
});

test('the summary has the sections, German text and no dash as punctuation', () => {
  const md = renderSummary(
    buildInventory(tree(), { siblings: [{ name: 'Quizze', files: [] }] })
  );
  for (const heading of [
    '## Erwartung und Ist',
    '## Je Komponente',
    '## Fehlende Bausteine',
    '## Dubletten',
    '## Passt in kein Schema',
    '## Platzhalter',
    '## Geschwisterordner',
  ]) {
    assert.ok(md.includes(heading), heading);
  }
  assert.ok(md.includes('226'));
  assert.ok(md.includes('6.2d'));
  assert.ok(!/[–—]/.test(md));
});

test('walkSource reads names, sizes and attributes without opening files', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-walk-'));
  try {
    mkdirSync(path.join(dir, 'Ordner mit Leerzeichen (1)', 'Unter'), {
      recursive: true,
    });
    writeFileSync(
      path.join(dir, 'Ordner mit Leerzeichen (1)', 'a.docx'),
      'abc'
    );
    writeFileSync(
      path.join(dir, 'Ordner mit Leerzeichen (1)', 'Unter', 'Größe.docx'),
      'abcdef'
    );
    const attributes = new Map([
      ['ordner mit leerzeichen (1)/a.docx', 0x400000],
      ['ordner mit leerzeichen (1)/unter/größe.docx', 32],
    ]);
    const entries = walkSource(dir, { attributes });
    assert.deepEqual(
      entries.map(e => [e.rel, e.size, e.placeholder]),
      [
        ['Ordner mit Leerzeichen (1)/Unter/Größe.docx', 6, false],
        ['Ordner mit Leerzeichen (1)/a.docx', 3, true],
      ]
    );
    const plain = walkSource(dir, { attributes: null });
    assert.ok(
      plain.every(e => e.attributes === null && e.placeholder === false)
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the command writes JSON and a summary next to it', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-cli-'));
  try {
    const base = path.join(
      dir,
      'Komponente Teil 1 (1-15 Monate)',
      '01 - Informationsmanagement anwenden (§ 4 Abs. 2 Nr. 1)',
      'Enablers',
      '1a_Thema'
    );
    mkdirSync(path.join(base, 'Quiz'), { recursive: true });
    writeFileSync(path.join(base, '1a.docx'), 'x');
    writeFileSync(path.join(base, 'Quiz', '1a_Quiz_Low.docx'), 'x');
    const out = path.join(dir, 'inventory.json');
    const run = spawnSync(
      process.execPath,
      [
        'scripts/import/kfbm-inventory.mjs',
        dir,
        '--out',
        out,
        '--no-attributes',
        '--no-siblings',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(run.status, 0, run.stderr);
    const json = JSON.parse(readFileSync(out, 'utf8'));
    assert.equal(json.totals.files, 2);
    assert.equal(json.counts.enablers, 1);
    assert.ok(existsSync(path.join(dir, 'inventory.md')));
    assert.match(
      readFileSync(path.join(dir, 'inventory.md'), 'utf8'),
      /Inventur/
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('the command stops with a message when the folder does not exist', () => {
  const run = spawnSync(
    process.execPath,
    [
      'scripts/import/kfbm-inventory.mjs',
      path.join(tmpdir(), 'gibt-es-nicht-kfbm'),
    ],
    { encoding: 'utf8' }
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /not a folder|does not exist/i);
});
