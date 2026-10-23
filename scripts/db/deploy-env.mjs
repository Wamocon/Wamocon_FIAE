// Pins the database schema of a deployment and checks the pulled Vercel
// environment before the build.
//
// Why: NEXT_PUBLIC_* is baked into the bundle at build time, so every
// deployment needs its own build with the right schema. The deploy action
// derives the schema from the target and never accepts it as an input:
//   preview    -> public_preview
//   production -> public
// After "vercel pull" this script rewrites NEXT_PUBLIC_DB_SCHEMA and
// SUPABASE_DB_SCHEMA in the pulled env file to the fixed value (whatever the
// Vercel project says), verifies the result and checks the database role in
// DB_CONNECTION_STRING: Preview must connect as the role app_preview (search_path
// public_preview, no rights on public), Production must not. Values are never
// printed.
//
// Usage: node scripts/db/deploy-env.mjs --target preview|production --file <env file> [--github-env]

import { appendFileSync, readFileSync, writeFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

export const SCHEMA_BY_TARGET = {
  preview: 'public_preview',
  production: 'public',
};
export const SCHEMA_KEYS = ['NEXT_PUBLIC_DB_SCHEMA', 'SUPABASE_DB_SCHEMA'];
export const PREVIEW_ROLE = 'app_preview';

const LINE = /^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)$/;

function unquote(value) {
  const v = value.trim();
  if (
    v.length >= 2 &&
    ((v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'")))
  ) {
    return v.slice(1, -1);
  }
  return v;
}

/** Parses an env file into a Map (later definitions win). */
export function parseEnv(text) {
  const map = new Map();
  for (const line of text.split(/\r?\n/)) {
    const m = LINE.exec(line);
    if (m && !line.trim().startsWith('#')) map.set(m[1], unquote(m[2]));
  }
  return map;
}

/** Removes every definition of the schema keys and appends the fixed values. */
export function pinSchema(text, schema) {
  const kept = text
    .split(/\r?\n/)
    .filter(line => {
      const m = LINE.exec(line);
      return !(m && SCHEMA_KEYS.includes(m[1]));
    })
    .join('\n')
    .replace(/\n*$/, '\n');
  return kept + SCHEMA_KEYS.map(k => `${k}="${schema}"`).join('\n') + '\n';
}

/** User name of a connection string, null if it cannot be read. */
export function connectionUser(connectionString) {
  try {
    const user = new URL(connectionString).username;
    return user ? decodeURIComponent(user) : null;
  } catch {
    return null;
  }
}

/**
 * @param {{ target: string, env: Map<string,string> }} input env: the pulled environment after pinSchema
 * @returns {string[]} errors, messages without values
 */
export function checkDeployEnv({ target, env }) {
  const errors = [];
  const schema = SCHEMA_BY_TARGET[target];
  if (!schema) return [`unknown target "${target}"`];
  for (const key of SCHEMA_KEYS) {
    if (env.get(key) !== schema) {
      errors.push(`${key} must be ${schema} for ${target}, but it is not`);
    }
  }
  const connection = env.get('DB_CONNECTION_STRING');
  if (!connection) {
    errors.push(
      `DB_CONNECTION_STRING is not set in the Vercel environment for ${target}`
    );
  } else {
    const user = connectionUser(connection);
    if (user === null) {
      errors.push('DB_CONNECTION_STRING cannot be parsed as a URL with a user');
    } else if (target === 'preview' && !user.startsWith(PREVIEW_ROLE)) {
      errors.push(
        `Preview must connect as the role ${PREVIEW_ROLE} (user name starts with ${PREVIEW_ROLE}), not as another role`
      );
    } else if (target === 'production' && user.startsWith(PREVIEW_ROLE)) {
      errors.push(`Production must not connect as the role ${PREVIEW_ROLE}`);
    }
  }
  return errors;
}

function main() {
  const args = process.argv.slice(2);
  const arg = name => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : null;
  };
  const target = arg('--target');
  const file = arg('--file');
  if (!SCHEMA_BY_TARGET[target ?? ''] || !file) {
    console.error(
      'Usage: node scripts/db/deploy-env.mjs --target preview|production --file <env file> [--github-env]'
    );
    process.exit(2);
  }
  const schema = SCHEMA_BY_TARGET[target];
  const pinned = pinSchema(readFileSync(file, 'utf8'), schema);
  writeFileSync(file, pinned);
  const errors = checkDeployEnv({ target, env: parseEnv(pinned) });
  if (errors.length > 0) {
    for (const e of errors) console.error(`::error::${e}`);
    process.exit(1);
  }
  if (args.includes('--github-env') && process.env.GITHUB_ENV) {
    appendFileSync(
      process.env.GITHUB_ENV,
      SCHEMA_KEYS.map(k => `${k}=${schema}`).join('\n') + '\n'
    );
  }
  console.log(
    `Deploy environment for ${target}: database schema pinned to ${schema}, role check passed.`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
