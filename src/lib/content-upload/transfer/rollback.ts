// The rollback of an apply as SQL (docs/ki-upload-konzept.md 8.8, decision O9/K10).
//
// The app never deletes content. What it does is write a SQL text from the protocol
// of an apply (content_upload_applied_rows): the rows that apply inserted are deleted
// in the reverse order of their dependencies, the rows it updated get their values
// back. The owner runs the text, first as a probe that ends with "rollback", then with
// "commit". The text
//
//   - takes the advisory lock of the import first (the runbook SQL does not)
//   - checks itself: every table is handled by a block that raises an error, and so
//     ends the transaction, when it deletes or restores another number of rows than
//     the protocol lists
//   - names only ids of this apply, never a catalog or a pattern
//   - marks the apply as rolled back in the protocol (counts.rolledBack), the protocol
//     itself stays. A later rollback of an EARLIER apply is only possible after that
//     mark, and the same apply cannot be rolled back twice
//
// What the SQL does NOT do is listed in the notes of the answer: rows of hai_embeddings
// of deleted sources (no foreign key) and the copies of originals in the bucket.
//
// No text is produced, only reasons, when
//   - a LATER apply touched one of the rows (the rollback goes in reverse order)
//   - one of the rows is active or published now
//   - learners have data on the rows (submissions, completions, overrides, ...): the
//     cascade of the foreign keys would take it along

import { TABLES, type TableName } from '@/lib/content-import/apply/tables';
import type { Queryable } from '@/lib/content-import/apply/pg-db';

/** Tables in the order their rows are deleted: children before parents. */
export const DELETE_ORDER: readonly TableName[] = [
  'content_documents',
  'training_catalog_content_mappings',
  'enabler_quiz_links',
  'options',
  'questions',
  'quizzes',
  'use_cases',
  'enablers',
  'courses',
  'training_components',
  'training_catalog_learning_fields',
];

export interface AppliedRowRecord {
  table: TableName;
  rowId: string;
  action: 'insert' | 'update';
  before: Record<string, unknown> | null;
}

export class RollbackSqlError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RollbackSqlError';
  }
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const IDENTIFIER = /^[a-z_][a-z0-9_]*$/;
const CHUNK = 500;

function literal(value: unknown): string {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) {
      throw new RollbackSqlError(
        'A value that is not finite cannot be written.'
      );
    }
    return String(value);
  }
  if (typeof value === 'string') {
    if (value.includes('\0')) {
      throw new RollbackSqlError(
        'A text with a NUL character cannot be written.'
      );
    }
    // standard_conforming_strings is switched on at the top of the text, so a
    // backslash is a backslash and only the quote needs doubling.
    return `'${value.replace(/'/g, "''")}'`;
  }
  // A list of texts: use_cases.lernfelder (text[]), the one array column that an update of
  // the learning field engine changes
  if (Array.isArray(value)) {
    if (
      value.length > 200 ||
      !value.every(
        item =>
          item === null || (typeof item === 'string' && item.length <= 200)
      )
    ) {
      throw new RollbackSqlError('A list of this kind cannot be written.');
    }
    return value.length === 0
      ? "'{}'::text[]"
      : `array[${value.map(item => (item === null ? 'null' : literal(item))).join(', ')}]::text[]`;
  }
  throw new RollbackSqlError('A value of this type cannot be written.');
}

/** A timestamp of a query as a Date (the driver gives a Date, another one may give text). */
function toDate(value: unknown): Date {
  return value instanceof Date ? value : new Date(String(value));
}

const idList = (ids: readonly string[]) => ids.map(id => `'${id}'`).join(', ');

export interface RollbackSql {
  sql: string;
  /** Rows the text deletes, by table. */
  deletes: Record<string, number>;
  /** Rows the text restores, by table. */
  restores: Record<string, number>;
}

export interface RollbackInput {
  applyId: string;
  runId: string;
  startedAt: Date;
  generatedAt: Date;
  rows: readonly AppliedRowRecord[];
  /** Paths of copies in the document bucket, named in the notes of the text. */
  objectPaths?: readonly string[];
}

