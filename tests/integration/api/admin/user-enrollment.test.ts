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

// GET and PUT /api/admin/users/[userId]/enrollment:
//  - GET: the platform admin reads every trainee, ADMIN and TEMP_ADMIN read the
//    trainees of their own organization (another one is 404). TRAINER 403,
//    anonymous 401.
//  - PUT: only the platform admin sets the occupation of a trainee. ADMIN,
//    TEMP_ADMIN and TRAINER get 403, anonymous gets 401. The target has to be a
//    TRAINEE, the catalog active and enabled for the organization of the trainee.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';
const TRAINEE = '33333333-3333-4333-8333-333333333333';

const fiae = { id: FIAE, code: 'FIAE', title: 'FIAE', isActive: true };
const kfbm = { id: KFBM, code: 'KFBM', title: 'KfBM', isActive: true };

const superAdmin = () =>
  fakeSession({
    id: 'sa1',
    role: 'ADMIN',
    organizationId: OTHER_ORG,
    isAdmin: true,
    isSuperAdmin: true,
    isPlatformOwner: true,
  });
const admin = (organizationId = ORG) =>
  fakeSession({ id: 'ad1', role: 'ADMIN', organizationId, isAdmin: true });
const tempAdmin = (organizationId = ORG) =>
  fakeSession({
    id: 'ta1',
    role: 'TEMP_ADMIN',
    organizationId,
    isAdmin: true,
  });
const trainer = () => fakeSession({ id: 'tr1', organizationId: ORG });

const traineeRow = {
  id: TRAINEE,
  role: 'TRAINEE',
  organizationId: ORG,
  startOfTrainingDate: new Date('2026-09-01T00:00:00.000Z'),
  ausbildungDurationYears: 3,
};

const defaultTables = {
  profiles: [traineeRow],
  trainingCatalogs: [fiae, kfbm],
  organizationCatalogs: [
    { trainingCatalogId: FIAE, isEnabled: true },
    { trainingCatalogId: KFBM, isEnabled: true },
  ],
  traineeEnrollments: [{ id: 'e1', trainingCatalogId: FIAE }],
};

async function load(
  session: ReturnType<typeof fakeSession> | null,
  tables: Record<string, any> = defaultTables
) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(session);
  const mod = await import('@/app/api/admin/users/[userId]/enrollment/route');
  return { mock, mod };
}

const url = (userId: string) =>
  `http://localhost/api/admin/users/${userId}/enrollment`;
const params = (userId: string) => ({ params: Promise.resolve({ userId }) });
const get = (userId: string, token: string | null = 't') =>
  makeRequest('GET', url(userId), { token });
const put = (userId: string, body: unknown) =>
  makeRequest('PUT', url(userId), { token: 't', body });

