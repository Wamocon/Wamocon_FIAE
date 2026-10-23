// Applies migrations to the schema public_preview (rewritten with
// scripts/db/preview-rewrite.mjs). Runs in the Preview workflows (branch push,
// pull request, push to master) and in the manual reset workflow.
//
// Preview runs ahead of public: public is only migrated by a release. Because
// all open branches share one public_preview, the following applies:
//   - history with checksum in supabase_migrations.preview_schema_migrations
//   - if an already applied migration file is changed later, the run aborts
//     (public_preview would silently contain the old state)
//   - migrations that only another branch brought along are reported
//   - a database lock lets only one migration run at a time
//
// No production data is ever copied: setup and rebuild clone the STRUCTURE of
// public (schema-only dump), never rows. Preview content comes from seeds,
// imports or the content sync (scripts/db/content-sync.mjs).
//
// Usage (target: --linked | --local | --db-url <url>):
//   node scripts/db/preview-migrate.mjs check
//       rewrite all migrations without a database; error if one cannot be rewritten
//   node scripts/db/preview-migrate.mjs setup --linked [--probe]
//       public_preview does not exist yet: create it with the structure of
//       public (schema-only dump), seed the history with the ledger of public,
//       run supabase/preview-setup/03-preview-side.sql. --probe rolls back.
//   node scripts/db/preview-migrate.mjs apply --linked [--plan-only]
//       apply open migrations in order, each in its own transaction
//   node scripts/db/preview-migrate.mjs rebuild --linked [--execute]
//       drop public_preview and clone it again from public, then apply the
//       migrations of this checkout (use master) that public does not have yet.
//       Without --execute only the plan is shown. Deletes all Preview data.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, query, targetFrom } from './preview-cli.mjs';
import { readLegacy } from './migration-check.mjs';
import {
  PREVIEW_SCHEMA,
  PREVIEW_SUFFIX,
  bucketsFrom,
  rewrite,
  rewriteDump,
  triggerFunctionsFrom,
} from './preview-rewrite.mjs';

const FOLDER = 'supabase/migrations';
const LEGACY_FILE = 'supabase/legacy-migrations.txt';
const KNOWN_DRIFT_FILE = 'supabase/known-drift.txt';
const POST_CLONE_FILE = 'supabase/preview-setup/03-preview-side.sql';
const LEDGER = 'supabase_migrations.preview_schema_migrations';
const NAME = /^(\d{12,14})_([a-z0-9_]+)\.sql$/;
const PROBE_MARKER = 'preview-probe-ok';
const REBUILD_COMMAND =
  'node scripts/db/preview-migrate.mjs rebuild --linked (docs/release-prozess.md)';
// Role of the Preview app connection; created by supabase/preview-setup/01-schema-and-role.sql
export const PREVIEW_ROLE = 'app_preview';

const q = value => `'${String(value).replace(/'/g, "''")}'`;
const inCi = Boolean(process.env.GITHUB_ACTIONS);
const warn = text =>
  console.log(inCi ? `::warning::${text}` : `WARNING: ${text}`);

/** Checksum of the migration file, independent of CRLF/LF. */
export function checksum(content) {
  return createHash('sha256')
    .update(content.replace(/\r\n/g, '\n'))
    .digest('hex');
}

/**
 * @param {{ version: string, file: string, checksum: string }[]} files migrations in the checkout
 * @param {{ version: string, checksum: string | null }[]} applied history of public_preview
 */
