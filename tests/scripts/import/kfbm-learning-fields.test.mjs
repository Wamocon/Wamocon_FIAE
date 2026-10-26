// Tests for scripts/import/kfbm-learning-fields.mjs (plan, check, dry run and
// real run of the learning field import). The table and the folder are invented
// and built here, no original file of the source is used or copied. Nothing here
// talks to a real database: the refusals happen before the first connection, and
// the one test that opens a connection points at a closed port on the loopback
// address.
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
// JSZip builds the invented workbook and pg opens the one connection. The
// workflow db-checks runs these tests without installed dependencies, then the
// tests that need them are skipped.
const JSZip = await import('jszip').then(
  module => module.default,
  () => null
);
const hasPg = await import('pg').then(
  () => true,
  () => false
);
const needsZip = { skip: JSZip ? false : 'jszip is not installed' };
const needsBoth = {
  skip: JSZip && hasPg ? false : 'jszip or pg is not installed',
};
import { main } from '../../../scripts/import/kfbm-learning-fields.mjs';

/** Rows of the invented table: [row, A, B, C, D, E]. */
const ROWS = [
  [2, null, 'Erfundene Überschrift'],
  [4, 'Komponente', 'Position', 'Schuljahr 1', 'Schuljahr 2', 'Schuljahr 3'],
  [
    5,
    '1. nformationsmanagement erfunden \r\n(§ 4 Absatz 2 Nummer 1)',
    'a) erste',
    'LF2,3',
    null,
    'LF 12',
  ],
  [6, null, 'b) zweite', 'LF 2', 'nur betrieblich'],
  [7, '2. Erfundenes Zweites\r\n(§ 4 Absatz 2 Nummer 2)', 'a) dritte', 'LF 9'],
  [8, 'Abschnitt B: Wahl', null],
  [9, '9. Ausgeschlossen\r\n(§ 4 Absatz 3 Nummer 9)', 'a) vierte', 'LF 4'],
  [
    10,
    '8. Erfundene Organisation\r\n(§ 4 Absatz 3 Nummer 8)',
    'a) fünfte',
    'alle Lernfelder',
    'alle Lernfelder',
    'alle Lernfelder',
  ],
  [11, null, 'b) sechste', null, 'nur betr./beh.'],
];

