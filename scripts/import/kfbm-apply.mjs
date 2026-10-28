// Apply script of the KfBM content import (phase 4.4): plan, check, dry run and
// real run. By default NOTHING is kept: `run` executes everything inside one
// transaction and rolls it back. A real run needs --apply, a target
// (--target local|preview) and a connection whose host, schema and role fit
// that target. Production is refused in every case, there is no switch for it.
//
// Commands:
//   plan  [<source folder>] [--quizzes-json <file>]
//         [--global-quizzes-json <file>] [--prefer-json-quizzes]
//         [--out <plan.json>] [--decisions <file>]
//         [--components K1,K6.2] [--hydrate] [--timeout <seconds>]
//         [--no-attributes]
//         Reads the source documents (read only) and writes the plan. No
//         database, no network. Next to the JSON a summary in Markdown without
//         any content (same name, .md). Besides the Word tree (or instead of
//         it) the quizzes can come from the quiz JSON files (schema 1.0, see
//         src/lib/content-import/quiz-json): a quiz of the JSON with the same
//         content key as a Word quiz is left out and listed as an older copy,
//         unless --prefer-json-quizzes asks for the JSON.
//   check (<source folder> | --plan <plan.json>) --target local|preview
//         --created-by <profile uuid> [--report-out <file.md>]
//         Compares the plan with the target database in a read-only
//         transaction: what is new, what exists, what differs, what conflicts.
//         The quiz JSON options of plan work here as well (instead of --plan).
//         With --extend-quizzes the comparison counts the questions that a
//         quiz lacks ("n Fragen ergänzt") instead of reporting a conflict.
//   run   (<source folder> | --plan <plan.json>) --target local|preview
//         --created-by <profile uuid> [--apply] [--update-existing]
//         [--extend-quizzes]
//         [--confirm-host <host>] [--report-out <file.md>]
//         Dry run (default): everything is written inside a transaction, the
//         counts per table are printed, then the transaction is rolled back.
//         With --apply the transaction is committed. A real run against the
//         Preview also needs --confirm-host <host of the connection>.
//         Rows that exist stay as they are, also when the quiz JSON names
//         other texts (only --update-existing changes the named columns).
//         --extend-quizzes adds the questions that an existing quiz lacks (and
//         their options), but only when every existing question is in the plan
//         with the same text and in the same order. Nothing is deleted, no
//         question, option or answer is changed, the order_index of existing
//         questions moves where a new question comes before them. Off by
//         default (then another number of questions is a conflict).
//   check-quizzes [--quizzes-json <file>] [--global-quizzes-json <file>]
//         [--report-out <file.md>]
//         Reads the quiz JSON files and reports numbers and ids only: counts
//         per component, level and number of questions, and the findings. No
//         database, no network, nothing is written except the report file.
//
// The connection comes from the environment variable DB_CONNECTION_STRING and
// from nowhere else (no .env file is read). The script prints neither the
// connection string nor any content of a source file. It calls no model and no
// network except the target database. It does not upload files to the storage
// and does not trigger an index run.
//
// Exit codes: 0 done, 1 failed or refused, 2 wrong usage, 3 conflicts.

// Must come first: registers the TypeScript module resolution.
import {
  ImportAbort,
  buildImportPlan,
  checkConfirmHost,
  checkTargetFacts,
  checkTargetHost,
  isLoopbackHost,
  mergeQuizSources,
  parseApplyArgs,
  parseConnectionString,
  parseDecisions,
  planCounts,
  readGlobalQuizzes,
  readLessonQuizzes,
  renderLengthChanges,
  renderPlanSummary,
  renderQuizJsonReport,
  runJob,
  selectFiles,
  summarizeQuizJson,
  validatePlan,
} from './kfbm-apply-modules.mjs';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  extractDocxParagraphs,
  parseQuizText,
  parseScenarioText,
  pathInfo,
  readAttributes,
  walkSource,
} from './kfbm-source.mjs';

const DEFAULT_DECISIONS = fileURLToPath(
  new URL('./kfbm-decisions.json', import.meta.url)
);

