/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static checks of the profile column protection: the column privileges
 * (20261023200000) and the trigger (20261023300000) are two independent layers
 * and must name the same writable columns, and these must be the columns the
 * browser really writes. The SQL itself is verified on a throwaway database.
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

describe('profiles column protection', () => {
  const privileges = readSql(PRIVILEGES);
  const trigger = readSql(TRIGGER);
  const granted = /grant update \(([^)]+)\)/i.exec(privileges)?.[1] ?? '';
  const allowed =
    /allowed text\[\] := array\[([^\]]+)\]/i.exec(trigger)?.[1] ?? '';

  it('names the same writable columns in the privileges and in the trigger', () => {
    expect(identifiers(granted).length).toBeGreaterThan(0);
    expect(identifiers(allowed)).toEqual(identifiers(granted));
  });

  it('allows exactly the columns the browser writes in updateProfile', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src', 'contexts', 'AuthContext.tsx'),
      'utf-8'
    );
    const update = /\.from\('profiles'\)\s*\.update\(\{([\s\S]*?)\}\)/.exec(
      source
    )?.[1];
    expect(update).toBeDefined();
    const written = [...(update as string).matchAll(/^\s*([a-z_]+):/gm)]
      .map(match => match[1])
      .sort();
    expect(written).toEqual(identifiers(allowed));
  });

  it('never allows the sensitive columns', () => {
    for (const column of [
      'role',
      'organization_id',
      'is_active',
      'trainer_activated',
      'email',
      'id',
    ]) {
      expect(identifiers(allowed)).not.toContain(column);
    }
  });

  it('fires before every update of every row of public.profiles', () => {
    expect(trigger).toMatch(
      /create trigger profiles_protect_columns\s+before update on public\.profiles\s+for each row\s+execute function public\.profiles_protect_columns\(\)/i
    );
  });

  it('checks exactly the two API roles and refuses with SQLSTATE 42501', () => {
    expect(trigger).toMatch(/current_user in \('anon', 'authenticated'\)/);
    expect(trigger).toMatch(/errcode = '42501'/);
    // the comparison covers every column except the allowed ones
    expect(trigger).toMatch(
      /\(to_jsonb\(new\) - allowed\) is distinct from \(to_jsonb\(old\) - allowed\)/
    );
  });

  it('has a fixed search path, no EXECUTE for PUBLIC and is safe to run twice', () => {
    expect(trigger).toMatch(/set search_path = ''/i);
    expect(trigger).toMatch(
      /revoke execute on function public\.profiles_protect_columns\(\) from public/i
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
