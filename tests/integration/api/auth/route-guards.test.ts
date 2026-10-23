/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
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

// The role that is just below what a guard requires
const TOO_LOW_ROLE: Record<GuardedRoute['guard'], Record<string, unknown>> = {
  trainer: { role: 'TRAINEE' },
  admin: { role: 'TRAINER' },
  // An ADMIN of a customer organization is not a platform-wide admin
  superAdmin: { role: 'ADMIN', isPlatformOwner: false },
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

describe('route guards: trainer and admin handlers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    // lib/email creates the Resend client at import time
    process.env.RESEND_API_KEY = 're_test_key';
  });

  it('covers the expected number of handlers', () => {
    // Guards against the table silently shrinking when files move
    expect(GUARDED_ROUTES.length).toBeGreaterThanOrEqual(100);
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

    it(`403 for a role below ${entry.guard}`, async () => {
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
