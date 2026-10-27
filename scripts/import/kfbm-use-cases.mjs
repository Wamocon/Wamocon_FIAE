// Use case script of the KfBM content import (phase 4.6): one use case per
// enabler, with its assignment, its topics and, for trainers only, its model
// solution. It has the same safety structure as the apply script
// (kfbm-apply.mjs): by default NOTHING is kept, `run` executes everything inside
// one transaction and rolls it back. A real run needs --apply, a target
// (--target local|preview) and a connection whose host, schema and role fit
// that target. Production is refused in every case, there is no switch.
//
// Why a script of its own: the input is the use case documents (a format of
// their own, src/lib/content-import/use-cases) and the targets are the tables
// use_cases and content_documents. The connection, the target check and the
// transaction are the same code (kfbm-session.mjs, src/lib/content-import/apply/*).
//
// Order: the content import (kfbm-apply.mjs run --apply) comes first, it writes
// the courses and enablers. The use cases hang on them (one use case per
// enabler). A use case whose course or enabler is not in the target is skipped
// and reported, a target without any enabler stops the run. The learning
// fields (kfbm-learning-fields.mjs) can run before or after.
//
// Commands:
//   plan  <source folder> [--out <plan.json>] [--decisions <file>]
//         [--components K1,K6.2] [--hydrate] [--timeout <seconds>]
//         [--no-attributes]
//         Reads the use case documents (read only) and writes the plan. No
//         database, no network. Next to the JSON a summary in Markdown without
//         any content (same name, .md). The JSON holds the texts (it is the input
//         of check and run, including the model solutions): keep it out of the
//         repository and out of reports.
//   check (<source folder> | --plan <plan.json>) --target local|preview
//         --created-by <profile uuid> [--use-case-solutions]
//         [--report-out <file.md>]
//         Compares the plan with the target database in a read-only
//         transaction: what is new, what exists, what differs, what conflicts.
//   run   (<source folder> | --plan <plan.json>) --target local|preview
//         --created-by <profile uuid> [--apply] [--update-existing]
//         [--use-case-solutions] [--confirm-host <host>] [--report-out <file.md>]
//         Dry run (default): everything is written inside a transaction, the
//         counts per table are printed, then the transaction is rolled back.
//         With --apply the transaction is committed. A real run against the
//         Preview also needs --confirm-host <host of the connection>.
//
// Solution protection: the model solutions (and criteria) are written only with
// --use-case-solutions, as documents of the type TRAINER_SOLUTION with the
// visibility TRAINER_ONLY, and only to a local target. For the Preview the
// switch is refused: the policy cd_select of content_documents lets the public
// key read rows without an organization. Without the switch no solution text
// reaches the database. Use cases are written inactive (decisions file).
//
// The connection comes from the environment variable DB_CONNECTION_STRING and
// from nowhere else (no .env file is read). The script prints neither the
// connection string nor any content of a source file. It calls no model and no
// network except the target database, it never deletes, it does not upload the
// original files to the storage and does not trigger an index run.
//
// Exit codes: 0 done, 1 failed or refused, 2 wrong usage, 3 conflicts.

// Must come first: registers the TypeScript module resolution.
import {
  ImportAbort,
  buildUseCasePlan,
  parseDecisions,
  parseUseCaseArgs,
  renderUseCaseRunReport,
  renderUseCaseSummary,
  runUseCaseJob,
  selectUseCaseFiles,
  countUseCasePlan,
  validateUseCasePlan,
} from './kfbm-use-cases-modules.mjs';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  openVerifiedClient,
  prepareConnection,
  redact,
} from './kfbm-session.mjs';
import {
  extractDocxParagraphs,
  parseUseCaseText,
  pathInfo,
  readAttributes,
  walkSource,
} from './kfbm-source.mjs';

