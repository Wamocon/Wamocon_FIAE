/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static checks of supabase/preview-setup/05-demo-bootstrap.sql, the template
 * a human runs by hand in the Supabase SQL editor to seed the empty
 * public_preview schema (platform organization, demo company, three test
 * accounts). The behaviour was additionally run against a local database
 * inside a rolled back transaction; these tests keep the guard rails in place.
 */

const FILE = path.join(
  process.cwd(),
  'supabase',
  'preview-setup',
  '05-demo-bootstrap.sql'
);
const raw = fs.readFileSync(FILE, 'utf-8');

/** The SQL without line comments (the file documents itself in comments). */
const code = raw
  .split(/\r?\n/)
  .map(line => line.replace(/--.*$/, ''))
  .join('\n');
/** Code with every string literal blanked, so only statements remain. */
const statements = code.replace(/'(?:[^']|'')*'/g, "''");

/** Offset of the first match of a pattern in the code, or -1. */
function at(pattern: RegExp, source: string = code): number {
  return source.search(pattern);
}

describe('05-demo-bootstrap.sql: scope', () => {
  it('only addresses the schema public_preview', () => {
    // "public." must never appear, not even in a comment: the only schema
    // name with that prefix is public_preview (followed by an underscore)
    expect(raw).not.toMatch(/\bpublic\./i);
    expect(raw).not.toMatch(/"public"/i);
    expect(statements).not.toMatch(/\bsearch_path\b/i);
    // no other schema is read or written, Auth stays untouched
    expect(statements).not.toMatch(
      /\b(auth|storage|realtime|extensions|vault|graphql|supabase_migrations|preview_meta|preview_support)\s*\./i
    );
  });

  it('qualifies every table it reads or writes with public_preview.', () => {
    const references = [
      ...statements.matchAll(
        /\b(?:from|join|into|update|table)\s+(?!distinct\b|if\b)([a-z_][a-z0-9_]*(?:\.[a-z_][a-z0-9_]*)?)/gi
      ),
    ].map(match => match[1]);
    expect(references.length).toBeGreaterThan(10);
    const allowed = [
      /^public_preview\.[a-z_]+$/, // the tables of the Preview schema
      /^pg_[a-z_]+$/, // catalogs (pg_namespace, pg_enum, pg_trigger)
      /^pg_temp\.demo_bootstrap_report$/, // the report of this run
      /^demo_bootstrap_report$/, // same temp table, created unqualified
      /^v_[a-z_]+$/, // select ... into <variable>
    ];
    const unqualified = references.filter(
      name => !allowed.some(pattern => pattern.test(name))
    );
    expect(unqualified).toEqual([]);
  });

  it('writes only to organizations, profiles and its own report table', () => {
    const targets = [
      ...statements.matchAll(
        /\b(?:insert\s+into|update|delete\s+from)\s+([a-z_][a-z0-9_.]*)/gi
      ),
    ].map(match => match[1].toLowerCase());
    expect([...new Set(targets)].sort()).toEqual([
      'demo_bootstrap_report',
      'public_preview.organizations',
      'public_preview.profiles',
    ]);
  });

  it('changes no data destructively and creates no roles, schemas or functions', () => {
    expect(statements).not.toMatch(/\bdelete\b/i);
    expect(statements).not.toMatch(/\btruncate\b/i);
    expect(statements).not.toMatch(
      /\b(create|alter|drop)\s+(schema|role|user|extension|publication|function|policy|trigger|type)\b/i
    );
    // the only DROP is the temp table of the report
    const drops = [...statements.matchAll(/\bdrop\b[^;]*/gi)].map(m =>
      m[0].trim().toLowerCase()
    );
    expect(drops).toEqual([
      'drop table if exists pg_temp.demo_bootstrap_report',
    ]);
    expect(code).toMatch(/drop table if exists pg_temp\.demo_bootstrap_report/);
    expect(statements).not.toMatch(/\b(grant|revoke)\b/i);
  });
});

