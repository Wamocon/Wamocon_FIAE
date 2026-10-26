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

// Module under test: src/lib/auth/session.ts (bearer-token session layer).

type Rows = Parameters<typeof createTableDb>[0];

async function load(options: {
  profile?: Record<string, unknown> | null;
  tokens?: Record<
    string,
    { id: string; email?: string; app_metadata?: Record<string, unknown> }
  >;
  tables?: Rows;
  dbError?: Error;
  /** Simulate the Preview deployment (IS_PREVIEW_SCHEMA). */
  preview?: boolean;
}) {
  jest.resetModules();
  if (options.preview !== undefined) {
    const actual: any = jest.requireActual('@/lib/db-schema');
    jest.doMock('@/lib/db-schema', () => ({
      ...actual,
      IS_PREVIEW_SCHEMA: options.preview,
    }));
  }
  const getUser = mockSupabaseAuth(
    options.tokens ?? { good: { id: 'session-user', email: 'a@example.com' } }
  );
  const rows =
    options.profile === null ? [] : [sessionProfileRow(options.profile ?? {})];
  const { db } = createTableDb(options.tables ?? { profiles: rows });
  if (options.dbError) {
    db.select = jest.fn(() => {
      throw options.dbError;
    });
  }
  jest.doMock('@/db', () => ({ __esModule: true, default: db }));
  const session = await import('@/lib/auth/session');
  return { ...session, getUser, db };
}

const authed = () =>
  makeRequest('GET', 'http://localhost/api/x', { token: 'good' });
const anonymous = () => makeRequest('GET', 'http://localhost/api/x');

