/**
 * @jest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative, sep } from 'path';

// A link to a page that does not exist is a 404 for the user. The Lernfeld
// tabs once pushed to /trainee/lernfelder/<id> for months after the page had
// been deleted. This test reads every internal navigation target in src
// (router.push, router.replace, redirect, href) and requires a page under
// src/app for it. A target with a dynamic part (a template literal) must match
// a route with a dynamic segment or a static one in that position.

const SRC = join(process.cwd(), 'src');
const APP = join(SRC, 'app');
const PLACEHOLDER = '\u0000';

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else out.push(full);
  }
  return out;
}

/** Route segments of a page file, route groups removed. */
function routeOf(file: string): string[] {
  const parts = relative(APP, file).split(sep);
  parts.pop(); // page.tsx
  return parts.filter(p => !/^\(.*\)$/.test(p));
}

function loadRoutes(): string[][] {
  return walk(APP)
    .filter(f => /[\\/]page\.(tsx|ts|jsx|js)$/.test(f))
    .map(routeOf);
}

/** A path as segments, a `${...}` part becomes the placeholder. */
function segmentsOf(path: string): string[] | null {
  const clean = path
    .split('#')[0]
    .split('?')[0]
    .replace(/\$\{[^}]*\}/g, PLACEHOLDER);
  // A template that starts with an unknown base cannot be resolved
  if (clean.startsWith(PLACEHOLDER)) return null;
  if (!clean.startsWith('/')) return null;
  return clean.split('/').filter(Boolean);
}

function matchesRoute(target: string[], routes: string[][]): boolean {
  return routes.some(route => {
    const catchAll = route.findIndex(s => /^\[\[?\.\.\./.test(s));
    const fixed = catchAll === -1 ? route : route.slice(0, catchAll);
    if (catchAll === -1 && fixed.length !== target.length) return false;
    if (catchAll !== -1 && target.length < fixed.length) return false;
    return fixed.every((seg, i) => {
      const t = target[i];
      if (/^\[.*\]$/.test(seg)) return true;
      // a dynamic part of the link may stand for a static segment too
      return t === seg || t.includes(PLACEHOLDER);
    });
  });
}

const TARGET_PATTERNS: RegExp[] = [
  /router\.(?:push|replace)\(\s*(['"`])(\/(?:(?!\1)[^\n])*)\1/g,
  /\b(?:permanentRedirect|redirect)\(\s*(['"`])(\/(?:(?!\1)[^\n])*)\1/g,
  /\bhref=\{?\s*(['"`])(\/(?:(?!\1)[^\n])*)\1/g,
  /\bhref:\s*(['"`])(\/(?:(?!\1)[^\n])*)\1/g,
];

/** Internal targets in one source text. */
function internalTargets(source: string): string[] {
  const found: string[] = [];
  for (const pattern of TARGET_PATTERNS) {
    for (const match of source.matchAll(new RegExp(pattern))) {
      found.push(match[2]);
    }
  }
  return found;
}

// Targets that are not pages of this app (served by routes or the framework).
const NOT_PAGES = [
  /^\/api\//,
  /^\/_next\//,
  /^\/favicon/,
  /^\/(?:images|assets)\//,
];

// Legacy components that nothing imports any more. They still name pages of
// the old module and lesson flow (/trainee/lessons, /trainee/modules/.../chapters)
// that were removed. The test below proves they are not imported, so the dead
// links cannot be reached. Delete the files and this list together.
const UNUSED_LEGACY_FILES = [
  'components/learning/ModuleDetail.tsx',
  'components/learning/SubLesson.tsx',
  'components/learning/trainer-feedback.tsx',
];

describe('internal links', () => {
  const routes = loadRoutes();

  it('the listed legacy components are really not imported', () => {
    const sources = walk(SRC)
      .filter(f => /\.(tsx?|jsx?)$/.test(f))
      .map(f => ({ f, text: readFileSync(f, 'utf8') }));
    for (const legacy of UNUSED_LEGACY_FILES) {
      const base = legacy.replace(/^components\//, '').replace(/\.tsx$/, '');
      const name = base.split('/').pop() as string;
      const importers = sources.filter(
        ({ f, text }) =>
          !f.endsWith(legacy.split('/').join(sep)) &&
          new RegExp(`from\s+['"][^'"]*${name}['"]`).test(text)
      );
      expect(importers.map(i => relative(SRC, i.f))).toEqual([]);
    }
  });

  it('knows the pages of the app', () => {
    const known = routes.map(r => '/' + r.join('/'));
    expect(known).toEqual(
      expect.arrayContaining([
        '/trainee/lernfelder/[id]',
        '/trainer/lernfelder/[id]',
      ])
    );
  });

  it('resolves static and dynamic targets', () => {
    expect(matchesRoute(['trainee', 'courses'], routes)).toBe(true);
    expect(matchesRoute(['trainee', 'lernfelder', PLACEHOLDER], routes)).toBe(
      true
    );
    expect(matchesRoute(['trainee', 'gibt-es-nicht'], routes)).toBe(false);
    expect(matchesRoute(['trainee', 'gibt-es-nicht', 'x'], routes)).toBe(false);
  });

  it('finds the targets of the usual forms', () => {
    const source = [
      "router.push('/a/b');",
      'router.replace(`/c/${id}`);',
      'redirect("/d");',
      '<Link href="/e/f">x</Link>',
      '<a href={`/g/${x}/h`}>',
      "{ name: 'n', href: '/i' }",
    ].join('\n');
    expect(internalTargets(source).sort()).toEqual(
      ['/a/b', '/c/${id}', '/d', '/e/f', '/g/${x}/h', '/i'].sort()
    );
  });

  it('every internal target of the source leads to a page', () => {
    const missing: string[] = [];
    for (const file of walk(SRC)) {
      if (!/\.(tsx?|jsx?)$/.test(file)) continue;
      if (/[\\/](?:__tests__|tests)[\\/]|\.test\.tsx?$/.test(file)) continue;
      // The route handlers answer API calls, they do not navigate
      if (file.startsWith(join(APP, 'api'))) continue;
      if (
        UNUSED_LEGACY_FILES.some(l => file.endsWith(l.split('/').join(sep)))
      ) {
        continue;
      }
      const source = readFileSync(file, 'utf8');
      for (const target of internalTargets(source)) {
        if (NOT_PAGES.some(p => p.test(target))) continue;
        const segments = segmentsOf(target);
        if (!segments) continue;
        if (!matchesRoute(segments, routes)) {
          missing.push(
            `${relative(SRC, file).split(sep).join('/')} -> ${target}`
          );
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
