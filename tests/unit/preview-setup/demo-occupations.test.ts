/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static checks of supabase/preview-setup/08-demo-occupations.sql, the template a human
 * runs by hand in the Supabase SQL editor to seed one demo trainee and one demo trainer
 * per occupation (FIAE and KfBM) in the Preview. The behaviour was run once against a
 * local throwaway database with a reduced copy of the tables (rehearsal, real run, second
 * run); these tests keep the guard rails in place.
 */

const FILE = path.join(
  process.cwd(),
  'supabase',
  'preview-setup',
  '08-demo-occupations.sql'
);
const raw = fs.readFileSync(FILE, 'utf-8');

const code = raw
  .split(/\r?\n/)
  .map(line => line.replace(/--.*$/, ''))
  .join('\n');
const statements = code.replace(/'(?:[^']|'')*'/g, "''");

describe('08-demo-occupations.sql: scope', () => {
  it('only addresses the schema public_preview', () => {
    expect(raw).not.toMatch(/\bpublic\./i);
    expect(raw).not.toMatch(/"public"/i);
    expect(statements).not.toMatch(/\bsearch_path\b/i);
    expect(statements).not.toMatch(
      /\b(auth|storage|realtime|extensions|vault|graphql|supabase_migrations|preview_meta|preview_support)\s*\./i
    );
  });

  it('writes only to the four tables it documents and its own report table', () => {
    const targets = [
      ...statements.matchAll(
        /\b(?:insert\s+into|update(?!\s+set\b)|delete\s+from)\s+([a-z_][a-z0-9_.]*)/gi
      ),
    ].map(match => match[1].toLowerCase());
    expect([...new Set(targets)].sort()).toEqual([
      'demo_occupations_report',
      'public_preview.organization_catalogs',
      'public_preview.profiles',
      'public_preview.trainee_enrollments',
    ]);
  });

  it('never deletes, truncates or drops anything of the application', () => {
    expect(statements).not.toMatch(/\bdelete\s+from\b/i);
    expect(statements).not.toMatch(/\btruncate\b/i);
    expect(statements).not.toMatch(
      /\bdrop\s+(?!table\s+if\s+exists\s+pg_temp\.)/i
    );
    expect(statements).not.toMatch(/\balter\s+(table|role|user|schema)\b/i);
  });

  it('does not touch the activation of a catalog and creates no organization or profile', () => {
    expect(statements).not.toMatch(
      /update\s+public_preview\.training_catalogs/i
    );
    expect(statements).not.toMatch(
      /insert\s+into\s+public_preview\.(organizations|profiles)\b/i
    );
  });

  it('holds no password, key or token', () => {
    expect(raw).not.toMatch(
      /\b(sb_secret|sb_publishable|service_role|eyJ[A-Za-z0-9_-]{10,})/
    );
    expect(statements).not.toMatch(/\bpassword\b/i);
  });
});

describe('08-demo-occupations.sql: demo people', () => {
  it('uses only addresses on example.invalid, for both occupations and both roles', () => {
    const emails = [...raw.matchAll(/'([^'\s]+@[^'\s]+)'/g)].map(m => m[1]);
    const demo = emails.filter(address => address.startsWith('demo.'));
    expect(demo.sort()).toEqual([
      'demo.fiae.azubi@example.invalid',
      'demo.fiae.trainer@example.invalid',
      'demo.kfbm.azubi@example.invalid',
      'demo.kfbm.trainer@example.invalid',
    ]);
    for (const address of demo) expect(address).toMatch(/@example\.invalid$/);
  });

  it('refuses an address outside of example.invalid at run time', () => {
    expect(code).toMatch(/example\\\.invalid\$/);
  });

  it('contains no other e-mail address (no real person)', () => {
    const all = [
      ...code.matchAll(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g),
    ].map(m => m[0]);
    for (const address of all) expect(address).toMatch(/example\.invalid$/);
  });

  it('pairs the roles and the occupation codes of the two occupations', () => {
    expect(code).toContain("array['TRAINER', 'TRAINEE', 'TRAINER', 'TRAINEE']");
    expect(code).toContain("array['FIAE', 'FIAE', 'KFBM', 'KFBM']");
  });
});

describe('08-demo-occupations.sql: safety', () => {
  it('is one transaction with timeouts', () => {
    expect(code).toMatch(/^\s*begin;/m);
    expect(code).toMatch(/set local lock_timeout/);
    expect(code).toMatch(/set local statement_timeout/);
    expect(code).toMatch(/^\s*commit;/m);
  });

  it('starts as a rehearsal that changes nothing', () => {
    expect(code).toMatch(/v_dry_run boolean := true;/);
    expect(code).toMatch(/if v_dry_run then\s+raise exception/);
  });

  it('checks its preconditions before the first write', () => {
    const firstWrite = statements.search(
      /\b(insert\s+into|update)\s+public_preview\./i
    );
    const guard = statements.search(/raise exception/i);
    expect(guard).toBeGreaterThan(-1);
    expect(guard).toBeLessThan(firstWrite);
    expect(code).toMatch(/Zuerst 05-demo-bootstrap\.sql ausführen/);
  });

  it('does not move a profile of another organization and keeps what is filled in', () => {
    expect(code).toMatch(/v_p\.organization_id <> v_org_id/);
    expect(code).toMatch(/coalesce\(p\.full_name/);
    expect(code).toMatch(/p\.assigned_trainer_id is null/);
    expect(code).toMatch(
      /on conflict \(trainee_id, training_catalog_id\) do nothing/
    );
  });
});
