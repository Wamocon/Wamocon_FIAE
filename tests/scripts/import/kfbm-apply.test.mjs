// Tests for scripts/import/kfbm-apply.mjs (plan, check, dry run and real run of
// the KfBM content import). The documents are invented and built with JSZip, no
// original file of the source is used or copied. Nothing here talks to a real
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
  renderRunReport,
} from '../../../scripts/import/kfbm-apply.mjs';
import { pathInfo } from '../../../scripts/import/kfbm-source.mjs';

const PROFILE = '11111111-2222-4333-8444-555555555555';
const T1 =
  'Komponente Teil 1 (1-15 Monate)/01 - Erfundenes Thema (§ 4 Abs. 2 Nr. 1)';
const ENABLER = `${T1}/Enablers/1a_Thema`;

const p = (text, bold = false) => ({ text, bold });

function quizParagraphs({ heading, level, count = 10, skipAnswerOf = 0 }) {
  const out = [p(heading)];
  if (level) out.push(p(`Quiz, Schwierigkeitsgrad: ${level}`, true));
  for (let n = 1; n <= count; n += 1) {
    out.push(
      p(`${n}. Erfundene Frage ${n}?`, true),
      p('A) eins'),
      p('B) zwei'),
      p('C) drei'),
      p('D) vier')
    );
    if (n !== skipAnswerOf) out.push(p('Richtige Antwort: B', true));
    out.push(p(`Kurzbegründung: Erfundene Begründung ZETA ${n}.`));
  }
  return out;
}

const scenarioParagraphs = [
  p('Szenario 1a) Erfundenes Thema', true),
  p('Ausgangssituation', true),
  p('Eine erfundene Lage.'),
  p('Lösungsszenario', true),
  p('Eine erfundene Lösung OMEGA.'),
  p('Wie das Fachwissen zur Lösung beiträgt', true),
  p('Ein erfundener Beitrag SIGMA.'),
];

