/**
 * @jest-environment node
 */
import * as fs from 'fs';
import * as path from 'path';

// Static checks of the sources that scripts/reindex-gemini.ts indexes (package
// KI5.3). The script runs its main() when it is loaded, so a test cannot import
// it: the decisions are in src/lib/hai/indexScope.ts (documentIndexPlan.test.ts),
// these checks guard how the script uses them.

const script = fs
  .readFileSync(
    path.join(process.cwd(), 'scripts', 'reindex-gemini.ts'),
    'utf-8'
  )
  .replace(/\r\n/g, '\n');

const documents = script.slice(
  script.indexOf('async function indexPDFDocuments'),
  script.indexOf('// PURGE FUNCTIONS')
);

describe('reindex-gemini.ts: documents', () => {
  it('lets planDocumentIndexing decide, the script keeps no rule of its own', () => {
    expect(documents).toMatch(/planDocumentIndexing\(/);
    expect(script).not.toMatch(/documentVisibility\(/);
    expect(script).not.toMatch(/firstCatalogId\(/);
    expect(documents).not.toMatch(/TRAINER_SOLUTION/);
  });

  it('reads description and mime type, the fields of the text rows', () => {
    expect(documents).toMatch(/cd\.description/);
    expect(documents).toMatch(/cd\.mime_type/);
  });

  it('never fetches a private reference or a Word file: it fetches only a pdf plan', () => {
    const decide = documents.indexOf('planDocumentIndexing(');
    const skip = documents.indexOf("plan.kind === 'skip'");
    const fetch = documents.indexOf('await extractPDFText(doc.storage_url)');
    expect(decide).toBeGreaterThan(0);
    expect(skip).toBeGreaterThan(decide);
    expect(fetch).toBeGreaterThan(skip);
  });

  it('removes the old chunks of a document that is skipped (a retyped solution must not stay readable)', () => {
    const skip = documents.slice(
      documents.indexOf("plan.kind === 'skip'"),
      documents.indexOf('const scope = plan.scope')
    );
    // real run only, one document only, never another source type
    expect(skip).toMatch(/if \(!IS_DRY_RUN\) \{/);
    expect(skip).toMatch(
      /DELETE FROM hai_embeddings\s+WHERE source_type = 'document'\s+AND source_id = \$\{doc\.id\}::uuid/
    );
  });

  it('indexes the text rows from the description, with the scope of the plan', () => {
    expect(documents).toMatch(/plan\.kind === 'text'/);
    expect(documents).toMatch(/doc\.description/);
    // the scope is the one of the plan, never a literal
    expect(documents).not.toMatch(/visibility: 'all'/);
    expect(documents).not.toMatch(/visibility: 'trainer'/);
  });

  it('counts the files of a dry run with their pages, and the text rows as chunks', () => {
    expect(documents).toMatch(/unit: 'files'/);
    expect(documents).toMatch(/pages: Number\(doc\.page_count/);
    expect(documents).toMatch(/documents skipped/);
  });

  it('is limited to the catalog of --catalog like every other source', () => {
    expect(documents).toMatch(
      /COALESCE\(e\.training_catalog_id, uc\.training_catalog_id, c\.training_catalog_id\)/
    );
  });
});

describe('reindex-gemini.ts: the plan of a dry run', () => {
  it('measures the characters of every counted chunk', () => {
    const indexSource = script.slice(
      script.indexOf('async function indexSource'),
      script.indexOf('// 1. INDEX COURSES')
    );
    expect(indexSource).toMatch(/chars: chunks\.reduce/);
    expect(indexSource).toMatch(/planLabel \?\? sourceType/);
  });

  it('names Lernfelder, Rahmenplan, text rows and PDFs apart in the plan', () => {
    for (const label of [
      'document (lernfeld)',
      'document (training_component)',
      'document (text row)',
      'document (PDF)',
    ]) {
      expect(script).toContain(`'${label}'`);
    }
  });

  it('prints characters, estimated tokens and a pointer to the cost tool', () => {
    expect(script).toMatch(/hai-embedding-cost\.ts/);
    expect(script).toMatch(/estimateTokens/);
  });

  it('writes the plan with the measures into the log of the run', () => {
    expect(script).toMatch(
      /plan: IS_DRY_RUN\s*\? \{\s*inventory: PLAN_INVENTORY\.rows\(\),\s*changes: PLAN_CHANGES\.rows\(\),\s*rescope: PLAN_RESCOPE\.rows\(\),\s*\}/
    );
  });
});

describe('reindex-gemini.ts: nothing for trainees comes from a solution', () => {
  it('writes the scope of a source from platformScope, the parts or the plan only', () => {
    // every call of indexSource gets one of these scopes
    const calls = script.match(/await indexSource\([\s\S]*?\n\s*\)/g) ?? [];
    expect(calls.length).toBeGreaterThanOrEqual(10);
    for (const call of calls) {
      expect(call).toMatch(
        /platformScope\(|\{ \.\.\.scope, visibility: (SCENARIO_HINT|QUIZ_QUESTIONS|QUIZ_ANSWERS)_VISIBILITY \}|\bscope,|\n\s*scope\n/
      );
    }
  });

  it('keeps the use case rows of the script below the solution pages', () => {
    // use_case chunks of the script: description only (chunk_index < 1000),
    // the solution pages of ingestUseCase.ts are page * 1000 + n
    const useCases = script.slice(
      script.indexOf('async function indexUseCases'),
      script.indexOf('// 4. INDEX QUIZZES')
    );
    expect(useCases).toMatch(/uc\.description_text/);
    expect(useCases).not.toMatch(/content_documents|storage_url/);
  });
});