export function plan(files, applied) {
  const known = new Map(applied.map(a => [a.version, a.checksum]));
  const inCheckout = new Set(files.map(f => f.version));
  const latestApplied =
    applied
      .map(a => a.version)
      .sort()
      .at(-1) ?? '0';
  const notApplied = files
    .filter(f => !known.has(f.version))
    .sort((a, b) => a.version.localeCompare(b.version));
  // A foreign row with the same checksum is the same migration under a new
  // version number (e.g. after "raise version" because of another merge):
  // only the history is rewritten.
  const foreignRows = applied.filter(a => !inCheckout.has(a.version));
  const renamed = [];
  const taken = new Set();
  for (const f of notApplied) {
    const old = foreignRows.find(
      r => r.checksum && r.checksum === f.checksum && !taken.has(r.version)
    );
    if (old) {
      renamed.push({ ...f, oldVersion: old.version });
      taken.add(old.version);
    }
  }
  const open = notApplied.filter(
    f => !renamed.some(r => r.version === f.version)
  );
  return {
    open,
    renamed,
    changed: files.filter(
      f =>
        known.has(f.version) &&
        known.get(f.version) &&
        known.get(f.version) !== f.checksum
    ),
    withoutChecksum: files.filter(
      f => known.has(f.version) && !known.get(f.version)
    ),
    foreign: foreignRows
      .map(a => a.version)
      .filter(v => !taken.has(v))
      .sort(),
    outOfOrder: open.filter(f => f.version < latestApplied),
  };
}

/**
 * @param {{ version: string }[]} files migrations in the checkout
 * @param {{ version: string, name?: string }[]} production ledger of public
 * @param {string[]} previewVersions ledger of public_preview (empty without one)
 * @param {string[]} [known] known drift versions: ledger rows without file are tolerated
 * @returns {{ baseline: object[], missingFiles: string[], discarded: string[] }}
 *   baseline: ledger rows that public_preview takes over as applied;
 *   missingFiles: applied in public but no file here (an error unless known);
 *   discarded: only in public_preview (open branches)
 */
export function rebuildPlan(files, production, previewVersions, known = []) {
  const local = new Map(files.map(f => [f.version, f]));
  const missingFiles = production
    .map(p => p.version)
    .filter(v => !local.has(v) && !known.includes(v));
  const prod = new Set(production.map(p => p.version));
  return {
    baseline: [...production].sort((a, b) =>
      a.version.localeCompare(b.version)
    ),
    missingFiles,
    discarded: previewVersions.filter(v => !prod.has(v)).sort(),
  };
}

function readList(path) {
  return existsSync(path) ? readFileSync(path, 'utf8') : '';
}

function loadMigrations() {
  const legacy = new Set(readLegacy(readList(LEGACY_FILE)));
  const names = readdirSync(FOLDER)
    .filter(f => NAME.test(f))
    .sort();
  const contents = Object.fromEntries(
    names.map(f => [f, readFileSync(join(FOLDER, f), 'utf8')])
  );
  const buckets = bucketsFrom(Object.values(contents));
  const triggerFunctions = triggerFunctionsFrom(Object.values(contents));
  return names.map(file => {
    const [, version, name] = NAME.exec(file);
    const isLegacy = legacy.has(file);
    return {
      file,
      version,
      name,
      isLegacy,
      raw: contents[file],
      checksum: checksum(contents[file]),
      // Legacy files are baseline (never applied to Preview), so no rewrite needed
      ...(isLegacy
        ? { sql: '', shared: [], errors: [] }
        : rewrite(contents[file], { buckets, triggerFunctions })),
    };
  });
}

function checkAll(list) {
  const broken = list.filter(m => m.errors.length > 0);
  for (const m of broken) {
    console.error(`${m.file}: cannot be rewritten for ${PREVIEW_SCHEMA}`);
    for (const e of m.errors) console.error(`  - ${e}`);
  }
  if (broken.length > 0) {
    throw new Error(
      'Either write the statement so that it only concerns public, or exclude ' +
        'the section for Preview on purpose:\n  -- preview:skip\n  ...\n  -- preview:end'
    );
  }
}

/**
 * Runs several statements as one transaction. "supabase db query" takes only
 * one statement, so the script runs via EXECUTE in a DO block; an error rolls
 * everything back.
 */
