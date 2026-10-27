/**
 * @jest-environment node
 */
import { readdirSync, readFileSync, statSync } from 'fs';
import { join } from 'path';

// A page or layout that is a server component runs on the server for every
// visitor, with or without a session: the sign-in of this app is a bearer
// token in the browser, the server component sees none of it. A page that read
// the database itself would therefore hand its data to anyone who knows the
// address. The quiz pages once did exactly that and showed the answer key. Data
// reaches a page through a route handler under src/app/api, which checks the
// session (and the organization and occupation of the caller).
//
// The public pages read the public catalog through src/lib/catalog/public.ts,
// which is limited to what is meant for visitors. They do not import the
// database. There is no exception: the global quiz page of a trainee is a
// client page now, it loads its questions with authFetch from
// GET /api/trainee/quizzes/[quizId].

const APP = join(process.cwd(), 'src', 'app');
const API = join(APP, 'api');
const DB_IMPORT = /from\s+['"]@\/db(?:['"/])|require\(\s*['"]@\/db(?:['"/])/;

function files(dir: string, out: string[] = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (full === API) continue;
    if (statSync(full).isDirectory()) files(full, out);
    else if (/\.(ts|tsx)$/.test(name)) out.push(full);
  }
  return out;
}

describe('pages and layouts under src/app', () => {
  it('the scanner recognizes a database import', () => {
    expect(DB_IMPORT.test("import db from '@/db';")).toBe(true);
    expect(
      DB_IMPORT.test(
        "import { quizzes } from '@/db/migrations/schemas/schema';"
      )
    ).toBe(true);
    expect(DB_IMPORT.test("import { x } from '@/lib/db-retry';")).toBe(false);
  });

  it('none of them imports the database', () => {
    const offenders = files(APP)
      .filter(file => DB_IMPORT.test(readFileSync(file, 'utf8')))
      .map(file => file.slice(APP.length + 1));
    expect(offenders).toEqual([]);
  });

  it('the global quiz page of a trainee is a client page that loads through authFetch', () => {
    const source = readFileSync(
      join(APP, 'trainee', 'quizzes', '[quizId]', 'page.tsx'),
      'utf8'
    );
    expect(source).toMatch(/^['"]use client['"]/);
    expect(source).toContain('/api/trainee/quizzes/');
  });
});
