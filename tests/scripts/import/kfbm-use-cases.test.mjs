// Tests for scripts/import/kfbm-use-cases.mjs (plan, check, dry run and real run
// of the KfBM use case import). The documents are invented and built with JSZip,
// no original file of the source is used or copied. Nothing here talks to a real
// database: the refusals happen before the first connection, and the one test
// that opens a connection points at a closed port on the loopback address.
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
// JSZip builds the invented documents and pg opens the one connection. The
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
import {
  loadDecisions,
  loadSourceFiles,
  main,
} from '../../../scripts/import/kfbm-use-cases.mjs';
import { pathInfo } from '../../../scripts/import/kfbm-source.mjs';

const PROFILE = '11111111-2222-4333-8444-555555555555';
const T1 =
  'Komponente Teil 1 (1-15 Monate)/01 - Erfundenes Thema (§ 4 Abs. 2 Nr. 1)';
const T5 =
  'Komponente Teil 1 (1-15 Monate)/05 - Erfundene Kunden (§ 4 Abs. 2 Nr. 5)';
const K18 =
  'Komponente Teil 2 (16-36 Monate)/18 - Verwaltung (§ 4 Abs. 3 Nr. 9)';

const p = (text, bold = false) => ({ text, bold });

/** A table as paragraphs of one row each, written as w:tbl by docx(). */
const table = rows => ({ table: rows });

function useCaseParagraphs(code, { omit = [] } = {}) {
  return [
    p(`${code}) Erfundener Titel ${code}`),
    p('Behandelte Themen', true),
    p(`Erfundenes Thema ${code}.`),
    p('Ausgangssituation', true),
    p(`Die erfundene Firma ${code} hat ein Problem.`),
    p('Eckdaten', true),
    table([
      ['Posten', 'Menge'],
      ['Schrauben', '12'],
    ]),
    p('Zielsetzung', true),
    p('Erstellen Sie einen erfundenen Vorschlag.'),
    p('Weg zum Ziel', true),
    p('Erster Schritt: Daten erfassen.'),
    ...(omit.includes('solution')
      ? []
      : [
          p('Musterlösung', true),
          p(`Die erfundene Antwort OMEGA ${code} nennt zwölf Schrauben.`),
          table([
            ['Posten', 'Ergebnis'],
            ['Schrauben', `ZETA ${code}`],
          ]),
        ]),
  ];
}

const esc = text =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
const run1 = (text, bold) =>
  `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r>`;

async function docx(items) {
  const body = items
    .map(item =>
      item.table
        ? `<w:tbl>${item.table
            .map(
              (cells, r) =>
                `<w:tr>${cells
                  .map(cell => `<w:tc><w:p>${run1(cell, r === 0)}</w:p></w:tc>`)
                  .join('')}</w:tr>`
            )
            .join('')}</w:tbl>`
        : `<w:p>${item.text ? run1(item.text, item.bold) : ''}</w:p>`
    )
    .join('');
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function put(root, rel, items) {
  const full = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, await docx(items));
}

/** A small invented tree: two use cases, a broken one, a conflict pair, K18 and an enabler text. */
async function sampleSource(root) {
  await put(
    root,
    `${T1}/K1_Use-Cases/UC_1a_Aufgabe.docx`,
    useCaseParagraphs('1a')
  );
  await put(
    root,
    `${T1}/K1_Use-Cases/UC_1b_Aufgabe.docx`,
    useCaseParagraphs('1b')
  );
  await put(
    root,
    `${T1}/K1_Use-Cases/UC_1c_Aufgabe.docx`,
    useCaseParagraphs('1c', { omit: ['solution'] })
  );
  await put(
    root,
    `${T5}/K5_Use-Cases/UC_5b_Aufgabe.docx`,
    useCaseParagraphs('5b')
  );
  await put(
    root,
    `${T5}/K5_Use-Cases/Ohne Musterlösung/UC_5b_Aufgabe.docx`,
    useCaseParagraphs('5b', { omit: ['solution'] })
  );
  await put(
    root,
    `${K18}/K18_Use-Case/UC_18a_Aufgabe.docx`,
    useCaseParagraphs('18a')
  );
  await put(root, `${T1}/K1_Use-Cases/Enabler/1a_Thema.docx`, [p('1a) Thema')]);
  await put(root, `${T1}/Enablers/1a_Thema/1a.docx`, [p('1a) Thema')]);
}

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

