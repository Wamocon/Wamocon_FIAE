// Tests for scripts/import/kfbm-parse-check.mjs (read only dry run of the
// parsers). The documents are invented and built with JSZip, no original file
// of the source is used or copied.
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
// JSZip builds the invented documents. The workflow db-checks runs these tests
// without installed dependencies, then the tests that need it are skipped.
const JSZip = await import('jszip').then(
  module => module.default,
  () => null
);
const needsZip = { skip: JSZip ? false : 'jszip is not installed' };
import {
  checkParsed,
  renderCheckSummary,
  runCheck,
  summarize,
} from '../../../scripts/import/kfbm-parse-check.mjs';
import { pathInfo } from '../../../scripts/import/kfbm-source.mjs';

const T1 =
  'Komponente Teil 1 (1-15 Monate)/01 - Informationsmanagement anwenden (§ 4 Abs. 2 Nr. 1)';
const K18 =
  'Komponente Teil 2 (16-36 Monate)/18 - Verwaltung (§ 4 Abs. 3 Nr. 9)';
const quizPath = (id, level) =>
  `${T1}/Enablers/${id}_Thema/Quiz/${id}_Quiz_${level}.docx`;

const p = (text, bold = false) => ({ text, bold });

function quizParagraphs({
  code = '1a',
  level = 'leicht',
  count = 3,
  breakQ = 0,
} = {}) {
  const out = [
    p(`${code}) Erfundenes Thema`),
    p(`Quiz, Schwierigkeitsgrad: ${level}`, true),
    p(''),
  ];
  for (let n = 1; n <= count; n += 1) {
    out.push(p(`${n}. Erfundene Frage ${n}?`, true));
    const options = ['A) eins', 'B) zwei', 'C) drei', 'D) vier'];
    out.push(...(n === breakQ ? options.slice(0, 3) : options).map(t => p(t)));
    out.push(
      p('Richtige Antwort: B', true),
      p('Kurzbegründung: Erfunden.'),
      p('')
    );
  }
  return out;
}

const scenarioParagraphs = (code = '1a') => [
  p(`Szenario ${code}) Erfundenes Thema`, true),
  p('Ausgangssituation', true),
  p('Eine erfundene Lage.'),
  p('Lösungsszenario', true),
  p('Eine erfundene Lösung.'),
  p('Wie das Fachwissen zur Lösung beiträgt', true),
  p('Ein erfundener Beitrag.'),
];

async function docx(paragraphs, media = 0) {
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
  for (let i = 0; i < media; i += 1) zip.file(`word/media/image${i}.png`, 'x');
  return zip.generateAsync({ type: 'nodebuffer' });
}

const codes = result => result.issues.map(i => i.code).sort();

test('a clean quiz passes and counts its questions', () => {
  const rel = quizPath('1a', 'Low');
  const result = checkParsed(rel, pathInfo(rel), {
    paragraphs: quizParagraphs(),
  });
  assert.equal(result.status, 'ok');
  assert.equal(result.stats.questions, 3);
  assert.deepEqual(result.issues, []);
});

test('reports a difficulty that differs from the file name and a code that differs from the path', () => {
  const rel = quizPath('1a', 'High');
  const result = checkParsed(rel, pathInfo(rel), {
    paragraphs: quizParagraphs({ code: '1c', level: 'leicht' }),
  });
  assert.equal(result.status, 'error');
  assert.deepEqual(codes(result), ['CODE_MISMATCH', 'DIFFICULTY_MISMATCH']);
});

test('accepts a heading without the split and takes parser issues along', () => {
  const rel = `Komponente Teil 2 (16-36 Monate)/06.2 - Auftragsbearbeitung durchführen (§ 4 Abs. 2 Nr. 6)/Enablers/6d_Auftrag/Quiz/6d_Quiz_Low.docx`;
  const result = checkParsed(rel, pathInfo(rel), {
    paragraphs: quizParagraphs({ code: '6d', breakQ: 2 }),
  });
  assert.deepEqual(codes(result), ['OPTION_COUNT']);
  assert.equal(result.issues[0].question, 2);
});

test('a global quiz needs 20 questions and the number of its component', () => {
  const rel = `${T1}/Global Quiz/01_Global_Quiz_Informationsmanagement_anwenden.docx`;
  const head = [
    p('01) Informationsmanagement anwenden (§ 4 Abs. 2 Nr. 1)', true),
    p('Global Quiz', true),
  ];
  const rest = quizParagraphs({ count: 19 }).slice(3);
  const result = checkParsed(rel, pathInfo(rel), {
    paragraphs: [...head, ...rest],
  });
  assert.deepEqual(codes(result), ['QUESTION_COUNT']);
  const wrong = checkParsed(rel, pathInfo(rel), {
    paragraphs: [
      p('03) Anderes Thema (§ 4 Abs. 2 Nr. 3)', true),
      p('Global Quiz', true),
      ...quizParagraphs({ count: 20 }).slice(3),
    ],
  });
  assert.deepEqual(codes(wrong), ['CODE_MISMATCH']);
});

