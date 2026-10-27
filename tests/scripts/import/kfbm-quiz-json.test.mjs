// Tests for the quiz JSON source of scripts/import/kfbm-apply.mjs (plan with
// --quizzes-json and --global-quizzes-json, check-quizzes). The JSON files and
// the Word documents are invented, nothing comes from the real files. Nothing
// here talks to a database: the refusals happen before the first connection.
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
// JSZip builds the invented Word document. The workflow db-checks runs these
// tests without installed dependencies, then the tests that need it are skipped.
const JSZip = await import('jszip').then(
  module => module.default,
  () => null
);
const needsZip = { skip: JSZip ? false : 'jszip is not installed' };
import { main } from '../../../scripts/import/kfbm-apply.mjs';

const PROFILE = '11111111-2222-4333-8444-555555555555';
const SECTION = 'Komponente Teil 1 (1-15 Monate)';
const COMPONENT = '01 - Erfundenes Thema (§ 4 Abs. 2 Nr. 1)';
const ENABLER = `${SECTION}/${COMPONENT}/Enablers/1a_Thema`;
const CONTENT_WORDS = ['Erfundene JSON', 'KAPPA', 'JSON-Antwort'];

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

// Word side -------------------------------------------------------------------
const p = (text, bold = false) => ({ text, bold });

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