function runScript(target, text, { probe = false, onlyIfOpen = null } = {}) {
  if (/\$pv_(?:outer|script)\$/.test(text)) {
    throw new Error(
      'Migration contains the reserved marker $pv_outer$ or $pv_script$.'
    );
  }
  const end = probe ? `raise exception '${PROBE_MARKER}';` : '';
  // Lock against parallel runs (several branches share public_preview); whoever
  // waited skips a migration that the other run applied in the meantime.
  const guard = onlyIfOpen
    ? `if to_regclass('${LEDGER}') is not null and exists (select 1 from ${LEDGER} where version = ${q(onlyIfOpen)}) then return; end if;`
    : '';
  try {
    query(
      target,
      `do $pv_outer$ begin perform pg_advisory_xact_lock(hashtext('public_preview_migrations')); ${guard} execute $pv_script$\n${text}\n$pv_script$; ${end} end $pv_outer$;`,
      { emptyAllowed: true }
    );
  } catch (e) {
    if (probe && e.message.includes(PROBE_MARKER)) return;
    throw e;
  }
}

const LEDGER_TABLE = `create table ${LEDGER} (
  version text primary key,
  name text not null,
  checksum text,
  applied_at timestamptz not null default now()
);`;

// Empty schema with rights like public. The Preview role (if it exists)
// gets rights on public_preview only; see supabase/preview-setup.
export const EMPTY_SCHEMA_SQL = `
create schema if not exists ${PREVIEW_SCHEMA};
comment on schema ${PREVIEW_SCHEMA} is 'Structural copy of public for Preview deployments';
grant usage on schema ${PREVIEW_SCHEMA} to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema ${PREVIEW_SCHEMA} grant all on tables to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema ${PREVIEW_SCHEMA} grant all on sequences to postgres, anon, authenticated, service_role;
alter default privileges for role postgres in schema ${PREVIEW_SCHEMA} grant all on functions to postgres, anon, authenticated, service_role;
create schema if not exists supabase_migrations;`;

/**
 * Rights of the Preview role on public_preview. Objects created by the CLI
 * login role are not covered by default privileges of postgres, so the
 * grants are repeated after every setup and apply. A no-op while the role
 * does not exist yet.
 */
export function ensureGrantsSql(role = PREVIEW_ROLE, schema = PREVIEW_SCHEMA) {
  return `do $pv_grants$ begin
  if exists (select 1 from pg_roles where rolname = ${q(role)}) then
    execute 'grant usage on schema ${schema} to ${role}';
    execute 'grant all on all tables in schema ${schema} to ${role}';
    execute 'grant all on all sequences in schema ${schema} to ${role}';
    execute 'grant all on all functions in schema ${schema} to ${role}';
  end if;
end $pv_grants$;`;
}

/**
 * Builds the setup script (pure): empty schema, history ledger seeded with the
 * ledger of public, structure of public (rewritten dump), shared objects of
 * the applied migrations, grants and the post clone file.
 */
export function buildSetupScript({
  baseline,
  localByVersion,
  dumpSql,
  shared,
  postClone = '',
}) {
  const rows = baseline.map(b => {
    const local = localByVersion.get(b.version);
    return `(${q(b.version)}, ${q(local?.name ?? b.name ?? '')}, ${local ? q(local.checksum) : 'null'})`;
  });
  return [
    EMPTY_SCHEMA_SQL,
    LEDGER_TABLE,
    rows.length > 0
      ? `insert into ${LEDGER} (version, name, checksum) values ${rows.join(', ')};`
      : '',
    `set local search_path = ${PREVIEW_SCHEMA}, extensions;`,
    dumpSql,
    ...shared.map(s => (s.trim().endsWith(';') ? s : `${s};`)),
    ensureGrantsSql(),
    postClone,
  ].join('\n');
}

function state(target) {
  const [z] = query(
    target,
    `select to_regnamespace('${PREVIEW_SCHEMA}') is not null as schema_exists,
    coalesce((select count(*) from pg_class c where c.relnamespace = to_regnamespace('${PREVIEW_SCHEMA}') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')), 0)::int as object_count,
    to_regclass('${LEDGER}') is not null as ledger_exists,
    to_regclass('supabase_migrations.schema_migrations') is not null as production_ledger_exists`
  );
  if (!z) throw new Error('No answer from the database to the state query.');
  return z;
}

