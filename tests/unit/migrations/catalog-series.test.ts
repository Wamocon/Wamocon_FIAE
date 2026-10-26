/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  courses,
  enablers,
  organizationCatalogs,
  quizzes,
  traineeElectiveChoices,
  traineeEnrollments,
  trainingCatalogContentMappings,
  trainingCatalogLearningFields,
  trainingCatalogs,
  trainingComponents,
  useCases,
} from '@/db/migrations/schemas/schema';

/**
 * Static checks of the training catalog migration series
 * (supabase/migrations/20261024*, the gated 20261025000000 and the later files
 * 20261026* and 20261027*). They guard the conventions of the release pipeline; the SQL
 * itself is verified on a throwaway database.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const SERIES_PREFIXES = ['20261024', '20261025', '20261026', '20261027'];
const MAX_IDENTIFIER_LENGTH = 63;

const seriesFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter(name => SERIES_PREFIXES.some(p => name.startsWith(p)))
  .sort();

// Security hardening that travels with the same pull request and sorts behind the
// catalog series. It is held to one statement below.
const SECURITY_FILES = ['20261025000100_security_revoke_public_create.sql'];
// Follow-up files that sort behind the security files. They are checked by the
// per-file conventions below and in detail by their own test file.
const FOLLOW_UP_FILES = [
  '20261026000100_trainee_enrollments_one_per_trainee.sql',
  '20261027000100_hai_embeddings_scope.sql',
];
const catalogFiles = seriesFiles.filter(
  name => !SECURITY_FILES.includes(name) && !FOLLOW_UP_FILES.includes(name)
);

/** SQL without line comments (the files document themselves in comments). */
function readSql(fileName: string): string {
  return fs
    .readFileSync(path.join(MIGRATIONS_DIR, fileName), 'utf-8')
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
}

function identifiersOf(sql: string): string[] {
  const patterns = [
    /\bconstraint\s+([a-z_][a-z0-9_]*)/gi,
    /\bcreate\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
    /\bcreate\s+(?:constraint\s+)?trigger\s+([a-z_][a-z0-9_]*)/gi,
    /\bcreate\s+policy\s+([a-z_][a-z0-9_]*)/gi,
    /\bdrop\s+policy\s+(?:if\s+exists\s+)?([a-z_][a-z0-9_]*)/gi,
    /\bconname\s*=\s*'([a-z_][a-z0-9_]*)'/gi,
  ];
  const found: string[] = [];
  for (const pattern of patterns) {
    for (const match of sql.matchAll(pattern)) {
      found.push(match[1]);
    }
  }
  return found;
}