describe('GET /api/admin/users/[userId]/enrollment', () => {
  beforeEach(() => jest.clearAllMocks());

  const enrolled = {
    id: 'e1',
    trainingCatalogId: KFBM,
    code: 'KFBM',
    title: 'KfBM',
    startDate: '2026-09-01',
    durationYears: 3,
  };

  it('the platform admin reads the enrollment of any trainee', async () => {
    const { mod } = await load(superAdmin(), {
      ...defaultTables,
      traineeEnrollments: [enrolled],
    });
    const res = await mod.GET(get(TRAINEE), params(TRAINEE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enrollment: enrolled,
      effectiveCatalogId: KFBM,
      isImplicit: false,
    });
  });

  it('a trainee without an enrollment row counts as FIAE', async () => {
    const { mod } = await load(superAdmin(), {
      ...defaultTables,
      traineeEnrollments: [],
    });
    const res = await mod.GET(get(TRAINEE), params(TRAINEE));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      enrollment: null,
      effectiveCatalogId: FIAE,
      isImplicit: true,
    });
  });

  it.each([
    ['ADMIN', admin],
    ['TEMP_ADMIN', tempAdmin],
  ])('%s reads a trainee of the own organization', async (_n, make) => {
    const { mod } = await load(make(), {
      ...defaultTables,
      traineeEnrollments: [enrolled],
    });
    const res = await mod.GET(get(TRAINEE), params(TRAINEE));
    expect(res.status).toBe(200);
    expect((await res.json()).effectiveCatalogId).toBe(KFBM);
  });

  it.each([
    ['ADMIN', admin],
    ['TEMP_ADMIN', tempAdmin],
  ])('%s gets 404 for a trainee of another organization', async (_n, make) => {
    const { mod, mock } = await load(make(OTHER_ORG));
    const res = await mod.GET(get(TRAINEE), params(TRAINEE));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'User not found' });
    // Only the profile was looked up, no enrollment was read
    expect(mock.filters('select', 'trainee_enrollments').sql).toBe('');
  });

  it('a user that does not exist is 404', async () => {
    const { mod } = await load(superAdmin(), {
      ...defaultTables,
      profiles: [],
    });
    const res = await mod.GET(get(TRAINEE), params(TRAINEE));
    expect(res.status).toBe(404);
  });

  it('an id that is no uuid is 404', async () => {
    const { mod, mock } = await load(superAdmin());
    const res = await mod.GET(get('nope'), params('nope'));
    expect(res.status).toBe(404);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('a user that is no trainee is 400', async () => {
    const { mod } = await load(superAdmin(), {
      ...defaultTables,
      profiles: [{ ...traineeRow, role: 'TRAINER' }],
    });
    const res = await mod.GET(get(TRAINEE), params(TRAINEE));
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'NOT_A_TRAINEE' });
  });

  it('TRAINER gets 403', async () => {
    const { mod, mock } = await load(trainer());
    const res = await mod.GET(get(TRAINEE), params(TRAINEE));
    expect(res.status).toBe(403);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('an anonymous caller gets 401', async () => {
    const { mod, mock } = await load(null);
    const res = await mod.GET(get(TRAINEE, null), params(TRAINEE));
    expect(res.status).toBe(401);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('a database failure is a plain 500', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.resetModules();
    jest.doMock('@/db', () => ({
      __esModule: true,
      default: {
        select: () => {
          throw new Error('db down');
        },
      },
    }));
    mockSession(superAdmin());
    const mod = await import('@/app/api/admin/users/[userId]/enrollment/route');
    const res = await mod.GET(get(TRAINEE), params(TRAINEE));
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });
});

describe('PUT /api/admin/users/[userId]/enrollment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('the platform admin enrolls a trainee in another catalog', async () => {
    const { mod, mock } = await load(superAdmin());
    const res = await mod.PUT(
      put(TRAINEE, { catalogId: KFBM }),
      params(TRAINEE)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      changed: true,
      replaced: 1,
      effectiveCatalogId: expect.any(String),
    });
    // the old enrollment is removed, the new one takes start and duration
    // from the profile
    expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(1);
    expect(mock.writes('insert', 'trainee_enrollments')).toEqual([
      {
        traineeId: TRAINEE,
        trainingCatalogId: KFBM,
        startDate: '2026-09-01',
        durationYears: 3,
      },
    ]);
  });

  it('setting the same catalog again changes nothing', async () => {
    const { mod, mock } = await load(superAdmin());
    const res = await mod.PUT(
      put(TRAINEE, { catalogId: FIAE }),
      params(TRAINEE)
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ changed: false, replaced: 0 });
    expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(0);
    expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
  });

  it('only a trainee can be enrolled (400)', async () => {
    const { mod, mock } = await load(superAdmin(), {
      ...defaultTables,
      profiles: [{ ...traineeRow, role: 'ADMIN' }],
    });
    const res = await mod.PUT(
      put(TRAINEE, { catalogId: KFBM }),
      params(TRAINEE)
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'NOT_A_TRAINEE' });
    expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
    expect(mock.writes('delete', 'trainee_enrollments')).toHaveLength(0);
  });

  it('a catalog that is not enabled for the organization is 400', async () => {
    const { mod, mock } = await load(superAdmin(), {
      ...defaultTables,
      organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
    });
    const res = await mod.PUT(
      put(TRAINEE, { catalogId: KFBM }),
      params(TRAINEE)
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'CATALOG_NOT_ENABLED' });
    expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
  });

  it('an inactive catalog is 400', async () => {
    const { mod } = await load(superAdmin(), {
      ...defaultTables,
      trainingCatalogs: [fiae, { ...kfbm, isActive: false }],
    });
    const res = await mod.PUT(
      put(TRAINEE, { catalogId: KFBM }),
      params(TRAINEE)
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toMatchObject({ code: 'CATALOG_INACTIVE' });
  });

  it('an unknown catalog is 404', async () => {
    const unknown = '99999999-9999-4999-8999-999999999999';
    const { mod } = await load(superAdmin());
    const res = await mod.PUT(
      put(TRAINEE, { catalogId: unknown }),
      params(TRAINEE)
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'CATALOG_NOT_FOUND' });
  });

  it('a user that does not exist is 404 and nothing is written', async () => {
    const { mod, mock } = await load(superAdmin(), {
      ...defaultTables,
      profiles: [],
    });
    const res = await mod.PUT(
      put(TRAINEE, { catalogId: KFBM }),
      params(TRAINEE)
    );
    expect(res.status).toBe(404);
    expect(mock.db.transaction).not.toHaveBeenCalled();
  });

  it('an id that is no uuid is 404', async () => {
    const { mod, mock } = await load(superAdmin());
    const res = await mod.PUT(put('nope', { catalogId: KFBM }), params('nope'));
    expect(res.status).toBe(404);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it.each([[{}], [{ catalogId: 'nope' }], [{ catalogId: 7 }], [null]])(
    'an invalid body is 400 (%j)',
    async body => {
      const { mod, mock } = await load(superAdmin());
      const res = await mod.PUT(put(TRAINEE, body), params(TRAINEE));
      expect(res.status).toBe(400);
      expect(mock.db.transaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['ADMIN', admin],
    ['TEMP_ADMIN', tempAdmin],
    ['TRAINER', trainer],
  ])(
    '%s gets 403 even for a trainee of the own organization',
    async (_n, make) => {
      const { mod, mock } = await load(make());
      const res = await mod.PUT(
        put(TRAINEE, { catalogId: KFBM }),
        params(TRAINEE)
      );
      expect(res.status).toBe(403);
      expect(mock.db.select).not.toHaveBeenCalled();
      expect(mock.db.transaction).not.toHaveBeenCalled();
      expect(mock.writes('insert', 'trainee_enrollments')).toHaveLength(0);
    }
  );

  it('TEMP_ADMIN of another organization gets 403 as well', async () => {
    const { mod, mock } = await load(tempAdmin(OTHER_ORG));
    const res = await mod.PUT(
      put(TRAINEE, { catalogId: KFBM }),
      params(TRAINEE)
    );
    expect(res.status).toBe(403);
    expect(mock.db.transaction).not.toHaveBeenCalled();
  });

  it('an anonymous caller gets 401', async () => {
    const { mod, mock } = await load(null);
    const res = await mod.PUT(
      makeRequest('PUT', url(TRAINEE), { body: { catalogId: KFBM } }),
      params(TRAINEE)
    );
    expect(res.status).toBe(401);
    expect(mock.db.transaction).not.toHaveBeenCalled();
  });

  it('a database failure is a plain 500', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.resetModules();
    jest.doMock('@/db', () => ({
      __esModule: true,
      default: {
        select: () => {
          throw new Error('db down');
        },
      },
    }));
    mockSession(superAdmin());
    const mod = await import('@/app/api/admin/users/[userId]/enrollment/route');
    const res = await mod.PUT(
      put(TRAINEE, { catalogId: KFBM }),
      params(TRAINEE)
    );
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });
});
