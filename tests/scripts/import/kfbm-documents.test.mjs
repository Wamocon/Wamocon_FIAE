// Tests for scripts/import/kfbm-documents.mjs (plan, check and run of the PDF import of the
// KfBM). The PDFs are invented (a small valid PDF with the given lines of text), no original
// file of the source is used or copied. Nothing here talks to a real database or a real storage: every refusal happens before
// the first connection, and the one test that opens a connection points at a closed port on the
// loopback address.
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

import { buildDocumentPlan } from '../../../scripts/import/kfbm-documents-modules.mjs';
import { scanSource } from '../../../scripts/import/kfbm-documents.mjs';

const SCRIPT = path.resolve('scripts/import/kfbm-documents.mjs');
const PROFILE = '11111111-2222-4333-8444-555555555555';
const K4 =
  '04 - Koordinations- und Organisationsaufgaben übernehmen (§ 4 Abs. 2 Nr. 4)';

/** Invented bytes that start like a PDF. The first page is parsed by a stand-in (see scan). */
const PDF = text => Buffer.from(`%PDF-1.7\n${text}\n%%EOF`);

const HEAD = ['WAMOCON GmbH, Erfundene Anschrift', 'Erfundener Hinweis'];
/** The first page that the stand-in parser returns per file name. */
const PAGES = {
  '4a_Titel.pdf': '4a) Erfundenes Thema EINS',
  'Szenario_4a_Titel.pdf': 'Szenario 4a) Erfundenes Thema EINS',
  'UC_4a_Titel.pdf': '4a) Erfundenes Thema EINS',
  'UC_4a_Titel_Musterlösung.pdf': '4a) Erfundenes Thema EINS',
  '4b_Titel.pdf': '4c) Anderes Thema', // the heading of another enabler
};

function tree() {
  const root = mkdtempSync(path.join(tmpdir(), 'kfbm-documents-'));
  const put = (rel, bytes) => {
    const file = path.join(root, ...rel.split('/'));
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, bytes);
  };
  for (const name of [
    'Enabler/4a_Titel.pdf',
    'Szenarien/Szenario_4a_Titel.pdf',
    'Use-Cases/UC_4a_Titel.pdf',
    'Use-Cases_Musterlösung/UC_4a_Titel_Musterlösung.pdf',
    'Enabler/4b_Titel.pdf',
    'Szenarien/4a.pdf',
    'Quizze/4a_Quiz_Low.pdf',
  ]) {
    put(`${K4}/${name}`, PDF(name));
  }
  put(`${K4}/Enabler/4d_Titel.pdf`, Buffer.from('not a pdf'));
  return root;
}

const args = (over = {}) => ({
  components: [],
  hydrate: false,
  noAttributes: true,
  timeoutSeconds: null,
  ...over,
});
const standIn = async bytes => {
  const text = bytes.toString('utf8').split('\n')[1] ?? '';
  const name = text.split('/').pop();
  return { pageCount: 3, headText: [...HEAD, PAGES[name] ?? ''].join('\n') };
};

function run(args, env = {}) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
  });
  return {
    code: result.status,
    out: `${result.stdout}${result.stderr}`,
    stdout: result.stdout,
  };
}

