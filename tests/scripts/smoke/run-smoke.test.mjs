// Tests for scripts/smoke/run-smoke.mjs with a faked fetch. Nothing here touches a network.
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';
import {
  ENV_NAMES,
  PLAN,
  findSolutionKeys,
  main,
  missingEnv,
  normalizeBaseUrl,
  overall,
  parseArgs,
  runSmoke,
} from '../../../scripts/smoke/run-smoke.mjs';

const SCRIPT = 'scripts/smoke/run-smoke.mjs';
const APP = 'https://app.example.test';
const AUTH = 'https://auth.example.test';
const SECRET = {
  email: 'test.azubi@example.test',
  password: 'pw-secret-value-1',
  anonKey: 'anon-key-value-1',
  token: 'token-value-1',
};

const config = (extra = {}) => ({
  baseUrl: APP,
  supabaseUrl: AUTH,
  anonKey: SECRET.anonKey,
  email: SECRET.email,
  password: SECRET.password,
  accountIsTest: true,
  catalog: null,
  hai: false,
  ...extra,
});

const json = (status, body) => ({
  status,
  text: async () => (body === undefined ? '' : JSON.stringify(body)),
});
const html = status => ({ status, text: async () => '<html></html>' });

/** A faked server. `overrides` maps "METHOD path" to a response or a function. */
function fakeFetch(overrides = {}) {
  const calls = [];
  const routes = {
    'GET /': () => html(200),
    'GET /login': () => html(200),
    'GET /api/catalogs': () =>
      json(200, { catalogs: [{ code: 'FIAE' }, { code: 'KFBM' }] }),
    'GET /api/trainee/courses': ({ headers }) =>
      headers.Authorization
        ? json(200, { courses: [{ id: 'c1' }] })
        : json(401, { error: 'Unauthorized' }),
    'GET /api/trainee/courses/c1': () =>
      json(200, {
        course: { id: 'c1' },
        enablers: [
          { id: 'e1', state: 'open' },
          { id: 'e2', state: 'locked' },
        ],
      }),
    'GET /api/trainee/enablers/e1': () => json(200, { enabler: { id: 'e1' } }),
    'GET /api/trainee/enablers/e1/documents': () =>
      json(200, {
        documents: [
          { id: 'd1', documentType: 'THEORY', storageUrl: 'https://x/a.pdf' },
        ],
      }),
    'GET /api/trainee/quizzes': () => json(200, [{ id: 'q1' }]),
    'GET /api/trainee/quizzes/q1': () =>
      json(200, {
        quiz: {
          id: 'q1',
          questions: [
            {
              id: 'k1',
              questionText: 'Q',
              options: [{ id: 'o1', optionText: 'A' }],
            },
          ],
        },
      }),
    'POST /api/hai/chat': () => json(200, { response: 'Antwort' }),
    'POST /auth/v1/token': () => json(200, { access_token: SECRET.token }),
    'POST /auth/v1/logout': () => ({ status: 204, text: async () => '' }),
    ...overrides,
  };
  const fetch = async (url, init = {}) => {
    const u = new URL(url);
    calls.push({
      host: u.host,
      path: u.pathname,
      search: u.search,
      method: init.method,
      headers: init.headers ?? {},
      redirect: init.redirect,
      body: init.body,
    });
    const handler = routes[`${init.method} ${u.pathname}`];
    if (!handler) return json(404, { error: 'Not found' });
    const answer =
      typeof handler === 'function'
        ? handler({ headers: init.headers ?? {}, body: init.body })
        : handler;
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { fetch, calls };
}

async function run(overrides, cfg) {
  const { fetch, calls } = fakeFetch(overrides);
  const lines = [];
  const out = await runSmoke(config(cfg), { fetch, log: l => lines.push(l) });
  return { out, calls, lines, text: lines.join('\n') };
}

const byName = (out, name) => out.results.find(r => r.name === name);

test('the happy path passes every step and signs out', async () => {
  const { out, calls, text } = await run();
  assert.equal(out.status, 'OK');
  assert.equal(out.exitCode, 0);
  const names = out.results.map(r => r.name);
  for (const step of PLAN) assert.ok(names.includes(step), step);
  assert.equal(byName(out, 'Öffentliche Berufsliste').note, '2 Beruf(e)');
  assert.equal(
    byName(out, 'HAI-Frage (nur auf Anforderung)').result,
    'ÜBERSPRUNGEN'
  );
  assert.equal(byName(out, 'Abmelden').status, 204);
  assert.match(text, /Gesamtstatus: OK/);
  assert.ok(calls.some(c => c.path === '/auth/v1/logout'));
});

test('every step prints OK or FEHLER with a status code', async () => {
  const { lines } = await run();
  const stepLines = lines.filter(l => !l.startsWith('Gesamtstatus'));
  for (const l of stepLines)
    assert.match(l, /^(OK|FEHLER|ÜBERSPRUNGEN)\s+.+ \[(\d{3}|-)\]/);
});

test('nothing secret reaches the output: no token, password, address or key', async () => {
  const { text } = await run();
  for (const secret of Object.values(SECRET))
    assert.ok(!text.includes(secret), 'secret in output');
  const failing = await run({
    'POST /auth/v1/token': () =>
      json(400, { error: 'invalid', email: SECRET.email }),
  });
  for (const secret of Object.values(SECRET))
    assert.ok(!failing.text.includes(secret));
});

test('the token goes only to the app and the sign in service, never into a followed redirect', async () => {
  const { calls } = await run();
  assert.ok(
    calls.every(
      c => c.host === 'app.example.test' || c.host === 'auth.example.test'
    )
  );
  const withToken = calls.filter(c => c.headers.Authorization);
  assert.ok(withToken.length > 0);
  assert.ok(withToken.every(c => c.redirect === 'manual'));
  assert.ok(
    withToken.every(c => c.headers.Authorization === `Bearer ${SECRET.token}`)
  );
  // the password goes into the sign in request only
  const withPassword = calls.filter(c =>
    String(c.body ?? '').includes(SECRET.password)
  );
  assert.deepEqual(
    withPassword.map(c => c.path),
    ['/auth/v1/token']
  );
  assert.equal(withPassword[0].host, 'auth.example.test');
});

test('the test only reads: the only writes are sign in, the optional HAI question and sign out', async () => {
  const { calls } = await run({}, { hai: true });
  const writes = calls
    .filter(c => c.method !== 'GET')
    .map(c => `${c.method} ${c.path}`);
  assert.deepEqual(writes, [
    'POST /auth/v1/token',
    'POST /api/hai/chat',
    'POST /auth/v1/logout',
  ]);
});

test('a solution key in the quiz answer fails the step', async () => {
  const { out } = await run({
    'GET /api/trainee/quizzes/q1': () =>
      json(200, {
        quiz: {
          questions: [
            { options: [{ id: 'o1', optionText: 'A', isCorrect: true }] },
          ],
        },
      }),
  });
  const quiz = byName(out, 'Quiz laden, keine Lösung im Antworttext');
  assert.equal(quiz.result, 'FEHLER');
  assert.equal(quiz.status, 200);
  assert.equal(out.exitCode, 1);
});

test('a trainer solution or a private reference in the document list fails the step', async () => {
  for (const doc of [
    {
      id: 'd',
      documentType: 'TRAINER_SOLUTION',
      storageUrl: 'https://x/a.pdf',
    },
    {
      id: 'd',
      documentType: 'THEORY',
      storageUrl: 'private://content-solutions/a.pdf',
    },
  ]) {
    const { out } = await run({
      'GET /api/trainee/enablers/e1/documents': () =>
        json(200, { documents: [doc] }),
    });
    const step = byName(out, 'Ein Enabler mit Dokument');
    assert.equal(step.result, 'FEHLER');
    assert.equal(out.status, 'FEHLER');
  }
});

test('anonymous access that works is a failure', async () => {
  const { out } = await run({
    'GET /api/trainee/courses': () => json(200, { courses: [] }),
  });
  const step = byName(out, 'Anonymer Zugriff auf Azubi-Daten wird abgewiesen');
  assert.equal(step.result, 'FEHLER');
  assert.equal(step.status, 200);
});

test('a refused sign in fails, skips the rest and does not sign out', async () => {
  const { out, calls } = await run({
    'POST /auth/v1/token': () => json(400, {}),
  });
  assert.equal(byName(out, 'Anmeldung als Test-Azubi').result, 'FEHLER');
  assert.equal(byName(out, 'Anmeldung als Test-Azubi').status, 400);
  for (const name of [
    'Kursliste',
    'Ein Kurs',
    'Ein Enabler mit Dokument',
    'Quiz laden, keine Lösung im Antworttext',
  ]) {
    assert.equal(byName(out, name).result, 'ÜBERSPRUNGEN');
  }
  assert.equal(out.exitCode, 1);
  assert.ok(!calls.some(c => c.path === '/auth/v1/logout'));
});

test('without the test account confirmation no sign in is attempted', async () => {
  const { out, calls } = await run({}, { accountIsTest: false });
  assert.equal(byName(out, 'Anmeldung als Test-Azubi').result, 'FEHLER');
  assert.ok(!calls.some(c => c.path === '/auth/v1/token'));
  assert.equal(out.exitCode, 1);
});

test('a failing step after the sign in still signs out', async () => {
  const { out, calls } = await run({
    'GET /api/trainee/courses': ({ headers }) =>
      headers.Authorization ? json(500, {}) : json(401, {}),
  });
  assert.equal(byName(out, 'Kursliste').result, 'FEHLER');
  assert.equal(byName(out, 'Kursliste').status, 500);
  assert.equal(byName(out, 'Abmelden').result, 'OK');
  assert.ok(calls.some(c => c.path === '/auth/v1/logout'));
});

test('a trainee without a course makes the run incomplete (exit 3), not failed', async () => {
  const { out } = await run({
    'GET /api/trainee/courses': ({ headers }) =>
      headers.Authorization ? json(200, { courses: [] }) : json(401, {}),
  });
  assert.equal(out.status, 'UNVOLLSTÄNDIG');
  assert.equal(out.exitCode, 3);
  assert.equal(byName(out, 'Ein Kurs').result, 'ÜBERSPRUNGEN');
});

test('a course without a document or a quiz is reported as incomplete', async () => {
  const { out } = await run({
    'GET /api/trainee/enablers/e1/documents': () =>
      json(200, { documents: [] }),
    'GET /api/trainee/quizzes': () => json(200, []),
    'GET /api/trainee/enablers/e1/quizzes': () => json(200, { quizzes: [] }),
  });
  assert.equal(byName(out, 'Ein Enabler mit Dokument').result, 'ÜBERSPRUNGEN');
  assert.equal(
    byName(out, 'Quiz laden, keine Lösung im Antworttext').result,
    'ÜBERSPRUNGEN'
  );
  assert.equal(out.exitCode, 3);
});

test('without a global quiz the open lesson quiz of the enabler is loaded', async () => {
  const { out, calls } = await run({
    'GET /api/trainee/quizzes': () => json(200, []),
    'GET /api/trainee/enablers/e1/quizzes': () =>
      json(200, { quizzes: [{ id: 'q9', difficulty: 'LOW', unlocked: true }] }),
    'GET /api/trainee/enablers/e1/quizzes/LOW': () =>
      json(200, {
        quiz: {
          questions: [
            {
              id: 'k',
              questionText: 'Q',
              options: [{ id: 'o', optionText: 'A' }],
            },
          ],
        },
      }),
  });
  assert.equal(
    byName(out, 'Quiz laden, keine Lösung im Antworttext').note,
    'Lektionsquiz'
  );
  assert.ok(calls.some(c => c.path === '/api/trainee/enablers/e1/quizzes/LOW'));
});

test('a locked lesson quiz is not picked, an unlocked one is', async () => {
  const { out, calls } = await run({
    'GET /api/trainee/quizzes': () => json(200, []),
    'GET /api/trainee/enablers/e1/quizzes': () =>
      json(200, {
        quizzes: [
          { id: 'a', difficulty: 'LOW', unlocked: false },
          { id: 'b', difficulty: 'MEDIUM', unlocked: true },
        ],
      }),
    'GET /api/trainee/enablers/e1/quizzes/MEDIUM': () =>
      json(200, { quiz: { questions: [] } }),
  });
  assert.equal(
    byName(out, 'Quiz laden, keine Lösung im Antworttext').result,
    'OK'
  );
  assert.ok(!calls.some(c => c.path.endsWith('/quizzes/LOW')));
});

test('a server error on an enabler is a failure, not a skipped step', async () => {
  const { out } = await run({
    'GET /api/trainee/enablers/e1': () => json(503, {}),
  });
  const step = byName(out, 'Ein Enabler mit Dokument');
  assert.equal(step.result, 'FEHLER');
  assert.equal(step.status, 503);
  assert.equal(out.exitCode, 1);
});

test('a request that runs into the time limit is reported as a failed step', async () => {
  const fetch = async (url, init = {}) => {
    const path = new URL(url).pathname;
    if (path === '/') {
      return new Promise((_, reject) =>
        init.signal.addEventListener('abort', () =>
          reject(Object.assign(new Error('timeout'), { name: 'TimeoutError' }))
        )
      );
    }
    return json(404, {});
  };
  // AbortSignal.timeout does not keep the event loop alive, a timer of the test does
  const keepAlive = setInterval(() => {}, 20);
  let out;
  try {
    out = await runSmoke(config({ accountIsTest: false }), {
      fetch,
      log: () => {},
      timeoutMs: 30,
    });
  } finally {
    clearInterval(keepAlive);
  }
  const step = byName(out, 'Startseite erreichbar');
  assert.equal(step.result, 'FEHLER');
  assert.equal(step.note, 'Zeitüberschreitung');
});

test('the sign out ends only the session of this run', async () => {
  const { calls } = await run();
  const logout = calls.find(c => c.path === '/auth/v1/logout');
  assert.equal(logout.search, '?scope=local');
});

test('the HAI question is asked only on request and needs an answer', async () => {
  const on = await run({}, { hai: true });
  assert.equal(byName(on.out, 'HAI-Frage (nur auf Anforderung)').result, 'OK');
  const off = await run();
  assert.equal(
    byName(off.out, 'HAI-Frage (nur auf Anforderung)').result,
    'ÜBERSPRUNGEN'
  );
  assert.equal(off.out.exitCode, 0);
  const broken = await run(
    { 'POST /api/hai/chat': () => json(503, {}) },
    { hai: true }
  );
  assert.equal(
    byName(broken.out, 'HAI-Frage (nur auf Anforderung)').status,
    503
  );
  assert.equal(broken.out.exitCode, 1);
});

test('the occupation option is sent as x-catalog on app requests only', async () => {
  const { calls } = await run({}, { catalog: 'KFBM' });
  const app = calls.filter(
    c => c.host === 'app.example.test' && c.path.startsWith('/api/')
  );
  assert.ok(app.length > 0);
  assert.ok(app.every(c => c.headers['x-catalog'] === 'KFBM'));
  assert.ok(
    calls
      .filter(c => c.host === 'auth.example.test')
      .every(c => !c.headers['x-catalog'])
  );
});

test('a network error is a failed step, not a crash', async () => {
  const { out } = await run({ 'GET /': () => new TypeError('fetch failed') });
  const step = byName(out, 'Startseite erreichbar');
  assert.equal(step.result, 'FEHLER');
  assert.equal(step.status, null);
  assert.equal(step.note, 'Keine Verbindung');
  assert.equal(out.exitCode, 1);
});

test('normalizeBaseUrl accepts https and localhost, refuses the rest without echoing it', () => {
  assert.equal(
    normalizeBaseUrl('https://app.example.test/some/path?x=1'),
    'https://app.example.test'
  );
  assert.equal(
    normalizeBaseUrl('http://localhost:3000/'),
    'http://localhost:3000'
  );
  assert.throws(() => normalizeBaseUrl('http://app.example.test'), /https/);
  assert.throws(
    () => normalizeBaseUrl('https://user:pw@app.example.test'),
    error => {
      assert.doesNotMatch(error.message, /user:pw|app\.example/);
      return /user name or a password/.test(error.message);
    }
  );
  assert.throws(() => normalizeBaseUrl('not a url'), /not a valid URL/);
  assert.throws(() => normalizeBaseUrl('ftp://app.example.test'), /https/);
});

test('parseArgs and the environment check', () => {
  assert.deepEqual(parseArgs([]), {
    run: false,
    help: false,
    baseUrl: null,
    catalog: null,
    hai: false,
  });
  assert.equal(
    parseArgs([
      '--run',
      '--base-url',
      'https://a.test',
      '--catalog',
      'KFBM',
      '--hai',
    ]).catalog,
    'KFBM'
  );
  assert.throws(() => parseArgs(['--password', 'x']), /Unknown argument/);
  assert.throws(() => parseArgs(['--catalog', 'kfbm']), /occupation code/);
  assert.throws(() => parseArgs(['--base-url']), /needs a value/);
  assert.deepEqual(missingEnv({}), [
    ENV_NAMES.email,
    ENV_NAMES.password,
    ENV_NAMES.supabaseUrl,
    ENV_NAMES.anonKey,
  ]);
  assert.deepEqual(
    missingEnv({
      [ENV_NAMES.email]: 'a',
      [ENV_NAMES.password]: 'b',
      [ENV_NAMES.supabaseUrl]: 'c',
      [ENV_NAMES.anonKey]: 'd',
    }),
    []
  );
});

test('overall status and exit codes', () => {
  assert.deepEqual(overall([{ result: 'OK' }]), { status: 'OK', exitCode: 0 });
  assert.deepEqual(
    overall([{ result: 'OK' }, { result: 'ÜBERSPRUNGEN', missing: false }]),
    { status: 'OK', exitCode: 0 }
  );
  assert.deepEqual(overall([{ result: 'ÜBERSPRUNGEN', missing: true }]), {
    status: 'UNVOLLSTÄNDIG',
    exitCode: 3,
  });
  assert.deepEqual(
    overall([{ result: 'ÜBERSPRUNGEN', missing: true }, { result: 'FEHLER' }]),
    { status: 'FEHLER', exitCode: 1 }
  );
});

test('findSolutionKeys finds nested solution keys and ignores option texts', () => {
  assert.deepEqual(
    findSolutionKeys({
      quiz: { questions: [{ options: [{ optionText: 'A' }] }] },
    }),
    []
  );
  assert.deepEqual(
    findSolutionKeys({ a: [{ explanation: 'x' }], correctOptionId: 'y' }),
    ['$.a[0].explanation', '$.correctOptionId']
  );
});

const fullEnv = (extra = {}) => ({
  [ENV_NAMES.email]: SECRET.email,
  [ENV_NAMES.password]: SECRET.password,
  [ENV_NAMES.supabaseUrl]: AUTH,
  [ENV_NAMES.anonKey]: SECRET.anonKey,
  [ENV_NAMES.isTest]: 'yes',
  ...extra,
});

test('the default is a dry run: no request without --run', async () => {
  const { fetch, calls } = fakeFetch();
  const lines = [];
  const code = await main([], fullEnv(), { fetch, log: l => lines.push(l) });
  assert.equal(code, 0);
  assert.equal(calls.length, 0);
  assert.match(lines.join('\n'), /nothing is sent without --run/);
  assert.match(lines.join('\n'), /all required variables are set/);
  // only names, never values
  for (const secret of Object.values(SECRET))
    assert.ok(!lines.join('\n').includes(secret));
  assert.equal(await main(['--help'], {}, { fetch, log: () => {} }), 0);
  assert.equal(calls.length, 0);
});

test('--run needs a valid base URL and the environment', async () => {
  const { fetch, calls } = fakeFetch();
  const quiet = { fetch, log: () => {} };
  const errors = [];
  const original = console.error;
  console.error = line => errors.push(String(line));
  try {
    assert.equal(await main(['--run'], fullEnv(), quiet), 2);
    assert.equal(await main(['--run', '--base-url', APP], {}, quiet), 2);
    assert.match(errors.join('\n'), new RegExp(ENV_NAMES.email));
    assert.equal(
      await main(
        ['--run', '--base-url', 'http://app.example.test'],
        fullEnv(),
        quiet
      ),
      2
    );
    assert.equal(
      await main(
        ['--run', '--base-url', APP],
        fullEnv({ [ENV_NAMES.supabaseUrl]: 'http://auth.example.test' }),
        quiet
      ),
      2
    );
    assert.equal(await main(['--run', '--bogus'], fullEnv(), quiet), 2);
    for (const secret of Object.values(SECRET))
      assert.ok(!errors.join('\n').includes(secret));
  } finally {
    console.error = original;
  }
  assert.equal(calls.length, 0);
});

test('--run with a complete environment runs and returns the exit code', async () => {
  const { fetch } = fakeFetch();
  const lines = [];
  const code = await main(['--run', '--base-url', APP], fullEnv(), {
    fetch,
    log: l => lines.push(l),
  });
  assert.equal(code, 0);
  assert.match(
    lines[0],
    /^Smoke test against app\.example\.test, sign in at auth\.example\.test$/
  );
  assert.match(lines.join('\n'), /Gesamtstatus: OK/);
  const hai = fakeFetch();
  const withHai = await main(
    ['--run', '--base-url', APP],
    fullEnv({ [ENV_NAMES.hai]: '1' }),
    { fetch: hai.fetch, log: () => {} }
  );
  assert.equal(withHai, 0);
  assert.ok(hai.calls.some(c => c.path === '/api/hai/chat'));
});

test('the CLI without --run neither connects nor reads files', () => {
  const out = spawnSync(process.execPath, [SCRIPT], {
    encoding: 'utf8',
    env: { PATH: process.env.PATH },
  });
  assert.equal(out.status, 0);
  assert.match(out.stdout, /nothing is sent without --run/);
  assert.match(out.stdout, /missing: SMOKE_TRAINEE_EMAIL/);
});

test('static safety: no file access, no logging of secrets, credentials only through the environment', () => {
  const source = readFileSync(SCRIPT, 'utf8');
  assert.doesNotMatch(
    source,
    /from 'node:(fs|child_process|net|http|https)'|require\(/
  );
  assert.doesNotMatch(
    source,
    /console\.(log|error)\([^)]*(token|password|anonKey|email)/i
  );
  assert.doesNotMatch(
    source,
    /log\([^)]*(config\.(password|email|anonKey)|token)/i
  );
  // the account is read from the environment object that main() receives, nowhere else
  assert.equal(source.match(/process\.env/g).length, 1);
  assert.match(source, /process\.argv\.slice\(2\), process\.env/);
  // no default host: the base URL must be passed
  const code = source
    .split(/\r?\n/)
    .filter(l => !/^\s*(\/\/|\*|\/\*)/.test(l))
    .join('\n');
  assert.doesNotMatch(code, /https?:\/\/[a-z0-9]/i);
});
