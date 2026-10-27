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
  use_cases: [],
  training_catalog_learning_fields: [],
  training_catalog_content_mappings: [],
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
    for (const input of rows) {
      for (const column of Object.keys(input)) {
        if (!allowed.has(column)) {
          throw new Error(`column ${column} is not allowed in ${table}`);
        }
      }
      const row = this.prepare(table, input);
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

  /**
   * What the database does before a row is stored: the trigger that derives
   * the catalog of a mapping from its learning field, and the checks of the
   * learning field tables (foreign keys, check constraints).
   */
  private prepare(table: TableName, row: Row): Row {
    if (table === 'training_catalog_learning_fields') {
      const year = Number(row.training_year);
      if (!row.code || !row.title || !(year >= 1 && year <= 3)) {
        throw new Error('check violation training_catalog_learning_fields');
      }
      if (
        row.hours_budget !== null &&
        row.hours_budget !== undefined &&
        Number(row.hours_budget) < 0
      ) {
        throw new Error('check violation hours_budget');
      }
    }
    if (table === 'use_cases') {
      // The composite foreign keys of the real table: the course carries the
      // catalog, the enabler belongs to the same course.
      const course = this.tables.courses.find(r => r.id === row.course_id);
      if (!course) throw new Error('foreign key use_cases_course_id');
      if (course.training_catalog_id !== row.training_catalog_id) {
        throw new Error('foreign key use_cases_course_catalog_fk');
      }
      if (row.enabler_id != null) {
        const enabler = this.tables.enablers.find(r => r.id === row.enabler_id);
        if (!enabler || enabler.course_id !== row.course_id) {
          throw new Error('foreign key use_cases_enabler_course_fk');
        }
      }
      if (
        !row.title ||
        row.description_text == null ||
        row.order_index == null
      ) {
        throw new Error('not null violation use_cases');
      }
      if (
        row.code &&
        !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(String(row.code))
      ) {
        throw new Error('check violation use_cases_code_format_check');
      }
    }
    if (table === 'content_documents' && row.use_case_id != null) {
      if (!this.tables.use_cases.some(r => r.id === row.use_case_id)) {
        throw new Error('foreign key content_documents_use_case_id');
      }
    }
    if (table === 'training_catalog_content_mappings') {
      const field = this.tables.training_catalog_learning_fields.find(
        r => r.id === row.learning_field_id
      );
      if (!field) throw new Error('foreign key learning_field_id');
      if ((row.enabler_id == null) === (row.use_case_id == null)) {
        throw new Error('check violation exactly_one_content');
      }
      if (row.enabler_id != null) {
        const enabler = this.tables.enablers.find(r => r.id === row.enabler_id);
        if (!enabler) throw new Error('foreign key enabler_id');
        if (enabler.training_catalog_id !== field.training_catalog_id) {
          throw new Error('foreign key enabler_catalog_fk');
        }
      }
      if (row.use_case_id != null) {
        const useCase = this.tables.use_cases.find(
          r => r.id === row.use_case_id
        );
        if (!useCase) throw new Error('foreign key use_case_id');
        if (useCase.training_catalog_id !== field.training_catalog_id) {
          throw new Error('foreign key use_case_catalog_fk');
        }
      }
      return { ...row, training_catalog_id: field.training_catalog_id };
    }
    return row;
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
      case 'use_cases':
        if (row.code) {
          clash(
            'use_cases_course_code_unique',
            r => r.course_id === row.course_id && r.code === row.code
          );
        }
        if (row.enabler_id) {
          clash(
            'use_cases_enabler_id_unique',
            r => r.enabler_id === row.enabler_id
          );
        }
        break;
      case 'training_catalog_learning_fields':
        clash(
          'training_catalog_learning_fields_catalog_code_unique',
          r =>
            r.training_catalog_id === row.training_catalog_id &&
            r.code === row.code
        );
        clash(
          'training_catalog_learning_fields_catalog_order_unique',
          r =>
            r.training_catalog_id === row.training_catalog_id &&
            r.order_index === row.order_index
        );
        break;
      case 'training_catalog_content_mappings':
        if (row.enabler_id != null) {
          clash(
            'training_catalog_content_mappings_lf_enabler_unique',
            r =>
              r.learning_field_id === row.learning_field_id &&
              r.enabler_id === row.enabler_id
          );
        }
        if (row.use_case_id != null) {
          clash(
            'training_catalog_content_mappings_lf_use_case_unique',
            r =>
              r.learning_field_id === row.learning_field_id &&
              r.use_case_id === row.use_case_id
          );
        }
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