class TimeoutError extends Error {}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new TimeoutError(
            `Timeout after ${ms} ms while reading the file (download from OneDrive stuck?).`
          )
        ),
      ms
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

export function loadDecisions(file = DEFAULT_DECISIONS) {
  let raw;
  try {
    raw = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(
      `The decisions file ${file} cannot be read: ${error.message}`
    );
  }
  const result = parseDecisions(raw);
  if (!result.ok) {
    throw new Error(
      `The decisions file ${file} is not valid: ${result.errors.join('; ')}`
    );
  }
  return result.decisions;
}

/**
 * Reads and parses the files that the plan needs. Files that are chosen but
 * cannot be read (placeholder without --hydrate, timeout, damaged) are handed
 * over without content, the planner skips them with the reason.
 * @param {string} root
 * @param {Array<{rel: string, size: number, mtimeMs: number, placeholder: boolean, info: any}>} files
 * @param {any} decisions
 * @param {{ components?: string[], hydrate?: boolean, timeoutMs?: number, readFile?: (file: string) => Promise<Buffer>, onProgress?: (done: number, total: number) => void }} [options]
 */
export async function loadSourceFiles(root, files, decisions, options = {}) {
  const {
    components = [],
    hydrate = false,
    timeoutMs = 60000,
    readFile: read = readFile,
  } = options;
  const selection = selectFiles(files, decisions, { limitedTo: components });
  const wanted = new Set(selection.chosen);
  const out = [];
  let timeoutsInARow = 0;
  let done = 0;
  for (const file of files) {
    if (!wanted.has(file.rel)) {
      out.push(file);
      continue;
    }
    if (file.placeholder && !hydrate) {
      out.push(file);
      continue;
    }
    if (timeoutsInARow >= 3) {
      out.push({
        ...file,
        readError: 'The run was stopped after three timeouts in a row.',
      });
      continue;
    }
    try {
      const buffer = await withTimeout(
        read(path.join(root, ...file.rel.split('/'))),
        timeoutMs
      );
      timeoutsInARow = 0;
      const paragraphs = await extractDocxParagraphs(buffer);
      const type = file.info.type;
      let content;
      if (type === 'enabler') {
        content = { type, paragraphs };
      } else if (type === 'quiz') {
        content = { type, result: parseQuizText(paragraphs) };
      } else if (type === 'global-quiz') {
        content = {
          type,
          result: parseQuizText(paragraphs, {
            expectedQuestions: decisions.content.globalQuizQuestions,
          }),
        };
      } else if (type === 'scenario') {
        content = { type, result: parseScenarioText(paragraphs) };
      }
      out.push(content ? { ...file, content } : file);
    } catch (error) {
      timeoutsInARow = error instanceof TimeoutError ? timeoutsInARow + 1 : 0;
      out.push({
        ...file,
        readError: error instanceof Error ? error.message : String(error),
      });
    }
    done += 1;
    options.onProgress?.(done, wanted.size);
  }
  return out;
}

/** Upper size of a quiz JSON file (the real files are below 8 MB). */
export const MAX_QUIZ_JSON_BYTES = 32 * 1024 * 1024;

/**
 * Reads and parses a quiz JSON file. The messages name the file and a position
 * but never quote its content.
 */
export function readQuizJsonFile(file, maxBytes = MAX_QUIZ_JSON_BYTES) {
  let stat;
  try {
    stat = statSync(file);
  } catch {
    throw new Error(`The quiz JSON ${file} does not exist or cannot be read.`);
  }
  if (!stat.isFile()) throw new Error(`The quiz JSON ${file} is not a file.`);
  if (stat.size > maxBytes) {
    throw new Error(
      `The quiz JSON ${file} is larger than ${maxBytes} bytes, that is over the limit.`
    );
  }
  let buffer;
  try {
    buffer = readFileSync(file);
  } catch (error) {
    throw new Error(
      `The quiz JSON ${file} cannot be read (${error?.code ?? 'error'}).`
    );
  }
  // A file that grew after the size check is still held to the limit.
  if (buffer.length > maxBytes) {
    throw new Error(
      `The quiz JSON ${file} is larger than ${maxBytes} bytes, that is over the limit.`
    );
  }
  let text = buffer.toString('utf8');
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  try {
    return JSON.parse(text);
  } catch (error) {
    const at = String(error?.message).match(/position (\d+)/);
    throw new Error(
      `The quiz JSON ${file} is not valid JSON${at ? ` (near position ${at[1]})` : ''}.`
    );
  }
}

