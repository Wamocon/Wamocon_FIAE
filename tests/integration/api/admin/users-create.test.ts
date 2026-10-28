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

// POST /api/admin/users (KfBM S5):
//  - the caller may only hand out roles assignableRoles allows (403 otherwise),
//    in the own organization only
//  - an organization without a free seat answers 409 SEATS_FULL, for everyone
//    (no exception for the platform admin), before the auth account exists
//  - a trainee is enrolled in a catalog together with the profile, and a
//    failure after the auth account was created removes the account again

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const NEW_ID = '55555555-5555-4555-8555-555555555555';

const fiae = { id: FIAE, code: 'FIAE', title: 'FIAE', isActive: true };
const kfbm = { id: KFBM, code: 'KFBM', title: 'KfBM', isActive: true };
const both = [
  { trainingCatalogId: FIAE, isEnabled: true },
  { trainingCatalogId: KFBM, isEnabled: true },
];

const admin = (organizationId = ORG) =>
  fakeSession({ id: 'ad1', role: 'ADMIN', organizationId, isAdmin: true });
const tempAdmin = (organizationId = ORG) =>
  fakeSession({
    id: 'ta1',
    role: 'TEMP_ADMIN',
    organizationId,
    isAdmin: true,
  });
const superAdmin = () =>
  fakeSession({
    id: 'sa1',
    role: 'ADMIN',
    organizationId: OTHER_ORG,
    isAdmin: true,
    isSuperAdmin: true,
    isPlatformOwner: true,
  });

const room = [
  { role: 'TRAINEE', count: 2 },
  { role: 'TRAINER', count: 1 },
];
const fullTrainees = [{ role: 'TRAINEE', count: 5 }];
const fullTrainers = [
  { role: 'TRAINER', count: 2 },
  { role: 'ADMIN', count: 1 },
];

type Options = {
  session?: ReturnType<typeof fakeSession> | null;
  /** Seat usage seen by the early check and by the check in the transaction. */
  early?: any[];
  inTransaction?: any[];
  existingProfile?: boolean;
  organizations?: any[];
  trainingCatalogs?: any[];
  organizationCatalogs?: any[];
  createUserError?: string;
  deleteUserFails?: boolean;
  failEnrollmentWrite?: boolean;
  failProfileWrite?: boolean;
};

async function load(options: Options = {}) {
  jest.resetModules();
  process.env.SUPABASE_URL = 'http://localhost:54321';
  process.env.SUPABASE_SECRET_KEY = 'service-key';
  process.env.RESEND_API_KEY = 're_test_key';

  const mock = createTableDb({
    organizations: options.organizations ?? [
      { id: ORG, name: 'Org', maxTraineeSeats: 5, maxTrainerSeats: 3 },
    ],
    // profile reads of one request, in order: the e-mail check, the early seat
    // count, the seat count of the transaction, the trainers to notify
    profiles: {
      sequence: [
        options.existingProfile ? [{ id: 'taken' }] : [],
        options.early ?? room,
        options.inTransaction ?? options.early ?? room,
        [{ id: 'trainer-1' }],
      ],
    },
    trainingCatalogs: options.trainingCatalogs ?? [fiae, kfbm],
    organizationCatalogs: options.organizationCatalogs ?? both,
  });
  if (options.failEnrollmentWrite || options.failProfileWrite) {
    const original = mock.db.insert.getMockImplementation()!;
    mock.db.insert.mockImplementation((table: any) => {
      const name = table[Symbol.for('drizzle:Name')];
      if (options.failEnrollmentWrite && name === 'trainee_enrollments') {
        throw new Error('enrollment write failed');
      }
      if (options.failProfileWrite && name === 'profiles') {
        throw new Error('profile write failed');
      }
      return original(table);
    });
  }
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(options.session === undefined ? admin() : options.session);

  const createUser = jest.fn(async () =>
    options.createUserError
      ? { data: { user: null }, error: { message: options.createUserError } }
      : { data: { user: { id: NEW_ID } }, error: null }
  );
  const deleteUser = jest.fn(async () => {
    if (options.deleteUserFails) throw new Error('auth unavailable');
    return { error: null };
  });
  jest.doMock('@supabase/supabase-js', () => ({
    __esModule: true,
    createClient: () => ({ auth: { admin: { createUser, deleteUser } } }),
  }));
  const sendCredentialsEmail = jest.fn(async () => ({ success: true }));
  jest.doMock('@/lib/email', () => ({ sendCredentialsEmail }));

  const mod = await import('@/app/api/admin/users/route');
  return { mod, mock, createUser, deleteUser, sendCredentialsEmail };
}

