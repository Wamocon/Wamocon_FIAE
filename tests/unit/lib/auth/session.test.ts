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
  tokens?: Record<string, { id: string; email?: string }>;
  tables?: Rows;
  dbError?: Error;
}) {
  jest.resetModules();
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
      expect(
        isInOrgScope(
          {
            organizationId: '00000000-0000-0000-0000-000000000001',
            isGlobal: false,
          },
          null
        )
      ).toBe(true);
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
  });
});
