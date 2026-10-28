// Tests for the mode --from-word of the PDF import: the converter (scripts/import/kfbm-word-pdf.mjs)
// and the scan of the Word tree (scripts/import/kfbm-documents-word.mjs). Every Word file is invented.
// The conversion is tested with a stand-in that implements the same interface and writes a PDF with
// the text of the docx. One short test runs the real LibreOffice on an invented docx and is skipped
// when LibreOffice is not installed. Nothing here talks to a database, a storage or a network.
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';

// JSZip and pdf-lib build the invented documents. The workflow db-checks runs these tests without
// installed dependencies, then the tests that need them are skipped.
const JSZip = await import('jszip').then(
  module => module.default,
  () => null
);
const PDFLib = await import('pdf-lib').then(
  module => module,
  () => null
);
const { PDFDocument, PDFName, StandardFonts } = PDFLib ?? {};
const needs = {
  skip: JSZip && PDFLib ? false : 'jszip or pdf-lib is not installed',
};

import { buildDocumentPlan } from '../../../scripts/import/kfbm-documents-modules.mjs';
import {
  pdfInfo,
  renderWordSummary,
  scanWordSource,
  summarizeSkips,
} from '../../../scripts/import/kfbm-documents-word.mjs';
import { loadDecisions } from '../../../scripts/import/kfbm-use-cases.mjs';
import { attributeKey } from '../../../scripts/import/kfbm-source.mjs';
import {
  PROFILE_SETTINGS,
  cleanEnvironment,
  convertArguments,
  createLibreOfficeConverter,
  createWorkspace,
  findSoffice,
  killTree,
} from '../../../scripts/import/kfbm-word-pdf.mjs';
import { extractDocxParagraphs } from '../../../scripts/import/kfbm-source.mjs';

const T1 =
  'Komponente Teil 1 (1-15 Monate)/01 - Erfundenes Thema (§ 4 Abs. 2 Nr. 1)';
const SOLUTION_WORD = 'OMEGA';
const KNOWLEDGE_WORD = 'SIGMA';
const USE_CASE_WORD = 'KAPPA';

const p = (text, bold = false) => ({ text, bold });
const esc = text =>
  text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

