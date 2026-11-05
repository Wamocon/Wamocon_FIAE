// Tests for scripts/storage/cleanup-submission-files.mjs (cleanup run of the private bucket
// submission-files). Nothing here talks to a real database or a real storage: every refusal
// happens before the first connection, and the runs with data use a fake connection and a
// fake storage that the script takes as parameters.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';

import { run } from '../../../scripts/storage/cleanup-submission-files.mjs';

const SCRIPT = path.resolve('scripts/storage/cleanup-submission-files.mjs');
const ORG = '11111111-1111-4111-8111-111111111111';
const TRAINEE = '22222222-2222-4222-8222-222222222222';
const GONE = '33333333-3333-4333-8333-333333333333';
const USE_CASE = '44444444-4444-4444-8444-444444444444';
const UPLOAD = '55555555-5555-4555-8555-555555555555';
const FIAE = '00000000-0000-4000-8000-000000000001';
const KEY = 'secret-key-value-for-the-test';
const DB = 'postgresql://postgres:db-password-for-test@localhost:5432/postgres';
const ENV = {
  DB_CONNECTION_STRING: DB,
  NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  SUPABASE_SECRET_KEY: KEY,
};

const spawn = (args, env = {}) =>
  spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH, ...env },
    timeout: 60000,
  });

/** Captures what a run prints. */
async function capture(fn) {
  const out = [];
  const err = [];
  const log = console.log;
  const error = console.error;
  console.log = (...a) => out.push(a.join(' '));
  console.error = (...a) => err.push(a.join(' '));
  try {
    const code = await fn();
    return { code, out: out.join('\n'), err: err.join('\n') };
  } finally {
    console.log = log;
    console.error = error;
  }
}

test('without a target the script stops with the usage and does not connect', () => {
  const result = spawn([]);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--target local\|preview is required/);
  assert.match(result.stderr, /Usage:/);
});

test('production is refused in every form', () => {
  for (const args of [
    ['--target', 'production'],
    ['--target=production', '--apply'],
    ['--production'],
  ]) {
    const result = spawn(args, ENV);
    assert.equal(result.status, 2);
    assert.match(result.stderr, /Production is not supported/);
  }
});

test('a real run needs --confirm-storage-host', () => {
  const result = spawn(['--target', 'local', '--apply'], ENV);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /--confirm-storage-host/);
});

test('the bucket is no argument', () => {
  const result = spawn(['--target', 'local', '--bucket', 'content'], ENV);
  assert.equal(result.status, 2);
  assert.match(result.stderr, /Unknown argument: --bucket/);
});

test('without the storage address or the key nothing is opened', () => {
  const noUrl = spawn(['--target', 'local'], {
    DB_CONNECTION_STRING: DB,
    SUPABASE_SECRET_KEY: KEY,
  });
  assert.equal(noUrl.status, 1);
  assert.match(noUrl.stderr, /NEXT_PUBLIC_SUPABASE_URL is not set/);
  const noKey = spawn(['--target', 'local'], {
    DB_CONNECTION_STRING: DB,
    NEXT_PUBLIC_SUPABASE_URL: 'http://localhost:54321',
  });
  assert.equal(noKey.status, 1);
  assert.match(noKey.stderr, /SUPABASE_SECRET_KEY is not set/);
});

test('a local run refuses a hosted storage address, a preview run a local one', async () => {
  const hosted = await capture(() =>
    run(['--target', 'local'], {
      ...ENV,
      NEXT_PUBLIC_SUPABASE_URL: 'https://project.supabase.example.invalid',
    })
  );
  assert.equal(hosted.code, 1);
  assert.match(hosted.err, /local needs a storage on this machine/);
  const local = await capture(() =>
    run(['--target', 'preview'], ENV)
  );
  assert.equal(local.code, 1);
  assert.match(local.err, /preview needs the https address/);
});

