/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { authAttempts } from '@/db/migrations/schemas/schema';

/**
 * Static checks of 20261029000200_auth_attempts.sql. The file creates the
 * counter table for failed PIN checks (src/lib/auth/attempt-limiter.ts). The
 * behavior of the SQL and of the upsert was run against a throwaway local
 * database (see the pull request); these tests guard the conventions of the
 * release pipeline and the shape of the change.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const FILE = '20261029000200_auth_attempts.sql';

const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, FILE), 'utf-8');
const header = raw
  .split(/\r?\n/)
  .filter(line => line.startsWith('--'))
  .map(line => line.replace(/^--\s?/, ''))
  .join(' ')
  .replace(/\s+/g, ' ');
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

describe('auth_attempts migration: place in the series', () => {
  it('has a 14 digit version and a lowercase name', () => {
    expect(FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it('sorts behind the HAI visibility migration and is part of the series', () => {
    expect(FILE > '20261029000100_hai_embeddings_quiz_visibility.sql').toBe(
      true
    );
    expect(allFiles).toContain(FILE);
  });

  it('is held back in Production with the rest of the series', () => {
    // the gate holds every version from 20261024000100 on
    expect(FILE.slice(0, 14) >= '20261024000100').toBe(true);
  });
});

describe('auth_attempts migration: conventions', () => {
  it('has no explicit transaction control', () => {
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
  });

  it('keeps the lock and statement timeouts of the series', () => {
    expect(sql).toMatch(/set\s+local\s+lock_timeout\s*=\s*'5s'/i);
    expect(sql).toMatch(/set\s+local\s+statement_timeout\s*=\s*'60s'/i);
  });

  it('installs no extensions, roles, publications or policies', () => {
    expect(sql).not.toMatch(
      /\b(create|alter|drop)\s+(extension|role|user|publication|policy)\b/i
    );
  });

  it('qualifies the table with public.', () => {
    const tables = [
      ...statements.matchAll(
        /\b(?:from|on|table|exists)\s+(public\.)?(auth_attempts)\b/gi
      ),
    ];
    expect(tables.length).toBeGreaterThan(0);
    for (const match of tables) {
      expect(match[1]).toBe('public.');
    }
  });

  it('documents what it does, why, the closed access and the undo', () => {
    expect(header).toMatch(/verify-pin/);
    expect(header).toMatch(/serverless instances/i);
    expect(header).toMatch(/ON CONFLICT DO UPDATE/);
    expect(header).toMatch(/no policy/i);
    expect(header).toMatch(/Safe to run twice/i);
    expect(header).toMatch(/rollout gate/i);
    expect(header).toMatch(/undo/i);
  });
});

describe('auth_attempts migration: the table', () => {
  it('creates the table idempotently, keyed by scope and subject', () => {
    expect(statements).toMatch(
      /create table if not exists public\.auth_attempts\s*\(/i
    );
    expect(statements).toMatch(
      /constraint auth_attempts_pkey primary key \(scope, subject\)/i
    );
  });

  it('holds the counter, the lock and the decision of the last attempt', () => {
    expect(statements).toMatch(/failures integer not null default 0/i);
    expect(statements).toMatch(/locked_until timestamptz\s*,/i);
    expect(statements).toMatch(
      /last_attempt_at timestamptz not null default now\(\)/i
    );
    expect(statements).toMatch(/last_allowed boolean not null default true/i);
  });

  it('has no column that could hold a secret', () => {
    expect(statements).not.toMatch(/\b(pin|secret|password|hash)\w*\s+text/i);
  });

  it('bounds the text columns and the counter', () => {
    expect(statements).toMatch(/char_length\(scope\) <= 64/);
    expect(statements).toMatch(/char_length\(subject\) <= 128/);
    expect(statements).toMatch(/check \(failures >= 0\)/);
  });

  it('has no index besides the primary key (every counted attempt updates last_attempt_at, an index would make each update a non-HOT update)', () => {
    expect(statements).not.toMatch(/create\s+(unique\s+)?index/i);
  });

  it('creates nothing else', () => {
    expect(statements.match(/create\s+table/gi)).toHaveLength(1);
    expect(statements).not.toMatch(/\b(create|alter)\s+(function|trigger)\b/i);
  });

  it('changes no existing table and no data', () => {
    expect(statements).not.toMatch(
      /\balter\s+table\s+(?!public\.auth_attempts)/i
    );
    expect(statements).not.toMatch(
      /\b(insert\s+into|update\s+public|delete\s+from|truncate|merge|copy)\b/i
    );
    expect(statements).not.toMatch(/\bdrop\b/i);
  });
});

describe('auth_attempts migration: closed for the API roles', () => {
  it('enables row level security and adds no policy', () => {
    expect(statements).toMatch(
      /alter table public\.auth_attempts enable row level security\s*;/i
    );
    expect(statements).not.toMatch(/\bcreate\s+policy\b/i);
  });

  it('revokes every privilege of anon and authenticated, only if the roles exist', () => {
    const block = /do\s+\$\$[\s\S]*?\$\$\s*;/i.exec(sql);
    expect(block).not.toBeNull();
    expect(block![0]).toMatch(/array\['anon', 'authenticated'\]/);
    expect(block![0]).toMatch(/pg_roles/);
    expect(block![0]).toMatch(/revoke all on public\.auth_attempts from %I/);
  });

  it('grants nothing', () => {
    expect(statements).not.toMatch(/\bgrant\b/i);
  });
});

describe('Drizzle schema of auth_attempts', () => {
  const config = getTableConfig(authAttempts);
  const columns = Object.fromEntries(config.columns.map(c => [c.name, c]));

  it('has the columns of the migration', () => {
    expect(Object.keys(columns).sort()).toEqual(
      [
        'failures',
        'last_allowed',
        'last_attempt_at',
        'locked_until',
        'scope',
        'subject',
      ].sort()
    );
  });

  it('declares scope and subject as the primary key under the same name', () => {
    expect(config.primaryKeys).toHaveLength(1);
    const pk = config.primaryKeys[0];
    expect(pk.getName()).toBe('auth_attempts_pkey');
    expect(pk.columns.map(c => c.name)).toEqual(['scope', 'subject']);
  });

  it('keeps the checks of the migration and declares no extra index', () => {
    expect(config.indexes).toEqual([]);
    expect(config.checks.map(c => c.name).sort()).toEqual([
      'auth_attempts_failures_check',
      'auth_attempts_scope_length',
      'auth_attempts_subject_length',
    ]);
  });

  it('keeps the not null rules and the defaults', () => {
    expect(columns.scope.notNull).toBe(true);
    expect(columns.subject.notNull).toBe(true);
    expect(columns.failures.notNull).toBe(true);
    expect(columns.locked_until.notNull).toBe(false);
    expect(columns.last_attempt_at.notNull).toBe(true);
    expect(columns.last_allowed.notNull).toBe(true);
    expect(columns.last_allowed.default).toBe(true);
    expect(columns.failures.default).toBe(0);
  });
});
