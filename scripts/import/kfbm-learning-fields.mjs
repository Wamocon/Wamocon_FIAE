// Learning field script of the KfBM content import (phase 4.5): the 13 learning
// fields of the KfBM and the assignment of the enablers of the content import to
// them, from the mapping table (Excel). It has the same safety structure as the
// apply script (kfbm-apply.mjs): by default NOTHING is kept, `run` executes
// everything inside one transaction and rolls it back. A real run needs --apply,
// a target (--target local|preview) and a connection whose host, schema and role
// fit that target. Production is refused in every case, there is no switch.
//
// Why a script of its own: the input is a table and a list of codes, not the
// Word documents of the content import, and the plan has another shape. The
// connection, the target check and the transaction are the same code
// (kfbm-session.mjs, src/lib/content-import/apply/*).
//
// Order: the content import (kfbm-apply.mjs run --apply) comes first, it writes
// the enablers. This script then writes the learning fields and the
// mappings. A mapping whose enabler is not in the target is skipped and
// reported, a target without any enabler stops the run. The use case import
// (kfbm-use-cases.mjs) comes after it: run this script AGAIN afterwards. In
// check, dry run and real run it reads the use cases of the catalog from the
// database and, for every mapping (learning field, enabler), adds the mapping
// (learning field, use case) of the use case that hangs on the enabler
// (use_cases.enabler_id). It also adds the learning field code to
// use_cases.lernfelder, the column the learning field pages read. Only missing
// things are written (a second run changes nothing), enablers without a use
// case and use cases without an enabler are reported.
//
// Commands:
//   plan <mapping table .xlsx> (--import-plan <apply plan.json> |
//         --import-source <source folder>) [--titles <file>] [--out <plan.json>]
//         [--decisions <file>]
//         Reads the table (read only) and the codes of the import and writes the
//         plan. No database, no network. Next to the JSON a summary in Markdown
//         without any cell text (same name, .md). The learning fields get the
//         official titles and time guidelines (hours) of the framework
//         curriculum (src/lib/content-import/learning-fields/official.ts), and
//         as description the verbatim Zielformulierung of the same source. A
//         titles file of the owner (.json, {"LF1": "..."}) wins over the
//         official title, the source list (.csv, provisional) does not. The
//         folder is only listed (names and sizes), no document is opened.
//   check --plan <plan.json> --target local|preview [--report-out <file.md>]
//         Compares the plan with the target database in a read-only transaction.
//   run   --plan <plan.json> --target local|preview [--apply]
//         [--update-existing] [--confirm-host <host>] [--report-out <file.md>]
//         Dry run (default): everything is written inside a transaction, the
//         counts are printed, then the transaction is rolled back. With --apply
//         the transaction is committed. A real run against the Preview also
//         needs --confirm-host <host of the connection>. An empty description
//         of a learning field is always filled. --update-existing updates the
//         title, the description and the hours (hours_budget) of learning
//         fields that exist (a title never to a placeholder, the hours and the
//         description never to empty), nothing else.
//
// The connection comes from the environment variable DB_CONNECTION_STRING and
// from nowhere else (no .env file is read). The script prints neither the
// connection string nor any text of the table. It calls no model and no network
// except the target database, and it never deletes.
//
// Exit codes: 0 done, 1 failed or refused, 2 wrong usage, 3 conflicts.

// Must come first: registers the TypeScript module resolution.
import {
  ImportAbort,
  buildLearningFieldPlan,
  importIndexFromFiles,
  importIndexFromPlan,
  parseDecisions,
  parseLearningFieldArgs,
  parseMappingSheet,
  readXlsxRows,
  renderLearningFieldRunReport,
  renderLearningFieldSummary,
  runLearningFieldJob,
  selectFiles,
  titlesFromJson,
  titlesFromSourceCsv,
  validateLearningFieldPlan,
} from './kfbm-learning-fields-modules.mjs';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  openVerifiedClient,
  prepareConnection,
  redact,
} from './kfbm-session.mjs';
import { pathInfo, walkSource } from './kfbm-source.mjs';

const DEFAULT_DECISIONS = fileURLToPath(
  new URL('./kfbm-decisions.json', import.meta.url)
);
const READ_TIMEOUT_MS = 60000;

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new Error(
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

function writeText(file, text) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, text, 'utf8');
}

/** Refuses a file above the limit before it is read. */
function assertSize(file, maxBytes, what) {
  let size;
  try {
    size = statSync(file).size;
  } catch (error) {
    throw new Error(`The ${what} ${file} cannot be read: ${error.message}`);
  }
  if (size > maxBytes) {
    throw new Error(
      `The ${what} ${file} is larger than ${maxBytes} bytes and is not read.`
    );
  }
}

const MAX_JSON_BYTES = 10 * 1024 * 1024;
const MAX_EXCEL_BYTES = 50 * 1024 * 1024;

function readJson(file, what) {
  try {
    assertSize(file, MAX_JSON_BYTES, what);
    return JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw new Error(`The ${what} ${file} cannot be read: ${error.message}`);
  }
}

function loadDecisions(file) {
  const result = parseDecisions(readJson(file, 'decisions file'));
  if (!result.ok) {
    throw new Error(
      `The decisions file ${file} is not valid: ${result.errors.join('; ')}`
    );
  }
  return result.decisions;
}

