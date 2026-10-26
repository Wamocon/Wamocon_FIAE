/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  courses,
  options,
  quizzes,
  trainingUseCases,
} from '@/db/migrations/schemas/schema';

/**
 * Static checks of the three migrations that close the model gaps of the KfBM
 * content import (20261028000100 to 20261028000300). The SQL itself was run
 * against a local database inside a rolled back transaction; these tests guard
 * the conventions of the release pipeline and the shape of each change.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const COURSE_COMPONENT = '20261028000100_course_training_component_link.sql';
const QUIZ_CODE = '20261028000200_quiz_code_and_link_catalog_check.sql';
const USE_CASE_LETTER =
  '20261028000300_use_case_letter_unique_option_order.sql';
const FILES = [COURSE_COMPONENT, QUIZ_CODE, USE_CASE_LETTER];
const CODE_FORMAT = '^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$';
const ROLLOUT_GATE_FROM = '20261024000100';

const allFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter(name => name.endsWith('.sql'))
  .sort();

function rawOf(file: string): string {
  return fs.readFileSync(path.join(MIGRATIONS_DIR, file), 'utf-8');
}
/** SQL without line comments (the files document themselves in comments). */
function sqlOf(file: string): string {
  return rawOf(file)
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
}
/** The comment block of the file. */
function headerOf(file: string): string {
  return rawOf(file)
    .split(/\r?\n/)
    .filter(line => line.startsWith('--'))
    .join('\n');
}
/** Position of the first match, so that the order of statements can be tested. */
function at(sql: string, pattern: RegExp): number {
  const index = sql.search(pattern);
  expect(index).toBeGreaterThanOrEqual(0);
  return index;
}

describe('KfBM import model gaps: place in the series', () => {
  it('has three files with 14 digit versions and lowercase names', () => {
    expect(FILES).toHaveLength(3);
    for (const file of FILES) {
      expect(file).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
      expect(allFiles).toContain(file);
    }
    expect([...FILES].sort()).toEqual(FILES);
  });

  it('sorts behind the catalog series and the follow-up files', () => {
    const earlier = [
      '20261024001500_user_role_super_admin_value.sql',
      '20261025000000_super_admin_backfill.sql',
      '20261025000100_security_revoke_public_create.sql',
      '20261026000100_trainee_enrollments_one_per_trainee.sql',
    ];
    for (const file of FILES) {
      for (const before of earlier) {
        expect(allFiles).toContain(before);
        expect(file > before).toBe(true);
      }
    }
  });

  it('is held back by the rollout gate (version from 20261024000100)', () => {
    for (const file of FILES) {
      expect(file.slice(0, 14) >= ROLLOUT_GATE_FROM).toBe(true);
    }
  });
});

