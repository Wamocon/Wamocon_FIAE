/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  ausbildungBlocks,
  schoolExams,
  TRAINING_CATALOG_IDS,
} from '@/db/migrations/schemas/schema';

/**
 * Static checks of 20261103000100_school_catalog.sql: school exams and school
 * blocks belong to one occupation. The conventions of the release pipeline, the
 * order of the backfill (exams: the learning field first, then the first
 * enrollment, then FIAE; blocks: the first enrollment, then FIAE), NOT NULL only
 * after the backfill, the indexes and the match with the Drizzle schema. The SQL
 * is not run here, the Preview migration of the pull request runs it.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const FILE = '20261103000100_school_catalog.sql';
const FIAE = '00000000-0000-4000-8000-000000000001';

const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, FILE), 'utf-8');
const header = raw
  .split(/\r?\n/)
  .filter(line => line.startsWith('--'))
  .map(line => line.replace(/^--\s?/, ''))
  .join(' ')
  .replace(/\s+/g, ' ');
const sql = raw
  .split(/\r?\n/)
  .filter(line => !line.trim().startsWith('--'))
  .join('\n');
const statements = sql.replace(/'(?:[^']|'')*'/g, "''");

const allFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter(name => name.endsWith('.sql'))
  .sort();

/** Position of the first match of `pattern` in `text`, or -1. */
const at = (text: string, pattern: RegExp) => text.search(pattern);

describe('school catalog migration: place in the series', () => {
  it('has a 14 digit version, a lowercase name and is the only file of its version', () => {
    expect(FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(allFiles.filter(name => name.startsWith('20261103000100'))).toEqual([
      FILE,
    ]);
  });

  it('sorts behind the weekly evaluations file and behind the rollout gate (GATED_TO)', () => {
    expect(FILE > '20261102000400_weekly_evaluations_catalog.sql').toBe(true);
    // scripts/db/rollout-gate.mjs holds back 20261024000100 to 20261030000300
    expect(FILE.slice(0, 14) > '20261030000300').toBe(true);
  });
});

describe('school catalog migration: conventions', () => {
  it('has no explicit transaction control and keeps the timeouts of the series', () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(sql).toMatch(/set\s+local\s+lock_timeout\s*=\s*'5s'/i);
    expect(sql).toMatch(/set\s+local\s+statement_timeout\s*=\s*'60s'/i);
  });

  it('installs no extensions, roles, publications, policies or triggers', () => {
    expect(statements).not.toMatch(
      /\b(create|alter|drop)\s+(extension|role|user|publication|policy|trigger)\b/i
    );
  });

  it('is destructive nowhere (no drop table or column, no delete, no truncate)', () => {
    expect(statements).not.toMatch(/\bdrop\s+(table|column|schema)\b/i);
    expect(statements).not.toMatch(/\b(delete\s+from|truncate)\b/i);
    expect(raw).not.toContain('migration:destructive-ok');
  });

  it('qualifies every table with public. (the preview run rewrites it)', () => {
    const tables = [
      ...statements.matchAll(
        /\b(?:from|join|update|table|on|references|exists)\s+(public\.)?(school_exams|ausbildung_blocks|training_catalog_learning_fields|training_catalogs|trainee_enrollments)\b/gi
      ),
    ];
    expect(tables.length).toBeGreaterThan(12);
    for (const match of tables) expect(match[1]).toBe('public.');
  });

  it('changes no other table than school_exams and ausbildung_blocks', () => {
    expect(statements).not.toMatch(
      /\balter\s+table\s+(?!public\.(school_exams|ausbildung_blocks)\b)/i
    );
    expect(statements).not.toMatch(
      /\bupdate\s+(?!public\.(school_exams|ausbildung_blocks)\b)/i
    );
    expect(statements).not.toMatch(/\binsert\s+into\b/i);
  });

  it('adds no uniqueness and replaces none (neither table has one per week)', () => {
    expect(statements).not.toMatch(/\bunique\b/i);
    expect(statements).not.toMatch(/\bdrop\s+(constraint|index)\b/i);
  });

  it('names its purpose, the undo and the effect on Production in the header', () => {
    expect(header).toMatch(/belong to one occupation/i);
    expect(header).toMatch(/WMCNL-2955/);
    expect(header).toMatch(/WMCNL-3018/);
    expect(header).toMatch(/Undo/);
    expect(header).toMatch(
      /alter table public\.school_exams drop column if exists training_catalog_id/i
    );
    expect(header).toMatch(
      /alter table public\.ausbildung_blocks drop column if exists training_catalog_id/i
    );
    expect(header).toMatch(
      /drop index if exists public\.school_exams_trainee_catalog_idx/i
    );
    expect(header).toMatch(/Safe to run twice/i);
    expect(header).toMatch(/three trainees today, all in FIAE/i);
  });

  it('does not claim a row count for Production (it is not known from the schema)', () => {
    expect(header).toMatch(/not known from the schema and is not claimed/i);
  });

  it('is safe to run twice', () => {
    expect(statements).toMatch(
      /alter\s+table\s+public\.school_exams\s+add\s+column\s+if\s+not\s+exists\s+training_catalog_id\s+uuid\s*;/i
    );
    expect(statements).toMatch(
      /alter\s+table\s+public\.ausbildung_blocks\s+add\s+column\s+if\s+not\s+exists\s+training_catalog_id\s+uuid\s*;/i
    );
    expect(statements).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+school_exams_trainee_catalog_idx/i
    );
    expect(statements).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+ausbildung_blocks_trainee_catalog_idx/i
    );
    // both keys are guarded by a lookup in pg_constraint
    for (const key of [
      'school_exams_training_catalog_id_training_catalogs_id_fk',
      'ausbildung_blocks_training_catalog_id_training_catalogs_id_fk',
    ]) {
      expect(sql).toMatch(
        new RegExp(`if not exists \\([\\s\\S]*?conname = '${key}'`, 'i')
      );
    }
  });
});

