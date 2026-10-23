// Checks migration files before they may reach a hosted database.
//
// Why: `supabase db push` applies only migrations that are NEWER than the last
// applied one. A later inserted older file or a changed, already applied file
// is silently not executed: locally and in CI (fresh database) everything looks
// green, the hosted database deviates. This check catches that in the pull
// request.
//
// Rules:
//  1. File name <14 digits>_<name>.sql, versions unique. Known legacy files
//     (12 digit prefix) are listed in supabase/legacy-migrations.txt and exempt.
//  2. New migrations must be NEWER than every migration on the base branch.
//  3. Existing migrations must not be changed, renamed or deleted.
//  4. Destructive statements (DROP TABLE/COLUMN/SCHEMA, TRUNCATE, DELETE without
//     WHERE) need the explicit approval "-- migration:destructive-ok" in the file.
//  5. New migrations must be rewritable for the schema public_preview
//     (scripts/db/preview-rewrite.mjs), because every migration runs there
//     first (on the PR push, before public).
//
// Usage:  node scripts/db/migration-check.mjs [--base origin/master]

import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { newMigrationChecks, rewrite } from './preview-rewrite.mjs';

const FOLDER = 'supabase/migrations';
const LEGACY_FILE = 'supabase/legacy-migrations.txt';
const STRICT_NAME = /^(\d{14})_[a-z0-9_]+\.sql$/;
const LOOSE_NAME = /^(\d{12,14})_[a-z0-9_]+\.sql$/;
const APPROVAL = '-- migration:destructive-ok';

/** Pads a version to 14 digits so legacy 12 digit versions sort correctly. */
export function normalizeVersion(version) {
  return version.padEnd(14, '0');
}

/**
 * Reads the legacy list: one file name per line, optionally followed by the
 * state "applied" (already applied to production, baseline) or "pending"
 * (default, not applied anywhere). "# reason" and blank lines are ignored.
 */
