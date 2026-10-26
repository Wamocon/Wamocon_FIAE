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

// Creating and deleting users in Preview. Preview and Production share one
// Supabase Auth, so an account created in Preview carries
// app_metadata.preview_only = true, and a delete in Preview removes the auth
// account only when it carries that flag. Every auth.admin.* call here goes to
// a mock, never to Supabase.

const ORG = '11111111-1111-4111-8111-111111111111';
const NEW_ID = '55555555-5555-4555-8555-555555555555';
const TARGET = '66666666-6666-4666-8666-666666666666';

const admin = fakeSession({
  id: '77777777-7777-4777-8777-777777777777',
  role: 'ADMIN',
  organizationId: ORG,
  isAdmin: true,
});

const flagged = { app_metadata: { preview_only: true } };
const shared = { app_metadata: { provider: 'email', providers: ['email'] } };

type LoadOptions = {
  preview: boolean;
  /** Result of auth.admin.getUserById. */
  lookup?: { user?: unknown; error?: unknown; throws?: boolean };
  deleteUserError?: unknown;
  deleteUserThrows?: boolean;
  createUserError?: string;
  targetRole?: string;
  targetEmail?: string;
  /** The first read of profiles is the delete target, not the e-mail check. */
  forDelete?: boolean;
};

async function load(options: LoadOptions) {
  jest.resetModules();
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SECRET_KEY = 'service-key';
  process.env.RESEND_API_KEY = 're_test_key';
  process.env.ADMIN_EMAIL = 'owner@example.com';

  const actual: any = jest.requireActual('@/lib/db-schema');
  jest.doMock('@/lib/db-schema', () => ({
    ...actual,
    IS_PREVIEW_SCHEMA: options.preview,
  }));

  const mock = createTableDb({
    organizations: [
      { id: ORG, name: 'Org', maxTraineeSeats: 5, maxTrainerSeats: 3 },
    ],
    // reads of profiles: the e-mail check, the early seat count and the seat
    // count of the transaction (create), or the target of a delete (first)
    profiles: {
      sequence: [
        options.forDelete
          ? [
              {
                id: TARGET,
                email: options.targetEmail ?? 'target@example.com',
                role: options.targetRole ?? 'TRAINEE',
                organizationId: ORG,
              },
            ]
          : [],
        [],
        [],
      ],
    },
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(admin);

  const lookup = options.lookup ?? {};
  const getUserById = jest.fn(async (_id: string) => {
    if (lookup.throws) throw new Error('auth unavailable');
    return {
      data: { user: lookup.user === undefined ? null : lookup.user },
      error: lookup.error ?? null,
    };
  });
  const createUser = jest.fn(async (_attributes: unknown) =>
    options.createUserError
      ? { data: { user: null }, error: { message: options.createUserError } }
      : { data: { user: { id: NEW_ID } }, error: null }
  );
  const deleteUser = jest.fn(async (_id: string) => {
    if (options.deleteUserThrows) throw new Error('auth unavailable');
    return { error: options.deleteUserError ?? null };
  });
  jest.doMock('@supabase/supabase-js', () => ({
    __esModule: true,
    createClient: () => ({
      auth: { admin: { createUser, deleteUser, getUserById } },
    }),
  }));
  const sendCredentialsEmail = jest.fn(async () => ({ success: true }));
  jest.doMock('@/lib/email', () => ({ sendCredentialsEmail }));

  const create = await import('@/app/api/admin/users/route');
  const remove = await import('@/app/api/admin/users/[userId]/route');
  return {
    create,
    remove,
    mock,
    createUser,
    deleteUser,
    getUserById,
    sendCredentialsEmail,
  };
}

const loadDelete = (options: LoadOptions) =>
  load({ ...options, forDelete: true });

const body = (overrides: Record<string, unknown> = {}) => ({
  email: 'new.user@example.com',
  fullName: 'New User',
  role: 'TRAINER',
  organizationId: ORG,
  ...overrides,
});
const post = (data: unknown) =>
  makeRequest('POST', 'http://localhost/api/admin/users', {
    token: 't',
    body: data,
  });
const del = (userId: string) =>
  [
    makeRequest('DELETE', `http://localhost/api/admin/users/${userId}`, {
      token: 't',
    }),
    { params: Promise.resolve({ userId }) },
  ] as const;

const profileDeletes = (mock: {
  calls: { op: string; table: string | null }[];
}) => mock.calls.filter(c => c.op === 'delete' && c.table === 'profiles');

describe('POST /api/admin/users in Preview', () => {
  beforeEach(() => jest.clearAllMocks());

  it('creates the account with app_metadata.preview_only and the profile in the Preview schema', async () => {
    const { create, createUser, mock } = await load({ preview: true });
    const res = await create.POST(post(body()));
    expect(res.status).toBe(201);
    expect(createUser).toHaveBeenCalledTimes(1);
    const attributes: any = createUser.mock.calls[0][0];
    expect(attributes.app_metadata).toEqual({ preview_only: true });
    // the flag is set by the service role, never through user_metadata
    expect(attributes.user_metadata).not.toHaveProperty('preview_only');
    expect(mock.writes('insert', 'profiles')).toEqual([
      expect.objectContaining({ id: NEW_ID, email: 'new.user@example.com' }),
    ]);
    const json: any = await res.json();
    expect(json.success).toBe(true);
    expect(json.credentials.password).toHaveLength(12);
  });

  it('does not send the credentials mail by default and says so', async () => {
    const { create, sendCredentialsEmail } = await load({ preview: true });
    const res = await create.POST(post(body()));
    expect(sendCredentialsEmail).not.toHaveBeenCalled();
    expect((await res.json()).emailSent).toBe(false);
  });

  it('does not send the mail for sendEmail false or for a value that is not true', async () => {
    for (const sendEmail of [false, 'true', 1, null]) {
      const { create, sendCredentialsEmail } = await load({ preview: true });
      const res = await create.POST(post(body({ sendEmail })));
      expect(res.status).toBe(201);
      expect(sendCredentialsEmail).not.toHaveBeenCalled();
    }
  });

  it('sends the mail only when the administrator asks with sendEmail true', async () => {
    const { create, sendCredentialsEmail } = await load({ preview: true });
    const res = await create.POST(post(body({ sendEmail: true })));
    expect(res.status).toBe(201);
    expect(sendCredentialsEmail).toHaveBeenCalledTimes(1);
    expect((await res.json()).emailSent).toBe(true);
  });

  it('keeps the role and organization rules (an ADMIN of another organization gets 403)', async () => {
    const { create, createUser } = await load({ preview: true });
    const res = await create.POST(
      post(body({ organizationId: '22222222-2222-4222-8222-222222222222' }))
    );
    expect(res.status).toBe(403);
    expect(createUser).not.toHaveBeenCalled();
  });

  it('answers a generic error that does not reveal existing addresses when the account cannot be created', async () => {
    const log = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { create, mock } = await load({
      preview: true,
      createUserError:
        'A user with this email address has already been registered',
    });
    const res = await create.POST(post(body()));
    expect(res.status).toBe(400);
    const json: any = await res.json();
    expect(json.error).not.toMatch(/registered/);
    expect(mock.writes('insert', 'profiles')).toHaveLength(0);
    log.mockRestore();
  });
});

describe('POST /api/admin/users outside of Preview (unchanged)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('still answers the text of the auth server when the account cannot be created', async () => {
    const { create } = await load({
      preview: false,
      createUserError:
        'A user with this email address has already been registered',
    });
    const res = await create.POST(post(body()));
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/already been registered/);
  });

  it('sets no app_metadata and no other new field', async () => {
    const { create, createUser } = await load({ preview: false });
    const res = await create.POST(post(body()));
    expect(res.status).toBe(201);
    const attributes: any = createUser.mock.calls[0][0];
    expect(attributes).not.toHaveProperty('app_metadata');
    expect(Object.keys(attributes).sort()).toEqual([
      'email',
      'email_confirm',
      'password',
      'user_metadata',
    ]);
    expect(attributes.user_metadata).toEqual({
      full_name: 'New User',
      role: 'TRAINER',
    });
  });

  it('sends the mail unless it is switched off', async () => {
    const on = await load({ preview: false });
    await on.create.POST(post(body()));
    expect(on.sendCredentialsEmail).toHaveBeenCalledTimes(1);

    const off = await load({ preview: false });
    await off.create.POST(post(body({ sendEmail: false })));
    expect(off.sendCredentialsEmail).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/users/[userId] in Preview', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes the profile and the auth account that carries the flag', async () => {
    const ctx = await loadDelete({ preview: true, lookup: { user: flagged } });
    const res = await ctx.remove.DELETE(...del(TARGET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true, authAccountKept: false });
    expect(profileDeletes(ctx.mock)).toHaveLength(1);
    expect(ctx.getUserById).toHaveBeenCalledWith(TARGET);
    expect(ctx.deleteUser).toHaveBeenCalledWith(TARGET);
  });

  it('deletes only the Preview profile of a real, shared account and says so', async () => {
    const ctx = await loadDelete({ preview: true, lookup: { user: shared } });
    const res = await ctx.remove.DELETE(...del(TARGET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      authAccountKept: true,
      authAccountKeptReason: 'SHARED_ACCOUNT',
    });
    expect(profileDeletes(ctx.mock)).toHaveLength(1);
    expect(ctx.deleteUser).not.toHaveBeenCalled();
  });

  it('keeps the auth account when the lookup fails (fail closed), the profile is still deleted', async () => {
    const ctx = await loadDelete({
      preview: true,
      lookup: { error: { message: 'boom' } },
    });
    const res = await ctx.remove.DELETE(...del(TARGET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      authAccountKept: true,
      authAccountKeptReason: 'CHECK_FAILED',
    });
    expect(profileDeletes(ctx.mock)).toHaveLength(1);
    expect(ctx.deleteUser).not.toHaveBeenCalled();
  });

  it('keeps the auth account when the lookup throws (fail closed)', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = await loadDelete({ preview: true, lookup: { throws: true } });
    const res = await ctx.remove.DELETE(...del(TARGET));
    expect(res.status).toBe(200);
    expect((await res.json()).authAccountKept).toBe(true);
    expect(ctx.deleteUser).not.toHaveBeenCalled();
    error.mockRestore();
  });

  it('keeps the account when the lookup finds no user at all', async () => {
    const ctx = await loadDelete({ preview: true, lookup: {} });
    const res = await ctx.remove.DELETE(...del(TARGET));
    expect((await res.json()).authAccountKept).toBe(true);
    expect(ctx.deleteUser).not.toHaveBeenCalled();
  });

  it('reports a failed delete of a flagged account as kept', async () => {
    const error = jest.spyOn(console, 'error').mockImplementation(() => {});
    const ctx = await loadDelete({
      preview: true,
      lookup: { user: flagged },
      deleteUserError: { message: 'no' },
    });
    const res = await ctx.remove.DELETE(...del(TARGET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      authAccountKept: true,
      authAccountKeptReason: 'DELETE_FAILED',
    });
    error.mockRestore();
  });

  it('never touches the auth account when the Supabase variables are missing', async () => {
    const ctx = await loadDelete({ preview: true, lookup: { user: flagged } });
    delete process.env.SUPABASE_SECRET_KEY;
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    const res = await ctx.remove.DELETE(...del(TARGET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      success: true,
      authAccountKept: true,
      authAccountKeptReason: 'NOT_CONFIGURED',
    });
    expect(ctx.getUserById).not.toHaveBeenCalled();
    expect(ctx.deleteUser).not.toHaveBeenCalled();
    process.env.SUPABASE_SECRET_KEY = 'service-key';
  });

  it('keeps the rule that nobody deletes themselves', async () => {
    const ctx = await loadDelete({ preview: true, lookup: { user: flagged } });
    const res = await ctx.remove.DELETE(...del('77777777-7777-4777-8777-777777777777'));
    expect(res.status).toBe(400);
    expect(ctx.getUserById).not.toHaveBeenCalled();
    expect(ctx.deleteUser).not.toHaveBeenCalled();
  });

  it('answers 404 and touches no account for an id without a Preview profile', async () => {
    const ctx = await loadDelete({ preview: true, lookup: { user: flagged } });
    // an empty Preview profiles table: the target does not exist there
    const empty = createTableDb({ profiles: [] });
    ctx.mock.db.select.mockImplementation(empty.db.select);
    const res = await ctx.remove.DELETE(...del(TARGET));
    expect(res.status).toBe(404);
    expect(ctx.getUserById).not.toHaveBeenCalled();
    expect(ctx.deleteUser).not.toHaveBeenCalled();
  });

  it('protects the primary admin account in Preview too', async () => {
    const ctx = await loadDelete({
      preview: true,
      lookup: { user: flagged },
      targetEmail: 'owner@example.com',
    });
    const res = await ctx.remove.DELETE(...del(TARGET));
    expect(res.status).toBe(403);
    expect(profileDeletes(ctx.mock)).toHaveLength(0);
    expect(ctx.getUserById).not.toHaveBeenCalled();
    expect(ctx.deleteUser).not.toHaveBeenCalled();
  });
});

describe('DELETE /api/admin/users/[userId] outside of Preview (unchanged)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('deletes the profile and the auth account without looking at the flag', async () => {
    const ctx = await loadDelete({ preview: false, lookup: { user: shared } });
    const res = await ctx.remove.DELETE(...del(TARGET));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(profileDeletes(ctx.mock)).toHaveLength(1);
    expect(ctx.getUserById).not.toHaveBeenCalled();
    expect(ctx.deleteUser).toHaveBeenCalledWith(TARGET);
  });
});
