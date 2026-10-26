/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { createTableDb } from '../../../helpers/mockDb';
import {
  makeRequest,
  mockSupabaseAuth,
  sessionProfileRow,
} from '../../../helpers/mockNext';
import {
  GUARDED_ROUTES,
  type GuardedRoute,
} from '../../../helpers/guardedRoutes';

// Every trainer and admin handler runs behind the bearer session layer.
// This suite runs the real layer (token check against a mocked Supabase auth
// and a mocked profile row) for each handler and checks that
//  - a request without a token is answered with 401 and
//  - a caller whose role is too low is answered with 403,
// before the handler touches any data.

const TOKEN = 'valid-token';

// The caller that is just below what a guard requires. The 'user' guard has no
// role to fall below, an inactive account is the one it turns away with 403.
const TOO_LOW_ROLE: Record<GuardedRoute['guard'], Record<string, unknown>> = {
  user: { role: 'TRAINEE', isActive: false },
  trainer: { role: 'TRAINEE' },
  admin: { role: 'TRAINER' },
  // An ADMIN of a customer organization is not a platform-wide admin
  superAdmin: { role: 'ADMIN', isPlatformOwner: false },
  // A trainer of a customer organization may not touch the shared HAI index
  haiIndex: { role: 'TRAINER', isPlatformOwner: false },
};

async function loadHandler(
  entry: GuardedRoute,
  profile: Record<string, unknown>
) {
  jest.resetModules();
  mockSupabaseAuth({ [TOKEN]: { id: 'session-user' } });
  const { db } = createTableDb({ profiles: [sessionProfileRow(profile)] });
  jest.doMock('@/db', () => ({ __esModule: true, default: db }));
  const mod = await import(`@/app/api/${entry.route}/route`);
  return {
    handler: mod[entry.method] as (...args: any[]) => Promise<Response>,
    db,
  };
}

function buildCall(entry: GuardedRoute, token: string | null) {
  const path = entry.route.replace(/\[(\w+)\]/g, 'dummy-$1');
  const request = makeRequest(entry.method, `http://localhost/api/${path}`, {
    token,
    body: {},
  });
  const params = Object.fromEntries(
    entry.params.map(name => [name, `dummy-${name}`])
  );
  return [request, { params: Promise.resolve(params) }] as const;
}