export function readLegacyEntries(text) {
  return text
    .split(/\r?\n/)
    .map(l => l.replace(/#.*$/, '').trim())
    .filter(Boolean)
    .map(l => {
      const [file, state = 'pending'] = l.split(/\s+/);
      return { file, state };
    })
    .filter(e => LOOSE_NAME.test(e.file));
}

export function readLegacy(text) {
  return readLegacyEntries(text).map(e => e.file);
}

/** Removes comments and strings so a word in a comment causes no false alarm. */
function withoutComments(sql) {
  return sql
    .replace(/\/\*[\s\S]*?\*\//g, ' ')
    .replace(/--[^\n]*/g, ' ')
    .replace(/'(?:[^']|'')*'/g, "''");
}

/** Splits at commas outside of parentheses (the sub commands of an ALTER TABLE). */
function topLevelCommas(text) {
  const parts = [];
  let depth = 0;
  let current = '';
  for (const c of text) {
    if (c === '(') depth++;
    else if (c === ')') depth--;
    if (c === ',' && depth === 0) {
      parts.push(current);
      current = '';
    } else current += c;
  }
  parts.push(current);
  return parts;
}

const ALTER_TABLE_HEAD =
  /^\s*alter\s+table\s+(?:if\s+exists\s+)?(?:only\s+)?(?:"(?:[^"]|"")+"|[\w$]+)(?:\s*\.\s*(?:"(?:[^"]|"")+"|[\w$]+))?(?:\s*\*)?/i;

export function destructiveStatements(sql) {
  const s = withoutComments(sql);
  const hits = [];
  for (const m of s.matchAll(/\bdrop\s+(table|column|schema)\b/gi)) {
    hits.push(m[0].replace(/\s+/g, ' ').toUpperCase());
  }
  hits.push(...[...s.matchAll(/\btruncate\b/gi)].map(() => 'TRUNCATE'));
  hits.push(...[...s.matchAll(/\bdrop\s+owned\b/gi)].map(() => 'DROP OWNED'));
  for (const stmt of s.split(';')) {
    if (/\bdelete\s+from\b/i.test(stmt) && !/\bwhere\b/i.test(stmt)) {
      hits.push('DELETE without WHERE');
    }
    // "alter table t drop c" drops a column without the word COLUMN. Only
    // "drop constraint" is no column drop; "alter column c drop default" starts
    // with ALTER and is not matched.
    if (ALTER_TABLE_HEAD.test(stmt)) {
      const rest = stmt.replace(ALTER_TABLE_HEAD, '');
      for (const part of topLevelCommas(rest)) {
        if (
          /^\s*drop\b/i.test(part) &&
          !/^\s*drop\s+constraint\b/i.test(part)
        ) {
          hits.push('DROP COLUMN');
        }
      }
    }
  }
  return hits;
}

/**
 * @param {{
 *   files: string[],
 *   contents: Record<string,string>,
 *   legacy?: string[],
 *   base?: { files: string[], changed: string[] }
 * }} input
 *   base.changed: files that exist on the base branch and differ (changed, renamed, deleted).
 *   legacy: known legacy file names; they are exempt from rule 1, but only
 *   while they exist on the base branch (a NEW legacy named file is an error).
 * @returns {string[]} error messages (empty = fine)
 */
export function check({ files, contents, legacy = [], base }) {
  const errors = [];
  const versions = new Map();
  const legacySet = new Set(legacy);
  const baseFiles = base ? new Set(base.files) : null;
  const isKnownLegacy = f =>
    legacySet.has(f) && LOOSE_NAME.test(f) && (!baseFiles || baseFiles.has(f));

  for (const f of files) {
    const strict = STRICT_NAME.exec(f);
    const loose = LOOSE_NAME.exec(f);
    if (!strict && !isKnownLegacy(f)) {
      errors.push(
        `${f}: name must be <14 digits>_<name in lowercase>.sql` +
          (loose && legacySet.has(f)
            ? ' (a legacy name is only allowed for files that already exist on the base branch)'
            : '')
      );
      continue;
    }
    const version = normalizeVersion((strict ?? loose)[1]);
    if (versions.has(version)) {
      errors.push(
        `${f}: version ${version} is already taken (${versions.get(version)})`
      );
    }
    versions.set(version, f);
  }
  if (!base) return errors;

  const latestBase =
    base.files
      .map(f => (STRICT_NAME.exec(f) ?? LOOSE_NAME.exec(f))?.[1])
      .filter(Boolean)
      .map(normalizeVersion)
      .sort()
      .at(-1) ?? '0';
  const added = files.filter(f => !baseFiles.has(f));
  for (const f of added) {
    const sql = contents[f] ?? '';
    for (const e of rewrite(sql).errors) {
      errors.push(
        `${f}: cannot be rewritten for public_preview (${e}). Phrase it differently or exclude it on purpose with "-- preview:skip" ... "-- preview:end".`
      );
    }
    for (const e of newMigrationChecks(sql)) errors.push(`${f}: ${e}`);
    const m = STRICT_NAME.exec(f) ?? LOOSE_NAME.exec(f);
    const v = m ? normalizeVersion(m[1]) : null;
    if (v && v <= latestBase) {
      errors.push(
        `${f}: is not newer than the last migration on the base branch (${latestBase}); db push would skip it on a hosted database. Raise the version.`
      );
    }
    const destructive = destructiveStatements(sql);
    if (destructive.length > 0 && !sql.includes(APPROVAL)) {
      errors.push(
        `${f}: destructive statement (${[...new Set(destructive)].join(', ')}) without approval. Intended? Then write the line "${APPROVAL}" into the file.`
      );
    }
  }
  for (const f of base.changed) {
    errors.push(
      `${f}: existing migration was changed, renamed or deleted. An already applied migration is not executed again; changes belong in a new migration.`
    );
  }
  return errors;
}

function git(...args) {
  return execFileSync('git', args, { encoding: 'utf8' }).trim();
}

function main() {
  const i = process.argv.indexOf('--base');
  const baseRef = i > 0 ? process.argv[i + 1] : null;
  const files = readdirSync(FOLDER)
    .filter(f => f.endsWith('.sql'))
    .sort();
  const contents = Object.fromEntries(
    files.map(f => [f, readFileSync(join(FOLDER, f), 'utf8')])
  );
  const legacy = existsSync(LEGACY_FILE)
    ? readLegacy(readFileSync(LEGACY_FILE, 'utf8'))
    : [];
  let base;
  if (baseRef) {
    const onBase = git('ls-tree', '--name-only', baseRef, `${FOLDER}/`)
      .split('\n')
      .filter(p => p.endsWith('.sql'))
      .map(p => p.slice(FOLDER.length + 1));
    // Compare base against working state: M/D on files that exist in the base.
    const changed = git(
      'diff',
      '--name-status',
      '--no-renames',
      baseRef,
      '--',
      FOLDER
    )
      .split('\n')
      .filter(Boolean)
      .map(l => l.split('\t'))
      .filter(
        ([status, path]) =>
          (status === 'M' || status === 'D') && path.endsWith('.sql')
      )
      .map(([, path]) => path.slice(FOLDER.length + 1));
    base = { files: onBase, changed };
  }
  const errors = check({ files, contents, legacy, base });
  if (errors.length > 0) {
    console.error(`Migration check: ${errors.length} problem(s)`);
    for (const e of errors) console.error(` - ${e}`);
    process.exit(1);
  }
  console.log(
    `Migration check: ${files.length} files fine${baseRef ? ` (against ${baseRef})` : ''}.`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
