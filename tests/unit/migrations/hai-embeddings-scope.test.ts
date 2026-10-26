/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';
import { getTableConfig } from 'drizzle-orm/pg-core';
import { haiEmbeddings } from '@/db/migrations/schemas/schema';

/**
 * Static checks of 20261027000100_hai_embeddings_scope.sql (package H1 of the
 * HAI plan). The file adds occupation, visibility and organization to the
 * vector index and derives them for the existing rows. The SQL itself was run
 * against a local database inside a rolled back transaction with fixtures for
 * every backfill rule (see the pull request); these tests guard the
 * conventions of the release pipeline, the shape of the change and the rules
 * of the backfill.
 */

const ROOT = process.cwd();
const MIGRATIONS_DIR = path.join(ROOT, 'supabase', 'migrations');
const FILE = '20261027000100_hai_embeddings_scope.sql';

const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, FILE), 'utf-8');
const header = raw
  .split(/\r?\n/)
  .filter(line => line.startsWith('--'))
  .join('\n');
/** SQL without line comments (the file documents itself in comments). */
const sql = raw
  .split(/\r?\n/)
  .filter(line => !line.trim().startsWith('--'))
  .join('\n');

const allFiles = fs
  .readdirSync(MIGRATIONS_DIR)
  .filter(name => name.endsWith('.sql'))
  .sort();