test('the expected question count of enabler quizzes is optional', () => {
  const rel = quizPath('1a', 'Low');
  const strict = checkParsed(
    rel,
    pathInfo(rel),
    { paragraphs: quizParagraphs() },
    { expectedQuestions: 10 }
  );
  assert.deepEqual(codes(strict), ['QUESTION_COUNT']);
});

test('checks a scenario and its code', () => {
  const rel = `${T1}/Enablers/1a_Thema/Szenario/Szenario_1a.docx`;
  const ok = checkParsed(rel, pathInfo(rel), {
    paragraphs: scenarioParagraphs(),
  });
  assert.equal(ok.status, 'ok');
  const bad = checkParsed(rel, pathInfo(rel), {
    paragraphs: scenarioParagraphs('1b'),
  });
  assert.deepEqual(codes(bad), ['CODE_MISMATCH']);
});

test('checks a scenario with the section Aufgabe', () => {
  const rel = `${T1}/Enablers/1a_Thema/Szenario/Szenario_1a.docx`;
  // next to the solution section: a task, nothing to report
  const [head, situation, lage, ...rest] = scenarioParagraphs();
  const withTask = checkParsed(rel, pathInfo(rel), {
    paragraphs: [
      head,
      situation,
      lage,
      p('Aufgabe', true),
      p('Eine erfundene Aufgabe.'),
      ...rest,
    ],
  });
  assert.equal(withTask.status, 'ok');
  assert.equal(withTask.stats.taskCharacters, 'Eine erfundene Aufgabe.'.length);
  // instead of the solution section: read as the solution, with a warning
  const inPlace = checkParsed(rel, pathInfo(rel), {
    paragraphs: scenarioParagraphs().map(para =>
      para.text === 'Lösungsszenario' ? p('Aufgabe', true) : para
    ),
  });
  assert.equal(inPlace.status, 'warning');
  assert.deepEqual(codes(inPlace), ['TASK_AS_SOLUTION']);
  assert.equal(inPlace.stats.taskCharacters, 0);
});

const useCaseParagraphs = (code = '1a', { solution = true } = {}) => [
  p(`${code}) Erfundener Titel`),
  p('Behandelte Themen', true),
  p('Erfundenes Thema.'),
  p('Ausgangssituation', true),
  p('Eine erfundene Lage.'),
  p('Eckdaten', true),
  p('Zielsetzung', true),
  p('Ein erfundenes Ziel.'),
  p('Weg zum Ziel', true),
  p('Ein erfundener Schritt.'),
  ...(solution
    ? [p('Musterlösung', true), p('Eine erfundene Lösung OMEGA.')]
    : []),
];

test('checks a use case: sections, code and folder without model solution', () => {
  const rel = `${T1}/K1_Use-Cases/UC_1a_Aufgabe.docx`;
  const ok = checkParsed(rel, pathInfo(rel), {
    paragraphs: useCaseParagraphs(),
  });
  assert.equal(ok.status, 'ok');
  assert.equal(ok.stats.code, '1a');
  assert.ok(ok.stats.solutionCharacters > 0);
  // the report keeps counts, no text
  assert.ok(!JSON.stringify(ok).includes('OMEGA'));

  const bad = checkParsed(rel, pathInfo(rel), {
    paragraphs: useCaseParagraphs('1b'),
  });
  assert.deepEqual(codes(bad), ['CODE_MISMATCH']);

  const without = `${T1}/K1_Use-Cases/Ohne Musterlösung/UC_1a_Aufgabe.docx`;
  const noSolution = checkParsed(without, pathInfo(without), {
    paragraphs: useCaseParagraphs('1a', { solution: false }),
  });
  assert.deepEqual(codes(noSolution).sort(), [
    'FOLDER_WITHOUT_SOLUTION',
    'SECTION_MISSING',
  ]);
  assert.equal(noSolution.status, 'error');
});

test('an enabler text only needs a heading and some text, and keeps its metadata', () => {
  const rel = `${T1}/Enablers/1a_Thema/1a.docx`;
  const ok = checkParsed(rel, pathInfo(rel), {
    stats: { heading: 'Titel', characters: 5000, paragraphs: 40, images: 3 },
    size: 123456,
  });
  assert.equal(ok.status, 'ok');
  assert.deepEqual(ok.stats, {
    heading: 'Titel',
    characters: 5000,
    paragraphs: 40,
    images: 3,
    size: 123456,
  });
  const empty = checkParsed(rel, pathInfo(rel), {
    stats: { heading: null, characters: 0, paragraphs: 0, images: 0 },
  });
  assert.deepEqual(codes(empty), ['ENABLER_EMPTY']);
});