describe('catalog migration series files', () => {
  it('contains the expected number of files', () => {
    expect(seriesFiles.length).toBeGreaterThanOrEqual(16);
  });

  it('uses 14 digit versions in strictly increasing order', () => {
    const versions = seriesFiles.map(name => {
      expect(name).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
      return name.slice(0, 14);
    });
    expect(versions[0]).toBe('20261024000100');
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort()).toEqual(versions);
  });

  it('sorts every series file after all migrations of master (20261023*)', () => {
    const others = fs
      .readdirSync(MIGRATIONS_DIR)
      .filter(name => !SERIES_PREFIXES.some(p => name.startsWith(p)));
    const hardening = others.filter(name => name.startsWith('20261023'));
    // the security migrations of master are applied by hand in production and
    // must stay in front of the series (the CLI refuses older files)
    expect(hardening).toEqual([
      '20261023100000_security_lock_unused_tables.sql',
      '20261023100100_security_close_hai_policies.sql',
      '20261023100200_security_close_anonymous_content_reads.sql',
      '20261023200000_security_profiles_column_privileges.sql',
      '20261023300000_security_profiles_protect_columns.sql',
      '20261023300100_security_profiles_protect_columns_v2.sql',
    ]);
    const newest = hardening[hardening.length - 1];
    for (const file of seriesFiles) {
      expect(file > newest).toBe(true);
    }
  });

  it('keeps the SUPER_ADMIN backfill as the last file of the catalog series', () => {
    const last = catalogFiles[catalogFiles.length - 1];
    expect(last).toBe('20261025000000_super_admin_backfill.sql');
    expect(catalogFiles[catalogFiles.length - 2]).toBe(
      '20261024001500_user_role_super_admin_value.sql'
    );
  });

  it('puts the security files behind the backfill and keeps the revoke to one statement', () => {
    for (const file of SECURITY_FILES) {
      expect(seriesFiles).toContain(file);
      expect(file > '20261025000000_super_admin_backfill.sql').toBe(true);
    }
    expect(
      readSql('20261025000100_security_revoke_public_create.sql').trim()
    ).toBe('revoke create on schema public from public;');
  });

  it('puts the follow-up files behind the security files', () => {
    for (const file of FOLLOW_UP_FILES) {
      expect(seriesFiles).toContain(file);
      for (const security of SECURITY_FILES) {
        expect(file > security).toBe(true);
      }
    }
    expect(seriesFiles.slice(-FOLLOW_UP_FILES.length)).toEqual(FOLLOW_UP_FILES);
  });

  it('sorts the SUPER_ADMIN backfill after the PR 89 profile privileges', () => {
    const backfill = '20261025000000_super_admin_backfill.sql';
    const pr89 = '20261023200000_security_profiles_column_privileges.sql';
    expect(seriesFiles).toContain(backfill);
    expect(fs.existsSync(path.join(MIGRATIONS_DIR, pr89))).toBe(true);
    expect(backfill > pr89).toBe(true);
    // the old name must not exist any more
    expect(seriesFiles).not.toContain(
      '20261024001600_super_admin_backfill.sql'
    );
  });

  it('enforces the rollout gate of the SUPER_ADMIN backfill in SQL', () => {
    const raw = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261025000000_super_admin_backfill.sql'),
      'utf-8'
    );
    const sql = readSql('20261025000000_super_admin_backfill.sql');
    // gate 1: PR 89 privileges, gate 2: human approval token
    expect(sql).toMatch(/has_column_privilege\('authenticated'/);
    expect(sql).toMatch(/super_admin_backfill=approved/);
    expect(sql).toMatch(/raise exception/i);
    // the gate and the update are skipped for Preview
    expect(raw).toMatch(/^-- preview:skip$/m);
    expect(raw).toMatch(/^-- preview:end$/m);
    // the enum file checks PR 89 as well
    expect(readSql('20261024001500_user_role_super_admin_value.sql')).toMatch(
      /has_column_privilege\('authenticated'/
    );
  });

  it('sorts after the already applied production migration', () => {
    const applied = '202606260001_schema_only_ausbildung_duration.sql';
    expect(fs.existsSync(path.join(MIGRATIONS_DIR, applied))).toBe(true);
    expect(seriesFiles.every(name => name > applied)).toBe(true);
  });

  describe.each(seriesFiles)('%s', fileName => {
    const sql = readSql(fileName);

    it('has no explicit transaction control', () => {
      expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    });

    it('keeps the lock and statement timeouts', () => {
      // a single REVOKE of a schema privilege: no table lock, no long statement
      if (SECURITY_FILES.includes(fileName)) return;
      expect(sql).toMatch(/set\s+local\s+lock_timeout\s*=\s*'5s'/i);
      expect(sql).toMatch(/set\s+local\s+statement_timeout\s*=\s*'60s'/i);
    });

    it('installs no extensions, roles or publications', () => {
      expect(sql).not.toMatch(
        /\b(create|alter|drop)\s+(extension|role|user|publication)\b/i
      );
    });

    it('schema-qualifies tables, views and functions with public.', () => {
      const unqualified = [
        ...sql.matchAll(
          /\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:table|view|function)\s+(?:if\s+(?:not\s+)?exists\s+)?(?!public\.|if\s)([a-z_][a-z0-9_.]*)/gi
        ),
      ].map(match => match[1]);
      expect(unqualified).toEqual([]);
    });

    it('uses no catalog lookup that the Preview rewrite cannot place', () => {
      // information_schema / pg_policies lookups by the schema value 'public'
      // are error prone for the schema public_preview; the series uses
      // to_regclass('public.<table>') with pg_attribute / pg_policy instead.
      expect(sql).not.toMatch(/table_schema\s*=\s*'public'/i);
      expect(sql).not.toMatch(/schemaname\s*=\s*'public'/i);
      expect(sql).not.toMatch(/nspname\s*=\s*'public'/i);
      // a constraint lookup by name always carries its namespace
      for (const lookup of sql.matchAll(/where conname = '[^']+'[\s\S]*?;/g)) {
        expect(lookup[0]).toMatch(/connamespace/);
      }
    });

    it('keeps every identifier within the 63 character limit', () => {
      const tooLong = identifiersOf(sql).filter(
        name => name.length > MAX_IDENTIFIER_LENGTH
      );
      expect(tooLong).toEqual([]);
    });

    it('limits every policy to authenticated users (no public or anon reads)', () => {
      const policies = sql
        .split(/\bcreate\s+policy\b/i)
        .slice(1)
        .map(chunk => chunk.split(';')[0]);
      for (const policy of policies) {
        expect(policy).toMatch(/\bto\s+authenticated\b/i);
      }
    });

    it('does not use a new enum value in the file that adds it', () => {
      if (/\badd\s+value\b/i.test(sql)) {
        expect(sql).not.toMatch(
          /\b(insert\s+into|update\s+public|delete\s+from)\b/i
        );
      }
    });
  });

  it('keeps the enrollment and organization catalog tables read only for the API roles', () => {
    const files = [
      '20261024001000_organization_catalogs.sql',
      '20261024001100_trainee_enrollments.sql',
      '20261024001400_trainee_elective_choices.sql',
    ];
    for (const file of files) {
      const sql = readSql(file);
      // the revoke covers all write privileges for anon and authenticated
      expect(sql).toMatch(
        /revoke insert, update, delete, truncate, references, trigger on public\.\w+ from %I/
      );
      expect(sql).toMatch(/array\['anon', 'authenticated'\]/);
      // no policy that allows writing (FOR ALL, INSERT, UPDATE or DELETE)
      const policies = sql
        .split(/\bcreate\s+policy\b/i)
        .slice(1)
        .map(chunk => chunk.split(';')[0]);
      for (const policy of policies) {
        expect(policy).toMatch(/\bfor\s+select\b/i);
      }
    }
  });

  it('closes the legacy learning field tables for the API roles', () => {
    const sql = readSql('20261024000500_learning_field_model.sql');
    expect(sql).toMatch(/lernfelder_legacy/);
    expect(sql).toMatch(/drop policy %I on public\.%I/);
    expect(sql).toMatch(/revoke all on public\.%I from %I/);
    expect(sql).toMatch(/revoke all on public\.lernfelder from anon/);
  });

  it('binds catalog reads to active catalogs of the own organization', () => {
    const first = readSql('20261024000100_training_catalog_curriculum.sql');
    expect(first).not.toMatch(/for select to authenticated\s+using \(true\)/i);
    expect(first).toMatch(/is_active or public\.is_platform_owner\(\)/);
    const org = readSql('20261024001000_organization_catalogs.sql');
    expect(org).toMatch(/function public\.can_read_training_catalog/);
    expect(org).toMatch(/security definer\s+set search_path = ''/i);
    expect(org).toMatch(/oc\.organization_id = public\.get_user_org_id\(\)/);
    for (const table of [
      'training_catalogs',
      'training_catalog_learning_fields',
      'training_catalog_content_mappings',
    ]) {
      expect(org).toMatch(
        new RegExp(
          `create policy ${table}_select_authenticated[\\s\\S]*?can_read_training_catalog`
        )
      );
    }
  });

  it('guards the catalog tables against TRUNCATE and the functions against anon', () => {
    const first = readSql('20261024000100_training_catalog_curriculum.sql');
    expect(first).toMatch(
      /revoke truncate, references, trigger on public\.%I from authenticated/
    );
    for (const table of [
      'training_catalogs',
      'training_catalog_learning_fields',
      'training_catalog_content_mappings',
    ]) {
      expect(first).toContain(`'${table}'`);
    }
    // derivation triggers run as definer with a fixed search_path
    const keys = readSql('20261024000300_catalog_consistency_keys.sql');
    expect(
      keys.match(/security definer\s+set search_path = ''/gi)
    ).toHaveLength(2);
    // every file that defines functions also revokes EXECUTE from anon
    for (const file of [
      '20261024000300_catalog_consistency_keys.sql',
      '20261024000500_learning_field_model.sql',
      '20261024001000_organization_catalogs.sql',
      '20261024001400_trainee_elective_choices.sql',
    ]) {
      expect(readSql(file)).toMatch(/revoke execute on function %s from anon/);
    }
  });

  it('keeps the elective limit when the rules change', () => {
    const sql = readSql('20261024001400_trainee_elective_choices.sql');
    expect(sql).toMatch(/after update of elective_pick_count/);
    expect(sql).toMatch(/before update of kind/);
    // precheck for the columns of 20261024001300 and 20261024000900
    expect(sql).toMatch(/attname = 'kind'/);
    expect(sql).toMatch(/attname = 'elective_pick_count'/);
  });

  it('adds enum values only in their own file', () => {
    const filesWithAddValue = seriesFiles.filter(name =>
      /\badd\s+value\b/i.test(readSql(name))
    );
    expect(filesWithAddValue).toEqual([
      '20261024001500_user_role_super_admin_value.sql',
    ]);
  });
});

