// Applies migrations to the schema public_preview (rewritten with
// scripts/db/preview-rewrite.mjs). Runs in the Preview workflows (branch push,
// pull request, push to master) and in the manual reset workflow.
//
// SECURITY MODEL. The Preview jobs never see a Production token. They connect
// with the database role app_preview_migrator (connection string in the secret
// PREVIEW_DB_URL of the environment Preview, passed with --db-url-env). That role
// owns public_preview and the schema preview_meta and has no rights on public,
// auth, storage or any other schema, and no BYPASSRLS
// (supabase/preview-setup/01-preview-role.sql). Unreviewed branch SQL therefore
// can only damage public_preview. The rewrite rules are an early warning, not
// the boundary.
//
// The structure of public is read in a SEPARATE Production job (command
// snapshot, needs the Supabase access token) and handed over as a file. The
// Preview job never reads public.
//
// Preview runs ahead of public: public is only migrated by a release. Because
// all open branches share one public_preview, the following applies:
//   - history with checksum in preview_meta.schema_migrations
//   - if an already applied migration file is changed later, the run aborts
//     (public_preview would silently contain the old state)
//   - migrations that only another branch brought along are reported
//   - a database lock lets only one migration run at a time
//
// No production data is ever copied: rebuild clones the STRUCTURE of public
// (schema-only dump), never rows. Preview content comes from seeds, imports or
// the content sync (scripts/db/content-sync.mjs).
//
// Usage (target: --db-url-env <NAME> | --db-url <url> | --linked | --local):
//   node scripts/db/preview-migrate.mjs check
//       rewrite all migrations without a database; error if one cannot be rewritten
//   node scripts/db/preview-migrate.mjs snapshot --linked --out <dir>
//       PRODUCTION job, read only: schema-only dump of public and its migration
//       ledger into <dir> (public-structure.sql, public-ledger.json)
//   node scripts/db/preview-migrate.mjs apply --db-url-env PREVIEW_DB_URL [--plan-only]
//       apply open migrations in order, each in its own transaction
//   node scripts/db/preview-migrate.mjs rebuild --db-url-env PREVIEW_DB_URL --snapshot <dir> [--execute]
//       empty public_preview, clone the structure from the snapshot, seed the
//       ledger with the ledger of public, then apply the migrations of this
//       checkout (use master) that public does not have yet. Also the first-time
//       setup. Without --execute only the plan is shown. Deletes all Preview data.

import { createHash } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { cli, query, targetFrom } from './preview-cli.mjs';
import { readLegacyEntries } from './migration-check.mjs';
import {
  DEFAULT_EXTENSION_OBJECTS,
  PREVIEW_SCHEMA,
  rewrite,
  rewriteDump,
} from './preview-rewrite.mjs';