async function workbook(rows = ROWS) {
  const shared = [];
  const at = text => {
    const found = shared.indexOf(text);
    if (found >= 0) return found;
    shared.push(text);
    return shared.length - 1;
  };
  const esc = text =>
    text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const sheetRows = rows
    .map(([n, ...cells]) => {
      const body = cells
        .map((value, i) =>
          value === null || value === undefined
            ? ''
            : `<c r="${'ABCDE'[i]}${n}" t="s"><v>${at(value)}</v></c>`
        )
        .join('');
      return `<row r="${n}">${body}</row>`;
    })
    .join('');
  const zip = new JSZip();
  zip.file(
    'xl/workbook.xml',
    '<workbook xmlns:r="x"><sheets><sheet name="Tabelle1" sheetId="1" r:id="rId1"/></sheets></workbook>'
  );
  zip.file(
    'xl/_rels/workbook.xml.rels',
    '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'
  );
  zip.file(
    'xl/worksheets/sheet1.xml',
    `<worksheet><sheetData>${sheetRows}</sheetData></worksheet>`
  );
  zip.file(
    'xl/sharedStrings.xml',
    `<sst>${shared.map(s => `<si><t xml:space="preserve">${esc(s)}</t></si>`).join('')}</sst>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

const IMPORT_PLAN = {
  components: [
    { code: 'K1', reference: '§ 4 Abs. 2 Nr. 1' },
    { code: 'K2', reference: '§ 4 Abs. 2 Nr. 2' },
    { code: 'K17', reference: '§ 4 Abs. 3 Nr. 8' },
  ],
  enablers: [
    { code: 'K1-a' },
    { code: 'K1-b' },
    { code: 'K17-a' },
    { code: 'K17-b' },
  ],
};

/** Runs main in this process and collects what it prints. */
async function run(argv, env = {}) {
  const lines = { out: [], err: [] };
  const log = console.log;
  const error = console.error;
  console.log = (...a) => lines.out.push(a.join(' '));
  console.error = (...a) => lines.err.push(a.join(' '));
  try {
    const status = await main(argv, env);
    return { status, out: lines.out.join('\n'), err: lines.err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
}

function folder() {
  return mkdtempSync(path.join(tmpdir(), 'kfbm-lf-'));
}

async function setup(dir) {
  const excel = path.join(dir, 'mapping.xlsx');
  writeFileSync(excel, await workbook());
  const importPlan = path.join(dir, 'import-plan.json');
  writeFileSync(importPlan, JSON.stringify(IMPORT_PLAN));
  return { excel, importPlan };
}

test(
  'plan: reads the invented table and writes the plan and a summary without cell text',
  needsZip,
  async () => {
    const dir = folder();
    try {
      const { excel, importPlan } = await setup(dir);
      const out = path.join(dir, 'kfbm-plan-lf.json');
      const result = await run([
        'plan',
        excel,
        '--import-plan',
        importPlan,
        '--out',
        out,
      ]);
      assert.equal(result.status, 0, result.err);
      const plan = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(plan.catalog, 'KFBM');
      assert.equal(plan.learningFields.length, 13);
      assert.equal(plan.source.sheet, 'Tabelle1');
      assert.deepEqual(
        plan.mappings
          .filter(m => m.enablerCode === 'K1-a')
          .map(m => [m.learningFieldCode, m.schoolYear]),
        [
          ['LF2', 1],
          ['LF3', 1],
          ['LF12', 3],
        ]
      );
      // K17 is section B number 8: 13 learning fields through "alle Lernfelder"
      assert.equal(
        plan.mappings.filter(m => m.enablerCode === 'K17-a').length,
        13
      );
      assert.deepEqual(
        plan.skipped.map(s => [s.row, s.code]),
        [
          [7, 'ENABLER_NOT_IN_IMPORT'],
          [9, 'COMPONENT_EXCLUDED'],
        ]
      );
      assert.equal(plan.notes[0].code, 'COMPANY_ONLY');
      const md = readFileSync(path.join(dir, 'kfbm-plan-lf.md'), 'utf8');
      for (const word of [
        'erste',
        'zweite',
        'dritte',
        'fünfte',
        'Erfundene',
        'Ausgeschlossen',
      ]) {
        assert.ok(!md.includes(word), word);
      }
      assert.ok(md.includes('ENABLER_NOT_IN_IMPORT'));
      assert.ok(!/[–—]/.test(md));
      assert.match(result.out, /"mappings":/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  'plan: takes the import codes from the names of a source folder (no content is read)',
  needsZip,
  async () => {
    const dir = folder();
    try {
      const { excel } = await setup(dir);
      const source = path.join(dir, 'Komponente');
      const T1 =
        'Komponente Teil 1 (1-15 Monate)/01 - Erfunden (§ 4 Abs. 2 Nr. 1)';
      for (const rel of [
        `${T1}/Enablers/1a_Thema/1a_Thema.docx`,
        `${T1}/Enablers/1b_Thema/1b_Thema.docx`,
      ]) {
        const full = path.join(source, ...rel.split('/'));
        mkdirSync(path.dirname(full), { recursive: true });
        // not a Word document: a plan from names must not open it
        writeFileSync(full, 'kein Dokument');
      }
      const out = path.join(dir, 'plan.json');
      const result = await run([
        'plan',
        excel,
        '--import-source',
        source,
        '--out',
        out,
      ]);
      assert.equal(result.status, 0, result.err);
      const plan = JSON.parse(readFileSync(out, 'utf8'));
      assert.deepEqual(
        [...new Set(plan.mappings.map(m => m.enablerCode))],
        ['K1-a', 'K1-b']
      );
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  'plan: titles from the source list are marked provisional, titles of the owner are not',
  needsZip,
  async () => {
    const dir = folder();
    try {
      const { excel, importPlan } = await setup(dir);
      const csv = path.join(dir, 'quellen.csv');
      writeFileSync(
        csv,
        '﻿ID;Titel;LF;Quellen\r\n1a;x;LF1;"B (1. AJ), LF1 ""Erfunden Eins"": Kap. 1"\r\n'
      );
      const out = path.join(dir, 'a.json');
      const first = await run([
        'plan',
        excel,
        '--import-plan',
        importPlan,
        '--titles',
        csv,
        '--out',
        out,
      ]);
      assert.equal(first.status, 0, first.err);
      const fromCsv = JSON.parse(readFileSync(out, 'utf8'));
      assert.deepEqual(
        [
          fromCsv.learningFields[0].titleSource,
          fromCsv.learningFields[0].titleProvisional,
        ],
        ['csv', true]
      );

      const json = path.join(dir, 'titel.json');
      writeFileSync(
        json,
        JSON.stringify(
          Object.fromEntries(
            Array.from({ length: 13 }, (_v, i) => [
              `LF${i + 1}`,
              `Titel ${i + 1}`,
            ])
          )
        )
      );
      const out2 = path.join(dir, 'b.json');
      const second = await run([
        'plan',
        excel,
        '--import-plan',
        importPlan,
        '--titles',
        json,
        '--out',
        out2,
      ]);
      assert.equal(second.status, 0, second.err);
      const fromJson = JSON.parse(readFileSync(out2, 'utf8'));
      assert.ok(
        fromJson.learningFields.every(
          f => f.titleSource === 'json' && !f.titleProvisional
        )
      );

      const bad = path.join(dir, 'titel.txt');
      writeFileSync(bad, 'x');
      const third = await run([
        'plan',
        excel,
        '--import-plan',
        importPlan,
        '--titles',
        bad,
      ]);
      assert.equal(third.status, 2);
      assert.match(third.err, /\.json or \.csv/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test('plan: refuses a missing table, a damaged table and missing import codes', async () => {
  const dir = folder();
  try {
    const missing = await run([
      'plan',
      path.join(dir, 'gibt-es-nicht.xlsx'),
      '--import-plan',
      path.join(dir, 'x.json'),
    ]);
    assert.equal(missing.status, 2);
    assert.match(missing.err, /cannot be read/);

    const damaged = path.join(dir, 'kaputt.xlsx');
    writeFileSync(damaged, 'kein zip');
    const plan = path.join(dir, 'p.json');
    writeFileSync(plan, '{}');
    const result = await run(['plan', damaged, '--import-plan', plan]);
    assert.equal(result.status, 2);
    assert.match(result.err, /cannot be read/);

    const usage = await run(['plan', damaged]);
    assert.equal(usage.status, 2);
    assert.match(usage.err, /--import-plan/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'plan: an import plan that is not valid JSON stops with a message',
  needsZip,
  async () => {
    const dir = folder();
    try {
      const { excel } = await setup(dir);
      const broken = path.join(dir, 'broken.json');
      writeFileSync(broken, '{kaputt');
      const result = await run(['plan', excel, '--import-plan', broken]);
      assert.equal(result.status, 2);
      assert.match(result.err, /import plan .* cannot be read/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

const PLAN = ['--plan', 'p.json'];

test('run refuses production in every form', async () => {
  for (const extra of [
    ['--target', 'production'],
    ['--target', 'production', '--apply'],
    ['--target', 'local', '--confirm-production', 'db.example.com'],
  ]) {
    const result = await run(['run', ...PLAN, ...extra], {
      DB_CONNECTION_STRING: 'postgresql://postgres:pw@127.0.0.1:1/postgres',
    });
    assert.equal(result.status, 2);
    assert.match(result.err, /Production is not supported/);
  }
});

test('run needs a target and a connection from the environment', async () => {
  const noTarget = await run(['run', ...PLAN]);
  assert.equal(noTarget.status, 2);
  assert.match(noTarget.err, /--target local\|preview is required/);

  const noEnv = await run(['run', ...PLAN, '--target', 'local'], {});
  assert.equal(noEnv.status, 2);
  assert.match(noEnv.err, /DB_CONNECTION_STRING is not set/);
});

test('a foreign host is refused before any connection is opened, and no secret is printed', async () => {
  const secret = 'Zugangs-Geheimnis-123';
  const env = {
    DB_CONNECTION_STRING: `postgresql://postgres:${secret}@db.example.com:5432/postgres`,
  };
  const local = await run(
    ['run', ...PLAN, '--target', 'local', '--apply'],
    env
  );
  assert.equal(local.status, 1);
  assert.match(local.err, /needs a loopback host/);

  const confirm = await run(
    [
      'run',
      ...PLAN,
      '--target',
      'preview',
      '--apply',
      '--confirm-host',
      'other.example.com',
    ],
    env
  );
  assert.equal(confirm.status, 1);
  assert.match(confirm.err, /must name the host/);

  for (const text of [local.out, local.err, confirm.out, confirm.err]) {
    assert.ok(!text.includes(secret));
  }
});

