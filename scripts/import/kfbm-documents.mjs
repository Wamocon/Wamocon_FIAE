// PDF script of the KfBM content import: the PDF files of the source folder Komponenten_PDF
// (teaching text, scenario, use case task, model solution) become rows of content_documents and
// files in the storage, in the form that FIAE uses for the same kind of document (rows and
// rules: src/lib/content-import/documents/engine.ts).
//
// It has the same safety structure as the other import scripts (kfbm-apply.mjs): by default
// NOTHING is kept, `run` executes everything inside one transaction and rolls it back, and the
// storage is not touched. A real run needs --apply, a target (--target local|preview) and a
// connection whose host, schema and role fit that target. Production is refused in every
// case, there is no switch.
//
// Order: the content import (kfbm-apply.mjs) and the use case import (kfbm-use-cases.mjs) come
// first, they write the enablers and the use cases that the PDFs hang on. A PDF whose enabler
// or use case is not in the target is left out and reported.
//
// Commands:
//   plan  <source folder> [--out <plan.json>] [--components K1,K6.2] [--hydrate]
//         [--timeout <seconds>] [--no-attributes]
//         Reads the file names and the first page of every PDF (read only), matches each file to
//         an enabler by its name AND by the first heading of the first page, and writes the plan.
//         No database, no network. Next to the JSON a summary in Markdown (same name, .md): counts
//         per kind and the files that are not taken (misnamed, annotated, heading mismatch,
//         duplicate), names only, no content.
//   check <source folder> --target local|preview --created-by <profile uuid>
//         [--components ...] [--hydrate] [--report-out <file.md>]
//         Compares the files with the target database in a read-only transaction.
//   run   <source folder> --target local|preview --created-by <profile uuid> [--apply]
//         [--overwrite-files] [--confirm-host <host of the connection>]
//         [--components ...] [--hydrate] [--report-out <file.md>]
//         Dry run (default): the rows are written inside a transaction and rolled back, the
//         storage is not touched. With --apply the files are copied and the transaction is
//         committed. A real run against the Preview also needs --confirm-host. Large runs go
//         component by component (--components), the transaction stays open while the files of
//         one run are copied.
//
// Storage: the files go to the buckets `content` (public: teaching text, scenario, task) and
// `content-solutions` (PRIVATE: model solutions, the bucket is created by hand). The address and
// the secret key come from NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SECRET_KEY of the environment
// (no .env file is read). A local target needs a local storage address, the Preview the https
// address of the project. The paths carry their own prefix (preview/kfbm/ and kfbm/).
//
// The script prints neither the connection string nor the key nor any content of a file. It calls
// no model and no network except the target database and, with --apply, the storage. It never
// deletes a row, never replaces a file unless --overwrite-files is given and does not trigger an
// index run.
//
// Exit codes: 0 done, 1 failed or refused, 2 wrong usage, 3 conflicts.

