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

// PATCH /api/admin/users/[userId] (KfBM S5):
//  - only roles the caller may hand out (assignableRoles): TEMP_ADMIN neither
//    promotes to TEMP_ADMIN nor to ADMIN, nobody sets SUPER_ADMIN (403)
//  - a role of the other kind of seat (trainee <-> trainer level) or a move to
//    another organization needs a free seat there (409 SEATS_FULL)
//  - everything that was allowed before still works: the activation of an
//    account takes no seat (inactive accounts count), ADMIN still promotes to
//    ADMIN, the scope of the organization and the protection of ADMIN stay.

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const TARGET = '33333333-3333-4333-8333-333333333333';

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
  target?: Record<string, unknown> | null;
  usage?: any[];
  vanishesInTransaction?: boolean;
};

async function load(options: Options = {}) {
  jest.resetModules();
  process.env.ADMIN_EMAIL = 'primary@example.com';
  const target =
    options.target === undefined
      ? {
          id: TARGET,
          email: 'target@example.com',
          role: 'TRAINEE',
          organizationId: ORG,
        }
      : options.target;
  const mock = createTableDb(
    {
      organizations: [
        { id: ORG, name: 'Org', maxTraineeSeats: 5, maxTrainerSeats: 3 },
      ],
      // profile reads of one request, in order: the target of the route, the
      // target again under its row lock, the seat count
      profiles: {
        sequence: [
          target ? [target] : [],
          options.vanishesInTransaction || !target
            ? []
            : [{ role: target.role, organizationId: target.organizationId }],
          options.usage ?? room,
        ],
      },
    },
    {
      profiles: [
        {
          id: TARGET,
          role: target?.role ?? 'TRAINEE',
          organizationId: target?.organizationId ?? ORG,
        },
      ],
    }
  );
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(options.session === undefined ? admin() : options.session);
  const mod = await import('@/app/api/admin/users/[userId]/route');
  return { mod, mock };
}

const patch = (data: unknown) =>
  makeRequest('PATCH', `http://localhost/api/admin/users/${TARGET}`, {
    token: 't',
    body: data,
  });
const params = Promise.resolve({ userId: TARGET });
const call = (mod: any, data: unknown) =>
  mod.PATCH(patch(data), { params }) as Promise<Response>;

describe('PATCH /api/admin/users/[userId]: roles', () => {
  beforeEach(() => jest.clearAllMocks());

  it('ADMIN sets a trainer: the change is written and returned', async () => {
    const { mod, mock } = await load();
    const res = await call(mod, { role: 'TRAINER' });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      user: { id: TARGET, role: 'TRAINEE', organizationId: ORG },
    });
    expect(mock.writes('update', 'profiles')).toEqual([{ role: 'TRAINER' }]);
  });

  it.each([
    ['TRAINER', 'TEMP_ADMIN'],
    ['TRAINEE', 'TEMP_ADMIN'],
    ['TRAINEE', 'ADMIN'],
    ['TRAINER', 'ADMIN'],
  ])(
    'TEMP_ADMIN may not set %s -> %s: 403 with a clear error, nothing written',
    async (current, role) => {
      const { mod, mock } = await load({
        session: tempAdmin(),
        target: {
          id: TARGET,
          email: 't@example.com',
          role: current,
          organizationId: ORG,
        },
      });
      const res = await call(mod, { role });
      expect(res.status).toBe(403);
      const json = await res.json();
      expect(json.code).toBe('ROLE_NOT_ASSIGNABLE');
      expect(json.error).toContain(role);
      expect(mock.writes('update', 'profiles')).toHaveLength(0);
      expect(mock.db.transaction).not.toHaveBeenCalled();
    }
  );

  it('TEMP_ADMIN still sets trainers and trainees', async () => {
    const { mod } = await load({ session: tempAdmin() });
    expect((await call(mod, { role: 'TRAINER' })).status).toBe(200);
  });

  it('ADMIN still promotes a user to ADMIN, as before', async () => {
    const { mod, mock } = await load({
      target: {
        id: TARGET,
        email: 't@example.com',
        role: 'TRAINER',
        organizationId: ORG,
      },
    });
    const res = await call(mod, { role: 'ADMIN' });
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'profiles')).toEqual([{ role: 'ADMIN' }]);
  });

  it.each([
    ['ADMIN', admin],
    ['platform admin', superAdmin],
  ])('%s never sets SUPER_ADMIN (403)', async (_name, make) => {
    const { mod, mock } = await load({ session: make() });
    const res = await call(mod, { role: 'SUPER_ADMIN' });
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('ROLE_NOT_ASSIGNABLE');
    expect(mock.writes('update', 'profiles')).toHaveLength(0);
  });

  it('a value that is no role is 400', async () => {
    const { mod } = await load();
    const res = await call(mod, { role: 'ROOT' });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid role' });
  });

  it('an unchanged role sent along with other fields is no change and passes', async () => {
    const { mod, mock } = await load({
      session: tempAdmin(),
      target: {
        id: TARGET,
        email: 't@example.com',
        role: 'TEMP_ADMIN',
        organizationId: ORG,
      },
    });
    const res = await call(mod, { role: 'temp_admin', fullName: ' New Name ' });
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'profiles')).toEqual([
      {
        role: 'TEMP_ADMIN',
        fullName: 'New Name',
        firstName: 'New',
        lastName: 'Name',
      },
    ]);
  });
});