/**
 * Reads the quiz JSON files named in the arguments. A file whose structure is
 * refused (schema version, head, limits) stops the run with its finding codes.
 */
export function readQuizSources(args, decisions) {
  const reads = [];
  const options = {
    expectedGlobalQuestions: decisions.content.globalQuizQuestions,
  };
  for (const [file, read] of [
    [args.quizzesJson, readLessonQuizzes],
    [args.globalQuizzesJson, readGlobalQuizzes],
  ]) {
    if (!file) continue;
    const result = read(readQuizJsonFile(file), options);
    if (result.fatal) {
      const reasons = result.findings
        .filter(f => f.severity === 'error')
        .map(f => `${f.code} (${f.message})`)
        .join('; ');
      throw new Error(`The quiz JSON ${file} was refused: ${reasons}.`);
    }
    const errors = result.findings.filter(f => f.severity === 'error').length;
    console.error(
      `Quiz JSON (${result.kind}): ${result.quizzes} quizzes, ${result.sets.length} sets, ${errors} errors, ${result.findings.length - errors} notes (details: check-quizzes).`
    );
    reads.push(result);
  }
  return reads;
}

/**
 * Plan from a source folder and/or the quiz JSON files (read only). The folder
 * may be null when a quiz JSON file is given.
 */
export async function planFromSource(root, args, decisions) {
  // The JSON files are small: a bad one stops the run before the Word tree is read.
  const reads = readQuizSources(args, decisions);
  let loaded = [];
  if (root) {
    const attributes = args.noAttributes ? null : readAttributes(root);
    if (!attributes && !args.noAttributes) {
      console.error(
        'File attributes are not available, placeholders cannot be told apart.'
      );
    }
    const entries = walkSource(root, { attributes });
    const files = entries.map(entry => ({
      ...entry,
      info: pathInfo(entry.rel),
    }));
    loaded = await loadSourceFiles(root, files, decisions, {
      components: args.components,
      hydrate: args.hydrate,
      timeoutMs: args.timeoutSeconds ? args.timeoutSeconds * 1000 : undefined,
      onProgress: (done, total) => {
        if (done % 50 === 0) console.error(`${done} of ${total} files read`);
      },
    });
  }
  if (reads.length === 0) {
    return buildImportPlan(loaded, decisions, { limitedTo: args.components });
  }
  const merged = mergeQuizSources(loaded, reads, {
    preferJson: args.preferJsonQuizzes,
    limitedTo: args.components,
  });
  console.error(
    `Quiz JSON in the plan: ${merged.counts.jsonQuizFiles} quiz files and ${merged.counts.jsonEnablerFiles} enablers added, ${merged.counts.leftOutForWord} left out for the Word quiz of the same key, ${merged.counts.replacedWord} Word quizzes replaced, ${merged.counts.filledForWord} quizzes taken because the Word file of the key cannot be used.`
  );
  return buildImportPlan(merged.files, decisions, {
    limitedTo: args.components,
    extra: { skipped: merged.skipped, superseded: merged.superseded },
  });
}

function writeText(file, text) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

const redact = (text, secret) => {
  let out = String(text ?? '');
  if (secret) out = out.split(secret).join('***');
  try {
    const url = new URL(secret);
    if (url.password)
      out = out.split(decodeURIComponent(url.password)).join('***');
  } catch {
    // not a URL, nothing more to hide
  }
  return out;
};

const TABLE_LABEL = {
  training_components: 'Komponenten',
  courses: 'Kurse',
  enablers: 'Enabler',
  quizzes: 'Quizze',
  questions: 'Fragen',
  options: 'Optionen',
  enabler_quiz_links: 'Quiz-Verknüpfungen',
  content_documents: 'Dokumentzeilen (Szenarien)',
};