/** The SQL text for the rows of one apply. Throws RollbackSqlError for a row it cannot trust. */
export function buildRollbackSql(input: RollbackInput): RollbackSql {
  const inserted = new Map<TableName, string[]>();
  const updated = new Map<
    TableName,
    Array<{ id: string; before: Record<string, unknown> }>
  >();
  for (const row of input.rows) {
    if (!Object.prototype.hasOwnProperty.call(TABLES, row.table)) {
      throw new RollbackSqlError(
        'A row names a table that is not part of the import.'
      );
    }
    if (!UUID.test(row.rowId)) {
      throw new RollbackSqlError('A row id is not a uuid.');
    }
    if (row.action === 'insert') {
      inserted.set(row.table, [...(inserted.get(row.table) ?? []), row.rowId]);
    } else {
      if (!row.before) {
        throw new RollbackSqlError('An update has no values from before.');
      }
      updated.set(row.table, [
        ...(updated.get(row.table) ?? []),
        { id: row.rowId, before: row.before },
      ]);
    }
  }

  // Statements first, so the quote of the DO blocks can be chosen not to occur in any of them
  const restoreBlocks: Array<{
    table: TableName;
    body: string[];
    count: number;
  }> = [];
  const restores: Record<string, number> = {};
  for (const table of DELETE_ORDER.slice().reverse()) {
    const list = [...(updated.get(table) ?? [])].sort((a, b) =>
      a.id < b.id ? -1 : 1
    );
    if (list.length === 0) continue;
    const spec = TABLES[table];
    const body: string[] = [];
    for (const item of list) {
      const columns = Object.keys(item.before).sort();
      for (const column of columns) {
        if (!spec.updatable.includes(column) || !IDENTIFIER.test(column)) {
          throw new RollbackSqlError(
            'An update names a column that is not updatable.'
          );
        }
      }
      const assignments = columns.map(c => `${c} = ${literal(item.before[c])}`);
      if (spec.touch) assignments.push('updated_at = now()');
      body.push(
        `  update ${table} set ${assignments.join(', ')} where id = '${item.id}';`,
        '  get diagnostics n = row_count;',
        `  if n <> 1 then raise exception 'restore of ${table} %: % rows changed, expected 1', '${item.id}', n; end if;`
      );
    }
    restoreBlocks.push({ table, body, count: list.length });
    restores[table] = list.length;
  }

  const deleteBlocks: Array<{ table: TableName; ids: string[] }> = [];
  const deletes: Record<string, number> = {};
  for (const table of DELETE_ORDER) {
    const ids = [...new Set(inserted.get(table) ?? [])].sort();
    if (ids.length === 0) continue;
    for (let i = 0; i < ids.length; i += CHUNK) {
      deleteBlocks.push({ table, ids: ids.slice(i, i + CHUNK) });
    }
    deletes[table] = ids.length;
  }

  // A quote that no value of the text contains
  const allText = restoreBlocks.map(b => b.body.join('\n')).join('\n');
  let tag = '$rollback$';
  for (let i = 0; allText.includes(tag); i += 1) tag = `$rollback${i}$`;

  const lines: string[] = [
    '-- Rollback of one apply of the content upload.',
    `-- Apply ${input.applyId} of run ${input.runId}, started ${input.startedAt.toISOString()}, text made ${input.generatedAt.toISOString()}.`,
    '--',
    '-- Run it FIRST as a probe: it ends with "rollback;". If it raises no error, run it again with',
    '-- "commit;" in place of "rollback;". Every block checks its own row count and raises an error',
    '-- (which ends the transaction) when the database holds something else than this apply wrote.',
    '-- Do not run it while an import runs (it takes the advisory lock of the import first).',
    '--',
    '-- Not done by this text:',
    '--   * rows of hai_embeddings whose source was deleted here (no foreign key): check them after',
    '--   * copies of originals in the document bucket (see the paths below), remove them from the storage',
    ...(input.objectPaths && input.objectPaths.length > 0
      ? input.objectPaths.map(
          p => `--       bucket content: ${p.replace(/[\r\n]/g, ' ')}`
        )
      : []),
    '',
    'begin;',
    "set local lock_timeout = '5s';",
    "set local statement_timeout = '60s';",
    'set local standard_conforming_strings = on;',
    "select pg_advisory_xact_lock(hashtext('kfbm-content-import'));",
    '',
  ];
  for (const block of restoreBlocks) {
    lines.push(
      `-- Restore the values of ${block.count} updated row(s) of ${block.table}`,
      `do ${tag}`,
      'declare n integer;',
      'begin',
      ...block.body,
      `end ${tag};`,
      ''
    );
  }
  for (const block of deleteBlocks) {
    // Guards at the time the text RUNS (the checks of the answer ran when it was made): the
    // children of this apply are gone by now (children go first), so any row that still hangs
    // on the rows to remove, or any of them that is active, is not from this apply.
    const guards: string[] = [];
    for (const [parent, child, column] of DEPENDENTS) {
      if (parent !== block.table) continue;
      guards.push(
        `  if exists (select 1 from ${child} where ${column} in (${idList(block.ids)})) then raise exception 'delete from ${block.table}: rows of ${child} hang on rows of this apply'; end if;`
      );
    }
    for (const [table, column] of ACTIVE_COLUMNS) {
      if (table !== block.table) continue;
      guards.push(
        `  if exists (select 1 from ${table} where id in (${idList(block.ids)}) and ${column} = true) then raise exception 'delete from ${table}: rows are ${column} now'; end if;`
      );
    }
    lines.push(
      `-- Delete ${block.ids.length} row(s) of ${block.table} that this apply inserted`,
      `do ${tag}`,
      'declare n integer;',
      'begin',
      ...guards,
      `  delete from ${block.table} where id in (${idList(block.ids)});`,
      '  get diagnostics n = row_count;',
      `  if n <> ${block.ids.length} then raise exception 'delete from ${block.table}: % rows deleted, expected ${block.ids.length}', n; end if;`,
      `end ${tag};`,
      ''
    );
  }
  lines.push(
    '-- Mark the apply as rolled back (the rows of the protocol stay as proof)',
    `do ${tag}`,
    'declare n integer;',
    'begin',
    `  update content_upload_applies set counts = counts || jsonb_build_object('rolledBack', true, 'rolledBackAt', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')) where id = '${input.applyId}' and status = 'ok' and coalesce(counts ->> 'rolledBack', '') <> 'true';`,
    '  get diagnostics n = row_count;',
    "  if n <> 1 then raise exception 'the apply is no longer an apply that can be rolled back'; end if;",
    `end ${tag};`,
    '',
    'rollback; -- probe. Replace with "commit;" to keep the result.',
    ''
  );
  return { sql: lines.join('\n'), deletes, restores };
}