describe('route guards: trainer, admin and signed-in user handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    // lib/email creates the Resend client at import time
    process.env.RESEND_API_KEY = 're_test_key';
  });

  it('covers the expected number of handlers', () => {
    // Guards against the table silently shrinking when files move
    expect(GUARDED_ROUTES.length).toBeGreaterThanOrEqual(180);
  });

  it('lists every notification and trainee handler', async () => {
    // A new route file under these folders has to be added to the table, or to
    // the short list of open master data routes below (a decision to review)
    const { readdirSync, readFileSync, statSync } = await import('fs');
    const { join } = await import('path');
    const base = join(process.cwd(), 'src/app/api');
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name === 'route.ts') {
          const route = full
            .slice(base.length + 1)
            .split('\\')
            .join('/')
            .replace(/\/route\.ts$/, '');
          if (
            route.startsWith('notifications') ||
            route.startsWith('trainee/')
          ) {
            const source = readFileSync(full, 'utf8');
            for (const m of source.matchAll(
              /export async function (GET|POST|PUT|PATCH|DELETE)/g
            )) {
              found.push(`${m[1]} ${route}`);
            }
          }
        }
      }
    };
    walk(base);
    // (the HAI routes of one person and me/catalogs are 'user' handlers too,
    // they are not part of this folder scan)
    const listed = GUARDED_ROUTES.filter(
      r =>
        r.guard === 'user' &&
        (r.route.startsWith('notifications') || r.route.startsWith('trainee/'))
    ).map(r => `${r.method} ${r.route}`);
    // Master data without personal data, open without a session: the
    // Lernfelder of an occupation (list and detail, the catalog comes from the
    // optional session or ?catalog=) and the public list of the softskill
    // criteria. They answer the same for everybody who asks for one catalog.
    const open = [
      'GET trainee/school/lernfelder',
      'GET trainee/lernfelder',
      'GET trainee/lernfelder/[id]',
      'GET trainee/evaluations/softskills',
    ];
    expect([...listed, ...open].sort()).toEqual(found.sort());
  });

  it('lists every trainer, admin and me handler', async () => {
    // A new route file under these folders has to be added to the table, so it
    // is tested for 401 and 403 and cannot be forgotten
    const { readdirSync, readFileSync, statSync } = await import('fs');
    const { join } = await import('path');
    const base = join(process.cwd(), 'src/app/api');
    const found: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (statSync(full).isDirectory()) walk(full);
        else if (name === 'route.ts') {
          const route = full
            .slice(base.length + 1)
            .split('\\')
            .join('/')
            .replace(/\/route\.ts$/, '');
          if (/^(trainer|admin|me)\//.test(route)) {
            const source = readFileSync(full, 'utf8');
            for (const m of source.matchAll(
              /export async function (GET|POST|PUT|PATCH|DELETE)/g
            )) {
              found.push(`${m[1]} ${route}`);
            }
          }
        }
      }
    };
    walk(base);
    const listed = GUARDED_ROUTES.filter(r =>
      /^(trainer|admin|me)\//.test(r.route)
    ).map(r => `${r.method} ${r.route}`);
    expect(listed.sort()).toEqual(found.sort());
  });

  describe.each(GUARDED_ROUTES)('$method /api/$route', entry => {
    it('401 without a token', async () => {
      const { handler, db } = await loadHandler(entry, {});
      const res = await handler(...buildCall(entry, null));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Unauthorized' });
      // Nothing was read from the database, not even the profile
      expect(db.select).not.toHaveBeenCalled();
    });

    it(`403 for a caller below ${entry.guard}`, async () => {
      const { handler, db } = await loadHandler(
        entry,
        TOO_LOW_ROLE[entry.guard]
      );
      const res = await handler(...buildCall(entry, TOKEN));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Forbidden' });
      // Only the session lookup ran, the handler did not query anything else
      expect(db.select).toHaveBeenCalledTimes(1);
      expect(db.insert).not.toHaveBeenCalled();
      expect(db.update).not.toHaveBeenCalled();
      expect(db.delete).not.toHaveBeenCalled();
    });
  });

  it('lists every exported HAI handler in the table', () => {
    // A new method on a HAI route without a guard entry fails here
    const dir = path.join(process.cwd(), 'src/app/api/hai');
    const found: string[] = [];
    for (const name of fs.readdirSync(dir)) {
      const file = path.join(dir, name, 'route.ts');
      if (!fs.existsSync(file)) continue;
      const source = fs.readFileSync(file, 'utf8');
      for (const m of source.matchAll(
        /export\s+async\s+function\s+(GET|POST|PUT|PATCH|DELETE)\b/g
      )) {
        found.push(`${m[1]} hai/${name}`);
      }
    }
    const listed = GUARDED_ROUTES.filter(r => r.route.startsWith('hai/')).map(
      r => `${r.method} ${r.route}`
    );
    expect(found.length).toBeGreaterThanOrEqual(16);
    expect(listed.sort()).toEqual(found.sort());
  });

  it('401 for a token that Supabase rejects', async () => {
    const entry = GUARDED_ROUTES.find(r => r.route === 'trainer/content')!;
    const { handler } = await loadHandler(entry, {});
    const res = await handler(...buildCall(entry, 'forged-token'));
    expect(res.status).toBe(401);
  });

  it('lets a trainer through the trainer guard', async () => {
    const entry = GUARDED_ROUTES.find(
      r => r.route === 'trainer/content' && r.method === 'GET'
    )!;
    const { handler } = await loadHandler(entry, { role: 'TRAINER' });
    const res = await handler(...buildCall(entry, TOKEN));
    expect(res.status).not.toBe(401);
    expect(res.status).not.toBe(403);
  });
});
