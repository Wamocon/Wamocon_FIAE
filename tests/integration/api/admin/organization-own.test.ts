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

// GET and PATCH /api/admin/organizations/[orgId]: an ADMIN and a TEMP_ADMIN
// work on their own organization only (another one is 404). They change the
// master data (name, contact data, notes, logo). Plan, seats and activation
// stay with the platform admin (403). The sidebar shows the page "My
// organization" to both levels because of exactly this (adminMenu.test.ts).

const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';

const orgRow = (id: string, extra: Record<string, unknown> = {}) => ({
  id,
  name: 'Alpha',
  slug: 'alpha',
  subscriptionPlan: 'LIGHT',
  maxTraineeSeats: 5,
  maxTrainerSeats: 3,
  isActive: true,
  isPlatformOwner: false,
  ...extra,
});

const admin = () =>
  fakeSession({ id: 'ad1', role: 'ADMIN', organizationId: ORG, isAdmin: true });
const tempAdmin = () =>
  fakeSession({
    id: 'ta1',
    role: 'TEMP_ADMIN',
    organizationId: ORG,
    isAdmin: true,
  });
const platformTempAdmin = () =>
  fakeSession({
    id: 'ta2',
    role: 'TEMP_ADMIN',
    organizationId: OTHER_ORG,
    isAdmin: true,
    isPlatformOwner: true,
  });
const trainer = () => fakeSession({ role: 'TRAINER', organizationId: ORG });

async function load(session: ReturnType<typeof fakeSession> | null) {
  jest.resetModules();
  const mock = createTableDb({ organizations: [orgRow(ORG)] });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(session);
  const mod = await import('@/app/api/admin/organizations/[orgId]/route');
  return { mod, mock };
}

const ctx = (orgId: string) => ({ params: Promise.resolve({ orgId }) });
const url = (orgId: string) =>
  `http://localhost/api/admin/organizations/${orgId}`;
const get = (orgId: string) => makeRequest('GET', url(orgId), { token: 't' });
const patch = (orgId: string, body: unknown) =>
  makeRequest('PATCH', url(orgId), { token: 't', body });

describe.each([
  ['ADMIN', admin],
  ['TEMP_ADMIN', tempAdmin],
  ['TEMP_ADMIN of the platform organization', platformTempAdmin],
])('%s: the own organization', (_name, make) => {
  beforeEach(() => jest.clearAllMocks());

  // The platform temp admin belongs to OTHER_ORG, the others to ORG
  const own = () => (make === platformTempAdmin ? OTHER_ORG : ORG);
  const foreign = () => (make === platformTempAdmin ? ORG : OTHER_ORG);

  it('reads it (GET 200)', async () => {
    const { mod } = await load(make());
    const res = await mod.GET(get(own()), ctx(own()));
    expect(res.status).toBe(200);
  });

  it('does not find another organization (GET 404)', async () => {
    const { mod, mock } = await load(make());
    const res = await mod.GET(get(foreign()), ctx(foreign()));
    expect(res.status).toBe(404);
    expect(mock.calls.filter(c => c.op === 'select')).toHaveLength(0);
  });

  it('changes the master data (PATCH 200)', async () => {
    const { mod, mock } = await load(make());
    const res = await mod.PATCH(
      patch(own(), {
        name: ' New name ',
        contactEmail: 'a@b.de',
        contactPerson: 'Max',
        notes: 'n',
        logoUrl: 'https://example.com/logo.png',
      }),
      ctx(own())
    );
    expect(res.status).toBe(200);
    expect(mock.writes('update', 'organizations')).toEqual([
      {
        name: 'New name',
        contactEmail: 'a@b.de',
        contactPerson: 'Max',
        notes: 'n',
        logoUrl: 'https://example.com/logo.png',
      },
    ]);
    expect(mock.filters('update', 'organizations').params).toEqual([own()]);
  });

  it('cannot change another organization (PATCH 404, nothing written)', async () => {
    const { mod, mock } = await load(make());
    const res = await mod.PATCH(
      patch(foreign(), { name: 'Hijacked' }),
      ctx(foreign())
    );
    expect(res.status).toBe(404);
    expect(mock.writes('update', 'organizations')).toHaveLength(0);
  });

  it.each([
    ['subscriptionPlan', { subscriptionPlan: 'PRO' }],
    ['maxTraineeSeats', { maxTraineeSeats: 500 }],
    ['maxTrainerSeats', { maxTrainerSeats: 500 }],
    ['isActive', { isActive: false }],
    [
      'master data together with the plan',
      { name: 'X', subscriptionPlan: 'PRO' },
    ],
  ])('cannot change %s (PATCH 403, nothing written)', async (_field, body) => {
    const { mod, mock } = await load(make());
    const res = await mod.PATCH(patch(own(), body), ctx(own()));
    expect(res.status).toBe(403);
    expect(mock.writes('update', 'organizations')).toHaveLength(0);
  });
});

describe('the own organization is closed to trainers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GET 403 and PATCH 403 for a TRAINER, 401 without a session', async () => {
    const asTrainer = await load(trainer());
    expect((await asTrainer.mod.GET(get(ORG), ctx(ORG))).status).toBe(403);
    expect(
      (await asTrainer.mod.PATCH(patch(ORG, { name: 'X' }), ctx(ORG))).status
    ).toBe(403);
    expect(asTrainer.mock.writes('update', 'organizations')).toHaveLength(0);

    const anonymous = await load(null);
    expect((await anonymous.mod.GET(get(ORG), ctx(ORG))).status).toBe(401);
  });
});
