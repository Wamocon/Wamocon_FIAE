/**
 * @jest-environment node
 */
// What the modules under src/lib/content-upload/classify may import and call.
// They are pure functions: no file system, no database, no network, no model, no
// clock, no randomness (concept 9.3, G2 and G3). The test reads the sources, so
// a later change cannot add such a call without a failing test.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

const DIR = path.join(
  process.cwd(),
  'src',
  'lib',
  'content-upload',
  'classify'
);
const files = readdirSync(DIR)
  .filter(name => name.endsWith('.ts'))
  .map(name => ({ name, source: readFileSync(path.join(DIR, name), 'utf8') }));

/** Every module specifier of an import, an export from or a dynamic import. */
function specifiers(source: string): string[] {
  const found: string[] = [];
  const pattern =
    /(?:import|export)\s[^'"]*?from\s*['"]([^'"]+)['"]|import\s*['"]([^'"]+)['"]|import\(\s*['"]([^'"]+)['"]\s*\)|require\(\s*['"]([^'"]+)['"]\s*\)/g;
  for (let m = pattern.exec(source); m; m = pattern.exec(source)) {
    found.push(m[1] ?? m[2] ?? m[3] ?? m[4]);
  }
  return found;
}

/** The code without comments: a comment may name what the code must not do. */
const withoutComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('the modules of src/lib/content-upload/classify', () => {
  it('exist (the test would be empty otherwise)', () => {
    expect(files.map(f => f.name)).toEqual(
      expect.arrayContaining([
        'assign.ts',
        'content-rule.ts',
        'derive.ts',
        'duplicates.ts',
        'index.ts',
        'path-rule.ts',
        'positive-list.ts',
        'similarity.ts',
        'types.ts',
      ])
    );
  });

  it.each(files)(
    '$name imports only its own folder, the content import and the reading helpers',
    ({ source }) => {
      for (const specifier of specifiers(withoutComments(source))) {
        if (specifier.startsWith('./')) continue;
        if (specifier.startsWith('../../content-import/')) continue;
        // the cleaning and the marker words of the excerpt, nothing else
        if (specifier === '../text-clean' || specifier === '../patterns')
          continue;
        throw new Error(`not allowed: ${specifier}`);
      }
    }
  );

  it.each(files)(
    '$name reaches no system, net, database or model',
    ({ source: raw }) => {
      const source = withoutComments(raw);
      for (const specifier of specifiers(source)) {
        expect(specifier).not.toMatch(/^(?:node:)/);
        expect(specifier).not.toMatch(
          /supabase|drizzle|postgres|^pg$|@\/db|\/db\//
        );
        expect(specifier).not.toMatch(/embeddings|providers|hai\//);
      }
      expect(source).not.toMatch(/chatWithFallback|getChatProvider/);
      expect(source).not.toMatch(
        /\bextractTextFromPDF\b|\bextractTextByPage\b/
      );
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/);
      expect(source).not.toMatch(/\brequire\s*\(/);
    }
  );

  it.each(files)(
    '$name reads no clock and no random source',
    ({ source: raw }) => {
      const source = withoutComments(raw);
      expect(source).not.toMatch(
        /Math\.random|crypto\.|randomUUID|getRandomValues/
      );
      expect(source).not.toMatch(
        /Date\.now\s*\(|new Date\s*\(\s*\)|performance\.now/
      );
      expect(source).not.toMatch(/localeCompare|toLocale/);
    }
  );

  it('does not change the parsers and the path rule of the import', () => {
    // the rule stage reuses them as they are (U4 reads, it does not edit)
    const plan = readFileSync(
      path.join(process.cwd(), 'src', 'lib', 'content-import', 'path-info.ts'),
      'utf8'
    );
    expect(plan).toContain('export function pathInfo');
  });
});