describe('05-demo-bootstrap.sql: secrets', () => {
  it('contains no password, key, token or connection string', () => {
    expect(code).not.toMatch(/password\s+'/i);
    expect(code).not.toMatch(/\bpassword\b/i);
    expect(raw).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}/);
    expect(raw).not.toMatch(/sb_(secret|publishable)_/);
    expect(raw).not.toMatch(/service_role/i);
    expect(raw).not.toMatch(/postgres(ql)?:\/\//i);
    expect(statements).not.toMatch(/\b(crypt|gen_salt)\s*\(/i);
  });
});

describe('05-demo-bootstrap.sql: placeholders', () => {
  const placeholders = [
    ...code.matchAll(
      /\bv_(?:superadmin|trainer|trainee)_email\s+text\s*:=\s*'([^']*)'/g
    ),
  ].map(match => match[1]);
  const validation = /!~\s*'([^']+)'/.exec(code);

  it('declares exactly three e-mail variables with a placeholder', () => {
    expect(placeholders).toHaveLength(3);
    for (const placeholder of placeholders) {
      expect(placeholder).toMatch(/^<.+>$/);
    }
    // the three variables sit in the declare section of the DO block, above
    // the first statement that reads or writes a table
    expect(at(/v_superadmin_email\s+text/)).toBeGreaterThan(at(/\bdeclare\b/));
    expect(at(/v_trainee_email\s+text/)).toBeLessThan(at(/^begin\s*$/m));
    expect(at(/^begin\s*$/m)).toBeLessThan(at(/\bfrom public_preview\./i));
  });

  it('rejects every placeholder and accepts a real address', () => {
    expect(validation).not.toBeNull();
    // the pattern of the file is a POSIX ARE that is also valid JavaScript
    const valid = new RegExp(validation![1]);
    for (const placeholder of placeholders) {
      expect(valid.test(placeholder.toLowerCase())).toBe(false);
    }
    expect(valid.test('')).toBe(false);
    expect(valid.test('no-at-sign.example.org')).toBe(false);
    expect(valid.test('two words@example.org')).toBe(false);
    expect(valid.test('<ersetzen>@example.org')).toBe(false);
    expect(valid.test('azubi.test@example.org')).toBe(true);
  });

  it('checks the placeholders before it writes anything', () => {
    const check = at(/Platzhalter nicht ersetzt/);
    expect(check).toBeGreaterThan(-1);
    expect(check).toBeLessThan(at(/\binsert\s+into\b/i));
    expect(check).toBeLessThan(at(/\bupdate\s+public_preview\./i));
    // the addresses must differ, otherwise one profile gets two roles
    expect(code).toMatch(/v_emails\[1\] = v_emails\[2\]/);
    expect(code).toMatch(/v_emails\[2\] = v_emails\[3\]/);
  });

  it('matches the e-mail address the way the sync route stores it (lower case)', () => {
    expect(code).toMatch(/lower\(btrim\(v_superadmin_email\)\)/);
    expect(code).toMatch(/lower\(p\.email\) = v_emails\[v_i\]/);
  });
});

describe('05-demo-bootstrap.sql: transaction and preconditions', () => {
  it('runs in one transaction, the DO block between begin and commit', () => {
    const begin = at(/^\s*begin\s*;/im);
    const run = at(/\bdo\s+\$bootstrap\$/);
    const end = at(/^\s*commit\s*;/im);
    expect(begin).toBeGreaterThan(-1);
    expect(run).toBeGreaterThan(begin);
    expect(end).toBeGreaterThan(run);
    // exactly one begin and one commit, no early or second commit
    expect(code.match(/^\s*begin\s*;/gim)).toHaveLength(1);
    expect(code.match(/^\s*commit\s*;/gim)).toHaveLength(1);
    expect(code).not.toMatch(/^\s*rollback\s*;/im);
    // bounded waits, set local so they end with the transaction
    expect(code).toMatch(/set local lock_timeout/i);
    expect(code).toMatch(/set local statement_timeout/i);
  });

  it('ends with a read only report of the run (after the commit)', () => {
    const tail = code.slice(at(/^\s*commit\s*;/im)).trim();
    expect(tail).toMatch(/^commit\s*;\s*select\b/i);
    expect(tail).toMatch(/from pg_temp\.demo_bootstrap_report/);
    expect(tail.endsWith(';')).toBe(true);
  });

  it('stops with a clear message when the schema or the structure is missing', () => {
    const schema = at(/nspname = 'public_preview'/);
    expect(schema).toBeGreaterThan(-1);
    expect(code).toMatch(/Das Schema public_preview existiert nicht/);
    // the schema check precedes the first access to a Preview table
    expect(schema).toBeLessThan(at(/\bfrom public_preview\./i));
    expect(schema).toBeLessThan(at(/\binsert\s+into\s+public_preview\./i));
    // structure of the catalog series: tables, enum value, trigger, FIAE row
    expect(code).toMatch(/'organization_catalogs'/);
    expect(code).toMatch(/'training_catalogs'/);
    expect(code).toMatch(/enumlabel = 'SUPER_ADMIN'/);
    expect(code).toMatch(/tgname = 'organizations_enable_default_catalog'/);
    expect(code).toMatch(/Es wurde nichts geändert/);
  });
});

