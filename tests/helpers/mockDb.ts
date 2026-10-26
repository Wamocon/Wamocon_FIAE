// Pattern for mocking '@/db' in tests.
// Update per test to return the expected rows for each query chain.

import { getTableName, is } from 'drizzle-orm';
import { PgDialect, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@/db/migrations/schemas/schema';

export function mockDbOnce(impl: Partial<Record<string, any>>) {
  jest.doMock('@/db', () => ({ __esModule: true, default: impl }));
}

export function resetDbMock() {
  jest.dontMock('@/db');
}

/**
 * Rows for one table. Either a fixed array, or `{ sequence: [...] }` when the
 * route queries the same table several times with different results (the last
 * entry repeats once the sequence is exhausted).
 */
export type TableRows = any[] | { sequence: any[][] };

export type RecordedCall = {
  op: 'select' | 'insert' | 'update' | 'delete';
  table: string | null;
  values?: unknown;
  /** Conditions passed to where(), in call order. */
  where?: unknown[];
  /** Row lock strength passed to for(), for example 'no key update'. */
  lock?: string;
};

/** Render a drizzle condition to SQL text and parameters (for assertions). */
export function renderCondition(condition: unknown): {
  sql: string;
  params: unknown[];
} {
  const dialect = new PgDialect();
  const query = dialect.sqlToQuery(condition as any);
  return { sql: query.sql, params: query.params };
}

// Map both the SQL table name and the schema export name to the SQL name, so
// tests can write `courseMembers` or `course_members` interchangeably.
let tableAliases: Map<string, string> | null = null;
function getTableAliases() {
  if (tableAliases) return tableAliases;
  tableAliases = new Map();
  for (const [exportName, value] of Object.entries(schema)) {
    if (is(value as any, PgTable)) {
      const sqlName = getTableName(value as any);
      tableAliases.set(sqlName, sqlName);
      tableAliases.set(exportName, sqlName);
    }
  }
  return tableAliases;
}

function toSqlName(name: string) {
  return getTableAliases().get(name) ?? name;
}

/**
 * Chainable drizzle mock keyed by table instead of by call order. Every chain
 * method returns the same chain, awaiting it resolves to the rows configured
 * for the table passed to `from()` (select) or to `insert/update/delete()`.
 * This keeps route tests stable when a query gains `limit`, `orderBy` or joins.
 */
export function createTableDb(
  tables: Record<string, TableRows> = {},
  returns: Record<string, any[]> = {}
) {
  const rows = new Map<string, TableRows>();
  for (const [name, value] of Object.entries(tables)) {
    rows.set(toSqlName(name), value);
  }
  const returning = new Map<string, any[]>();
  for (const [name, value] of Object.entries(returns)) {
    returning.set(toSqlName(name), value);
  }
  const cursor = new Map<string, number>();
  const calls: RecordedCall[] = [];

  function resolveRows(table: string | null): any[] {
    if (!table) return [];
    const entry = rows.get(table);
    if (!entry) return [];
    if (Array.isArray(entry)) return entry;
    const i = cursor.get(table) ?? 0;
    cursor.set(table, i + 1);
    return entry.sequence[Math.min(i, entry.sequence.length - 1)] ?? [];
  }

  // select reads the configured rows. Writes resolve to the `returns` rows for
  // the table, or echo the written values (with a generated id for inserts).
  function resolveFor(call: RecordedCall): any[] {
    if (call.op === 'select') return resolveRows(call.table);
    if (call.table && returning.has(call.table)) {
      return returning.get(call.table)!;
    }
    if (call.op === 'delete') return [];
    const list = Array.isArray(call.values) ? call.values : [call.values ?? {}];
    return list.map((v, i) =>
      call.op === 'insert'
        ? { id: `generated-${i + 1}`, ...(v as object) }
        : { ...(v as object) }
    );
  }

  function makeChain(op: RecordedCall['op'], table: string | null) {
    const call: RecordedCall = { op, table };
    calls.push(call);
    let settled: Promise<any[]> | null = null;
    const settle = () => (settled ??= Promise.resolve(resolveFor(call)));
    const chain: any = new Proxy(function () {}, {
      get(_target, prop) {
        if (prop === 'then') {
          return (onOk: any, onErr: any) => settle().then(onOk, onErr);
        }
        if (prop === 'catch') return (onErr: any) => settle().catch(onErr);
        if (prop === 'finally') return (fn: any) => settle().finally(fn);
        if (typeof prop === 'symbol') return undefined;
        return (...args: any[]) => {
          if (prop === 'from' && args[0]) {
            call.table = toSqlName(tableNameOf(args[0]));
          }
          if (prop === 'values' || prop === 'set') call.values = args[0];
          if (prop === 'for') call.lock = args[0];
          if (prop === 'where' && args[0]) {
            // drizzle also accepts where(fields => condition)
            const condition =
              typeof args[0] === 'function' ? args[0]({}) : args[0];
            if (condition) (call.where ??= []).push(condition);
          }
          return chain;
        };
      },
    });
    return chain;
  }

  function tableNameOf(table: any): string {
    try {
      return getTableName(table);
    } catch {
      return String(table);
    }
  }

  const db: any = {
    select: jest.fn(() => makeChain('select', null)),
    selectDistinct: jest.fn(() => makeChain('select', null)),
    insert: jest.fn((t: any) => makeChain('insert', toSqlName(tableNameOf(t)))),
    update: jest.fn((t: any) => makeChain('update', toSqlName(tableNameOf(t)))),
    delete: jest.fn((t: any) => makeChain('delete', toSqlName(tableNameOf(t)))),
    execute: jest.fn(async () => []),
    transaction: jest.fn(async (fn: (tx: any) => unknown) => fn(db)),
  };

  return {
    db,
    calls,
    /**
     * Rendered where() conditions of all calls on a table, as one SQL string
     * and the flat parameter list. Lets tests assert that a query is limited
     * to a catalog even though the mock ignores conditions.
     */
    filters(op: RecordedCall['op'], table: string) {
      const sqlName = toSqlName(table);
      const rendered = calls
        .filter(c => c.op === op && c.table === sqlName)
        .flatMap(c => (c.where ?? []).map(renderCondition));
      return {
        sql: rendered.map(r => r.sql).join(' | '),
        params: rendered.flatMap(r => r.params),
      };
    },
    /** Row lock strengths passed to for() on selects of a table. */
    locks(table: string) {
      const sqlName = toSqlName(table);
      return calls
        .filter(c => c.op === 'select' && c.table === sqlName && c.lock)
        .map(c => c.lock);
    },
    /** Values passed to insert().values() / update().set() for a table. */
    writes(op: 'insert' | 'update' | 'delete', table: string) {
      const sqlName = toSqlName(table);
      return calls
        .filter(c => c.op === op && c.table === sqlName)
        .map(c => c.values);
    },
  };
}
