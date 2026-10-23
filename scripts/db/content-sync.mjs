// Synchronises TRAINING CONTENT between the schemas public_preview and public
// of the same database, and nothing else. Template: the knowledge base sync of
// another project. Pure SQL inside the database, no data travels over the
// network.
//
// Which tables: only those in the allowlist supabase/content-tables.json
// (curriculum, courses, enablers, use cases, quizzes with questions and
// options, quiz links, learning fields, document metadata). NEVER profiles,
// organizations, submissions, progress, certificates, notifications or
// embeddings: the code refuses such names even if someone writes them into
// the allowlist (DENY below). profiles and organizations are only READ to
// translate foreign key ids (lookups), their rows are never copied.
//
// Behaviour: additive, never destructive.
//   1. INSERT rows that exist in the source and not in the target (identity =
//      the configured key columns of the table, e.g. [code]).
//   2. UPDATE rows that exist on both sides, per table "newer" (source
//      updated_at is newer), "always" or "never".
//   3. NEVER delete anything. A row removed in the source stays in the target.
//   4. Foreign key columns are translated through the key of the parent table
//      (the ids differ between the schemas). A row whose parent cannot be
//      translated is skipped and counted as "unmatched".
//   5. All or nothing: everything runs in one transaction under an advisory
//      lock. A key that is not unique in source or target aborts the sync.
//
// Dry run is the default: the complete sync runs inside a transaction that is
// rolled back, and the exact counts are read from the error message. With
// --apply the sync is committed and a second dry run must report zero changes
// (convergence check).
//
// Usage:
//   node scripts/db/content-sync.mjs --linked|--local|--db-url <url>
//        [--apply] [--direction preview-to-production|production-to-preview]
//        [--config supabase/content-tables.json] [--owner-email <email>]
// preview-to-production (default) is the release direction. The reverse
// direction seeds Preview with the released training content (still only the
// allowlist, never user data).