/** Report of a run as Markdown (German). Holds counts and keys, no content. */
export function renderRunReport(report, info) {
  const out = [];
  const modeText = {
    check: 'Prüfung (nur lesend)',
    'dry-run': 'Probelauf (alles ausgeführt, zurückgerollt)',
    apply: 'Echter Lauf (übernommen)',
  }[info.mode];
  out.push('# Lauf des KfBM-Imports');
  out.push('');
  out.push(
    `Modus: ${modeText}. Ziel: ${info.target}, Host ${info.host}, Schema ${info.schema}, Rolle ${info.role}.`
  );
  out.push(`Katalog: ${report.catalog}. Stand: ${info.at}.`);
  out.push('');
  out.push('| Tabelle | neu | aktualisiert | unverändert |');
  out.push('|---|---|---|---|');
  for (const [table, count] of Object.entries(report.tables)) {
    out.push(
      `| ${TABLE_LABEL[table] ?? table} | ${count.insert} | ${count.update} | ${count.unchanged} |`
    );
  }
  out.push('');
  if (report.differences.length > 0) {
    out.push('## Abweichungen bestehender Zeilen');
    out.push('');
    out.push(
      info.updateExisting
        ? 'Mit --update-existing aktualisiert (nur die genannten Spalten).'
        : 'Nicht geändert (dafür gibt es --update-existing), außer einer Spalte, die noch leer ist (total_weeks einer Komponente mit Wert 0, die der echte Lauf auch ohne --update-existing setzt).'
    );
    out.push('');
    for (const d of report.differences.slice(0, 200)) {
      const filled = d.filled?.length
        ? ` (leer, wird gesetzt: ${d.filled.join(', ')})`
        : '';
      out.push(`- ${d.table} ${d.key}: ${d.columns.join(', ')}${filled}`);
    }
    if (report.differences.length > 200) {
      out.push(`- und ${report.differences.length - 200} weitere`);
    }
    out.push('');
    out.push(...renderLengthChanges(report.differences, info.updateExisting));
  }
  if (report.extended?.length) {
    const added = report.extended.reduce((n, e) => n + e.added, 0);
    out.push('## Ergänzte Quizze');
    out.push('');
    out.push(
      `${added} Fragen ergänzt in ${report.extended.length} Quizzen (Positionen bestehender Fragen verschoben: ${report.extended.reduce((n, e) => n + e.moved, 0)}). Bestehende Fragen, Optionen und Antworten bleiben unverändert.`
    );
    out.push('');
    for (const e of report.extended) {
      out.push(`- ${e.quiz}: ${e.added} ergänzt, ${e.moved} verschoben`);
    }
    out.push('');
  }
  if (report.conflicts.length > 0) {
    out.push('## Konflikte');
    out.push('');
    for (const c of report.conflicts) {
      out.push(`- ${c.table} ${c.key}: ${c.reason}`);
    }
    out.push('');
  }
  return out.join('\n');
}

function printReport(report, info) {
  console.log(renderRunReport(report, info));
}

