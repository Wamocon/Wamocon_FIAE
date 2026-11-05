/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import {
  HAI_USER_MEMORY_KINDS,
  HAI_USER_MEMORY_SOURCES,
  haiGlobalMemories,
  haiUserMemories,
  haiUserMemorySettings,
} from '@/db/migrations/schemas/schema';

/**
 * Static checks of 20261103000300_hai_memory.sql: the three tables of the HAI
 * memory. The conventions of the release pipeline, the access rules (only the own
 * user for the entries of a user, no policy for trainers or admins, nothing
 * granted to the API roles), the cascade on the account and the match with the
 * Drizzle schema. The SQL itself is run on a throwaway database by the release.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const FILE = '20261103000300_hai_memory.sql';

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

/** The text of one CREATE TABLE statement. */
function tableSql(name: string, source = sql): string {
  const start = source.search(
    new RegExp(`create table if not exists public\\.${name}\\s*\\(`, 'i')
  );
  expect(start).toBeGreaterThan(-1);
  const end = source.indexOf(');', start);
  return source.slice(start, end);
}

describe('hai memory migration: place in the series', () => {
  it('has a 14 digit version and sorts behind the older migrations', () => {
    expect(FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(allFiles).toContain(FILE);
    expect(
      allFiles.slice(0, allFiles.indexOf(FILE)).every(name => name < FILE)
    ).toBe(true);
    // behind the migration it follows in the series and behind the gate
    expect(FILE > '20261103000200_content_documents_sha256.sql').toBe(true);
    expect(FILE > '20261030000300').toBe(true);
  });
});

describe('hai memory migration: conventions', () => {
  it('has no explicit transaction control and keeps the timeouts of the series', () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(sql).toMatch(/set\s+local\s+lock_timeout\s*=\s*'5s'/i);
    expect(sql).toMatch(/set\s+local\s+statement_timeout\s*=\s*'60s'/i);
  });

  it('installs no extensions, roles or publications and changes no existing table', () => {
    expect(sql).not.toMatch(
      /\b(create|alter|drop)\s+(extension|role|user|publication)\b/i
    );
    expect(statements.match(/create\s+table/gi)).toHaveLength(3);
    expect(statements).not.toMatch(
      /\balter\s+table\s+(?!public\.hai_(user_memories|global_memories|user_memory_settings)\b)/i
    );
    expect(statements).not.toMatch(
      /\b(insert\s+into|update\s+public|delete\s+from|truncate|drop\s+table)\b/i
    );
  });

  it('qualifies every table with public. (the preview run rewrites it)', () => {
    const tables = [
      ...statements.matchAll(
        /\b(?:from|on|table|exists|references)\s+(public\.)?(hai_user_memories|hai_global_memories|hai_user_memory_settings|profiles|training_catalogs)\b/gi
      ),
    ];
    expect(tables.length).toBeGreaterThan(8);
    for (const match of tables) expect(match[1]).toBe('public.');
  });

  it('is safe to run twice and documents what, why, the access and the undo', () => {
    for (const table of [
      'hai_user_memories',
      'hai_global_memories',
      'hai_user_memory_settings',
    ]) {
      expect(statements).toMatch(
        new RegExp(`create table if not exists public\\.${table}\\s*\\(`, 'i')
      );
    }
    expect(
      statements.match(/create (unique )?index if not exists/gi)!.length
    ).toBeGreaterThanOrEqual(4);
    expect(header).toMatch(/Safe to run twice/i);
    expect(header).toMatch(/HAI_MEMORY/);
    expect(header).toMatch(/ONLY the user sees/);
    expect(header).toMatch(/NO policy for trainers or admins/);
    expect(header).toMatch(/cascade/i);
    expect(header).toMatch(/undo/i);
    expect(header).toMatch(/Production is not migrated/i);
  });
});

