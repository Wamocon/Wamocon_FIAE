/**
 * @jest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// The notification routes and the school routes of a trainee answer only with
// a bearer session. A browser call with a plain fetch() carries no token and
// would be answered with 401, so every caller has to use authFetch
// (src/lib/authFetch.ts). This test reads the sources and fails for a plain
// fetch() whose url is one of these routes, including a url kept in a variable
// before the call. A new caller that forgets authFetch fails here.

const PROTECTED = /\/api\/(notifications|trainee\/school)(?![\w-])/;
const SRC = join(process.cwd(), 'src');
const API = join(SRC, 'app', 'api');

function sourceFiles(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (full === API) continue; // route handlers do not call themselves
    if (statSync(full).isDirectory()) sourceFiles(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

/** The text a plain fetch() call is aimed at, or '' when it cannot be read. */
function targetOf(source: string, argStart: number) {
  const first = source.slice(argStart, argStart + 400).trimStart();
  if (/^[`'"]/.test(first)) return first.slice(0, 200);
  const ident = first.match(/^[A-Za-z_]\w*/)?.[0];
  if (!ident) return '';
  const declared = source.lastIndexOf(`${ident} =`, argStart);
  return declared < 0 ? '' : source.slice(declared, declared + 200);
}

/** Plain fetch() calls (not authFetch, not x.fetch) aimed at a protected route. */
function plainFetchViolations(source: string) {
  const violations: string[] = [];
  const call = /(^|[^\w.])fetch\(/g;
  let match: RegExpExecArray | null;
  while ((match = call.exec(source))) {
    const target = targetOf(source, match.index + match[0].length);
    if (PROTECTED.test(target)) violations.push(target.split('\n')[0].trim());
  }
  return violations;
}

describe('plainFetchViolations (the scanner itself)', () => {
  it('flags a plain fetch to a protected route', () => {
    expect(
      plainFetchViolations('await fetch(`/api/notifications?userId=1`)')
    ).toHaveLength(1);
    expect(
      plainFetchViolations("fetch('/api/trainee/school/blocks', {})")
    ).toHaveLength(1);
  });

  it('flags a url kept in a variable', () => {
    const source =
      "let url = `/api/trainee/school/reports?x=1`;\nconst res = await fetch(url, { cache: 'no-store' });";
    expect(plainFetchViolations(source)).toHaveLength(1);
  });

  it('accepts authFetch and other routes', () => {
    expect(
      plainFetchViolations("authFetch('/api/notifications?limit=30')")
    ).toEqual([]);
    expect(
      plainFetchViolations("fetch('/api/trainee/knowledge-notes')")
    ).toEqual([]);
    expect(plainFetchViolations('window.fetch("/api/notifications")')).toEqual(
      []
    );
  });
});

describe('browser code calls the protected routes with authFetch', () => {
  it('finds no plain fetch() to /api/notifications or /api/trainee/school', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(SRC)) {
      for (const target of plainFetchViolations(readFileSync(file, 'utf8'))) {
        offenders.push(`${file.slice(SRC.length + 1)}: ${target}`);
      }
    }
    expect(offenders).toEqual([]);
  });
});
