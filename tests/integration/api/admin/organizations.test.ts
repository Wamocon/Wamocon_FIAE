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
import { tallySeatsByOrganization } from '@/lib/admin/seatRules';

// GET /api/admin/organizations shows the seats (occupied of limit) per kind.
// The occupied counts come from the same rule that blocks a new account
// (seatRules), so what an admin reads here is what the 409 SEATS_FULL uses.
// ADMIN and TEMP_ADMIN only see their own organization, the platform admin
// sees all of them, creating an organization stays with the platform admin.

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';

const org = (
  id: string,
  name: string,
  extra: Record<string, unknown> = {}
) => ({
  id,
  name,
  slug: name.toLowerCase(),
  logoUrl: null,
  subscriptionPlan: 'LIGHT',
  maxTraineeSeats: 5,
  maxTrainerSeats: 3,
  isActive: true,
  isPlatformOwner: false,
  contactEmail: null,
  contactPerson: null,
  notes: null,
  createdAt: '2026-01-01T00:00:00.000Z',
  updatedAt: null,
  ...extra,
});

const grouped = [
  { orgId: ORG, role: 'TRAINEE', count: 4 },
  { orgId: ORG, role: 'TRAINER', count: 1 },
  { orgId: ORG, role: 'TEMP_ADMIN', count: 1 },
  { orgId: ORG, role: 'ADMIN', count: 1 },
  { orgId: OTHER_ORG, role: 'TRAINEE', count: 1 },
  { orgId: OTHER_ORG, role: 'SUPER_ADMIN', count: 1 },
  { orgId: null, role: 'TRAINEE', count: 7 },
];

const admin = () =>
  fakeSession({ id: 'ad1', role: 'ADMIN', organizationId: ORG, isAdmin: true });
const tempAdmin = () =>
  fakeSession({
    id: 'ta1',
    role: 'TEMP_ADMIN',
    organizationId: ORG,
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

async function load(session: ReturnType<typeof fakeSession> | null) {
  jest.resetModules();
  const mock = createTableDb({
    organizations: [org(ORG, 'Alpha'), org(OTHER_ORG, 'Beta')],
    profiles: grouped,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(session);
  const mod = await import('@/app/api/admin/organizations/route');
  return { mod, mock };
}

const get = () =>
  makeRequest('GET', 'http://localhost/api/admin/organizations', {
    token: 't',
  });

describe('GET /api/admin/organizations: seats', () => {
  beforeEach(() => jest.clearAllMocks());

  it('shows occupied and limit per kind of seat', async () => {
    const { mod } = await load(superAdmin());
    const res = await mod.GET(get());
    expect(res.status).toBe(200);
    const { organizations } = await res.json();
    const alpha = organizations.find((o: any) => o.id === ORG);
    expect(alpha).toMatchObject({
      maxTraineeSeats: 5,
      maxTrainerSeats: 3,
      // TRAINER, TEMP_ADMIN and ADMIN take trainer seats
      currentTrainers: 3,
      currentTrainees: 4,
    });
    const beta = organizations.find((o: any) => o.id === OTHER_ORG);
    // SUPER_ADMIN takes a trainer seat too
    expect(beta).toMatchObject({ currentTrainers: 1, currentTrainees: 1 });
  });

  it('counts exactly like the check that blocks a new account', async () => {
    const { mod } = await load(superAdmin());
    const { organizations } = await (await mod.GET(get())).json();
    const rule = tallySeatsByOrganization(
      grouped.map(r => ({
        organizationId: r.orgId,
        role: r.role,
        count: r.count,
      }))
    );
    for (const o of organizations) {
      expect({
        trainers: o.currentTrainers,
        trainees: o.currentTrainees,
      }).toEqual(rule[o.id]);
    }
  });

  it('an organization without accounts shows zero', async () => {
    jest.resetModules();
    const mock = createTableDb({
      organizations: [org(ORG, 'Alpha')],
      profiles: [],
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    mockSession(admin());
    const mod = await import('@/app/api/admin/organizations/route');
    const { organizations } = await (await mod.GET(get())).json();
    expect(organizations[0]).toMatchObject({
      currentTrainers: 0,
      currentTrainees: 0,
    });
  });

  it.each([
    ['ADMIN', admin],
    ['TEMP_ADMIN', tempAdmin],
  ])('%s only reads the own organization', async (_name, make) => {
    const { mod, mock } = await load(make());
    const res = await mod.GET(get());
    expect(res.status).toBe(200);
    expect(mock.filters('select', 'organizations').params).toEqual([ORG]);
    expect(mock.filters('select', 'profiles').params).toEqual([ORG]);
  });

  it('the platform admin reads every organization (no filter)', async () => {
    const { mod, mock } = await load(superAdmin());
    await mod.GET(get());
    expect(mock.filters('select', 'organizations').sql).toBe('');
    expect(mock.filters('select', 'profiles').sql).toBe('');
  });
});

describe('POST /api/admin/organizations', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each([
    ['ADMIN', admin],
    ['TEMP_ADMIN', tempAdmin],
  ])('%s cannot create an organization (403)', async (_name, make) => {
    const { mod, mock } = await load(make());
    const res = await mod.POST(
      makeRequest('POST', 'http://localhost/api/admin/organizations', {
        token: 't',
        body: { name: 'New', slug: 'new', subscriptionPlan: 'LIGHT' },
      })
    );
    expect(res.status).toBe(403);
    expect(mock.writes('insert', 'organizations')).toHaveLength(0);
  });
});