function wordQuiz(heading, level, count = 10, skipAnswerOf = 0) {
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

/** Enabler 1a with a low and a medium quiz, a broken high quiz and a global quiz. */
async function wordTree(root) {
  await put(root, `${ENABLER}/1a.docx`, [
    p('1a) Erfundenes Thema', true),
    p('Erfundener Lehrtext.'),
  ]);
  await put(
    root,
    `${ENABLER}/Quiz/1a_Quiz_Low.docx`,
    wordQuiz('1a) Erfundenes Thema', 'leicht')
  );
  await put(
    root,
    `${ENABLER}/Quiz/1a_Quiz_Medium.docx`,
    wordQuiz('1a) Erfundenes Thema', 'mittel')
  );
  await put(
    root,
    `${ENABLER}/Quiz/1a_Quiz_High.docx`,
    wordQuiz('1a) Erfundenes Thema', 'anspruchsvoll', 10, 4)
  );
  await put(
    root,
    `${SECTION}/${COMPONENT}/Global Quiz/01_Global_Quiz_Thema.docx`,
    wordQuiz('01) Erfundenes Globalthema (§ 4 Abs. 2 Nr. 1)', null, 20).flatMap(
      (para, index) => (index === 0 ? [para, p('Global Quiz')] : [para])
    )
  );
}

// JSON side -------------------------------------------------------------------
function jsonQuestions(prefix, count, tag) {
  return Array.from({ length: count }, (_, i) => ({
    id: `${prefix}-q${i + 1}`,
    number: i + 1,
    question: `Erfundene JSON-Frage ${tag}${i + 1}?`,
    options: ['A', 'B', 'C', 'D'].map((key, k) => ({
      key,
      text: `JSON-Antwort ${k + 1}`,
    })),
    correct_answer: 'C',
    explanation: `Erfundene JSON-Begründung KAPPA-${tag}${i + 1}.`,
  }));
}

function lessonJson({ breakLevel = null } = {}) {
  const level = (name, tag) => {
    const questions = jsonQuestions(`1a-${name}`, 10, tag);
    if (breakLevel === name) questions[0].correct_answer = 'Z';
    return {
      label: name,
      source: `${SECTION}/${COMPONENT}`,
      questions,
      attached_source: 'Enabler_Quizze_Low_Medium_High.json',
    };
  };
  const file = name => `${ENABLER}/Quiz/1a_Quiz_${name}.docx`;
  return {
    schema_version: '1.0',
    quiz_count: 1,
    difficulty_levels: ['leicht', 'mittel', 'schwer'],
    quizzes: [
      {
        id: '1a',
        title: '1a) Erfundenes Thema',
        category: SECTION,
        source_files: {
          High: file('High'),
          Low: file('Low'),
          Medium: file('Medium'),
        },
        difficulties: {
          leicht: level('leicht', 'L'),
          mittel: level('mittel', 'M'),
          schwer: level('schwer', 'S'),
        },
        curriculum_component: { id: '01', title: COMPONENT },
        training_section: SECTION,
      },
    ],
  };
}

function globalJson() {
  return {
    schema_version: '1.0',
    quiz_count: 1,
    quizzes: [
      {
        id: '01',
        curriculum_component: {
          id: '01',
          title: '01) Erfundenes Globalthema (§ 4 Abs. 2 Nr. 1)',
        },
        title: '01) Erfundenes Globalthema (§ 4 Abs. 2 Nr. 1)',
        source: '00_Global_Quizze/Word/01_Global_Quiz_Thema.docx',
        source_file: '01_Global_Quiz_Thema.docx',
        source_json: 'Global_Quizze.json',
        questions: jsonQuestions('01', 20, 'G'),
      },
    ],
  };
}

function writeJson(dir, name, value) {
  const file = path.join(dir, name);
  writeFileSync(
    file,
    typeof value === 'string' ? value : JSON.stringify(value)
  );
  return file;
}

const withDir = async (prefix, fn) => {
  const dir = mkdtempSync(path.join(tmpdir(), prefix));
  try {
    await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
};

test('plan from the quiz JSON alone: enablers without text, quizzes, global quiz, no content in the summary', () =>
  withDir('kfbm-json-plan-', async dir => {
    const quizzes = writeJson(dir, 'alle.json', lessonJson());
    const globals = writeJson(dir, 'global.json', globalJson());
    const out = path.join(dir, 'plan.json');
    const result = await run([
      'plan',
      '--quizzes-json',
      quizzes,
      '--global-quizzes-json',
      globals,
      '--out',
      out,
    ]);
    assert.equal(result.status, 0, result.err);
    const plan = JSON.parse(readFileSync(out, 'utf8'));
    assert.deepEqual(
      plan.quizzes.map(q => q.code),
      ['K1-a-low', 'K1-a-medium', 'K1-a-high', 'K1-global']
    );
    assert.equal(plan.enablers[0].descriptionText, null);
    assert.equal(plan.skipped.length, 0);
    assert.match(result.out, /"quizzes":4/);
    const md = readFileSync(path.join(dir, 'plan.md'), 'utf8');
    for (const word of CONTENT_WORDS) {
      assert.ok(!md.includes(word), word);
      assert.ok(!result.out.includes(word), word);
      assert.ok(!result.err.includes(word), word);
    }
    assert.ok(!/[–—]/.test(md));
  }));

test(
  'plan with Word and JSON: the Word quiz stays, the switch takes the JSON',
  needsZip,
  () =>
    withDir('kfbm-json-both-', async dir => {
      const source = path.join(dir, 'Komponente');
      await wordTree(source);
      const quizzes = writeJson(dir, 'alle.json', lessonJson());
      const globals = writeJson(dir, 'global.json', globalJson());
      const common = [
        'plan',
        source,
        '--no-attributes',
        '--quizzes-json',
        quizzes,
        '--global-quizzes-json',
        globals,
      ];
      const plain = path.join(dir, 'plan-word.json');
      const first = await run([...common, '--out', plain]);
      assert.equal(first.status, 0, first.err);
      const word = JSON.parse(readFileSync(plain, 'utf8'));
      // The Word quizzes stay. The Word high quiz has a format error, so it
      // holds no key: the JSON quiz fills the gap and the Word file is listed
      // as an older copy.
      assert.deepEqual(
        word.quizzes.map(q => [q.code, q.source.endsWith('.docx')]),
        [
          ['K1-a-low', true],
          ['K1-a-medium', true],
          ['K1-a-high', false],
          ['K1-global', true],
        ]
      );
      assert.equal(word.superseded.length, 4);
      assert.equal(word.skipped.length, 0);
      assert.match(first.err, /left out for the Word quiz of the same key/);
      assert.match(first.err, /1 quizzes taken because the Word file/);

      const preferred = path.join(dir, 'plan-json.json');
      const second = await run([
        ...common,
        '--prefer-json-quizzes',
        '--out',
        preferred,
      ]);
      assert.equal(second.status, 0, second.err);
      const json = JSON.parse(readFileSync(preferred, 'utf8'));
      assert.deepEqual(
        json.quizzes.map(q => q.code),
        ['K1-a-low', 'K1-a-medium', 'K1-a-high', 'K1-global']
      );
      assert.ok(json.quizzes.every(q => /quiz-json#/.test(q.source)));
      // the enabler text still comes from the Word document
      assert.ok(json.enablers[0].descriptionText);
    })
);

test('plan: a level with an error is skipped with its reason', () =>
  withDir('kfbm-json-err-', async dir => {
    const quizzes = writeJson(
      dir,
      'alle.json',
      lessonJson({ breakLevel: 'schwer' })
    );
    const out = path.join(dir, 'plan.json');
    const result = await run(['plan', '--quizzes-json', quizzes, '--out', out]);
    assert.equal(result.status, 0, result.err);
    const plan = JSON.parse(readFileSync(out, 'utf8'));
    assert.deepEqual(
      plan.skipped.map(s => [s.key, s.code]),
      [['quiz:1a:high', 'PARSE_ERROR']]
    );
    assert.match(plan.skipped[0].reason, /ANSWER_INVALID \(question 1\)/);
    assert.match(result.err, /1 errors/);
  }));

test('a file that is not JSON, missing or of another schema is refused without quoting it', () =>
  withDir('kfbm-json-bad-', async dir => {
    const secret = 'GEHEIMER-INHALT-4711';
    const broken = writeJson(dir, 'kaputt.json', `{"a": "${secret}" "b"`);
    const result = await run(['plan', '--quizzes-json', broken]);
    assert.equal(result.status, 2);
    assert.match(result.err, /is not valid JSON/);
    assert.ok(!result.err.includes(secret));
    assert.ok(!result.out.includes(secret));

    const missing = await run([
      'check-quizzes',
      '--quizzes-json',
      path.join(dir, 'fehlt.json'),
    ]);
    assert.equal(missing.status, 2);
    assert.match(missing.err, /does not exist/);

    const newer = writeJson(dir, 'neu.json', {
      ...lessonJson(),
      schema_version: '2.0',
    });
    const refused = await run(['plan', '--quizzes-json', newer]);
    assert.equal(refused.status, 2);
    assert.match(refused.err, /SCHEMA_VERSION/);

    // a folder named like a JSON file is no file
    mkdirSync(path.join(dir, 'ordner.json'));
    const folder = await run([
      'plan',
      '--quizzes-json',
      path.join(dir, 'ordner.json'),
    ]);
    assert.equal(folder.status, 2);
    assert.match(folder.err, /is not a file/);
  }));

test('a file over the size limit is refused before it is read', async () => {
  const { readQuizJsonFile } =
    await import('../../../scripts/import/kfbm-apply.mjs');
  await withDir('kfbm-json-size-', async dir => {
    const file = writeJson(dir, 'gross.json', JSON.stringify(lessonJson()));
    assert.throws(() => readQuizJsonFile(file, 100), /over the limit/);
    assert.equal(readQuizJsonFile(file).schema_version, '1.0');
    const bom = writeJson(dir, 'bom.json', '﻿{"schema_version":"1.0"}');
    assert.equal(readQuizJsonFile(bom).schema_version, '1.0');
  });
});

test('check-quizzes reports numbers and ids only, exits 1 on errors and writes the report on request', () =>
  withDir('kfbm-json-check-', async dir => {
    const good = writeJson(dir, 'alle.json', lessonJson());
    const globals = writeJson(dir, 'global.json', globalJson());
    const report = path.join(dir, 'bericht.md');
    const clean = await run([
      'check-quizzes',
      '--quizzes-json',
      good,
      '--global-quizzes-json',
      globals,
      '--report-out',
      report,
    ]);
    assert.equal(clean.status, 0, clean.err);
    assert.match(clean.out, /Quizze: 1, Sätze: 3, Fragen: 30/);
    assert.match(clean.out, /Quizze: 1, Sätze: 1, Fragen: 20/);
    assert.match(clean.out, /\| K1 \| 1 \| 3 \| 30 \|/);
    assert.ok(existsSync(report));
    const written = readFileSync(report, 'utf8');
    assert.ok(!/[–—]/.test(written));
    for (const word of CONTENT_WORDS) {
      assert.ok(!clean.out.includes(word), word);
      assert.ok(!written.includes(word), word);
    }

    const bad = writeJson(
      dir,
      'schlecht.json',
      lessonJson({ breakLevel: 'mittel' })
    );
    const failed = await run(['check-quizzes', '--quizzes-json', bad]);
    assert.equal(failed.status, 1);
    assert.match(failed.out, /ANSWER_INVALID/);
    assert.match(failed.out, /1a\/medium#1/);
  }));

test('check-quizzes needs a file and refuses the options of the database run', async () => {
  const none = await run(['check-quizzes']);
  assert.equal(none.status, 2);
  assert.match(none.err, /needs --quizzes-json/);
  const target = await run([
    'check-quizzes',
    '--quizzes-json',
    'a.json',
    '--target',
    'local',
  ]);
  assert.equal(target.status, 2);
  assert.match(target.err, /--target does not belong to check-quizzes/);
});

test('run with the quiz JSON refuses production and a foreign host before any connection', async () => {
  const refused = await run([
    'run',
    '--quizzes-json',
    'a.json',
    '--target',
    'production',
    '--created-by',
    PROFILE,
  ]);
  assert.equal(refused.status, 2);
  assert.match(refused.err, /Production is not supported/);
  const foreign = await run(
    [
      'run',
      '--quizzes-json',
      'a.json',
      '--target',
      'local',
      '--created-by',
      PROFILE,
    ],
    { DB_CONNECTION_STRING: 'postgresql://postgres:pw@db.example.com:5432/x' }
  );
  assert.equal(foreign.status, 1);
  assert.match(foreign.err, /needs a loopback host/);
});

test('the command line works end to end for check-quizzes and plan', () =>
  withDir('kfbm-json-cli-', async dir => {
    const good = writeJson(dir, 'alle.json', lessonJson());
    const run1 = spawnSync(
      process.execPath,
      [
        'scripts/import/kfbm-apply.mjs',
        'check-quizzes',
        '--quizzes-json',
        good,
      ],
      { encoding: 'utf8' }
    );
    assert.equal(run1.status, 0, run1.stderr);
    assert.ok(!/Warning/.test(run1.stderr), run1.stderr);
    assert.match(run1.stdout, /Enabler-Quizze/);
    const run2 = spawnSync(
      process.execPath,
      ['scripts/import/kfbm-apply.mjs', 'plan', '--quizzes-json', good],
      { encoding: 'utf8' }
    );
    assert.equal(run2.status, 0, run2.stderr);
    assert.ok(!/Warning/.test(run2.stderr), run2.stderr);
    assert.match(run2.stdout, /"quizzes":3/);
  }));

test('the new code reads no env file, calls no model and no network', () => {
  for (const file of [
    'src/lib/content-import/quiz-json/read.ts',
    'src/lib/content-import/quiz-json/merge.ts',
    'src/lib/content-import/quiz-json/report.ts',
  ]) {
    const source = readFileSync(file, 'utf8');
    assert.ok(!/from 'node:|require\(/.test(source), `${file}: node import`);
    assert.ok(!/\bfetch\s*\(/.test(source), `${file}: fetch`);
    assert.ok(!/openai|anthropic|gemini|embedding/i.test(source), file);
    assert.ok(!/\.env/.test(source), `${file}: env`);
  }
});

test('an output file must not be an input file, a report must be a .md file', () =>
  withDir('kfbm-json-out-', async dir => {
    const good = writeJson(dir, 'alle.json', lessonJson());
    const same = await run([
      'check-quizzes',
      '--quizzes-json',
      good,
      '--report-out',
      good,
    ]);
    assert.equal(same.status, 2);
    assert.match(same.err, /must not be a quiz JSON input file/);
    assert.equal(JSON.parse(readFileSync(good, 'utf8')).schema_version, '1.0');
    const plan = await run(['plan', '--quizzes-json', good, '--out', good]);
    assert.equal(plan.status, 2);
    const notMd = await run([
      'check-quizzes',
      '--quizzes-json',
      good,
      '--report-out',
      path.join(dir, 'bericht.txt'),
    ]);
    assert.equal(notMd.status, 2);
    assert.match(notMd.err, /must be a \.md file/);
  }));

test('the run report names the added questions', async () => {
  const { renderRunReport } =
    await import('../../../scripts/import/kfbm-apply.mjs');
  const text = renderRunReport(
    {
      catalog: 'KFBM',
      tables: { questions: { insert: 4, update: 0, unchanged: 16 } },
      differences: [],
      conflicts: [],
      wrote: true,
      extended: [
        { quiz: 'K2-g-low', added: 2, moved: 5 },
        { quiz: 'K2-g-high', added: 2, moved: 3 },
      ],
    },
    {
      mode: 'dry-run',
      target: 'local',
      host: '127.0.0.1',
      schema: 'public',
      role: 'postgres',
      at: '2026-10-27T12:00:00.000Z',
      updateExisting: false,
    }
  );
  assert.match(text, /4 Fragen ergänzt in 2 Quizzen/);
  assert.match(text, /verschoben: 8/);
  assert.match(text, /- K2-g-low: 2 ergänzt, 5 verschoben/);
  assert.ok(!/[–—]/.test(text));
});
