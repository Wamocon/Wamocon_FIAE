// The database interface of the apply step. The engine only knows this
// interface: PgDb (pg-db.ts) talks to PostgreSQL, the tests use a memory
// implementation. There is no delete and no truncate in it, by design.

import type { Conflict } from './types';
import type { TableName } from './tables';

export type Row = Record<string, unknown>;

export interface CatalogRow {
  id: string;
  code: string;
  is_active: boolean;
}

export interface ProfileRow {
  id: string;
  role: string;
}

export interface Db {
  findCatalog(code: string): Promise<CatalogRow | null>;
  findProfile(id: string): Promise<ProfileRow | null>;
  /**
   * Rows of a table. `where` compares columns for equality, an array value
   * means "one of", null means "is null". Every row carries its id.
   */
  select(
    table: TableName,
    where?: Record<string, string | number | boolean | null | string[]>
  ): Promise<Row[]>;
  /** Inserts rows and returns them with their ids, in any order. */
  insert(table: TableName, rows: Row[]): Promise<Row[]>;
  /** Updates named columns of one row (only the allowed ones, see tables.ts). */
  update(table: TableName, id: string, patch: Row): Promise<void>;
}

/** The run stops before or while writing. The transaction is rolled back. */
export class ImportAbort extends Error {
  readonly code: string;
  readonly conflicts: Conflict[];

  constructor(code: string, message: string, conflicts: Conflict[] = []) {
    super(message);
    this.name = 'ImportAbort';
    this.code = code;
    this.conflicts = conflicts;
  }
}
