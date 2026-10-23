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
 * (supabase/migrations/20261020* and the gated 20261024000000). They guard the
 * conventions of the release pipeline; the SQL itself is verified on a
 * throwaway database.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const SERIES_PREFIXES = ['20261020', '20261024'];
const MAX_IDENTIFIER_LENGTH = 63;

const seriesFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter(name => SERIES_PREFIXES.some(p => name.startsWith(p)))
  .sort();

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
    expect(versions[0]).toBe('20261020000100');
    expect(new Set(versions).size).toBe(versions.length);
    expect([...versions].sort()).toEqual(versions);
  });

  it('sorts the SUPER_ADMIN backfill after the PR 89 profile privileges', () => {
    const backfill = '20261024000000_super_admin_backfill.sql';
    const pr89 = '20261023200000_security_profiles_column_privileges.sql';
    expect(seriesFiles).toContain(backfill);
    expect(fs.existsSync(path.join(MIGRATIONS_DIR, pr89))).toBe(true);
    expect(backfill > pr89).toBe(true);
    // the old name must not exist any more
    expect(seriesFiles).not.toContain(
      '20261020001600_super_admin_backfill.sql'
    );
  });

  it('enforces the rollout gate of the SUPER_ADMIN backfill in SQL', () => {
    const raw = fs.readFileSync(
      path.join(MIGRATIONS_DIR, '20261024000000_super_admin_backfill.sql'),
      'utf-8'
    );
    const sql = readSql('20261024000000_super_admin_backfill.sql');
    // gate 1: PR 89 privileges, gate 2: human approval token
    expect(sql).toMatch(/has_column_privilege\('authenticated'/);
    expect(sql).toMatch(/super_admin_backfill=approved/);
    expect(sql).toMatch(/raise exception/i);
    // the gate and the update are skipped for Preview
    expect(raw).toMatch(/^-- preview:skip$/m);
    expect(raw).toMatch(/^-- preview:end$/m);
    // the enum file checks PR 89 as well
    expect(readSql('20261020001500_user_role_super_admin_value.sql')).toMatch(
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
      '20261020001000_organization_catalogs.sql',
      '20261020001100_trainee_enrollments.sql',
      '20261020001400_trainee_elective_choices.sql',
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
    const sql = readSql('20261020000500_learning_field_model.sql');
    expect(sql).toMatch(/lernfelder_legacy/);
    expect(sql).toMatch(/drop policy %I on public\.%I/);
    expect(sql).toMatch(/revoke all on public\.%I from %I/);
    expect(sql).toMatch(/revoke all on public\.lernfelder from anon/);
  });

  it('binds catalog reads to active catalogs of the own organization', () => {
    const first = readSql('20261020000100_training_catalog_curriculum.sql');
    expect(first).not.toMatch(/for select to authenticated\s+using \(true\)/i);
    expect(first).toMatch(/is_active or public\.is_platform_owner\(\)/);
    const org = readSql('20261020001000_organization_catalogs.sql');
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

  it('adds enum values only in their own file', () => {
    const filesWithAddValue = seriesFiles.filter(name =>
      /\badd\s+value\b/i.test(readSql(name))
    );
    expect(filesWithAddValue).toEqual([
      '20261020001500_user_role_super_admin_value.sql',
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