describe('auth/session', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  });

  describe('getSessionUser', () => {
    it('returns null without a token', async () => {
      const { getSessionUser, getUser } = await load({});
      expect(await getSessionUser(anonymous())).toBeNull();
      expect(getUser).not.toHaveBeenCalled();
    });

    it('returns null for a token Supabase rejects', async () => {
      const { getSessionUser } = await load({});
      const req = makeRequest('GET', 'http://localhost/x', { token: 'forged' });
      expect(await getSessionUser(req)).toBeNull();
    });

    it('builds the session from the verified token and the database row', async () => {
      const { getSessionUser } = await load({
        profile: { role: 'trainer', organizationId: 'org-9' },
      });
      expect(await getSessionUser(authed())).toMatchObject({
        id: 'session-user',
        role: 'TRAINER',
        organizationId: 'org-9',
        isSuperAdmin: false,
        isAdmin: false,
        isTrainerLevel: true,
      });
    });

    it('treats an ADMIN of the platform-owner organization as super admin', async () => {
      const { getSessionUser } = await load({
        profile: { role: 'ADMIN', isPlatformOwner: true },
      });
      expect(await getSessionUser(authed())).toMatchObject({
        isSuperAdmin: true,
        isAdmin: true,
      });
    });

    it('falls back to the default organization for profiles without one', async () => {
      const { getSessionUser } = await load({
        profile: { organizationId: null },
      });
      const session = await getSessionUser(authed());
      expect(session?.organizationId).toBe(
        '00000000-0000-0000-0000-000000000001'
      );
    });

    it('caches a verified token so Supabase is asked once', async () => {
      const { getSessionUser, getUser } = await load({});
      await getSessionUser(authed());
      await getSessionUser(authed());
      expect(getUser).toHaveBeenCalledTimes(1);
    });
  });

  describe('requireUser', () => {
    it('401 without a token', async () => {
      const { requireUser, isErrorResponse } = await load({});
      const res = await requireUser(anonymous());
      expect(isErrorResponse(res)).toBe(true);
      expect((res as Response).status).toBe(401);
      expect(await (res as Response).json()).toEqual({ error: 'Unauthorized' });
    });

    it('401 for an invalid token', async () => {
      const { requireUser } = await load({});
      const res = await requireUser(
        makeRequest('GET', 'http://localhost/x', { token: 'nope' })
      );
      expect((res as Response).status).toBe(401);
    });

    it('403 when the user has no profile', async () => {
      const { requireUser } = await load({ profile: null });
      const res = await requireUser(authed());
      expect((res as Response).status).toBe(403);
    });

    it('403 for a deactivated user or organization', async () => {
      const inactiveUser = await load({ profile: { isActive: false } });
      expect(
        ((await inactiveUser.requireUser(authed())) as Response).status
      ).toBe(403);
      const inactiveOrg = await load({ profile: { orgIsActive: false } });
      expect(
        ((await inactiveOrg.requireUser(authed())) as Response).status
      ).toBe(403);
    });

    it('403 for an unknown role value', async () => {
      const { requireUser } = await load({ profile: { role: 'ROOT' } });
      expect(((await requireUser(authed())) as Response).status).toBe(403);
    });

    it('503 when the profile lookup fails', async () => {
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { requireUser } = await load({ dbError: new Error('boom') });
      expect(((await requireUser(authed())) as Response).status).toBe(503);
      spy.mockRestore();
    });

    it('500 when Supabase is not configured', async () => {
      delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
      const { requireUser } = await load({});
      expect(((await requireUser(authed())) as Response).status).toBe(500);
    });

    it('returns the session for any active role', async () => {
      const { requireUser, isErrorResponse } = await load({
        profile: { role: 'TRAINEE' },
      });
      const res = await requireUser(authed());
      expect(isErrorResponse(res)).toBe(false);
      expect(res).toMatchObject({ role: 'TRAINEE' });
    });
  });

  describe('requireTrainer / requireAdmin / requireSuperAdmin', () => {
    it.each([
      ['TRAINEE', 403],
      ['TRAINER', 200],
      ['TEMP_ADMIN', 200],
      ['ADMIN', 200],
    ])('requireTrainer for %s -> %s', async (role, status) => {
      const { requireTrainer, isErrorResponse } = await load({
        profile: { role },
      });
      const res = await requireTrainer(authed());
      expect(isErrorResponse(res) ? (res as Response).status : 200).toBe(
        status
      );
    });

    it.each([
      ['TRAINEE', 403],
      ['TRAINER', 403],
      ['TEMP_ADMIN', 200],
      ['ADMIN', 200],
    ])('requireAdmin for %s -> %s', async (role, status) => {
      const { requireAdmin, isErrorResponse } = await load({
        profile: { role },
      });
      const res = await requireAdmin(authed());
      expect(isErrorResponse(res) ? (res as Response).status : 200).toBe(
        status
      );
    });

    it.each([
      [{ role: 'TRAINER' }, 403],
      [{ role: 'TEMP_ADMIN', isPlatformOwner: true }, 403],
      [{ role: 'ADMIN', isPlatformOwner: false }, 403],
      [{ role: 'ADMIN', isPlatformOwner: true }, 200],
      [{ role: 'SUPER_ADMIN' }, 200],
    ])('requireSuperAdmin for %j -> %s', async (profile, status) => {
      const { requireSuperAdmin, isErrorResponse } = await load({ profile });
      const res = await requireSuperAdmin(authed());
      expect(isErrorResponse(res) ? (res as Response).status : 200).toBe(
        status
      );
    });

    it('all of them answer 401 without a token', async () => {
      const m = await load({});
      for (const fn of [
        m.requireTrainer,
        m.requireAdmin,
        m.requireSuperAdmin,
      ]) {
        expect(((await fn(anonymous())) as Response).status).toBe(401);
      }
    });
  });

  describe('scopeOrg', () => {
    const base = {
      id: 'u',
      email: null,
      fullName: null,
      role: 'ADMIN' as const,
      organizationId: 'org-1',
      isPlatformOwner: false,
      isSuperAdmin: false,
      isAdmin: true,
      isTrainerLevel: true,
    };

    it('pins admins and trainers to their own organization', async () => {
      const { scopeOrg } = await load({});
      expect(scopeOrg(base)).toEqual({
        organizationId: 'org-1',
        isGlobal: false,
      });
      // A requested organization is ignored for non-super admins
      expect(scopeOrg(base, 'org-2')).toEqual({
        organizationId: 'org-1',
        isGlobal: false,
      });
    });

    it('is global for the super admin, narrowed by an explicit request', async () => {
      const { scopeOrg } = await load({});
      const sa = { ...base, isSuperAdmin: true };
      expect(scopeOrg(sa)).toEqual({ organizationId: null, isGlobal: true });
      expect(scopeOrg(sa, 'org-2')).toEqual({
        organizationId: 'org-2',
        isGlobal: false,
      });
    });

    it('isInOrgScope and orgScopeCondition follow the scope', async () => {
      const { isInOrgScope, orgScopeCondition } = await load({});
      expect(isInOrgScope({ organizationId: null, isGlobal: true }, 'x')).toBe(
        true
      );
      expect(
        isInOrgScope({ organizationId: 'org-1', isGlobal: false }, 'org-1')
      ).toBe(true);
      expect(
        isInOrgScope({ organizationId: 'org-1', isGlobal: false }, 'org-2')
      ).toBe(false);
      const schema = await import('@/db/migrations/schemas/schema');
      expect(
        orgScopeCondition(schema.profiles.organizationId, {
          organizationId: null,
          isGlobal: true,
        })
      ).toBeUndefined();
      expect(
        orgScopeCondition(schema.profiles.organizationId, {
          organizationId: 'org-1',
          isGlobal: false,
        })
      ).toBeDefined();
    });

    // A row without an organization (a profile or record that never got one)
    // belongs to nobody. It used to count as the default organization here,
    // while the SQL conditions (orgScopeCondition and the helpers built on it)
    // excluded it. Now both fail closed: only the platform-wide view of the
    // super admin reaches it.
    describe('a row without an organization', () => {
      const DEFAULT_ORG = '00000000-0000-0000-0000-000000000001';

      it.each([
        ['null', null],
        ['undefined', undefined],
        ['an empty string', ''],
      ])('is outside every organization scope (%s)', async (_name, value) => {
        const { isInOrgScope } = await load({});
        for (const organizationId of [DEFAULT_ORG, 'org-1']) {
          expect(isInOrgScope({ organizationId, isGlobal: false }, value)).toBe(
            false
          );
        }
      });

      it('is inside the platform-wide scope of the super admin', async () => {
        const { isInOrgScope } = await load({});
        expect(
          isInOrgScope({ organizationId: null, isGlobal: true }, null)
        ).toBe(true);
        expect(
          isInOrgScope({ organizationId: null, isGlobal: true }, undefined)
        ).toBe(true);
      });

      it('is outside the scope of a super admin who narrowed the view to one organization', async () => {
        const { isInOrgScope, scopeOrg } = await load({});
        const narrowed = scopeOrg(
          {
            id: 'sa',
            email: null,
            fullName: null,
            role: 'SUPER_ADMIN',
            organizationId: DEFAULT_ORG,
            isPlatformOwner: true,
            isSuperAdmin: true,
            isAdmin: true,
            isTrainerLevel: true,
          },
          'org-1'
        );
        expect(isInOrgScope(narrowed, null)).toBe(false);
      });

      it('does not match the default organization any more', async () => {
        const { isInOrgScope } = await load({});
        // the default organization itself still matches by id
        expect(
          isInOrgScope(
            { organizationId: DEFAULT_ORG, isGlobal: false },
            DEFAULT_ORG
          )
        ).toBe(true);
        expect(
          isInOrgScope({ organizationId: DEFAULT_ORG, isGlobal: false }, null)
        ).toBe(false);
      });
    });
  });
});

