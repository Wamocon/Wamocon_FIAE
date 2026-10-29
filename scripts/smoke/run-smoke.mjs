// End-to-end smoke test for a deployed instance of the learning platform.
//
// It walks through what a trainee does first: open the start page and the login page,
// read the public list of occupations, sign in with a TEST trainee, open the course list,
// one course, one enabler with a document, load one quiz and check that the answer carries
// no solution, ask HAI (only on request) and sign out. Every step prints OK or FEHLER with
// the HTTP status code, the run ends with one overall status.
//
// The script reads only. The one write is the optional HAI question (a chat message of the
// test trainee) and the sign in and sign out themselves.
//
// Safety rules (checked by tests/scripts/smoke/run-smoke.test.mjs):
//  - Nothing is sent without --run. Without it the script prints the plan and which
//    environment variables are set (names only) and exits.
//  - It talks only to the base URL given with --base-url and to the sign in service given
//    in SMOKE_SUPABASE_URL. Both must be https (http only for localhost) and carry no
//    user name or password.
//  - The account comes ONLY from the environment, never from a file or an argument, and is
//    never printed: SMOKE_TRAINEE_EMAIL, SMOKE_TRAINEE_PASSWORD, SMOKE_SUPABASE_URL,
//    SMOKE_SUPABASE_ANON_KEY. SMOKE_ACCOUNT_IS_TEST=yes confirms that the account is a test
//    account, without it the script refuses to sign in.
//  - No token, no password, no address and no response body is printed or written. A step
//    shows its name, its status code and a short fixed note.
//  - Redirects are not followed on requests that carry the token.
//
// Usage:
//   node scripts/smoke/run-smoke.mjs                        plan and environment check
//   node scripts/smoke/run-smoke.mjs --run --base-url https://app.example
//        [--catalog KFBM]      work in one occupation (sends x-catalog)
//        [--hai]               also ask HAI one question (or SMOKE_HAI=1)
//
// Exit code: 0 everything OK, 1 at least one step failed, 3 no failure but a step had no
// data to check (incomplete), 2 wrong usage or missing environment.

import { pathToFileURL } from 'node:url';

export const ENV_NAMES = {
  email: 'SMOKE_TRAINEE_EMAIL',
  password: 'SMOKE_TRAINEE_PASSWORD',
  supabaseUrl: 'SMOKE_SUPABASE_URL',
  anonKey: 'SMOKE_SUPABASE_ANON_KEY',
  isTest: 'SMOKE_ACCOUNT_IS_TEST',
  hai: 'SMOKE_HAI',
};

const REQUEST_TIMEOUT_MS = 20_000;
const MAX_ENABLER_CANDIDATES = 5;
const CATALOG_CODE = /^[A-Z0-9_-]{2,20}$/;
const LOCAL_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]']);
// keys of a quiz answer that would carry a solution (before the answer is submitted)
const SOLUTION_KEY =
  /^(is_?correct|correct|correct_?(answer|answers|option|options|index|option_?id|answer_?text)|explanation|rationale|hint|hint_?text|expected_?answer|solution|solutions|solution_?text|model_?solution|sample_?solution|answer_?key)$/i;

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

/**
 * Validates a base URL: https (http only for localhost), no credentials in it.
 * Returns the origin without a trailing slash or throws a message without the URL.
 */
export function normalizeBaseUrl(value, label = 'base URL') {
  let url;
  try {
    url = new URL(String(value));
  } catch {
    throw new Error(`The ${label} is not a valid URL.`);
  }
  if (url.username || url.password) {
    throw new Error(`The ${label} must not contain a user name or a password.`);
  }
  const local = LOCAL_HOSTS.has(url.hostname);
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && local)) {
    throw new Error(
      `The ${label} must use https (http is allowed for localhost only).`
    );
  }
  return url.origin;
}