import { appendFileSync, readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { query, targetFrom } from './preview-cli.mjs';

export const DIRECTIONS = {
  'preview-to-production': ['public_preview', 'public'],
  'production-to-preview': ['public', 'public_preview'],
};
const ALLOWED_SCHEMAS = ['public', 'public_preview'];
const IDENT = /^[a-z_][a-z0-9_]*$/;
const ON_MISSING = ['skip', 'null', 'owner'];
const UPDATE_MODES = ['always', 'newer', 'never'];
// Only these tables may be read as lookups (never copied).
const LOOKUPS_ALLOWED = { profiles: ['email'], organizations: ['slug'] };
// Names that must never be synchronised, whatever the allowlist says.
const DENY = [
  /^profiles$/,
  /^organizations$/,
  /^course_members$/,
  /^notifications$/,
  /^knowledge_notes$/,
  /^acceptance_protocols$/,
  /^activity_/,
  /^quiz_(assignments|members|submissions|submission_answers)$/,
  /submission/,
  /^enabler_completions$/,
  /^trainee_/,
  /^progress$/,
  /^ausbildung_blocks$/,
  /^school_exam/,
  /^weekly_/,
  /^annual_/,
  /^work_certificates$/,
  /certificate/,
  /^grade_edit_history$/,
  /^hai_/,
  /embedding/,
  /password|token|secret|credential/,
];
const REPORT_MARKER = 'CONTENT_SYNC_REPORT:';
const q = value => `'${String(value).replace(/'/g, "''")}'`;

function ident(name) {
  if (typeof name !== 'string' || !IDENT.test(name)) {
    throw new Error(`Invalid identifier: ${JSON.stringify(name)}`);
  }
  return name;
}

/** @returns {string[]} errors of the allowlist (empty = valid) */
export function validateConfig(config) {
  const errors = [];
  if (!config || !Array.isArray(config.tables) || config.tables.length === 0) {
    return ['tables must be a non-empty array'];
  }
  const lookups = config.lookups ?? {};
  for (const [name, spec] of Object.entries(lookups)) {
    const allowed = LOOKUPS_ALLOWED[name];
    if (!allowed) {
      errors.push(
        `lookup ${name} is not allowed (allowed: ${Object.keys(LOOKUPS_ALLOWED).join(', ')})`
      );
    } else if (JSON.stringify(spec.matchOn) !== JSON.stringify(allowed)) {
      errors.push(`lookup ${name} must match on ${allowed.join(', ')}`);
    }
  }
  const seen = new Set();
  for (const t of config.tables) {
    const where = `table ${t?.name}`;
    if (!t || !IDENT.test(t.name ?? '')) {
      errors.push(`${where}: invalid name`);
      continue;
    }
    if (DENY.some(r => r.test(t.name))) {
      errors.push(
        `${where}: refused, this table holds user or non-content data`
      );
    }
    if (seen.has(t.name)) errors.push(`${where}: listed twice`);
    if (
      !Array.isArray(t.key) ||
      t.key.length === 0 ||
      !t.key.every(c => IDENT.test(c))
    ) {
      errors.push(`${where}: key must be a non-empty list of column names`);
    }
    if (t.update !== undefined && !UPDATE_MODES.includes(t.update)) {
      errors.push(`${where}: update must be one of ${UPDATE_MODES.join(', ')}`);
    }
    if (
      t.exclude !== undefined &&
      !(Array.isArray(t.exclude) && t.exclude.every(c => IDENT.test(c)))
    ) {
      errors.push(`${where}: exclude must be a list of column names`);
    }
    for (const [column, spec] of Object.entries(t.remap ?? {})) {
      if (!IDENT.test(column) || !IDENT.test(spec?.table ?? '')) {
        errors.push(`${where}: remap ${column} is invalid`);
        continue;
      }
      if (!ON_MISSING.includes(spec.onMissing ?? 'skip')) {
        errors.push(
          `${where}: remap ${column} onMissing must be one of ${ON_MISSING.join(', ')}`
        );
      }
      if (!seen.has(spec.table) && !(spec.table in lookups)) {
        errors.push(
          `${where}: remap ${column} refers to ${spec.table}, which is neither an earlier table nor a lookup`
        );
      }
    }
    seen.add(t.name);
  }
  return errors;
}

/** Expression for a column of the source row `s`, cast to the target type for enums. */
export function castExpression(alias, srcCol, dstCol) {
  const ref = `${alias}.${ident(srcCol.name)}`;
  if (srcCol.dataType === 'USER-DEFINED') {
    if (
      srcCol.udtSchema === dstCol.udtSchema &&
      srcCol.udtName === dstCol.udtName
    )
      return ref;
    // enum types are per schema: translate through text
    return `${ref}::text::${ident(dstCol.udtSchema)}.${ident(dstCol.udtName)}`;
  }
  if (srcCol.dataType === 'ARRAY' && srcCol.udtSchema !== 'pg_catalog') {
    throw new Error(
      `Column ${srcCol.name} is an array of a user defined type; exclude it in the allowlist or extend castExpression`
    );
  }
  return ref;
}

/**
 * Builds the sync script (pure).
 * @param {{
 *   config: object,
 *   meta: Record<string, Record<string, { name: string, dataType: string, udtSchema: string, udtName: string, generated: boolean }[]>>,
 *   from: string, to: string, ownerEmail?: string|null, rollback: boolean, only?: string[]|null
 * }} input
 * @returns {{ sql: string, tables: string[], notes: string[], errors: string[] }}
 */
export function buildScript({
  config,
  meta,
  from,
  to,
  ownerEmail = null,
  rollback,
  only = null,
}) {
  const errors = validateConfig(config);
  const notes = [];
  if (
    !ALLOWED_SCHEMAS.includes(from) ||
    !ALLOWED_SCHEMAS.includes(to) ||
    from === to
  ) {
    errors.push(
      `schemas must be two different ones of ${ALLOWED_SCHEMAS.join(', ')}`
    );
  }
  if (errors.length > 0) return { sql: '', tables: [], notes, errors };

  const lookups = config.lookups ?? {};
  const body = [];
  const planned = new Map(); // table -> { key, hasMap }
  const usedLookups = new Set();
  const referenced = new Set(
    config.tables.flatMap(t => Object.values(t.remap ?? {}).map(r => r.table))
  );
  const colsOf = (schema, table) => meta[schema]?.[table] ?? [];

  const mapSub = (parent, alias, column) =>
    `(select m.dst_id from _map_${ident(parent)} m where m.src_id = ${alias}.${ident(column)})`;
  const ownerSub = `(select p.id from ${ident(to)}.profiles p where lower(p.email) = lower(${q(ownerEmail ?? '')}))`;

  for (const t of config.tables) {
    if (only && !only.includes(t.name)) continue;
    const srcCols = colsOf(from, t.name);
    const dstCols = colsOf(to, t.name);
    if (srcCols.length === 0 || dstCols.length === 0) {
      if (t.optional) {
        notes.push(
          `${t.name}: skipped, table missing in ${srcCols.length === 0 ? from : to}`
        );
      } else {
        errors.push(
          `${t.name}: table missing in ${srcCols.length === 0 ? from : to}`
        );
      }
      continue;
    }
    const dstByName = new Map(dstCols.map(c => [c.name, c]));
    const exclude = new Set(t.exclude ?? []);
    const common = srcCols.filter(
      c =>
        dstByName.has(c.name) &&
        !c.generated &&
        !dstByName.get(c.name).generated &&
        !exclude.has(c.name)
    );
    const names = common.map(c => c.name);
    const missingKey = t.key.filter(k => !names.includes(k));
    if (missingKey.length > 0) {
      errors.push(
        `${t.name}: key column(s) ${missingKey.join(', ')} missing in one of the schemas`
      );
      continue;
    }
    const remaps = Object.entries(t.remap ?? {}).filter(([c]) =>
      names.includes(c)
    );
    let broken = false;
    for (const [column, spec] of remaps) {
      const isLookup = spec.table in lookups;
      if (!isLookup && !planned.has(spec.table)) {
        notes.push(
          `${t.name}: ${column} refers to ${spec.table}, which is not synchronised in this run`
        );
        broken = true;
      }
      if (isLookup) usedLookups.add(spec.table);
    }
    if (broken) {
      errors.push(
        `${t.name}: parent table of a foreign key is not part of this run`
      );
      continue;
    }
    const remapOf = new Map(remaps);
    const exprOf = c => {
      const spec = remapOf.get(c.name);
      if (!spec) return castExpression('s', c, dstByName.get(c.name));
      const sub = mapSub(spec.table, 's', c.name);
      return (spec.onMissing ?? 'skip') === 'owner'
        ? `coalesce(${sub}, ${ownerSub})`
        : sub;
    };
    const exprByName = new Map(common.map(c => [c.name, exprOf(c)]));
    const keyMatch = t.key
      .map(k => `d.${ident(k)} is not distinct from ${exprByName.get(k)}`)
      .join(' and ');
    const skipFilters = remaps
      .filter(([, spec]) => (spec.onMissing ?? 'skip') !== 'null')
      .map(
        ([c]) => `(s.${ident(c)} is null or ${exprByName.get(c)} is not null)`
      );
    const hasId = names.includes('id');
    const insertCols = names.filter(n => n !== 'id' || t.key.includes('id'));
    const mode = t.update ?? 'newer';
    const effectiveMode =
      mode === 'newer' && !names.includes('updated_at') ? 'always' : mode;
    // Columns that point to a user or organization (creator, uploader) are
    // set when a row is inserted and never overwritten on an update.
    const isLookupRemap = n =>
      remapOf.has(n) && remapOf.get(n).table in lookups;
    const setCols = names.filter(
      n =>
        !t.key.includes(n) &&
        n !== 'id' &&
        n !== 'created_at' &&
        !isLookupRemap(n) &&
        (effectiveMode === 'newer' || n !== 'updated_at')
    );
    const compareCols = setCols.filter(n => n !== 'updated_at');
    const keyList = t.key.map(k => `s.${ident(k)}`).join(', ');
    const dkeyList = t.key.map(k => `d.${ident(k)}`).join(', ');
    const T = ident(t.name);

    body.push(`  -- ${T}`);
    body.push(
      `  if exists (select 1 from ${from}.${T} s group by ${keyList} having count(*) > 1) then raise exception 'content-sync: key (${t.key.join(', ')}) is not unique in ${from}.${T}'; end if;`
    );
    body.push(
      `  if exists (select 1 from ${to}.${T} d group by ${dkeyList} having count(*) > 1) then raise exception 'content-sync: key (${t.key.join(', ')}) is not unique in ${to}.${T}'; end if;`
    );
    if (effectiveMode !== 'never' && compareCols.length > 0) {
      const sets = setCols
        .map(n => `${ident(n)} = ${exprByName.get(n)}`)
        .join(', ');
      const dcols = compareCols.map(n => `d.${ident(n)}`).join(', ');
      const scols = compareCols.map(n => exprByName.get(n)).join(', ');
      const newer =
        effectiveMode === 'newer' ? ' and s.updated_at > d.updated_at' : '';
      body.push(
        `  update ${to}.${T} d set ${sets} from ${from}.${T} s where ${keyMatch}${newer} and row(${dcols}) is distinct from row(${scols});`
      );
      body.push(`  get diagnostics n_upd = row_count;`);
    } else {
      body.push(`  n_upd := 0;`);
    }
    const cols = insertCols.map(ident).join(', ');
    const values = insertCols.map(n => exprByName.get(n)).join(', ');
    const where = [
      `not exists (select 1 from ${to}.${T} d where ${keyMatch})`,
      ...skipFilters,
    ].join(' and ');
    body.push(
      `  insert into ${to}.${T} (${cols}) select ${values} from ${from}.${T} s where ${where};`
    );
    body.push(`  get diagnostics n_ins = row_count;`);
    body.push(
      `  select count(*) into n_skip from ${from}.${T} s where not exists (select 1 from ${to}.${T} d where ${keyMatch});`
    );
    body.push(
      `  rep := rep || jsonb_build_object(${q(t.name)}, jsonb_build_object('inserted', n_ins, 'updated', n_upd, 'unmatched', n_skip));`
    );
    if (referenced.has(t.name)) {
      if (!hasId) {
        errors.push(
          `${t.name}: is referenced by another table but has no id column`
        );
        continue;
      }
      body.push(
        `  create temp table _map_${T} on commit drop as select distinct on (s.id) s.id as src_id, d.id as dst_id from ${from}.${T} s join ${to}.${T} d on ${keyMatch} order by s.id, d.id;`
      );
    }
    planned.set(t.name, { key: t.key });
  }
  if (errors.length > 0) return { sql: '', tables: [], notes, errors };

  const head = [];
  for (const name of usedLookups) {
    const spec = lookups[name];
    const match = spec.matchOn
      .map(c => `lower(sp.${ident(c)}::text) = lower(d.${ident(c)}::text)`)
      .join(' and ');
    head.push(
      `  create temp table _map_${ident(name)} on commit drop as select distinct on (sp.id) sp.id as src_id, d.id as dst_id from ${from}.${ident(name)} sp join ${to}.${ident(name)} d on ${match} order by sp.id, d.id;`
    );
  }
  const sql = [
    'do $content_sync$',
    "declare rep jsonb := '{}'::jsonb; n_ins bigint; n_upd bigint; n_skip bigint;",
    'begin',
    "  perform pg_advisory_xact_lock(hashtext('content_sync'));",
    ...head,
    ...body,
    rollback ? `  raise exception '${REPORT_MARKER}%', rep::text;` : '',
    'end',
    '$content_sync$;',
  ].join('\n');
  return { sql, tables: [...planned.keys()], notes, errors };
}

/** Reads the JSON report out of the error message of a rolled back dry run. */
export function parseReport(message) {
  const at = message.indexOf(REPORT_MARKER);
  if (at < 0) return null;
  const start = message.indexOf('{', at);
  const end = message.lastIndexOf('}');
  if (start < 0 || end < start) return null;
  try {
    return JSON.parse(message.slice(start, end + 1));
  } catch {
    return null;
  }
}

export function summarize(report) {
  const lines = [];
  let inserted = 0;
  let updated = 0;
  for (const [table, r] of Object.entries(report)) {
    inserted += r.inserted;
    updated += r.updated;
    lines.push(
      `  ${table.padEnd(36)} +${r.inserted} inserted, ~${r.updated} updated, ${r.unmatched} not present in target afterwards`
    );
  }
  return { lines, inserted, updated };
}

function loadMeta(target, config, from, to) {
  const names = [
    ...config.tables.map(t => t.name),
    ...Object.keys(config.lookups ?? {}),
  ].map(ident);
  const rows = query(
    target,
    `select table_schema, table_name, column_name, data_type, udt_schema, udt_name,
            (is_generated = 'ALWAYS' or generation_expression is not null) as generated
       from information_schema.columns
      where table_schema in (${q(from)}, ${q(to)}) and table_name in (${names.map(q).join(', ')})
      order by table_schema, table_name, ordinal_position`
  );
  const meta = { [from]: {}, [to]: {} };
  for (const r of rows) {
    (meta[r.table_schema][r.table_name] ??= []).push({
      name: r.column_name,
      dataType: r.data_type,
      udtSchema: r.udt_schema,
      udtName: r.udt_name,
      generated: Boolean(r.generated),
    });
  }
  return meta;
}

function dryRun(target, built) {
  try {
    query(target, built.sql, { emptyAllowed: true });
  } catch (e) {
    const report = parseReport(e.message);
    if (report) return report;
    throw e;
  }
  throw new Error('The dry run did not roll back as expected.');
}

function argValue(args, name, fallback = null) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : fallback;
}

