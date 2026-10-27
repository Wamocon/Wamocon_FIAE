/**
 * @jest-environment node
 */
// What the modules under src/lib/content-upload may import and call. Concept 9.3
// (G2, G3): no fetch of an address, no file system, no database, no model, no
// fallback to a foreign provider, no function that fetches a PDF by address.
// The test reads the sources, so a later change cannot add such a call
// without a failing test.
import { readdirSync, readFileSync } from 'node:fs';
import path from 'node:path';

import { describe, expect, it } from '@jest/globals';

const DIR = path.join(process.cwd(), 'src', 'lib', 'content-upload');
const files = readdirSync(DIR)
  .filter(name => name.endsWith('.ts'))
  .map(name => ({
    name,
    source: readFileSync(path.join(DIR, name), 'utf8'),
  }));

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
  source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/(^|[^:\'"`])\/\/.*$/gm, '$1');

const ALLOWED_NODE = new Set([
  // the thread of the PDF reader loads it by name inside its own source text
  'worker_threads',
  'node:worker_threads',
  'node:module',
  'node:path',
]);

describe('the modules of src/lib/content-upload', () => {
  it('exist (the test would be empty otherwise)', () => {
    expect(files.map(f => f.name)).toEqual(
      expect.arrayContaining([
        'excerpt.ts',
        'read-docx.ts',
        'read-pdf.ts',
        'pdf-worker.ts',
      ])
    );
  });

  it.each(files)(
    '$name imports only its own folder, the content import and the allowed Node modules',
    ({ source }) => {
      for (const specifier of specifiers(withoutComments(source))) {
        if (specifier.startsWith('./')) continue;
        if (specifier.startsWith('../content-import/')) continue;
        if (specifier === '../prompt-sanitize') continue;
        // the one function of the PDF cleaning
        if (specifier === '../hai/pdfExtractor') continue;
        if (ALLOWED_NODE.has(specifier)) continue;
        throw new Error(`not allowed: ${specifier}`);
      }
    }
  );

  it.each(files)(
    '$name takes nothing from the forbidden places',
    ({ source: raw }) => {
      const source = withoutComments(raw);
      for (const specifier of specifiers(source)) {
        expect(specifier).not.toMatch(
          /^(?:node:)?(?:fs|fs\/promises|http|https|http2|net|tls|dns|child_process|cluster|vm|dgram)$/
        );
        expect(specifier).not.toMatch(
          /supabase|drizzle|postgres|^pg$|@\/db|\/db\//
        );
        expect(specifier).not.toMatch(/embeddings|providers/);
      }
      expect(source).not.toMatch(/chatWithFallback|getChatProvider/);
      expect(source).not.toMatch(
        /\bextractTextFromPDF\b|\bextractTextByPage\b/
      );
      expect(source).not.toMatch(/\bfetch\s*\(/);
      expect(source).not.toMatch(/process\.env/);
      expect(source).not.toMatch(/XMLHttpRequest|WebSocket|EventSource/);
    }
  );

  it('takes only cleanPDFText from the PDF module of the HAI', () => {
    for (const { source } of files) {
      const imports = [
        ...source.matchAll(
          /import\s*\{([^}]*)\}\s*from\s*'\.\.\/hai\/pdfExtractor'/g
        ),
      ];
      for (const [, names] of imports) {
        expect(names.trim()).toBe('cleanPDFText');
      }
    }
  });

  it('keeps the worker thread free of modules that reach the system or the net', () => {
    const worker = files.find(f => f.name === 'pdf-worker.ts')?.source ?? '';
    const engine = worker.slice(
      worker.indexOf('const PREAMBLE'),
      worker.indexOf('/** Where pdf.js')
    );
    expect(engine).toContain("require('worker_threads')");
    expect(engine).not.toMatch(
      /require\(['"](?:fs|http|https|net|tls|dns|child_process|os)['"]\)/
    );
    expect(engine).not.toMatch(/\bfetch\s*\(/);
    expect(engine).toContain('delete globalThis.fetch');
    expect(engine).toContain('isEvalSupported = false');
  });

  it('start no thread without the limits of memory and time', () => {
    const worker = files.find(f => f.name === 'pdf-worker.ts')?.source ?? '';
    expect(worker).toMatch(/resourceLimits/);
    expect(worker).toMatch(/env:\s*\{\}/);
    expect(worker).toMatch(/terminate\(\)/);
    expect(worker).toMatch(/setTimeout/);
  });
});
