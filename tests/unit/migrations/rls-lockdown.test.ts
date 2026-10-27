/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static checks of the lockdown of the API roles: the migration
 * 20261029000300_security_revoke_api_table_access.sql, its rollback and read only
 * check under supabase/manual and the storage template. The SQL itself is verified
 * on a throwaway database (revoke, policies, idempotence, rollback, REST, realtime,
 * storage), these checks guard the conventions and keep the files consistent.
 */

const ROOT = process.cwd();
const MIGRATIONS = path.join(ROOT, 'supabase', 'migrations');
const MANUAL = path.join(ROOT, 'supabase', 'manual');
const MIGRATION = '20261029000300_security_revoke_api_table_access.sql';

const raw = (dir: string, name: string) =>
  fs.readFileSync(path.join(dir, name), 'utf-8');
/** SQL without line comments (the files document themselves in comments). */
const code = (dir: string, name: string) =>
  raw(dir, name)
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
/** Statements of a SQL text without comments (dollar quoted bodies stay in one piece). */
function statements(sql: string): string[] {
  const out: string[] = [];
  let current = '';
  let dollar: string | null = null;
  for (let i = 0; i < sql.length; i++) {
    const rest = sql.slice(i);
    if (dollar) {
      if (rest.startsWith(dollar)) {
        current += dollar;
        i += dollar.length - 1;
        dollar = null;
        continue;
      }
    } else {
      const tag = /^\$[A-Za-z_]*\$/.exec(rest);
      if (tag) {
        dollar = tag[0];
        current += tag[0];
        i += tag[0].length - 1;
        continue;
      }
      if (sql[i] === ';') {
        if (current.trim()) out.push(current.trim());
        current = '';
        continue;
      }
    }
    current += sql[i];
  }
  if (current.trim()) out.push(current.trim());
  return out;
}