const DEFAULT_DECISIONS = fileURLToPath(
  new URL('./kfbm-decisions.json', import.meta.url)
);
const MAX_JSON_BYTES = 50 * 1024 * 1024;
/** A source document above this size is not read (the reader refuses 200 MB anyway). */
const MAX_DOCX_BYTES = 100 * 1024 * 1024;

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
 * Reads and parses the use case files that the plan needs. Files that are
 * chosen but cannot be read (placeholder without --hydrate, timeout, damaged)
 * are handed over without content, the planner skips them with the reason. A
 * file is read after the other, never several at once.
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
  const selection = selectUseCaseFiles(files, decisions, {
    limitedTo: components,
  });
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
    if (file.size > MAX_DOCX_BYTES) {
      out.push({
        ...file,
        readError: `The file is larger than ${MAX_DOCX_BYTES} bytes and is not read.`,
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
      out.push({
        ...file,
        content: { type: 'use-case', result: parseUseCaseText(paragraphs) },
      });
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

/** Plan from a source folder (read only). */
export async function planFromSource(root, args, decisions) {
  const attributes = args.noAttributes ? null : readAttributes(root);
  if (!attributes && !args.noAttributes) {
    console.error(
      'File attributes are not available, placeholders cannot be told apart.'
    );
  }
  const entries = walkSource(root, { attributes });
  const files = entries.map(entry => ({ ...entry, info: pathInfo(entry.rel) }));
  const loaded = await loadSourceFiles(root, files, decisions, {
    components: args.components,
    hydrate: args.hydrate,
    timeoutMs: args.timeoutSeconds ? args.timeoutSeconds * 1000 : undefined,
    onProgress: (done, total) => {
      if (done % 50 === 0) console.error(`${done} of ${total} files read`);
    },
  });
  return buildUseCasePlan(loaded, decisions, { limitedTo: args.components });
}

// The plan file holds the solution texts: owner only where the system has modes.
function writeText(file, text) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
}

function readPlanFile(file) {
  let size;
  try {
    size = statSync(file).size;
  } catch (error) {
    throw new Error(`The plan file ${file} cannot be read: ${error.message}`);
  }
  if (size > MAX_JSON_BYTES) {
    throw new Error(
      `The plan file ${file} is larger than ${MAX_JSON_BYTES} bytes and is not read.`
    );
  }
  try {
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`The plan file ${file} cannot be read: ${error.message}`);
  }
}

async function readPlan(args, decisions) {
  if (args.plan) return readPlanFile(args.plan);
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
  return planFromSource(args.source, args, decisions);
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const parsed = parseUseCaseArgs(argv);
  if (!parsed.ok) {
    for (const error of parsed.errors) console.error(`Error: ${error}`);
    console.error(
      'Usage: node scripts/import/kfbm-use-cases.mjs plan|check|run ... (see the header of the script)'
    );
    return 2;
  }
  const args = parsed.args;
  // The connection string is taken out of the environment at once, so nothing
  // started later (and no other code) can inherit or read it.
  const secret = { DB_CONNECTION_STRING: env.DB_CONNECTION_STRING };
  if (env === process.env) delete process.env.DB_CONNECTION_STRING;

  let decisions;
  try {
    decisions = loadDecisions(args.decisions ?? DEFAULT_DECISIONS);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 2;
  }

  // plan -----------------------------------------------------------------------
  if (args.command === 'plan') {
    let plan;
    try {
      plan = await readPlan(args, decisions);
    } catch (error) {
      console.error(`Error: ${error.message}`);
      return 2;
    }
    const problems = validateUseCasePlan(plan);
    if (args.out) {
      writeText(args.out, JSON.stringify(plan, null, 2));
      writeText(
        args.out.replace(/\.json$/i, '') + '.md',
        renderUseCaseSummary(plan)
      );
      console.log(`Plan written: ${args.out} (summary next to it, .md)`);
    }
    console.log(JSON.stringify(countUseCasePlan(plan)));
    if (problems.length > 0) {
      for (const problem of problems) console.error(`Plan problem: ${problem}`);
      return 1;
    }
    return 0;
  }

  // check and run --------------------------------------------------------------
  const prepared = prepareConnection(args, secret);
  if (!prepared.ok) {
    for (const message of prepared.messages) console.error(message);
    return prepared.status;
  }
  const { connectionString, host } = prepared;

  let plan;
  try {
    plan = await readPlan(args, decisions);
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 2;
  }
  const planProblems = validateUseCasePlan(plan);
  if (planProblems.length > 0) {
    for (const problem of planProblems)
      console.error(`Plan problem: ${problem}`);
    console.error('The plan is not valid. Nothing was done.');
    return 1;
  }

  const session = await openVerifiedClient(prepared, args, 'kfbm-use-cases');
  if (!session.ok) {
    for (const message of session.messages) console.error(message);
    await session.client?.end().catch(() => undefined);
    return session.status;
  }
  const { client, facts } = session;
  for (const note of session.notes) console.error(note);
  try {
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
      solutions: args.useCaseSolutions,
    };
    console.log(
      `Target ${args.target} fits the connection (host ${host}, schema ${facts.current_schema}, role ${facts.current_role}). Mode: ${mode}.`
    );
    try {
      const report = await runUseCaseJob(client, plan, {
        mode,
        target: args.target,
        createdBy: args.createdBy,
        updateExisting: args.updateExisting,
        activate: decisions.content.activate,
        solutions: args.useCaseSolutions,
      });
      const text = renderUseCaseRunReport(report, info);
      console.log(text);
      if (args.reportOut) {
        try {
          writeText(args.reportOut, text);
          console.log(`Report written: ${args.reportOut}`);
        } catch (error) {
          console.error(
            `Warning: the report file ${args.reportOut} cannot be written (${error.message}). ${
              mode === 'apply'
                ? 'The run itself was committed.'
                : 'Nothing was kept.'
            }`
          );
        }
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