export function parseArgs(argv) {
  const opts = {
    run: false,
    help: false,
    baseUrl: null,
    catalog: null,
    hai: false,
  };
  const value = (i, name) => {
    const v = argv[i + 1];
    if (!v || v.startsWith('--')) throw new Error(`${name} needs a value`);
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--run') opts.run = true;
    else if (a === '--help' || a === '-h') opts.help = true;
    else if (a === '--hai') opts.hai = true;
    else if (a === '--base-url') opts.baseUrl = value(i++, a);
    else if (a === '--catalog') opts.catalog = value(i++, a);
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (opts.catalog !== null && !CATALOG_CODE.test(opts.catalog)) {
    throw new Error(
      '--catalog must be an occupation code such as FIAE or KFBM.'
    );
  }
  return opts;
}

/** Names of the required environment variables that are not set (never the values). */
export function missingEnv(env) {
  return ['email', 'password', 'supabaseUrl', 'anonKey']
    .map(k => ENV_NAMES[k])
    .filter(name => !env[name]);
}

/** Paths of the keys of a JSON value that carry a solution. */
export function findSolutionKeys(value, path = '$') {
  if (Array.isArray(value)) {
    return value.flatMap((item, i) => findSolutionKeys(item, `${path}[${i}]`));
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).flatMap(([key, child]) => [
      ...(SOLUTION_KEY.test(key) ? [`${path}.${key}`] : []),
      ...findSolutionKeys(child, `${path}.${key}`),
    ]);
  }
  return [];
}

/** Overall status and exit code of a finished run. */
export function overall(results) {
  if (results.some(r => r.result === 'FEHLER'))
    return { status: 'FEHLER', exitCode: 1 };
  if (results.some(r => r.result === 'ÜBERSPRUNGEN' && r.missing)) {
    return { status: 'UNVOLLSTÄNDIG', exitCode: 3 };
  }
  return { status: 'OK', exitCode: 0 };
}

export const PLAN = [
  'Startseite erreichbar',
  'Login-Seite erreichbar',
  'Öffentliche Berufsliste',
  'Anonymer Zugriff auf Azubi-Daten wird abgewiesen',
  'Anmeldung als Test-Azubi',
  'Kursliste',
  'Ein Kurs',
  'Ein Enabler mit Dokument',
  'Quiz laden, keine Lösung im Antworttext',
  'HAI-Frage (nur auf Anforderung)',
  'Abmelden',
];

// ---------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------

/**
 * @param {{ baseUrl: string, supabaseUrl: string, anonKey: string, email: string,
 *           password: string, accountIsTest: boolean, catalog?: string | null,
 *           hai?: boolean }} config
 * @param {{ fetch?: typeof fetch, log?: (line: string) => void, timeoutMs?: number }} deps
 */
