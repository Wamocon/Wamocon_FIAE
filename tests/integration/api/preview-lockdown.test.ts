/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../helpers/mockDb';

// Preview shares the Supabase Auth of Production. The public self-registration
// (POST /api/register) answers 403 in Preview, before it touches anything, and
// keeps working unchanged in Production. The two administrator routes
// (POST /api/admin/users, DELETE /api/admin/users/[userId]) are open in
// Preview, they flag and check the accounts (tests/integration/api/admin/
// users-preview.test.ts).

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

const admin = { id: '77777777-7777-4777-8777-777777777777', role: 'ADMIN', organizationId: 'org1' };

async function load(preview: boolean) {
  jest.resetModules();
  const actual: any = jest.requireActual('@/lib/db-schema');
  jest.doMock('@/lib/db-schema', () => ({
    ...actual,
    IS_PREVIEW_SCHEMA: preview,
  }));
  const table = createTableDb({
    profiles: { sequence: [[], [{ id: 'tr1' }], [{ id: 'tr1' }]] },
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: table.db }));
  // the e-mail client needs an API key at import time
  jest.doMock('@/lib/email', () => ({
    __esModule: true,
    sendCredentialsEmail: jest.fn(),
  }));
  const actualSession: any = jest.requireActual('@/lib/auth/session');
  jest.doMock('@/lib/auth/session', () => ({
    ...actualSession,
    requireAdmin: jest.fn(async () => admin),
    isErrorResponse: () => false,
  }));
  const createUser = jest.fn(async () => ({
    data: { user: { id: 'u-new', email: 'x@example.com' } },
    error: null,
  }));
  const deleteUser = jest.fn(async () => ({ error: null }));
  const supa = await import('@supabase/supabase-js');
  (supa.createClient as jest.Mock).mockReturnValue({
    auth: { admin: { createUser, deleteUser } },
  });
  return { createUser, deleteUser, db: table.db };
}

function jsonRequest(body: unknown, url = 'http://localhost/api/x') {
  return {
    url,
    headers: { get: () => null, entries: () => [] },
    json: async () => body,
  } as any;
}

describe('Preview lockdown of the public self-registration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('POST /api/register answers 403 in Preview and creates no account', async () => {
    const { createUser } = await load(true);
    const { POST } = await import('@/app/api/register/route');
    const res = await POST(
      jsonRequest({ email: 'a@example.com', password: 'secret1' })
    );
    expect(res.status).toBe(403);
    const body: any = await res.json();
    expect(body.code).toBe('PREVIEW_ADMIN_DISABLED');
    expect(body.error).toMatch(/Preview/);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('the administrator routes are no longer locked in Preview', async () => {
    await load(true);
    const { DELETE } = await import('@/app/api/admin/users/[userId]/route');
    const res = await DELETE(jsonRequest({}), {
      params: Promise.resolve({ userId: '77777777-7777-4777-8777-777777777777' }),
    });
    // reaches the normal logic ("cannot delete yourself"), not the lockdown
    expect(res.status).toBe(400);
  });
});
