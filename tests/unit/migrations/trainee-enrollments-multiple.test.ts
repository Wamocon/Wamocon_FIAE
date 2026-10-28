/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { traineeEnrollments } from '@/db/migrations/schemas/schema';

/**
 * Static checks of 20261030000300_trainee_enrollments_multiple.sql and of its
 * rollback template. The file drops the unique index on trainee_enrollments
 * (trainee_id), so a trainee can be enrolled in several trainings. The SQL
 * itself was run against a local throwaway database (twice, behavior probes,
 * rollback template); these tests guard the conventions of the release
 * pipeline and the shape of the change.
 */

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const FILE = '20261030000300_trainee_enrollments_multiple.sql';
const OLD_FILE = '20261026000100_trainee_enrollments_one_per_trainee.sql';
const ROLLBACK = path.join(
  ROOT,
  'supabase',
  'manual',
  'rollback-trainee-enrollments-multiple.sql'
);
const INDEX = 'trainee_enrollments_trainee_unique';

const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, FILE), 'utf-8');
const rollbackRaw = fs.readFileSync(ROLLBACK, 'utf-8');

function withoutComments(text: string): string {
  return text
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
}
/** SQL without comments and with string literals blanked: statements only. */
function statementsOf(text: string): string {
  return withoutComments(text).replace(/'(?:[^']|'')*'/g, "''");
}

const sql = withoutComments(raw);
const statements = statementsOf(raw);

const allFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter(name => name.endsWith('.sql'))
  .sort();

