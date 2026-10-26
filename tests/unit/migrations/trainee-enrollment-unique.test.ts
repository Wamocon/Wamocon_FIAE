/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { traineeEnrollments } from '@/db/migrations/schemas/schema';

/**
 * Static checks of 20261026000100_trainee_enrollments_one_per_trainee.sql.
 * The file adds a unique index so that a trainee has at most one enrollment
 * (one occupation). The SQL itself was run against a local database inside a
 * rolled back transaction; these tests guard the conventions of the release
 * pipeline and the shape of the change.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const FILE = '20261026000100_trainee_enrollments_one_per_trainee.sql';
const INDEX = 'trainee_enrollments_trainee_unique';

const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, FILE), 'utf-8');
/** SQL without line comments (the file documents itself in comments). */
const sql = raw
  .split(/\r?\n/)
  .filter(line => !line.trim().startsWith('--'))
  .join('\n');
/** SQL without comments and with string literals blanked: statements only. */
const statements = sql.replace(/'(?:[^']|'')*'/g, "''");

const allFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter(name => name.endsWith('.sql'))
  .sort();

describe('trainee enrollment unique index migration: place in the series', () => {
  it('has a 14 digit version and a lowercase name', () => {
    expect(FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it('sorts behind the enrollment table, the backfill and the security file', () => {
    const behind = [
      '20261024001100_trainee_enrollments.sql',
      '20261024001200_trainee_enrollments_backfill.sql',
      '20261024001400_trainee_elective_choices.sql',
      '20261025000000_super_admin_backfill.sql',
      '20261025000100_security_revoke_public_create.sql',
    ];
    for (const earlier of behind) {
      expect(allFiles).toContain(earlier);
      expect(FILE > earlier).toBe(true);
    }
  });

  it('is part of the series and comes after the security file', () => {
    // not "the newest": the next migration must not break this test
    expect(allFiles).toContain(FILE);
    expect(allFiles.indexOf(FILE)).toBeGreaterThan(
      allFiles.indexOf('20261025000100_security_revoke_public_create.sql')
    );
  });
});

describe('trainee enrollment unique index migration: conventions', () => {
  it('has no explicit transaction control', () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it('keeps the lock and statement timeouts of the series', () => {
    expect(sql).toMatch(/set\s+local\s+lock_timeout\s*=\s*'5s'/i);
    expect(sql).toMatch(/set\s+local\s+statement_timeout\s*=\s*'60s'/i);
  });

  it('installs no extensions, roles or publications', () => {
    expect(sql).not.toMatch(
      /\b(create|alter|drop)\s+(extension|role|user|publication)\b/i
    );
  });

  it('qualifies the table with public.', () => {
    const tables = [
      ...statements.matchAll(/\b(?:from|on|table)\s+(public\.)?(\w+)/gi),
    ].filter(match => match[2] === 'trainee_enrollments');
    expect(tables.length).toBeGreaterThan(0);
    for (const match of tables) {
      expect(match[1]).toBe('public.');
    }
    // the catalog lookup carries its schema as well
    expect(sql).toMatch(/to_regclass\('public\.trainee_enrollments'\)/);
  });

  it('documents what it does and why in the header', () => {
    const header = raw
      .split(/\r?\n/)
      .filter(line => line.startsWith('--'))
      .join('\n');
    expect(header).toMatch(/one enrollment per trainee/i);
    expect(header).toMatch(/setTraineeEnrollment/);
    expect(header).toMatch(/precheck/i);
    expect(header).toMatch(/concurrently/i);
    expect(header).toMatch(/undo/i);
  });
});

describe('trainee enrollment unique index migration: precheck', () => {
  it('aborts with an exception that names the number of trainees', () => {
    const precheck = /do\s+\$\$[\s\S]*?\$\$\s*;/i.exec(sql);
    expect(precheck).not.toBeNull();
    expect(precheck![0]).toMatch(
      /group by trainee_id\s+having count\(\*\) > 1/i
    );
    expect(precheck![0]).toMatch(/raise exception/i);
    expect(precheck![0]).toMatch(/affected/);
    expect(precheck![0]).toMatch(/Nothing was changed/);
  });

  it('runs before the index is created', () => {
    expect(sql.search(/raise exception/i)).toBeLessThan(
      sql.search(/create unique index/i)
    );
  });

  it('checks that the table exists before it counts', () => {
    expect(
      sql.search(/to_regclass\('public\.trainee_enrollments'\)/)
    ).toBeLessThan(sql.search(/having count/i));
  });
});

describe('trainee enrollment unique index migration: the index', () => {
  it('creates the unique index on trainee_id alone, idempotently', () => {
    expect(statements).toMatch(
      new RegExp(
        `create unique index if not exists ${INDEX}\\s+on public\\.trainee_enrollments\\s*\\(trainee_id\\)\\s*;`,
        'i'
      )
    );
    expect(INDEX.length).toBeLessThanOrEqual(63);
  });

  it('is not partial and not concurrent', () => {
    // CONCURRENTLY cannot run inside a transaction block, and every file of
    // the series runs in one (the Preview applier wraps it in a DO block).
    expect(statements).not.toMatch(/\bconcurrently\b/i);
    const create = /create unique index[^;]*;/i.exec(statements);
    expect(create![0]).not.toMatch(/\bwhere\b/i);
  });

  it('creates exactly one index', () => {
    expect(statements.match(/create\s+(unique\s+)?index/gi)).toHaveLength(1);
  });
});

describe('trainee enrollment unique index migration: no data is changed', () => {
  it('has no statement that changes rows or drops anything', () => {
    expect(statements).not.toMatch(
      /\b(insert|update|delete|truncate|merge|copy)\b/i
    );
    expect(statements).not.toMatch(/\bdrop\b/i);
    expect(statements).not.toMatch(/\balter\s+table\b/i);
  });

  it('leaves the existing unique constraints in place', () => {
    const table = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261024001100_trainee_enrollments.sql'),
      'utf-8'
    );
    expect(table).toMatch(/trainee_enrollments_trainee_catalog_unique/);
    expect(table).toMatch(/trainee_enrollments_id_catalog_unique/);
    // the composite foreign key of the elective choices still has its target
    const choices = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261024001400_trainee_elective_choices.sql'),
      'utf-8'
    );
    expect(choices).toMatch(
      /references public\.trainee_enrollments \(id, training_catalog_id\)/
    );
    expect(statements).not.toMatch(
      /trainee_enrollments_trainee_catalog_unique/
    );
    expect(statements).not.toMatch(/trainee_enrollments_id_catalog_unique/);
  });
});

describe('Drizzle schema of trainee_enrollments', () => {
  const config = getTableConfig(traineeEnrollments);

  it('declares the unique index with the name of the migration', () => {
    const index = config.indexes.find(i => i.config.name === INDEX);
    expect(index).toBeDefined();
    expect(index!.config.unique).toBe(true);
    expect(
      index!.config.columns.map(column => (column as { name: string }).name)
    ).toEqual(['trainee_id']);
    expect(index!.config.where).toBeUndefined();
  });

  it('keeps the two unique constraints', () => {
    expect(config.uniqueConstraints.map(unique => unique.name)).toEqual(
      expect.arrayContaining([
        'trainee_enrollments_trainee_catalog_unique',
        'trainee_enrollments_id_catalog_unique',
      ])
    );
  });
});