describe('lockdown migration', () => {
  const sql = code(MIGRATIONS, MIGRATION);
  const header = raw(MIGRATIONS, MIGRATION)
    .split(/\r?\n/)
    .filter(line => line.trim().startsWith('--'))
    .join('\n');

  it('is the newest file and sorts behind the gated start of the series', () => {
    const files = fs
      .readdirSync(MIGRATIONS)
      .filter(name => /^\d{14}_/.test(name))
      .sort();
    expect(files[files.length - 1]).toBe(MIGRATION);
    const gate = fs.readFileSync(
      path.join(ROOT, 'scripts', 'db', 'rollout-gate.mjs'),
      'utf-8'
    );
    const gatedFrom = /GATED_FROM = '(\d{14})'/.exec(gate)?.[1] ?? '';
    // a production release stops at it until the owner approves the rollout
    expect(MIGRATION.slice(0, 14) >= gatedFrom).toBe(true);
  });

  it('documents purpose, effect, minimum, undo and what it does not cover', () => {
    expect(header).toMatch(/Why:/);
    expect(header).toMatch(/Effect \(schema public\)/);
    expect(header).toMatch(/What the browser keeps/);
    expect(header).toMatch(/Undo:/);
    expect(header).toMatch(/rollback-rls-lockdown\.sql/);
    expect(header).toMatch(/Not covered here/);
    expect(header).toMatch(/Safe to run twice/);
    expect(header).toMatch(/verify-rls-lockdown\.sql/);
  });

  it('revokes everything from anon and authenticated on tables and sequences', () => {
    expect(sql).toMatch(
      /revoke all on all tables in schema public from anon, authenticated;/
    );
    expect(sql).toMatch(
      /revoke all on all sequences in schema public from anon, authenticated;/
    );
  });

  it('closes the defaults for new tables, sequences and functions', () => {
    expect(sql).toMatch(
      /alter default privileges in schema public revoke all on tables from anon, authenticated;/
    );
    expect(sql).toMatch(
      /alter default privileges in schema public revoke all on sequences from anon, authenticated;/
    );
    expect(sql).toMatch(
      /alter default privileges in schema public revoke execute on functions from anon, authenticated;/
    );
  });

  it('takes EXECUTE of the app functions away from PUBLIC, anon and authenticated but spares extension members', () => {
    expect(sql).toMatch(
      /revoke execute on routine %s from public, anon, authenticated/
    );
    expect(sql).toMatch(/d\.deptype = 'e'/);
  });

  it('drops every policy and creates only the four of the minimum, all for authenticated', () => {
    expect(sql).toMatch(/drop policy %I on public\.%I/);
    const created = [...sql.matchAll(/create policy (\w+) on public\.(\w+)/g)]
      .map(match => `${match[2]}.${match[1]}`)
      .sort();
    expect(created).toEqual([
      'notifications.notifications_select_own',
      'organizations.organizations_select_own',
      'profiles.profiles_select_own',
      'profiles.profiles_update_own',
    ]);
    const policies = sql
      .split(/\bcreate\s+policy\b/i)
      .slice(1)
      .map(chunk => chunk.split(';')[0]);
    for (const policy of policies) {
      expect(policy).toMatch(/\bto\s+authenticated\b/i);
      expect(policy).not.toMatch(/using\s*\(\s*true\s*\)/i);
      expect(policy).toMatch(/auth\.uid\(\)/);
    }
  });

  it('keeps row level security enabled everywhere', () => {
    expect(sql).toMatch(/alter table public\.%I enable row level security/);
    expect(sql).not.toMatch(/disable row level security/i);
  });

  it('closes default privileges of every scope and proves it', () => {
    // the schema entry in every environment, the entry without a schema in Production only
    const whole = raw(MIGRATIONS, MIGRATION);
    expect(whole).toMatch(
      /-- preview:skip\s+do \$\$[\s\S]*alter default privileges revoke all on tables from anon, authenticated;[\s\S]*-- preview:end/
    );
    expect(sql).toMatch(/d\.defaclnamespace = 0/);
    expect(sql).toMatch(/default privileges still give the API roles access/);
  });

  it('stops and rolls back if something is left open', () => {
    for (const message of [
      'privileges through a role membership left',
      'column privileges left',
      'privileges left',
      'sequence privileges left',
      'EXECUTE left',
      'policies left',
    ]) {
      expect(sql).toContain(message);
    }
    expect(sql).toMatch(/raise exception 'RLS lockdown incomplete/);
  });

  it('is idempotent: backup only once, guards for roles and tables', () => {
    expect(sql).toMatch(
      /create table if not exists public\.rls_lockdown_backup/
    );
    expect(sql).toMatch(
      /if exists \(select 1 from public\.rls_lockdown_backup\) then\s+return;/
    );
    expect(sql).toMatch(/rolname = 'anon'/);
    expect(sql).toMatch(/rolname = 'authenticated'/);
    expect(sql).toMatch(/to_regclass\('public\.profiles'\)/);
    expect(sql).toMatch(/to_regclass\('public\.notifications'\)/);
    expect(sql).toMatch(/to_regclass\('public\.organizations'\)/);
  });

  it('closes the backup table for the API roles', () => {
    // created after the default privileges were closed, row level security on,
    // revoked together with every other table afterwards
    const defaults = sql.indexOf('alter default privileges');
    const create = sql.indexOf(
      'create table if not exists public.rls_lockdown_backup'
    );
    const revoke = sql.indexOf('revoke all on all tables');
    expect(defaults).toBeGreaterThan(-1);
    expect(create).toBeGreaterThan(defaults);
    expect(revoke).toBeGreaterThan(create);
    expect(sql).toMatch(
      /alter table public\.rls_lockdown_backup enable row level security/
    );
  });

  it('checks the profile protection trigger it relies on and leaves storage alone', () => {
    expect(sql).toMatch(/t\.tgname = 'profiles_protect_columns'/);
    expect(sql).toMatch(/trigger profiles_protect_columns is missing/);
    expect(sql).not.toMatch(/storage\.objects/);
    expect(sql).not.toMatch(/\bgrant\b[^;]*\bto\b[^;]*\b(anon|public)\b/i);
  });
});

describe('rollback and check files', () => {
  const rollback = code(MANUAL, 'rollback-rls-lockdown.sql');
  const migration = code(MIGRATIONS, MIGRATION);

  it('restores every kind of item that the migration saves', () => {
    const saved = [...migration.matchAll(/select '(\w+)'/g)].map(
      match => match[1]
    );
    expect(saved.sort()).toEqual([
      'column_privilege',
      'function_privilege',
      'no_rls',
      'policy',
      'privilege',
      'sequence_privilege',
    ]);
    for (const kind of saved) {
      expect(rollback).toContain(`kind = '${kind}'`);
    }
  });

  it('runs in one transaction, refuses an empty backup and keeps the backup table', () => {
    expect(rollback).toMatch(/^begin;/m);
    expect(rollback).toMatch(/^commit;/m);
    expect(rollback).toMatch(/rls_lockdown_backup is missing or empty/);
    expect(rollback).not.toMatch(/drop table/i);
  });

  it('reopens the defaults the migration closed', () => {
    expect(rollback).toMatch(
      /alter default privileges in schema public grant all on tables to anon, authenticated/
    );
  });

  it('contains only select statements in the read only check, and all 13 checks', () => {
    const verify = code(MANUAL, 'verify-rls-lockdown.sql');
    const list = statements(verify);
    expect(list.length).toBe(13);
    for (const statement of list) {
      expect(statement).toMatch(/^select\b/i);
    }
    const text = raw(MANUAL, 'verify-rls-lockdown.sql');
    for (let n = 1; n <= 13; n++) {
      expect(text).toMatch(new RegExp(`-- check ${n}:`));
    }
    for (const word of [
      'pg_policies',
      'has_table_privilege',
      'relrowsecurity',
      'storage.buckets',
    ]) {
      expect(verify).toContain(word);
    }
    expect(text).toMatch(/EXPECTED AFTER/);
  });
});

describe('storage template', () => {
  const name = '20261029_storage_policies_v2.sql';
  const sql = code(MANUAL, name);
  const text = raw(MANUAL, name);

  it('creates only own folder policies for authenticated users on the two buckets (plus the Preview select)', () => {
    const created = [
      ...sql.matchAll(
        /create policy (\w+) on storage\.objects\s+for (\w+) to (\w+)/g
      ),
    ];
    expect(created.map(match => match[1]).sort()).toEqual(
      [
        'avatar_delete_own_folder',
        'avatar_insert_own_folder',
        'avatar_select_own_folder',
        'avatar_update_own_folder',
        'avatar_select_preview',
        'content_delete_own_folder',
        'content_insert_own_folder',
        'content_select_own_folder',
        'content_select_preview',
        'content_update_own_folder',
      ].sort()
    );
    for (const match of created) {
      expect(match[3]).toBe('authenticated');
    }
    for (const policy of sql.split(/\bcreate policy\b/i).slice(1)) {
      expect(policy).toMatch(/foldername\(name\)\)\[1\]/);
      expect(policy).toMatch(/bucket_id = '(content|avatar)'/);
    }
  });

  it('keeps the Preview policies and does not touch the bucket flags in executed code', () => {
    expect(sql).toMatch(/like '%\\_preview'/);
    expect(sql).not.toMatch(/update storage\.buckets/i);
    expect(sql).not.toMatch(/\bto (public|anon)\b/i);
    // the private bucket is documented with its order and its rollback
    expect(text).toMatch(
      /update storage\.buckets set public = false where id = 'content'/
    );
    expect(text).toMatch(
      /update storage\.buckets set public = true where id = 'content'/
    );
    expect(text).toMatch(/Required order/);
    expect(text).toMatch(/UNDO/);
  });

  it('runs in one transaction', () => {
    expect(sql).toMatch(/^begin;/m);
    expect(sql).toMatch(/^commit;/m);
  });
});