// ---------------------------------------------------------------------------
// What stands in the way (reads only)
// ---------------------------------------------------------------------------

/**
 * Tables that hold data of learners or of the curriculum on rows of the import,
 * and that a delete would take along (on delete cascade). [parent, child, column].
 * A test compares this list with the foreign keys of a database.
 */
export const DEPENDENTS: ReadonlyArray<readonly [TableName, string, string]> = [
  // links between the tables of the import itself: a row that someone added to a row of
  // this apply later (a trainer added a document, another apply added an enabler to the
  // course) is not part of this apply and a removal would take it along (cascade) or
  // detach it (set null)
  ['courses', 'content_documents', 'course_id'],
  ['courses', 'enablers', 'course_id'],
  ['courses', 'use_cases', 'course_id'],
  ['courses', 'trainee_achieved_skills', 'achieved_via_course_id'],
  ['enablers', 'content_documents', 'enabler_id'],
  ['enablers', 'enabler_quiz_links', 'enabler_id'],
  ['enablers', 'use_cases', 'enabler_id'],
  ['enablers', 'lernfeld_mappings_legacy', 'enabler_id'],
  ['quizzes', 'enabler_quiz_links', 'quiz_id'],
  ['quizzes', 'questions', 'quiz_id'],
  ['questions', 'options', 'question_id'],
  ['use_cases', 'content_documents', 'use_case_id'],
  ['use_cases', 'lernfeld_mappings_legacy', 'use_case_id'],
  ['training_components', 'courses', 'training_component_id'],
  ['training_components', 'quizzes', 'training_component_id'],
  [
    'training_catalog_learning_fields',
    'training_catalog_content_mappings',
    'learning_field_id',
  ],
  ['courses', 'course_members', 'course_id'],
  ['courses', 'course_skills', 'course_id'],
  ['options', 'quiz_submission_answers', 'selected_option_id'],
  ['enablers', 'enabler_completions', 'enabler_id'],
  ['enablers', 'enabler_submissions', 'enabler_id'],
  ['enablers', 'enabler_quizzes', 'enabler_id'],
  ['enablers', 'trainee_enabler_overrides', 'enabler_id'],
  ['enablers', 'training_catalog_content_mappings', 'enabler_id'],
  ['quizzes', 'enabler_quizzes', 'quiz_id'],
  ['quizzes', 'quiz_assignments', 'quiz_id'],
  ['quizzes', 'quiz_members', 'quiz_id'],
  ['quizzes', 'quiz_submissions', 'quiz_id'],
  ['questions', 'quiz_submission_answers', 'question_id'],
  ['use_cases', 'trainee_use_case_overrides', 'use_case_id'],
  ['use_cases', 'training_catalog_content_mappings', 'use_case_id'],
  ['use_cases', 'use_case_submissions', 'use_case_id'],
  ['training_components', 'training_use_cases', 'component_id'],
  ['training_components', 'trainee_elective_choices', 'component_id'],
];