async function docx(paragraphs, { parts = {} } = {}) {
  const body = paragraphs
    .map(
      para =>
        `<w:p>${
          para.text
            ? `<w:r>${para.bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${esc(para.text)}</w:t></w:r>`
            : ''
        }</w:p>`
    )
    .join('');
  const zip = new JSZip();
  zip.file(
    '[Content_Types].xml',
    '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>'
  );
  zip.file(
    '_rels/.rels',
    '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>'
  );
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}<w:sectPr><w:pgSz w:w="11906" w:h="16838"/></w:sectPr></w:body></w:document>`
  );
  for (const [name, content] of Object.entries(parts)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
}

const scenario = (code, { omitSolution = false } = {}) => [
  p(`Szenario ${code}) Erfundenes Thema`, true),
  p('Ausgangssituation', true),
  p('Eine erfundene Lage für den Test.'),
  ...(omitSolution
    ? []
    : [
        p('Lösungsszenario', true),
        p(`Eine erfundene Lösung ${SOLUTION_WORD}.`),
        p('Wie das Fachwissen zur Lösung beiträgt', true),
        p(`Ein erfundener Beitrag ${KNOWLEDGE_WORD}.`),
      ]),
];
const useCase = code => [
  p(`${code}) Erfundener Titel`),
  p('Ausgangssituation', true),
  p('Die erfundene Firma hat ein Problem.'),
  p('Zielsetzung', true),
  p('Erstellen Sie einen erfundenen Vorschlag.'),
  p('Weg zum Ziel', true),
  p('Erster Schritt: Daten erfassen.'),
  p('Musterlösung', true),
  p(`Die erfundene Antwort ${USE_CASE_WORD} nennt zwölf Schrauben.`),
];
const enabler = code => [
  p(`${code}) Erfundenes Thema`, true),
  p('Erfundener Lehrtext für den Test.'),
];

async function put(root, rel, paragraphs, options) {
  const full = path.join(root, ...rel.split('/'));
  mkdirSync(path.dirname(full), { recursive: true });
  writeFileSync(full, await docx(paragraphs, options));
}

const ENABLER_1A = `${T1}/Enablers/1a_Thema`;

async function sampleTree(root) {
  await put(root, `${ENABLER_1A}/1a.docx`, enabler('1a'));
  await put(root, `${ENABLER_1A}/Szenario/Szenario_1a.docx`, scenario('1a'));
  await put(root, `${T1}/K1_Use-Cases/UC_1a_Aufgabe.docx`, useCase('1a'));
}

/**
 * A small valid PDF (made with pdf-lib) whose page text is a plain, not compressed content stream, one
 * line per text operator. The reader of the import (pdf-parse) cannot read what pdf-lib compresses, so
 * the tests read the text back with textInfo below. The real reader is used in the test with the real
 * LibreOffice.
 */
async function rawPdf(lines, author = '') {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const page = doc.addPage([595, 842]);
  page.drawText(' ', { x: 0, y: 0, size: 1, font }); // puts the font into the resources
  const escape = line => line.replace(/[()\\]/g, ch => `\\${ch}`);
  const content = lines
    .map(
      (line, i) =>
        `BT /${font.name} 8 Tf 20 ${800 - i * 12} Td (${escape(line)}) Tj ET`
    )
    .join('\n');
  page.node.set(
    PDFName.of('Contents'),
    doc.context.register(doc.context.stream(content))
  );
  doc.setAuthor(author);
  return doc.save({ useObjectStreams: false });
}

/** Reads the lines back from a PDF made by rawPdf (also after the clean step). */
function textInfo(bytes) {
  const text = Buffer.from(bytes).toString('latin1');
  const lines = [...text.matchAll(/\((.*)\) Tj ET/g)].map(m =>
    m[1].replace(/\\([()\\])/g, '$1')
  );
  return lines.length > 0
    ? Promise.resolve({ text: lines.join('\n'), pageCount: 1 })
    : Promise.resolve(null);
}

/** The stand-in: writes a PDF with the lines of the docx, like a converter would show them. */
function standInConverter({ extra = '', fail = null, notPdf = false } = {}) {
  const calls = [];
  return {
    calls,
    async convert(input, output) {
      calls.push(input);
      if (fail) return { ok: false, code: fail };
      if (notPdf) {
        writeFileSync(output, 'not a pdf');
        return { ok: true };
      }
      const lines = (await extractDocxParagraphs(readFileSync(input)))
        .map(para => para.text)
        .filter(text => text.length > 0);
      writeFileSync(
        output,
        await rawPdf([...lines, ...(extra ? [extra] : [])], 'Erika Mustermann')
      );
      return { ok: true };
    },
  };
}

const args = (over = {}) => ({
  components: [],
  hydrate: false,
  noAttributes: true,
  timeoutSeconds: null,
  ...over,
});

async function scan(root, converter, over = {}, deps = {}) {
  const workspace = converter ? createWorkspace('kfbm-word-test-') : null;
  try {
    const result = await scanWordSource(root, args(over), {
      decisions: loadDecisions(),
      workspace,
      converter,
      info: textInfo,
      ...deps,
    });
    // read the files before the temp folder goes away
    const bytes = new Map(
      [...result.paths].map(([rel, file]) => [rel, readFileSync(file)])
    );
    const inLeft = workspace ? readdirSync(workspace.inDir) : [];
    const finalLeft = workspace ? readdirSync(workspace.finalDir) : [];
    return { ...result, bytes, inLeft, finalLeft, workspace };
  } finally {
    workspace?.cleanup();
  }
}

const tmp = () => mkdtempSync(path.join(tmpdir(), 'kfbm-word-src-'));

// the converter ------------------------------------------------------------------------------

test('findSoffice: the given path, the environment, a standard place, and only a program named soffice', () => {
  const exists = file =>
    file === '/opt/lo/soffice' || file === '/usr/bin/soffice';
  assert.deepEqual(findSoffice('/opt/lo/soffice', {}, exists, 'linux'), {
    path: '/opt/lo/soffice',
  });
  assert.deepEqual(
    findSoffice(null, { KFBM_SOFFICE: '/opt/lo/soffice' }, exists, 'linux'),
    { path: '/opt/lo/soffice' }
  );
  assert.deepEqual(findSoffice(null, {}, exists, 'linux'), {
    path: '/usr/bin/soffice',
  });
  assert.match(
    findSoffice('/opt/lo/other', {}, exists, 'linux').error,
    /named soffice/
  );
  assert.match(
    findSoffice('/opt/none/soffice', {}, exists, 'linux').error,
    /not found at the given path/
  );
  assert.match(findSoffice(null, {}, () => false, 'linux').error, /--soffice/);
  assert.equal(
    findSoffice('C:\\LO\\SOFFICE.EXE', {}, () => true, 'win32').path,
    'C:\\LO\\SOFFICE.EXE'
  );
});

test('findSoffice refuses a relative path, also from the environment, and a network share', () => {
  const always = () => true;
  for (const [given, platform] of [
    ['soffice', 'linux'],
    ['./soffice', 'linux'],
    ['soffice.exe', 'win32'],
    ['..\\soffice.exe', 'win32'],
    ['\\\\server\\share\\soffice.exe', 'win32'],
    ['//server/share/soffice', 'linux'],
  ]) {
    assert.match(
      findSoffice(given, {}, always, platform).error,
      /absolute path/,
      given
    );
    assert.match(
      findSoffice(null, { KFBM_SOFFICE: given }, always, platform).error,
      /absolute path/,
      given
    );
  }
});

test('abort ends a conversion that is running and does nothing otherwise', async () => {
  const workspace = createWorkspace('kfbm-word-test-');
  try {
    let child = null;
    const killed = [];
    const converter = createLibreOfficeConverter({
      soffice: '/opt/lo/soffice',
      workspace,
      timeoutMs: 60000,
      spawnImpl: fakeSpawn(c => {
        child = c;
      }),
      // a spy: the made up pid must never reach a real kill
      killSync: (pid, platform) => killed.push([pid, platform]),
      platform: 'linux',
    });
    converter.abort(); // nothing runs: nothing is killed
    assert.deepEqual(killed, []);
    const running = converter.convert(
      path.join(workspace.inDir, '1.docx'),
      path.join(workspace.finalDir, '1.pdf')
    );
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(child);
    converter.abort();
    assert.deepEqual(killed, [[4242, 'linux']]);
    child.emit('close', 1);
    assert.deepEqual(await running, { ok: false, code: 'EXIT' });
    converter.abort(); // the conversion is over: nothing more is killed
    assert.equal(killed.length, 1);
  } finally {
    workspace.cleanup();
  }
});

test('the program gets a list of arguments with its own profile, no shell and a small environment', () => {
  const list = convertArguments(
    '/tmp/run/profile',
    '/tmp/run/out',
    '/tmp/run/in/1.docx'
  );
  assert.ok(list.includes('--headless'));
  assert.ok(list.includes('--norestore'));
  assert.ok(list.some(a => a.startsWith('-env:UserInstallation=file:///')));
  assert.equal(list[list.length - 1], '/tmp/run/in/1.docx');
  const env = cleanEnvironment({
    PATH: '/bin',
    DB_CONNECTION_STRING: 'postgres://secret',
    SUPABASE_SECRET_KEY: 'key',
    HTTPS_PROXY: 'x',
    TEMP: '/tmp',
  });
  assert.deepEqual(env, { PATH: '/bin', TEMP: '/tmp' });
});

test('the profile switches off macros, links and the network', () => {
  assert.match(PROFILE_SETTINGS, /MacroSecurityLevel[^>]*><value>3</);
  assert.match(PROFILE_SETTINGS, /DisableMacrosExecution[^>]*><value>true</);
  assert.match(
    PROFILE_SETTINGS,
    /Content\/Update"><prop oor:name="Link"[^>]*><value>2</
  );
  // the proxy keys live in org.openoffice.Inet/Settings (checked in the registry of LibreOffice)
  assert.match(
    PROFILE_SETTINGS,
    /org\.openoffice\.Inet\/Settings"><prop oor:name="ooInetProxyType"[^>]*><value>2</
  );
  assert.doesNotMatch(PROFILE_SETTINGS, /Common\/Internet/);
  assert.match(PROFILE_SETTINGS, /127\.0\.0\.1/);
});

test('the workspace is short, holds the profile and is removed completely', () => {
  const workspace = createWorkspace('kfbm-word-test-');
  assert.ok(workspace.root.length <= 120);
  assert.ok(
    existsSync(
      path.join(workspace.profileDir, 'user', 'registrymodifications.xcu')
    )
  );
  writeFileSync(path.join(workspace.inDir, 'x.docx'), 'x');
  workspace.cleanup();
  assert.equal(existsSync(workspace.root), false);
});

function fakeSpawn(behave) {
  const calls = [];
  const impl = (command, list, options) => {
    const child = new EventEmitter();
    child.pid = 4242;
    calls.push({ command, list, options, child });
    queueMicrotask(() => behave(child, list));
    return child;
  };
  impl.calls = calls;
  return impl;
}

test('the converter: success moves the PDF, the call is safe', async () => {
  const workspace = createWorkspace('kfbm-word-test-');
  try {
    const spawnImpl = fakeSpawn((child, list) => {
      const input = list[list.length - 1];
      writeFileSync(
        path.join(workspace.outDir, `${path.basename(input, '.docx')}.pdf`),
        '%PDF-1.7 ok'
      );
      child.emit('close', 0);
    });
    const converter = createLibreOfficeConverter({
      soffice: '/opt/lo/soffice',
      workspace,
      spawnImpl,
      env: {
        PATH: '/bin',
        DB_CONNECTION_STRING: 'postgres://secret',
        SUPABASE_SECRET_KEY: 'k',
      },
      platform: 'linux',
    });
    const output = path.join(workspace.finalDir, '1.pdf');
    assert.deepEqual(
      await converter.convert(path.join(workspace.inDir, '1.docx'), output),
      { ok: true }
    );
    assert.equal(readFileSync(output, 'utf8'), '%PDF-1.7 ok');
    const [call] = spawnImpl.calls;
    assert.equal(call.command, '/opt/lo/soffice');
    assert.equal(call.options.shell, false);
    assert.equal(call.options.windowsHide, true);
    assert.deepEqual(Object.keys(call.options.env), ['PATH']);
    assert.ok(call.list.includes('--convert-to'));
  } finally {
    workspace.cleanup();
  }
});

test('the converter: exit code, no output and a program that does not start are failures', async () => {
  const workspace = createWorkspace('kfbm-word-test-');
  try {
    const make = behave =>
      createLibreOfficeConverter({
        soffice: '/opt/lo/soffice',
        workspace,
        spawnImpl: fakeSpawn(behave),
        platform: 'linux',
      });
    const input = path.join(workspace.inDir, '1.docx');
    const output = path.join(workspace.finalDir, '1.pdf');
    assert.deepEqual(
      await make(child => child.emit('close', 1)).convert(input, output),
      { ok: false, code: 'EXIT' }
    );
    assert.deepEqual(
      await make(child => child.emit('close', 0)).convert(input, output),
      { ok: false, code: 'NO_OUTPUT' }
    );
    assert.deepEqual(
      await make(child => child.emit('error', new Error('x'))).convert(
        input,
        output
      ),
      { ok: false, code: 'SPAWN' }
    );
    const throwing = createLibreOfficeConverter({
      soffice: '/opt/lo/soffice',
      workspace,
      spawnImpl: () => {
        throw new Error('no');
      },
      platform: 'linux',
    });
    assert.deepEqual(await throwing.convert(input, output), {
      ok: false,
      code: 'SPAWN',
    });
    assert.equal(existsSync(output), false);
  } finally {
    workspace.cleanup();
  }
});

test('the converter: at the time limit the process tree is ended and the file fails', async () => {
  const workspace = createWorkspace('kfbm-word-test-');
  try {
    const killed = [];
    const converter = createLibreOfficeConverter({
      soffice: '/opt/lo/soffice',
      workspace,
      timeoutMs: 30,
      spawnImpl: fakeSpawn(() => {
        // never ends by itself
      }),
      kill: async (pid, platform) => {
        killed.push([pid, platform]);
        // the end of the process is reported after the kill
        queueMicrotask(() => {});
      },
      killGraceMs: 20,
      platform: 'win32',
    });
    const result = await converter.convert(
      path.join(workspace.inDir, '1.docx'),
      path.join(workspace.finalDir, '1.pdf')
    );
    assert.deepEqual(result, { ok: false, code: 'TIMEOUT' });
    assert.deepEqual(killed, [[4242, 'win32']]);
  } finally {
    workspace.cleanup();
  }
});

test('killTree asks taskkill for the whole tree on Windows and never throws', async () => {
  const seen = [];
  await killTree(77, 'win32', (command, list, options) => {
    seen.push({ command, list, options });
    const child = new EventEmitter();
    queueMicrotask(() => child.emit('close', 0));
    return child;
  });
  assert.deepEqual(seen[0].list, ['/PID', '77', '/T', '/F']);
  assert.match(seen[0].command, /System32.taskkill\.exe$/i);
  assert.ok(path.win32.isAbsolute(seen[0].command));
  assert.equal(seen[0].options.shell, false);
  await killTree(77, 'win32', () => {
    throw new Error('no taskkill');
  });
});

// the scan of the Word tree -----------------------------------------------------------------

test(
  'plan without a converter only counts the Word files and converts nothing',
  needs,
  async () => {
    const root = tmp();
    try {
      await sampleTree(root);
      const result = await scan(root, null);
      assert.deepEqual(result.counts.chosen, {
        enabler: 1,
        scenario: 1,
        usecase: 1,
      });
      assert.deepEqual(result.counts.variants, {
        enabler: 1,
        scenario: 1,
        usecase_task: 1,
        usecase_solution: 1,
      });
      assert.equal(result.files.length, 0);
      assert.equal(result.converted, false);
      assert.deepEqual(result.skips, []);
      assert.match(renderWordSummary(result), /not converted in this mode/);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  'converts the four PDFs of a sample tree: names, plan, whole scenario, no solution in the task PDF, temp files gone',
  needs,
  async () => {
    const root = tmp();
    try {
      await sampleTree(root);
      const converter = standInConverter();
      const result = await scan(root, converter);
      assert.deepEqual(result.skips, []);
      assert.equal(converter.calls.length, 4);
      const names = result.files.map(f => f.rel.split('/').pop()).sort();
      assert.deepEqual(
        names,
        [
          '1a.pdf',
          'Szenario_1a.pdf',
          'UC_1a.pdf',
          'UC_1a_Musterlösung.pdf',
        ].sort()
      );

      const plan = buildDocumentPlan(result.files);
      assert.deepEqual(
        plan.items.map(i => `${i.kind}:${i.status}:${i.enablerCode}`).sort(),
        [
          'enabler:ok:K1-a',
          'scenario:ok:K1-a',
          'usecase_solution:ok:K1-a',
          'usecase_task:ok:K1-a',
        ]
      );

      const textOf = async rel => (await textInfo(result.bytes.get(rel))).text;
      const rels = Object.fromEntries(
        result.files.map(f => [f.rel.split('/').pop(), f.rel])
      );
      const scenarioText = await textOf(rels['Szenario_1a.pdf']);
      assert.match(scenarioText, /erfundene Lage/);
      // the whole scenario: solution and the text "how the knowledge helps" stay in the public PDF
      assert.match(scenarioText, new RegExp(SOLUTION_WORD));
      assert.match(scenarioText, new RegExp(KNOWLEDGE_WORD));
      assert.match(scenarioText, /sungsszenario/);
      const taskText = await textOf(rels['UC_1a.pdf']);
      assert.match(taskText, /Weg zum Ziel/);
      assert.doesNotMatch(taskText, new RegExp(`${USE_CASE_WORD}|Musterl`));
      assert.match(
        await textOf(rels['UC_1a_Musterlösung.pdf']),
        new RegExp(USE_CASE_WORD)
      );

      // the metadata is cleaned: no author, the title of the document
      for (const bytes of result.bytes.values()) {
        assert.doesNotMatch(
          Buffer.from(bytes).toString('latin1'),
          /Mustermann/
        );
      }
      // the copies of the Word files are deleted at once, the temp folder at the end
      assert.deepEqual(result.inLeft, []);
      assert.equal(result.finalLeft.length, 4);
      assert.equal(existsSync(result.workspace.root), false);
      // the source is untouched
      assert.ok(
        existsSync(path.join(root, ...`${ENABLER_1A}/1a.docx`.split('/')))
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  'a second scan gives the same names and the same plan (idempotent input of the import)',
  needs,
  async () => {
    const root = tmp();
    try {
      await sampleTree(root);
      const first = await scan(root, standInConverter());
      const second = await scan(root, standInConverter());
      const shape = r =>
        buildDocumentPlan(r.files).items.map(i => [
          i.rel,
          i.kind,
          i.enablerCode,
          i.status,
          i.pageCount,
        ]);
      assert.deepEqual(shape(second), shape(first));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  'a PDF whose text shows the solution is dropped although the docx was cut, except the whole scenario',
  needs,
  async () => {
    const root = tmp();
    try {
      await sampleTree(root);
      const result = await scan(
        root,
        standInConverter({ extra: 'Lösungsszenario' })
      );
      // the enabler PDF and the task PDF carry the line too and are dropped; the solution PDF is not for
      // the trainees, the scenario is whole and public
      const dropped = result.skips
        .filter(s => s.code === 'PDF_SOLUTION')
        .map(s => s.kind)
        .sort();
      assert.deepEqual(dropped, ['enabler', 'usecase_task']);
      assert.ok(result.files.some(f => /Szenario_1a/.test(f.rel)));
      assert.ok(result.files.some(f => /Musterl/.test(f.rel)));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  'failed conversions and unreadable PDFs are reported with a code and give no file',
  needs,
  async () => {
    const root = tmp();
    try {
      await sampleTree(root);
      const failed = await scan(root, standInConverter({ fail: 'TIMEOUT' }));
      assert.equal(failed.files.length, 0);
      assert.deepEqual(summarizeSkips(failed.skips), { CONVERSION_FAILED: 4 });
      assert.ok(failed.skips.every(s => s.detail === 'TIMEOUT'));
      const unreadable = await scan(root, standInConverter({ notPdf: true }));
      assert.deepEqual(summarizeSkips(unreadable.skips), { PDF_UNREADABLE: 4 });
      const summary = renderWordSummary(failed);
      assert.match(summary, /CONVERSION_FAILED 4/);
      assert.doesNotMatch(
        summary,
        new RegExp(`${SOLUTION_WORD}|erfundene Lage`)
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  'a Word file that cannot be cut or read gives no PDF and the others still do',
  needs,
  async () => {
    const root = tmp();
    try {
      await sampleTree(root);
      // the scenario of 1b has no solution part: the parser of the content import refuses it
      await put(
        root,
        `${T1}/Enablers/1b_Zweites/Szenario/Szenario_1b.docx`,
        scenario('1b', { omitSolution: true })
      );
      await put(root, `${T1}/Enablers/1b_Zweites/1b.docx`, enabler('1b'));
      // a heading of another enabler
      await put(root, `${T1}/Enablers/1c_Drittes/1c.docx`, enabler('1d'));
      // a file that is no docx
      mkdirSync(path.join(root, ...`${T1}/Enablers/1e_Fuenftes`.split('/')), {
        recursive: true,
      });
      writeFileSync(
        path.join(root, ...`${T1}/Enablers/1e_Fuenftes/1e.docx`.split('/')),
        'no zip'
      );
      const result = await scan(root, standInConverter());
      const byFile = Object.fromEntries(
        result.skips.map(s => [path.basename(s.rel), s.code])
      );
      assert.equal(byFile['Szenario_1b.docx'], 'PARSE_ERROR');
      assert.equal(byFile['1c.docx'], 'CODE_MISMATCH');
      assert.equal(byFile['1e.docx'], 'NOT_A_DOCX');
      const names = result.files.map(f => f.rel.split('/').pop());
      assert.ok(names.includes('Szenario_1a.pdf'));
      assert.ok(names.includes('1b.pdf'));
      assert.ok(!names.includes('Szenario_1b.pdf'));
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  'an enabler text that repeats the solution of a scenario is not turned into a PDF',
  needs,
  async () => {
    const root = tmp();
    try {
      await sampleTree(root);
      await put(root, `${T1}/Enablers/1b_Zweites/1b.docx`, [
        p('1b) Zweites Thema', true),
        p(`Erfundener Lehrtext. Eine erfundene Lösung ${SOLUTION_WORD}.`),
      ]);
      // the text of 1b repeats the whole solution of scenario 1a (the guard compares whole solution texts)
      await put(
        root,
        `${T1}/Enablers/1b_Zweites/Szenario/Szenario_1b.docx`,
        scenario('1b')
      );
      const withRepeat = await docx([
        p('1c) Drittes Thema', true),
        p(`Eine erfundene Lösung ${SOLUTION_WORD}.`),
      ]);
      mkdirSync(path.join(root, ...`${T1}/Enablers/1c_Drittes`.split('/')), {
        recursive: true,
      });
      writeFileSync(
        path.join(root, ...`${T1}/Enablers/1c_Drittes/1c.docx`.split('/')),
        withRepeat
      );
      const result = await scan(root, standInConverter());
      const byFile = Object.fromEntries(
        result.skips.map(s => [path.basename(s.rel), s.code])
      );
      assert.equal(byFile['1c.docx'], 'SOLUTION_MARKER');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  'a placeholder is not read without --hydrate and is read with it (a stand-in marks it)',
  needs,
  async () => {
    const root = tmp();
    try {
      await sampleTree(root);
      const marked = new Map([
        [attributeKey(`${ENABLER_1A}/1a.docx`), 0x400000],
      ]);
      let reads = 0;
      const read = file => {
        reads += 1;
        return readFile(file);
      };
      const without = await scan(root, null, {}, { attributes: marked, read });
      assert.deepEqual(
        without.skips.map(s => s.code),
        ['PLACEHOLDER']
      );
      assert.equal(without.counts.variants.enabler, 0);
      const before = reads;
      const hydrated = await scan(
        root,
        null,
        { hydrate: true },
        { attributes: marked, read }
      );
      assert.deepEqual(hydrated.skips, []);
      assert.equal(hydrated.counts.variants.enabler, 1);
      assert.ok(reads > before);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  'a read that hangs is stopped by the limit and three in a row stop the run',
  needs,
  async () => {
    const root = tmp();
    try {
      await sampleTree(root);
      await put(root, `${T1}/Enablers/1b_Zweites/1b.docx`, enabler('1b'));
      const read = () => new Promise(() => {});
      const result = await scan(root, null, { timeoutSeconds: 0.03 }, { read });
      assert.ok(result.skips.length >= 4);
      assert.ok(result.skips.every(s => s.code === 'READ_ERROR'));
      assert.ok(result.skips.some(s => /three timeouts/.test(s.detail ?? '')));
      assert.equal(result.counts.variants.enabler, 0);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test(
  'a path longer than 259 characters is read and converted through a short copy',
  needs,
  async () => {
    const root = tmp();
    try {
      const long = 'x'.repeat(110);
      const component = `Komponente Teil 1 (1-15 Monate)/01 - Erfundenes Thema ${long} (§ 4 Abs. 2 Nr. 1)`;
      const rel = `${component}/Enablers/1a_${long}/1a.docx`;
      await put(root, rel, enabler('1a'));
      assert.ok(path.join(root, ...rel.split('/')).length > 259);
      const converter = standInConverter();
      const result = await scan(root, converter);
      assert.deepEqual(result.skips, []);
      assert.equal(result.files.length, 1);
      // the program only ever saw the short copy
      assert.ok(converter.calls.every(file => file.length < 120));
      assert.match(
        result.files[0].rel,
        /^01 - Erfundenes Thema x+\/Enabler\/1a\.pdf$/
      );
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
);

test('--components limits the Word files', needs, async () => {
  const root = tmp();
  try {
    await sampleTree(root);
    const other = await scan(root, null, { components: ['K5'] });
    assert.deepEqual(other.counts.chosen, {
      enabler: 0,
      scenario: 0,
      usecase: 0,
    });
    const same = await scan(root, null, { components: ['K1'] });
    assert.equal(same.counts.chosen.enabler, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// the real LibreOffice ----------------------------------------------------------------------

const soffice = findSoffice(null);
const needsOffice = {
  skip: soffice.path ? needs.skip || false : 'LibreOffice is not installed',
};

test(
  'the real LibreOffice converts an invented docx: whole scenario, clean metadata, no leftovers',
  needsOffice,
  async () => {
    const root = tmp();
    const workspace = createWorkspace('kfbm-word-real-');
    try {
      // an external picture and a macro part must be removed before the program sees the file
      await put(
        root,
        `${ENABLER_1A}/Szenario/Szenario_1a.docx`,
        scenario('1a'),
        {
          parts: {
            'word/_rels/document.xml.rels':
              '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId9" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="http://127.0.0.1:9/x.png" TargetMode="External"/></Relationships>',
            'word/vbaProject.bin': 'not a macro',
          },
        }
      );
      const converter = createLibreOfficeConverter({
        soffice: soffice.path,
        workspace,
        timeoutMs: 120000,
      });
      const result = await scanWordSource(root, args(), {
        decisions: loadDecisions(),
        workspace,
        converter,
      });
      assert.deepEqual(result.skips, []);
      assert.equal(result.counts.removed, 2);
      assert.equal(result.files.length, 1);
      const [file] = result.files;
      assert.ok(file.pageCount >= 1);
      assert.ok(file.size > 500);
      const bytes = readFileSync(result.paths.get(file.rel));
      assert.equal(
        Buffer.from(bytes.subarray(0, 5)).toString('latin1'),
        '%PDF-'
      );
      const info = await pdfInfo(bytes);
      assert.match(info.text, /erfundene Lage/);
      // the whole scenario: the solution part and the text "how the knowledge helps" are in it
      assert.match(info.text, new RegExp(SOLUTION_WORD));
      assert.match(info.text, new RegExp(KNOWLEDGE_WORD));
      // the metadata is the one of the clean step
      const document = await PDFDocument.load(bytes, { updateMetadata: false });
      assert.equal(document.getTitle(), 'Szenario K1-a');
      assert.equal(document.getAuthor(), '');
      assert.equal(document.getProducer(), '');
      assert.doesNotMatch(
        Buffer.from(bytes).toString('latin1'),
        /LibreOffice|<x:xmpmeta/
      );
      // the copy of the Word file is gone
      assert.deepEqual(readdirSync(workspace.inDir), []);
    } finally {
      workspace.cleanup();
      rmSync(root, { recursive: true, force: true });
    }
  }
);