function main() {
  const args = process.argv.slice(2);
  const target = targetFrom(args);
  if (!target) {
    console.error(
      'Usage: node scripts/db/content-sync.mjs --linked|--local|--db-url <url> [--apply] [--direction preview-to-production|production-to-preview] [--owner-email <email>]'
    );
    process.exit(2);
  }
  const summary = [];
  const say = (line = '') => {
    console.log(line);
    summary.push(line);
  };
  try {
    const apply = args.includes('--apply');
    const direction = argValue(args, '--direction', 'preview-to-production');
    if (!DIRECTIONS[direction])
      throw new Error(`Unknown direction ${direction}`);
    const [from, to] = DIRECTIONS[direction];
    const config = JSON.parse(
      readFileSync(
        argValue(args, '--config', 'supabase/content-tables.json'),
        'utf8'
      )
    );
    const ownerEmail = argValue(
      args,
      '--owner-email',
      process.env.CONTENT_SYNC_OWNER_EMAIL || null
    );
    const meta = loadMeta(target, config, from, to);
    const only = argValue(args, '--only')?.split(',') ?? null;
    const dry = buildScript({
      config,
      meta,
      from,
      to,
      ownerEmail,
      rollback: true,
      only,
    });
    if (dry.errors.length > 0)
      throw new Error(
        `Content sync refused:\n${dry.errors.map(e => `  - ${e}`).join('\n')}`
      );
    for (const n of dry.notes) say(`Note: ${n}`);
    if (!ownerEmail)
      say(
        'Note: no owner email, rows whose creator cannot be matched are skipped.'
      );
    say(
      `Content sync ${from} -> ${to} (${dry.tables.length} tables, ${apply ? 'apply' : 'dry run'})`
    );
    const report = dryRun(target, dry);
    const first = summarize(report);
    for (const l of first.lines) say(l);
    if (!apply) {
      say('');
      say(
        `Dry run: nothing was changed (${first.inserted} rows would be inserted, ${first.updated} updated). Use --apply to commit.`
      );
    } else {
      const real = buildScript({
        config,
        meta,
        from,
        to,
        ownerEmail,
        rollback: false,
        only,
      });
      query(target, real.sql, { emptyAllowed: true });
      const after = summarize(dryRun(target, dry));
      if (after.inserted > 0 || after.updated > 0) {
        throw new Error(
          `Content sync did not converge: a second dry run still finds ${after.inserted} inserts and ${after.updated} updates.`
        );
      }
      say('');
      say(
        `Content sync applied (${first.inserted} inserted, ${first.updated} updated); a second dry run finds nothing left.`
      );
    }
  } catch (e) {
    console.error(
      process.env.GITHUB_ACTIONS
        ? `::error::${e.message.split('\n')[0]}\n${e.message}`
        : `ERROR: ${e.message}`
    );
    process.exitCode = 1;
  } finally {
    if (process.env.GITHUB_STEP_SUMMARY) {
      appendFileSync(
        process.env.GITHUB_STEP_SUMMARY,
        `### Content sync\n\n\`\`\`\n${summary.join('\n')}\n\`\`\`\n`
      );
    }
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) main();
