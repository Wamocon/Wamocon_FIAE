/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

/**
 * Static checks of 20261029000100_hai_embeddings_quiz_visibility.sql (package
 * H2). The file adapts the visibility function and the trigger of
 * 20261027000100: only a declared questions chunk without any answer marker
 * may be 'all'. The behavior of the SQL itself was run against the local
 * database (see the pull request).
 */

const MIGRATIONS_DIR = path.join(process.cwd(), 'supabase', 'migrations');
const FILE = '20261029000100_hai_embeddings_quiz_visibility.sql';
const raw = fs.readFileSync(path.join(MIGRATIONS_DIR, FILE), 'utf-8');
const header = raw
  .split(/\r?\n/)
  .filter(line => line.startsWith('--'))
  .join('\n');
const sql = raw
  .split(/\r?\n/)
  .filter(line => !line.trim().startsWith('--'))
  .join('\n');
const visibilityFn =
  /create or replace function public\.hai_embedding_visibility[\s\S]*?\$\$;/i.exec(
    sql
  )![0];

describe('hai_embeddings quiz visibility migration', () => {
  it('sorts behind the scope migration and keeps the conventions of the series', () => {
    expect(FILE > '20261027000100_hai_embeddings_scope.sql').toBe(true);
    expect(FILE).toMatch(/^\d{14}_[a-z0-9_]+\.sql$/);
    expect(sql).toMatch(/set\s+local\s+lock_timeout\s*=\s*'5s'/i);
    expect(sql).toMatch(/set\s+local\s+statement_timeout\s*=\s*'60s'/i);
    expect(sql).not.toMatch(/^\s*(begin|commit|rollback)\s*;/im);
    expect(sql).not.toMatch(
      /\b(create|alter|drop)\s+(extension|role|user|publication|policy)\b/i
    );
  });

  it('checks that the scope migration ran and changes nothing otherwise', () => {
    expect(sql).toMatch(/to_regclass\('public\.hai_embeddings'\)/);
    expect(sql).toMatch(
      /to_regprocedure\('public\.hai_embedding_visibility\(text, uuid, text, jsonb\)'\)/
    );
    expect(sql).toMatch(/raise exception/i);
  });

  it('changes no data: no insert, update or delete, no backfill', () => {
    expect(sql).not.toMatch(
      /\b(insert\s+into|update\s+public|delete\s+from)\b/i
    );
  });

  it('no longer lifts every quiz chunk', () => {
    expect(visibilityFn).not.toMatch(
      /when p_source_type = 'quiz' then 'trainer'/
    );
  });

  it('lifts a quiz chunk unless it is a declared questions chunk without a marker', () => {
    expect(visibilityFn).toMatch(
      /p_source_type = 'quiz' and not \(\s*coalesce\(p_metadata ->> 'contentPart', ''\) = 'questions'\s+and coalesce\(p_content, ''\) !~/
    );
    // the check mark, the cross, the explanation and the expected answer
    expect(visibilityFn).toMatch(/chr\(10003\)/);
    expect(visibilityFn).toMatch(/chr\(10007\)/);
    expect(visibilityFn).toMatch(/Erkl\.rung:/);
    expect(visibilityFn).toMatch(/Erwartete Antwort:/);
    expect(visibilityFn).toMatch(/then 'trainer'\s+else 'all'/);
  });

  it('is fail closed: a missing contentPart cannot fall through to all', () => {
    // coalesce on both operands: NULL would make "not (...)" NULL, and a CASE
    // branch with NULL is skipped, which would end in 'all'
    expect(visibilityFn).toMatch(
      /coalesce\(p_metadata ->> 'contentPart', ''\)/
    );
    expect(visibilityFn).toMatch(/coalesce\(p_content, ''\)/);
  });

  it('keeps the rules for trainer solutions and trainer-only documents', () => {
    expect(visibilityFn).toMatch(
      /p_metadata ->> 'documentType' = 'TRAINER_SOLUTION' then 'trainer'/
    );
    expect(visibilityFn).toMatch(/d\.document_type = 'TRAINER_SOLUTION'/);
    expect(visibilityFn).toMatch(/d\.visibility = 'TRAINER_ONLY'/);
  });

  it('keeps the definer settings and the signature of the function', () => {
    expect(visibilityFn).toMatch(
      /hai_embedding_visibility\(\s*p_source_type text,\s*p_source_id uuid,\s*p_content text,\s*p_metadata jsonb\s*\)/
    );
    expect(visibilityFn).toMatch(/security definer\s+set search_path = ''/);
  });

  it('runs the trigger for the scope columns as well, still before insert or update', () => {
    expect(sql).toMatch(/drop trigger if exists hai_embeddings_set_scope/i);
    expect(sql).toMatch(
      /create trigger hai_embeddings_set_scope\s+before insert or update of source_type, source_id, content, metadata,\s+visibility, training_catalog_id, organization_id\s+on public\.hai_embeddings/i
    );
  });

  it('documents why, the existing chunks and the undo in the header', () => {
    expect(header).toMatch(/quizIndexText/);
    expect(header).toMatch(/contentPart/);
    expect(header).toMatch(/stay 'trainer' until the quiz is indexed again/);
    expect(header).toMatch(/fail closed/i);
    expect(header).toMatch(/rollout gate/i);
    expect(header).toMatch(/Production is not\s+-- migrated/);
    expect(header).toMatch(/Undo/);
  });
});