async function readPlan(args, decisions) {
  if (args.plan) {
    let raw;
    try {
      raw = JSON.parse(readFileSync(args.plan, 'utf8'));
    } catch (error) {
      throw new Error(
        `The plan file ${args.plan} cannot be read: ${error.message}`
      );
    }
    return raw;
  }
  if (args.source) {
    const stat = (() => {
      try {
        return statSync(args.source);
      } catch {
        return null;
      }
    })();
    if (!stat?.isDirectory()) {
      throw new Error(`${args.source} is not a folder or does not exist.`);
    }
  }
  return planFromSource(args.source, args, decisions);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const parsed = parseApplyArgs(argv, { quizJson: true });
  if (!parsed.ok) {
    for (const error of parsed.errors) console.error(`Error: ${error}`);
    console.error(
      'Usage: node scripts/import/kfbm-apply.mjs plan|check|run|check-quizzes ... (see the header of the script)'
    );
    return 2;
  }
  const args = parsed.args;

  // The output files must not be the input files (a report named like the JSON would overwrite it).
  const inputs = [args.quizzesJson, args.globalQuizzesJson]
    .filter(Boolean)
    .map(file => path.resolve(file).toLowerCase());
  for (const output of [args.out, args.reportOut].filter(Boolean)) {
    if (inputs.includes(path.resolve(output).toLowerCase())) {
      console.error(
        'Error: an output file must not be a quiz JSON input file.'
      );
      return 2;
    }
  }
  if (
    args.command === 'check-quizzes' &&
    args.reportOut &&
    !/\.md$/i.test(args.reportOut)
  ) {
    console.error('Error: --report-out must be a .md file.');
    return 2;
  }

  let decisions;
  try {
    decisions = loadDecisions(args.decisions ?? DEFAULT_DECISIONS);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 2;
  }

  // check-quizzes -------------------------------------------------------------
  if (args.command === 'check-quizzes') {
    const options = {
      expectedGlobalQuestions: decisions.content.globalQuizQuestions,
    };
    let lesson = null;
    let global = null;
    try {
      if (args.quizzesJson) {
        lesson = readLessonQuizzes(readQuizJsonFile(args.quizzesJson), options);
      }
      if (args.globalQuizzesJson) {
        global = readGlobalQuizzes(
          readQuizJsonFile(args.globalQuizzesJson),
          options
        );
      }
    } catch (error) {
      console.error(`Error: ${error.message}`);
      return 2;
    }
    const report = renderQuizJsonReport(summarizeQuizJson(lesson, global));
    console.log(report);
    if (args.reportOut) {
      writeText(args.reportOut, report);
      console.log(`Report written: ${args.reportOut}`);
    }
    const failed = [lesson, global].some(
      read =>
        read && (read.fatal || read.findings.some(f => f.severity === 'error'))
    );
    return failed ? 1 : 0;
  }

  // plan ---------------------------------------------------------------------
  if (args.command === 'plan') {
    let plan;
    try {
      plan = await readPlan(args, decisions);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      return 2;
    }
    const problems = validatePlan(plan);
    const summary = renderPlanSummary(plan);
    if (args.out) {
      writeText(args.out, JSON.stringify(plan, null, 2));
      writeText(args.out.replace(/\.json$/i, '') + '.md', summary);
      console.log(`Plan written: ${args.out} (summary next to it, .md)`);
    }
    const counts = planCounts(plan);
    console.log(JSON.stringify(counts));
    if (problems.length > 0) {
      for (const problem of problems) console.error(`Plan problem: ${problem}`);
      return 1;
    }
    return 0;
  }

  // check and run --------------------------------------------------------------
  const connectionString = env.DB_CONNECTION_STRING;
  if (!connectionString) {
    console.error(
      'Error: DB_CONNECTION_STRING is not set. The connection is taken from this environment variable only.'
    );
    return 2;
  }
  // The child process that reads file attributes must not inherit the secret.
  if (env === process.env) delete process.env.DB_CONNECTION_STRING;
  // The client is built from explicit fields, never from the string, so the
  // host that was checked is the host that is used (the driver would let
  // ?host= override it).
  const parsedConnection = parseConnectionString(connectionString);
  if (!parsedConnection.ok) {
    for (const problem of parsedConnection.errors) {
      console.error(`Refused: ${problem}`);
    }
    return 1;
  }
  const connection = parsedConnection.connection;
  const host = connection.host;
  const early = [
    ...checkTargetHost(args.target, host),
    ...checkConfirmHost(args, host),
  ];
  if (early.length > 0) {
    for (const problem of early) console.error(`Refused: ${problem}`);
    console.error('The target does not fit the connection. Nothing was done.');
    return 1;
  }

  let plan;
  try {
    plan = await readPlan(args, decisions);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 2;
  }
  const planProblems = validatePlan(plan);
  if (planProblems.length > 0) {
    for (const problem of planProblems)
      console.error(`Plan problem: ${problem}`);
    console.error('The plan is not valid. Nothing was done.');
    return 1;
  }

  const loopback = isLoopbackHost(host);
  if (!loopback && connection.sslmode === 'disable') {
    console.error('Refused: a hosted database needs TLS (sslmode=disable).');
    return 1;
  }
  if (!loopback && !['verify-ca', 'verify-full'].includes(connection.sslmode)) {
    console.error(
      'Note: TLS without certificate verification (as the reindex script). Use ?sslmode=verify-full with the CA of the host to verify.'
    );
  }
  const { default: pg } = await import('pg');
  const client = new pg.Client({
    host: connection.host,
    port: connection.port ?? 5432,
    user: connection.user,
    password: connection.password,
    database: connection.database,
    ssl: loopback
      ? false
      : {
          rejectUnauthorized: ['verify-ca', 'verify-full'].includes(
            connection.sslmode
          ),
        },
    application_name: 'kfbm-import',
    connectionTimeoutMillis: 15000,
  });
  try {
    await client.connect();
  } catch (error) {
    console.error(
      `Error: the connection failed (${redact(error.message, connectionString)})`
    );
    return 1;
  }
  try {
    const facts = (
      await client.query(
        `select current_schema() as current_schema,
                current_user as current_role,
                session_user as session_role,
                (select n.nspname from pg_class c
                   join pg_namespace n on n.oid = c.relnamespace
                  where c.oid = to_regclass('training_catalogs')) as resolved_schema,
                (exists (select 1 from pg_namespace
                          where nspname in ('public_preview', 'preview_meta'))
                 or exists (select 1 from pg_roles
                             where rolname in ('app_preview', 'app_preview_migrator'))
                ) as has_preview_markers`
      )
    ).rows[0];
    const problems = checkTargetFacts(args.target, {
      host,
      currentSchema: facts?.current_schema ?? null,
      resolvedSchema: facts?.resolved_schema ?? null,
      currentUser: facts?.current_role ?? null,
      sessionUser: facts?.session_role ?? null,
      hasPreviewMarkers: facts?.has_preview_markers ?? null,
    });
    if (problems.length > 0) {
      for (const problem of problems) console.error(`Refused: ${problem}`);
      console.error(
        'The target does not fit the connection. Nothing was done.'
      );
      return 1;
    }

    const mode =
      args.command === 'check' ? 'check' : args.apply ? 'apply' : 'dry-run';
    const info = {
      mode,
      target: args.target,
      host,
      schema: facts.current_schema,
      role: facts.current_role,
      at: new Date().toISOString(),
      updateExisting: args.updateExisting,
    };
    console.log(
      `Target ${args.target} fits the connection (host ${host}, schema ${facts.current_schema}, role ${facts.current_role}). Mode: ${mode}.`
    );
    try {
      const report = await runJob(client, plan, {
        mode,
        createdBy: args.createdBy,
        updateExisting: args.updateExisting,
        activate: decisions.content.activate,
        scenarioSolutions: args.scenarioSolutions,
        extendQuizzes: args.extendQuizzes,
      });
      printReport(report, info);
      if (args.reportOut) {
        writeText(args.reportOut, renderRunReport(report, info));
        console.log(`Report written: ${args.reportOut}`);
      }
      if (mode === 'dry-run') {
        console.log(
          'Dry run: the transaction was rolled back, nothing was kept.'
        );
      } else if (mode === 'check') {
        console.log('Check: nothing was written.');
      } else {
        console.log('Real run: the transaction was committed.');
      }
      if (report.conflicts.length > 0) {
        console.error(
          `${report.conflicts.length} conflict(s) between the plan and the target database (see the report).`
        );
        return 3;
      }
      return 0;
    } catch (error) {
      if (error instanceof ImportAbort) {
        console.error(`Stopped (${error.code}): ${error.message}`);
        for (const c of error.conflicts) {
          console.error(`  conflict: ${c.table} ${c.key}: ${c.reason}`);
        }
        console.error('The transaction was rolled back, nothing was kept.');
        return error.code === 'CONFLICTS' ? 3 : 1;
      }
      console.error(
        `Error: ${redact(error.message, connectionString)}. The transaction was rolled back, nothing was kept.`
      );
      return 1;
    }
  } catch (error) {
    console.error(
      `Error: ${redact(error?.message, connectionString)}. Nothing was kept.`
    );
    return 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const code = await main();
  // A read that never finished must not keep the process alive.
  process.exit(code);
}
