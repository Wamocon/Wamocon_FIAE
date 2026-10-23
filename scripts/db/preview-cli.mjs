// Shared helpers for the database scripts: read the target from the arguments
// and call the Supabase CLI. CLI: SUPABASE_CLI (path to supabase or to
// dist/supabase.js), otherwise "supabase" from the PATH.

import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

// Secrets that must never reach a log line or an error message
const MASKED = new Set();

/** Replaces every known secret value in a text by ***. */
export function mask(text) {
  let out = String(text);
  for (const secret of MASKED) out = out.split(secret).join('***');
  return out;
}

/** Registers a connection string (and its password) for masking. */
export function remember(connectionString) {
  MASKED.add(connectionString);
  try {
    const url = new URL(connectionString);
    if (url.password) {
      MASKED.add(url.password);
      MASKED.add(decodeURIComponent(url.password));
    }
  } catch {
    // not a URL, the whole string is masked anyway
  }
}

/**
 * --db-url-env <NAME> | --db-url <url> | --local | --linked as CLI arguments,
 * otherwise null. --db-url-env reads the connection string from the environment
 * variable NAME, so the value never appears in a command line of a workflow.
 */
export function targetFrom(args) {
  if (args.includes('--db-url-env')) {
    const name = args[args.indexOf('--db-url-env') + 1];
    const value = name ? process.env[name] : undefined;
    if (!value) {
      throw new Error(
        `Environment variable ${name ?? '(missing name)'} is not set (secret of the environment, see docs/release-prozess.md).`
      );
    }
    remember(value);
    return ['--db-url', value];
  }
  if (args.includes('--db-url')) {
    const value = args[args.indexOf('--db-url') + 1];
    remember(value);
    return ['--db-url', value];
  }
  if (args.includes('--local')) return ['--local'];
  if (args.includes('--linked')) return ['--linked'];
  return null;
}

/**
 * The login of the CLI at the database failed before any statement ran. The
 * CLI creates a login role (cli_login_postgres) with a new password for every
 * call. If two workflows run against the same project at the same time, one
 * resets the password of the other: "password authentication failed for user
 * cli_login_postgres". Only this error is retried: it occurs before a
 * statement, so a second attempt cannot apply anything twice.
 */
export const LOGIN_REJECTED =
  /DbConfigConnectTempRoleError|password authentication failed for user "cli_login_postgres"/;

export function sleep(seconds) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, seconds * 1000);
}

/** Program and leading arguments of the CLI. */
export function cliProgram() {
  const path = process.env.SUPABASE_CLI || 'supabase';
  return path.endsWith('.js') ? [process.execPath, [path]] : [path, []];
}

function once(parameters) {
  const [program, lead] = cliProgram();
  try {
    return execFileSync(program, [...lead, ...parameters], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 256 * 1024 * 1024,
    });
  } catch (e) {
    const message = `${e.stdout ?? ''}${e.stderr ?? ''}`
      .replace(
        /(Initialising login role|Connecting to [a-z ]+database)\.\.\.\s*/g,
        ''
      )
      .trim();
    throw new Error(mask(message || e.message));
  }
}

/**
 * Calls the Supabase CLI. A rejected login (see LOGIN_REJECTED) is tried up to
 * four times with a growing pause (20, 40, 60 seconds); any other error counts
 * immediately. SUPABASE_CLI_RETRIES and SUPABASE_CLI_PAUSE (seconds) change
 * this, tests set them small.
 */
export function cli(parameters) {
  const attempts = Number(process.env.SUPABASE_CLI_RETRIES ?? 4);
  const pause = Number(process.env.SUPABASE_CLI_PAUSE ?? 20);
  for (let attempt = 1; ; attempt++) {
    try {
      return once(parameters);
    } catch (e) {
      if (attempt >= attempts || !LOGIN_REJECTED.test(e.message)) throw e;
      console.error(
        `Database login rejected (attempt ${attempt} of ${attempts}), probably a concurrent run. Retrying in ${pause * attempt} seconds.`
      );
      sleep(pause * attempt);
    }
  }
}

/**
 * Reads the rows from the answer of "supabase db query --output-format json":
 * a JSON array or, when an AI agent is detected, an object with "rows". An
 * answer without this shape is an error and not an empty result: the CLI once
 * switched silently to another format in CI, and "no rows" would turn into
 * "no difference in the history".
 * emptyAllowed: for statements without result (DO blocks).
 */
export function readAnswer(out, { emptyAllowed = false } = {}) {
  const start = out.search(/[[{]/);
  if (start < 0) {
    if (emptyAllowed) return [];
    throw new Error(
      `Answer of the Supabase CLI without JSON: ${out.slice(0, 300) || '(empty)'}`
    );
  }
  const end = Math.max(out.lastIndexOf(']'), out.lastIndexOf('}'));
  let data;
  try {
    data = JSON.parse(out.slice(start, end + 1));
  } catch {
    throw new Error(
      `Answer of the Supabase CLI not readable: ${out.slice(0, 300)}`
    );
  }
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.rows)) return data.rows;
  if (emptyAllowed) return [];
  throw new Error(
    `Answer of the Supabase CLI without rows: ${out.slice(0, 300)}`
  );
}

/**
 * Runs a single SQL statement and returns its rows.
 * @param {{ emptyAllowed?: boolean }} [options] see readAnswer
 */
export function query(target, sql, options = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'db-sql-'));
  try {
    const file = join(dir, 'query.sql');
    writeFileSync(file, sql);
    // --agent no: otherwise the CLI wraps the result differently once it detects an AI agent
    const out = cli([
      'db',
      'query',
      ...target,
      '-f',
      file,
      '--output-format',
      'json',
      '--agent',
      'no',
    ]);
    return readAnswer(out, options);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}
