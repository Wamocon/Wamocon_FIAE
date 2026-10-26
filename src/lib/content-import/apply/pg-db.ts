// PostgreSQL implementation of the Db interface of the apply step, and the
// transaction wrapper. It talks to a connection through a minimal interface
// (query), so the tests can use a recording fake.
//
// The only statements this module ever sends are BEGIN, SET LOCAL, SELECT,
// INSERT, UPDATE, COMMIT and ROLLBACK. There is no DELETE, TRUNCATE, DROP or
// ALTER anywhere, and table and column names come from tables.ts only (never
// from the plan), so nothing from a file can reach the SQL text.

import type { CatalogRow, Db, ProfileRow, Row } from './db';
import { ImportAbort } from './db';
import { TABLES } from './tables';
import type { TableName } from './tables';

export interface Queryable {
  query(
    text: string,
    values?: unknown[]
  ): Promise<{ rows: Record<string, unknown>[]; rowCount?: number | null }>;
}

/** Limits of every transaction of the apply step. */
export const LOCK_TIMEOUT = '5s';
export const STATEMENT_TIMEOUT = '60s';
/** Key of the advisory lock that keeps two imports from running at the same time. */
const ADVISORY_LOCK_NAME = 'kfbm-content-import';
/** At most this many rows per INSERT statement (and 60000 parameters). */
const MAX_ROWS_PER_INSERT = 500;
const MAX_PARAMETERS = 60000;

function checkedTable(table: string): TableName {
  if (!Object.prototype.hasOwnProperty.call(TABLES, table)) {
    throw new Error(`The table ${table} is not part of the import.`);
  }
  return table as TableName;
}

function checkedColumns(
  table: TableName,
  columns: string[],
  allowed: readonly string[]
) {
  for (const column of columns) {
    if (!allowed.includes(column)) {
      throw new Error(`The column ${column} is not allowed for ${table}.`);
    }
  }
}

export class PgDb implements Db {
  readonly client: Queryable;

  constructor(client: Queryable) {
    this.client = client;
  }

  async findCatalog(code: string): Promise<CatalogRow | null> {
    const result = await this.client.query(
      'select id, code, is_active from training_catalogs where code = $1',
      [code]
    );
    const row = result.rows[0];
    return row
      ? {
          id: String(row.id),
          code: String(row.code),
          is_active: row.is_active === true,
        }
      : null;
  }

  async findProfile(id: string): Promise<ProfileRow | null> {
    const result = await this.client.query(
      'select id, role::text as role from profiles where id = $1',
      [id]
    );
    const row = result.rows[0];
    return row ? { id: String(row.id), role: String(row.role) } : null;
  }

  async select(
    tableName: TableName,
    where: Record<string, string | number | boolean | null | string[]> = {}
  ): Promise<Row[]> {
    const table = checkedTable(tableName);
    const spec = TABLES[table];
    const columns = ['id', ...spec.columns];
    const conditions: string[] = [];
    const values: unknown[] = [];
    for (const [column, value] of Object.entries(where)) {
      checkedColumns(table, [column], columns);
      if (value === null) {
        conditions.push(`${column} is null`);
      } else if (Array.isArray(value)) {
        if (value.length === 0) return [];
        values.push(value);
        const cast = spec.uuid.includes(column) ? 'uuid' : 'text';
        conditions.push(`${column} = any($${values.length}::${cast}[])`);
      } else {
        values.push(value);
        conditions.push(`${column} = $${values.length}`);
      }
    }
    const result = await this.client.query(
      `select ${columns.join(', ')} from ${table}${
        conditions.length > 0 ? ` where ${conditions.join(' and ')}` : ''
      } order by id`,
      values
    );
    return result.rows;
  }

  async insert(tableName: TableName, rows: Row[]): Promise<Row[]> {
    const table = checkedTable(tableName);
    if (rows.length === 0) return [];
    const spec = TABLES[table];
    const columns = Object.keys(rows[0]);
    checkedColumns(table, columns, spec.columns);
    for (const row of rows) {
      const keys = Object.keys(row);
      if (
        keys.length !== columns.length ||
        !columns.every(c => keys.includes(c))
      ) {
        throw new Error(`All rows for ${table} need the same columns.`);
      }
    }
    const perStatement = Math.max(
      1,
      Math.min(MAX_ROWS_PER_INSERT, Math.floor(MAX_PARAMETERS / columns.length))
    );
    const out: Row[] = [];
    for (let start = 0; start < rows.length; start += perStatement) {
      const chunk = rows.slice(start, start + perStatement);
      const values: unknown[] = [];
      const tuples = chunk.map(row => {
        const marks = columns.map(column => {
          values.push(row[column] ?? null);
          return `$${values.length}`;
        });
        return `(${marks.join(', ')})`;
      });
      const result = await this.client.query(
        `insert into ${table} (${columns.join(', ')}) values ${tuples.join(', ')} returning id, ${columns.join(', ')}`,
        values
      );
      out.push(...result.rows);
    }
    return out;
  }

  async update(tableName: TableName, id: string, patch: Row): Promise<void> {
    const table = checkedTable(tableName);
    const spec = TABLES[table];
    const columns = Object.keys(patch);
    if (columns.length === 0) return;
    checkedColumns(table, columns, spec.updatable);
    const values: unknown[] = [];
    const assignments = columns.map(column => {
      values.push(patch[column] ?? null);
      return `${column} = $${values.length}`;
    });
    if (spec.touch) assignments.push('updated_at = now()');
    values.push(id);
    const result = await this.client.query(
      `update ${table} set ${assignments.join(', ')} where id = $${values.length}`,
      values
    );
    if (result.rowCount !== 1) {
      throw new Error(
        `The update of ${table} ${id} changed ${result.rowCount ?? 0} rows, expected 1.`
      );
    }
  }
}

export interface TransactionOptions {
  /** A read-only transaction (check). A write transaction takes the import lock. */
  mode: 'read-only' | 'write';
  /** commit keeps the changes, rollback discards them (check and dry run). */
  finish: 'commit' | 'rollback';
}

/**
 * Runs `work` in one transaction with the isolation level repeatable read, a
 * lock timeout and a statement timeout. The transaction ends with COMMIT only
 * when `finish` says so and `work` did not throw, in every other case with
 * ROLLBACK. A write transaction first takes an advisory lock so that two
 * imports cannot overlap; if another import holds it the run stops.
 */
export async function withTransaction<T>(
  client: Queryable,
  options: TransactionOptions,
  work: () => Promise<T>
): Promise<T> {
  await client.query(
    `begin isolation level repeatable read ${
      options.mode === 'read-only' ? 'read only' : 'read write'
    }`
  );
  try {
    await client.query(`set local lock_timeout = '${LOCK_TIMEOUT}'`);
    await client.query(`set local statement_timeout = '${STATEMENT_TIMEOUT}'`);
    // With row level security a role that is not the owner would see a
    // filtered table without an error. Off makes it an error instead.
    await client.query('set local row_security = off');
    if (options.mode === 'write') {
      const lock = await client.query(
        'select pg_try_advisory_xact_lock(hashtext($1)) as locked',
        [ADVISORY_LOCK_NAME]
      );
      if (lock.rows[0]?.locked !== true) {
        throw new ImportAbort(
          'LOCKED',
          'Another import is running (advisory lock). Nothing was written.'
        );
      }
    }
    const result = await work();
    await client.query(options.finish === 'commit' ? 'commit' : 'rollback');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // The connection may already be gone, the server rolls back on its own.
    }
    throw error;
  }
}
