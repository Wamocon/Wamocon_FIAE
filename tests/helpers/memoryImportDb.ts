// An in-memory implementation of the Db interface of the KfBM apply step, for
// tests. It keeps the rows of the tables the engine uses and refuses what the
// real database refuses (unique keys), so a wrong key in the engine shows up
// as an error here. It can take a snapshot and roll back, like a transaction.
import type {
  CatalogRow,
  Db,
  ProfileRow,
  Row,
} from '@/lib/content-import/apply/db';
import { TABLES } from '@/lib/content-import/apply/tables';
import type { TableName } from '@/lib/content-import/apply/tables';

export const KFBM_CATALOG_ID = '00000000-0000-4000-8000-000000000002';
export const FIAE_CATALOG_ID = '00000000-0000-4000-8000-000000000001';
export const CREATOR_ID = '99999999-0000-4000-8000-000000000001';

export type Tables = Record<TableName, Row[]>;

const emptyTables = (): Tables => ({
  training_components: [],
  courses: [],
  enablers: [],
  quizzes: [],
  questions: [],
  options: [],
  enabler_quiz_links: [],
  content_documents: [],
});

export interface WriteLog {
  op: 'insert' | 'update';
  table: TableName;
  rows: number;
  columns?: string[];
}

export class MemoryImportDb implements Db {
  tables: Tables = emptyTables();
  catalogs: CatalogRow[] = [
    { id: FIAE_CATALOG_ID, code: 'FIAE', is_active: true },
    { id: KFBM_CATALOG_ID, code: 'KFBM', is_active: true },
  ];
  profiles: ProfileRow[] = [{ id: CREATOR_ID, role: 'SUPER_ADMIN' }];
  log: WriteLog[] = [];
  private counter = 0;

  async findCatalog(code: string) {
    return this.catalogs.find(c => c.code === code) ?? null;
  }

  async findProfile(id: string) {
    return this.profiles.find(p => p.id === id) ?? null;
  }

  async select(
    table: TableName,
    where: Record<string, string | number | boolean | null | string[]> = {}
  ) {
    return this.tables[table]
      .filter(row =>
        Object.entries(where).every(([column, value]) =>
          Array.isArray(value)
            ? value.includes(String(row[column]))
            : (row[column] ?? null) === value
        )
      )
      .map(row => ({ ...row }));
  }

  async insert(table: TableName, rows: Row[]) {
    const out: Row[] = [];
    if (rows.length === 0) return out;
    const allowed = new Set(TABLES[table].columns);
    for (const row of rows) {
      for (const column of Object.keys(row)) {
        if (!allowed.has(column)) {
          throw new Error(`column ${column} is not allowed in ${table}`);
        }
      }
      this.checkUnique(table, row);
      this.counter += 1;
      const stored = {
        id: `00000000-0000-4000-9000-${String(this.counter).padStart(12, '0')}`,
        ...row,
      };
      this.tables[table].push(stored);
      out.push({ ...stored });
    }
    this.log.push({ op: 'insert', table, rows: rows.length });
    return out;
  }

  async update(table: TableName, id: string, patch: Row) {
    const allowed = new Set(TABLES[table].updatable);
    for (const column of Object.keys(patch)) {
      if (!allowed.has(column)) {
        throw new Error(`column ${column} may not be updated in ${table}`);
      }
    }
    const row = this.tables[table].find(r => r.id === id);
    if (!row) throw new Error(`no row ${id} in ${table}`);
    Object.assign(row, patch);
    this.log.push({
      op: 'update',
      table,
      rows: 1,
      columns: Object.keys(patch),
    });
  }

  snapshot(): string {
    return JSON.stringify({ tables: this.tables, counter: this.counter });
  }

  restore(snapshot: string) {
    const data = JSON.parse(snapshot);
    this.tables = data.tables;
    this.counter = data.counter;
  }

  count(table: TableName) {
    return this.tables[table].length;
  }

  totalRows() {
    return Object.values(this.tables).reduce((n, rows) => n + rows.length, 0);
  }

  private checkUnique(table: TableName, row: Row) {
    const rows = this.tables[table];
    const clash = (name: string, same: (r: Row) => boolean) => {
      if (rows.some(same)) throw new Error(`unique violation ${name}`);
    };
    switch (table) {
      case 'training_components':
        clash(
          'training_components_catalog_code_unique',
          r =>
            r.training_catalog_id === row.training_catalog_id &&
            r.code === row.code
        );
        break;
      case 'courses':
        if (row.code) {
          clash(
            'courses_catalog_code_unique',
            r =>
              r.training_catalog_id === row.training_catalog_id &&
              r.code === row.code
          );
        }
        if (row.training_component_id) {
          clash(
            'courses_training_component_unique',
            r => r.training_component_id === row.training_component_id
          );
        }
        break;
      case 'enablers':
        if (row.code) {
          clash(
            'enablers_course_code_unique',
            r => r.course_id === row.course_id && r.code === row.code
          );
        }
        break;
      case 'quizzes':
        if (row.code) {
          clash(
            'quizzes_catalog_code_unique',
            r =>
              r.training_catalog_id === row.training_catalog_id &&
              r.code === row.code
          );
        }
        if (row.quiz_type === 'GLOBAL' && row.training_component_id) {
          clash(
            'quizzes_global_component_unique',
            r =>
              r.quiz_type === 'GLOBAL' &&
              r.training_component_id === row.training_component_id
          );
        }
        break;
      case 'enabler_quiz_links':
        clash(
          'enabler_quiz_links_enabler_difficulty',
          r =>
            r.enabler_id === row.enabler_id && r.difficulty === row.difficulty
        );
        clash('enabler_quiz_links_quiz', r => r.quiz_id === row.quiz_id);
        break;
      default:
        break;
    }
  }
}

/** Runs `fn` like a transaction: commit keeps the rows, rollback restores them. */
export async function inTransaction<T>(
  db: MemoryImportDb,
  finish: 'commit' | 'rollback',
  fn: () => Promise<T>
): Promise<T> {
  const before = db.snapshot();
  try {
    const result = await fn();
    if (finish === 'rollback') db.restore(before);
    return result;
  } catch (error) {
    db.restore(before);
    throw error;
  }
}
