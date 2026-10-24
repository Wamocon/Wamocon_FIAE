/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb, renderCondition } from '../../../helpers/mockDb';

// The writes behind POST and PATCH /api/admin/users. Both run in one
// transaction that takes the locks first, checks the seats (and for a new
// trainee the catalog), and only then writes. A failed check writes nothing.
// The mock ignores where() and runs the transaction body directly; the real
// lock, count and rollback behavior is covered by the smoke test of the PR.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const USER = '33333333-3333-4333-8333-333333333333';

const fiae = { id: FIAE, code: 'FIAE', title: 'FIAE', isActive: true };
const kfbm = { id: KFBM, code: 'KFBM', title: 'KfBM', isActive: true };
const orgRow = { maxTraineeSeats: 5, maxTrainerSeats: 3 };
const freeSeats = [
  { role: 'TRAINEE', count: 2 },
  { role: 'TRAINER', count: 1 },
];
const fullTrainees = [{ role: 'TRAINEE', count: 5 }];
const fullTrainers = [
  { role: 'TRAINER', count: 2 },
  { role: 'ADMIN', count: 1 },
];
const both = [
  { trainingCatalogId: FIAE, isEnabled: true },
  { trainingCatalogId: KFBM, isEnabled: true },
];

async function load(tables: Record<string, any> = {}, returns = {}) {
  jest.resetModules();
  const mock = createTableDb(tables, returns);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import('@/lib/admin/userWrites');
  return { mod, mock };
}

const newUser = (overrides: Record<string, unknown> = {}) => ({
  id: USER,
  email: 'new@example.com',
  fullName: 'New User',
  firstName: 'New',
  lastName: 'User',
  role: 'TRAINEE' as const,
  organizationId: ORG,
  requestedCatalogId: null,
  ...overrides,
});

const baseTables = (extra: Record<string, any> = {}) => ({
  organizations: [orgRow],
  profiles: freeSeats,
  trainingCatalogs: [fiae, kfbm],
  organizationCatalogs: both,
  ...extra,
});

describe('createUserRecords', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a trainee: seat lock first, then the catalog lock, then profile and enrollment in one transaction', async () => {
    const { mod, mock } = await load(baseTables());
    const result = await mod.createUserRecords(newUser());
    expect(result).toEqual({ ok: true, catalog: fiae });

    expect(mock.db.transaction).toHaveBeenCalledTimes(1);
    const locks = mock.db.execute.mock.calls.map(
      (call: any[]) => renderCondition(call[0]).sql
    );
    expect(locks).toHaveLength(2);
    expect(locks[0]).toContain('hashtext($1), hashtext($2)');
    expect(locks[1]).toMatch(/hashtext\(\$1\)\)$/);

    expect(mock.writes('insert', 'profiles')).toEqual([
      {
        id: USER,
        email: 'new@example.com',
        fullName: 'New User',
        firstName: 'New',
        lastName: 'User',
        role: 'TRAINEE',
        organizationId: ORG,
        isActive: true,
        trainerActivated: false,
      },
    ]);
    expect(mock.writes('insert', 'trainee_enrollments')).toEqual([
      {
        traineeId: USER,
        trainingCatalogId: FIAE,
        startDate: null,
        durationYears: 3,
      },
    ]);
  });

  it('takes the requested catalog for the enrollment', async () => {
    const { mod, mock } = await load(baseTables());
    const result = await mod.createUserRecords(
      newUser({ requestedCatalogId: KFBM })
    );
    expect(result).toEqual({ ok: true, catalog: kfbm });
    expect(mock.writes('insert', 'trainee_enrollments')).toEqual([
      expect.objectContaining({ trainingCatalogId: KFBM }),
    ]);
  });

  it.each(['TRAINER', 'TEMP_ADMIN'])(
    'a %s takes a seat but gets no enrollment and no catalog lock',
    async role => {
      const { mod, mock } = await load(baseTables());
      const result = await mod.createUserRecords(newUser({ role }));
      expect(result).toEqual({ ok: true, catalog: null });
      expect(mock.db.execute).toHaveBeenCalledTimes(1);
      expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
      expect(mock.writes('insert', 'profiles')).toEqual([
        expect.objectContaining({ role, trainerActivated: true }),
      ]);
    }
  );

  it('full trainee seats answer SEATS_FULL and write nothing', async () => {
    const { mod, mock } = await load(baseTables({ profiles: fullTrainees }));
    const result = await mod.createUserRecords(newUser());
    expect(result).toEqual({
      ok: false,
      status: 409,
      code: 'SEATS_FULL',
      kind: 'trainee',
      occupied: 5,
      limit: 5,
    });
    expect(mock.writes('insert', 'profiles')).toHaveLength(0);
    expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
  });

  it('full trainer seats stop a trainer, a TEMP_ADMIN and not a trainee', async () => {
    const { mod } = await load(baseTables({ profiles: fullTrainers }));
    expect(
      await mod.createUserRecords(newUser({ role: 'TRAINER' }))
    ).toMatchObject({
      ok: false,
      code: 'SEATS_FULL',
      kind: 'trainer',
    });
    expect(
      await mod.createUserRecords(newUser({ role: 'TEMP_ADMIN' }))
    ).toMatchObject({ ok: false, code: 'SEATS_FULL', kind: 'trainer' });
    expect((await mod.createUserRecords(newUser())).ok).toBe(true);
  });

  it('a catalog that is not enabled stops the trainee before the profile is written', async () => {
    const { mod, mock } = await load(
      baseTables({
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
      })
    );
    const result = await mod.createUserRecords(
      newUser({ requestedCatalogId: KFBM })
    );
    expect(result).toEqual({
      ok: false,
      status: 400,
      code: 'CATALOG_NOT_ENABLED',
    });
    expect(mock.writes('insert', 'profiles')).toHaveLength(0);
    expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
  });

  it('an organization that is gone answers 404 and writes nothing', async () => {
    const { mod, mock } = await load(baseTables({ organizations: [] }));
    expect(await mod.createUserRecords(newUser())).toEqual({
      ok: false,
      status: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });
    expect(mock.writes('insert', 'profiles')).toHaveLength(0);
  });

  it('a failing enrollment write rejects, so the transaction rolls the profile back', async () => {
    const { mod, mock } = await load(baseTables());
    mock.db.insert.mockImplementation((table: any) => {
      const name = (table as any)[Symbol.for('drizzle:Name')];
      if (name === 'trainee_enrollments') throw new Error('write failed');
      return {
        values: () => ({ onConflictDoNothing: async () => [] }),
      };
    });
    await expect(mod.createUserRecords(newUser())).rejects.toThrow(
      'write failed'
    );
  });
});

