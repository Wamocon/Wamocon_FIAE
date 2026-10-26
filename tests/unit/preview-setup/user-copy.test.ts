/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static checks of supabase/preview-setup/07-copy-users-from-production.sql,
 * the template a human runs by hand in the Supabase SQL editor to copy the
 * profiles of the platform organization of Production into the Preview. It was
 * run against the real Preview as a dry run and for real; these tests keep the
 * guard rails in place.
 */

const raw = fs.readFileSync(
  path.join(
    process.cwd(),
    'supabase',
    'preview-setup',
    '07-copy-users-from-production.sql'
  ),
  'utf-8'
);
const code = raw
  .split(/\r?\n/)
  .map(line => line.replace(/--.*$/, ''))
  .join('\n');
const statements = code.replace(/'(?:[^']|'')*'/g, "''");

function at(pattern: RegExp): number {
  return code.search(pattern);
}

describe('07-copy-users-from-production.sql: Production is only read', () => {
  it('never writes, changes or locks anything in the schema public', () => {
    expect(statements).not.toMatch(
      /\b(insert\s+into|update|delete\s+from|truncate(?:\s+table)?|alter\s+table|drop\s+table|create\s+table|lock\s+table|copy)\s+(?:only\s+)?(?:public\.|"public"\.)/i
    );
    const targets = [
      ...statements.matchAll(/\binsert\s+into\s+([a-z_.]+)/gi),
    ].map(m => m[1]);
    expect(targets.sort()).toEqual([
      'public_preview.profiles',
      'user_copy_report',
    ]);
  });

  it('reads public only from profiles and organizations', () => {
    const reads = [...statements.matchAll(/\bfrom\s+public\.([a-z_]+)/gi)].map(
      m => m[1]
    );
    expect(reads.length).toBeGreaterThan(3);
    expect(
      reads.filter(n => !['profiles', 'organizations'].includes(n))
    ).toEqual([]);
  });

  it('does not touch Auth, Storage or any other schema', () => {
    expect(statements).not.toMatch(
      /\b(auth|storage|realtime|extensions|vault|graphql|supabase_migrations|preview_meta|preview_support)\s*\./i
    );
    expect(statements).not.toMatch(
      /\bsearch_path\b|\bsession_replication_role\b/i
    );
  });
});

describe('07-copy-users-from-production.sql: only the platform organization', () => {
  it('copies only profiles of the platform organization into the platform organization of the Preview', () => {
    const insert =
      /insert into public_preview\.profiles[\s\S]*?on conflict/i.exec(
        statements
      )![0];
    expect(insert).toMatch(/o\.is_platform_owner/i);
    expect(insert).toMatch(/v_platform_id/);
    // the organization of the source row is never copied as it is
    const selectList = insert.slice(
      0,
      insert.indexOf('from public.profiles s')
    );
    expect(selectList).not.toMatch(/s\.organization_id/);
  });

  it('keeps a trainer assignment only when the trainer is copied as well', () => {
    expect(code).toMatch(
      /case when exists \([\s\S]*?assigned_trainer_id[\s\S]*?end/i
    );
  });

  it('never copies Auth data or data of a person beyond the profile row', () => {
    expect(code).not.toMatch(
      /(password|passwort|secret|token|service_role|apikey|bearer|eyJ[A-Za-z0-9_-]{10,}|postgres(?:ql)?:\/\/)/i
    );
    const inserted = [
      ...statements.matchAll(/\binsert\s+into\s+(public_preview\.[a-z_]+)/gi),
    ].map(m => m[1]);
    expect(inserted).toEqual(['public_preview.profiles']);
  });
});

describe('07-copy-users-from-production.sql: safety for the person who runs it', () => {
  it('runs in one transaction with one snapshot and time limits', () => {
    expect(statements).toMatch(/^\s*begin isolation level repeatable read;/im);
    expect((statements.match(/\bcommit;/gi) ?? []).length).toBe(1);
    expect(statements).toMatch(/set local lock_timeout/i);
    expect(statements).toMatch(/set local statement_timeout/i);
  });

  it('is a rehearsal by default and only copies when switched on', () => {
    expect(code).toMatch(/v_dry_run\s+boolean\s*:=\s*true\s*;/i);
    expect(code).toMatch(/if\s+v_dry_run\s+then[\s\S]*?raise\s+exception/i);
    expect(at(/if\s+v_dry_run\s+then/i)).toBeLessThan(
      at(/insert\s+into\s+user_copy_report/i)
    );
  });

  it('stops before any write when the Preview is not ready', () => {
    const firstWrite = at(/insert\s+into\s+public_preview\.profiles/i);
    for (const message of [
      'Das Schema public_preview existiert nicht',
      'fehlt in public oder in public_preview',
      'noch keine Plattform-Organisation',
    ]) {
      const position = at(new RegExp(message));
      expect(position).toBeGreaterThan(-1);
      expect(position).toBeLessThan(firstWrite);
    }
  });

  it('is idempotent and never deletes or overwrites', () => {
    expect(statements).not.toMatch(/\bdelete\s+from\b|\btruncate\b/i);
    expect(statements).not.toMatch(/\bupdate\s+public_preview\./i);
    expect(statements).toMatch(/on conflict do nothing;/i);
  });
});
