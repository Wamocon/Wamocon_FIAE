/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  weeklyEvaluations,
  TRAINING_CATALOG_IDS,
} from '@/db/migrations/schemas/schema';

/**
 * Static checks of 20261102000400_weekly_evaluations_catalog.sql: a weekly
 * evaluation belongs to one occupation. The conventions of the release
 * pipeline, the order of the backfill (the linked activity report, then the
 * first enrollment, then FIAE), NOT NULL only after the backfill, the index,
 * the replacement of an old uniqueness per week and the match with the Drizzle
 * schema. The SQL is not run here, the Preview migration of the pull request
 * runs it.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const FILE = '20261102000400_weekly_evaluations_catalog.sql';
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

describe('weekly evaluations catalog migration: place in the series', () => {
  it('has a 14 digit version, a lowercase name and is the only file of its version', () => {
    expect(FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(allFiles.filter(name => name.startsWith('20261102000400'))).toEqual([
      FILE,
    ]);
  });

  it('sorts behind the activity reports catalog (it needs that column) and behind the rollout gate (GATED_TO)', () => {
    expect(FILE > '20261102000300_activity_reports_catalog.sql').toBe(true);
    // scripts/db/rollout-gate.mjs holds back 20261024000100 to 20261030000300
    expect(FILE.slice(0, 14) > '20261030000300').toBe(true);
  });
});

describe('weekly evaluations catalog migration: conventions', () => {
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
        /\b(?:from|join|update|table|on|references|exists)\s+(public\.)?(weekly_evaluations|activity_reports|training_catalogs|trainee_enrollments)\b/gi
      ),
    ];
    expect(tables.length).toBeGreaterThan(8);
    for (const match of tables) expect(match[1]).toBe('public.');
  });

  it('changes no other table than weekly_evaluations', () => {
    expect(statements).not.toMatch(
      /\balter\s+table\s+(?!public\.weekly_evaluations\b)/i
    );
    expect(statements).not.toMatch(
      /\bupdate\s+(?!public\.weekly_evaluations\b)/i
    );
    expect(statements).not.toMatch(/\binsert\s+into\b/i);
  });

  it('names its purpose, the undo and the effect on Production in the header', () => {
    expect(header).toMatch(/belong to one occupation/i);
    expect(header).toMatch(/Undo/);
    expect(header).toMatch(/drop column if exists training_catalog_id/i);
    expect(header).toMatch(/Safe to run twice/i);
    expect(header).toMatch(/three trainees today, all in FIAE/i);
    // the way back for the old uniqueness is written down with its name
    expect(header).toMatch(
      /add constraint unique_trainee_week_year unique \(trainee_id, week_number, year\)/i
    );
  });

  it('is safe to run twice', () => {
    expect(statements).toMatch(
      /add\s+column\s+if\s+not\s+exists\s+training_catalog_id\s+uuid\s*;/i
    );
    expect(statements).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+weekly_evaluations_trainee_catalog_week_idx/i
    );
    // the key is guarded by a lookup in pg_constraint
    expect(sql).toMatch(
      /if not exists \([\s\S]*?conname = 'weekly_evaluations_training_catalog_id_training_catalogs_id_fk'/i
    );
  });
});

describe('weekly evaluations catalog migration: the column', () => {
  it('stops with a clear message if a table, the report column or the FIAE row is missing, before anything changes', () => {
    const precheck = at(
      sql,
      /to_regclass\('public\.weekly_evaluations'\) is null/i
    );
    const addColumn = at(statements, /add\s+column/i);
    expect(precheck).toBeGreaterThan(-1);
    expect(precheck).toBeLessThan(addColumn);
    expect(sql).toMatch(/raise exception[\s\S]*Nothing was changed/i);
    expect(sql).toContain(FIAE);
    // the backfill reads the occupation of the report: its column has to exist
    expect(sql).toMatch(
      /a\.attrelid = 'public\.activity_reports'::regclass\s+and a\.attname = 'training_catalog_id'/i
    );
    expect(sql).toMatch(/apply 20261102000300 first/);
  });

  it('adds a nullable uuid column with a foreign key to training_catalogs (restrict)', () => {
    expect(statements).toMatch(
      /alter\s+table\s+public\.weekly_evaluations\s+add\s+column\s+if\s+not\s+exists\s+training_catalog_id\s+uuid\s*;/i
    );
    expect(statements).toMatch(
      /foreign\s+key\s*\(training_catalog_id\)\s*references\s+public\.training_catalogs\s*\(id\)\s*on\s+delete\s+restrict/i
    );
  });

  it('sets the default FIAE and NOT NULL, and only after the backfill', () => {
    const backfill = at(
      statements,
      /update\s+public\.weekly_evaluations\s+w\s+set\s+training_catalog_id\s*=\s*coalesce/i
    );
    const defaultAndNotNull = at(
      statements,
      /alter\s+column\s+training_catalog_id\s+set\s+default/i
    );
    expect(backfill).toBeGreaterThan(-1);
    expect(defaultAndNotNull).toBeGreaterThan(backfill);
    expect(sql).toMatch(
      /alter column training_catalog_id set default '00000000-0000-4000-8000-000000000001',\s*alter column training_catalog_id set not null/i
    );
  });

  it('matches the Drizzle schema: not null, default FIAE, key to training_catalogs, index and uniqueness per occupation', () => {
    const config = getTableConfig(weeklyEvaluations);
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
      i => i.config.name === 'weekly_evaluations_trainee_catalog_week_idx'
    );
    expect(index).toBeDefined();
    expect(
      index!.config.columns.map(c => (c as { name: string }).name)
    ).toEqual(['trainee_id', 'training_catalog_id', 'year', 'week_number']);

    const unique = config.uniqueConstraints.find(
      u => u.name === 'weekly_evaluations_trainee_catalog_week_unique'
    );
    expect(unique).toBeDefined();
    expect(unique!.columns.map(c => c.name)).toEqual([
      'trainee_id',
      'training_catalog_id',
      'year',
      'week_number',
    ]);
    // the old uniqueness per trainee, week and year is gone from the schema
    expect(
      config.uniqueConstraints.filter(
        u =>
          u.columns.length === 3 &&
          u.columns.every(c =>
            ['trainee_id', 'week_number', 'year'].includes(c.name)
          )
      )
    ).toHaveLength(0);
  });
});

describe('weekly evaluations catalog migration: the backfill', () => {
  it('first takes the occupation of the linked activity report', () => {
    expect(statements).toMatch(
      /update\s+public\.weekly_evaluations\s+w\s+set\s+training_catalog_id\s*=\s*r\.training_catalog_id\s+from\s+public\.activity_reports\s+r\s+where\s+r\.id\s*=\s*w\.activity_report_id\s+and\s+r\.training_catalog_id\s+is\s+not\s+null\s+and\s+w\.training_catalog_id\s+is\s+null/i
    );
  });

  it('then takes the first enrollment of the trainee (created_at, start date with a missing date last, catalog id), then FIAE', () => {
    const report = at(statements, /r\.id\s*=\s*w\.activity_report_id/i);
    const enrollment = at(
      statements,
      /from\s+public\.trainee_enrollments\s+en/i
    );
    expect(report).toBeGreaterThan(-1);
    expect(enrollment).toBeGreaterThan(report);
    expect(sql).toMatch(
      /order by en\.created_at,\s*coalesce\(en\.start_date, date '9999-12-31'\),\s*en\.training_catalog_id::text\s*limit 1/i
    );
    expect(sql).toMatch(
      /\),\s*'00000000-0000-4000-8000-000000000001'::uuid\s*\)\s*where w\.training_catalog_id is null/i
    );
  });

  it('only touches rows that have no occupation yet (a corrected value is never overwritten)', () => {
    const updates =
      sql.match(/update public\.weekly_evaluations w[\s\S]*?;/gi) ?? [];
    expect(updates).toHaveLength(2);
    for (const update of updates) {
      expect(update).toMatch(/w\.training_catalog_id is null/i);
    }
  });
});

describe('weekly evaluations catalog migration: index and uniqueness', () => {
  it('creates the index on trainee, occupation, year and week', () => {
    expect(statements).toMatch(
      /create\s+index\s+if\s+not\s+exists\s+weekly_evaluations_trainee_catalog_week_idx\s+on\s+public\.weekly_evaluations\s*\(trainee_id,\s*training_catalog_id,\s*year,\s*week_number\)/i
    );
  });

  it('finds an old uniqueness per trainee, week and year by its columns, whatever its name', () => {
    expect(sql).toMatch(/c\.contype = 'u'/);
    expect(sql).toMatch(/= array\['trainee_id', 'week_number', 'year'\]/);
    // a unique constraint, and a unique index that no constraint backs
    expect(sql).toMatch(/i\.indisunique/);
    expect(sql).toMatch(/drop constraint %I/);
    expect(sql).toMatch(/drop index public\.%I/);
  });

  it('replaces it by a uniqueness per trainee, occupation, year and week, only if one existed', () => {
    expect(sql).toMatch(
      /if replaced and not exists[\s\S]*?add constraint weekly_evaluations_trainee_catalog_week_unique\s+unique \(trainee_id, training_catalog_id, year, week_number\)/i
    );
  });

  it('checks the result at the end (column, key, index, no evaluation without occupation)', () => {
    const tail = sql.slice(sql.lastIndexOf('declare'));
    expect(tail).toMatch(/a\.attnotnull/);
    expect(tail).toMatch(/a\.atthasdef/);
    expect(tail).toMatch(/contype = 'f'/);
    expect(tail).toMatch(
      /to_regclass\('public\.weekly_evaluations_trainee_catalog_week_idx'\)/
    );
    expect(tail).toMatch(/where training_catalog_id is null/);
  });
});