describe.each(FILES)('%s: conventions', file => {
  const raw = rawOf(file);
  const sql = sqlOf(file);
  /** Statements only: comments removed, string literals blanked. */
  const statements = sql.replace(/'(?:[^']|'')*'/g, "''");

  it('has no explicit transaction control', () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it('sets lock_timeout 5s and statement_timeout 60s before any change', () => {
    expect(sql).toMatch(/set\s+local\s+lock_timeout\s*=\s*'5s'/i);
    expect(sql).toMatch(/set\s+local\s+statement_timeout\s*=\s*'60s'/i);
    expect(at(sql, /set\s+local\s+lock_timeout/i)).toBeLessThan(
      at(sql, /\b(alter|create|update)\b/i)
    );
  });

  it('installs no extensions, roles or publications', () => {
    expect(sql).not.toMatch(
      /\b(create|alter|drop)\s+(extension|role|user|publication)\b/i
    );
  });

  it('documents purpose, precheck and undo in the header', () => {
    const header = headerOf(file);
    expect(header).toMatch(/precheck/i);
    expect(header).toMatch(/undo/i);
    expect(header.length).toBeGreaterThan(400);
  });

  it('qualifies every table, view and function with public.', () => {
    const unqualified = [
      ...statements.matchAll(
        /\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:table|view|function)\s+(?:if\s+(?:not\s+)?exists\s+)?(?!public\.|if\s)([a-z_][a-z0-9_.]*)/gi
      ),
    ].map(match => match[1]);
    expect(unqualified).toEqual([]);
    expect(statements).not.toMatch(/table_schema\s*=\s*'public'/i);
    expect(statements).not.toMatch(/nspname\s*=\s*'public'/i);
  });

  it('looks up constraints only together with their namespace', () => {
    for (const lookup of sql.matchAll(/where conname = '[^']+'[\s\S]*?;/g)) {
      expect(lookup[0]).toMatch(/connamespace/);
    }
  });

  it('is repeatable: every addition is guarded', () => {
    expect(statements).not.toMatch(/add\s+column\s+(?!if not exists)/i);
    expect(statements).not.toMatch(
      /create\s+(?:unique\s+)?index\s+(?!if not exists)/i
    );
    // every ADD CONSTRAINT sits in a block that first looks the name up
    for (const constraint of statements.matchAll(
      /add\s+constraint\s+(\w+)/gi
    )) {
      expect(sql).toMatch(new RegExp(`conname\\s*=\\s*'${constraint[1]}'`));
    }
  });

  it('keeps identifiers within 63 characters', () => {
    const names = [
      ...statements.matchAll(/\bconstraint\s+([a-z_][a-z0-9_]*)/gi),
      ...statements.matchAll(
        /\bcreate\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi
      ),
      ...statements.matchAll(/\bcreate\s+trigger\s+([a-z_][a-z0-9_]*)/gi),
      ...statements.matchAll(/\bfunction\s+public\.([a-z_][a-z0-9_]*)/gi),
    ].map(match => match[1]);
    for (const name of names) {
      expect(name.length).toBeLessThanOrEqual(63);
    }
  });

  it('does not delete or drop any data', () => {
    // "on delete restrict" is a foreign key action, not a statement
    expect(statements).not.toMatch(/(?<!on\s)\bdelete\b/i);
    expect(statements).not.toMatch(/\b(truncate|merge|copy)\b/i);
    expect(statements).not.toMatch(/\bdrop\s+(table|column|schema)\b/i);
    expect(raw).not.toMatch(/migration:destructive-ok/);
  });
});

describe(`${COURSE_COMPONENT}: link from course to component`, () => {
  const sql = sqlOf(COURSE_COMPONENT);

  it('adds a nullable training_component_id to courses', () => {
    expect(sql).toMatch(
      /alter table public\.courses\s+add column if not exists training_component_id uuid\s*;/i
    );
    expect(sql).not.toMatch(/training_component_id uuid\s+not null/i);
  });

  it('stops when the catalog columns are missing, before any change', () => {
    const precheck = /do\s+\$\$[\s\S]*?\$\$\s*;/i.exec(sql);
    expect(precheck).not.toBeNull();
    expect(precheck![0]).toMatch(/training_catalog_id/);
    expect(precheck![0]).toMatch(/raise exception/i);
    expect(at(sql, /raise exception/i)).toBeLessThan(at(sql, /add column/i));
  });

  it('makes sure training_components has the (id, training_catalog_id) key', () => {
    expect(sql).toMatch(/training_components_id_catalog_unique/);
    expect(sql).toMatch(/unique\s*\(id, training_catalog_id\)/);
  });

  it('uses a composite foreign key that keeps the course in its own catalog', () => {
    expect(sql).toMatch(
      /foreign key \(training_component_id, training_catalog_id\)\s+references public\.training_components \(id, training_catalog_id\)\s+on delete restrict/i
    );
  });

  it('allows at most one course per component (partial unique index)', () => {
    expect(sql).toMatch(
      /create unique index if not exists courses_training_component_unique\s+on public\.courses \(training_component_id\)\s+where training_component_id is not null/i
    );
  });

  it('backfills by equal codes in the same catalog, only free components, and never fails', () => {
    const backfill = /update public\.courses[\s\S]*?;/i.exec(sql);
    expect(backfill).not.toBeNull();
    const text = backfill![0];
    expect(text).toMatch(/t\.training_catalog_id = c\.training_catalog_id/);
    expect(text).toMatch(/t\.code = c\.code/);
    expect(text).toMatch(/c\.training_component_id is null/);
    expect(text).toMatch(/c\.code is not null/);
    // a component that is already taken is not assigned a second time
    expect(text).toMatch(/not exists/i);
    // the numbers are reported
    expect(sql).toMatch(/raise notice/i);
    // nothing after the backfill raises an exception
    expect(sql.slice(sql.indexOf('update public.courses'))).not.toMatch(
      /raise exception/i
    );
  });

  it('creates the unique index after the backfill', () => {
    expect(at(sql, /update public\.courses/i)).toBeLessThan(
      at(sql, /create unique index/i)
    );
  });
});