function dumpPublicStructure(target) {
  const dir = mkdtempSync(join(tmpdir(), 'preview-dump-'));
  try {
    const file = join(dir, 'public.sql');
    // schema-only is the default of "db dump": no rows are exported
    cli(['db', 'dump', ...target, '-s', 'public', '-f', file]);
    return readFileSync(file, 'utf8');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function cloneScript(target, list) {
  const production = query(
    target,
    'select version, name from supabase_migrations.schema_migrations order by version'
  );
  const known = readLegacyDrift();
  const rp = rebuildPlan(list, production, [], known);
  if (rp.missingFiles.length > 0) {
    throw new Error(
      `Applied in public, but no file here: ${rp.missingFiles.join(', ')}. ` +
        `Update the branch or list the version in ${KNOWN_DRIFT_FILE} with a reason.`
    );
  }
  const dump = dumpPublicStructure(target);
  const buckets = bucketsFrom(list.map(m => m.raw));
  const result = rewriteDump(dump, { buckets });
  if (result.errors.length > 0) {
    throw new Error(
      `The structure dump of public cannot be rewritten:\n${result.errors.map(e => `  - ${e}`).join('\n')}`
    );
  }
  const local = new Map(list.map(m => [m.version, m]));
  const appliedLocal = rp.baseline
    .map(b => local.get(b.version))
    .filter(m => m && !m.isLegacy);
  const shared = appliedLocal.flatMap(m => m.shared);
  const postClone = readList(POST_CLONE_FILE);
  console.log(
    `Structure: ${result.sql.length} characters of rewritten SQL, ledger ${rp.baseline.length} version(s), ${shared.length} shared statement(s), post clone file ${postClone ? 'present' : 'missing'}.`
  );
  return {
    rp,
    text: buildSetupScript({
      baseline: rp.baseline,
      localByVersion: local,
      dumpSql: result.sql,
      shared,
      postClone,
    }),
  };
}

function readLegacyDrift() {
  return readList(KNOWN_DRIFT_FILE)
    .split(/\r?\n/)
    .map(l => l.replace(/#.*$/, '').trim())
    .filter(l => /^\d{12,14}$/.test(l));
}

function setup(target, list, { probe }) {
  const s = state(target);
  if (s.schema_exists && s.ledger_exists) {
    console.log(`${PREVIEW_SCHEMA} is already set up.`);
    return;
  }
  // An empty schema (created by supabase/preview-setup/01-preview-role.sql) is fine
  if (s.schema_exists && s.object_count > 0) {
    throw new Error(
      `${PREVIEW_SCHEMA} exists with objects but without a history. Rebuild it: ${REBUILD_COMMAND}`
    );
  }
  if (!s.production_ledger_exists) {
    throw new Error(
      'supabase_migrations.schema_migrations is missing, the state of public is unknown.'
    );
  }
  const { text } = cloneScript(target, list);
  runScript(target, text, { probe });
  console.log(
    probe
      ? 'PROBE: everything rolled back.'
      : `${PREVIEW_SCHEMA} set up (structure only, no rows).`
  );
}

function apply(target, list, { planOnly }) {
  const s = state(target);
  if (!s.schema_exists || !s.ledger_exists) {
    throw new Error(
      `${PREVIEW_SCHEMA} is not set up (command: setup, or the preview-reset workflow).`
    );
  }
  // to_jsonb: also reads the checksum from a history that does not have the column yet
  const applied = query(
    target,
    `select version, to_jsonb(v) ->> 'checksum' as checksum from ${LEDGER} v`
  );
  const candidates = list.filter(m => !m.isLegacy);
  const p = plan(candidates, applied);

  if (p.changed.length > 0) {
    throw new Error(
      `These migrations were changed after they were applied to ${PREVIEW_SCHEMA}:\n` +
        p.changed.map(m => `  - ${m.file}`).join('\n') +
        `\n${PREVIEW_SCHEMA} contains the old state. Write the change as a new migration ` +
        `(new version number) or rebuild ${PREVIEW_SCHEMA} from public: ${REBUILD_COMMAND}`
    );
  }
  if (p.foreign.length > 0) {
    warn(
      `${PREVIEW_SCHEMA} contains migrations that are missing in this state (other branches or deleted files): ${p.foreign.join(', ')}. ` +
        `If they come from closed branches they stay, with their twins, until someone rebuilds ${PREVIEW_SCHEMA}: ${REBUILD_COMMAND}`
    );
  }
  for (const m of p.outOfOrder) {
    warn(
      `${m.file} is older than the newest migration in ${PREVIEW_SCHEMA} and runs there out of order.`
    );
  }
  if (p.open.length === 0) {
    console.log(`${PREVIEW_SCHEMA}: nothing open (${applied.length} applied).`);
  } else {
    console.log(
      `${PREVIEW_SCHEMA}: ${p.open.length} open migration(s) ${planOnly ? 'would be applied' : 'are applied'}.`
    );
  }
  for (const m of p.renamed) {
    console.log(
      `  renamed: ${m.oldVersion} -> ${m.file} (same content, not executed again)`
    );
  }
  if (planOnly) {
    for (const m of p.open) console.log(`  ${m.file}`);
    return;
  }
  if (p.renamed.length > 0) {
    runScript(
      target,
      p.renamed
        .map(
          m =>
            `update ${LEDGER} set version = ${q(m.version)}, name = ${q(m.name)} where version = ${q(m.oldVersion)};`
        )
        .join('\n')
    );
  }
  if (p.withoutChecksum.length > 0) {
    runScript(
      target,
      [
        `alter table ${LEDGER} add column if not exists checksum text;`,
        ...p.withoutChecksum.map(
          m =>
            `update ${LEDGER} set checksum = ${q(m.checksum)} where version = ${q(m.version)} and checksum is null;`
        ),
      ].join('\n')
    );
    console.log(
      `Checksum added for ${p.withoutChecksum.length} already applied migrations.`
    );
  }
  for (const m of p.open) {
    const text = [
      `set local search_path = ${PREVIEW_SCHEMA}, extensions;`,
      // loads pgvector so functions may "set hnsw.* = ..."
      "do $pv$ begin if to_regtype('extensions.vector') is not null then perform '[1]'::extensions.vector; end if; end $pv$;",
      m.sql,
      ';',
      `insert into ${LEDGER} (version, name, checksum) values (${q(m.version)}, ${q(m.name)}, ${q(m.checksum)});`,
    ].join('\n');
    try {
      runScript(target, text, { onlyIfOpen: m.version });
    } catch (e) {
      throw new Error(
        `${m.file} failed in ${PREVIEW_SCHEMA} (rolled back):\n${e.message}`
      );
    }
    console.log(`  applied: ${m.file}`);
  }
  if (p.open.length > 0) runScript(target, ensureGrantsSql());
}

/**
 * Removes public_preview, its history and the Preview twins on shared objects
 * (triggers and policies with suffix _preview on auth and storage, cron jobs
 * with suffix -preview). If an object outside public_preview still depends on
 * public_preview, everything aborts instead of silently dropping it by cascade.
 * Shared buckets and their files stay untouched.
 */
export function abortSql() {
  const s = PREVIEW_SCHEMA;
  return `do $pv_abort$
declare
  z record;
  foreign_objects text;
begin
  for z in
    select t.tgname, t.tgrelid::regclass::text as relation
    from pg_trigger t join pg_class c on c.oid = t.tgrelid join pg_namespace n on n.oid = c.relnamespace
    where n.nspname in ('auth', 'storage') and not t.tgisinternal and t.tgname like '%\\_preview'
  loop
    execute format('drop trigger %I on %s', z.tgname, z.relation);
  end loop;
  for z in
    select policyname, schemaname, tablename from pg_policies
    where schemaname in ('auth', 'storage') and policyname like '%\\_preview'
  loop
    execute format('drop policy %I on %I.%I', z.policyname, z.schemaname, z.tablename);
  end loop;
  if to_regclass('cron.job') is not null then
    perform cron.unschedule(jobname) from cron.job where jobname like ${q(`%${PREVIEW_SUFFIX}`)};
  end if;
  if to_regnamespace(${q(s)}) is not null then
    select string_agg(distinct o.type || ' ' || o.identity, ', ') into foreign_objects
    from pg_depend d
    cross join lateral pg_identify_object(d.classid, d.objid, d.objsubid) o
    cross join lateral pg_identify_object(d.refclassid, d.refobjid, 0) r
    where d.deptype = 'n' and r.schema = ${q(s)}
      and coalesce(o.schema, substring(o.identity from '(?:^| )(?:on|for) "?([^".]+)')) is distinct from ${q(s)};
    if foreign_objects is not null then
      raise exception 'Rebuild aborted: these objects outside ${s} depend on it: %', foreign_objects;
    end if;
    execute 'drop schema ${s} cascade';
  end if;
  execute 'drop table if exists ${LEDGER}';
end $pv_abort$;`;
}

function rebuild(target, list, { execute }) {
  const s = state(target);
  if (!s.production_ledger_exists) {
    throw new Error(
      'supabase_migrations.schema_migrations is missing, the state of public is unknown.'
    );
  }
  const production = query(
    target,
    'select version, name from supabase_migrations.schema_migrations order by version'
  );
  const preview = s.ledger_exists
    ? query(target, `select version from ${LEDGER} order by version`).map(
        r => r.version
      )
    : [];
  const rp = rebuildPlan(list, production, preview, readLegacyDrift());
  if (rp.missingFiles.length > 0) {
    throw new Error(
      `Applied in public, but no file here: ${rp.missingFiles.join(', ')}. Check out master first.`
    );
  }
  const local = new Map(list.map(m => [m.version, m]));
  const pending = list.filter(
    m => !m.isLegacy && !rp.baseline.some(b => b.version === m.version)
  );
  console.log(
    `Rebuild ${PREVIEW_SCHEMA}: structure of public (schema-only dump, no rows), ledger of public (${rp.baseline.length} version(s)).`
  );
  console.log(
    `  then applied from this checkout (not yet in public): ${pending.map(m => m.file).join(', ') || 'nothing'}`
  );
  if (rp.discarded.length > 0) {
    console.log(
      `  discarded (only in ${PREVIEW_SCHEMA}): ${rp.discarded.join(', ')}`
    );
    console.log(
      '  Open branches bring their migrations along on the next push.'
    );
  }
  console.log(
    '  removed: schema, history, triggers and policies ending in _preview on auth/storage, cron jobs ending in -preview'
  );
  console.log(
    '  stay: public, all Production objects, shared buckets with their files, all Production data'
  );
  if (!execute) {
    console.log(
      `Plan only. Run with --execute; this deletes all data in ${PREVIEW_SCHEMA}.`
    );
    return;
  }
  const { text } = cloneScript(target, list);
  runScript(target, `${abortSql()}\n${text}`);
  console.log(`${PREVIEW_SCHEMA} dropped and cloned again (structure only).`);
  apply(target, list, { planOnly: false });
  runScript(target, "notify pgrst, 'reload schema';");
  console.log(
    `${PREVIEW_SCHEMA} rebuilt. Content: run the content sync or the seed (no rows were copied). Local: ${local.size} migration files.`
  );
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!['check', 'setup', 'apply', 'rebuild'].includes(command)) {
    console.error(
      'Usage: node scripts/db/preview-migrate.mjs check|setup|apply|rebuild [--linked|--local|--db-url <url>]'
    );
    process.exit(2);
  }
  try {
    const list = loadMigrations();
    checkAll(list);
    if (command === 'check') {
      console.log(`Preview rewrite: ${list.length} migrations fine.`);
      return;
    }
    const target = targetFrom(args);
    if (!target)
      throw new Error('Target missing: --linked, --local or --db-url <url>');
    if (command === 'setup')
      setup(target, list, { probe: args.includes('--probe') });
    else if (command === 'rebuild')
      rebuild(target, list, { execute: args.includes('--execute') });
    else apply(target, list, { planOnly: args.includes('--plan-only') });
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