const body = (overrides: Record<string, unknown> = {}) => ({
  email: 'new.user@example.com',
  fullName: 'New User',
  role: 'TRAINEE',
  organizationId: ORG,
  sendEmail: false,
  ...overrides,
});
const post = (data: unknown) =>
  makeRequest('POST', 'http://localhost/api/admin/users', {
    token: 't',
    body: data,
  });

describe('POST /api/admin/users: input shape', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['fullName is a number', { fullName: 123 }],
    ['fullName is an object', { fullName: { first: 'A' } }],
    ['fullName is an array', { fullName: ['A'] }],
    ['fullName is blank', { fullName: '   ' }],
    ['fullName is far too long', { fullName: 'A'.repeat(201) }],
    ['email is a number', { email: 42 }],
    ['email is an array', { email: ['a@b.de'] }],
    ['role is a number', { role: 7 }],
    ['organizationId is a number', { organizationId: 5 }],
  ])(
    '%s: 400 before anything happens, so no auth account is left behind',
    async (_name, overrides) => {
      const { mod, mock, createUser, deleteUser } = await load();
      const res = await mod.POST(post(body(overrides)));
      expect(res.status).toBe(400);
      expect(createUser).not.toHaveBeenCalled();
      expect(deleteUser).not.toHaveBeenCalled();
      expect(mock.writes('insert', 'profiles')).toHaveLength(0);
    }
  );
});