describe('school catalog migration: the columns', () => {
  it('stops with a clear message if a table, the learning field column or the FIAE row is missing, before anything changes', () => {
    const precheck = at(sql, /to_regclass\('public\.school_exams'\) is null/i);
    const addColumn = at(statements, /add\s+column/i);
    expect(precheck).toBeGreaterThan(-1);
    expect(precheck).toBeLessThan(addColumn);
    expect(sql).toMatch(/raise exception[\s\S]*Nothing was changed/i);
    expect(sql).toMatch(/a\.attname = 'lernfeld_code'/);
    expect(sql).toContain(FIAE);
  });

  it('adds a nullable uuid column with a foreign key to training_catalogs (restrict) to both tables', () => {
    for (const table of ['school_exams', 'ausbildung_blocks']) {
      expect(statements).toMatch(
        new RegExp(
          `alter\\s+table\\s+public\\.${table}\\s+add\\s+column\\s+if\\s+not\\s+exists\\s+training_catalog_id\\s+uuid\\s*;`,
          'i'
        )
      );
      expect(statements).toMatch(
        new RegExp(
          `alter\\s+table\\s+public\\.${table}\\s+add\\s+constraint\\s+${table}_training_catalog_id_training_catalogs_id_fk\\s+foreign\\s+key\\s*\\(training_catalog_id\\)\\s*references\\s+public\\.training_catalogs\\s*\\(id\\)\\s*on\\s+delete\\s+restrict`,
          'i'
        )
      );
    }
  });

  it('sets the default FIAE and NOT NULL on both tables, and only after the backfill', () => {
    const lastBackfill = at(
      statements,
      /update\s+public\.ausbildung_blocks\s+b\s+set\s+training_catalog_id\s*=\s*coalesce/i
    );
    const defaultAndNotNull = at(
      statements,
      /alter\s+column\s+training_catalog_id\s+set\s+default/i
    );
    expect(lastBackfill).toBeGreaterThan(-1);
    expect(defaultAndNotNull).toBeGreaterThan(lastBackfill);
    for (const table of ['school_exams', 'ausbildung_blocks']) {
      expect(sql).toMatch(
        new RegExp(
          `alter table public\\.${table}\\s+alter column training_catalog_id set default '00000000-0000-4000-8000-000000000001',\\s*alter column training_catalog_id set not null`,
          'i'
        )
      );
    }
  });

  it.each([
    ['school_exams', schoolExams],
    ['ausbildung_blocks', ausbildungBlocks],
  ])(
    'matches the Drizzle schema of %s: not null, default FIAE, key to training_catalogs, the index',
    (name, table) => {
      const config = getTableConfig(table as never);
      const column = config.columns.find(c => c.name === 'training_catalog_id');
      expect(column).toBeDefined();
      expect(column!.notNull).toBe(true);
      expect(column!.hasDefault).toBe(true);
      expect(TRAINING_CATALOG_IDS.FIAE).toBe(FIAE);

      const reference = config.foreignKeys
        .map(fk => fk.reference())
        .find(r => r.columns.some(c => c.name === 'training_catalog_id'));
      expect(reference).toBeDefined();
      expect(getTableConfig(reference!.foreignTable as never).name).toBe(
        'training_catalogs'
      );

      const index = config.indexes.find(
        i => i.config.name === `${name}_trainee_catalog_idx`
      );
      expect(index).toBeDefined();
      expect(
        index!.config.columns.map(c => (c as { name: string }).name)
      ).toEqual(['trainee_id', 'training_catalog_id']);
    }
  );
});