describe('hai memory migration: the memory of one user', () => {
  const table = tableSql('hai_user_memories');

  it('belongs to a user (cascade on the account) and to an occupation (cascade on the catalog)', () => {
    expect(table).toMatch(
      /user_id uuid not null references public\.profiles \(id\) on delete cascade/i
    );
    expect(table).toMatch(
      /training_catalog_id uuid not null references public\.training_catalogs \(id\) on delete cascade/i
    );
  });

  it('has the columns, the value lists and the limits', () => {
    for (const column of [
      'id uuid primary key default gen_random_uuid()',
      'kind text not null',
      'proposal_key text not null',
      'content text not null',
      'source text not null',
      "status text not null default 'proposed'",
      'created_at timestamptz not null default now()',
      'updated_at timestamptz not null default now()',
      'confirmed_at timestamptz',
    ]) {
      expect(table).toContain(column);
    }
    expect(table).toMatch(
      /check \(kind in \('preference', 'learning_style', 'learning_state', 'weakness'\)\)/
    );
    expect(table).toMatch(/check \(source in \('stated', 'derived'\)\)/);
    expect(table).toMatch(
      /check \(status in \('proposed', 'active', 'rejected'\)\)/
    );
    expect(table).toMatch(/char_length\(content\) between 1 and 300/);
    expect(sql).toMatch(/content !~ '\[\[:cntrl:\]\]'/);
    expect(table).toMatch(/char_length\(proposal_key\) between 1 and 120/);
  });

  it('an active entry has a confirmation time, a rejected proposal never comes back (unique key)', () => {
    expect(table).toMatch(
      /check \(status <> 'active' or confirmed_at is not null\)/
    );
    expect(table).toMatch(
      /unique \(user_id, training_catalog_id, proposal_key\)/
    );
  });

  it('only the own user may read and write: one policy, auth.uid(), no policy for trainers or admins', () => {
    expect(statements).toMatch(
      /alter table public\.hai_user_memories enable row level security/i
    );
    expect(statements.match(/create policy/gi)).toHaveLength(1);
    expect(statements).toMatch(
      /create policy hai_user_memories_own\s+on public\.hai_user_memories\s+for all\s+to authenticated\s+using \(user_id = auth\.uid\(\)\)\s+with check \(user_id = auth\.uid\(\)\)/i
    );
    expect(statements).not.toMatch(/\bto\s+(anon|public|service_role)\b/i);
    expect(statements).not.toMatch(
      /create policy[^;]*\b(trainer|admin|super_admin)\b/i
    );
  });
});

describe('hai memory migration: the shared memory and the switch', () => {
  it('the shared memory has the columns, the lists, the limit and the approval check', () => {
    const table = tableSql('hai_global_memories');
    expect(table).toMatch(
      /training_catalog_id uuid references public\.training_catalogs \(id\) on delete cascade/i
    );
    expect(table).toContain("status text not null default 'proposed'");
    expect(table).toContain('origin text not null');
    expect(table).toContain('support_count integer not null default 0');
    expect(table).toContain('created_by uuid,');
    expect(table).toContain('approved_by uuid,');
    expect(table).toContain('approved_at timestamptz,');
    expect(table).toMatch(
      /check \(status in \('proposed', 'approved', 'rejected'\)\)/
    );
    expect(table).toMatch(/check \(origin in \('auto', 'manual'\)\)/);
    expect(table).toMatch(/char_length\(content\) between 1 and 400/);
    expect(table).toMatch(/check \(support_count >= 0\)/);
    expect(table).toMatch(
      /check \(status <> 'approved' or \(approved_by is not null and approved_at is not null\)\)/
    );
    // audit notes are plain ids: they must not hold up the deletion of a profile
    expect(table).not.toMatch(
      /created_by uuid references|approved_by uuid references/i
    );
  });

  it('one open proposal per occupation and key', () => {
    expect(statements).toMatch(
      /create unique index if not exists hai_global_memories_catalog_key_unique\s+on public\.hai_global_memories \(training_catalog_id, proposal_key\)\s+where proposal_key is not null/i
    );
  });

  it('the switch of a user is keyed by the user and cascades on the account', () => {
    const table = tableSql('hai_user_memory_settings');
    expect(table).toMatch(
      /user_id uuid primary key references public\.profiles \(id\) on delete cascade/i
    );
    expect(table).toContain('enabled boolean not null default true');
  });

  it('is closed for the API roles: RLS on every table, nothing granted, everything revoked', () => {
    for (const table of [
      'hai_user_memories',
      'hai_global_memories',
      'hai_user_memory_settings',
    ]) {
      expect(statements).toMatch(
        new RegExp(
          `alter table public\\.${table} enable row level security`,
          'i'
        )
      );
    }
    expect(statements).not.toMatch(/\bgrant\b/i);
    expect(sql).toMatch(/revoke all on public\.%I from %I/i);
    expect(sql).toMatch(/'anon', 'authenticated'/);
    // the shared memory and the switch have no policy at all (read on the server only)
    expect(statements).not.toMatch(
      /create policy[^;]*public\.(hai_global_memories|hai_user_memory_settings)/i
    );
  });

  it('checks the result at the end (RLS, exactly one policy)', () => {
    expect(sql).toMatch(/relrowsecurity/);
    expect(sql).toMatch(/hai_user_memories must have exactly one policy/);
    expect(sql).toMatch(/must have no policy/);
  });
});

