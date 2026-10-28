/**
 * @jest-environment node
 */
// What the code of the transfer may do and may not do, read from the sources, so a
// later change cannot add it without a failing test (concept 8.1, 8.4, 8.7, 9.3).
import { describe, expect, it } from '@jest/globals';
import fs from 'fs';
import path from 'path';

const ROOT = process.cwd();
const FOLDER = path.join(ROOT, 'src/lib/content-upload/transfer');
const ROUTES = path.join(
  ROOT,
  'src/app/api/trainer/content-upload/runs/[runId]'
);

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

const files = [
  ...fs
    .readdirSync(FOLDER)
    .filter(f => f.endsWith('.ts'))
    .map(f => path.join(FOLDER, f)),
  ...['dry-run', 'apply', 'rollback-sql', 'stock'].map(d =>
    path.join(ROUTES, d, 'route.ts')
  ),
].map(file => ({
  name: path.relative(ROOT, file).split(path.sep).join('/'),
  code: withoutComments(fs.readFileSync(file, 'utf8')),
}));

const only = (name: string) => files.filter(f => f.name.endsWith(name));

describe('the sources of the transfer', () => {
  it('exist (the tests would be empty otherwise)', () => {
    expect(files.map(f => path.basename(f.name))).toEqual(
      expect.arrayContaining([
        'run.ts',
        'plan.ts',
        'store.ts',
        'rollback.ts',
        'originals.ts',
        'record.ts',
        'context.ts',
        'route.ts',
      ])
    );
  });

  it.each(files.map(f => [f.name, f.code]))(
    '%s never turns an activation or a solution switch on',
    (_name, code) => {
      expect(code).not.toMatch(/activate\s*:\s*true/);
      expect(code).not.toMatch(/scenarioSolutions\s*:\s*true/);
      expect(code).not.toMatch(/\bsolutions\s*:\s*true/);
      expect(code).not.toMatch(/useCaseSolutions\s*:\s*true/);
    }
  );

  it('passes the fixed settings to the engines, and nothing else', () => {
    const run = only('transfer/run.ts')[0].code;
    expect(run).toMatch(/activate: FIXED_ENGINE_OPTIONS\.activate/g);
    expect(run).toMatch(
      /scenarioSolutions: FIXED_ENGINE_OPTIONS\.scenarioSolutions/
    );
    expect(run).toMatch(/solutions: FIXED_ENGINE_OPTIONS\.useCaseSolutions/);
    expect(run).toMatch(/extendQuizzes: FIXED_ENGINE_OPTIONS\.extendQuizzes/);
    // the constant and the one set of switches that both engines get
    expect(run.match(/activate:/g)).toHaveLength(2);
    const preset = only('transfer/preset.ts')[0].code;
    expect(preset).toContain('activate: false');
  });

  it.each(files.map(f => [f.name, f.code]))(
    '%s does not delete, truncate or drop anything and has no named lock or session setting',
    (name, code) => {
      if (name.endsWith('transfer/rollback.ts')) return;
      expect(code).not.toMatch(/\bdelete\s+from\b/i);
      expect(code).not.toMatch(/\btruncate\b/i);
      expect(code).not.toMatch(/\bdrop\s+(table|schema|database)\b/i);
      expect(code).not.toMatch(/pg_advisory_lock\(/);
      expect(code).not.toMatch(
        /\bset\s+(?!local\b)(lock_timeout|statement_timeout|row_security|role|search_path|session)/i
      );
      expect(code).not.toMatch(/\.begin\(/);
    }
  );

  it('the rollback text is only text: the module sends no statement of its own that deletes', () => {
    const code = only('transfer/rollback.ts')[0].code;
    // every delete is inside the generated text, and the module only reads
    const queries = [...code.matchAll(/q\.query\(\s*(`[^`]*`|'[^']*')/g)].map(
      m => m[1]
    );
    expect(queries.length).toBeGreaterThan(3);
    for (const query of queries) {
      expect(query).not.toMatch(
        /\b(delete|update|insert|truncate|drop|alter)\b/i
      );
    }
    expect(code).not.toMatch(/\.query\([^)]*delete from/i);
  });

  it('only context.ts and the document bucket read the environment, and nothing fetches an address', () => {
    for (const file of files) {
      const reads = file.code.includes('process.env');
      expect([file.name, reads]).toEqual([
        file.name,
        file.name.endsWith('transfer/context.ts') ||
          file.name.endsWith('transfer/content-bucket.ts'),
      ]);
    }
    for (const file of files) {
      expect([file.name, /\bfetch\(/.test(file.code)]).toEqual([
        file.name,
        false,
      ]);
      expect(file.code).not.toMatch(
        /from 'node:(http|https|net|child_process)'/
      );
    }
  });

  it('takes nothing from a model, the embeddings, the PDF reader that fetches addresses or the admin API', () => {
    for (const file of files) {
      for (const forbidden of [
        'chatWithFallback',
        'getChatProvider',
        'hai/embeddings',
        'extractTextFromPDF',
        'extractTextByPage',
        'auth.admin',
        'openrouter',
        'OPENAI_',
        '@anthropic-ai/sdk',
        '@google/generative-ai',
      ]) {
        expect([file.name, forbidden, file.code.includes(forbidden)]).toEqual([
          file.name,
          forbidden,
          false,
        ]);
      }
    }
  });

  it('never reads the secret key of the project except in the one module of the document bucket', () => {
    for (const file of files) {
      const reads = /getSupabaseSecretKey|SERVICE_ROLE|SECRET_KEY/.test(
        file.code
      );
      expect([file.name, reads]).toEqual([
        file.name,
        file.name.endsWith('transfer/content-bucket.ts'),
      ]);
    }
  });

  it('only the apply route can start a writing transfer, and it needs the typed catalog code', () => {
    const starts = files.filter(f => f.code.includes('runTransfer('));
    expect(starts.map(f => path.basename(path.dirname(f.name))).sort()).toEqual(
      ['apply', 'dry-run', 'transfer']
    );
    const run = only('transfer/run.ts')[0].code;
    expect(run).toMatch(/request\.confirm !== UPLOAD_CATALOG_CODE/);
  });

  it('the comparison with the stock only reads: a read only transaction, write false, no protocol', () => {
    const compare = only('transfer/compare.ts')[0].code;
    expect(compare).toContain("mode: 'read-only'");
    expect(compare).toContain("finish: 'rollback'");
    expect(compare).not.toMatch(/write:\s*true/);
    // the content engine, the use case engine and the learning field engine
    expect(compare.match(/write: false/g)).toHaveLength(3);
    expect(compare).not.toMatch(/store\.protocol|beginApplying|recordAttempt/);
    expect(compare).not.toMatch(/updateExisting:\s*true/);
    // the target is checked first, inside the transaction
    expect(compare.indexOf('checkTargetFacts(target, facts)')).toBeLessThan(
      compare.indexOf('executePlan(db')
    );
    // only the route of the comparison starts it
    const starts = files.filter(f => f.code.includes('compareStock('));
    expect(starts.map(f => path.basename(path.dirname(f.name))).sort()).toEqual([
      'stock',
      'transfer',
    ]);
  });

  it('replaces differing rows only through the choice of files, never through a switch for all', () => {
    const run = only('transfer/run.ts')[0].code;
    expect(run).toContain('updateExisting: replaceSet.size > 0');
    expect(run).toContain('updateFilter:');
    expect(run).not.toMatch(/updateExisting:\s*true/);
  });

  it('writes its protocol and the content on the connection of the transaction', () => {
    const run = only('transfer/run.ts')[0].code;
    expect(run).toContain('store.protocol(connection)');
    expect(run).toContain('withReservedConnection(');
    expect(run).toContain('withTransaction(');
    // the check of the target comes first inside the transaction
    expect(run.indexOf('checkTargetFacts(target, facts)')).toBeLessThan(
      run.indexOf('executePlan(db')
    );
    expect(run.indexOf('executePlan(db')).toBeLessThan(
      run.indexOf('executeUseCasePlan(db')
    );
    // the plan is built before a connection is held
    expect(run.indexOf('buildTransferPlan(')).toBeLessThan(
      run.indexOf('withReservedConnection(')
    );
    expect(run.indexOf('store.beginApplying(')).toBeLessThan(
      run.indexOf('withReservedConnection(')
    );
  });
});
