/**
 * @jest-environment node
 */
import fs from 'fs';
import path from 'path';

// Only the user sees and changes the own memory. Trainers and admins do not,
// not by an admin route, not by a query, not by an export. This scan keeps it
// that way: the table of the user entries is touched by ONE repository file (and
// by the aggregate counters of the shared memory, which return numbers only), no
// admin or trainer file reaches the repository of the user, and no route of the
// memory takes the id of a person from the request.

const ROOT = process.cwd();

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (['node_modules', '.next', '.claude', '.git'].includes(entry.name)) {
      continue;
    }
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (/\.(ts|tsx|mjs|js|sql)$/.test(entry.name)) out.push(full);
  }
  return out;
}

const rel = (file: string) =>
  path.relative(ROOT, file).split(path.sep).join('/');
const read = (file: string) => fs.readFileSync(file, 'utf8');

const SOURCES = [
  ...walk(path.join(ROOT, 'src')),
  ...walk(path.join(ROOT, 'scripts')),
].map(file => ({ rel: rel(file), text: read(file) }));

describe('who touches the table of the user entries', () => {
  it('only the schema, the one repository and the aggregate counters', () => {
    const users = SOURCES.filter(
      f =>
        /\bhaiUserMemories\b/.test(f.text) ||
        /\bhai_user_memories\b/.test(f.text)
    ).map(f => f.rel);
    expect(users.sort()).toEqual([
      'src/db/migrations/schemas/schema.ts',
      'src/lib/hai/memory/globalData.ts',
      'src/lib/hai/memory/repoDb.ts',
    ]);
  });

  it('the aggregate counters return counts only: no user id leaves the query, a minimum k applies', () => {
    const text = SOURCES.find(
      f => f.rel === 'src/lib/hai/memory/globalData.ts'
    )!.text;
    expect(text).toMatch(/COUNT\(DISTINCT m\.user_id\)/);
    expect(text).toMatch(/HAVING COUNT\(DISTINCT m\.user_id\) >= \$\{k\}/);
    expect(text).toMatch(/HAVING COUNT\(\*\) >= \$\{k\}/);
    // the select list of the queries has no user id and no text of an entry
    for (const select of text.matchAll(/SELECT([\s\S]*?)FROM/g)) {
      expect(select[1]).not.toMatch(/\buser_id\b(?!\))/);
      expect(select[1]).not.toMatch(/\bcontent\b/);
    }
  });

  it('only the memory files use the repository of the user entries', () => {
    const users = SOURCES.filter(
      f => /\bdbUserMemoryRepo\b/.test(f.text) || /\bmemoryStore\b/.test(f.text)
    ).map(f => f.rel);
    for (const file of users) {
      expect(file).toMatch(
        /^(src\/lib\/hai\/memory\/|src\/app\/api\/hai\/memory\/)/
      );
    }
    expect(users.length).toBeGreaterThan(0);
  });

  it('no admin, trainer or script file reaches the memory of a user', () => {
    const forbidden = SOURCES.filter(
      f =>
        /^(src\/app\/api\/(admin|trainer)\/|src\/app\/trainer\/|src\/components\/(admin|trainer)\/|scripts\/)/.test(
          f.rel
        ) &&
        // the admin routes of the SHARED memory and the admin page may use the
        // shared part, never the user part
        (/\bdbUserMemoryRepo\b/.test(f.text) ||
          /\bmemoryStore\b/.test(f.text) ||
          /\bhaiUserMemories\b/.test(f.text) ||
          /\bhai_user_memories\b/.test(f.text) ||
          /\bloadActiveUserMemories\b|\blistUserMemories\b/.test(f.text))
    );
    expect(forbidden.map(f => f.rel)).toEqual([]);
  });

  it('the admin routes of the shared memory use the shared repository only', () => {
    const admin = SOURCES.filter(f =>
      f.rel.startsWith('src/app/api/admin/hai/memory/')
    );
    expect(admin.map(f => f.rel).sort()).toEqual([
      'src/app/api/admin/hai/memory/[id]/route.ts',
      'src/app/api/admin/hai/memory/route.ts',
      'src/app/api/admin/hai/memory/suggest/route.ts',
    ]);
    for (const file of admin) {
      expect(file.text).toMatch(/requireSuperAdmin/);
      expect(file.text).not.toMatch(/dbUserMemoryRepo/);
    }
  });

  it('no export script or backup lists the user memory', () => {
    const scripts = SOURCES.filter(f => f.rel.startsWith('scripts/'));
    expect(
      scripts.filter(f => /hai_user_memor|haiUserMemor/.test(f.text))
    ).toEqual([]);
  });
});