describe('hai_embeddings scope migration: place in the series', () => {
  it('has a 14 digit version and a lowercase name', () => {
    expect(FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
  });

  it('sorts behind every other migration of the catalog series', () => {
    const behind = [
      '20261024001100_trainee_enrollments.sql',
      '20261025000000_super_admin_backfill.sql',
      '20261025000100_security_revoke_public_create.sql',
      '20261026000100_trainee_enrollments_one_per_trainee.sql',
    ];
    for (const earlier of behind) {
      expect(allFiles).toContain(earlier);
      expect(FILE > earlier).toBe(true);
    }
  });

  it('is held back by the rollout gate (no production effect)', () => {
    const gate = fs.readFileSync(
      path.join(ROOT, 'scripts', 'db', 'rollout-gate.mjs'),
      'utf-8'
    );
    const gatedFrom = /GATED_FROM = '(\d{14})'/.exec(gate)![1];
    expect(FILE.slice(0, 14) >= gatedFrom).toBe(true);
  });
});

describe('hai_embeddings scope migration: conventions', () => {
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

  it('qualifies every table, function and trigger target with public.', () => {
    const unqualified = [
      ...sql.matchAll(
        /\b(?:create|alter|drop)\s+(?:or\s+replace\s+)?(?:table|view|function)\s+(?:if\s+(?:not\s+)?exists\s+)?(?!public\.|if\s)([a-z_][a-z0-9_.]*)/gi
      ),
    ].map(match => match[1]);
    expect(unqualified).toEqual([]);
    expect(sql).toMatch(/to_regclass\('public\.hai_embeddings'\)/);
    expect(sql).not.toMatch(/\bfrom\s+hai_embeddings\b/i);
  });

  it('uses no catalog lookup that the Preview rewrite cannot place', () => {
    expect(sql).not.toMatch(/table_schema\s*=\s*'public'/i);
    expect(sql).not.toMatch(/schemaname\s*=\s*'public'/i);
    expect(sql).not.toMatch(/nspname\s*=\s*'public'/i);
  });

  it('keeps every identifier within the 63 character limit', () => {
    const names = [
      ...sql.matchAll(/\bconstraint\s+([a-z_][a-z0-9_]*)/gi),
      ...sql.matchAll(
        /\bcreate\s+(?:unique\s+)?index\s+(?:if\s+not\s+exists\s+)?([a-z_][a-z0-9_]*)/gi
      ),
      ...sql.matchAll(/\bcreate\s+trigger\s+([a-z_][a-z0-9_]*)/gi),
    ].map(match => match[1]);
    expect(names.length).toBeGreaterThanOrEqual(5);
    expect(names.filter(name => name.length > 63)).toEqual([]);
  });

  it('documents what it does, the rules, the gate and the undo in the header', () => {
    expect(header).toMatch(/training_catalog_id/);
    expect(header).toMatch(/visibility/);
    expect(header).toMatch(/organization_id/);
    expect(header).toMatch(/fail closed/i);
    expect(header).toMatch(/no model call/i);
    expect(header).toMatch(/rollout[\s-]+gate/i);
    expect(header).toMatch(/Production is not migrated/);
    expect(header).toMatch(/undo/i);
    expect(header).toMatch(/drop column if exists training_catalog_id/);
  });

  it('is idempotent: if not exists, create or replace, backfill only where missing', () => {
    expect(sql.match(/add column if not exists/gi)).toHaveLength(3);
    expect(sql).toMatch(/create index if not exists idx_hai_embeddings_scope/i);
    expect(sql).toMatch(
      /create index if not exists idx_hai_embeddings_organization/i
    );
    expect(sql).toMatch(/drop trigger if exists hai_embeddings_set_scope/i);
    expect(sql).toMatch(
      /drop trigger if exists content_documents_follow_hai_scope/i
    );
    expect(sql.match(/create or replace function/gi)).toHaveLength(5);
    // the backfill touches only rows that still need a value
    expect(sql).toMatch(/where h\.training_catalog_id is null/);
    expect(sql).toMatch(/h\.organization_id is null\s+and/);
    expect(sql).toMatch(/h\.visibility <> 'trainer'\s+and/);
  });

  it('has no destructive statement', () => {
    expect(sql).not.toMatch(/\bdrop\s+(table|column|schema)\b/i);
    expect(sql).not.toMatch(/\btruncate\b/i);
    expect(sql).not.toMatch(/\bdelete\s+from\b/i);
  });
});

describe('hai_embeddings scope migration: prechecks', () => {
  const precheck = /do\s+\$\$[\s\S]*?\$\$\s*;/i.exec(sql)![0];

  it('stops before any change if the table, the catalog series or FIAE is missing', () => {
    expect(precheck).toMatch(/to_regclass\('public\.hai_embeddings'\)/);
    expect(precheck).toMatch(/to_regclass\('public\.training_catalogs'\)/);
    expect(precheck).toMatch(/to_regclass\('public\.trainee_enrollments'\)/);
    expect(precheck).toMatch(/00000000-0000-4000-8000-000000000001/);
    expect(precheck.match(/raise exception/gi)).toHaveLength(3);
    expect(precheck.match(/Nothing was changed/g)).toHaveLength(3);
  });

  it('raises exceptions only in the prechecks, never in the backfill', () => {
    const lastException = sql.lastIndexOf('raise exception');
    expect(lastException).toBeLessThan(sql.search(/alter table/i));
  });
});

describe('hai_embeddings scope migration: columns', () => {
  const alter = /alter table public\.hai_embeddings[\s\S]*?;/i.exec(sql)![0];

  it('adds training_catalog_id, nullable, with a foreign key to training_catalogs', () => {
    expect(alter).toMatch(
      /add column if not exists training_catalog_id uuid\s+constraint hai_embeddings_training_catalog_fk\s+references public\.training_catalogs \(id\) on delete restrict/i
    );
    expect(alter).not.toMatch(/training_catalog_id uuid\s+not null/i);
  });

  it("adds visibility as not null default 'all' with a check for all and trainer", () => {
    expect(alter).toMatch(
      /add column if not exists visibility text not null default 'all'\s+constraint hai_embeddings_visibility_check\s+check \(visibility in \('all', 'trainer'\)\)/i
    );
  });

  it('adds organization_id with a foreign key to organizations (cascade, see header)', () => {
    expect(alter).toMatch(
      /add column if not exists organization_id uuid\s+constraint hai_embeddings_organization_fk\s+references public\.organizations \(id\) on delete cascade/i
    );
    expect(header).toMatch(/ON DELETE CASCADE/);
    expect(header).toMatch(/deviation from "set null"/);
  });

  it('indexes (training_catalog_id, visibility)', () => {
    expect(sql).toMatch(
      /create index if not exists idx_hai_embeddings_scope\s+on public\.hai_embeddings \(training_catalog_id, visibility\)/i
    );
    expect(sql).not.toMatch(/\bconcurrently\b/i);
  });

  it('comments the three columns', () => {
    for (const column of [
      'training_catalog_id',
      'visibility',
      'organization_id',
    ]) {
      expect(sql).toContain(
        `comment on column public.hai_embeddings.${column}`
      );
    }
  });
});

describe('hai_embeddings scope migration: backfill rules', () => {
  const catalogFn = /function public\.hai_embedding_catalog[\s\S]*?\$\$;/i.exec(
    sql
  )![0];
  const organizationFn =
    /function public\.hai_embedding_organization[\s\S]*?\$\$;/i.exec(sql)![0];
  const visibilityFn =
    /function public\.hai_embedding_visibility[\s\S]*?\$\$;/i.exec(sql)![0];

  it('derives the catalog by source_id from every content table', () => {
    for (const table of [
      'enablers',
      'courses',
      'use_cases',
      'quizzes',
      'training_catalog_learning_fields',
      'training_components',
    ]) {
      expect(catalogFn).toMatch(
        new RegExp(`from public\\.${table} \\w+ where \\w+\\.id = p_source_id`)
      );
    }
  });

  it('reaches documents through enabler, use case or course, by source_id or documentId', () => {
    expect(catalogFn).toMatch(/from public\.content_documents d/);
    expect(catalogFn).toMatch(
      /left join public\.enablers de on de\.id = d\.enabler_id/
    );
    expect(catalogFn).toMatch(
      /left join public\.use_cases du on du\.id = d\.use_case_id/
    );
    expect(catalogFn).toMatch(
      /left join public\.courses dc on dc\.id = d\.course_id/
    );
    // compared as uuid (primary key index), the documentId text is checked first
    expect(catalogFn).toMatch(/where d\.id = p_source_id\s+or d\.id = case when p_metadata ->> 'documentId' ~\* '\^\[0-9a-f\]\{8\}-/);
    expect(catalogFn).not.toMatch(/d\.id::text/);
  });

  it('gives personal rows the catalog of the enrollment, otherwise FIAE', () => {
    expect(catalogFn).toMatch(/p_source_type like 'trainee\\_%'/);
    expect(catalogFn).toMatch(/from public\.trainee_enrollments te/);
    expect(catalogFn).toMatch(/te\.trainee_id = p_source_id/);
    expect(catalogFn).toMatch(/order by te\.start_date desc nulls last/);
    expect(catalogFn).toMatch(/'00000000-0000-4000-8000-000000000001'::uuid/);
  });

  it('takes the organization from content_documents.organization_id', () => {
    expect(organizationFn).toMatch(/select d\.organization_id/);
    expect(organizationFn).toMatch(/from public\.content_documents d/);
    expect(organizationFn).toMatch(/where d\.id = p_source_id\s+or d\.id = case when p_metadata ->> 'documentId' ~\* '\^\[0-9a-f\]\{8\}-/);
    expect(organizationFn).not.toMatch(/d\.id::text/);
  });

  it('marks trainer solutions and trainer-only documents as trainer', () => {
    expect(visibilityFn).toMatch(
      /p_metadata ->> 'documentType' = 'TRAINER_SOLUTION' then 'trainer'/
    );
    expect(visibilityFn).toMatch(/d\.document_type = 'TRAINER_SOLUTION'/);
    expect(visibilityFn).toMatch(/d\.visibility = 'TRAINER_ONLY'/);
  });

  it('marks every quiz chunk as trainer (answers can sit in a chunk without a marker)', () => {
    expect(visibilityFn).toMatch(/when p_source_type = 'quiz' then 'trainer'/);
    expect(visibilityFn).toMatch(/else 'all'/);
    // no per chunk detection by marker: a continuation chunk would leak the
    // tail of an explanation or expected answer
    expect(visibilityFn).not.toMatch(/p_content like/);
    expect(visibilityFn).not.toMatch(/chr\(1000[37]\)/);
    expect(header).toMatch(/EVERY quiz chunk/);
    // the writers do mix questions and answers in one text, which is why
    const reindex = fs.readFileSync(
      path.join(ROOT, 'scripts', 'reindex-gemini.ts'),
      'utf-8'
    );
    const embedRoute = fs.readFileSync(
      path.join(ROOT, 'src', 'app', 'api', 'hai', 'embed', 'route.ts'),
      'utf-8'
    );
    for (const writer of [reindex, embedRoute]) {
      expect(writer).toContain("'✓' : '✗'");
      expect(writer).toContain('Erwartete Antwort:');
      expect(writer).toContain('Erklärung:');
    }
  });

  it('keeps enabler chunks visible (the hint cannot be separated, see header)', () => {
    expect(visibilityFn).not.toMatch(/p_source_type = 'enabler'/);
    expect(header).toMatch(/hint_text/);
  });

  it('backfills the three columns with one UPDATE, using the functions', () => {
    const backfill = /update public\.hai_embeddings h\s+set training_catalog_id[\s\S]*?;/i.exec(
      sql
    )![0];
    expect(backfill).toMatch(
      /training_catalog_id = coalesce\(\s+h\.training_catalog_id,\s+public\.hai_embedding_catalog\(h\.source_type, h\.source_id, h\.metadata\)/
    );
    expect(backfill).toMatch(
      /organization_id = coalesce\(\s+h\.organization_id,\s+public\.hai_embedding_organization\(h\.source_id, h\.metadata\)/
    );
    expect(backfill).toMatch(/visibility = case/);
    // never lowers the visibility
    expect(backfill).toMatch(/else h\.visibility/);
    expect(backfill).not.toMatch(/'all'/);
    // the indexes are built after the backfill
    expect(sql.search(/create index if not exists idx_hai_embeddings_scope/i)).toBeGreaterThan(
      sql.search(/update public\.hai_embeddings h\s+set training_catalog_id/i)
    );
  });

  it('assigns rows without a derivable catalog to FIAE and reports the number per source_type', () => {
    const fallback = /for r in[\s\S]*?end \$\$;/i.exec(sql)![0];
    expect(fallback).toMatch(/group by h\.source_type/);
    expect(fallback).toMatch(/raise notice/i);
    expect(fallback).toMatch(
      /set training_catalog_id = '00000000-0000-4000-8000-000000000001'\s+where training_catalog_id is null/
    );
    expect(fallback).toMatch(/group by h\.source_type, h\.visibility/);
    // never aborts because of the fallback rows
    expect(fallback).not.toMatch(/raise exception/i);
  });

  it('makes no model call and reads no external source', () => {
    expect(sql).not.toMatch(/\b(http|net\.|dblink|copy)\b/i);
    expect(sql).not.toMatch(/embedding\s*=/i);
    expect(sql).not.toMatch(/\bgemini\b|\bopenai\b/i);
  });
});

describe('hai_embeddings scope migration: trigger for the existing writers', () => {
  const triggerFn =
    /function public\.hai_embeddings_set_scope[\s\S]*?\$\$;/i.exec(sql)![0];

  it('derives the columns before insert and before a change of the source', () => {
    expect(sql).toMatch(
      /create trigger hai_embeddings_set_scope\s+before insert or update of source_type, source_id, content, metadata\s+on public\.hai_embeddings\s+for each row\s+execute function public\.hai_embeddings_set_scope\(\)/i
    );
  });

  it('fills only missing values and only raises the visibility', () => {
    expect(triggerFn).toMatch(/if new\.training_catalog_id is null then/);
    expect(triggerFn).toMatch(/if new\.organization_id is null then/);
    expect(triggerFn).toMatch(
      /if new\.visibility is distinct from 'trainer'\s+and public\.hai_embedding_visibility\([^)]*\) = 'trainer' then\s+new\.visibility := 'trainer'/
    );
    expect(triggerFn).not.toMatch(/new\.visibility := 'all'/);
  });

  it('takes the chunks along when a document changes later', () => {
    const followFn = /function public\.hai_embeddings_follow_document[\s\S]*?\$\$;/i.exec(
      sql
    )![0];
    expect(sql).toMatch(
      /create trigger content_documents_follow_hai_scope\s+after update of document_type, visibility, organization_id\s+on public\.content_documents\s+for each row\s+execute function public\.hai_embeddings_follow_document\(\)/i
    );
    // a solution or trainer-only document raises its chunks, never lowers them
    expect(followFn).toMatch(
      /new\.document_type = 'TRAINER_SOLUTION' or new\.visibility = 'TRAINER_ONLY'/
    );
    expect(followFn).toMatch(/set visibility = 'trainer'\s+where h\.visibility <> 'trainer'/);
    expect(followFn).not.toMatch(/visibility = 'all'/);
    // the organization follows the document
    expect(followFn).toMatch(/new\.organization_id is distinct from old\.organization_id/);
    expect(followFn).toMatch(/set organization_id = new\.organization_id/);
    // the chunks of a document are found by source_id and by metadata.documentId
    expect(followFn).toMatch(
      /h\.source_id = new\.id or h\.metadata ->> 'documentId' = new\.id::text/
    );
  });

  it('runs the functions as definer with an empty search_path', () => {
    const definers = sql.match(/security definer\s+set search_path = ''/gi);
    expect(definers).toHaveLength(5);
  });

  it('takes the execute right of the four functions from PUBLIC, anon and authenticated', () => {
    for (const fn of [
      'public.hai_embedding_catalog(text, uuid, jsonb)',
      'public.hai_embedding_organization(uuid, jsonb)',
      'public.hai_embedding_visibility(text, uuid, text, jsonb)',
      'public.hai_embeddings_set_scope()',
      'public.hai_embeddings_follow_document()',
    ]) {
      expect(sql).toContain(`'${fn}'`);
    }
    expect(sql).toMatch(/revoke execute on function %s from public/);
    expect(sql).toMatch(/array\['anon', 'authenticated'\]/);
    expect(sql).toMatch(/revoke execute on function %s from %I/);
  });
});

describe('writers of hai_embeddings (expected gap, follow-up package H2)', () => {
  /**
   * Every INSERT into hai_embeddings in the code base. None of them sets the
   * new columns yet: the trigger of the migration derives them. This is the
   * documented gap. A new writer, or a writer that starts to set the columns,
   * fails this test on purpose so that the follow-up package H2 (explicit
   * columns from the scope, separate quiz chunks) is a conscious change.
   */
  const KNOWN_WRITERS = [
    'scripts/reindex-gemini.ts',
    'src/lib/hai/embeddings.ts',
    'src/lib/hai/ingestUseCase.ts',
  ];

  function walk(dir: string): string[] {
    return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        return entry.name === 'node_modules' || entry.name === '.next'
          ? []
          : walk(full);
      }
      return /\.(ts|tsx|mjs|js)$/.test(entry.name) ? [full] : [];
    });
  }

  const insertPaths = [
    ...walk(path.join(ROOT, 'src')),
    ...walk(path.join(ROOT, 'scripts')),
  ]
    .map(file => ({
      file: path.relative(ROOT, file).split(path.sep).join('/'),
      text: fs.readFileSync(file, 'utf-8'),
    }))
    .map(({ file, text }) => ({
      file,
      statements: [
        ...text.matchAll(
          /INSERT INTO hai_embeddings\s*\(([\s\S]*?)\)\s*VALUES/g
        ),
      ].map(match => match[1]),
    }))
    .filter(entry => entry.statements.length > 0);

  it('finds exactly the three known INSERT paths', () => {
    expect(insertPaths.map(entry => entry.file).sort()).toEqual(KNOWN_WRITERS);
  });

  it('reports the gap: no writer sets the scope columns itself yet', () => {
    for (const entry of insertPaths) {
      for (const columns of entry.statements) {
        expect(columns).not.toMatch(/training_catalog_id/);
        expect(columns).not.toMatch(/\bvisibility\b/);
        expect(columns).not.toMatch(/organization_id/);
      }
    }
  });

  it('is closed by the trigger: a row without the columns still gets them', () => {
    expect(sql).toMatch(
      /before insert or update of source_type, source_id, content, metadata/
    );
    // the upsert of every writer updates content and metadata, so a changed
    // chunk is derived again (visibility can only go up)
    for (const file of KNOWN_WRITERS) {
      const text = fs.readFileSync(path.join(ROOT, file), 'utf-8');
      expect(text).toMatch(
        /ON CONFLICT \(source_type, source_id, chunk_index\)/
      );
      expect(text).toMatch(/metadata = EXCLUDED\.metadata/);
    }
  });
});

describe('Drizzle schema of hai_embeddings', () => {
  const config = getTableConfig(haiEmbeddings);
  const column = (name: string) => config.columns.find(c => c.name === name)!;

  it('declares the three columns like the migration', () => {
    expect(column('training_catalog_id').notNull).toBe(false);
    expect(column('organization_id').notNull).toBe(false);
    expect(column('visibility').notNull).toBe(true);
    expect(column('visibility').default).toBe('all');
  });

  it('declares the foreign keys with the names and actions of the migration', () => {
    const keys = Object.fromEntries(
      config.foreignKeys.map(fk => [fk.getName(), fk.onDelete])
    );
    expect(keys).toEqual({
      hai_embeddings_training_catalog_fk: 'restrict',
      hai_embeddings_organization_fk: 'cascade',
    });
  });

  it('declares the check constraint and the index with the names of the migration', () => {
    expect(config.checks.map(check => check.name)).toEqual([
      'hai_embeddings_visibility_check',
    ]);
    const index = config.indexes.find(
      i => i.config.name === 'idx_hai_embeddings_scope'
    );
    expect(index).toBeDefined();
    expect(
      index!.config.columns.map(c => (c as { name: string }).name)
    ).toEqual(['training_catalog_id', 'visibility']);
  });
});