describe('POST /api/admin/users: roles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ADMIN creates a trainee in the own organization as before', async () => {
    const { mod, mock, createUser } = await load();
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(201);
    const json = await res.json();
    expect(json).toMatchObject({
      success: true,
      user: {
        id: NEW_ID,
        email: 'new.user@example.com',
        fullName: 'New User',
        role: 'TRAINEE',
        organizationId: ORG,
        orgName: 'Org',
      },
      credentials: { email: 'new.user@example.com' },
      emailSent: false,
    });
    expect(json.credentials.password).toHaveLength(12);
    expect(createUser).toHaveBeenCalledWith(
      expect.objectContaining({
        email: 'new.user@example.com',
        email_confirm: true,
        user_metadata: { full_name: 'New User', role: 'TRAINEE' },
      })
    );
    expect(mock.writes('insert', 'profiles')).toEqual([
      expect.objectContaining({
        id: NEW_ID,
        role: 'TRAINEE',
        organizationId: ORG,
        isActive: true,
        // created by an administrator: released at once, so the first sign in
        // leads to the dashboard and not to the notice of an unreleased account
        trainerActivated: true,
      }),
    ]);
  });

  it.each([
    ['ADMIN', admin],
    ['TEMP_ADMIN', tempAdmin],
    ['SUPER_ADMIN', superAdmin],
  ])(
    'a trainee created by %s is released and active, with the enrollment',
    async (_caller, make) => {
      const { mod, mock } = await load({ session: make() });
      const res = await mod.POST(post(body({ role: 'TRAINEE' })));
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'profiles')).toEqual([
        expect.objectContaining({
          role: 'TRAINEE',
          isActive: true,
          trainerActivated: true,
        }),
      ]);
      expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(1);
    }
  );

  it.each(['TRAINER', 'TRAINEE'])(
    'TEMP_ADMIN creates a %s in the own organization',
    async role => {
      const { mod } = await load({ session: tempAdmin() });
      const res = await mod.POST(post(body({ role })));
      expect(res.status).toBe(201);
    }
  );

  it.each([
    ['TEMP_ADMIN', 'TEMP_ADMIN', tempAdmin],
    ['TEMP_ADMIN', 'ADMIN', tempAdmin],
    ['ADMIN', 'SUPER_ADMIN', admin],
    ['SUPER_ADMIN', 'SUPER_ADMIN', superAdmin],
    ['ADMIN', 'ADMIN', admin],
  ])(
    '%s may not create a %s: 403 with a clear error, no account, nothing written',
    async (_caller, role, make) => {
      const { mod, mock, createUser } = await load({ session: make() });
      const res = await mod.POST(post(body({ role })));
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe('ROLE_NOT_ASSIGNABLE');
      expect(json.error).toContain(role);
      expect(createUser).not.toHaveBeenCalled();
      expect(mock.writes('insert', 'profiles')).toHaveLength(0);
    }
  );

  it('the platform admin cannot create an ADMIN through POST (400, as before)', async () => {
    const { mod, createUser } = await load({ session: superAdmin() });
    const res = await mod.POST(post(body({ role: 'ADMIN' })));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({
      error: 'Invalid role. Use TEMP_ADMIN, TRAINER, or TRAINEE.',
    });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('a value that is no role stays 400', async () => {
    const { mod } = await load();
    const res = await mod.POST(post(body({ role: 'ROOT' })));
    expect(res.status).toBe(400);
  });

  it('the role is matched in any letter case', async () => {
    const { mod, mock } = await load();
    const res = await mod.POST(post(body({ role: 'trainer' })));
    expect(res.status).toBe(201);
    expect(mock.writes('insert', 'profiles')).toEqual([
      expect.objectContaining({ role: 'TRAINER', trainerActivated: true }),
    ]);
  });

  it('ADMIN and TEMP_ADMIN create in the own organization only (403)', async () => {
    for (const make of [admin, tempAdmin]) {
      const { mod, createUser } = await load({ session: make() });
      const res = await mod.POST(post(body({ organizationId: OTHER_ORG })));
      expect(res.status).toBe(403);
      expect(await res.json()).toEqual({ error: 'Forbidden' });
      expect(createUser).not.toHaveBeenCalled();
    }
  });

  it('the platform admin creates in any organization', async () => {
    const { mod } = await load({ session: superAdmin() });
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(201);
  });

  it('the other checks stay as they were', async () => {
    const { mod } = await load();
    expect((await mod.POST(post(body({ email: '' })))).status).toBe(400);
    expect((await mod.POST(post(body({ email: 'not-an-email' })))).status).toBe(
      400
    );
    const taken = await load({ existingProfile: true });
    expect((await taken.mod.POST(post(body()))).status).toBe(409);
    const missing = await load({ organizations: [] });
    expect((await missing.mod.POST(post(body()))).status).toBe(404);
  });
});

describe('POST /api/admin/users: seats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('full trainee seats answer 409 SEATS_FULL with the numbers, before the account exists', async () => {
    const { mod, mock, createUser } = await load({ early: fullTrainees });
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.stringContaining('5 of 5'),
      code: 'SEATS_FULL',
      kind: 'trainee',
      occupied: 5,
      limit: 5,
    });
    expect(createUser).not.toHaveBeenCalled();
    expect(mock.writes('insert', 'profiles')).toHaveLength(0);
  });

  it.each(['TRAINER', 'TEMP_ADMIN'])(
    'full trainer seats stop a %s (admins count as trainers)',
    async role => {
      const { mod, createUser } = await load({ early: fullTrainers });
      const res = await mod.POST(post(body({ role })));
      expect(res.status).toBe(409);
      expect(await res.json()).toMatchObject({
        code: 'SEATS_FULL',
        kind: 'trainer',
        occupied: 3,
        limit: 3,
      });
      expect(createUser).not.toHaveBeenCalled();
    }
  );

  it('full trainer seats do not stop a trainee, and the other way round', async () => {
    const a = await load({ early: fullTrainers });
    expect((await a.mod.POST(post(body()))).status).toBe(201);
    const b = await load({ early: fullTrainees });
    expect((await b.mod.POST(post(body({ role: 'TRAINER' })))).status).toBe(
      201
    );
  });

  it('the platform admin gets no exception', async () => {
    const { mod, createUser } = await load({
      session: superAdmin(),
      early: fullTrainees,
    });
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'SEATS_FULL' });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('an organization that is already over its limit only blocks new accounts', async () => {
    const { mod } = await load({
      early: [{ role: 'TRAINEE', count: 9 }],
    });
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ occupied: 9, limit: 5 });
  });

  it('a seat taken by a parallel request after the early check removes the new auth account', async () => {
    const { mod, mock, createUser, deleteUser } = await load({
      early: room,
      inTransaction: fullTrainees,
    });
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'SEATS_FULL' });
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith(NEW_ID);
    expect(mock.writes('insert', 'profiles')).toHaveLength(0);
    expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
  });
});