describe('Drizzle schema names of the catalog tables', () => {
  const tables = [
    trainingCatalogs,
    trainingCatalogLearningFields,
    trainingCatalogContentMappings,
    organizationCatalogs,
    traineeEnrollments,
    traineeElectiveChoices,
    courses,
    enablers,
    useCases,
    quizzes,
    trainingComponents,
  ];

  it('declares the use case enabler link with the migration names', () => {
    const config = getTableConfig(useCases);
    expect(config.uniqueConstraints.map(unique => unique.name)).toContain(
      'use_cases_enabler_id_unique'
    );
    expect(
      config.foreignKeys.map(foreignKey => foreignKey.getName())
    ).toContain('use_cases_enabler_course_fk');
  });

  it('keeps constraint and index names within 63 characters', () => {
    const tooLong: string[] = [];
    for (const table of tables) {
      const config = getTableConfig(table);
      const names = [
        ...config.foreignKeys.map(foreignKey => foreignKey.getName()),
        ...config.uniqueConstraints.map(unique => unique.name ?? ''),
        ...config.checks.map(check => check.name),
        ...config.indexes.map(index => index.config.name ?? ''),
        ...config.primaryKeys.map(primaryKey => primaryKey.getName()),
      ];
      for (const name of names) {
        if (name.length > MAX_IDENTIFIER_LENGTH) {
          tooLong.push(`${config.name}: ${name}`);
        }
      }
    }
    expect(tooLong).toEqual([]);
  });
});