async function docx(paragraphs) {
  const body = paragraphs
    .map(
      para =>
        `<w:p>${
          para.text
            ? `<w:r>${para.bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${para.text
                .replace(/&/g, '&amp;')
                .replace(/</g, '&lt;')}</w:t></w:r>`
            : ''
        }</w:p>`
    )
    .join('');
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

async function put(root, rel, paragraphs) {
  const full = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, await docx(paragraphs));
}

/** A small invented tree: one component, one enabler, one broken quiz, one global quiz. */
async function sampleSource(root) {
  await put(root, `${ENABLER}/1a.docx`, [
    p('1a) Erfundenes Thema', true),
    p('Erfundener Lehrtext.'),
  ]);
  await put(
    root,
    `${ENABLER}/Quiz/1a_Quiz_Low.docx`,
    quizParagraphs({ heading: '1a) Erfundenes Thema', level: 'leicht' })
  );
  await put(
    root,
    `${ENABLER}/Quiz/1a_Quiz_Medium.docx`,
    quizParagraphs({ heading: '1a) Erfundenes Thema', level: 'mittel' })
  );
  await put(
    root,
    `${ENABLER}/Quiz/1a_Quiz_High.docx`,
    quizParagraphs({
      heading: '1a) Erfundenes Thema',
      level: 'anspruchsvoll',
      skipAnswerOf: 4,
    })
  );
  await put(root, `${ENABLER}/Szenario/Szenario_1a.docx`, scenarioParagraphs);
  await put(
    root,
    `${T1}/Global Quiz/01_Global_Quiz_Thema.docx`,
    quizParagraphs({
      heading: '01) Erfundenes Globalthema (§ 4 Abs. 2 Nr. 1)',
      level: null,
      count: 20,
    }).flatMap((para, index) =>
      index === 0 ? [para, p('Global Quiz')] : [para]
    )
  );
  // not part of the run: K18 and a use case
  await put(
    root,
    'Komponente Teil 2 (16-36 Monate)/18 - Verwaltung (§ 4 Abs. 3 Nr. 9)/Enablers/18a_Thema/18a.docx',
    [p('18a) Erfundenes Thema')]
  );
  await put(root, `${T1}/K1_Use-Cases/UC_1a_Aufgabe.docx`, [p('UC')]);
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
    const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-apply-plan-'));
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
      assert.deepEqual(
        plan.components.map(c => [c.code, c.kind, c.phase]),
        [['K1', 'pflicht', 1]]
      );
      assert.deepEqual(
        plan.quizzes.map(q => q.code),
        ['K1-a-low', 'K1-a-medium', 'K1-global']
      );
      assert.equal(plan.scenarios.length, 1);
      // the broken quiz is skipped with its reason, K18 and the use case only counted
      assert.deepEqual(
        plan.skipped.map(s => [s.key, s.code]),
        [['quiz:1a:high', 'PARSE_ERROR']]
      );
      assert.equal(plan.notPlanned.excluded, 1);
      assert.equal(plan.notPlanned['use-case'], 1);
      // the plan file does hold the content (it is the input of the apply), the summary does not
      const md = readFileSync(path.join(dir, 'plan.md'), 'utf8');
      for (const word of [
        'Erfundene Frage',
        'ZETA',
        'OMEGA',
        'SIGMA',
        'Erfundener Lehrtext',
        'Erfundene Lage',
      ]) {
        assert.ok(!md.includes(word), word);
      }
      assert.ok(md.includes('quiz:1a:high'));
      assert.ok(!/[–—]/.test(md));
      assert.match(result.out, /"components":1/);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  'plan: --components limits the run to the named components',
  needsZip,
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-apply-limit-'));
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
      assert.equal(plan.components.length, 0);
      assert.equal(plan.quizzes.length, 0);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test('plan: a folder that does not exist stops with a message', async () => {
  const result = await run([
    'plan',
    path.join(tmpdir(), 'gibt-es-nicht-kfbm-apply'),
  ]);
  assert.equal(result.status, 2);
  assert.match(result.err, /not a folder|does not exist/i);
});

test(
  'loadSourceFiles: placeholders are not read without --hydrate and read with it',
  needsZip,
  async () => {
    const decisions = loadDecisions();
    const rel = `${ENABLER}/1a.docx`;
    const buffer = await docx([p('1a) Erfundenes Thema', true), p('Text.')]);
    const files = [
      {
        rel,
        size: 10,
        mtimeMs: 1,
        placeholder: true,
        info: pathInfo(rel),
      },
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
    assert.equal(hydrated[0].content.type, 'enabler');
  }
);

test('loadSourceFiles: a read that does not finish ends as read error, three in a row stop the reading', async () => {
  const decisions = loadDecisions();
  const files = ['a', 'b', 'c', 'd'].map(letter => {
    const rel = `${T1}/Enablers/1${letter}_Thema/1${letter}.docx`;
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

test('run needs a target, a profile and a connection from the environment', async () => {
  const noTarget = await run([
    'run',
    '--plan',
    'p.json',
    '--created-by',
    PROFILE,
  ]);
  assert.equal(noTarget.status, 2);
  assert.match(noTarget.err, /--target local\|preview is required/);

  const noEnv = await run(
    ['run', '--plan', 'p.json', '--target', 'local', '--created-by', PROFILE],
    {}
  );
  assert.equal(noEnv.status, 2);
  assert.match(noEnv.err, /DB_CONNECTION_STRING is not set/);
});

test('a foreign host is refused before any connection is opened, and no secret is printed', async () => {
  const secret = 'Zugangs-Geheimnis-123';
  const env = {
    DB_CONNECTION_STRING: `postgresql://postgres:${secret}@db.example.com:5432/postgres`,
  };
  const local = await run(
    [
      'run',
      '--plan',
      'p.json',
      '--target',
      'local',
      '--created-by',
      PROFILE,
      '--apply',
    ],
    env
  );
  assert.equal(local.status, 1);
  assert.match(local.err, /needs a loopback host/);

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
  const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-apply-bad-'));
  try {
    const planFile = path.join(dir, 'plan.json');
    writeFileSync(
      planFile,
      JSON.stringify({
        version: 1,
        catalog: 'FIAE',
        components: [],
        enablers: [],
        scenarios: [],
        quizzes: [],
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
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test(
  'a failing connection is reported without the password',
  needsBoth,
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-apply-conn-'));
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

test('the run report names counts and keys but no content', () => {
  const text = renderRunReport(
    {
      catalog: 'KFBM',
      tables: {
        training_components: { insert: 1, update: 0, unchanged: 0 },
        options: { insert: 40, update: 0, unchanged: 0 },
      },
      differences: [{ table: 'enablers', key: 'K1-a', columns: ['title'] }],
      conflicts: [
        {
          table: 'courses',
          key: 'K1',
          reason: 'Der Kurs ist anders verknüpft.',
        },
      ],
      wrote: true,
    },
    {
      mode: 'dry-run',
      target: 'local',
      host: '127.0.0.1',
      schema: 'public',
      role: 'postgres',
      at: '2026-10-26T12:00:00.000Z',
      updateExisting: false,
    }
  );
  assert.match(text, /Probelauf/);
  assert.match(text, /\| Optionen \| 40 \| 0 \| 0 \|/);
  assert.match(text, /enablers K1-a: title/);
  assert.match(text, /## Konflikte/);
  assert.ok(!/[–—]/.test(text));
});

test('the script source reads no env file, calls no model and no network, and has no delete', () => {
  for (const file of [
    'scripts/import/kfbm-apply.mjs',
    'scripts/import/kfbm-apply-modules.mjs',
    'scripts/import/ts-resolve-hook.mjs',
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
    'src/lib/content-import/apply/pg-db.ts',
    'src/lib/content-import/apply/engine.ts',
    'src/lib/content-import/apply/job.ts',
  ]) {
    const source = readFileSync(file, 'utf8').replace(/\/\/.*$/gm, '');
    assert.ok(
      !/\b(delete\s+from|truncate|drop\s+(table|schema)|alter\s+table)\b/i.test(
        source
      ),
      `${file}: destructive SQL`
    );
  }
});

test('the command line works end to end for plan', needsZip, async () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-apply-cli-'));
  try {
    const source = path.join(dir, 'Komponente');
    await sampleSource(source);
    const out = path.join(dir, 'plan.json');
    const run1 = spawnSync(
      process.execPath,
      [
        'scripts/import/kfbm-apply.mjs',
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
        'scripts/import/kfbm-apply.mjs',
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