describe('trainee enrollments multiple migration: place in the series', () => {
  it('has a 14 digit version and a lowercase name', () => {
    expect(FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it('sorts behind the file that created the index and behind the upload files', () => {
    expect(allFiles).toContain(OLD_FILE);
    expect(allFiles).toContain(FILE);
    expect(FILE > OLD_FILE).toBe(true);
    expect(FILE > '20261030000200_content_upload_json_xlsx.sql').toBe(true);
  });

  it('is the only file of this version', () => {
    expect(allFiles.filter(name => name.startsWith('20261030000300'))).toEqual([
      FILE,
    ]);
  });
});

describe('trainee enrollments multiple migration: conventions', () => {
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

  it('is additive: no table, column or row is dropped, deleted or changed', () => {
    expect(statements).not.toMatch(/\bdrop\s+(table|column|schema|trigger)\b/i);
    expect(statements).not.toMatch(/\bdrop\s+constraint\b/i);
    expect(statements).not.toMatch(/\balter\s+table\b/i);
    expect(statements).not.toMatch(
      /\b(delete\s+from|truncate|update|insert)\b/i
    );
  });

  it('qualifies the objects with public.', () => {
    // every use of the table or of its index in a statement names the schema
    expect(statements).toMatch(/public\.trainee_enrollments\b/);
    expect(statements).not.toMatch(
      /(?<!public\.)\btrainee_enrollments(?:_trainee_unique)?\b(?!_)/
    );
    expect(sql).toMatch(/to_regclass\('public\.trainee_enrollments'\)/);
  });

  it('documents what it does and why in the header', () => {
    const header = raw
      .split(/\r?\n/)
      .filter(line => line.startsWith('--'))
      .join('\n');
    expect(header).toMatch(/several enrollments/i);
    expect(header).toMatch(/addTraineeEnrollment/);
    expect(header).toMatch(/removeTraineeEnrollment/);
    expect(header).toMatch(/safe to run twice/i);
    expect(header).toMatch(/undo/i);
    expect(header).toMatch(/rollback-trainee-enrollments-multiple\.sql/);
    expect(header).toMatch(/rollout gate/i);
  });
});

describe('trainee enrollments multiple migration: pre check', () => {
  const precheck = /do\s+\$\$[\s\S]*?\$\$\s*;/i.exec(sql);

  it('stops if the table or a constraint that has to stay is missing', () => {
    expect(precheck).not.toBeNull();
    expect(precheck![0]).toMatch(
      /to_regclass\('public\.trainee_enrollments'\)/
    );
    expect(precheck![0]).toMatch(/trainee_enrollments_trainee_catalog_unique/);
    expect(precheck![0]).toMatch(/trainee_enrollments_id_catalog_unique/);
    expect(precheck![0].match(/raise exception/gi)).toHaveLength(3);
  });

  it('runs before the index is dropped', () => {
    expect(sql.search(/raise exception/i)).toBeLessThan(
      sql.search(/drop index/i)
    );
  });
});

describe('trainee enrollments multiple migration: the index', () => {
  it('drops the unique index on trainee_id, idempotently', () => {
    expect(statements).toMatch(
      new RegExp(`drop index if exists public\\.${INDEX}\\s*;`, 'i')
    );
  });

  it('drops exactly one object and creates no index', () => {
    expect(statements.match(/\bdrop\s+index\b/gi)).toHaveLength(1);
    expect(statements).not.toMatch(/\bcreate\s+(unique\s+)?index\b/i);
  });

  it('checks the result: index gone, catalog uniqueness and triggers stay', () => {
    const post = sql.slice(sql.search(/comment on table/i));
    expect(post).toMatch(
      new RegExp(`to_regclass\\('public\\.${INDEX}'\\) is not null`)
    );
    // the columns are compared, not the text of the definition
    expect(post).toMatch(/array\['trainee_id', 'training_catalog_id'\]/);
    expect(post).not.toMatch(/pg_get_constraintdef/);
    expect(post).toMatch(/trainee_elective_choices_set_catalog/);
    expect(post).toMatch(/trainee_elective_choices_limit/);
  });

  it('updates the table comment that said "exactly one"', () => {
    expect(statements).toMatch(
      /comment on table public\.trainee_enrollments is\s+''\s*;/i
    );
    expect(sql).toMatch(/A trainee can have several, one per catalog/);
    expect(sql).not.toMatch(/exactly one training catalog/);
  });
});

describe('trainee enrollments multiple migration: the schema file', () => {
  const config = getTableConfig(traineeEnrollments);

  it('no longer declares the unique index on trainee_id', () => {
    expect(config.indexes.map(i => i.config.name)).not.toContain(INDEX);
  });

  it('keeps the unique constraints per trainee and catalog and per id and catalog', () => {
    const names = config.uniqueConstraints.map(u => u.name);
    expect(names).toContain('trainee_enrollments_trainee_catalog_unique');
    expect(names).toContain('trainee_enrollments_id_catalog_unique');
    const perCatalog = config.uniqueConstraints.find(
      u => u.name === 'trainee_enrollments_trainee_catalog_unique'
    );
    expect(perCatalog?.columns.map(c => c.name)).toEqual([
      'trainee_id',
      'training_catalog_id',
    ]);
  });
});

describe('trainee enrollments multiple migration: rollback template', () => {
  const rollbackSql = withoutComments(rollbackRaw);
  const rollbackStatements = statementsOf(rollbackRaw);

  it('runs in one transaction that the human commits', () => {
    expect(rollbackSql).toMatch(/^begin;/im);
    expect(rollbackSql).toMatch(/^commit;/im);
    expect(rollbackSql).toMatch(/set\s+local\s+lock_timeout\s*=\s*'5s'/i);
  });

  it('recreates the plain unique index of the earlier file', () => {
    expect(rollbackStatements).toMatch(
      new RegExp(
        `create unique index if not exists ${INDEX}\\s+on public\\.trainee_enrollments\\s*\\(trainee_id\\)\\s*;`,
        'i'
      )
    );
    expect(rollbackStatements).not.toMatch(/\bconcurrently\b/i);
  });

  it('refuses to run while a trainee has more than one enrollment', () => {
    const check = rollbackSql.slice(
      0,
      rollbackSql.search(/create unique index/i)
    );
    expect(check).toMatch(/group by trainee_id\s+having count\(\*\) > 1/i);
    expect(check).toMatch(/raise exception/i);
    expect(check).toMatch(/Nothing was changed/);
  });

  it('never deletes a row', () => {
    expect(rollbackStatements).not.toMatch(
      /\b(delete\s+from|truncate|drop\s+table|update)\b/i
    );
  });

  it('is explained in the header', () => {
    const header = rollbackRaw
      .split(/\r?\n/)
      .filter(line => line.startsWith('--'))
      .join('\n');
    expect(header).toMatch(/20261030000300_trainee_enrollments_multiple\.sql/);
    expect(header).toMatch(/RUN BY A HUMAN/);
    expect(header).toMatch(/as a try/i);
    expect(header).toMatch(/never deletes a row|does not delete/i);
  });
});