export async function runSmoke(config, deps = {}) {
  const fetchImpl = deps.fetch ?? globalThis.fetch;
  const log = deps.log ?? console.log;
  const timeoutMs = deps.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const base = normalizeBaseUrl(config.baseUrl);
  const auth = normalizeBaseUrl(config.supabaseUrl, 'sign in URL');
  const results = [];
  let token = null;

  const record = (name, result, status, note = '', extra = {}) => {
    const entry = { name, result, status: status ?? null, note, ...extra };
    results.push(entry);
    const code = status === null || status === undefined ? '-' : String(status);
    log(`${result.padEnd(13)} ${name} [${code}]${note ? ` ${note}` : ''}`);
    return entry;
  };
  const ok = (name, status, note) => record(name, 'OK', status, note);
  const fail = (name, status, note) => record(name, 'FEHLER', status, note);
  const skip = (name, note, missing) =>
    record(name, 'ÜBERSPRUNGEN', null, note, { missing });

  /** One request. Never throws, never keeps the body beyond the parsed JSON. */
  async function call(
    method,
    url,
    { bearer, body, headers = {}, follow = false } = {}
  ) {
    const h = { Accept: 'application/json', ...headers };
    if (bearer) h.Authorization = `Bearer ${bearer}`;
    if (body !== undefined) h['Content-Type'] = 'application/json';
    try {
      const res = await fetchImpl(url, {
        method,
        headers: h,
        body: body === undefined ? undefined : JSON.stringify(body),
        // a request with the token never follows a redirect to another place
        redirect: follow && !bearer ? 'follow' : 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      const text = await res.text().catch(() => '');
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { status: res.status, json, length: text.length, error: null };
    } catch (err) {
      const timeout =
        err && (err.name === 'TimeoutError' || err.name === 'AbortError');
      return {
        status: null,
        json: null,
        length: 0,
        error: timeout ? 'Zeitüberschreitung' : 'Keine Verbindung',
      };
    }
  }

  const api = (method, path, opts = {}) =>
    call(method, `${base}${path}`, {
      ...opts,
      headers: {
        ...(config.catalog ? { 'x-catalog': config.catalog } : {}),
        ...(opts.headers ?? {}),
      },
    });
  const authed = (method, path, opts = {}) =>
    api(method, path, { ...opts, bearer: token });
  const failed = (name, res, expected) =>
    fail(name, res.status, res.error ?? `erwartet ${expected}`);

  try {
    // 1 and 2: the pages
    for (const [name, path] of [
      ['Startseite erreichbar', '/'],
      ['Login-Seite erreichbar', '/login'],
    ]) {
      const res = await call('GET', `${base}${path}`, {
        headers: { Accept: 'text/html' },
        follow: true,
      });
      if (res.status === 200) ok(name, res.status);
      else failed(name, res, 200);
    }

    // 3: public occupations
    {
      const name = 'Öffentliche Berufsliste';
      const res = await api('GET', '/api/catalogs');
      const list = res.json?.catalogs;
      if (
        res.status === 200 &&
        Array.isArray(list) &&
        list.length > 0 &&
        list.every(c => typeof c?.code === 'string')
      ) {
        ok(name, res.status, `${list.length} Beruf(e)`);
      } else if (res.status === 200)
        fail(name, res.status, 'keine Berufe in der Liste');
      else failed(name, res, 200);
    }

    // 4: no data without a token
    {
      const name = 'Anonymer Zugriff auf Azubi-Daten wird abgewiesen';
      const res = await api('GET', '/api/trainee/courses');
      if (res.status === 401) ok(name, res.status);
      else failed(name, res, 401);
    }

    // 5: sign in
    {
      const name = 'Anmeldung als Test-Azubi';
      if (config.accountIsTest !== true) {
        fail(
          name,
          null,
          `${ENV_NAMES.isTest}=yes fehlt, kein Konto wird verwendet`
        );
      } else {
        const res = await call(
          'POST',
          `${auth}/auth/v1/token?grant_type=password`,
          {
            headers: { apikey: config.anonKey },
            body: { email: config.email, password: config.password },
          }
        );
        const access = res.json?.access_token;
        if (res.status === 200 && typeof access === 'string' && access) {
          token = access;
          ok(name, res.status);
        } else failed(name, res, 200);
      }
    }

    if (!token) {
      for (const name of PLAN.slice(5, 9)) skip(name, 'keine Anmeldung', false);
    } else {
      await signedInSteps();
    }

    // HAI is optional whatever happened before
    if (token) {
      const name = 'HAI-Frage (nur auf Anforderung)';
      if (!config.hai)
        skip(
          name,
          `Schalter nicht gesetzt (--hai oder ${ENV_NAMES.hai}=1)`,
          false
        );
      else {
        const res = await authed('POST', '/api/hai/chat', {
          body: { message: 'Was ist ein Enabler?', stream: false },
        });
        if (res.status === 200 && res.length > 0) ok(name, res.status);
        else failed(name, res, 200);
      }
    } else {
      skip('HAI-Frage (nur auf Anforderung)', 'keine Anmeldung', false);
    }
  } finally {
    // sign out whatever happened
    const name = 'Abmelden';
    if (!token) skip(name, 'nicht angemeldet', false);
    else {
      const res = await call('POST', `${auth}/auth/v1/logout?scope=local`, {
        bearer: token,
        headers: { apikey: config.anonKey },
      });
      if (res.status === 204 || res.status === 200) ok(name, res.status);
      else failed(name, res, 204);
      token = null;
    }
  }

  const summary = overall(results);
  const count = value => results.filter(r => r.result === value).length;
  log(
    `Gesamtstatus: ${summary.status} (${count('OK')} OK, ${count('FEHLER')} FEHLER, ${count('ÜBERSPRUNGEN')} übersprungen)`
  );
  return { results, ...summary };

  async function signedInSteps() {
    // 6: course list
    const listName = 'Kursliste';
    const courses = await authed('GET', '/api/trainee/courses');
    const courseList = courses.json?.courses;
    if (courses.status !== 200 || !Array.isArray(courseList)) {
      failed(listName, courses, 200);
      for (const name of PLAN.slice(6, 9)) skip(name, 'keine Kursliste', false);
      return;
    }
    ok(listName, courses.status, `${courseList.length} Kurs(e)`);
    const courseId = courseList.find(c => typeof c?.id === 'string')?.id;
    if (!courseId) {
      for (const name of PLAN.slice(6, 9))
        skip(name, 'der Test-Azubi hat keinen Kurs', true);
      return;
    }

    // 7: one course
    const courseName = 'Ein Kurs';
    const course = await authed(
      'GET',
      `/api/trainee/courses/${encodeURIComponent(courseId)}`
    );
    const enablerList = course.json?.enablers;
    if (course.status !== 200 || !Array.isArray(enablerList)) {
      failed(courseName, course, 200);
      for (const name of PLAN.slice(7, 9)) skip(name, 'kein Kurs', false);
      return;
    }
    ok(courseName, course.status, `${enablerList.length} Enabler`);

    // 8: an enabler with a document, the first few open ones
    const docName = 'Ein Enabler mit Dokument';
    const candidates = enablerList
      .filter(e => typeof e?.id === 'string')
      .sort(
        (a, b) => Number(a.state === 'locked') - Number(b.state === 'locked')
      )
      .slice(0, MAX_ENABLER_CANDIDATES);
    let enablerId = null;
    let docStatus = null;
    let docProblem = null;
    for (const e of candidates) {
      const id = encodeURIComponent(e.id);
      const detail = await authed('GET', `/api/trainee/enablers/${id}`);
      if (detail.status !== 200) {
        // a server error or a network error is a failure, a 403 or 404 only skips
        if (detail.status === null || detail.status >= 500) {
          docStatus = detail.status;
          docProblem = detail.error ?? 'Serverfehler beim Enabler';
          break;
        }
        continue;
      }
      const docs = await authed('GET', `/api/trainee/enablers/${id}/documents`);
      const documents = docs.json?.documents;
      if (docs.status !== 200 || !Array.isArray(documents)) {
        docStatus = docs.status;
        docProblem = docs.error ?? 'Dokumentliste nicht lesbar';
        break;
      }
      if (documents.length === 0) continue;
      const leaked = documents.some(
        d =>
          d?.documentType === 'TRAINER_SOLUTION' ||
          String(d?.storageUrl ?? '').startsWith('private://')
      );
      if (leaked) {
        docStatus = docs.status;
        docProblem = 'Musterlösung oder private Referenz in der Dokumentliste';
        break;
      }
      enablerId = e.id;
      docStatus = docs.status;
      ok(docName, docs.status, `${documents.length} Dokument(e)`);
      break;
    }
    if (docProblem) fail(docName, docStatus, docProblem);
    else if (!enablerId)
      skip(docName, 'kein Enabler mit Dokument gefunden', true);

    // 9: a quiz without a solution
    const quizName = 'Quiz laden, keine Lösung im Antworttext';
    const quiz = await loadAnyQuiz(enablerId ?? candidates[0]?.id);
    if (!quiz) skip(quizName, 'kein Quiz gefunden', true);
    else if (quiz.res.status !== 200) failed(quizName, quiz.res, 200);
    else {
      const keys = findSolutionKeys(quiz.res.json);
      if (keys.length > 0)
        fail(
          quizName,
          quiz.res.status,
          `Lösungsfelder im Antworttext: ${keys.length}`
        );
      else ok(quizName, quiz.res.status, quiz.kind);
    }
  }

  /** The first global quiz, else the first open quiz of the enabler. */
  async function loadAnyQuiz(enablerId) {
    const global = await authed('GET', '/api/trainee/quizzes');
    const globalList = Array.isArray(global.json)
      ? global.json
      : global.json?.quizzes;
    const globalId = Array.isArray(globalList)
      ? globalList.find(q => typeof q?.id === 'string')?.id
      : null;
    if (global.status === 200 && globalId) {
      return {
        kind: 'Global-Quiz',
        res: await authed(
          'GET',
          `/api/trainee/quizzes/${encodeURIComponent(globalId)}`
        ),
      };
    }
    if (!enablerId) return null;
    const lesson = await authed(
      'GET',
      `/api/trainee/enablers/${encodeURIComponent(enablerId)}/quizzes`
    );
    const entry = Array.isArray(lesson.json?.quizzes)
      ? lesson.json.quizzes.find(
          q => typeof q?.difficulty === 'string' && q.unlocked === true
        )
      : null;
    if (lesson.status === 200 && entry) {
      return {
        kind: 'Lektionsquiz',
        res: await authed(
          'GET',
          `/api/trainee/enablers/${encodeURIComponent(enablerId)}/quizzes/${encodeURIComponent(entry.difficulty)}`
        ),
      };
    }
    return null;
  }
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

const HELP = `End-to-end smoke test against a deployed instance. Without --run nothing is sent.
Usage: node scripts/smoke/run-smoke.mjs [--run --base-url <https url>] [--catalog CODE] [--hai]
Environment (names only here): ${Object.values(ENV_NAMES).join(', ')}.
The account must be a test trainee. See the header of this file.`;

export async function main(argv, env, deps = {}) {
  const log = deps.log ?? console.log;
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  if (opts.help) {
    log(HELP);
    return 0;
  }
  if (!opts.run) {
    log('Plan (nothing is sent without --run):');
    PLAN.forEach((step, i) => log(`  ${i + 1}. ${step}`));
    const missing = missingEnv(env);
    log(
      `Environment: ${missing.length === 0 ? 'all required variables are set' : `missing: ${missing.join(', ')}`}`
    );
    log(
      `Test account confirmed (${ENV_NAMES.isTest}=yes): ${env[ENV_NAMES.isTest] === 'yes' ? 'yes' : 'no'}`
    );
    log(
      `HAI question: ${opts.hai || env[ENV_NAMES.hai] === '1' ? 'on' : 'off'}`
    );
    return 0;
  }
  if (!opts.baseUrl) {
    console.error('--run needs --base-url <https url>.');
    return 2;
  }
  const missing = missingEnv(env);
  if (missing.length > 0) {
    console.error(`Missing environment variables: ${missing.join(', ')}`);
    return 2;
  }
  let baseUrl;
  let supabaseUrl;
  try {
    baseUrl = normalizeBaseUrl(opts.baseUrl);
    supabaseUrl = normalizeBaseUrl(
      env[ENV_NAMES.supabaseUrl],
      ENV_NAMES.supabaseUrl
    );
  } catch (err) {
    console.error(err.message);
    return 2;
  }
  // both hosts are named, so a wrong value in the environment is seen before
  // anything is sent (the password goes to the sign in host, the token to both)
  log(
    `Smoke test against ${new URL(baseUrl).host}, sign in at ${new URL(supabaseUrl).host}${opts.catalog ? `, occupation ${opts.catalog}` : ''}`
  );
  const outcome = await runSmoke(
    {
      baseUrl,
      supabaseUrl,
      anonKey: env[ENV_NAMES.anonKey],
      email: env[ENV_NAMES.email],
      password: env[ENV_NAMES.password],
      catalog: opts.catalog,
      hai: opts.hai || env[ENV_NAMES.hai] === '1',
      accountIsTest: env[ENV_NAMES.isTest] === 'yes',
    },
    deps
  );
  return outcome.exitCode;
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main(process.argv.slice(2), process.env).then(
    code => process.exit(code),
    () => {
      // a fixed message only: an error text could carry a URL or a value
      console.error('The smoke test stopped unexpectedly.');
      process.exit(2);
    }
  );
}