test(
  'reads only the available files, skips placeholders, K18 and archive',
  needsZip,
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-check-'));
    try {
      const write = async (rel, content) => {
        const full = path.join(dir, ...rel.split('/'));
        mkdirSync(path.dirname(full), { recursive: true });
        writeFileSync(full, content);
      };
      await write(quizPath('1a', 'Low'), await docx(quizParagraphs()));
      await write(
        quizPath('1a', 'Medium'),
        await docx(quizParagraphs({ level: 'mittel', breakQ: 1 }))
      );
      await write(quizPath('1a', 'High'), 'das ist kein docx');
      await write(
        `${T1}/Enablers/1a_Thema/Szenario/Szenario_1a.docx`,
        await docx(scenarioParagraphs())
      );
      await write(
        `${T1}/Enablers/1a_Thema/1a.docx`,
        await docx([p('Titel'), p('Text hier.')], 2)
      );
      await write(
        `${K18}/Enablers/18a) Kunden/Quiz/18a_Quiz_Low.docx`,
        await docx(quizParagraphs({ code: '18a' }))
      );
      await write(`${T1}/Enablers/1a_Thema/Archiv/alt.docx`, 'x');
      await write(`${T1}/Use-Cases/egal.pdf`, 'x');
      await write(quizPath('1b', 'Low'), 'noch nicht geladen');

      const placeholders = new Map([
        [`${quizPath('1b', 'Low')}`.toLowerCase(), 0x400000],
      ]);
      const entries = [
        quizPath('1a', 'Low'),
        quizPath('1a', 'Medium'),
        quizPath('1a', 'High'),
        `${T1}/Enablers/1a_Thema/Szenario/Szenario_1a.docx`,
        `${T1}/Enablers/1a_Thema/1a.docx`,
        `${K18}/Enablers/18a) Kunden/Quiz/18a_Quiz_Low.docx`,
        `${T1}/Enablers/1a_Thema/Archiv/alt.docx`,
        `${T1}/Use-Cases/egal.pdf`,
        quizPath('1b', 'Low'),
      ].map(rel => ({
        rel,
        size: 10,
        mtimeMs: 0,
        attributes: placeholders.get(rel.toLowerCase()) ?? 32,
        placeholder: placeholders.has(rel.toLowerCase()),
      }));

      const run = await runCheck(dir, entries);
      assert.deepEqual(
        run.results.map(r => [path.basename(r.rel), r.status]),
        [
          ['1a_Quiz_Low.docx', 'ok'],
          ['1a_Quiz_Medium.docx', 'error'],
          ['1a_Quiz_High.docx', 'read-error'],
          ['Szenario_1a.docx', 'ok'],
          ['1a.docx', 'ok'],
        ]
      );
      assert.equal(run.results[4].stats.images, 2);
      assert.deepEqual(run.skipped.placeholders, [quizPath('1b', 'Low')]);
      assert.equal(run.skipped.excluded, 1);
      assert.equal(run.skipped.archive, 1);
      assert.deepEqual(run.skipped.notParsed, { other: 1 });
      // the source files are untouched
      assert.equal(
        readFileSync(
          path.join(dir, ...quizPath('1b', 'Low').split('/')),
          'utf8'
        ),
        'noch nicht geladen'
      );

      const only = await runCheck(dir, entries, { only: ['scenario'] });
      assert.deepEqual(
        only.results.map(r => r.type),
        ['scenario']
      );
      const limited = await runCheck(dir, entries, { limit: 2 });
      assert.equal(limited.results.length, 2);
      const withK18 = await runCheck(dir, entries, { includeExcluded: true });
      assert.ok(withK18.results.some(r => r.rel.includes('18a_Quiz_Low')));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test(
  'with hydrate the placeholders are read too, one after the other',
  needsZip,
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-hydrate-'));
    try {
      const rel = quizPath('1a', 'Low');
      const full = path.join(dir, ...rel.split('/'));
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, await docx(quizParagraphs()));
      const entries = [
        { rel, size: 10, mtimeMs: 0, attributes: 0x400000, placeholder: true },
      ];
      const skipped = await runCheck(dir, entries);
      assert.equal(skipped.results.length, 0);
      assert.deepEqual(skipped.skipped.placeholders, [rel]);
      const run = await runCheck(dir, entries, { hydrate: true });
      assert.equal(run.results.length, 1);
      assert.equal(run.results[0].status, 'ok');
      assert.equal(run.results[0].hydrated, true);
      assert.equal(summarize(run).files.hydrated, 1);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test('a read that does not finish ends as read error and the run stops after three in a row', async () => {
  const entries = Array.from({ length: 6 }, (_, i) => ({
    rel: quizPath(`${i + 1}a`, 'Low').replace('/01 - ', '/01 - '),
    size: 10,
    mtimeMs: 0,
    attributes: 0x400000,
    placeholder: true,
  }));
  let calls = 0;
  const run = await runCheck('/nirgendwo', entries, {
    hydrate: true,
    timeoutMs: 20,
    readFile: () => {
      calls += 1;
      return new Promise(() => {});
    },
  });
  assert.equal(calls, 3);
  assert.equal(run.aborted, true);
  assert.equal(run.results.length, 3);
  assert.ok(run.results.every(r => r.status === 'read-error'));
  assert.match(run.results[0].issues[0].message, /timeout/i);
  assert.equal(summarize(run).aborted, true);
});

test('the summary counts questions and lists the deviations with count and example', () => {
  const rel1 = quizPath('1a', 'Low');
  const rel2 = quizPath('1b', 'Low');
  const rel3 = quizPath('1c', 'Low');
  const results = [
    {
      rel: rel1,
      ...checkParsed(rel1, pathInfo(rel1), {
        paragraphs: quizParagraphs({ count: 4 }),
      }),
      type: 'quiz',
    },
    {
      rel: rel2,
      ...checkParsed(rel2, pathInfo(rel2), {
        paragraphs: quizParagraphs({ code: '1b', breakQ: 1 }),
      }),
      type: 'quiz',
    },
    {
      rel: rel3,
      ...checkParsed(rel3, pathInfo(rel3), {
        paragraphs: quizParagraphs({ code: '1c', breakQ: 2 }),
      }),
      type: 'quiz',
    },
  ].map(r => ({ ...r, rel: r.rel }));
  const run = {
    results,
    skipped: {
      placeholders: ['a', 'b'],
      excluded: 0,
      archive: 0,
      notParsed: {},
    },
  };
  const summary = summarize(run);
  assert.equal(summary.files.processed, 3);
  assert.equal(summary.files.ok, 1);
  assert.equal(summary.files.withIssues, 2);
  assert.equal(summary.files.placeholders, 2);
  assert.equal(summary.questions, 4 + 3 + 3);
  assert.deepEqual(summary.deviations[0], {
    code: 'OPTION_COUNT',
    severity: 'error',
    files: 2,
    occurrences: 2,
    example: { rel: rel2, message: summary.deviations[0].example.message },
  });
  assert.deepEqual(summary.questionCounts.quiz, { 3: 2, 4: 1 });

  const md = renderCheckSummary(summary);
  for (const heading of [
    '## Ergebnis',
    '## Formatabweichungen',
    '## Fragen je Datei',
  ]) {
    assert.ok(md.includes(heading), heading);
  }
  assert.ok(md.includes('OPTION_COUNT'));
  assert.ok(!/[–—]/.test(md));
  // no question text or solution of the sources in the summary
  assert.ok(!md.includes('Erfundene Frage'));
});

test(
  'the command reports on a small tree and writes JSON and Markdown',
  needsZip,
  async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'kfbm-check-cli-'));
    try {
      const full = path.join(dir, ...quizPath('1a', 'Low').split('/'));
      mkdirSync(path.dirname(full), { recursive: true });
      writeFileSync(full, await docx(quizParagraphs()));
      const out = path.join(dir, 'check.json');
      const run = spawnSync(
        process.execPath,
        [
          'scripts/import/kfbm-parse-check.mjs',
          dir,
          '--out',
          out,
          '--no-attributes',
        ],
        { encoding: 'utf8' }
      );
      assert.equal(run.status, 0, run.stderr);
      const json = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(json.summary.files.processed, 1);
      assert.equal(json.summary.questions, 3);
      assert.ok(existsSync(path.join(dir, 'check.md')));
      // the report holds no solution texts
      assert.ok(!readFileSync(out, 'utf8').includes('Erfunden.'));
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
);

test('the command stops with a message when the folder does not exist', () => {
  const run = spawnSync(
    process.execPath,
    [
      'scripts/import/kfbm-parse-check.mjs',
      path.join(tmpdir(), 'gibt-es-nicht-kfbm'),
    ],
    { encoding: 'utf8' }
  );
  assert.notEqual(run.status, 0);
  assert.match(run.stderr, /not a folder|does not exist/i);
});