describe('checkNewUser', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is the same decision as the transaction, but only reads', async () => {
    const { mod, mock } = await load(baseTables());
    expect(
      await mod.checkNewUser(mock.db, {
        organizationId: ORG,
        role: 'TRAINEE',
        requestedCatalogId: KFBM,
      })
    ).toEqual({ ok: true, catalog: kfbm });
    expect(mock.db.execute).not.toHaveBeenCalled();
    expect(mock.db.insert).not.toHaveBeenCalled();
  });

  it('reports full seats and a missing choice', async () => {
    const full = await load(baseTables({ profiles: fullTrainees }));
    expect(
      await full.mod.checkNewUser(full.mock.db, {
        organizationId: ORG,
        role: 'TRAINEE',
        requestedCatalogId: null,
      })
    ).toMatchObject({ ok: false, code: 'SEATS_FULL' });

    const third = '44444444-4444-4444-8444-444444444444';
    const ambiguous = await load(
      baseTables({
        trainingCatalogs: [fiae, kfbm, { ...fiae, id: third, code: 'XYZ' }],
        organizationCatalogs: [
          { trainingCatalogId: FIAE, isEnabled: false },
          { trainingCatalogId: KFBM, isEnabled: true },
          { trainingCatalogId: third, isEnabled: true },
        ],
      })
    );
    expect(
      await ambiguous.mod.checkNewUser(ambiguous.mock.db, {
        organizationId: ORG,
        role: 'TRAINEE',
        requestedCatalogId: null,
      })
    ).toEqual({ ok: false, status: 400, code: 'CATALOG_REQUIRED' });
  });

  it('a trainer needs no catalog', async () => {
    const { mod, mock } = await load(
      baseTables({ trainingCatalogs: [], organizationCatalogs: [] })
    );
    expect(
      await mod.checkNewUser(mock.db, {
        organizationId: ORG,
        role: 'TRAINER',
        requestedCatalogId: null,
      })
    ).toEqual({ ok: true, catalog: null });
  });
});

