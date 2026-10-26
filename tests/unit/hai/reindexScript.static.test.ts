/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

// Static checks of scripts/reindex-gemini.ts. The script runs its main() when
// it is loaded, so it cannot be imported by a test. The rules that can be
// decided without a database are in src/lib/hai/reindexArgs.ts (tested in
// reindexArgs.test.ts); these checks guard how the script uses them, and the
// behavior was run against the local database (see the pull request).

const script = fs
  .readFileSync(
    path.join(process.cwd(), 'scripts', 'reindex-gemini.ts'),
    'utf-8'
  )
  .replace(/\r\n/g, '\n');

/** Text of main() only. */
const main = script.slice(script.indexOf('async function main()'));

describe('reindex-gemini.ts protection', () => {
  it('validates the arguments first and stops on an error', () => {
    const parse = script.indexOf('parseReindexArgs(process.argv');
    const firstUse = script.indexOf('IS_DRY_RUN');
    expect(parse).toBeGreaterThan(0);
    expect(parse).toBeLessThan(firstUse);
    expect(script).toMatch(
      /if \(!parsedArgs\.ok\) \{[\s\S]*?process\.exit\(2\);/
    );
  });

  it('is a dry run unless --apply is given', () => {
    expect(script).toMatch(/const IS_DRY_RUN = !OPTIONS\.apply;/);
    expect(script).not.toMatch(/process\.argv\.includes\('--dry-run'\)/);
  });

  it('compares the target with host, current_schema and role before anything else', () => {
    const facts = main.indexOf('current_schema()');
    const check = main.indexOf('checkTargetAgainstConnection(');
    expect(facts).toBeGreaterThan(0);
    expect(check).toBeGreaterThan(facts);
    expect(main).toMatch(/current_user AS current_role/);
    // before the column check, the model test, the counts, purge and writes
    for (const later of [
      'generateEmbedding(',
      'purgeAllEmbeddings(db)',
      'results.courses',
      'SELECT COUNT(*) as count FROM hai_embeddings',
    ]) {
      expect(main.indexOf(later)).toBeGreaterThan(check);
    }
    expect(main).toMatch(
      /The target does not fit the connection\. Nothing was done\./
    );
  });

  it('hands the rollout gate value to the check (production)', () => {
    expect(main).toMatch(/\bprocess\.env\n?\s*\);/);
    expect(main).toMatch(/checkTargetAgainstConnection\(\s*OPTIONS,/);
  });

  it('makes no model call in a dry run', () => {
    // the API key check and the test embedding sit inside the apply branch
    const branch = main.indexOf('if (!IS_DRY_RUN) {\n    if (!GEMINI_API_KEY)');
    expect(branch).toBeGreaterThan(0);
    expect(main.indexOf('generateEmbedding(')).toBeGreaterThan(branch);
    // indexSource returns before any embedding in a dry run
    const dry = script.indexOf('if (IS_DRY_RUN) {\n    info(\n      `[DRY]');
    const embed = script.indexOf('generateEmbeddingsBatch(texts)');
    expect(dry).toBeGreaterThan(0);
    expect(dry).toBeLessThan(embed);
  });

  it('does not download PDFs in a dry run', () => {
    const dry = script.indexOf("'document (PDF files, not chunks)'");
    const download = script.indexOf('await extractPDFText(doc.storage_url)');
    expect(dry).toBeGreaterThan(0);
    expect(dry).toBeLessThan(download);
  });

  it('limits the purges to the catalog and never deletes the whole table', () => {
    expect(script).not.toMatch(/DELETE FROM hai_embeddings`;/);
    expect(script).not.toMatch(/db`DELETE FROM hai_embeddings`/);
    const purges = script.slice(
      script.indexOf('async function purgeAllEmbeddings'),
      script.indexOf('function printPlan')
    );
    const deletes = purges.match(/DELETE FROM hai_embeddings[\s\S]*?`;/g) ?? [];
    expect(deletes.length).toBe(2);
    for (const statement of deletes) {
      expect(statement).toMatch(/training_catalog_id = \$\{CATALOG_ID\}::uuid/);
    }
    // a purge without a resolved catalog deletes nothing
    expect(purges).toMatch(/if \(!CATALOG_ID\) \{/);
  });

  it('limits every source query to the catalog of --catalog', () => {
    const limited = script.match(
      /\$\{CATALOG_ID\}::uuid IS NULL OR [\w.()., ]*?= \$\{CATALOG_ID\}::uuid/g
    );
    // courses, enablers, use cases, 2 quiz variants, learning fields, 2
    // component variants, documents (COALESCE form)
    expect(limited!.length).toBeGreaterThanOrEqual(8);
    expect(script).toMatch(
      /COALESCE\(e\.training_catalog_id, uc\.training_catalog_id, c\.training_catalog_id\)/
    );
  });

  it('reads the learning fields from the catalog tables, not from the compatibility view', () => {
    expect(script).toMatch(/FROM training_catalog_learning_fields lf/);
    expect(script).toMatch(/FROM training_catalog_content_mappings lm/);
    expect(script).not.toMatch(/FROM lernfelder\b/);
    expect(script).not.toMatch(/FROM lernfeld_mappings\b/);
  });

  it('writes the scope columns in the upsert and refuses a chunk without a catalog', () => {
    expect(script).toMatch(
      /training_catalog_id, visibility, organization_id\s+\) VALUES/
    );
    expect(script).toMatch(
      /training_catalog_id = EXCLUDED\.training_catalog_id/
    );
    expect(script).toMatch(/visibility = EXCLUDED\.visibility/);
    expect(script).toMatch(/organization_id = EXCLUDED\.organization_id/);
    expect(script).toMatch(/no training catalog, not indexed/);
  });

  it('splits the quiz before chunking and writes the hint as its own chunk', () => {
    expect(script).toMatch(/buildQuizTexts\(/);
    expect(script).toMatch(/visibility: QUIZ_QUESTIONS_VISIBILITY/);
    expect(script).toMatch(/visibility: QUIZ_ANSWERS_VISIBILITY/);
    expect(script).toMatch(/visibility: SCENARIO_HINT_VISIBILITY/);
    expect(script).toMatch(/contentPart: 'hint'/);
    // the hint is no part of the enabler text
    expect(script).toMatch(/if \(e\.hint_text\) hintParts\.push/);
    expect(script).not.toMatch(/parts\.push\(`Hinweis:/);
  });

  it('keeps the solution pages of the use cases out of its stale cleanup', () => {
    expect(script).toMatch(
      /USE_CASE_PART: SourcePart = \{ offset: 0, staleBelow: 1000 \}/
    );
  });
});
