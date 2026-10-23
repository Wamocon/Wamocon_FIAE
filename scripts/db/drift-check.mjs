// Drift check: do the migration files on master, the history of public and the
// history of public_preview agree? Read only, nothing is changed.
//
// Why: the migration workflows only start when a file under supabase/migrations/
// lands in the repository. A migration that was applied without a file
// (dashboard, SQL editor, MCP "apply_migration") is never seen by them. Equally,
// a file on master that is missing in one of the schemas stays unnoticed, for
// example because a run failed. This check runs daily (db-drift.yml) and
// reports every deviation.
//
// Findings (all errors, except where "note" is written):
//   1. version applied in public, but no file on master        (migration without file)
//   2. file on master, but not applied in public               (skipped or run failed;
//      a file that is merged but not yet released shows up here until the next release)
//   3. file on master, but not applied in public_preview       (catch-up did not run)
//   4. file changed after it was applied to public_preview     (checksum differs)
//   Note: versions in public_preview without a file on master are open branches.
//
// Finding 2 is expected between a merge and the next release. It is therefore
// reported as a note and not as an error unless --strict is given.
//
// Known legacy cases are listed with a reason in supabase/known-drift.txt (one
// version per line, then "# reason") and are not reported.
//
// Usage: node scripts/db/drift-check.mjs --linked | --local | --db-url <url> [--strict]

import { readdirSync, readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { query, targetFrom } from './preview-cli.mjs';
import { checksum } from './preview-migrate.mjs';

const FOLDER = 'supabase/migrations';
const KNOWN_FILE = 'supabase/known-drift.txt';
const NAME = /^(\d{12,14})_[a-z0-9_]+\.sql$/;
const inCi = Boolean(process.env.GITHUB_ACTIONS);

/** Reads the known legacy cases: "<12 to 14 digits>  # reason", blank and comment lines are ignored. */
export function readKnown(text) {
  return text
    .split(/\r?\n/)
    .map(l => l.replace(/#.*$/, '').trim())
    .filter(l => /^\d{12,14}$/.test(l));
}

/**
 * @param {{
 *   files: { version: string, file: string, checksum: string }[],
 *   public: string[],
 *   preview: { version: string, checksum: string | null }[] | null,
 *   known?: string[],
 *   strict?: boolean,
 * }} state preview = null if public_preview has no history
 * @returns {{ errors: string[], notes: string[] }}
 */
export function driftFindings({
  files,
  public: applied,
  preview,
  known = [],
  strict = false,
}) {
  const errors = [];
  const notes = [];
  const exempt = new Set(known);
  const fileVersions = new Set(files.map(f => f.version));
  const inPublic = new Set(applied);

  for (const v of [...inPublic].sort()) {
    if (!fileVersions.has(v) && !exempt.has(v)) {
      errors.push(
        `Migration ${v} is applied in public, but there is no file for it on master. It was executed without a migration file ` +
          `(dashboard, SQL editor or MCP). Submit the file: supabase/migrations/${v}_<name>.sql with the executed SQL.`
      );
    }
  }
  for (const f of files) {
    if (exempt.has(f.version) || inPublic.has(f.version)) continue;
    const text = `${f.file} is on master, but not applied in public (merged and not released yet, skipped, or the release run failed).`;
    if (strict) errors.push(text);
    else notes.push(text);
  }

  if (preview === null) {
    errors.push(
      'public_preview has no migration history (supabase_migrations.preview_schema_migrations is missing). Run the preview-reset workflow.'
    );
  } else {
    const inPreview = new Map(preview.map(p => [p.version, p.checksum]));
    for (const f of files) {
      if (exempt.has(f.version)) continue;
      if (!inPreview.has(f.version)) {
        errors.push(
          `${f.file} is on master, but not applied in public_preview (catch-up did not run).`
        );
      } else if (
        inPreview.get(f.version) &&
        inPreview.get(f.version) !== f.checksum
      ) {
        errors.push(
          `${f.file} was changed after it was applied to public_preview (checksum differs). The change belongs in a new migration.`
        );
      }
    }
    const open = [...inPreview.keys()]
      .filter(v => !fileVersions.has(v) && !exempt.has(v))
      .sort();
    if (open.length > 0) {
      notes.push(
        `public_preview contains ${open.length} migration(s) without a file on master (open branches): ${open.join(', ')}`
      );
    }
  }
  return { errors, notes };
}

function readFiles() {
  return readdirSync(FOLDER)
    .filter(f => f.endsWith('.sql'))
    .sort()
    .map(file => {
      const m = NAME.exec(file);
      if (!m) throw new Error(`Invalid file name: ${file}`);
      return {
        version: m[1],
        file,
        checksum: checksum(readFileSync(join(FOLDER, file), 'utf8')),
      };
    });
}

function main() {
  const args = process.argv.slice(2);
  const target = targetFrom(args);
  if (!target) {
    console.error(
      'Usage: node scripts/db/drift-check.mjs --linked|--local|--db-url <url> [--strict]'
    );
    process.exit(2);
  }
  try {
    const files = readFiles();
    const known = existsSync(KNOWN_FILE)
      ? readKnown(readFileSync(KNOWN_FILE, 'utf8'))
      : [];
    const applied = query(
      target,
      'select version from supabase_migrations.schema_migrations order by version'
    ).map(r => r.version);
    const exists = query(
      target,
      "select to_regclass('supabase_migrations.preview_schema_migrations') is not null as present"
    )[0]?.present;
    const preview = exists
      ? query(
          target,
          "select version, to_jsonb(v) ->> 'checksum' as checksum from supabase_migrations.preview_schema_migrations v"
        )
      : null;

    const { errors, notes } = driftFindings({
      files,
      public: applied,
      preview,
      known,
      strict: args.includes('--strict'),
    });
    for (const n of notes) console.log(`Note: ${n}`);
    if (errors.length === 0) {
      console.log(
        `Drift check: ${files.length} migration files, public (${applied.length}) and public_preview agree.`
      );
      return;
    }
    console.error(`Drift check: ${errors.length} deviation(s)`);
    for (const e of errors) console.error(inCi ? `::error::${e}` : `  - ${e}`);
    process.exitCode = 1;
  } catch (e) {
    console.error(
      inCi
        ? `::error::${e.message.split('\n')[0]}\n${e.message}`
        : `ERROR: ${e.message}`
    );
    process.exitCode = 1;
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
