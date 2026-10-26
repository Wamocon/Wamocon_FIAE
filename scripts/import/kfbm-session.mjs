// The guarded connection of the KfBM import scripts: the checks that run before
// the first statement (host, target, TLS) and the facts check of the open
// connection. The same rules as scripts/import/kfbm-apply.mjs, written once for
// the learning field script (src/lib/content-import/apply/target.ts holds the
// checks themselves).
//
// The connection comes from the environment variable DB_CONNECTION_STRING and
// from nowhere else, no .env file is read. The client is built from explicit
// fields, never from the string, so the host that was checked is the host that
// is used (the driver would let ?host= override it). Nothing here prints the
// connection string.

import {
  checkConfirmHost,
  checkTargetFacts,
  checkTargetHost,
  isLoopbackHost,
  parseConnectionString,
} from './kfbm-apply-modules.mjs';

/** Hides the connection string and its password in a message. */
export const redact = (text, secret) => {
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

/**
 * Checks everything that does not need a connection: the variable, the
 * connection string, the host against the target and the confirmed host.
 * @param {{ target: 'local' | 'preview' | null, apply: boolean, confirmHost: string | null }} args
 * @param {Record<string, string | undefined>} env
 * @returns {{ ok: true, connectionString: string, connection: any, host: string }
 *   | { ok: false, status: number, messages: string[] }}
 */
export function prepareConnection(args, env) {
  const connectionString = env.DB_CONNECTION_STRING;
  if (!connectionString) {
    return {
      ok: false,
      status: 2,
      messages: [
        'Error: DB_CONNECTION_STRING is not set. The connection is taken from this environment variable only.',
      ],
    };
  }
  const parsed = parseConnectionString(connectionString);
  if (!parsed.ok) {
    return {
      ok: false,
      status: 1,
      messages: parsed.errors.map(problem => `Refused: ${problem}`),
    };
  }
  const connection = parsed.connection;
  const host = connection.host;
  const early = [
    ...checkTargetHost(args.target, host),
    ...checkConfirmHost(args, host),
  ];
  if (early.length > 0) {
    return {
      ok: false,
      status: 1,
      messages: [
        ...early.map(problem => `Refused: ${problem}`),
        'The target does not fit the connection. Nothing was done.',
      ],
    };
  }
  return { ok: true, connectionString, connection, host };
}

/**
 * Opens the connection and compares the facts of the database (schema, role,
 * Preview markers) with the declared target. The caller ends the client.
 * @param {{ connectionString: string, connection: any, host: string }} prepared
 * @param {{ target: 'local' | 'preview' | null }} args
 * @param {string} applicationName
 * @returns {Promise<{ ok: true, client: any, facts: any, notes: string[] }
 *   | { ok: false, status: number, messages: string[], client?: any }>}
 */
export async function openVerifiedClient(prepared, args, applicationName) {
  const { connectionString, connection, host } = prepared;
  const loopback = isLoopbackHost(host);
  const notes = [];
  if (!loopback && connection.sslmode === 'disable') {
    return {
      ok: false,
      status: 1,
      messages: ['Refused: a hosted database needs TLS (sslmode=disable).'],
    };
  }
  if (!loopback && !['verify-ca', 'verify-full'].includes(connection.sslmode)) {
    notes.push(
      'Note: TLS without certificate verification (as the reindex script). Use ?sslmode=verify-full with the CA of the host to verify.'
    );
  }
  let pg;
  try {
    pg = (await import('pg')).default;
  } catch (error) {
    return {
      ok: false,
      status: 1,
      messages: [
        `Error: the database driver cannot be loaded (${error.message})`,
      ],
    };
  }
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
    application_name: applicationName,
    connectionTimeoutMillis: 15000,
  });
  try {
    await client.connect();
  } catch (error) {
    return {
      ok: false,
      status: 1,
      messages: [
        `Error: the connection failed (${redact(error.message, connectionString)})`,
      ],
    };
  }
  let facts;
  try {
    facts = (
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
  } catch (error) {
    return {
      ok: false,
      status: 1,
      messages: [
        `Error: the facts of the database cannot be read (${redact(error.message, connectionString)}). Nothing was done.`,
      ],
      client,
    };
  }
  const problems = checkTargetFacts(args.target, {
    host,
    currentSchema: facts?.current_schema ?? null,
    resolvedSchema: facts?.resolved_schema ?? null,
    currentUser: facts?.current_role ?? null,
    sessionUser: facts?.session_role ?? null,
    hasPreviewMarkers: facts?.has_preview_markers ?? null,
  });
  if (problems.length > 0) {
    return {
      ok: false,
      status: 1,
      messages: [
        ...problems.map(problem => `Refused: ${problem}`),
        'The target does not fit the connection. Nothing was done.',
      ],
      client,
    };
  }
  return { ok: true, client, facts, notes };
}
