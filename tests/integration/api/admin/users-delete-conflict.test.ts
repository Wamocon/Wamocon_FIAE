/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// A profile that created, decided or applied something in the content upload
// cannot be deleted: the foreign keys are on delete restrict (migration
// 20261030000100), the protocol has to outlive the person. The route answers
// that with 409 and a readable text and stops before it touches the auth
// account. Every other failure still ends in 500.

const ORG = '11111111-1111-4111-8111-111111111111';
const TARGET = '66666666-6666-4666-8666-666666666666';

const admin = fakeSession({
  id: '77777777-7777-4777-8777-777777777777',
  role: 'ADMIN',
  organizationId: ORG,
  isAdmin: true,
});

async function load(deleteError?: unknown) {
  jest.resetModules();
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SECRET_KEY = 'service-key';
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.ADMIN_EMAIL = 'owner@example.com';

  const mock = createTableDb({
    profiles: [
      {
        id: TARGET,
        email: 'target@example.com',
        role: 'ADMIN',
        organizationId: ORG,
      },
    ],
  });
  if (deleteError !== undefined) {
    mock.db.delete = jest.fn(() => ({
      where: () => Promise.reject(deleteError),
    }));
  }
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(admin);
  const getUserById = jest.fn(async () => ({
    data: { user: { app_metadata: { preview_only: true } } },
    error: null,
  }));
  const deleteUser = jest.fn(async () => ({ error: null }));
  jest.doMock('@supabase/supabase-js', () => ({
    __esModule: true,
    createClient: () => ({ auth: { admin: { deleteUser, getUserById } } }),
  }));
  const route = await import('@/app/api/admin/users/[userId]/route');
  return { route, mock, deleteUser, getUserById };
}

const del = () =>
  [
    makeRequest('DELETE', `http://localhost/api/admin/users/${TARGET}`, {
      token: 't',
    }),
    { params: Promise.resolve({ userId: TARGET }) },
  ] as const;

describe('DELETE /api/admin/users/[userId] with content upload runs', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it.each([
    [
      'a Drizzle error that wraps the driver error',
      { cause: { code: '23503' } },
    ],
    ['the driver error itself', { code: '23503' }],
  ])('answers 409 with a readable text for %s', async (_name, error) => {
    const ctx = await load(
      Object.assign(new Error('delete from profiles ...'), error)
    );
    const res = await ctx.route.DELETE(...del());
    expect(res.status).toBe(409);
    const body = await res.json();
    expect(body.code).toBe('USER_IN_USE');
    expect(body.error).toMatch(/cannot be deleted/);
    expect(body.error).toMatch(/upload runs/);
    // no text of the failed statement
    expect(JSON.stringify(body)).not.toContain('delete from profiles');
  });

  it('does not touch the auth account when the profile cannot be deleted', async () => {
    const ctx = await load({ cause: { code: '23503' } });
    await ctx.route.DELETE(...del());
    expect(ctx.deleteUser).not.toHaveBeenCalled();
    expect(ctx.getUserById).not.toHaveBeenCalled();
  });

  it('still answers 500 for any other failure of the delete', async () => {
    for (const error of [
      new Error('connection lost'),
      { cause: { code: '40001' } },
      { code: '57014' },
    ]) {
      const ctx = await load(error);
      const res = await ctx.route.DELETE(...del());
      expect(res.status).toBe(500);
      expect(await res.json()).toEqual({ error: 'Internal Server Error' });
      expect(ctx.deleteUser).not.toHaveBeenCalled();
    }
  });

  it('deletes as before when nothing refers to the profile', async () => {
    const ctx = await load();
    const res = await ctx.route.DELETE(...del());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(ctx.deleteUser).toHaveBeenCalledWith(TARGET);
  });
});