test('the confirmed storage host has to be the host of the address, before any connection', async () => {
  let opened = false;
  const result = await capture(() =>
    run(
      ['--target', 'local', '--apply', '--confirm-storage-host', 'other:1'],
      { ...ENV },
      {
        openClient: async () => {
          opened = true;
          return { ok: false, status: 1, messages: [] };
        },
      }
    )
  );
  assert.equal(result.code, 1);
  assert.match(result.err, /not the host of the storage address/);
  assert.equal(opened, false);
});

test('the database connection has to fit the target', async () => {
  const result = await capture(() =>
    run(['--target', 'local'], {
      ...ENV,
      DB_CONNECTION_STRING: 'postgresql://u:p@db.example.invalid:5432/postgres',
    })
  );
  assert.equal(result.code, 1);
  assert.match(result.err, /loopback host/);
  assert.doesNotMatch(result.err, /p@db/);
});

// ---------------------------------------------------------------------------
// Runs with a fake connection and a fake storage
// ---------------------------------------------------------------------------

const NOW = Date.now();
const HOUR = 60 * 60 * 1000;
const filePath = (trainee, n) =>
  `${ORG}/${trainee}/${USE_CASE}/file/${1761700000000 + n}_a.pdf`;

function fakeStorage(objects) {
  const removed = [];
  return {
    removed,
    objects,
    listFolder: async prefix => {
      const base = prefix === '' ? '' : `${prefix}/`;
      const names = new Map();
      for (const [p, createdAt] of objects) {
        if (!p.startsWith(base)) continue;
        const [head, ...tail] = p.slice(base.length).split('/');
        if (tail.length === 0) {
          names.set(head, { name: head, isFolder: false, createdAt });
        } else if (!names.has(head)) {
          names.set(head, { name: head, isFolder: true, createdAt: null });
        }
      }
      return [...names.values()];
    },
    remove: async paths => {
      for (const p of paths) {
        removed.push(p);
        objects.delete(p);
      }
    },
  };
}

function fakeOpen(rows) {
  const statements = [];
  const ended = { value: false };
  const client = {
    query: async (sql, params) => {
      statements.push(sql);
      if (/from profiles/.test(sql)) return { rows: rows.profiles };
      if (/from use_cases/.test(sql)) return { rows: rows.useCases };
      if (/from use_case_submissions/.test(sql)) return { rows: rows.submissions };
      if (/from trainee_enrollments/.test(sql)) return { rows: rows.enrollments };
      return { rows: [] };
    },
    end: async () => {
      ended.value = true;
    },
  };
  return {
    statements,
    ended,
    openClient: async () => ({
      ok: true,
      client,
      facts: { current_schema: 'public', current_role: 'postgres' },
      notes: [],
    }),
  };
}

const rows = () => ({
  profiles: [{ id: TRAINEE, is_active: true }],
  useCases: [{ id: USE_CASE, catalog_id: FIAE }],
  submissions: [{ trainee_id: TRAINEE, use_case_id: USE_CASE }],
  enrollments: [{ trainee_id: TRAINEE, catalog_id: FIAE }],
});

const bucket = () =>
  new Map([
    // stays: active trainee with a submission
    [filePath(TRAINEE, 1), NOW - 5 * HOUR],
    // goes: the trainee does not exist any more
    [filePath(GONE, 2), NOW - 5 * HOUR],
    // goes: an unfinished upload older than 24 hours
    [
      `${ORG}/${TRAINEE}/${USE_CASE}/incoming/${UPLOAD}.pdf`,
      NOW - 30 * HOUR,
    ],
  ]);

test('a dry run counts the reasons, removes nothing and prints numbers only', async () => {
  const storage = fakeStorage(bucket());
  const db = fakeOpen(rows());
  const result = await capture(() =>
    run(['--target', 'local'], { ...ENV }, {
      openClient: db.openClient,
      createStorage: () => storage,
    })
  );
  assert.equal(result.code, 0);
  assert.deepEqual(storage.removed, []);
  assert.equal(storage.objects.size, 3);
  assert.match(result.out, /Mode: dry-run/);
  assert.match(result.out, /orphan\s*:\s*1/);
  assert.match(result.out, /deleted\s*:\s*1/);
  assert.match(result.out, /ended\s*:\s*0/);
  assert.match(result.out, /nothing was removed/i);
  // numbers only: no id, no path, no secret
  const printed = `${result.out}\n${result.err}`;
  for (const secret of [ORG, TRAINEE, GONE, USE_CASE, UPLOAD, KEY, 'db-password']) {
    assert.ok(!printed.includes(secret), `output holds ${secret.slice(0, 8)}`);
  }
  assert.doesNotMatch(printed, /\.pdf/);
  // the database was only read, the session was set read only first
  assert.match(db.statements[0], /read only/);
  assert.ok(db.statements.slice(1).every(sql => /^\s*select/i.test(sql)));
  assert.equal(db.ended.value, true);
});