describe('the routes of the user memory', () => {
  const routes = SOURCES.filter(f =>
    f.rel.startsWith('src/app/api/hai/memory/')
  );

  it('are exactly these files', () => {
    expect(routes.map(f => f.rel).sort()).toEqual([
      'src/app/api/hai/memory/[id]/route.ts',
      'src/app/api/hai/memory/route.ts',
    ]);
  });

  it('take the person from the session, never from the request', () => {
    for (const file of routes) {
      expect(file.text).toMatch(/requireUser\(req\)/);
      // no field, query parameter or path segment names a user
      expect(file.text).not.toMatch(/['"]userId['"]/);
      expect(file.text).not.toMatch(
        /searchParams\.get\(['"](?:user|userId|user_id)['"]\)/
      );
      expect(file.text).not.toMatch(/body[^\n]*\buserId\b/);
      // the id given to the store is the id of the session
      for (const call of file.text.matchAll(/userId:\s*([^,\n]+)/g)) {
        expect(call[1].trim()).toBe('me.id');
      }
      expect(file.text).not.toMatch(
        /requireTrainer|requireAdmin|requireSuperAdmin/
      );
    }
  });
});

describe('the repository of the user entries', () => {
  it('an insert always carries the owner', () => {
    const text = SOURCES.find(
      f => f.rel === 'src/lib/hai/memory/repo.ts'
    )!.text;
    const row = text.slice(
      text.indexOf('export interface NewUserMemory'),
      text.indexOf('export interface UserMemoryPatch')
    );
    expect(row).toMatch(/^\s+userId: string;/m);
    expect(row).toMatch(/^\s+trainingCatalogId: string;/m);
  });

  it('puts the id of the owner into every query', () => {
    const text = SOURCES.find(
      f => f.rel === 'src/lib/hai/memory/repoDb.ts'
    )!.text;
    const user = text.slice(
      text.indexOf('export const dbUserMemoryRepo'),
      text.indexOf('export const dbGlobalMemoryRepo')
    );
    // every select, update and delete on the table is limited by the user id
    const statements = [...user.matchAll(/\.where\(([\s\S]*?)\)\s*(?:\.|;)/g)];
    expect(statements.length).toBeGreaterThanOrEqual(8);
    for (const [, where] of statements) {
      // the settings and the chat messages are other tables
      if (/haiUserMemorySettings|haiChatMessages/.test(where)) continue;
      // the list builds its conditions in an array, checked below
      if (where.trim() === 'and(...conditions)') continue;
      expect(where).toMatch(/haiUserMemories\.userId, userId/);
    }
    // the list starts its conditions with the owner
    expect(user).toMatch(
      /const conditions = \[eq\(haiUserMemories\.userId, userId\)\]/
    );
  });

  it('has no method that lists entries across users', () => {
    const text = SOURCES.find(
      f => f.rel === 'src/lib/hai/memory/repo.ts'
    )!.text;
    const iface = text.slice(
      text.indexOf('export interface UserMemoryRepo'),
      text.indexOf('export type GlobalMemoryStatus')
    );
    for (const method of iface.matchAll(/^\s{2}(\w+)\(\s*([^)]*?)[,)]/gm)) {
      // the session check reads the messages of a session, an insert carries the
      // owner inside the row (NewUserMemory.userId is required)
      if (['sessionAskedMemory', 'insert'].includes(method[1])) continue;
      expect({
        method: method[1],
        first: method[2].split(':')[0].trim(),
      }).toEqual({
        method: method[1],
        first: 'userId',
      });
    }
  });
});