/** Columns that mean "visible to learners" by table. */
const ACTIVE_COLUMNS: ReadonlyArray<readonly [TableName, string]> = [
  ['courses', 'is_active'],
  ['courses', 'is_published'],
  ['enablers', 'is_active'],
  ['quizzes', 'is_active'],
  ['use_cases', 'is_active'],
];

export interface RollbackBlocker {
  code:
    | 'ALREADY_ROLLED_BACK'
    | 'LATER_APPLY'
    | 'ACTIVATED_CONTENT'
    | 'DEPENDENT_DATA';
  message: string;
  /** Counts by table, never rows. */
  detail?: Record<string, number>;
}

export interface RollbackPlan {
  applyId: string;
  runId: string;
  startedAt: Date;
  rows: AppliedRowRecord[];
  blockers: RollbackBlocker[];
  objectPaths: string[];
}

const idsOf = (rows: readonly AppliedRowRecord[], table: TableName) =>
  rows
    .filter(r => r.table === table && r.action === 'insert')
    .map(r => r.rowId);

const chunked = <T>(values: readonly T[], size = 2000): T[][] => {
  const out: T[][] = [];
  for (let i = 0; i < values.length; i += size)
    out.push(values.slice(i, i + size));
  return out;
};

/**
 * The apply to roll back (the one named, or the newest apply of the run that
 * was written), its rows and what stands in the way. Null when there is none.
 */
