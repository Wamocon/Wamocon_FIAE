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

// GET /api/admin/users answers every user as before and adds trainingCatalogCode
// (the code of the first enrollment) and trainingCatalogCodes (the codes of all
// enrollments, a trainee can be in several trainings) for trainees, FIAE without
// an enrollment. The lookup is separate from the user query and never breaks the
// list.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';

const user = (overrides: Record<string, unknown>) => ({
  id: 'u1',
  fullName: 'Test User',
  firstName: 'Test',
  lastName: 'User',
  email: 'user@example.com',
  avatarUrl: null,
  role: 'TRAINEE',
  isActive: true,
  trainerActivated: true,
  organizationId: ORG,
  createdAt: '2026-01-01T00:00:00.000Z',
  orgName: 'Org',
  orgSlug: 'org',
  ...overrides,
});

const tables = {
  profiles: [
    user({ id: 'kfbm-trainee', email: 'k@example.com' }),
    user({ id: 'fiae-trainee', email: 'f@example.com' }),
    user({ id: 'trainer', role: 'TRAINER', email: 't@example.com' }),
    user({ id: 'both-trainee', email: 'b@example.com' }),
  ],
  traineeEnrollments: [
    {
      traineeId: 'kfbm-trainee',
      trainingCatalogId: KFBM,
      startDate: '2026-09-01',
    },
    // enrolled in KfBM later than in FIAE: FIAE is the first one
    {
      traineeId: 'both-trainee',
      trainingCatalogId: KFBM,
      startDate: '2026-09-01',
      createdAt: new Date('2026-10-02'),
    },
    {
      traineeId: 'both-trainee',
      trainingCatalogId: FIAE,
      startDate: '2025-09-01',
      createdAt: new Date('2026-09-01'),
    },
  ],
  trainingCatalogs: [
    { id: FIAE, code: 'FIAE' },
    { id: KFBM, code: 'KFBM' },
  ],
};

async function load(options: { failCodes?: boolean } = {}) {
  jest.resetModules();
  process.env.RESEND_API_KEY = 're_test_key';
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  if (options.failCodes) {
    jest.doMock('@/lib/catalog/admin', () => ({
      ...(jest.requireActual('@/lib/catalog/admin') as object),
      getTrainingCatalogCodeLists: async () => {
        throw new Error('relation "trainee_enrollments" does not exist');
      },
    }));
  }
  mockSession(
    fakeSession({
      id: 'ad1',
      role: 'ADMIN',
      organizationId: ORG,
      isAdmin: true,
    })
  );
  const mod = await import('@/app/api/admin/users/route');
  return { mock, mod };
}

describe('GET /api/admin/users', () => {
  beforeEach(() => jest.clearAllMocks());

  it('adds the catalog code of every trainee', async () => {
    const { mod } = await load();
    const res = await mod.GET(
      makeRequest('GET', 'http://localhost/api/admin/users', { token: 't' })
    );
    expect(res.status).toBe(200);
    const { users } = await res.json();
    const byId = Object.fromEntries(users.map((u: any) => [u.id, u]));
    expect(byId['kfbm-trainee'].trainingCatalogCode).toBe('KFBM');
    // a trainee without an enrollment row works in FIAE
    expect(byId['fiae-trainee'].trainingCatalogCode).toBe('FIAE');
    // other roles have no occupation
    expect(byId['trainer'].trainingCatalogCode).toBeNull();
    expect(byId['trainer'].trainingCatalogCodes).toBeNull();
  });

  it('lists all the trainings of a trainee, the first one is the main code', async () => {
    const { mod } = await load();
    const res = await mod.GET(
      makeRequest('GET', 'http://localhost/api/admin/users', { token: 't' })
    );
    const { users } = await res.json();
    const byId = Object.fromEntries(users.map((u: any) => [u.id, u]));
    expect(byId['both-trainee'].trainingCatalogCodes).toEqual([
      'FIAE',
      'KFBM',
    ]);
    expect(byId['both-trainee'].trainingCatalogCode).toBe('FIAE');
    expect(byId['kfbm-trainee'].trainingCatalogCodes).toEqual(['KFBM']);
    expect(byId['fiae-trainee'].trainingCatalogCodes).toEqual(['FIAE']);
  });

  it('keeps the fields of the user list as they were', async () => {
    const { mod } = await load();
    const res = await mod.GET(
      makeRequest('GET', 'http://localhost/api/admin/users', { token: 't' })
    );
    const { users } = await res.json();
    expect(users).toHaveLength(4);
    expect(Object.keys(users[0]).sort()).toEqual(
      [
        'avatarUrl',
        'createdAt',
        'email',
        'firstName',
        'fullName',
        'id',
        'isActive',
        'lastName',
        'orgName',
        'orgSlug',
        'organizationId',
        'role',
        'trainerActivated',
        'trainingCatalogCode',
        'trainingCatalogCodes',
      ].sort()
    );
  });

  it('a failing catalog lookup does not break the list', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const { mod } = await load({ failCodes: true });
    const res = await mod.GET(
      makeRequest('GET', 'http://localhost/api/admin/users', { token: 't' })
    );
    expect(res.status).toBe(200);
    const { users } = await res.json();
    expect(users).toHaveLength(4);
    expect(users.every((u: any) => u.trainingCatalogCode === null)).toBe(true);
    expect(users.every((u: any) => u.trainingCatalogCodes === null)).toBe(true);
    errorSpy.mockRestore();
  });
});