test(
  'plan: reads a small tree and writes JSON and a summary without content',
  needsZip,
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-uc-plan-'));
    try {
      const source = path.join(dir, 'Komponente');
      await sampleSource(source);
      const out = path.join(dir, 'plan.json');
      const result = await run([
        'plan',
        source,
        '--out',
        out,
        '--no-attributes',
      ]);
      assert.equal(result.status, 0, result.err);
      const plan = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(plan.catalog, 'KFBM');
      assert.equal(plan.kind, 'use-cases');
      assert.deepEqual(
        plan.useCases.map(u => [u.code, u.enablerCode, u.letter]),
        [
          ['K1-a', 'K1-a', 'a'],
          ['K1-b', 'K1-b', 'b'],
        ]
      );
      // the broken file and both copies of 5b are skipped with a reason
      assert.deepEqual(
        plan.skipped.map(s => [s.key, s.code]),
        [
          ['use-case:1c', 'PARSE_ERROR'],
          ['use-case:5b', 'DUPLICATE_SOLUTION_VARIANT'],
          ['use-case:5b', 'DUPLICATE_SOLUTION_VARIANT'],
        ]
      );
      // K18 and the enabler texts are only counted
      assert.equal(plan.notPlanned.excluded, 1);
      assert.equal(plan.notPlanned.enabler, 2);
      // the table is read as lines
      assert.ok(plan.useCases[0].description.includes('Schrauben | 12'));
      assert.ok(!plan.useCases[0].description.includes('OMEGA'));
      assert.ok(plan.useCases[0].solution.includes('Schrauben | ZETA 1a'));
      // the plan file holds the content (it is the input of check and run), the summary does not
      const md = readFileSync(path.join(dir, 'plan.md'), 'utf8');
      for (const word of [
        'Erfundene Firma',
        'OMEGA',
        'ZETA',
        'Schrauben',
        'Erfundener Titel',
      ]) {
        assert.ok(!md.includes(word), word);
      }
      assert.ok(md.includes('use-case:5b'));
      assert.ok(!/[–—]/.test(md));
      assert.match(result.out, /"useCases":2/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  'plan: --components limits the run to the named components',
  needsZip,
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-uc-limit-'));
    try {
      const source = path.join(dir, 'Komponente');
      await sampleSource(source);
      const out = path.join(dir, 'plan.json');
      const result = await run([
        'plan',
        source,
        '--out',
        out,
        '--no-attributes',
        '--components',
        'K9',
      ]);
      assert.equal(result.status, 0, result.err);
      const plan = JSON.parse(readFileSync(out, 'utf8'));
      assert.deepEqual(plan.limitedTo, ['K9']);
      assert.equal(plan.useCases.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test('plan: a folder that does not exist stops with a message', async () => {
  const result = await run([
    'plan',
    path.join(tmpdir(), 'gibt-es-nicht-kfbm-use-cases'),
  ]);
  assert.equal(result.status, 2);
  assert.match(result.err, /not a folder|does not exist/i);
});

test('wrong usage stops with exit code 2 and the usage line', async () => {
  const result = await run(['bogus']);
  assert.equal(result.status, 2);
  assert.match(result.err, /first argument must be plan, check or run/);
  assert.match(result.err, /Usage: node scripts\/import\/kfbm-use-cases\.mjs/);
});

test('a damaged decisions file stops with exit code 2', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-uc-dec-'));
  try {
    const file = path.join(dir, 'decisions.json');
    writeFileSync(file, '{"version": 2}');
    const result = await run(['plan', dir, '--decisions', file]);
    assert.equal(result.status, 2);
    assert.match(result.err, /decisions file .* is not valid/);
    const missing = await run([
      'plan',
      dir,
      '--decisions',
      path.join(dir, 'x'),
    ]);
    assert.equal(missing.status, 2);
    assert.match(missing.err, /cannot be read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'loadSourceFiles: placeholders are not read without --hydrate and read with it',
  needsZip,
  async () => {
    const decisions = loadDecisions();
    const rel = `${T1}/K1_Use-Cases/UC_1a_Aufgabe.docx`;
    const buffer = await docx(useCaseParagraphs('1a'));
    const files = [
      { rel, size: 10, mtimeMs: 1, placeholder: true, info: pathInfo(rel) },
    ];
    let reads = 0;
    const read = async () => {
      reads += 1;
      return buffer;
    };
    const skipped = await loadSourceFiles('root', files, decisions, {
      readFile: read,
    });
    assert.equal(reads, 0);
    assert.equal(skipped[0].content, undefined);
    const hydrated = await loadSourceFiles('root', files, decisions, {
      readFile: read,
      hydrate: true,
    });
    assert.equal(reads, 1);
    assert.equal(hydrated[0].content.type, 'use-case');
    assert.equal(hydrated[0].content.result.ok, true);
  }
);

test('loadSourceFiles: a document above the size limit is not read', async () => {
  const decisions = loadDecisions();
  const rel = `${T1}/K1_Use-Cases/UC_1a_Aufgabe.docx`;
  let reads = 0;
  const result = await loadSourceFiles(
    'root',
    [
      {
        rel,
        size: 101 * 1024 * 1024,
        mtimeMs: 1,
        placeholder: false,
        info: pathInfo(rel),
      },
    ],
    decisions,
    {
      readFile: async () => {
        reads += 1;
        return Buffer.alloc(0);
      },
    }
  );
  assert.equal(reads, 0);
  assert.match(result[0].readError, /larger than/);
});

test('loadSourceFiles: only the use cases that the plan needs are read', async () => {
  const decisions = loadDecisions();
  const files = [
    `${T1}/K1_Use-Cases/UC_1a_Aufgabe.docx`,
    `${T1}/Enablers/1a_Thema/1a.docx`,
    `${K18}/K18_Use-Case/UC_18a_Aufgabe.docx`,
    `${T5}/K5_Use-Cases/Ohne Musterlösung/UC_5b_Aufgabe.docx`,
    `${T5}/K5_Use-Cases/UC_5b_Aufgabe.docx`,
  ].map(rel => ({
    rel,
    size: 10,
    mtimeMs: 1,
    placeholder: false,
    info: pathInfo(rel),
  }));
  const reads = [];
  await loadSourceFiles('root', files, decisions, {
    readFile: async file => {
      reads.push(path.basename(file));
      throw new Error('not a document');
    },
  });
  assert.deepEqual(reads, ['UC_1a_Aufgabe.docx']);
});

test('loadSourceFiles: a read that does not finish ends as read error, three in a row stop the reading', async () => {
  const decisions = loadDecisions();
  const files = ['a', 'b', 'c', 'd'].map(letter => {
    const rel = `${T1}/K1_Use-Cases/UC_1${letter}_Aufgabe.docx`;
    return {
      rel,
      size: 10,
      mtimeMs: 1,
      placeholder: false,
      info: pathInfo(rel),
    };
  });
  const never = () => new Promise(() => undefined);
  const result = await loadSourceFiles('root', files, decisions, {
    readFile: never,
    timeoutMs: 20,
  });
  assert.equal(result.length, 4);
  assert.ok(result.every(f => typeof f.readError === 'string'));
  assert.match(result[0].readError, /Timeout/);
  assert.match(result[3].readError, /three timeouts/);
});

test('run refuses production in every form', async () => {
  const base = ['run', '--plan', 'p.json', '--created-by', PROFILE];
  for (const extra of [
    ['--target', 'production'],
    ['--target', 'production', '--apply'],
    ['--target', 'local', '--confirm-production', 'db.example.com'],
  ]) {
    const result = await run([...base, ...extra], {
      DB_CONNECTION_STRING: 'postgresql://postgres:pw@127.0.0.1:1/postgres',
    });
    assert.equal(result.status, 2);
    assert.match(result.err, /Production is not supported/);
  }
});

test('run needs a target and a connection from the environment', async () => {
  const noTarget = await run([
    'run',
    '--plan',
    'p.json',
    '--created-by',
    PROFILE,
  ]);
  assert.equal(noTarget.status, 2);
  assert.match(noTarget.err, /--target local\|preview is required/);
  const noConnection = await run(
    ['run', '--plan', 'p.json', '--target', 'local', '--created-by', PROFILE],
    {}
  );
  assert.equal(noConnection.status, 2);
  assert.match(noConnection.err, /DB_CONNECTION_STRING is not set/);
});

test('the switch for the solutions is refused for the Preview and for plan', async () => {
  const preview = await run(
    [
      'run',
      '--plan',
      'p.json',
      '--target',
      'preview',
      '--created-by',
      PROFILE,
      '--use-case-solutions',
    ],
    { DB_CONNECTION_STRING: 'postgresql://postgres:pw@db.example.com:5432/x' }
  );
  assert.equal(preview.status, 2);
  assert.match(preview.err, /not allowed for the Preview/);
  const plan = await run(['plan', 'x', '--use-case-solutions']);
  assert.equal(plan.status, 2);
  assert.match(plan.err, /belongs to check and run/);
});

test('a foreign host is refused before any connection is opened, and no secret is printed', async () => {
  const secret = 'Geheim-Passwort-123';
  const env = {
    DB_CONNECTION_STRING: `postgresql://postgres:${secret}@db.example.com:5432/postgres`,
  };
  const local = await run(
    ['check', '--plan', 'p.json', '--target', 'local', '--created-by', PROFILE],
    env
  );
  assert.equal(local.status, 1);
  assert.match(local.err, /--target local needs a loopback host/);
  const confirm = await run(
    [
      'run',
      '--plan',
      'p.json',
      '--target',
      'preview',
      '--created-by',
      PROFILE,
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
    const result = await run(
      [
        'check',
        '--plan',
        'p.json',
        '--target',
        'local',
        '--created-by',
        PROFILE,
      ],
      {
        DB_CONNECTION_STRING: `postgresql://postgres:pw@localhost:5432/postgres${query}`,
      }
    );
    assert.equal(result.status, 1);
    assert.match(result.err, /not accepted/);
  }
});

test('preview with a loopback host is refused', async () => {
  const result = await run(
    [
      'check',
      '--plan',
      'p.json',
      '--target',
      'preview',
      '--created-by',
      PROFILE,
    ],
    { DB_CONNECTION_STRING: 'postgresql://postgres:pw@127.0.0.1:1/postgres' }
  );
  assert.equal(result.status, 1);
  assert.match(result.err, /loopback host, that is not the Preview/);
});

test('an invalid plan is refused before the connection is opened', async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-uc-bad-'));
  try {
    const planFile = path.join(dir, 'plan.json');
    writeFileSync(
      planFile,
      JSON.stringify({
        version: 1,
        kind: 'use-cases',
        catalog: 'FIAE',
        useCases: [],
        skipped: [],
      })
    );
    const result = await run(
      [
        'run',
        '--plan',
        planFile,
        '--target',
        'local',
        '--created-by',
        PROFILE,
        '--apply',
      ],
      { DB_CONNECTION_STRING: 'postgresql://postgres:pw@127.0.0.1:1/postgres' }
    );
    assert.equal(result.status, 1);
    assert.match(result.err, /Plan problem: The plan catalog must be KFBM/);
    assert.match(result.err, /Nothing was done/);
    assert.ok(!/connection failed/.test(result.err));

    // a plan of the content import is not a plan of this import
    writeFileSync(
      planFile,
      JSON.stringify({ version: 1, catalog: 'KFBM', components: [] })
    );
    const other = await run(
      [
        'check',
        '--plan',
        planFile,
        '--target',
        'local',
        '--created-by',
        PROFILE,
      ],
      { DB_CONNECTION_STRING: 'postgresql://postgres:pw@127.0.0.1:1/postgres' }
    );
    assert.equal(other.status, 1);
    assert.match(other.err, /not a plan of the use case import/);

    // a plan file that cannot be read
    const missing = await run(
      [
        'check',
        '--plan',
        path.join(dir, 'x.json'),
        '--target',
        'local',
        '--created-by',
        PROFILE,
      ],
      { DB_CONNECTION_STRING: 'postgresql://postgres:pw@127.0.0.1:1/postgres' }
    );
    assert.equal(missing.status, 2);
    assert.match(missing.err, /cannot be read/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'a failing connection is reported without the password',
  needsBoth,
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-uc-conn-'));
    try {
      const source = path.join(dir, 'Komponente');
      await sampleSource(source);
      const secret = 'Geheim-Passwort-456';
      const result = await run(
        [
          'check',
          source,
          '--no-attributes',
          '--target',
          'local',
          '--created-by',
          PROFILE,
        ],
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

test('the connection string is taken out of the process environment', async () => {
  const before = process.env.DB_CONNECTION_STRING;
  process.env.DB_CONNECTION_STRING =
    'postgresql://postgres:pw@db.example.com:5432/postgres';
  try {
    const result = await main([
      'check',
      '--plan',
      'p.json',
      '--target',
      'local',
      '--created-by',
      PROFILE,
    ]);
    assert.equal(result, 1);
    assert.equal(process.env.DB_CONNECTION_STRING, undefined);
  } finally {
    if (before === undefined) delete process.env.DB_CONNECTION_STRING;
    else process.env.DB_CONNECTION_STRING = before;
  }
});

test('the script sources read no env file, call no model and no network, and have no delete', () => {
  for (const file of [
    'scripts/import/kfbm-use-cases.mjs',
    'scripts/import/kfbm-use-cases-modules.mjs',
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
    'src/lib/content-import/use-cases/engine.ts',
    'src/lib/content-import/use-cases/job.ts',
    'src/lib/content-import/use-cases/guard.ts',
    'src/lib/content-import/use-cases/plan.ts',
  ]) {
    const source = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(
      !/\b(delete\s+from|truncate|drop\s+(table|schema)|alter\s+table)\b/i.test(
        source
      ),
      `${file}: destructive SQL`
    );
    assert.ok(!/\bfrom\s+['"]fs['"]|node:fs/.test(source), `${file}: fs`);
  }
});

test('the command line works end to end for plan', needsZip, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-uc-cli-'));
  try {
    const source = path.join(dir, 'Komponente');
    await sampleSource(source);
    const out = path.join(dir, 'plan.json');
    const run1 = spawnSync(
      process.execPath,
      [
        'scripts/import/kfbm-use-cases.mjs',
        'plan',
        source,
        '--out',
        out,
        '--no-attributes',
      ],
      { encoding: 'utf8' }
    );
    assert.equal(run1.status, 0, run1.stderr);
    assert.ok(existsSync(out));
    assert.ok(!/Warning/.test(run1.stderr), run1.stderr);

    const refused = spawnSync(
      process.execPath,
      [
        'scripts/import/kfbm-use-cases.mjs',
        'run',
        '--plan',
        out,
        '--target',
        'production',
        '--created-by',
        PROFILE,
      ],
      { encoding: 'utf8', env: { ...process.env, DB_CONNECTION_STRING: '' } }
    );
    assert.equal(refused.status, 2);
    assert.match(refused.stderr, /Production is not supported/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