const FOLDER = 'supabase/migrations';
const LEGACY_FILE = 'supabase/legacy-migrations.txt';
const KNOWN_DRIFT_FILE = 'supabase/known-drift.txt';
const POST_CLONE_FILE = 'supabase/preview-setup/02-preview-side.sql';
// Schema preview_meta is created and owned by the Preview migration role (01-preview-role.sql)
export const LEDGER = 'preview_meta.schema_migrations';
const NAME = /^(\d{12,14})_([a-z0-9_]+)\.sql$/;
const REBUILD_COMMAND = 'workflow "Preview Reset" (docs/release-prozess.md)';
const SNAPSHOT_STRUCTURE = 'public-structure.sql';
const SNAPSHOT_LEDGER = 'public-ledger.json';
const SNAPSHOT_EXTENSIONS = 'public-extension-objects.json';
// Roles created by supabase/preview-setup/01-preview-role.sql
export const PREVIEW_ROLE = 'app_preview';
export const PREVIEW_MIGRATOR_ROLE = 'app_preview_migrator';

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
  const baselineFiles = new Set(
    readLegacyEntries(readList(LEGACY_FILE))
      .filter(e => e.state === 'applied')
      .map(e => e.file)
  );
  const names = readdirSync(FOLDER)
    .filter(f => NAME.test(f))
    .sort();
  const contents = Object.fromEntries(
    names.map(f => [f, readFileSync(join(FOLDER, f), 'utf8')])
  );
  return names.map(file => {
    const [, version, name] = NAME.exec(file);
    // A baseline file is already part of public and therefore of the structure
    // clone. A pending legacy file is applied to Preview like any other.
    const isLegacy = baselineFiles.has(file);
    return {
      file,
      version,
      name,
      isLegacy,
      raw: contents[file],
      checksum: checksum(contents[file]),
      // Baseline files are never applied to Preview, so no rewrite is needed
      ...(isLegacy ? { sql: '', errors: [] } : rewrite(contents[file])),
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
function runScript(target, text, { onlyIfOpen = null } = {}) {
  if (/\$pv_(?:outer|script)\$/.test(text)) {
    throw new Error(
      'Migration contains the reserved marker $pv_outer$ or $pv_script$.'
    );
  }
  // Lock against parallel runs (several branches share public_preview); whoever
  // waited skips a migration that the other run applied in the meantime.
  const guard = onlyIfOpen
    ? `if to_regclass('${LEDGER}') is not null and exists (select 1 from ${LEDGER} where version = ${q(onlyIfOpen)}) then return; end if;`
    : '';
  query(
    target,
    `do $pv_outer$ begin perform pg_advisory_xact_lock(hashtext('public_preview_migrations')); ${guard} execute $pv_script$\n${text}\n$pv_script$; end $pv_outer$;`,
    { emptyAllowed: true }
  );
}

const LEDGER_TABLE = `create table ${LEDGER} (
  version text primary key,
  name text not null,
  checksum text,
  applied_at timestamptz not null default now()
);`;

/**
 * Rights of the Preview app role on public_preview. Default privileges cover
 * new objects of the migration role (01-preview-role.sql); the grants are
 * repeated after every rebuild and apply as a safety net. A no-op while the
 * role does not exist yet.
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
 * Removes everything inside public_preview and its history ledger. The schema
 * itself, its owner, its grants and its default privileges are kept (they were
 * set by a human with 01-preview-role.sql, the migration role cannot recreate
 * them). If an object outside public_preview still depends on public_preview,
 * everything aborts instead of silently dropping it by cascade. Touches nothing
 * outside of public_preview and preview_meta.
 */
export function purgeSql() {
  const s = PREVIEW_SCHEMA;
  return `do $pv_purge$
declare
  z record;
  foreign_objects text;
begin
  select string_agg(distinct o.type || ' ' || o.identity, ', ') into foreign_objects
  from pg_depend d
  cross join lateral pg_identify_object(d.classid, d.objid, d.objsubid) o
  cross join lateral pg_identify_object(d.refclassid, d.refobjid, 0) r
  where d.deptype = 'n' and r.schema = ${q(s)}
    and coalesce(o.schema, substring(o.identity from '(?:^| )(?:on|for) "?([^".]+)')) is distinct from ${q(s)};
  if foreign_objects is not null then
    raise exception 'Rebuild aborted: these objects outside ${s} depend on it: %', foreign_objects;
  end if;
  for z in
    select c.relname, c.relkind from pg_class c
    where c.relnamespace = ${q(s)}::regnamespace and c.relkind in ('r', 'p', 'v', 'm', 'f') and not c.relispartition
  loop
    execute format('drop %s %I.%I cascade',
      case z.relkind when 'v' then 'view' when 'm' then 'materialized view' when 'f' then 'foreign table' else 'table' end,
      ${q(s)}, z.relname);
  end loop;
  for z in
    select c.relname from pg_class c
    where c.relnamespace = ${q(s)}::regnamespace and c.relkind = 'S'
  loop
    execute format('drop sequence if exists %I.%I cascade', ${q(s)}, z.relname);
  end loop;
  for z in
    select p.oid::regprocedure::text as signature, p.prokind from pg_proc p
    where p.pronamespace = ${q(s)}::regnamespace
  loop
    execute format('drop %s if exists %s cascade',
      case z.prokind when 'p' then 'procedure' when 'a' then 'aggregate' else 'function' end, z.signature);
  end loop;
  for z in
    select t.typname, t.typtype from pg_type t
    where t.typnamespace = ${q(s)}::regnamespace and t.typtype in ('e', 'd', 'r', 'm', 'c')
      and t.typcategory <> 'A' and not exists (select 1 from pg_class c where c.reltype = t.oid)
  loop
    execute format('drop %s if exists %I.%I cascade', case z.typtype when 'd' then 'domain' else 'type' end, ${q(s)}, z.typname);
  end loop;
  execute 'drop table if exists ${LEDGER}';
end $pv_purge$;`;
}

/**
 * Builds the rebuild script (pure): empty public_preview, history ledger seeded
 * with the ledger of public, structure of public (rewritten dump), grants and
 * the post clone file.
 */
export function buildSetupScript({
  baseline,
  localByVersion,
  dumpSql,
  postClone = '',
  searchPath = previewSearchPath(false),
}) {
  const rows = baseline.map(b => {
    const local = localByVersion.get(b.version);
    return `(${q(b.version)}, ${q(local?.name ?? b.name ?? '')}, ${local ? q(local.checksum) : 'null'})`;
  });
  return [
    purgeSql(),
    LEDGER_TABLE,
    rows.length > 0
      ? `insert into ${LEDGER} (version, name, checksum) values ${rows.join(', ')};`
      : '',
    `set local search_path = ${searchPath};`,
    // pg_dump writes functions before the tables they read; the dump skips its own SET lines
    'set local check_function_bodies = off;',
    dumpSql,
    ensureGrantsSql(),
    postClone,
  ].join('\n');
}

/**
 * search_path of the Preview scripts. pgvector lives in the schema public in the
 * real project (the type public.vector), so public has to be on the path to find
 * it; the Preview roles have no rights on any table of public, so this opens no
 * data. Without an extension in public the path stays public_preview, extensions.
 */
export function previewSearchPath(extensionInPublic) {
  return `${PREVIEW_SCHEMA}, extensions${extensionInPublic ? ', public' : ''}`;
}

function extensionInPublic(target) {
  const [z] = query(
    target,
    "select exists (select 1 from pg_extension e where e.extnamespace = 'public'::regnamespace) as in_public"
  );
  return Boolean(z?.in_public);
}

function state(target) {
  const [z] = query(
    target,
    `select to_regnamespace('${PREVIEW_SCHEMA}') is not null as schema_exists,
    coalesce((select count(*) from pg_class c where c.relnamespace = to_regnamespace('${PREVIEW_SCHEMA}') and c.relkind in ('r', 'p', 'v', 'm', 'S', 'f')), 0)::int as object_count,
    to_regnamespace('preview_meta') is not null as meta_exists,
    case when to_regnamespace('preview_meta') is not null then to_regclass('${LEDGER}') is not null else false end as ledger_exists`
  );
  if (!z) throw new Error('No answer from the database to the state query.');
  return z;
}

/**
 * PRODUCTION job, read only: structure of public (schema-only dump, no rows) and
 * its migration ledger, written into a directory for the Preview job.
 */
// Names of the types, functions, relations and operator classes in public that belong to an extension
const EXTENSION_OBJECTS_SQL = `select distinct name from (
  select t.typname::text as name from pg_depend d join pg_type t on t.oid = d.objid
    where d.deptype = 'e' and d.classid = 'pg_type'::regclass and t.typnamespace = 'public'::regnamespace
  union all
  select p.proname::text from pg_depend d join pg_proc p on p.oid = d.objid
    where d.deptype = 'e' and d.classid = 'pg_proc'::regclass and p.pronamespace = 'public'::regnamespace
  union all
  select c.relname::text from pg_depend d join pg_class c on c.oid = d.objid
    where d.deptype = 'e' and d.classid = 'pg_class'::regclass and c.relnamespace = 'public'::regnamespace
  union all
  select o.opcname::text from pg_depend d join pg_opclass o on o.oid = d.objid
    where d.deptype = 'e' and d.classid = 'pg_opclass'::regclass and o.opcnamespace = 'public'::regnamespace
) x order by 1`;

function snapshot(target, out) {
  mkdirSync(out, { recursive: true });
  const ledger = query(
    target,
    'select version, name from supabase_migrations.schema_migrations order by version'
  );
  // schema-only is the default of "db dump": no rows are exported
  cli([
    'db',
    'dump',
    ...target,
    '-s',
    'public',
    '-f',
    join(out, SNAPSHOT_STRUCTURE),
  ]);
  writeFileSync(join(out, SNAPSHOT_LEDGER), JSON.stringify(ledger, null, 2));
  // Objects of extensions that live in public (pgvector: the type vector) cannot be
  // cloned and keep pointing at public in the clone. Only names, no data.
  const extensionObjects = query(target, EXTENSION_OBJECTS_SQL).map(
    r => r.name
  );
  writeFileSync(
    join(out, SNAPSHOT_EXTENSIONS),
    JSON.stringify(extensionObjects, null, 2)
  );
  console.log(
    `Snapshot of public: ${ledger.length} ledger version(s), ${extensionObjects.length} extension object name(s), structure written (no rows).`
  );
}

function readSnapshot(dir) {
  const structure = join(dir, SNAPSHOT_STRUCTURE);
  const ledger = join(dir, SNAPSHOT_LEDGER);
  if (!existsSync(structure) || !existsSync(ledger)) {
    throw new Error(
      `Snapshot incomplete in ${dir}: ${SNAPSHOT_STRUCTURE} and ${SNAPSHOT_LEDGER} are required (command snapshot, Production job).`
    );
  }
  const extensions = join(dir, SNAPSHOT_EXTENSIONS);
  // An older snapshot has no list: the pgvector types are the known case
  const extensionObjects = [
    ...new Set([
      ...DEFAULT_EXTENSION_OBJECTS,
      ...(existsSync(extensions)
        ? JSON.parse(readFileSync(extensions, 'utf8'))
        : []),
    ]),
  ];
  return {
    dump: readFileSync(structure, 'utf8'),
    production: JSON.parse(readFileSync(ledger, 'utf8')),
    extensionObjects,
  };
}

function cloneScript(snap, list, searchPath) {
  const known = readLegacyDrift();
  const rp = rebuildPlan(list, snap.production, [], known);
  if (rp.missingFiles.length > 0) {
    throw new Error(
      `Applied in public, but no file here: ${rp.missingFiles.join(', ')}. ` +
        `Update the branch or list the version in ${KNOWN_DRIFT_FILE} with a reason.`
    );
  }
  const result = rewriteDump(snap.dump, {
    extensionObjects: snap.extensionObjects,
  });
  for (const note of result.notes) console.log(`Note: ${note}`);
  if (result.errors.length > 0) {
    throw new Error(
      `The structure dump of public cannot be rewritten:\n${result.errors.map(e => `  - ${e}`).join('\n')}`
    );
  }
  const local = new Map(list.map(m => [m.version, m]));
  const postClone = readList(POST_CLONE_FILE);
  console.log(
    `Structure: ${result.sql.length} characters of rewritten SQL, ledger ${rp.baseline.length} version(s), post clone file ${postClone ? 'present' : 'missing'}.`
  );
  return {
    rp,
    text: buildSetupScript({
      baseline: rp.baseline,
      localByVersion: local,
      dumpSql: result.sql,
      postClone,
      searchPath,
    }),
  };
}

function readLegacyDrift() {
  return readList(KNOWN_DRIFT_FILE)
    .split(/\r?\n/)
    .map(l => l.replace(/#.*$/, '').trim())
    .filter(l => /^\d{12,14}$/.test(l));
}

function apply(target, list, { planOnly }) {
  const s = state(target);
  if (!s.schema_exists || !s.ledger_exists) {
    throw new Error(
      `${PREVIEW_SCHEMA} is not set up. Run ${REBUILD_COMMAND} after the one-time human setup (supabase/preview-setup/01-preview-role.sql).`
    );
  }
  // to_jsonb: also reads the checksum from a history that does not have the column yet
  const applied = query(
    target,
    `select version, to_jsonb(v) ->> 'checksum' as checksum from ${LEDGER} v`
  );
  const candidates = list.filter(m => !m.isLegacy);
  const p = plan(candidates, applied);
  const searchPath = previewSearchPath(extensionInPublic(target));

  if (p.changed.length > 0) {
    throw new Error(
      `These migrations were changed after they were applied to ${PREVIEW_SCHEMA}:\n` +
        p.changed.map(m => `  - ${m.file}`).join('\n') +
        `\n${PREVIEW_SCHEMA} contains the old state. Write the change as a new migration ` +
        `(new version number) or rebuild ${PREVIEW_SCHEMA} from public: ${REBUILD_COMMAND}`
    );
  }
  // Ledger rows of the historical baseline without a file are known (supabase/known-drift.txt)
  const knownDrift = new Set(readLegacyDrift());
  const foreign = p.foreign.filter(v => !knownDrift.has(v));
  if (foreign.length > 0) {
    warn(
      `${PREVIEW_SCHEMA} contains migrations that are missing in this state (other branches or deleted files): ${foreign.join(', ')}. ` +
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
      `set local search_path = ${searchPath};`,
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

function rebuild(target, list, { execute, snapshotDir }) {
  const snap = readSnapshot(snapshotDir);
  const s = state(target);
  if (!s.schema_exists) {
    throw new Error(
      `${PREVIEW_SCHEMA} does not exist. A human creates it once with supabase/preview-setup/01-preview-role.sql (the migration role cannot create schemas).`
    );
  }
  if (!s.meta_exists) {
    throw new Error(
      'The schema preview_meta does not exist (supabase/preview-setup/01-preview-role.sql).'
    );
  }
  const preview = s.ledger_exists
    ? query(target, `select version from ${LEDGER} order by version`).map(
        r => r.version
      )
    : [];
  const rp = rebuildPlan(list, snap.production, preview, readLegacyDrift());
  if (rp.missingFiles.length > 0) {
    throw new Error(
      `Applied in public, but no file here: ${rp.missingFiles.join(', ')}. Check out master first.`
    );
  }
  const pending = list.filter(
    m => !m.isLegacy && !rp.baseline.some(b => b.version === m.version)
  );
  console.log(
    `Rebuild ${PREVIEW_SCHEMA}: structure of public (schema-only snapshot, no rows), ledger of public (${rp.baseline.length} version(s)).`
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
    `  emptied: everything inside ${PREVIEW_SCHEMA} and its ledger (the schema, its owner and its grants stay)`
  );
  console.log(
    '  untouched: public, auth, storage, all Production objects and data, shared buckets with their files'
  );
  console.log(
    '  afterwards a human re-runs supabase/preview-setup/03-shared-objects.sql if realtime membership is needed'
  );
  if (!execute) {
    console.log(
      `Plan only. Run with --execute; this deletes all data in ${PREVIEW_SCHEMA}.`
    );
    return;
  }
  const searchPath = previewSearchPath(extensionInPublic(target));
  const { text } = cloneScript(snap, list, searchPath);
  runScript(target, text);
  console.log(`${PREVIEW_SCHEMA} emptied and cloned again (structure only).`);
  apply(target, list, { planOnly: false });
  runScript(target, "notify pgrst, 'reload schema';");
  console.log(
    `${PREVIEW_SCHEMA} rebuilt. Content: run the content sync or the seed (no rows were copied).`
  );
}

function argValue(args, name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : null;
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0];
  if (!['check', 'snapshot', 'apply', 'rebuild'].includes(command)) {
    console.error(
      'Usage: node scripts/db/preview-migrate.mjs check|snapshot|apply|rebuild [--db-url-env NAME|--linked|--local|--db-url <url>]'
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
      throw new Error(
        'Target missing: --db-url-env <NAME>, --linked, --local or --db-url <url>'
      );
    if (command === 'snapshot') {
      const out = argValue(args, '--out');
      if (!out) throw new Error('--out <dir> is required');
      snapshot(target, out);
    } else if (command === 'rebuild') {
      const snapshotDir = argValue(args, '--snapshot');
      if (!snapshotDir) throw new Error('--snapshot <dir> is required');
      rebuild(target, list, {
        execute: args.includes('--execute'),
        snapshotDir,
      });
    } else apply(target, list, { planOnly: args.includes('--plan-only') });
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
