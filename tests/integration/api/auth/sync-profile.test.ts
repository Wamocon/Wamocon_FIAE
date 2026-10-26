/**
 * @jest-environment node
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

function makePost(url: string, headers: any = {}) {
  return {
    url,
    headers: { get: (k: string) => headers[k] },
    method: 'POST',
  } as any;
}

const authed = { authorization: 'Bearer token' };

// Mock modules BEFORE import
jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

function supabaseReturning(user: any, error: any = null) {
  return {
    auth: {
      getUser: jest.fn().mockResolvedValue({
        data: { user: user ?? null },
        error,
      }),
    },
  };
}

async function importHandlerWithDb(
  mockDb: any,
  mockSupa: any,
  preview?: boolean
) {
  jest.resetModules();
  if (preview !== undefined) {
    const actual: any = jest.requireActual('@/lib/db-schema');
    jest.doMock('@/lib/db-schema', () => ({
      ...actual,
      IS_PREVIEW_SCHEMA: preview,
    }));
  }
  jest.doMock('@/db', () => ({ __esModule: true, default: mockDb }));
  jest.doMock('@/lib/profile-identity', () => ({
    __esModule: true,
    mergeProfileReferences: jest.fn(),
  }));
  const supa = await import('@supabase/supabase-js');
  (supa.createClient as jest.Mock).mockReturnValue(mockSupa);

  const mod = await import('@/app/api/auth/sync-profile/route');
  return mod.POST as (req: any) => Promise<Response>;
}

describe('API: Auth Sync Profile', () => {
  const savedAdminEmail = process.env.ADMIN_EMAIL;

  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'http://test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'key';
    delete process.env.DEFAULT_TRAINER_ID;
    delete process.env.DEFAULT_TRAINER_EMAIL;
    delete process.env.ADMIN_EMAIL;
  });

  afterEach(() => {
    if (savedAdminEmail === undefined) delete process.env.ADMIN_EMAIL;
    else process.env.ADMIN_EMAIL = savedAdminEmail;
  });

  it('401 if missing auth header', async () => {
    const { db } = createTableDb();
    const POST = await importHandlerWithDb(db, {});
    const res = await POST(makePost('http://localhost/api/auth/sync-profile'));
    expect(res.status).toBe(401);
  });

  it('401 if the token is rejected by Supabase', async () => {
    const { db } = createTableDb();
    const POST = await importHandlerWithDb(
      db,
      supabaseReturning(null, { message: 'invalid JWT' })
    );
    const res = await POST(
      makePost('http://localhost/api/auth/sync-profile', authed)
    );
    expect(res.status).toBe(401);
  });

  it('creates a new profile as TRAINEE and ignores user_metadata.role', async () => {
    const mockUser = {
      id: 'u1',
      email: 'new@example.com',
      user_metadata: { role: 'TRAINER' },
    };
    const { db, writes } = createTableDb({
      // first lookup by e-mail finds nothing, then a default trainer
      profiles: { sequence: [[], [{ id: 'tr1' }]] },
    });

    const POST = await importHandlerWithDb(db, supabaseReturning(mockUser));
    const res = await POST(
      makePost('http://localhost/api/auth/sync-profile', authed)
    );
    expect(res.status).toBe(200);

    const inserted: any = writes('insert', 'profiles')[0];
    expect(inserted).toMatchObject({
      id: 'u1',
      email: 'new@example.com',
      role: 'TRAINEE',
      trainerActivated: false,
      assignedTrainerId: 'tr1',
    });
    expect(writes('update', 'profiles')[0]).toEqual({
      assignedTrainerId: 'tr1',
    });
  });

  it('does not promote the ADMIN_EMAIL address to ADMIN', async () => {
    process.env.ADMIN_EMAIL = 'boss@example.com';
    const mockUser = { id: 'u2', email: 'Boss@Example.com', user_metadata: {} };
    const { db, writes } = createTableDb({
      profiles: { sequence: [[], []] },
    });

    const POST = await importHandlerWithDb(db, supabaseReturning(mockUser));
    const res = await POST(
      makePost('http://localhost/api/auth/sync-profile', authed)
    );
    expect(res.status).toBe(200);
    expect((writes('insert', 'profiles')[0] as any).role).toBe('TRAINEE');
  });

  it('keeps the role stored in the database for an existing profile', async () => {
    const mockUser = {
      id: 'u3',
      email: 'trainer@example.com',
      user_metadata: { role: 'ADMIN' },
    };
    const { db, writes } = createTableDb({
      profiles: [
        {
          id: 'u3',
          role: 'TRAINER',
          organizationId: 'org1',
          trainerActivated: true,
          ausbildungDurationYears: 3,
        },
      ],
    });

    const POST = await importHandlerWithDb(db, supabaseReturning(mockUser));
    const res = await POST(
      makePost('http://localhost/api/auth/sync-profile', authed)
    );
    expect(res.status).toBe(200);
    expect((writes('insert', 'profiles')[0] as any).role).toBe('TRAINER');
  });

  it('403 when merging into a pre-created profile with an unverified e-mail', async () => {
    const mockUser = {
      id: 'u4',
      email: 'invited@example.com',
      user_metadata: {},
    };
    const { db } = createTableDb({
      profiles: [{ id: 'old-id', role: 'ADMIN', organizationId: 'org1' }],
    });

    const POST = await importHandlerWithDb(db, supabaseReturning(mockUser));
    const res = await POST(
      makePost('http://localhost/api/auth/sync-profile', authed)
    );
    expect(res.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('merges a pre-created profile once the e-mail is confirmed, keeping its role', async () => {
    const mockUser = {
      id: 'u5',
      email: 'invited@example.com',
      email_confirmed_at: '2025-01-01T00:00:00Z',
      user_metadata: { role: 'ADMIN' },
    };
    const { db, writes } = createTableDb({
      profiles: [
        {
          id: 'old-id',
          role: 'TRAINER',
          organizationId: 'org1',
          trainerActivated: true,
        },
      ],
    });

    const POST = await importHandlerWithDb(db, supabaseReturning(mockUser));
    const res = await POST(
      makePost('http://localhost/api/auth/sync-profile', authed)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true, merged: true });
    expect(db.transaction).toHaveBeenCalledTimes(1);
    expect((writes('insert', 'profiles')[0] as any).role).toBe('TRAINER');
  });
});

describe('API: Auth Sync Profile, accounts created in Preview', () => {
  beforeEach(() => {
    jest.resetModules();
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'http://test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'key';
    delete process.env.DEFAULT_TRAINER_ID;
    delete process.env.DEFAULT_TRAINER_EMAIL;
  });

  const flaggedUser = {
    id: 'pv1',
    email: 'preview.user@example.com',
    email_confirmed_at: '2025-01-01T00:00:00Z',
    user_metadata: { full_name: 'Preview User' },
    app_metadata: { preview_only: true },
  };
  const call = (POST: (req: any) => Promise<Response>) =>
    POST(makePost('http://localhost/api/auth/sync-profile', authed));

  it('Production rejects a flagged account with 403, a German message and no database access', async () => {
    const { db, calls } = createTableDb({ profiles: { sequence: [[], []] } });
    const POST = await importHandlerWithDb(
      db,
      supabaseReturning(flaggedUser),
      false
    );
    const res = await call(POST);
    expect(res.status).toBe(403);
    const json: any = await res.json();
    expect(json.code).toBe('PREVIEW_ACCOUNT_REJECTED');
    expect(json.error).toMatch(/Preview/);
    expect(json.error).toMatch(/Production/);
    expect(calls).toHaveLength(0);
    expect(db.transaction).not.toHaveBeenCalled();
  });

  it('Production does not merge a flagged account into a pre-created profile with the same address', async () => {
    const { db, writes } = createTableDb({
      profiles: [
        {
          id: 'old-id',
          role: 'ADMIN',
          organizationId: 'org1',
          trainerActivated: true,
        },
      ],
    });
    const POST = await importHandlerWithDb(
      db,
      supabaseReturning(flaggedUser),
      false
    );
    const res = await call(POST);
    expect(res.status).toBe(403);
    expect(db.transaction).not.toHaveBeenCalled();
    expect(writes('insert', 'profiles')).toHaveLength(0);
    expect(writes('update', 'profiles')).toHaveLength(0);
    expect(writes('delete', 'profiles')).toHaveLength(0);
  });

  it('Preview creates the profile of a flagged account as before', async () => {
    const { db, writes } = createTableDb({
      profiles: { sequence: [[], [{ id: 'tr1' }]] },
    });
    const POST = await importHandlerWithDb(
      db,
      supabaseReturning(flaggedUser),
      true
    );
    const res = await call(POST);
    expect(res.status).toBe(200);
    expect(writes('insert', 'profiles')[0]).toMatchObject({
      id: 'pv1',
      email: 'preview.user@example.com',
    });
  });

  it('Production creates the profile of a normal account as before', async () => {
    const normal = {
      id: 'n1',
      email: 'normal@example.com',
      user_metadata: {},
      app_metadata: { provider: 'email', providers: ['email'] },
    };
    const { db, writes } = createTableDb({
      profiles: { sequence: [[], [{ id: 'tr1' }]] },
    });
    const POST = await importHandlerWithDb(
      db,
      supabaseReturning(normal),
      false
    );
    const res = await call(POST);
    expect(res.status).toBe(200);
    expect(writes('insert', 'profiles')).toHaveLength(1);
  });

  it('Production treats a user_metadata flag as nothing (the user can set it)', async () => {
    const forged = {
      id: 'n2',
      email: 'forged@example.com',
      user_metadata: { preview_only: true },
    };
    const { db, writes } = createTableDb({
      profiles: { sequence: [[], [{ id: 'tr1' }]] },
    });
    const POST = await importHandlerWithDb(
      db,
      supabaseReturning(forged),
      false
    );
    const res = await call(POST);
    expect(res.status).toBe(200);
    expect(writes('insert', 'profiles')).toHaveLength(1);
  });
});
