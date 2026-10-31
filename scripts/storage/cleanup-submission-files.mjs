// Cleanup run of the private bucket `submission-files` (the optional file of a use case
// submission, docs/abgabe-datei.md).
//
// Decision of the owner (29.10.2026): a file is kept until the training of the trainee has
// ended. The run removes a file for exactly one of three reasons, nothing else:
//   orphan   an unfinished upload (in incoming/) that is older than 24 hours
//   deleted  the trainee or the use case does not exist any more (their rows are gone)
//   ended    the training of the trainee has ended: the trainee has no enrollment in the
//            occupation of the use case any more (a deactivated profile counts only with
//            --include-deactivated, a deactivation can be temporary)
// The rules, and what "ended" means for the data model, are in
// src/lib/submission-file/cleanup.ts and docs/abgabe-datei.md.
//
// Safety, in the structure of the other scripts (scripts/import/kfbm-documents.mjs):
//  - the default is a DRY RUN: it counts and removes nothing. A real run needs --apply
//  - --target local|preview is always required and is compared with the facts of the
//    connection (host, schema, role). Production is refused in every case, there is no switch
//  - a real run needs --confirm-storage-host <host of NEXT_PUBLIC_SUPABASE_URL> (the secret
//    key goes to that address, and the bucket is shared with Production), and with
//    --target preview also --confirm-host <host of the database connection>
//  - the bucket is fixed in the code (submission-files), it is no argument. The preview
//    run sees only paths under preview/, the local run only paths without that prefix. A path
//    is removed only if it has exactly the form of the bucket (uuid/uuid/uuid/incoming|file/..)
//  - the database is only READ (the session is set read only), the run removes objects and
//    nothing else. It is idempotent: a second run finds nothing left to remove
//  - the protocol shows NUMBERS only: no path, no id, no name, no connection string, no key
//
// Usage:
//   node scripts/storage/cleanup-submission-files.mjs --target local|preview
//        [--apply --confirm-storage-host <host> [--confirm-host <host>]]
//        [--include-deactivated]
//   --include-deactivated  a deactivated profile counts as the end of the training too
//                          (off by default: deactivated trainees keep their files)
//
// Environment (no .env file is read): DB_CONNECTION_STRING, NEXT_PUBLIC_SUPABASE_URL and
// SUPABASE_SECRET_KEY. The dry run needs them too (it reads the bucket and the database).
//
// Exit codes: 0 done, 1 failed or refused (also when objects could not be removed),
// 2 wrong usage.

// Must come first: it registers the TypeScript module resolution for the loads below.
import {
  openVerifiedClient,
  prepareConnection,
  redact,
} from '../import/kfbm-session.mjs';
import { pathToFileURL } from 'node:url';

const load = relative =>
  import(new URL(`../../src/lib/${relative}`, import.meta.url).href);
const [cleanup, documentsStorage] = await Promise.all([
  load('submission-file/cleanup.ts'),
  load('content-import/documents/storage.ts'),
]);
const {
  createCleanupStorage,
  loadCleanupFacts,
  parseCleanupArgs,
  renderCleanupReport,
  runCleanup,
} = cleanup;
const { checkConfirmStorageHost, checkStorageTarget } = documentsStorage;

const SCHEMA_OF = { local: 'public', preview: 'public_preview' };

/**
 * @param {string[]} argv
 * @param {Record<string, string | undefined>} env
 * @param {{ openClient?: typeof openVerifiedClient, createStorage?: typeof createCleanupStorage }} [deps]
 *   tests replace the connection and the storage
 */
export async function run(argv, env, deps = {}) {
  const parsed = parseCleanupArgs(argv);
  if (!parsed.ok) {
    for (const error of parsed.errors) console.error(`Error: ${error}`);
    console.error(
      'Usage: node scripts/storage/cleanup-submission-files.mjs --target local|preview [--apply --confirm-storage-host <host> [--confirm-host <host>]] [--include-deactivated]'
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

  // Everything that needs no connection is checked before the first one is opened
  const problems = checkStorageTarget(args.target, supabaseUrl);
  if (args.apply) {
    problems.push(
      ...checkConfirmStorageHost(args.confirmStorageHost, supabaseUrl)
    );
  }
  if (!secret.SUPABASE_SECRET_KEY) {
    problems.push('SUPABASE_SECRET_KEY is not set, the bucket cannot be read.');
  }
  if (problems.length > 0) {
    for (const problem of problems) console.error(`Refused: ${problem}`);
    return 1;
  }
  const prepared = prepareConnection(args, secret);
  if (!prepared.ok) {
    for (const message of prepared.messages) console.error(message);
    return prepared.status;
  }
  const { connectionString, host } = prepared;
  const clean = text =>
    redact(redact(text, connectionString), secret.SUPABASE_SECRET_KEY);

  const session = await (deps.openClient ?? openVerifiedClient)(
    prepared,
    args,
    'cleanup-submission-files'
  );
  if (!session.ok) {
    for (const message of session.messages) console.error(message);
    await session.client?.end().catch(() => undefined);
    return session.status;
  }
  const { client, facts } = session;
  for (const note of session.notes) console.error(note);
  try {
    // The run only reads the database. Say so to the database as well.
    await client.query('set session characteristics as transaction read only');
    const mode = args.apply ? 'apply' : 'dry-run';
    console.log(
      `Target ${args.target} fits the connection (host ${host}, schema ${facts.current_schema}, role ${facts.current_role}). Mode: ${mode}.`
    );
    const storage = (deps.createStorage ?? createCleanupStorage)({
      url: supabaseUrl,
      key: secret.SUPABASE_SECRET_KEY,
      schema: SCHEMA_OF[args.target],
    });
    const counts = await runCleanup({
      storage,
      loadFacts: ids =>
        loadCleanupFacts((sql, params) => client.query(sql, params), ids),
      schema: SCHEMA_OF[args.target],
      apply: args.apply,
      includeDeactivated: args.includeDeactivated,
    });
    console.log(
      renderCleanupReport(counts, {
        mode,
        target: args.target,
        schema: SCHEMA_OF[args.target],
      })
    );
    if (counts.failed > 0) {
      console.error(
        `${counts.failed} object(s) could not be removed. Run the cleanup again.`
      );
      return 1;
    }
    return 0;
  } catch (error) {
    console.error(`Error: ${clean(error?.message ?? String(error))}`);
    return 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const code = await run(process.argv.slice(2), process.env);
  // A read that never finished must not keep the process alive.
  process.exit(code);
}
