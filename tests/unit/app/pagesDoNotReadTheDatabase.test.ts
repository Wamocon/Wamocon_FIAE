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
// database. One page is an open exception for now: the global quiz page of a
// trainee reads the question and option texts of a quiz by its id. It selects
// no solution column (checked below) and is a follow-up of its own, because the
// quiz component behind it does not submit its answers to the server.

const APP = join(process.cwd(), 'src', 'app');
const API = join(APP, 'api');
const OPEN_EXCEPTIONS = [join('trainee', 'quizzes', '[quizId]', 'page.tsx')];
const SOLUTION_COLUMN = /isCorrect|explanation|expectedAnswer|hintText/;
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

  it('none of them imports the database, except the listed page', () => {
    const offenders = files(APP)
      .filter(file => DB_IMPORT.test(readFileSync(file, 'utf8')))
      .map(file => file.slice(APP.length + 1))
      .filter(file => !OPEN_EXCEPTIONS.includes(file));
    expect(offenders).toEqual([]);
  });

  it('the open exception reads no solution column', () => {
    for (const file of OPEN_EXCEPTIONS) {
      const source = readFileSync(join(APP, file), 'utf8');
      expect(DB_IMPORT.test(source)).toBe(true);
      expect(SOLUTION_COLUMN.test(source)).toBe(false);
    }
  });
});
