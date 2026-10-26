/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import fs from 'fs';
import path from 'path';

// The HAI routes take the person from the Bearer token. The browser only
// sends that token through authFetch (src/lib/authFetch.ts), a plain fetch to
// /api/hai/* answers 401. This suite scans the browser code so a forgotten or
// new caller cannot slip back to a plain fetch (the HAI chat would break).

const SRC = path.join(process.cwd(), 'src');
const API_DIR = path.join(SRC, 'app', 'api');

function walk(dir: string, out: string[] = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (full !== API_DIR) walk(full, out);
    } else if (/\.(ts|tsx|js|jsx)$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

type Occurrence = { file: string; line: number; text: string; before: string };

function haiOccurrences(): Occurrence[] {
  const found: Occurrence[] = [];
  for (const file of walk(SRC)) {
    const source = fs.readFileSync(file, 'utf8');
    let index = source.indexOf('/api/hai');
    while (index !== -1) {
      const lineStart = source.lastIndexOf('\n', index) + 1;
      const lineEnd = source.indexOf('\n', index);
      const text = source.slice(
        lineStart,
        lineEnd === -1 ? undefined : lineEnd
      );
      const isComment = /^\s*(\*|\/\/|\/\*)/.test(text);
      if (!isComment) {
        found.push({
          file: path.relative(process.cwd(), file).replace(/\\/g, '/'),
          line: source.slice(0, index).split('\n').length,
          text: text.trim(),
          // Everything before the URL, without the quote that opens it
          before: source.slice(0, index).replace(/[\s`'"]+$/, ''),
        });
      }
      index = source.indexOf('/api/hai', index + 1);
    }
  }
  return found;
}

describe('browser calls to /api/hai', () => {
  const occurrences = haiOccurrences();

  it('finds the known callers (the scan is not empty)', () => {
    const files = new Set(occurrences.map(o => o.file));
    expect(files).toEqual(
      new Set([
        'src/components/hai/HaiProvider.tsx',
        'src/components/hai/HaiAdminWidget.tsx',
        'src/components/hai/HaiAdminDialog.tsx',
      ])
    );
    expect(occurrences.length).toBeGreaterThanOrEqual(13);
  });

  it('sends every call through authFetch', () => {
    const plain = occurrences.filter(o => !o.before.endsWith('authFetch('));
    expect(plain.map(o => `${o.file}:${o.line} ${o.text}`)).toEqual([]);
  });

  it('no longer sends the person as a userId parameter', () => {
    const withUserId = occurrences.filter(o => /userId/.test(o.text));
    expect(withUserId.map(o => `${o.file}:${o.line} ${o.text}`)).toEqual([]);
  });

  it('imports authFetch where it calls the HAI routes', () => {
    for (const file of new Set(occurrences.map(o => o.file))) {
      const source = fs.readFileSync(path.join(process.cwd(), file), 'utf8');
      expect(source).toMatch(
        /import\s*\{[^}]*\bauthFetch\b[^}]*\}\s*from\s*'@\/lib\/authFetch'/
      );
    }
  });
});
