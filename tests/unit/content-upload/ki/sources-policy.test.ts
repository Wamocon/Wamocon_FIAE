/**
 * @jest-environment node
 */
// What the modules of the Sokrates stage may import and call (concept 9.3, G2 and
// G3): ONE provider, no fallback, the network only in the client, the environment
// only where it is read on purpose, no database in the pure modules, no embeddings.
// The test reads the sources, so a later change cannot add such a call without a
// failing test.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

const DIR = path.join(process.cwd(), 'src', 'lib', 'content-upload', 'ki');
const files = readdirSync(DIR)
  .filter(name => name.endsWith('.ts'))
  .map(name => ({ name, source: readFileSync(path.join(DIR, name), 'utf8') }));

function specifiers(source: string): string[] {
  const found: string[] = [];
  const pattern =
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let m = pattern.exec(source); m; m = pattern.exec(source)) {
    found.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  }
  return found;
}

const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('the modules of src/lib/content-upload/ki', () => {
  it('exist (the test would be empty otherwise)', () => {
    expect(files.map(f => f.name)).toEqual(
      expect.arrayContaining([
        'answer.ts',
        'budget.ts',
        'client.ts',
        'config.ts',
        'corpus.ts',
        'env.ts',
        'guard.ts',
        'prompt.ts',
        'proposal.ts',
        'repo.ts',
        'repo-pg.ts',
        'steps.ts',
      ])
    );
  });

  it.each(files)(
    '$name takes no other provider and no chat fallback',
    ({ source: raw }) => {
      const source = withoutComments(raw);
      for (const specifier of specifiers(source)) {
        expect(specifier).not.toMatch(
          /embeddings|providers|hai\/|pdfExtractor/
        );
        expect(specifier).not.toMatch(
          /supabase\/supabase-js|@anthropic|openai|@google|openrouter/i
        );
      }
      expect(source).not.toMatch(
        /chatWithFallback|getChatProvider|loadProviderConfig/
      );
      expect(source).not.toMatch(
        /\bextractTextFromPDF\b|\bextractTextByPage\b/
      );
      expect(source).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/);
      // no address of any provider in the code
      expect(source).not.toMatch(
        /api\.openai\.com|generativelanguage\.googleapis|openrouter\.ai|api\.anthropic\.com/
      );
    }
  );

  it('calls the network in the client and nowhere else', () => {
    for (const { name, source: raw } of files) {
      const source = withoutComments(raw);
      const calls = /\bfetch\s*\(/.test(source);
      expect(`${name}:${calls}`).toBe(`${name}:${name === 'client.ts'}`);
      expect(specifiers(source).join(' ')).not.toMatch(
        /(?:^|\s)(?:node:)?(?:http|https|http2|net|tls|dns|child_process|vm)(?:\s|$)/
      );
    }
  });

  it('reads the environment in no module that takes a decision', () => {
    // config.ts gets the environment as an argument, env.ts only passes a function
    for (const { name, source: raw } of files) {
      expect([name, /process\.env/.test(withoutComments(raw))]).toEqual([
        name,
        false,
      ]);
    }
  });

  it('keeps the database out of everything but the repository', () => {
    for (const { name, source: raw } of files) {
      const hits = specifiers(withoutComments(raw)).filter(s =>
        /drizzle|postgres|^pg$|@\/db|\/db\//.test(s)
      );
      if (name === 'repo-pg.ts') expect(hits).toEqual(['drizzle-orm']);
      else expect(hits).toEqual([]);
    }
  });

  it('writes nothing to the console', () => {
    for (const { name, source: raw } of files) {
      expect([name, /\bconsole\./.test(withoutComments(raw))]).toEqual([
        name,
        false,
      ]);
    }
  });

  it('never stores or logs the excerpt itself: the insert names the column and gives it null', () => {
    const repo = files.find(f => f.name === 'repo-pg.ts')!.source;
    expect(repo).toMatch(/\$\{call\.model\}, \$\{call\.endpointHost\}, null/);
  });
});