describe('updateUserChecked', () => {
  beforeEach(() => jest.clearAllMocks());

  const updated = { id: USER, role: 'TRAINER', organizationId: ORG };
  const tables = (
    before: Record<string, unknown>,
    usage: any[] = freeSeats
  ) => ({
    organizations: [orgRow],
    // the first profile read is the user itself, the second the seat count
    profiles: { sequence: [[before], usage] },
  });

  it('a role change to the other kind takes the seat lock, checks and updates', async () => {
    const { mod, mock } = await load(
      tables({ role: 'TRAINEE', organizationId: ORG }),
      { profiles: [updated] }
    );
    const result = await mod.updateUserChecked(USER, { role: 'TRAINER' });
    expect(result).toEqual({ ok: true, row: updated });
    expect(mock.db.transaction).toHaveBeenCalledTimes(1);
    expect(mock.db.execute).toHaveBeenCalledTimes(1);
    expect(mock.writes('update', 'profiles')).toEqual([{ role: 'TRAINER' }]);
  });

  it('full seats of the new kind answer SEATS_FULL and update nothing', async () => {
    const { mod, mock } = await load(
      tables({ role: 'TRAINEE', organizationId: ORG }, fullTrainers),
      { profiles: [updated] }
    );
    expect(await mod.updateUserChecked(USER, { role: 'TEMP_ADMIN' })).toEqual({
      ok: false,
      status: 409,
      code: 'SEATS_FULL',
      kind: 'trainer',
      occupied: 3,
      limit: 3,
    });
    expect(mock.writes('update', 'profiles')).toHaveLength(0);
  });

  it('a change inside one kind keeps the seat: no lock, no count', async () => {
    const { mod, mock } = await load(
      tables({ role: 'TRAINER', organizationId: ORG }, fullTrainers),
      { profiles: [updated] }
    );
    const result = await mod.updateUserChecked(USER, { role: 'TEMP_ADMIN' });
    expect(result.ok).toBe(true);
    expect(mock.db.execute).not.toHaveBeenCalled();
    expect(mock.db.select).toHaveBeenCalledTimes(1);
    expect(mock.writes('update', 'profiles')).toHaveLength(1);
  });

  it('moving a user into another organization needs a seat there', async () => {
    const { mod, mock } = await load(
      tables({ role: 'TRAINEE', organizationId: ORG }, fullTrainees),
      { profiles: [updated] }
    );
    expect(
      await mod.updateUserChecked(USER, { organizationId: OTHER_ORG })
    ).toMatchObject({ ok: false, code: 'SEATS_FULL', kind: 'trainee' });
    expect(mock.writes('update', 'profiles')).toHaveLength(0);
    // the lock is the one of the organization that gets the user
    const lock = renderCondition(mock.db.execute.mock.calls[0][0]);
    expect(lock.params).toEqual(['org_seats', OTHER_ORG]);
  });

  it('a role change together with a move is checked for the new role in the new organization', async () => {
    const { mod, mock } = await load(
      tables({ role: 'TRAINEE', organizationId: ORG }, fullTrainers),
      { profiles: [updated] }
    );
    expect(
      await mod.updateUserChecked(USER, {
        role: 'TRAINER',
        organizationId: OTHER_ORG,
      })
    ).toMatchObject({ ok: false, code: 'SEATS_FULL', kind: 'trainer' });
    expect(renderCondition(mock.db.execute.mock.calls[0][0]).params).toEqual([
      'org_seats',
      OTHER_ORG,
    ]);
  });

  it('removing the organization takes no seat', async () => {
    const { mod, mock } = await load(
      tables({ role: 'TRAINEE', organizationId: ORG }),
      { profiles: [updated] }
    );
    const result = await mod.updateUserChecked(USER, { organizationId: null });
    expect(result.ok).toBe(true);
    expect(mock.db.execute).not.toHaveBeenCalled();
  });

  it('changes that touch no seat (name, activation) just update', async () => {
    const { mod, mock } = await load(
      tables({ role: 'TRAINEE', organizationId: ORG }, fullTrainees),
      { profiles: [updated] }
    );
    const result = await mod.updateUserChecked(USER, { isActive: true });
    expect(result.ok).toBe(true);
    expect(mock.db.execute).not.toHaveBeenCalled();
    expect(mock.writes('update', 'profiles')).toEqual([{ isActive: true }]);
  });

  it('a user that is gone answers 404', async () => {
    const { mod, mock } = await load({
      organizations: [orgRow],
      profiles: [],
    });
    expect(await mod.updateUserChecked(USER, { role: 'TRAINER' })).toEqual({
      ok: false,
      status: 404,
      code: 'USER_NOT_FOUND',
    });
    expect(mock.writes('update', 'profiles')).toHaveLength(0);
  });
});