describe('05-demo-bootstrap.sql: organizations and accounts', () => {
  it('creates the platform organization with is_platform_owner and a demo company without it', () => {
    expect(code).toMatch(/c_platform_slug\s+constant text := '[a-z0-9-]+'/);
    expect(code).toMatch(/c_demo_slug\s+constant text := '[a-z0-9-]+'/);
    expect(code).toMatch(
      /c_demo_name\s+constant text := 'Demo-Ausbildungsbetrieb'/
    );
    expect(code).toMatch(/is_platform_owner/);
    expect(code).toMatch(/subscription_plan/);
    expect(code).toMatch(/max_trainee_seats/);
    expect(code).toMatch(/max_trainer_seats/);
    const seats = /c_trainee_seats\s+constant integer := (\d+)/.exec(code);
    expect(Number(seats?.[1])).toBeGreaterThanOrEqual(20);
  });

  it('is repeatable: looks before it inserts and only updates what differs', () => {
    // organizations: looked up first, inserted only when missing
    expect(at(/select\s+o\.id\s+into\s+v_org_id/i)).toBeGreaterThan(-1);
    expect(at(/select\s+o\.id\s+into\s+v_org_id/i)).toBeLessThan(
      at(/\binsert\s+into\s+public_preview\.organizations/i)
    );
    expect(code).not.toMatch(/\bon\s+conflict\b/i);
    // profiles: updated only where a value differs, so a second run changes nothing
    const profileUpdate = /update\s+public_preview\.profiles[\s\S]*?;/i.exec(
      code
    );
    expect(profileUpdate).not.toBeNull();
    expect(profileUpdate![0]).toMatch(/is distinct from/i);
    for (const column of [
      'role',
      'organization_id',
      'is_active',
      'trainer_activated',
    ]) {
      expect(profileUpdate![0]).toContain(column);
    }
  });

  it('assigns the three roles and the two organizations', () => {
    expect(code).toMatch(/'SUPER_ADMIN'/);
    expect(code).toMatch(/'TRAINER'/);
    expect(code).toMatch(/'TRAINEE'/);
    // the super admin belongs to the platform organization, the other two to
    // the demo company (index 1 and 2 of the organization ids)
    expect(code).toMatch(/v_org_ids\[1\]/);
    expect(code).toMatch(/v_org_ids\[2\]/);
  });

  it('skips accounts without a profile and does not create any', () => {
    expect(code).toMatch(/if not found then/i);
    expect(code).toMatch(/raise notice/i);
    expect(code).toMatch(/erst einmal anmelden/i);
    expect(code).toMatch(/Skript erneut ausführen/);
    // a profile is never inserted, profiles only come from the sign-in
    expect(statements).not.toMatch(
      /\binsert\s+into\s+public_preview\.profiles/i
    );
    // an account that sits in another organization is not moved
    expect(code).toMatch(/andere[nr]? Organisation/);
  });
});

describe('05-demo-bootstrap.sql: KfBM stays untouched', () => {
  it('never mentions KfBM and writes no catalog or enrollment rows', () => {
    expect(code).not.toMatch(/kfbm/i);
    expect(code).not.toMatch(/00000000-0000-4000-8000-000000000002/);
    expect(statements).not.toMatch(
      /\b(insert\s+into|update|delete\s+from)\s+public_preview\.(training_catalog\w*|organization_catalogs|trainee_enrollments|trainee_elective_choices)\b/i
    );
    // the catalog tables are only read
    expect(code).toMatch(/from public_preview\.organization_catalogs/);
    expect(code).toMatch(/from public_preview\.training_catalogs/);
  });

  it('relies on the trigger for the FIAE row and verifies it', () => {
    expect(code).toMatch(/organizations_enable_default_catalog/);
    expect(code).toMatch(/oc\.training_catalog_id = v_fiae_id/);
    expect(code).toMatch(
      /Trigger organizations_enable_default_catalog hat für die neue Organisation/
    );
  });
});

describe('05-demo-bootstrap.sql: header and wording', () => {
  it('documents who runs it, the effect and the shared authentication', () => {
    const header = raw.split(/\r?\n/).slice(0, 60).join('\n');
    expect(header).toMatch(/WHO\/WHEN/);
    expect(header).toMatch(/EFFECT/);
    expect(header).toMatch(/role postgres/);
    expect(header).toMatch(/SQL editor/i);
    expect(header).toMatch(/SHARED/);
    expect(header).toMatch(/Production/);
    expect(header).toMatch(/TRAINEE without an organization/);
    expect(header).toMatch(/throwaway password/i);
    expect(header).toMatch(/not run by any workflow/i);
  });

  it('writes the visible messages in German with real umlauts and no dashes', () => {
    expect(raw).not.toMatch(/[–—]/);
    expect(raw).toMatch(/[äöüß]/);
    const messages = [
      ...code.matchAll(
        /raise\s+(?:exception|notice|warning)\s+'((?:[^']|'')*)'/gi
      ),
    ].map(match => match[1]);
    expect(messages.length).toBeGreaterThan(8);
    for (const message of messages) {
      expect(message).not.toMatch(
        /\b(fuer|ueber|zurueck|geaendert|gueltig|koennen|muessen|pruef\w*|loesch\w*|aender\w*|ausfuehr\w*|uebersprungen)\b/i
      );
    }
  });
});
