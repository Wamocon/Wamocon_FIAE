// What an apply wrote, for the protocol and the rollback (docs/ki-upload-konzept.md
// 8.8): the id of every inserted row and the values before every update.
//
// The engines only know the Db interface and never delete, so the protocol is a
// decorator around that interface and the engines stay as they are (the scripts
// use them too). Everything the engine writes goes through insert() and update(),
// so nothing can be missed. The recorder only reads one row before an update (the
// columns the update changes, nothing else).

import type { Db, Row } from '@/lib/content-import/apply/db';
import { TABLES, type TableName } from '@/lib/content-import/apply/tables';

export interface WrittenRow {
  table: TableName;
  rowId: string;
  action: 'insert' | 'update';
  /** The values of the changed columns before an update, null for an insert. */
  before: Record<string, unknown> | null;
  /** The row of the table that caused it, filled by the attribution. */
  fileId: string | null;
}

/** Which file a written row belongs to, from what the plan says. */
export interface Attribution {
  /** Called for every inserted row with its table and values. */
  inserted(table: TableName, row: Row): string | null;
  /** Called for every updated row with the row as it was before. */
  updated(table: TableName, row: Row): string | null;
}

const noAttribution: Attribution = {
  inserted: () => null,
  updated: () => null,
};

export class RecordingDb implements Db {
  readonly written: WrittenRow[] = [];
  /** storage_path of the document rows that were inserted (the copies that are really used). */
  readonly storedPaths = new Set<string>();
  private readonly index = new Map<string, WrittenRow>();

  constructor(
    private readonly inner: Db,
    private readonly attribution: Attribution = noAttribution
  ) {}

  findCatalog(code: string) {
    return this.inner.findCatalog(code);
  }

  findProfile(id: string) {
    return this.inner.findProfile(id);
  }

  select(
    table: TableName,
    where?: Record<string, string | number | boolean | null | string[]>
  ) {
    return this.inner.select(table, where);
  }

  async insert(table: TableName, rows: Row[]): Promise<Row[]> {
    const inserted = await this.inner.insert(table, rows);
    for (const row of inserted) {
      if (table === 'content_documents' && row.storage_path) {
        this.storedPaths.add(String(row.storage_path));
      }
      this.add({
        table,
        rowId: String(row.id),
        action: 'insert',
        before: null,
        fileId: this.attribution.inserted(table, row),
      });
    }
    return inserted;
  }

  async update(table: TableName, id: string, patch: Row): Promise<void> {
    const columns = Object.keys(patch);
    if (columns.length === 0) return;
    const [existing] = await this.inner.select(table, { id });
    if (!existing) {
      throw new Error(`The row ${id} of ${table} to update does not exist.`);
    }
    const before: Record<string, unknown> = {};
    for (const column of columns) {
      // Only columns that an update may change are ever recorded (tables.ts)
      if (!TABLES[table].updatable.includes(column)) continue;
      before[column] = existing[column] ?? null;
    }
    await this.inner.update(table, id, patch);
    // One entry per row: a row written twice keeps the values from before the FIRST write
    const known = this.index.get(`${table}:${id}`);
    if (known) {
      if (known.action === 'update' && known.before) {
        known.before = { ...before, ...known.before };
      }
      return;
    }
    this.add({
      table,
      rowId: id,
      action: 'update',
      before,
      fileId: this.attribution.updated(table, existing),
    });
  }

  private add(entry: WrittenRow) {
    this.written.push(entry);
    this.index.set(`${entry.table}:${entry.rowId}`, entry);
  }
}
