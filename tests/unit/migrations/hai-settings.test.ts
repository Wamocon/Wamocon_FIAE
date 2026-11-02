/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { haiSettings } from '@/db/migrations/schemas/schema';

/**
 * Static checks of 20261102000100_hai_settings.sql: the table of the platform
 * settings of the HAI (speech provider of the voice assistant). The conventions of
 * the release pipeline, the closed access and the match with the Drizzle schema.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const FILE = '20261102000100_hai_settings.sql';

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

const FOLLOW_UP = '20261102000200_hai_settings_updated_by_plain.sql';
const followUp = fs
  .readFileSync(path.join(MIGRATIONS_DIR, FOLLOW_UP), 'utf-8')
  .split(/\r?\n/)
  .filter(line => !line.trim().startsWith('--'))
  .join('\n');

const allFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter(name => name.endsWith('.sql'))
  .sort();

describe('hai_settings migration: place in the series', () => {
  it('has a 14 digit version and sorts behind every other migration, the follow-up last', () => {
    expect(FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(allFiles).toContain(FILE);
    expect(allFiles.slice(-2)).toEqual([FILE, FOLLOW_UP]);
  });
});

describe('hai_settings migration: conventions', () => {
  it('has no explicit transaction control and keeps the timeouts of the series', () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(sql).toMatch(/set\s+local\s+lock_timeout\s*=\s*'5s'/i);
    expect(sql).toMatch(/set\s+local\s+statement_timeout\s*=\s*'60s'/i);
  });

  it('installs no extensions, roles, publications or policies and changes no other table', () => {
    expect(sql).not.toMatch(
      /\b(create|alter|drop)\s+(extension|role|user|publication|policy)\b/i
    );
    expect(statements.match(/create\s+table/gi)).toHaveLength(1);
    expect(statements).not.toMatch(
      /\balter\s+table\s+(?!public\.hai_settings)/i
    );
    expect(statements).not.toMatch(
      /\b(insert\s+into|update\s+public|delete\s+from|truncate)\b/i
    );
  });

  it('qualifies every table with public. (the preview run rewrites it)', () => {
    const tables = [
      ...statements.matchAll(
        /\b(?:from|on|table|exists|references)\s+(public\.)?(hai_settings|profiles)\b/gi
      ),
    ];
    expect(tables.length).toBeGreaterThan(0);
    for (const match of tables) expect(match[1]).toBe('public.');
  });

  it('is safe to run twice and documents what, why, the closed access and the undo', () => {
    expect(statements).toMatch(
      /create table if not exists public\.hai_settings\s*\(/i
    );
    expect(header).toMatch(/Safe to run twice/i);
    expect(header).toMatch(/voice_provider_primary/);
    expect(header).toMatch(/voice_provider_fallback/);
    expect(header).toMatch(/no\s+policy/i);
    expect(header).toMatch(/undo/i);
  });
});

describe('hai_settings migration: the table', () => {
  it('is keyed by the setting and holds the value as JSON with the admin who saved it', () => {
    expect(statements).toMatch(/key text not null/i);
    expect(statements).toMatch(/value jsonb not null/i);
    expect(statements).toMatch(
      /updated_at timestamptz not null default now\(\)/i
    );
    // as it was applied to the Preview schema (the file must not change any more,
    // the runner refuses it); the second migration below drops the foreign key
    expect(statements).toMatch(
      /updated_by uuid references public\.profiles \(id\) on delete set null/i
    );
    expect(statements).toMatch(
      /constraint hai_settings_pkey primary key \(key\)/i
    );
    expect(statements).toMatch(/char_length\(key\) <= 64/);
  });

  it('is closed for the API roles: RLS on, no policy, every privilege revoked', () => {
    expect(statements).toMatch(
      /alter table public\.hai_settings enable row level security/i
    );
    // (the revoke sits in a string of format(), so this reads the SQL with literals)
    expect(sql).toMatch(/revoke all on public\.hai_settings from %I/i);
    expect(sql).toMatch(/'anon', 'authenticated'/);
    expect(statements).not.toMatch(/\bgrant\b/i);
  });

  it('has no column that could hold a secret', () => {
    expect(statements).not.toMatch(
      /\b(secret|password|token|api_key)\w*\s+(text|jsonb)/i
    );
  });

  it('matches the Drizzle schema', () => {
    const config = getTableConfig(haiSettings);
    expect(config.name).toBe('hai_settings');
    expect(config.columns.map(c => c.name).sort()).toEqual([
      'key',
      'updated_at',
      'updated_by',
      'value',
    ]);
    expect(config.primaryKeys.map(pk => pk.getName())).toEqual([
      'hai_settings_pkey',
    ]);
    expect(config.checks.map(check => check.name)).toEqual([
      'hai_settings_key_length',
    ]);
    // the final state has no foreign key (see the follow-up migration)
    expect(config.foreignKeys).toHaveLength(0);
  });
});

describe('hai_settings follow-up migration: updated_by is a plain id', () => {
  it('drops only the foreign key, idempotently, with the timeouts of the series', () => {
    expect(followUp).toMatch(
      /alter table public\.hai_settings\s+drop constraint if exists hai_settings_updated_by_fkey\s*;/i
    );
    expect(followUp).toMatch(/set\s+local\s+lock_timeout\s*=\s*'5s'/i);
    expect(followUp).toMatch(/set\s+local\s+statement_timeout\s*=\s*'60s'/i);
    expect(followUp).not.toMatch(
      /\b(create|insert|update|delete|truncate|grant|revoke)\b/i
    );
    expect(followUp.match(/alter\s+table/gi)).toHaveLength(1);
  });
});