describe('auth/session: accounts created in Preview', () => {
  beforeEach(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
  });

  const flaggedToken = {
    good: {
      id: 'session-user',
      email: 'a@example.com',
      app_metadata: { preview_only: true },
    },
  };

  it('Production answers 403 for an account flagged preview_only, even with a profile', async () => {
    const { authenticate, requireUser, isErrorResponse, db } = await load({
      tokens: flaggedToken,
      preview: false,
    });
    expect(await authenticate(authed())).toEqual({
      ok: false,
      status: 403,
      error: 'Forbidden',
    });
    const res = await requireUser(authed());
    expect(isErrorResponse(res)).toBe(true);
    expect((res as Response).status).toBe(403);
    // the profile is not even read
    expect(db.select).not.toHaveBeenCalled();
  });

  it('rejects the flagged account on every request, also from the token cache', async () => {
    const { authenticate, getUser } = await load({
      tokens: flaggedToken,
      preview: false,
    });
    await authenticate(authed());
    const again = await authenticate(authed());
    expect(again.ok).toBe(false);
    expect(getUser).toHaveBeenCalledTimes(1);
  });

  it('Preview accepts the flagged account', async () => {
    const { getSessionUser } = await load({
      tokens: flaggedToken,
      preview: true,
    });
    expect(await getSessionUser(authed())).toMatchObject({
      id: 'session-user',
    });
  });

  it('Production accepts normal accounts as before (with and without app_metadata)', async () => {
    const plain = await load({ preview: false });
    expect(await plain.getSessionUser(authed())).toMatchObject({
      id: 'session-user',
    });
    const withMetadata = await load({
      preview: false,
      tokens: {
        good: {
          id: 'session-user',
          email: 'a@example.com',
          app_metadata: { provider: 'email', providers: ['email'] },
        },
      },
    });
    expect(await withMetadata.getSessionUser(authed())).toMatchObject({
      id: 'session-user',
    });
  });

  it('only the boolean true counts as the flag', async () => {
    const { getSessionUser } = await load({
      preview: false,
      tokens: {
        good: {
          id: 'session-user',
          email: 'a@example.com',
          app_metadata: { preview_only: 'false' },
        },
      },
    });
    expect(await getSessionUser(authed())).not.toBeNull();
  });
});
