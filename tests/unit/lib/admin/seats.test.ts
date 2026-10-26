/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb, renderCondition } from '../../../helpers/mockDb';

// The database side of the seat rules: the lock per organization, the count of
// the occupied seats and the check. The mock ignores where(), so the tests
// assert the rendered conditions; the counting itself runs against a real
// database in the smoke test of the pull request.

const ORG = '11111111-1111-4111-8111-111111111111';

const orgRow = { maxTraineeSeats: 5, maxTrainerSeats: 2 };
const grouped = [
  { role: 'TRAINEE', count: 3 },
  { role: 'TRAINER', count: 1 },
  { role: 'ADMIN', count: 1 },
];

async function load(tables: Record<string, any> = {}) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import('@/lib/admin/seats');
  return { mod, mock };
}

describe('lockOrganizationSeats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('takes one advisory lock for the organization that lasts until the transaction ends', async () => {
    const { mod, mock } = await load();
    await mod.lockOrganizationSeats(mock.db, ORG);
    expect(mock.db.execute).toHaveBeenCalledTimes(1);
    const rendered = renderCondition(mock.db.execute.mock.calls[0][0]);
    expect(rendered.sql).toContain('pg_advisory_xact_lock');
    // two keys: a fixed namespace and the organization, so the lock of one
    // organization never blocks another and never meets the catalog lock
    expect(rendered.sql).toMatch(/hashtext\(\$1\), hashtext\(\$2\)/);
    expect(rendered.params).toEqual(['org_seats', ORG]);
  });
});

describe('loadSeatUsage', () => {
  beforeEach(() => jest.clearAllMocks());

  it('counts the accounts of the organization per seat kind and reads the limits', async () => {
    const { mod, mock } = await load({
      organizations: [orgRow],
      profiles: grouped,
    });
    expect(await mod.loadSeatUsage(mock.db, ORG)).toEqual({
      trainees: 3,
      // TRAINER and ADMIN take trainer seats
      trainers: 2,
      maxTraineeSeats: 5,
      maxTrainerSeats: 2,
    });
    expect(mock.filters('select', 'organizations').params).toContain(ORG);
    // every account of the organization counts, active or not: there is no
    // is_active condition
    const profileFilter = mock.filters('select', 'profiles');
    expect(profileFilter.params).toEqual([ORG]);
    expect(profileFilter.sql).toContain('organization_id');
    expect(profileFilter.sql).not.toContain('is_active');
  });

  it('an organization without accounts has no seat taken', async () => {
    const { mod, mock } = await load({
      organizations: [orgRow],
      profiles: [],
    });
    expect(await mod.loadSeatUsage(mock.db, ORG)).toMatchObject({
      trainees: 0,
      trainers: 0,
    });
  });

  it('an organization that does not exist is null', async () => {
    const { mod, mock } = await load({ organizations: [], profiles: [] });
    expect(await mod.loadSeatUsage(mock.db, ORG)).toBeNull();
  });
});

describe('assertSeatAvailable', () => {
  beforeEach(() => jest.clearAllMocks());

  it('is ok while a seat of the kind of the role is free', async () => {
    const { mod, mock } = await load({
      organizations: [orgRow],
      profiles: grouped,
    });
    expect(await mod.assertSeatAvailable(mock.db, ORG, 'TRAINEE')).toEqual({
      ok: true,
    });
  });

  it('answers SEATS_FULL with kind, occupied and limit when the seats are taken', async () => {
    const { mod, mock } = await load({
      organizations: [orgRow],
      profiles: grouped,
    });
    // trainers: TRAINER 1 + ADMIN 1 = 2 of 2
    expect(await mod.assertSeatAvailable(mock.db, ORG, 'TEMP_ADMIN')).toEqual({
      ok: false,
      status: 409,
      code: 'SEATS_FULL',
      kind: 'trainer',
      occupied: 2,
      limit: 2,
    });
  });

  it('a role without a seat kind needs no seat and reads nothing', async () => {
    const { mod, mock } = await load({
      organizations: [orgRow],
      profiles: grouped,
    });
    expect(await mod.assertSeatAvailable(mock.db, ORG, 'ROOT')).toEqual({
      ok: true,
    });
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('an organization that does not exist is 404', async () => {
    const { mod, mock } = await load({ organizations: [], profiles: [] });
    expect(await mod.assertSeatAvailable(mock.db, ORG, 'TRAINEE')).toEqual({
      ok: false,
      status: 404,
      code: 'ORGANIZATION_NOT_FOUND',
    });
  });
});

describe('tallySeatsByOrganization', () => {
  beforeEach(() => jest.clearAllMocks());

  it('counts the seats of several organizations with the same rule', async () => {
    const { mod } = await load();
    const result = mod.tallySeatsByOrganization([
      { organizationId: 'a', role: 'TRAINEE', count: 2 },
      { organizationId: 'a', role: 'ADMIN', count: 1 },
      { organizationId: 'b', role: 'TRAINER', count: 4 },
      { organizationId: null, role: 'TRAINEE', count: 9 },
    ]);
    expect(result).toEqual({
      a: { trainees: 2, trainers: 1 },
      b: { trainees: 0, trainers: 4 },
      '': { trainees: 9, trainers: 0 },
    });
  });
});