export async function planRollback(
  q: Queryable,
  options: { runId: string; applyId?: string | null }
): Promise<RollbackPlan | null> {
  const applyResult = await q.query(
    options.applyId
      ? `select id, run_id, started_at, (coalesce(counts ->> 'rolledBack', '') = 'true') as rolled_back
           from content_upload_applies
          where id = $1 and run_id = $2 and mode = 'apply' and status = 'ok'`
      : `select id, run_id, started_at, false as rolled_back
           from content_upload_applies
          where run_id = $1 and mode = 'apply' and status = 'ok'
            and coalesce(counts ->> 'rolledBack', '') <> 'true'
          order by finished_at desc, id desc limit 1`,
    options.applyId ? [options.applyId, options.runId] : [options.runId]
  );
  const apply = applyResult.rows[0];
  if (!apply) return null;
  const applyId = String(apply.id);
  const startedAt = toDate(apply.started_at);

  const rowResult = await q.query(
    `select table_name, row_id, action, before
       from content_upload_applied_rows where apply_id = $1
      order by table_name, row_id`,
    [applyId]
  );
  const rows: AppliedRowRecord[] = rowResult.rows.map(r => ({
    table: String(r.table_name) as TableName,
    rowId: String(r.row_id),
    action: String(r.action) as 'insert' | 'update',
    before:
      r.before === null || r.before === undefined
        ? null
        : typeof r.before === 'string'
          ? (JSON.parse(r.before) as Record<string, unknown>)
          : (r.before as Record<string, unknown>),
  }));

  const blockers: RollbackBlocker[] = [];
  if (apply.rolled_back === true) {
    blockers.push({
      code: 'ALREADY_ROLLED_BACK',
      message: 'This apply was rolled back already.',
    });
  }

  // A later apply that touched the same rows (one that was rolled back no longer counts)
  const later = await q.query(
    `select count(*)::int as n
       from content_upload_applied_rows lr
       join content_upload_applies la
         on la.id = lr.apply_id and la.mode = 'apply' and la.status = 'ok'
        and coalesce(la.counts ->> 'rolledBack', '') <> 'true'
       join content_upload_applies me on me.id = $1
        and (la.finished_at, la.id) > (me.finished_at, me.id)
       join content_upload_applied_rows mine
         on mine.apply_id = $1 and mine.table_name = lr.table_name and mine.row_id = lr.row_id`,
    [applyId]
  );
  if (Number(later.rows[0]?.n) > 0) {
    blockers.push({
      code: 'LATER_APPLY',
      message:
        'A later apply touched rows of this apply. Roll back the later one first.',
      detail: { rows: Number(later.rows[0].n) },
    });
  }

  // Active or published rows
  const active: Record<string, number> = {};
  for (const [table, column] of ACTIVE_COLUMNS) {
    let total = 0;
    for (const ids of chunked(idsOf(rows, table))) {
      const result = await q.query(
        `select count(*)::int as n from ${table} where id = any($1::uuid[]) and ${column} = true`,
        [ids]
      );
      total += Number(result.rows[0]?.n ?? 0);
    }
    if (total > 0) active[`${table}.${column}`] = total;
  }
  if (Object.keys(active).length > 0) {
    blockers.push({
      code: 'ACTIVATED_CONTENT',
      message:
        'Rows of this apply are active or published now. Deactivate them before the rollback.',
      detail: active,
    });
  }

  // Data of learners that the cascade would take along
  const dependent: Record<string, number> = {};
  for (const [parent, child, column] of DEPENDENTS) {
    let total = 0;
    // A child that is a table of the import and was written by THIS apply is rolled back
    // with it: only the children it did not write count.
    const own = Object.prototype.hasOwnProperty.call(TABLES, child)
      ? idsOf(rows, child as TableName)
      : [];
    for (const ids of chunked(idsOf(rows, parent))) {
      try {
        const result = await q.query(
          own.length > 0
            ? `select count(*)::int as n from ${child} where ${column} = any($1::uuid[]) and not (id = any($2::uuid[]))`
            : `select count(*)::int as n from ${child} where ${column} = any($1::uuid[])`,
          own.length > 0 ? [ids, own] : [ids]
        );
        total += Number(result.rows[0]?.n ?? 0);
      } catch (error) {
        // A table that does not exist in this database holds nothing (42P01)
        if ((error as { code?: unknown })?.code !== '42P01') throw error;
      }
    }
    if (total > 0) dependent[`${child}.${column}`] = total;
  }
  if (Object.keys(dependent).length > 0) {
    blockers.push({
      code: 'DEPENDENT_DATA',
      message:
        'Learners or other data hang on rows of this apply (submissions, completions, memberships). A delete would take them along.',
      detail: dependent,
    });
  }

  // Copies of originals in the document bucket
  const objectPaths: string[] = [];
  for (const ids of chunked(idsOf(rows, 'content_documents'))) {
    const result = await q.query(
      `select storage_path from content_documents
        where id = any($1::uuid[]) and storage_path is not null and storage_path <> ''`,
      [ids]
    );
    for (const r of result.rows) objectPaths.push(String(r.storage_path));
  }
  objectPaths.sort();

  return {
    applyId,
    runId: options.runId,
    startedAt,
    rows,
    blockers,
    objectPaths,
  };
}

export interface RollbackAnswer {
  applyId: string;
  startedAt: string;
  /** The SQL text, or null when something stands in the way (see blockers). */
  sql: string | null;
  deletes: Record<string, number>;
  restores: Record<string, number>;
  blockers: RollbackBlocker[];
  /** What the text does not do. */
  notes: string[];
  /** Copies in the document bucket that the owner removes from the storage. */
  objectPaths: string[];
}

/** The answer of the rollback route for a run. Null when the run has no apply to roll back. */
export async function rollbackAnswer(
  q: Queryable,
  options: { runId: string; applyId?: string | null },
  now: Date = new Date()
): Promise<RollbackAnswer | null> {
  const plan = await planRollback(q, options);
  if (!plan) return null;
  const notes = [
    'Rows of hai_embeddings whose source is deleted are not removed (no foreign key). Check them afterwards.',
    ...(plan.objectPaths.length > 0
      ? [
          'Copies of originals in the document bucket are not removed. Remove them from the storage.',
        ]
      : []),
  ];
  if (plan.blockers.length > 0) {
    return {
      applyId: plan.applyId,
      startedAt: plan.startedAt.toISOString(),
      sql: null,
      deletes: {},
      restores: {},
      blockers: plan.blockers,
      notes,
      objectPaths: plan.objectPaths,
    };
  }
  const built = buildRollbackSql({
    applyId: plan.applyId,
    runId: plan.runId,
    startedAt: plan.startedAt,
    generatedAt: now,
    rows: plan.rows,
    objectPaths: plan.objectPaths,
  });
  return {
    applyId: plan.applyId,
    startedAt: plan.startedAt.toISOString(),
    sql: built.sql,
    deletes: built.deletes,
    restores: built.restores,
    blockers: [],
    notes,
    objectPaths: plan.objectPaths,
  };
}