// Must come first: registers the TypeScript module resolution.
import {
  ImportAbort,
  buildDocumentPlan,
  checkStorageTarget,
  classifyPdfPath,
  countPlan,
  createSupabaseStorage,
  parseDocumentsArgs,
  renderDocumentRunReport,
  renderPlanSummary,
  runDocumentJob,
  validateDocumentPlan,
  MAX_PDF_BYTES,
} from './kfbm-documents-modules.mjs';
import { createHash } from 'node:crypto';
import { mkdirSync, statSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import {
  openVerifiedClient,
  prepareConnection,
  redact,
} from './kfbm-session.mjs';
import { readAttributes, walkSource } from './kfbm-source.mjs';

const require = createRequire(import.meta.url);

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

/** Number of pages and the text of the first page, or nulls when the PDF cannot be read. */
async function firstPage(bytes) {
  try {
    // the file of the library itself: its index.js runs a test file when it is the main module
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    const result = await pdfParse(Buffer.from(bytes), { max: 1 });
    return {
      pageCount: Number.isInteger(result.numpages) ? result.numpages : null,
      headText: typeof result.text === 'string' ? result.text : null,
    };
  } catch {
    return { pageCount: null, headText: null };
  }
}

/**
 * The PDFs of the source folder with what is read from them: size, magic bytes, hash, page count
 * and the text of the first page (only used to find the heading). A file is read after the
 * other. A file that is not part of the import (by its path) is not read at all.
 */
export async function scanSource(root, args, options = {}) {
  const { read = readFile, parse = firstPage, onProgress } = options;
  const timeoutMs = args.timeoutSeconds ? args.timeoutSeconds * 1000 : 60000;
  const attributes = args.noAttributes ? null : readAttributes(root);
  if (!attributes && !args.noAttributes) {
    console.error(
      'File attributes are not available, placeholders cannot be told apart.'
    );
  }
  const entries = walkSource(root, { attributes }).filter(e =>
    /\.pdf$/i.test(e.rel)
  );
  const wanted = entries.filter(e => {
    const c = classifyPdfPath(e.rel);
    return (
      args.components.length === 0 ||
      !c.componentCode ||
      args.components.includes(c.componentCode.toUpperCase())
    );
  });
  const out = [];
  let timeoutsInARow = 0;
  let done = 0;
  for (const entry of wanted) {
    const file = { rel: entry.rel, size: entry.size };
    const c = classifyPdfPath(entry.rel);
    if (
      c.status === 'ignored' ||
      c.status === 'misnamed' ||
      c.status === 'annotated'
    ) {
      out.push(file);
      continue;
    }
    if (entry.placeholder && !args.hydrate) {
      out.push({ ...file, readError: 'placeholder' });
      continue;
    }
    if (timeoutsInARow >= 3) {
      out.push({ ...file, readError: 'stopped after three timeouts' });
      continue;
    }
    if (entry.size > MAX_PDF_BYTES) {
      out.push(file);
      continue;
    }
    try {
      const bytes = await withTimeout(
        read(path.join(root, ...entry.rel.split('/'))),
        timeoutMs
      );
      timeoutsInARow = 0;
      const magicOk =
        Buffer.from(bytes.subarray(0, 5)).toString('latin1') === '%PDF-';
      const page = magicOk
        ? await parse(bytes)
        : { pageCount: null, headText: null };
      out.push({
        ...file,
        size: bytes.length,
        magicOk,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        ...page,
      });
    } catch (error) {
      timeoutsInARow = error instanceof TimeoutError ? timeoutsInARow + 1 : 0;
      out.push({
        ...file,
        readError: error instanceof Error ? error.message : String(error),
      });
    }
    done += 1;
    onProgress?.(done, wanted.length);
  }
  return out;
}

export async function planFromSource(root, args) {
  const files = await scanSource(root, args, {
    onProgress: (done, total) => {
      if (done % 100 === 0) console.error(`${done} of ${total} files read`);
    },
  });
  return buildDocumentPlan(files);
}

// The plan file holds names, codes and hashes: owner only where the system has modes.
function writeText(file, text) {
  mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  writeFileSync(file, text, { encoding: 'utf8', mode: 0o600 });
}

/** A storage that must not be called: check and dry run never touch the storage. */
const noStorage = {
  async exists() {
    throw new Error('The storage is not used in this mode.');
  },
  async put() {
    throw new Error('The storage is not used in this mode.');
  },
  async remove() {
    throw new Error('The storage is not used in this mode.');
  },
};

export async function main(argv = process.argv.slice(2), env = process.env) {
  const parsed = parseDocumentsArgs(argv);
  if (!parsed.ok) {
    for (const error of parsed.errors) console.error(`Error: ${error}`);
    console.error(
      'Usage: node scripts/import/kfbm-documents.mjs plan|check|run ... (see the header of the script)'
    );
    return 2;
  }
  const args = parsed.args;
  // The secrets are taken out of the environment at once, so nothing started later can read them.
  const secret = {
    DB_CONNECTION_STRING: env.DB_CONNECTION_STRING,
    SUPABASE_SECRET_KEY: env.SUPABASE_SECRET_KEY,
  };
  const supabaseUrl = env.NEXT_PUBLIC_SUPABASE_URL ?? null;
  if (env === process.env) {
    delete process.env.DB_CONNECTION_STRING;
    delete process.env.SUPABASE_SECRET_KEY;
  }

  const stat = (() => {
    try {
      return statSync(args.source);
    } catch {
      return null;
    }
  })();
  if (!stat?.isDirectory()) {
    console.error(`Error: ${args.source} is not a folder or does not exist.`);
    return 2;
  }

  // plan -----------------------------------------------------------------------
  if (args.command === 'plan') {
    const plan = await planFromSource(args.source, args);
    const problems = validateDocumentPlan(plan);
    if (args.out) {
      writeText(args.out, JSON.stringify(plan, null, 2));
      writeText(
        args.out.replace(/\.json$/i, '') + '.md',
        renderPlanSummary(plan)
      );
      console.log(`Plan written: ${args.out} (summary next to it, .md)`);
    }
    console.log(JSON.stringify(countPlan(plan)));
    if (problems.length > 0) {
      for (const problem of problems) console.error(`Plan problem: ${problem}`);
      return 1;
    }
    return 0;
  }

  // check and run --------------------------------------------------------------
  const apply = args.command === 'run' && args.apply;
  if (apply) {
    const problems = checkStorageTarget(args.target, supabaseUrl);
    if (!secret.SUPABASE_SECRET_KEY) {
      problems.push('SUPABASE_SECRET_KEY is not set, files cannot be stored.');
    }
    if (problems.length > 0) {
      for (const problem of problems) console.error(`Refused: ${problem}`);
      return 1;
    }
  }
  const prepared = prepareConnection(args, secret);
  if (!prepared.ok) {
    for (const message of prepared.messages) console.error(message);
    return prepared.status;
  }
  const { connectionString, host } = prepared;

  const plan = await planFromSource(args.source, args);
  const planProblems = validateDocumentPlan(plan);
  if (planProblems.length > 0) {
    for (const problem of planProblems)
      console.error(`Plan problem: ${problem}`);
    console.error('The plan is not valid. Nothing was done.');
    return 1;
  }

  const session = await openVerifiedClient(prepared, args, 'kfbm-documents');
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
      overwriteFiles: args.overwriteFiles,
    };
    console.log(
      `Target ${args.target} fits the connection (host ${host}, schema ${facts.current_schema}, role ${facts.current_role}). Mode: ${mode}.`
    );
    const storage = apply
      ? createSupabaseStorage({
          url: supabaseUrl,
          key: secret.SUPABASE_SECRET_KEY,
        })
      : noStorage;
    try {
      const report = await runDocumentJob(client, storage, plan, {
        mode,
        target: args.target,
        createdBy: args.createdBy,
        overwriteFiles: args.overwriteFiles,
        supabaseUrl,
        bytesOf: item =>
          readFile(path.join(args.source, ...item.rel.split('/'))),
      });
      const text = renderDocumentRunReport(report, info);
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
          'Dry run: the transaction was rolled back, nothing was kept, no file was copied.'
        );
      } else if (mode === 'check') {
        console.log('Check: nothing was written.');
      } else {
        console.log(
          'Real run: the files were copied and the transaction was committed.'
        );
      }
      if (report.conflicts.length > 0) {
        console.error(
          `${report.conflicts.length} conflict(s) between the plan and the target (see the report).`
        );
        return 3;
      }
      return 0;
    } catch (error) {
      const clean = text =>
        redact(redact(text, connectionString), secret.SUPABASE_SECRET_KEY);
      if (error instanceof ImportAbort) {
        console.error(`Stopped (${error.code}): ${clean(error.message)}`);
        for (const c of error.conflicts) {
          console.error(`  conflict: ${c.table} ${c.key}: ${c.reason}`);
        }
        console.error('The transaction was rolled back, nothing was kept.');
        return error.code === 'CONFLICTS' ? 3 : 1;
      }
      console.error(
        `Error: ${clean(error.message)}. The transaction was rolled back, nothing was kept, files of this run were removed.`
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