test('a connection string that overrides the host with a parameter is refused', async () => {
  for (const query of [
    '?host=remote.example.invalid&sslmode=disable',
    '?options=-c%20search_path%3Dpublic',
    '?user=postgres',
  ]) {
    const result = await run(['check', ...PLAN, '--target', 'local'], {
      DB_CONNECTION_STRING: `postgresql://postgres:pw@localhost:5432/postgres${query}`,
    });
    assert.equal(result.status, 1);
    assert.match(result.err, /not accepted/);
  }
});

test('preview with a loopback host is refused', async () => {
  const result = await run(['check', ...PLAN, '--target', 'preview'], {
    DB_CONNECTION_STRING: 'postgresql://postgres:pw@127.0.0.1:1/postgres',
  });
  assert.equal(result.status, 1);
  assert.match(result.err, /loopback host, that is not the Preview/);
});

test('an invalid plan is refused before the connection is opened', async () => {
  const dir = folder();
  try {
    const planFile = path.join(dir, 'plan.json');
    writeFileSync(
      planFile,
      JSON.stringify({
        version: 1,
        catalog: 'FIAE',
        learningFields: [],
        mappings: [],
        skipped: [],
      })
    );
    const result = await run(
      ['run', '--plan', planFile, '--target', 'local', '--apply'],
      { DB_CONNECTION_STRING: 'postgresql://postgres:pw@127.0.0.1:1/postgres' }
    );
    assert.equal(result.status, 1);
    assert.match(result.err, /Plan problem: The plan catalog must be KFBM/);
    assert.match(result.err, /Nothing was done/);
    assert.ok(!/connection failed/.test(result.err));

    const missing = await run(
      ['run', '--plan', path.join(dir, 'nein.json'), '--target', 'local'],
      { DB_CONNECTION_STRING: 'postgresql://postgres:pw@127.0.0.1:1/postgres' }
    );
    assert.equal(missing.status, 2);
    assert.match(missing.err, /plan file .* cannot be read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'a failing connection is reported without the password',
  needsBoth,
  async () => {
    const dir = folder();
    try {
      const { excel, importPlan } = await setup(dir);
      const planFile = path.join(dir, 'plan.json');
      const made = await run([
        'plan',
        excel,
        '--import-plan',
        importPlan,
        '--out',
        planFile,
      ]);
      assert.equal(made.status, 0, made.err);
      const secret = 'Geheim-Passwort-456';
      const result = await run(
        ['check', '--plan', planFile, '--target', 'local'],
        {
          DB_CONNECTION_STRING: `postgresql://postgres:${secret}@127.0.0.1:1/postgres`,
        }
      );
      assert.equal(result.status, 1);
      assert.match(result.err, /the connection failed/);
      assert.ok(!result.err.includes(secret));
      assert.ok(!result.out.includes(secret));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test('the script sources read no env file, call no model and no network, and have no delete', () => {
  for (const file of [
    'scripts/import/kfbm-learning-fields.mjs',
    'scripts/import/kfbm-learning-fields-modules.mjs',
    'scripts/import/kfbm-session.mjs',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!/dotenv/.test(source), `${file}: dotenv`);
    assert.ok(!/\.env\.local/.test(source), `${file}: .env.local`);
    assert.ok(!/\bfetch\s*\(/.test(source), `${file}: fetch`);
    assert.ok(
      !/node:(http|https|net|dgram)/.test(source),
      `${file}: network module`
    );
    assert.ok(
      !/openai|anthropic|gemini|embedding/i.test(source),
      `${file}: model`
    );
    assert.ok(!/child_process|spawn|exec\(/.test(source), `${file}: process`);
  }
  for (const file of [
    'src/lib/content-import/learning-fields/engine.ts',
    'src/lib/content-import/learning-fields/job.ts',
    'src/lib/content-import/learning-fields/xlsx-sheet.ts',
    'src/lib/content-import/learning-fields/plan.ts',
  ]) {
    const source = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(
      !/\b(delete\s+from|truncate|drop\s+(table|schema)|alter\s+table)\b/i.test(
        source
      ),
      `${file}: destructive SQL`
    );
    assert.ok(
      !/from 'node:fs'|require\('fs'\)/.test(source),
      `${file}: file access`
    );
  }
});

test(
  'the command line works end to end for plan and refuses production',
  needsZip,
  async () => {
    const dir = folder();
    try {
      const { excel, importPlan } = await setup(dir);
      const out = path.join(dir, 'plan.json');
      const run1 = spawnSync(
        process.execPath,
        [
          'scripts/import/kfbm-learning-fields.mjs',
          'plan',
          excel,
          '--import-plan',
          importPlan,
          '--out',
          out,
        ],
        { encoding: 'utf8' }
      );
      assert.equal(run1.status, 0, run1.stderr);
      assert.ok(existsSync(out));
      assert.ok(!/Warning/.test(run1.stderr), run1.stderr);

      const refused = spawnSync(
        process.execPath,
        [
          'scripts/import/kfbm-learning-fields.mjs',
          'run',
          '--plan',
          out,
          '--target',
          'production',
        ],
        { encoding: 'utf8', env: { ...process.env, DB_CONNECTION_STRING: '' } }
      );
      assert.equal(refused.status, 2);
      assert.match(refused.stderr, /Production is not supported/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);
