/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static checks of supabase/preview-setup/06-copy-content-from-production.sql,
 * the template a human runs by hand in the Supabase SQL editor to copy the
 * training content of Production (schema public) into the Preview (schema
 * public_preview) until the catalog model is rolled out. The behaviour was run
 * against the real Preview in a dry run and for real; these tests keep the
 * guard rails in place.
 */

const FILE = path.join(
  process.cwd(),
  'supabase',
  'preview-setup',
  '06-copy-content-from-production.sql'
);
const raw = fs.readFileSync(FILE, 'utf-8');

/** The SQL without line comments (the file documents itself in comments). */
const code = raw
  .split(/\r?\n/)
  .map(line => line.replace(/--.*$/, ''))
  .join('\n');
/** Code with every string literal blanked, so only statements remain. */
const statements = code.replace(/'(?:[^']|'')*'/g, "''");

const allowlist = JSON.parse(
  fs.readFileSync(
    path.join(process.cwd(), 'supabase', 'content-tables.json'),
    'utf-8'
  )
) as { tables: { name: string; columns: string[] }[] };

/** The content tables the template copies, in the order of the file. */
const COPIED = [
  'courses',
  'enablers',
  'use_cases',
  'content_documents',
  'quizzes',
  'enabler_quizzes',
  'enabler_quiz_links',
  'questions',
  'options',
];

/** Offset of the first match of a pattern in the code, or -1. */
function at(pattern: RegExp): number {
  return code.search(pattern);
}

/** Targets of all insert statements (blanked literals, so only statements). */
function insertTargets(): string[] {
  return [...statements.matchAll(/\binsert\s+into\s+([a-z_.]+)/gi)].map(
    m => m[1]
  );
}

describe('06-copy-content-from-production.sql: Production is only read', () => {
  it('never writes, changes or locks anything in the schema public', () => {
    expect(statements).not.toMatch(
      /\b(insert\s+into|update|delete\s+from|truncate(?:\s+table)?|alter\s+table|drop\s+table|create\s+table|lock\s+table|copy)\s+(?:only\s+)?(?:public\.|"public"\.)/i
    );
    for (const target of insertTargets()) {
      expect(target).toMatch(/^(public_preview\.[a-z_]+|content_copy_report)$/);
    }
  });

  it('reads public only from the content tables and lernfelder', () => {
    const reads = [...statements.matchAll(/\bfrom\s+public\.([a-z_]+)/gi)].map(
      m => m[1]
    );
    const allowed = new Set([...COPIED, 'lernfelder']);
    expect(reads.length).toBeGreaterThan(COPIED.length);
    expect(reads.filter(name => !allowed.has(name))).toEqual([]);
  });

  it('does not touch Auth, Storage or any other schema', () => {
    expect(statements).not.toMatch(
      /\b(auth|storage|realtime|extensions|vault|graphql|supabase_migrations|preview_meta|preview_support)\s*\./i
    );
    expect(statements).not.toMatch(/\bsearch_path\b/i);
    expect(statements).not.toMatch(/\bsession_replication_role\b/i);
  });
});

