// Tests for scripts/import/kfbm-golden-set.mjs (golden set measurement of the
// rule stage). The documents are invented and built with JSZip, no original
// file of the source is used or copied.
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
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
const golden = JSZip
  ? await import('../../../scripts/import/kfbm-golden-set.mjs')
  : null;

const T1 =
  'Komponente Teil 1 (1-15 Monate)/01 - Informationsmanagement anwenden (§ 4 Abs. 2 Nr. 1)';

const CONTENT_TYPES =
  '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>';
const esc = text => text.replace(/&/g, '&amp;').replace(/</g, '&lt;');
const para = (text, bold = false) =>
  `<w:p><w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(text)}</w:t></w:r></w:p>`;

async function docx(paragraphs) {
  const zip = new JSZip();
  zip.file('[Content_Types].xml', CONTENT_TYPES);
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${paragraphs
      .map(([text, bold]) => para(text, bold))
      .join('')}</w:body></w:document>`
  );
  return zip.generateAsync({ type: 'nodebuffer' });
}

function quizParagraphs(code, level, count = 5) {
  const out = [
    [`${code}) Erfundenes Thema`, false],
    [`Quiz, Schwierigkeitsgrad: ${level}`, true],
  ];
  for (let n = 1; n <= count; n += 1) {
    out.push(
      [`${n}. Erfundene Frage Nummer ${n}?`, true],
      ['A) eins', false],
      ['B) zwei', false],
      ['C) drei', false],
      ['D) vier', false],
      ['Richtige Antwort: B', true],
      ['Kurzbegründung: Erfunden.', false]
    );
  }
  return out;
}

async function makeSource({ stranger = false } = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'golden-'));
  const put = async (rel, paragraphs) => {
    const file = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, await docx(paragraphs));
  };
  await put(
    `${T1}/Enablers/1a_Thema/Quiz/1a_Quiz_Low.docx`,
    quizParagraphs('1a', 'leicht')
  );
  await put(
    `${T1}/Enablers/1a_Thema/Quiz/1a_Quiz_Medium.docx`,
    quizParagraphs('1a', 'mittel')
  );
  await put(
    `${T1}/Enablers/1b_Thema/Quiz/1b_Quiz_Low.docx`,
    quizParagraphs('1b', 'leicht')
  );
  // a document of no known kind, in a folder of the tree: the rules cannot solve it
  if (stranger) {
    await put(`${T1}/Enablers/1b_Thema/Quiz/1b_Quiz_Medium.docx`, [
      ['Eine erfundene Notiz ohne jede Struktur', false],
    ]);
  }
  return root;
}

/** Runs main() and returns what it printed. */
async function run(argv) {
  const lines = [];
  const original = console.log;
  console.log = (...args) => lines.push(args.join(' '));
  try {
    const code = await golden.main(argv);
    return { code, text: lines.join('\n') };
  } finally {
    console.log = original;
  }
}

test(
  'measures a small invented source in both modes and prints numbers only',
  needsZip,
  async () => {
    const root = await makeSource();
    try {
      const { code, text } = await run([root, '--min-ratio', '50']);
      assert.equal(code, 0, text);
      assert.match(text, /Dateien in der Quelle: 3, gelesen: 3/);
      assert.match(text, /Modus Pfadstruktur: 3 Dateien/);
      assert.match(text, /Modus nur Dateiname: 3 Dateien/);
      assert.match(text, /Ziel erreicht/);
      // no path, no title and no text of a document
      for (const secret of [
        'Informationsmanagement',
        'Erfundene Frage',
        'Erfundenes Thema',
        '1a_Quiz_Low',
        root,
      ]) {
        assert.ok(
          !text.includes(secret),
          `the summary must not hold ${secret}`
        );
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  'exits with 1 when the share without the model is below the target',
  needsZip,
  async () => {
    const root = await makeSource({ stranger: true });
    try {
      const { code, text } = await run([root, '--min-ratio', '100']);
      assert.equal(code, 1);
      assert.match(text, /Ziel verfehlt/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  'writes the numbers as JSON and leaves the keys out unless asked',
  needsZip,
  async () => {
    const root = await makeSource();
    const out = path.join(root, '..', `golden-out-${Date.now()}.json`);
    try {
      const { code } = await run([root, '--min-ratio', '50', '--out', out]);
      assert.equal(code, 0);
      const { readFileSync } = await import('node:fs');
      const json = JSON.parse(readFileSync(out, 'utf8'));
      assert.equal(json.modes.length, 2);
      assert.equal(json.modes[0].keys, undefined);
      assert.equal(json.read.read, 3);
      assert.ok(!JSON.stringify(json).includes('Erfundene Frage'));
    } finally {
      rmSync(out, { force: true });
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test('answers a wrong call with exit code 2', needsZip, async () => {
  const silent = console.error;
  console.error = () => undefined;
  try {
    assert.equal((await run([])).code, 2);
    assert.equal((await run(['a', 'b'])).code, 2);
    assert.equal((await run(['x', '--mode', 'tree'])).code, 2);
    assert.equal((await run(['x', '--min-ratio', 'abc'])).code, 2);
    assert.equal((await run(['x', '--limit', 'abc'])).code, 2);
    assert.equal((await run(['x', '--hydrat'])).code, 2);
    assert.equal((await run(['x', '--out'])).code, 2);
  } finally {
    console.error = silent;
  }
});

test(
  'skips OneDrive placeholders without --hydrate and counts them',
  needsZip,
  async () => {
    let reads = 0;
    const entries = [
      { rel: 'a.docx', size: 1, mtimeMs: 1, placeholder: true },
      { rel: 'b.docx', size: 1, mtimeMs: 1, placeholder: false },
    ];
    const readBytes = async () => {
      reads += 1;
      return Buffer.from('not a document');
    };
    const skipped = await golden.readSource('.', entries, { readBytes });
    assert.equal(skipped.stats.placeholdersSkipped, 1);
    assert.equal(reads, 1);
    assert.equal(skipped.stats.unreadable, 1);
    reads = 0;
    const hydrated = await golden.readSource('.', entries, {
      readBytes,
      hydrate: true,
    });
    assert.equal(hydrated.stats.placeholdersSkipped, 0);
    assert.equal(reads, 2);
  }
);

test('stops after three timeouts in a row', needsZip, async () => {
  const entries = Array.from({ length: 6 }, (_, i) => ({
    rel: `f${i}.docx`,
    size: 1,
    mtimeMs: 1,
    placeholder: false,
  }));
  const readBytes = () => new Promise(() => undefined);
  const { stats } = await golden.readSource('.', entries, {
    readBytes,
    timeoutMs: 5,
  });
  assert.equal(stats.aborted, true);
  assert.equal(stats.timeouts, 3);
});

test(
  'the gate fails on a wrong high band but not on a known error of the source',
  needsZip,
  () => {
    const mode = (name, share, wrongHigh) => ({
      mode: name,
      shares: { correctWithoutModel: share },
      wrongHigh,
    });
    assert.equal(golden.gateOf([mode('path', 99, 0)], 92).ok, true);
    assert.equal(golden.gateOf([mode('path', 91, 0)], 92).ok, false);
    const wrong = golden.gateOf([mode('names', 99, 1)], 92);
    assert.equal(wrong.ok, false);
    assert.match(wrong.failures[0], /band high/);
  }
);

const row = (key, proposedKey, band, correct, type = 'scenario') => ({
  key,
  proposedKey,
  type,
  band,
  correct,
  reasons: [],
});

test(
  'summarizeRows counts bands, shares and the known error of the source',
  needsZip,
  () => {
    const rows = [
      row('quiz:1a:low', 'quiz:1a:low', 'high', true, 'quiz'),
      row('quiz:1b:low', 'quiz:1b:low', 'medium', true, 'quiz'),
      row('quiz:1c:low', null, 'low', false, 'quiz'),
      // the folder says 23b, the file follows its content (the known case)
      row('scenario:23b', 'scenario:23c', 'high', false),
    ];
    const s = golden.summarizeRows(rows, [1, 2, 3, 4], 'names');
    assert.deepEqual(s.bands, { high: 2, medium: 1, low: 1, conflict: 0 });
    assert.equal(s.shares.correctWithoutModel, 50);
    assert.equal(s.shares.withoutModel, 75);
    assert.equal(s.wrongHigh, 0);
    assert.equal(s.wrongHighKnownSourceError, 1);
    assert.equal(s.wrongResolved, 1);
    assert.deepEqual(s.keys.unclear, ['quiz:1c:low']);
  }
);

test(
  'a wrong high band on the known file still counts when the proposal is something else',
  needsZip,
  () => {
    const s = golden.summarizeRows(
      [row('scenario:23b', 'scenario:5a', 'high', false)],
      [1],
      'path'
    );
    assert.equal(s.wrongHigh, 1);
    assert.equal(s.wrongHighKnownSourceError, 0);
    assert.equal(golden.gateOf([s], 0).ok, false);
  }
);

test(
  'parseArgs takes known flags only and a value for every flag that needs one',
  needsZip,
  () => {
    const ok = golden.parseArgs([
      'src',
      '--mode',
      'names',
      '--limit',
      '5',
      '--show-keys',
    ]);
    assert.equal(ok.ok, true);
    assert.deepEqual(ok.modes, ['names']);
    assert.equal(ok.limit, 5);
    assert.equal(ok.showKeys, true);
    assert.equal(golden.parseArgs(['src', '--limit', '0']).ok, false);
    assert.equal(golden.parseArgs(['src', '--limit', '1.5']).ok, false);
    assert.equal(golden.parseArgs(['src', '--min-ratio', '120']).ok, false);
    assert.equal(golden.parseArgs(['src', '--out', '--hydrate']).ok, false);
    assert.equal(golden.parseArgs(['src', '--unknown']).ok, false);
    assert.equal(golden.parseArgs([]).ok, false);
  }
);

test('the truth comes from the full path', needsZip, () => {
  const truth = golden.truthOf(
    `${T1}/Enablers/1a_Thema/Quiz/1a_Quiz_High.docx`
  );
  assert.equal(truth.docType, 'quiz');
  assert.equal(truth.componentCode, 'K1');
  assert.equal(truth.enablerCode, 'K1-a');
  assert.equal(truth.quizLevel, 'high');
  assert.equal(truth.key, 'quiz:1a:high');
});