describe('hai memory migration: matches the Drizzle schema', () => {
  it('hai_user_memories', () => {
    const config = getTableConfig(haiUserMemories);
    expect(config.name).toBe('hai_user_memories');
    expect(config.columns.map(c => c.name).sort()).toEqual(
      [
        'id',
        'user_id',
        'training_catalog_id',
        'kind',
        'proposal_key',
        'content',
        'source',
        'status',
        'created_at',
        'updated_at',
        'confirmed_at',
      ].sort()
    );
    expect(config.checks.map(c => c.name).sort()).toEqual(
      [
        'hai_user_memories_kind_check',
        'hai_user_memories_source_check',
        'hai_user_memories_status_check',
        'hai_user_memories_content_length',
        'hai_user_memories_key_length',
        'hai_user_memories_active_confirmed',
      ].sort()
    );
    expect(config.uniqueConstraints.map(c => c.name)).toEqual([
      'hai_user_memories_user_catalog_key_unique',
    ]);
    // user_id is a plain id in the schema on purpose (the foreign key is in the
    // migration only), see the profile merge guard
    expect(
      config.foreignKeys.map(fk => fk.reference().columns.map(c => c.name))
    ).toEqual([['training_catalog_id']]);
  });

  it('hai_global_memories', () => {
    const config = getTableConfig(haiGlobalMemories);
    expect(config.name).toBe('hai_global_memories');
    expect(config.columns.map(c => c.name).sort()).toEqual(
      [
        'id',
        'training_catalog_id',
        'proposal_key',
        'content',
        'status',
        'origin',
        'support_count',
        'created_by',
        'approved_by',
        'approved_at',
        'created_at',
        'updated_at',
      ].sort()
    );
    expect(config.checks.map(c => c.name).sort()).toEqual(
      [
        'hai_global_memories_status_check',
        'hai_global_memories_origin_check',
        'hai_global_memories_content_length',
        'hai_global_memories_support_count_check',
        'hai_global_memories_key_length',
        'hai_global_memories_approved_check',
      ].sort()
    );
    expect(config.indexes.map(i => i.config.name).sort()).toEqual([
      'hai_global_memories_catalog_key_unique',
      'hai_global_memories_status_catalog_idx',
    ]);
  });

  it('hai_user_memory_settings', () => {
    const config = getTableConfig(haiUserMemorySettings);
    expect(config.name).toBe('hai_user_memory_settings');
    expect(config.columns.map(c => c.name).sort()).toEqual([
      'enabled',
      'updated_at',
      'user_id',
    ]);
    expect(config.foreignKeys).toHaveLength(0);
  });

  it('the value lists of the schema are the ones of the migration', () => {
    const table = tableSql('hai_user_memories');
    const list = (column: string) =>
      (
        new RegExp(`${column} in \\(([^)]*)\\)`)
          .exec(table)![1]
          .match(/'([^']+)'/g) ?? []
      ).map(s => s.replace(/'/g, ''));
    expect(list('kind')).toEqual([...HAI_USER_MEMORY_KINDS]);
    expect(list('source')).toEqual([...HAI_USER_MEMORY_SOURCES]);
  });
});