describe('06-copy-content-from-production.sql: only training content', () => {
  it('copies exactly the listed content tables, in the order of the allowlist', () => {
    const inserted = [
      ...statements.matchAll(
        /\binsert\s+into\s+public_preview\.([a-z_]+)\s*\(/gi
      ),
    ].map(m => m[1]);
    expect(inserted).toEqual([...COPIED, 'training_catalog_learning_fields']);
    const order = allowlist.tables
      .map(t => t.name)
      .filter(name => COPIED.includes(name));
    expect(order).toEqual(COPIED);
  });

  it('copies only columns of the allowlist (plus the id)', () => {
    for (const table of COPIED) {
      const match = new RegExp(
        `insert into public_preview\\.${table} \\(([^)]*)\\)`,
        'i'
      ).exec(statements);
      expect(match).not.toBeNull();
      const columns = match![1].split(',').map(c => c.trim());
      const allowed = new Set([
        'id',
        ...(allowlist.tables.find(t => t.name === table)?.columns ?? []),
      ]);
      expect(columns.filter(c => !allowed.has(c))).toEqual([]);
    }
  });

  it('never copies a table that holds user or organization data', () => {
    const forbidden =
      /^(profiles|organizations|organization_catalogs|course_members|notifications|knowledge_notes|trainee_[a-z_]+|activity_[a-z_]+|quiz_(assignments|members|submissions|submission_answers)|[a-z_]*submissions?|enabler_completions|progress|ausbildung_blocks|school_exam[a-z_]*|weekly_[a-z_]+|annual_[a-z_]+|work_certificates|grade_edit_history|hai_[a-z_]+|[a-z_]*embedding[a-z_]*)$/i;
    for (const target of insertTargets()) {
      expect(target.replace(/^public_preview\./, '')).not.toMatch(forbidden);
    }
    // profiles is only read to find the platform administrator, in the Preview
    expect(statements).toMatch(/from\s+public_preview\.profiles\s+p/i);
    expect(statements).not.toMatch(/from\s+public\.profiles/i);
  });

  it('sets the creator to the platform administrator and leaves organization and uploader empty', () => {
    const courses =
      /insert into public_preview\.courses[\s\S]*?on conflict/i.exec(
        statements
      )![0];
    expect(courses).toMatch(/\bv_owner_id\b/);
    expect(courses).not.toMatch(/s\.created_by_id/);
    const documents =
      /insert into public_preview\.content_documents[\s\S]*?on conflict/i.exec(
        statements
      )![0];
    expect(documents).not.toMatch(/s\.organization_id/);
    expect(documents).not.toMatch(/s\.uploaded_by_id/);
  });
});

describe('06-copy-content-from-production.sql: safety for the person who runs it', () => {
  it('runs in one transaction with time limits', () => {
    expect(statements).toMatch(/^\s*begin;/im);
    expect((statements.match(/\bcommit;/gi) ?? []).length).toBe(1);
    expect(statements).toMatch(/set local lock_timeout/i);
    expect(statements).toMatch(/set local statement_timeout/i);
  });

  it('is a rehearsal by default and only copies when switched on', () => {
    expect(code).toMatch(/v_dry_run\s+boolean\s*:=\s*true\s*;/i);
    expect(code).toMatch(/if\s+v_dry_run\s+then[\s\S]*?raise\s+exception/i);
    // the rehearsal ends before the report of a real run is written
    expect(at(/if\s+v_dry_run\s+then/i)).toBeLessThan(
      at(/insert\s+into\s+content_copy_report\s*\(sort_order/i)
    );
  });

  it('refuses to start while the e-mail address is still the placeholder', () => {
    expect(code).toMatch(/v_owner_email\s+text\s*:=\s*'<[^']+>'\s*;/i);
    expect(code).toMatch(/Platzhalter nicht ersetzt/);
    // the placeholder is rejected before the first write
    expect(at(/Platzhalter nicht ersetzt/)).toBeLessThan(
      at(/insert\s+into\s+public_preview\.courses/i)
    );
  });

  it('stops before any write when a precondition fails', () => {
    const firstWrite = at(/insert\s+into\s+public_preview\.courses/i);
    for (const message of [
      'Das Schema public_preview existiert nicht',
      'Production hat das Katalogmodell schon',
      'fehlt in public oder in public_preview',
      'Die Lernfeld-Struktur fehlt in public_preview',
      'gibt es kein Profil für',
      'Der Katalog FIAE fehlt',
    ]) {
      const position = at(new RegExp(message));
      expect(position).toBeGreaterThan(-1);
      expect(position).toBeLessThan(firstWrite);
    }
  });

  it('is idempotent: rows are matched by id or by key and nothing is deleted', () => {
    expect(statements).not.toMatch(/\bdelete\s+from\b/i);
    expect(statements).not.toMatch(/\btruncate\b/i);
    const conflicts = statements.match(/on conflict[^;]*;/gi) ?? [];
    expect(conflicts.length).toBe(COPIED.length + 1);
    for (const clause of conflicts) {
      expect(clause).toMatch(/on conflict (\(id\) )?do nothing/i);
    }
  });

  it('contains no password, key, token or connection string', () => {
    expect(raw).not.toMatch(
      /(password|passwort|secret|service_role|apikey|api_key|bearer|eyJ[A-Za-z0-9_-]{10,}|postgres(?:ql)?:\/\/)/i
    );
  });
});