test('scan and plan: matches name and heading, reports the rest, reads only what the path allows', async () => {
  const root = tree();
  const reads = [];
  try {
    const files = await scanSource(root, args(), {
      parse: standIn,
      read: async file => {
        reads.push(path.basename(file));
        return readFileSync(file);
      },
    });
    const plan = buildDocumentPlan(files);
    const status = name => plan.items.find(i => i.rel.endsWith(name))?.status;
    assert.equal(status('/Enabler/4a_Titel.pdf'), 'ok');
    assert.equal(status('/Szenarien/Szenario_4a_Titel.pdf'), 'ok');
    assert.equal(status('/Use-Cases/UC_4a_Titel.pdf'), 'ok');
    assert.equal(status('Musterlösung.pdf'), 'ok');
    assert.equal(status('/Enabler/4b_Titel.pdf'), 'heading-mismatch');
    assert.equal(status('/Szenarien/4a.pdf'), 'misnamed');
    assert.equal(status('/Quizze/4a_Quiz_Low.pdf'), 'ignored');
    assert.equal(status('/Enabler/4d_Titel.pdf'), 'unreadable');
    // a misnamed file and the folder Quizze are not even read
    assert.ok(!reads.includes('4a.pdf'));
    assert.ok(!reads.includes('4a_Quiz_Low.pdf'));
    assert.equal(plan.items.find(i => i.status === 'ok').pageCount, 3);
    assert.match(
      plan.items.find(i => i.status === 'ok').sha256,
      /^[0-9a-f]{64}$/
    );
    // the plan holds names, codes and hashes: never a text of a file
    assert.ok(!JSON.stringify(plan).includes('EINS'));
    assert.ok(!JSON.stringify(plan).includes('Erfundener Hinweis'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('scan: --components limits the files that are read', async () => {
  const root = tree();
  try {
    assert.deepEqual(
      await scanSource(root, args({ components: ['K5'] }), { parse: standIn }),
      []
    );
    const entries = await scanSource(root, args({ components: ['K4'] }), {
      parse: standIn,
    });
    assert.ok(entries.length >= 7);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('plan (command line): writes the plan and a summary with names, codes and counts only', () => {
  const root = tree();
  const out = path.join(root, 'plan.json');
  try {
    // no file can be parsed here (the bytes are no real PDFs), so nothing is ok, everything is named
    const result = run(['plan', root, '--out', out, '--no-attributes']);
    assert.equal(result.code, 0, result.out);
    const counts = JSON.parse(result.stdout.trim().split('\n').pop());
    assert.equal(counts.total, 8);
    assert.equal(counts.byStatus.ignored, 1);
    assert.equal(counts.byStatus.misnamed, 1);
    assert.ok(existsSync(out) && existsSync(out.replace(/\.json$/, '.md')));
    const summary = readFileSync(out.replace(/\.json$/, '.md'), 'utf8');
    assert.match(summary, /misnamed: .*4a\.pdf/);
    assert.ok(!summary.includes('Erfundener Hinweis'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('refuses before any connection: usage, production, missing source', () => {
  const cases = [
    [[], 2],
    [['plan'], 2],
    [['plan', '/does/not/exist'], 2],
    [['check', '.', '--target', 'production', '--created-by', PROFILE], 2],
    [['check', '.', '--created-by', PROFILE], 2],
    [
      [
        'run',
        '.',
        '--target',
        'local',
        '--created-by',
        PROFILE,
        '--update-existing',
      ],
      2,
    ],
    [
      [
        'run',
        '.',
        '--target',
        'local',
        '--created-by',
        PROFILE,
        '--plan',
        'x.json',
      ],
      2,
    ],
    [
      [
        'run',
        '.',
        '--target',
        'local',
        '--created-by',
        PROFILE,
        '--overwrite-files',
      ],
      2,
    ],
    [
      ['run', '.', '--target', 'preview', '--created-by', PROFILE, '--apply'],
      2,
    ],
  ];
  for (const [args, code] of cases) {
    const result = run(args);
    assert.equal(result.code, code, `${args.join(' ')}: ${result.out}`);
  }
});

test('a real run needs the storage of its target and the key, and says so before the connection', async () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kfbm-documents-'));
  try {
    const base = [
      'run',
      root,
      '--target',
      'local',
      '--created-by',
      PROFILE,
      '--apply',
      '--confirm-storage-host',
      'proj.supabase.co',
    ];
    const env = {
      DB_CONNECTION_STRING: 'postgresql://postgres:geheim@127.0.0.1:1/postgres',
    };
    // no storage address, no key
    let result = run(base, env);
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /NEXT_PUBLIC_SUPABASE_URL is not set/);
    assert.match(result.out, /SUPABASE_SECRET_KEY is not set/);
    // the hosted address for a local target
    result = run(base, {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: 'https://proj.supabase.co',
      SUPABASE_SECRET_KEY: 'sb-secret-key',
    });
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /target local needs a storage on this machine/);
    assert.ok(!result.out.includes('geheim'));
    assert.ok(!result.out.includes('sb-secret-key'));
    // another host than the one that was confirmed
    result = run(base, {
      ...env,
      NEXT_PUBLIC_SUPABASE_URL: 'http://127.0.0.1:54321',
      SUPABASE_SECRET_KEY: 'sb-secret-key',
    });
    assert.equal(result.code, 1, result.out);
    assert.match(result.out, /not the host of the storage address/);
    // no confirmed host at all is a usage error
    result = run(base.slice(0, -2), env);
    assert.equal(result.code, 2, result.out);
    assert.match(result.out, /confirm-storage-host/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('a connection that fails prints neither the string nor the key and keeps nothing', () => {
  const root = mkdtempSync(path.join(tmpdir(), 'kfbm-documents-'));
  try {
    const result = run(
      [
        'check',
        root,
        '--target',
        'local',
        '--created-by',
        PROFILE,
        '--no-attributes',
      ],
      {
        DB_CONNECTION_STRING:
          'postgresql://postgres:geheim@127.0.0.1:1/postgres',
        SUPABASE_SECRET_KEY: 'sb-secret-key',
      }
    );
    assert.equal(result.code, 1, result.out);
    assert.ok(!result.out.includes('geheim'));
    assert.ok(!result.out.includes('sb-secret-key'));
    assert.ok(!existsSync(path.join(root, 'x')));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