describe('PATCH /api/admin/users/[userId]: seats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a role of the other kind with full seats answers 409 SEATS_FULL and writes nothing', async () => {
    const { mod, mock } = await load({ usage: fullTrainers });
    const res = await call(mod, { role: 'TRAINER' });
    expect(res.status).toBe(409);
    expect(await res.json()).toEqual({
      error: expect.stringContaining('3 of 3'),
      code: 'SEATS_FULL',
      kind: 'trainer',
      occupied: 3,
      limit: 3,
    });
    expect(mock.writes('update', 'profiles')).toHaveLength(0);
  });

  it('a promotion to ADMIN takes a trainer seat as well', async () => {
    const { mod } = await load({ usage: fullTrainers });
    const res = await call(mod, { role: 'ADMIN' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ kind: 'trainer' });
  });

  it('a change inside the trainer level keeps the seat and needs none', async () => {
    const { mod } = await load({
      target: {
        id: TARGET,
        email: 't@example.com',
        role: 'TRAINER',
        organizationId: ORG,
      },
      usage: fullTrainers,
    });
    expect((await call(mod, { role: 'TEMP_ADMIN' })).status).toBe(200);
  });

  it('a trainer becoming a trainee needs a trainee seat', async () => {
    const { mod } = await load({
      target: {
        id: TARGET,
        email: 't@example.com',
        role: 'TRAINER',
        organizationId: ORG,
      },
      usage: fullTrainees,
    });
    const res = await call(mod, { role: 'TRAINEE' });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ kind: 'trainee' });
  });

  it('activating or deactivating an account takes no seat, even in a full organization', async () => {
    const { mod, mock } = await load({ usage: fullTrainees });
    const on = await call(mod, { isActive: true, trainerActivated: true });
    expect(on.status).toBe(200);
    expect(mock.db.execute).not.toHaveBeenCalled();
    expect(mock.writes('update', 'profiles')).toEqual([
      { isActive: true, trainerActivated: true },
    ]);
  });

  it('the platform admin moves a user to an organization with a free seat', async () => {
    const { mod, mock } = await load({ session: superAdmin() });
    const res = await call(mod, { organizationId: OTHER_ORG });
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'profiles')).toEqual([
      { organizationId: OTHER_ORG },
    ]);
  });

  it('the platform admin gets no exception: a move into a full organization is 409', async () => {
    const { mod, mock } = await load({
      session: superAdmin(),
      usage: fullTrainees,
    });
    const res = await call(mod, { organizationId: OTHER_ORG });
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'SEATS_FULL',
      kind: 'trainee',
    });
    expect(mock.writes('update', 'profiles')).toHaveLength(0);
  });

  it('ADMIN and TEMP_ADMIN still cannot move users between organizations (403)', async () => {
    for (const make of [admin, tempAdmin]) {
      const { mod, mock } = await load({ session: make() });
      const res = await call(mod, { organizationId: OTHER_ORG });
      expect(res.status).toBe(403);
      expect(mock.writes('update', 'profiles')).toHaveLength(0);
    }
  });

  it('a user that vanishes before the change is 404', async () => {
    const { mod, mock } = await load({ vanishesInTransaction: true });
    const res = await call(mod, { role: 'TRAINER' });
    expect(res.status).toBe(404);
    expect(mock.writes('update', 'profiles')).toHaveLength(0);
  });
});

describe('PATCH /api/admin/users/[userId]: unchanged rules', () => {
  beforeEach(() => jest.clearAllMocks());

  it('users of another organization are invisible to ADMIN and TEMP_ADMIN (404)', async () => {
    for (const make of [admin, tempAdmin]) {
      const { mod, mock } = await load({
        session: make(),
        target: {
          id: TARGET,
          email: 't@example.com',
          role: 'TRAINEE',
          organizationId: OTHER_ORG,
        },
      });
      const res = await call(mod, { role: 'TRAINER' });
      expect(res.status).toBe(404);
      expect(mock.writes('update', 'profiles')).toHaveLength(0);
    }
  });

  it('TEMP_ADMIN cannot change an ADMIN', async () => {
    const { mod, mock } = await load({
      session: tempAdmin(),
      target: {
        id: TARGET,
        email: 't@example.com',
        role: 'ADMIN',
        organizationId: ORG,
      },
    });
    const res = await call(mod, { isActive: false });
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({
      error: 'Only ADMIN can modify another ADMIN',
    });
    expect(mock.writes('update', 'profiles')).toHaveLength(0);
  });

  it('the primary admin account cannot be changed', async () => {
    const { mod, mock } = await load({
      target: {
        id: TARGET,
        email: 'primary@example.com',
        role: 'TRAINER',
        organizationId: ORG,
      },
    });
    const res = await call(mod, { role: 'TRAINEE' });
    expect(res.status).toBe(403);
    expect(mock.writes('update', 'profiles')).toHaveLength(0);
  });

  it('a request without a valid field is 400', async () => {
    const { mod } = await load();
    const res = await call(mod, { unknown: 1 });
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'No valid fields to update' });
  });

  it('an unknown user is 404', async () => {
    const { mod } = await load({ target: null });
    const res = await call(mod, { role: 'TRAINER' });
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'User not found' });
  });
});