/** Titles from a .json file of the owner or from the source list (.csv). */
function loadTitles(file) {
  const kind = path.extname(file).toLowerCase();
  if (kind !== '.json' && kind !== '.csv') {
    throw new Error('The titles file must be a .json or .csv file.');
  }
  let text;
  try {
    assertSize(file, MAX_JSON_BYTES, 'titles file');
    text = readFileSync(file, 'utf8').replace(/^﻿/, '');
  } catch (error) {
    throw new Error(`The titles file ${file} cannot be read: ${error.message}`);
  }
  if (kind === '.csv') return titlesFromSourceCsv(text);
  const result = titlesFromJson(text);
  if (!result.ok) {
    throw new Error(`The titles file ${file}: ${result.errors.join(' ')}`);
  }
  return result.set;
}

/** The codes of the content import, from an apply plan or from the names of the source folder. */
function loadImportIndex(args, decisions) {
  const excluded = decisions.components.excludedNumbers;
  if (args.importPlan) {
    return importIndexFromPlan(
      readJson(args.importPlan, 'import plan'),
      excluded
    );
  }
  const stat = (() => {
    try {
      return statSync(args.importSource);
    } catch {
      return null;
    }
  })();
  if (!stat?.isDirectory()) {
    throw new Error(`${args.importSource} is not a folder or does not exist.`);
  }
  // Names, sizes and times only: no document is opened.
  const files = walkSource(args.importSource).map(entry => ({
    ...entry,
    info: pathInfo(entry.rel),
  }));
  const selection = selectFiles(files, decisions);
  return importIndexFromFiles(files, selection.chosen, excluded);
}

/** Plan from the table and the codes of the import (read only). */
export async function planFromTable(args, decisions) {
  let buffer;
  try {
    assertSize(args.excel, MAX_EXCEL_BYTES, 'mapping table');
    buffer = await withTimeout(readFile(args.excel), READ_TIMEOUT_MS);
  } catch (error) {
    throw new Error(
      `The mapping table ${args.excel} cannot be read: ${error.message}`
    );
  }
  let table;
  try {
    table = await readXlsxRows(buffer);
  } catch (error) {
    throw new Error(
      `The mapping table ${args.excel} cannot be read: ${error.message}`
    );
  }
  const sheet = parseMappingSheet(table.rows);
  if (!sheet.ok) {
    throw new Error(`The mapping table ${args.excel}: ${sheet.error}`);
  }
  const index = loadImportIndex(args, decisions);
  const titles = args.titles ? loadTitles(args.titles) : null;
  return buildLearningFieldPlan(sheet.sheet, index, {
    titles,
    sheetName: table.sheetName,
  });
}

function planCounts(plan) {
  return {
    learningFields: plan.learningFields.length,
    positions: plan.stats.positions,
    mappings: plan.stats.mappings,
    skipped: plan.skipped.length,
    notes: plan.notes.length,
  };
}

export async function main(argv = process.argv.slice(2), env = process.env) {
  const parsed = parseLearningFieldArgs(argv);
  if (!parsed.ok) {
    for (const error of parsed.errors) console.error(`Error: ${error}`);
    console.error(
      'Usage: node scripts/import/kfbm-learning-fields.mjs plan|check|run ... (see the header of the script)'
    );
    return 2;
  }
  const args = parsed.args;
  // The connection string is taken out of the environment at once, so nothing
  // started later (and no other code) can inherit or read it.
  const secret = { DB_CONNECTION_STRING: env.DB_CONNECTION_STRING };
  if (env === process.env) delete process.env.DB_CONNECTION_STRING;

  // plan -----------------------------------------------------------------------
  if (args.command === 'plan') {
    let plan;
    try {
      plan = await planFromTable(
        args,
        loadDecisions(args.decisions ?? DEFAULT_DECISIONS)
      );
    } catch (error) {
      console.error(`Error: ${error.message}`);
      return 2;
    }
    const problems = validateLearningFieldPlan(plan);
    if (args.out) {
      writeText(args.out, JSON.stringify(plan, null, 2));
      writeText(
        args.out.replace(/\.json$/i, '') + '.md',
        renderLearningFieldSummary(plan)
      );
      console.log(`Plan written: ${args.out} (summary next to it, .md)`);
    }
    console.log(JSON.stringify(planCounts(plan)));
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
    plan = readJson(args.plan, 'plan file');
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return 2;
  }
  const planProblems = validateLearningFieldPlan(plan);
  if (planProblems.length > 0) {
    for (const problem of planProblems)
      console.error(`Plan problem: ${problem}`);
    console.error('The plan is not valid. Nothing was done.');
    return 1;
  }

  const session = await openVerifiedClient(
    prepared,
    args,
    'kfbm-learning-fields'
  );
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
    };
    console.log(
      `Target ${args.target} fits the connection (host ${host}, schema ${facts.current_schema}, role ${facts.current_role}). Mode: ${mode}.`
    );
    try {
      const report = await runLearningFieldJob(client, plan, {
        mode,
        updateExisting: args.updateExisting,
      });
      const text = renderLearningFieldRunReport(report, info);
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
