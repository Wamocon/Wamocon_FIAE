/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static checks of the profile protection: the column privileges
 * (20261023200000, narrowed by 20261023300000) and the trigger (20261023300000)
 * are two independent layers and must name the same writable columns, and these
 * must be the columns the browser really writes. The SQL itself is verified on a
 * throwaway database.
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const PRIVILEGES = '20261023200000_security_profiles_column_privileges.sql';
const TRIGGER = '20261023300000_security_profiles_protect_columns.sql';

/** SQL without line comments (the files document themselves in comments). */
function readSql(fileName: string): string {
  return fs
    .readFileSync(path.join(MIGRATIONS_DIR, fileName), 'utf-8')
    .split(/\r?\n/)
    .filter(line => !line.trim().startsWith('--'))
    .join('\n');
}

function identifiers(list: string): string[] {
  return [...list.matchAll(/[a-z][a-z_]*/g)].map(match => match[0]).sort();
}

describe('profiles protection', () => {
  const privileges = readSql(PRIVILEGES);
  const trigger = readSql(TRIGGER);
  const granted = identifiers(
    /grant update \(([^)]+)\)/i.exec(privileges)?.[1] ?? ''
  );
  const revoked = identifiers(
    /revoke update \(([^)]+)\) on table public\.profiles from authenticated/i.exec(
      trigger
    )?.[1] ?? ''
  );
  const allowed = identifiers(
    /allowed text\[\] := array\[([^\]]+)\]/i.exec(trigger)?.[1] ?? ''
  );

  it('names the same writable columns in the privileges and in the trigger', () => {
    const effective = granted.filter(column => !revoked.includes(column));
    expect(granted.length).toBeGreaterThan(0);
    expect(revoked).toEqual(['assigned_trainer_id']);
    expect(allowed).toEqual(effective);
  });

  it('allows exactly the columns the browser writes in updateProfile', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'contexts', 'AuthContext.tsx'),
      'utf-8'
    );
    const start = source.indexOf('const updateProfile = useCallback(');
    expect(start).toBeGreaterThan(0);
    const body = source.slice(start, source.indexOf('refreshProfile', start));
    expect(body).toMatch(/\.from\('profiles'\)\s*\.update\(row\)/);
    // the payload: the initial literal (updated_at) and the assignments row.<column> =
    const written = [
      ...(/const row[^=]*=\s*\{([\s\S]*?)\};/.exec(body)?.[1] ?? '').matchAll(
        /^\s*([a-z_]+):/gm
      ),
      ...body.matchAll(/\brow\.([a-z_]+)\s*=/g),
    ]
      .map(match => match[1])
      .sort();
    expect(written).toEqual(allowed);
  });

  it('never allows the sensitive columns', () => {
    for (const column of [
      'role',
      'organization_id',
      'is_active',
      'trainer_activated',
      'email',
      'id',
      'assigned_trainer_id',
    ]) {
      expect(allowed).not.toContain(column);
    }
  });

  it('fires before every insert, update and delete of every row of public.profiles', () => {
    expect(trigger).toMatch(
      /create trigger profiles_protect_columns\s+before insert or update or delete on public\.profiles\s+for each row\s+execute function public\.profiles_protect_columns\(\)/i
    );
  });

  it('checks exactly the two API roles and refuses with SQLSTATE 42501', () => {
    expect(trigger).toMatch(/current_user in \('anon', 'authenticated'\)/);
    expect(trigger).toMatch(/errcode = '42501'/);
    // the update comparison covers every column except the allowed ones
    expect(trigger).toMatch(
      /\(to_jsonb\(new\) - allowed\) is distinct from \(to_jsonb\(old\) - allowed\)/
    );
  });

  it('refuses insert and delete for the API roles and lets a delete through for everybody else', () => {
    expect(trigger).toMatch(/tg_op = 'UPDATE'/);
    expect(trigger).toMatch(/Profiles cannot be % with the API credentials/);
    // a before delete trigger that returns NEW (null) would drop the delete silently
    expect(trigger).toMatch(/if tg_op = 'DELETE' then\s+return old;/);
  });

  it('stays SECURITY INVOKER: with SECURITY DEFINER current_user is the owner and the protection is off', () => {
    expect(trigger).not.toMatch(/security definer/i);
  });

  it('has a fixed search path, takes EXECUTE from PUBLIC and the API roles and is safe to run twice', () => {
    expect(trigger).toMatch(/set search_path = ''/i);
    expect(trigger).toMatch(
      /revoke execute on function public\.profiles_protect_columns\(\) from public, anon, authenticated/i
    );
    expect(trigger).toMatch(/create or replace function/i);
    expect(trigger).toMatch(
      /drop trigger if exists profiles_protect_columns on public\.profiles/i
    );
  });

  it('keeps the series conventions: no transaction control, lock and statement timeouts', () => {
    expect(trigger).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(trigger).toMatch(/set\s+local\s+lock_timeout\s*=\s*'5s'/i);
    expect(trigger).toMatch(/set\s+local\s+statement_timeout\s*=\s*'60s'/i);
  });

  it('sorts behind the privilege migration and ahead of the catalog series', () => {
    expect(TRIGGER > PRIVILEGES).toBe(true);
    expect(TRIGGER < '20261024').toBe(true);
  });
});