describe('POST /api/admin/users: enrollment of a trainee', () => {
  beforeEach(() => jest.clearAllMocks());

  it('enrolls in FIAE by default when the organization has several catalogs', async () => {
    const { mod, mock } = await load();
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(201);
    expect((await res.json()).user.trainingCatalogCode).toBe('FIAE');
    expect(mock.writes('insert', 'trainee_enrollments')).toEqual([
      {
        traineeId: NEW_ID,
        trainingCatalogId: FIAE,
        startDate: null,
        durationYears: 3,
      },
    ]);
  });

  it('enrolls in the requested catalog', async () => {
    const { mod, mock } = await load();
    const res = await mod.POST(post(body({ catalogId: KFBM })));
    expect(res.status).toBe(201);
    expect((await res.json()).user.trainingCatalogCode).toBe('KFBM');
    expect(mock.writes('insert', 'trainee_enrollments')).toEqual([
      expect.objectContaining({ traineeId: NEW_ID, trainingCatalogId: KFBM }),
    ]);
  });

  it('an organization with one usable catalog enrolls in that one without a request', async () => {
    const { mod, mock } = await load({
      organizationCatalogs: [
        { trainingCatalogId: FIAE, isEnabled: false },
        { trainingCatalogId: KFBM, isEnabled: true },
      ],
    });
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(201);
    expect(mock.writes('insert', 'trainee_enrollments')).toEqual([
      expect.objectContaining({ trainingCatalogId: KFBM }),
    ]);
  });

  it('a legacy organization without any catalog row still works as before (FIAE)', async () => {
    const { mod, mock } = await load({ organizationCatalogs: [] });
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(201);
    expect(mock.writes('insert', 'trainee_enrollments')).toEqual([
      expect.objectContaining({ trainingCatalogId: FIAE }),
    ]);
  });

  it.each([
    [
      'a catalog that is not enabled for the organization',
      { organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }] },
      { catalogId: KFBM },
      400,
      'CATALOG_NOT_ENABLED',
    ],
    [
      'a catalog that is not active',
      { trainingCatalogs: [fiae, { ...kfbm, isActive: false }] },
      { catalogId: KFBM },
      400,
      'CATALOG_INACTIVE',
    ],
    [
      'an unknown catalog',
      {},
      { catalogId: '99999999-9999-4999-8999-999999999999' },
      404,
      'CATALOG_NOT_FOUND',
    ],
  ])(
    '%s is refused before the account is created',
    async (_name, options, extra, status, code) => {
      const { mod, mock, createUser } = await load(options as Options);
      const res = await mod.POST(post(body(extra)));
      expect(res.status).toBe(status);
      expect(await res.json()).toMatchObject({ code });
      expect(createUser).not.toHaveBeenCalled();
      expect(mock.writes('insert', 'profiles')).toHaveLength(0);
    }
  );

  it('several catalogs without FIAE and without a choice answer 400 CATALOG_REQUIRED', async () => {
    const third = '44444444-4444-4444-8444-444444444444';
    const { mod, createUser } = await load({
      trainingCatalogs: [fiae, kfbm, { ...fiae, id: third, code: 'XYZ' }],
      organizationCatalogs: [
        { trainingCatalogId: FIAE, isEnabled: false },
        { trainingCatalogId: KFBM, isEnabled: true },
        { trainingCatalogId: third, isEnabled: true },
      ],
    });
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'CATALOG_REQUIRED' });
    expect(createUser).not.toHaveBeenCalled();
  });

  it.each([['nope'], [7], [null]])(
    'a catalogId that is no uuid (%j) is 400',
    async value => {
      const { mod, createUser } = await load();
      const res = await mod.POST(post(body({ catalogId: value })));
      // null means "no choice" and is accepted like a missing value
      if (value === null) {
        expect(res.status).toBe(201);
      } else {
        expect(res.status).toBe(400);
        expect(createUser).not.toHaveBeenCalled();
      }
    }
  );

  it('a catalogId for a role that is no trainee is 400 NOT_A_TRAINEE', async () => {
    const { mod, createUser } = await load();
    const res = await mod.POST(
      post(body({ role: 'TRAINER', catalogId: KFBM }))
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'NOT_A_TRAINEE' });
    expect(createUser).not.toHaveBeenCalled();
  });

  it('a trainer gets no enrollment and no catalog is read', async () => {
    const { mod, mock } = await load({ trainingCatalogs: [] });
    const res = await mod.POST(post(body({ role: 'TRAINER' })));
    expect(res.status).toBe(201);
    expect((await res.json()).user).not.toHaveProperty('trainingCatalogCode');
    expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
  });
});