test('a real run removes the two files and keeps the active one, a second run changes nothing', async () => {
  const storage = fakeStorage(bucket());
  const db = fakeOpen(rows());
  const args = [
    '--target',
    'local',
    '--apply',
    '--confirm-storage-host',
    'localhost:54321',
  ];
  const deps = { openClient: db.openClient, createStorage: () => storage };
  const first = await capture(() => run(args, { ...ENV }, deps));
  assert.equal(first.code, 0);
  assert.match(first.out, /removed\s*:\s*2/);
  assert.deepEqual([...storage.objects.keys()], [filePath(TRAINEE, 1)]);
  const second = await capture(() => run(args, { ...ENV }, deps));
  assert.equal(second.code, 0);
  assert.match(second.out, /removed\s*:\s*0/);
  assert.equal(storage.removed.length, 2);
});

test('the secrets leave the environment of the process and never reach the output', async () => {
  const env = { ...ENV };
  const storage = fakeStorage(bucket());
  const db = fakeOpen(rows());
  const saved = { ...process.env };
  Object.assign(process.env, ENV);
  try {
    const result = await capture(() =>
      run(['--target', 'local'], process.env, {
        openClient: db.openClient,
        createStorage: () => storage,
      })
    );
    assert.equal(result.code, 0);
    assert.equal(process.env.SUPABASE_SECRET_KEY, undefined);
    assert.equal(process.env.DB_CONNECTION_STRING, undefined);
    assert.ok(!`${result.out}${result.err}`.includes(env.SUPABASE_SECRET_KEY));
  } finally {
    process.env = saved;
  }
});

test('a storage that cannot remove ends with exit code 1 and the number that is left', async () => {
  const storage = fakeStorage(bucket());
  storage.remove = async () => {
    throw new Error(`down ${KEY}`);
  };
  const db = fakeOpen(rows());
  const result = await capture(() =>
    run(
      ['--target', 'local', '--apply', '--confirm-storage-host', 'localhost:54321'],
      { ...ENV },
      { openClient: db.openClient, createStorage: () => storage }
    )
  );
  assert.equal(result.code, 1);
  assert.match(result.out, /failed\s*:\s*2/);
  assert.match(result.err, /could not be removed/);
  assert.ok(!`${result.out}${result.err}`.includes(KEY));
});

test('an error of the storage reaches the output without the key or the connection string', async () => {
  const storage = fakeStorage(bucket());
  storage.listFolder = async () => {
    throw new Error(`boom ${KEY} ${DB}`);
  };
  const db = fakeOpen(rows());
  const result = await capture(() =>
    run(['--target', 'local'], { ...ENV }, {
      openClient: db.openClient,
      createStorage: () => storage,
    })
  );
  assert.equal(result.code, 1);
  assert.match(result.err, /Error: boom/);
  assert.ok(!result.err.includes(KEY));
  assert.ok(!result.err.includes('db-password'));
  assert.equal(db.ended.value, true);
});

test('a connection that does not pass the facts check stops the run', async () => {
  const result = await capture(() =>
    run(['--target', 'local'], { ...ENV }, {
      openClient: async () => ({
        ok: false,
        status: 1,
        messages: ['Refused: the target does not fit.'],
      }),
      createStorage: () => {
        throw new Error('must not be reached');
      },
    })
  );
  assert.equal(result.code, 1);
  assert.match(result.err, /does not fit/);
});