describe(`${QUIZ_CODE}: quiz code and link check`, () => {
  const sql = sqlOf(QUIZ_CODE);

  it('uses the format rule of the other code columns', () => {
    expect(sqlOf('20261024000200_content_text_codes.sql')).toContain(
      CODE_FORMAT
    );
    expect(sql).toContain(CODE_FORMAT);
    expect(sql).toMatch(
      /alter table public\.quizzes\s+add column if not exists code text\s*;/i
    );
    expect(sql).toMatch(
      /add constraint quizzes_code_format_check\s+check \(code is null or code ~/i
    );
  });

  it('keeps the code unique per catalog, only where it is set', () => {
    expect(sql).toMatch(
      /create unique index if not exists quizzes_catalog_code_unique\s+on public\.quizzes \(training_catalog_id, code\)\s+where code is not null/i
    );
  });

  it('aborts with a number when existing links already violate the rule', () => {
    const precheck = /do\s+\$\$[\s\S]*?\$\$\s*;/i.exec(sql);
    expect(precheck).not.toBeNull();
    expect(precheck![0]).toMatch(/enabler_quiz_links/);
    expect(precheck![0]).toMatch(
      /q\.training_catalog_id <> c\.training_catalog_id/
    );
    expect(precheck![0]).toMatch(/raise exception/i);
    expect(precheck![0]).toMatch(/Nothing was changed/);
    // before the first change
    expect(at(sql, /raise exception/i)).toBeLessThan(at(sql, /add column/i));
    expect(at(sql, /raise exception/i)).toBeLessThan(
      at(sql, /create or replace function/i)
    );
  });

  it('checks the catalog of quiz and enabler in a trigger on enabler_quiz_links', () => {
    expect(sql).toMatch(
      /create trigger enabler_quiz_links_catalog_check\s+before insert or update of enabler_id, quiz_id\s+on public\.enabler_quiz_links\s+for each row/i
    );
    // the catalog of the enabler comes from its course
    expect(sql).toMatch(/join public\.courses c on c\.id = e\.course_id/i);
    expect(sql).toMatch(/errcode = 'check_violation'/i);
    // the message says what to do (the default of the quiz is FIAE)
    expect(sql).toMatch(/default is FIAE/);
  });

  it('also guards a later change of the catalog of a linked quiz', () => {
    expect(sql).toMatch(
      /create trigger quizzes_catalog_link_check\s+before update of training_catalog_id\s+on public\.quizzes\s+for each row/i
    );
  });

  it('runs the functions as definer with a fixed search_path and no PUBLIC execute', () => {
    expect(sql.match(/security definer\s+set search_path = ''/gi)).toHaveLength(
      2
    );
    expect(sql).toMatch(/revoke execute on function %s from public/);
    expect(sql).toMatch(/revoke execute on function %s from anon/);
    for (const fn of [
      'public.check_quiz_link_catalog()',
      'public.check_quiz_catalog_for_links()',
    ]) {
      expect(sql).toContain(fn);
    }
  });

  it('leaves a link with a missing parent to the foreign keys', () => {
    expect(sql).toMatch(/if not found then\s+return new;/i);
  });
});

describe(`${USE_CASE_LETTER}: unique letter and option order`, () => {
  const sql = sqlOf(USE_CASE_LETTER);

  it('aborts with a number when a component already repeats a letter', () => {
    const precheck = /do\s+\$\$[\s\S]*?\$\$\s*;/i.exec(sql);
    expect(precheck).not.toBeNull();
    expect(precheck![0]).toMatch(
      /group by component_id, letter\s+having count\(\*\) > 1/i
    );
    expect(precheck![0]).toMatch(/raise exception/i);
    expect(precheck![0]).toMatch(/Nothing was changed/);
    expect(at(sql, /raise exception/i)).toBeLessThan(
      at(sql, /add constraint/i)
    );
  });

  it('adds the unique constraint on (component_id, letter)', () => {
    expect(sql).toMatch(
      /add constraint training_use_cases_component_letter_unique\s+unique \(component_id, letter\)/i
    );
  });

  it('adds a nullable options.order_index without default (no rewrite, no UPDATE)', () => {
    expect(sql).toMatch(
      /alter table public\.options\s+add column if not exists order_index integer\s*;/i
    );
    expect(sql).not.toMatch(/order_index integer\s+(not null|default)/i);
    expect(sql).not.toMatch(/update public\.options/i);
  });
});

describe('Drizzle schema of the model gaps', () => {
  it('courses: training_component_id, composite foreign key and unique index', () => {
    const config = getTableConfig(courses);
    const column = config.columns.find(c => c.name === 'training_component_id');
    expect(column).toBeDefined();
    expect(column!.notNull).toBe(false);
    const fk = config.foreignKeys.find(
      f => f.getName() === 'courses_component_catalog_fk'
    );
    expect(fk).toBeDefined();
    expect(fk!.reference().columns.map(c => c.name)).toEqual([
      'training_component_id',
      'training_catalog_id',
    ]);
    expect(fk!.reference().foreignColumns.map(c => c.name)).toEqual([
      'id',
      'training_catalog_id',
    ]);
    expect(fk!.onDelete).toBe('restrict');
    const index = config.indexes.find(
      i => i.config.name === 'courses_training_component_unique'
    );
    expect(index).toBeDefined();
    expect(index!.config.unique).toBe(true);
    expect(index!.config.where).toBeDefined();
  });

  it('quizzes: code, format check and unique index per catalog', () => {
    const config = getTableConfig(quizzes);
    const column = config.columns.find(c => c.name === 'code');
    expect(column).toBeDefined();
    expect(column!.notNull).toBe(false);
    expect(config.checks.map(check => check.name)).toContain(
      'quizzes_code_format_check'
    );
    const index = config.indexes.find(
      i => i.config.name === 'quizzes_catalog_code_unique'
    );
    expect(index).toBeDefined();
    expect(index!.config.unique).toBe(true);
    expect(
      index!.config.columns.map(c => (c as { name: string }).name)
    ).toEqual(['training_catalog_id', 'code']);
    expect(index!.config.where).toBeDefined();
  });

  it('training_use_cases: unique (component_id, letter)', () => {
    const config = getTableConfig(trainingUseCases);
    const unique = config.uniqueConstraints.find(
      u => u.name === 'training_use_cases_component_letter_unique'
    );
    expect(unique).toBeDefined();
    expect(unique!.columns.map(c => c.name)).toEqual([
      'component_id',
      'letter',
    ]);
  });

  it('options: nullable order_index', () => {
    const config = getTableConfig(options);
    const column = config.columns.find(c => c.name === 'order_index');
    expect(column).toBeDefined();
    expect(column!.notNull).toBe(false);
  });
});