describe('POST /api/admin/users: no half user', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => {});
  });

  it('removes the auth account when the enrollment cannot be written', async () => {
    const { mod, createUser, deleteUser } = await load({
      failEnrollmentWrite: true,
    });
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(500);
    expect(createUser).toHaveBeenCalledTimes(1);
    expect(deleteUser).toHaveBeenCalledWith(NEW_ID);
  });

  it('removes the auth account when the profile cannot be written', async () => {
    const { mod, deleteUser } = await load({ failProfileWrite: true });
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(500);
    expect(deleteUser).toHaveBeenCalledWith(NEW_ID);
  });

  it('still answers when removing the account fails, and logs it', async () => {
    const { mod, deleteUser } = await load({
      failEnrollmentWrite: true,
      deleteUserFails: true,
    });
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(500);
    expect(deleteUser).toHaveBeenCalled();
    expect(console.error).toHaveBeenCalledWith(
      expect.stringContaining('orphan'),
      NEW_ID,
      expect.anything()
    );
  });

  it('writes nothing when the auth account cannot be created', async () => {
    const { mod, mock, deleteUser } = await load({
      createUserError: 'email exists',
    });
    const res = await mod.POST(post(body()));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'email exists' });
    expect(mock.db.transaction).not.toHaveBeenCalled();
    expect(deleteUser).not.toHaveBeenCalled();
  });
});

describe('POST /api/admin/users: after the account exists', () => {
  beforeEach(() => jest.clearAllMocks());

  it('sends the credentials by e-mail unless it is switched off', async () => {
    const on = await load();
    const res = await on.mod.POST(post(body({ sendEmail: true })));
    expect((await res.json()).emailSent).toBe(true);
    expect(on.sendCredentialsEmail).toHaveBeenCalledTimes(1);

    const off = await load();
    await off.mod.POST(post(body({ sendEmail: false })));
    expect(off.sendCredentialsEmail).not.toHaveBeenCalled();
  });

  it('notifies the trainers of the organization about a new trainee only', async () => {
    const trainee = await load();
    await trainee.mod.POST(post(body()));
    expect(trainee.mock.writes('insert', 'notifications')).toEqual([
      expect.objectContaining({
        userId: 'trainer-1',
        actorId: NEW_ID,
        type: 'TRAINEE_REGISTERED',
        organizationId: ORG,
      }),
    ]);

    const trainer = await load();
    await trainer.mod.POST(post(body({ role: 'TRAINER' })));
    expect(trainer.mock.writes('insert', 'notifications')).toHaveLength(0);
  });
});