describe('school catalog migration: the backfill', () => {
  it('exams: first the learning field, but only among the occupations of the trainee and only if it exists in exactly one of them', () => {
    expect(statements).toMatch(
      /from\s+public\.school_exams\s+e\s+join\s+public\.trainee_enrollments\s+en\s+on\s+en\.trainee_id\s*=\s*e\.trainee_id\s+join\s+public\.training_catalog_learning_fields\s+lf\s+on\s+lf\.training_catalog_id\s*=\s*en\.training_catalog_id\s+and\s+lf\.code\s*=\s*e\.lernfeld_code/i
    );
    expect(statements).toMatch(
      /count\(distinct\s+lf\.training_catalog_id\)\s+as\s+catalogs/i
    );
    expect(statements).toMatch(/and\s+fc\.catalogs\s*=\s*1/i);
  });

  it.each([
    ['school_exams', 'e'],
    ['ausbildung_blocks', 'b'],
  ])(
    '%s: then the first enrollment of the trainee (created_at, start date with a missing date last, catalog id), then FIAE',
    (table, alias) => {
      const enrollment = at(
        statements,
        new RegExp(
          `update\\s+public\\.${table}\\s+${alias}\\s+set\\s+training_catalog_id\\s*=\\s*coalesce`,
          'i'
        )
      );
      expect(enrollment).toBeGreaterThan(-1);
      expect(sql).toMatch(
        new RegExp(
          `where en\\.trainee_id = ${alias}\\.trainee_id\\s+order by en\\.created_at,\\s*coalesce\\(en\\.start_date, date '9999-12-31'\\),\\s*en\\.training_catalog_id::text\\s*limit 1`,
          'i'
        )
      );
      expect(sql).toMatch(
        new RegExp(
          `\\),\\s*'00000000-0000-4000-8000-000000000001'::uuid\\s*\\)\\s*where ${alias}\\.training_catalog_id is null`,
          'i'
        )
      );
    }
  );

  it('the learning field step of the exams runs before their enrollment step', () => {
    const field = at(statements, /fc\.catalogs\s*=\s*1/i);
    const enrollment = at(
      statements,
      /update\s+public\.school_exams\s+e\s+set\s+training_catalog_id\s*=\s*coalesce/i
    );
    expect(field).toBeGreaterThan(-1);
    expect(enrollment).toBeGreaterThan(field);
  });

  it('blocks have no learning field step (the table holds no hint to an occupation)', () => {
    expect(statements).not.toMatch(
      /update\s+public\.ausbildung_blocks[\s\S]*?training_catalog_learning_fields/i
    );
  });

  it('only touches rows that have no occupation yet (a corrected value is never overwritten)', () => {
    const updates = [
      ...(sql.match(/update public\.school_exams e[\s\S]*?;/gi) ?? []),
      ...(sql.match(/update public\.ausbildung_blocks b[\s\S]*?;/gi) ?? []),
    ];
    expect(updates).toHaveLength(3);
    for (const update of updates) {
      expect(update).toMatch(/\.training_catalog_id is null/i);
    }
  });
});

describe('school catalog migration: indexes and the check of the result', () => {
  it('creates one index per table on trainee and occupation', () => {
    for (const table of ['school_exams', 'ausbildung_blocks']) {
      expect(statements).toMatch(
        new RegExp(
          `create\\s+index\\s+if\\s+not\\s+exists\\s+${table}_trainee_catalog_idx\\s+on\\s+public\\.${table}\\s*\\(trainee_id,\\s*training_catalog_id\\)`,
          'i'
        )
      );
    }
  });

  it('checks the result at the end (column, key, index, no row without occupation)', () => {
    const tail = sql.slice(sql.lastIndexOf('declare'));
    expect(tail).toMatch(/a\.attnotnull/);
    expect(tail).toMatch(/a\.atthasdef/);
    expect(tail).toMatch(/contype = 'f'/);
    expect(tail).toMatch(/_trainee_catalog_idx/);
    expect(tail).toMatch(
      /from public\.school_exams where training_catalog_id is null/
    );
    expect(tail).toMatch(
      /from public\.ausbildung_blocks where training_catalog_id is null/
    );
    expect(tail).toMatch(/array\['school_exams', 'ausbildung_blocks'\]/);
  });
});

describe('school catalog migration: the rollout documents', () => {
  const checks = fs.readFileSync(
    path.join(process.cwd(), 'docs/kfbm-production-rollout-checks.sql'),
    'utf-8'
  );

  it('N01 lists the version and N02 checks both columns and both indexes', () => {
    expect(checks).toContain("('20261103000100')");
    for (const name of [
      'column school_exams.training_catalog_id',
      'column ausbildung_blocks.training_catalog_id',
      'index school_exams_trainee_catalog_idx',
      'index ausbildung_blocks_trainee_catalog_idx',
    ]) {
      expect(checks).toContain(name);
    }
  });
});
