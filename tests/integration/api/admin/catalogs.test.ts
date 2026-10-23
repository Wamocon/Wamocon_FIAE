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

// GET /api/admin/catalogs and PATCH /api/admin/catalogs/[catalogId]:
// only the platform admin reads the catalog list and switches catalogs on or
// off. Role rules per method: SUPER_ADMIN may, ADMIN, TEMP_ADMIN and TRAINER
// get 403, an anonymous caller gets 401. The session guards are replaced, the
// database is a table mock that records every write.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';

const fiae = {
  id: FIAE,
  code: 'FIAE',
  title: 'Fachinformatiker Anwendungsentwicklung',
  description: null,
  isActive: true,
  durationYears: 3,
  electivePickCount: 0,
};
const kfbm = {
  id: KFBM,
  code: 'KFBM',
  title: 'Kaufleute für Büromanagement',
  description: null,
  isActive: true,
  durationYears: 3,
  electivePickCount: 2,
};

const superAdmin = () =>
  fakeSession({
    id: 'sa1',
    role: 'ADMIN',
    organizationId: ORG,
    isAdmin: true,
    isSuperAdmin: true,
    isPlatformOwner: true,
  });
const admin = () =>
  fakeSession({
    id: 'ad1',
    role: 'ADMIN',
    organizationId: ORG,
    isAdmin: true,
  });
const tempAdmin = () =>
  fakeSession({
    id: 'ta1',
    role: 'TEMP_ADMIN',
    organizationId: ORG,
    isAdmin: true,
  });
const trainer = () => fakeSession({ id: 'tr1', organizationId: ORG });

const defaultTables = {
  trainingCatalogs: [fiae, kfbm],
  traineeEnrollments: [],
  profiles: [{ count: 0 }],
  organizations: [{ id: ORG }],
  organizationCatalogs: [
    { organizationId: ORG, trainingCatalogId: FIAE, isEnabled: true },
    { organizationId: ORG, trainingCatalogId: KFBM, isEnabled: true },
  ],
};

async function load(
  route: string,
  session: ReturnType<typeof fakeSession> | null,
  tables: Record<string, any> = defaultTables
) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(session);
  const mod = await import(`@/app/api/${route}/route`);
  return { mock, mod };
}

const listUrl = 'http://localhost/api/admin/catalogs';
const itemUrl = (id: string) => `http://localhost/api/admin/catalogs/${id}`;
const params = (catalogId: string) => ({
  params: Promise.resolve({ catalogId }),
});

describe('GET /api/admin/catalogs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('the platform admin gets all catalogs with usage', async () => {
    const { mod } = await load('admin/catalogs', superAdmin(), {
      ...defaultTables,
      traineeEnrollments: [{ catalogId: KFBM, count: 2 }],
      profiles: [{ count: 3 }],
    });
    const res = await mod.GET(makeRequest('GET', listUrl, { token: 't' }));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.catalogs.map((c: any) => c.code)).toEqual(['FIAE', 'KFBM']);
    // FIAE counts the three trainees without an enrollment row
    expect(body.catalogs[0]).toMatchObject({
      isActive: true,
      traineeCount: 3,
      organizationCount: 1,
    });
    expect(body.catalogs[1]).toMatchObject({
      traineeCount: 2,
      organizationCount: 1,
    });
  });

  it.each([
    ['ADMIN', admin],
    ['TEMP_ADMIN', tempAdmin],
    ['TRAINER', trainer],
  ])('%s gets 403 and no data', async (_name, makeSession) => {
    const { mod, mock } = await load('admin/catalogs', makeSession());
    const res = await mod.GET(makeRequest('GET', listUrl, { token: 't' }));
    expect(res.status).toBe(403);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('an anonymous caller gets 401', async () => {
    const { mod, mock } = await load('admin/catalogs', null);
    const res = await mod.GET(makeRequest('GET', listUrl));
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
    const mod = await import('@/app/api/admin/catalogs/route');
    const res = await mod.GET(makeRequest('GET', listUrl, { token: 't' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    errorSpy.mockRestore();
  });
});

describe('PATCH /api/admin/catalogs/[catalogId]', () => {
  beforeEach(() => jest.clearAllMocks());

  const patch = (id: string, body: unknown) =>
    makeRequest('PATCH', itemUrl(id), { token: 't', body });

  it('the platform admin switches a catalog off', async () => {
    const { mod, mock } = await load(
      'admin/catalogs/[catalogId]',
      superAdmin()
    );
    const res = await mod.PATCH(patch(KFBM, { isActive: false }), params(KFBM));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      catalog: {
        id: KFBM,
        code: 'KFBM',
        title: kfbm.title,
        isActive: false,
      },
    });
    expect(mock.writes('update', 'training_catalogs')).toEqual([
      { isActive: false },
    ]);
  });

  it('the platform admin activates a catalog', async () => {
    const { mod, mock } = await load(
      'admin/catalogs/[catalogId]',
      superAdmin(),
      {
        ...defaultTables,
        trainingCatalogs: [fiae, { ...kfbm, isActive: false }],
      }
    );
    const res = await mod.PATCH(patch(KFBM, { isActive: true }), params(KFBM));
    expect(res.status).toBe(200);
    expect((await res.json()).catalog.isActive).toBe(true);
    expect(mock.writes('update', 'training_catalogs')).toEqual([
      { isActive: true },
    ]);
  });

  it('FIAE cannot be deactivated (409 DEFAULT_CATALOG)', async () => {
    const { mod, mock } = await load(
      'admin/catalogs/[catalogId]',
      superAdmin()
    );
    const res = await mod.PATCH(patch(FIAE, { isActive: false }), params(FIAE));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'DEFAULT_CATALOG' });
    expect(mock.writes('update', 'training_catalogs')).toHaveLength(0);
  });

  it('a catalog with enrolled trainees answers 409 with the count', async () => {
    const { mod, mock } = await load(
      'admin/catalogs/[catalogId]',
      superAdmin(),
      { ...defaultTables, traineeEnrollments: [{ catalogId: KFBM, count: 4 }] }
    );
    const res = await mod.PATCH(patch(KFBM, { isActive: false }), params(KFBM));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'CATALOG_IN_USE',
      count: 4,
    });
    expect(mock.writes('update', 'training_catalogs')).toHaveLength(0);
  });

  it('an organization with only this catalog answers 409', async () => {
    const { mod, mock } = await load(
      'admin/catalogs/[catalogId]',
      superAdmin(),
      {
        ...defaultTables,
        organizationCatalogs: [
          { organizationId: ORG, trainingCatalogId: KFBM, isEnabled: true },
        ],
      }
    );
    const res = await mod.PATCH(patch(KFBM, { isActive: false }), params(KFBM));
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'LAST_ENABLED_CATALOG',
      count: 1,
    });
    expect(mock.writes('update', 'training_catalogs')).toHaveLength(0);
  });

  it('an unknown catalog is 404', async () => {
    const other = '99999999-9999-4999-8999-999999999999';
    const { mod } = await load('admin/catalogs/[catalogId]', superAdmin());
    const res = await mod.PATCH(
      patch(other, { isActive: false }),
      params(other)
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'CATALOG_NOT_FOUND' });
  });

  it('an id that is no uuid is 404 and never reaches the database', async () => {
    const { mod, mock } = await load(
      'admin/catalogs/[catalogId]',
      superAdmin()
    );
    const res = await mod.PATCH(
      patch('nope', { isActive: false }),
      params('nope')
    );
    expect(res.status).toBe(404);
    expect(mock.db.transaction).not.toHaveBeenCalled();
  });

  it.each([{}, { isActive: 'false' }, { isActive: 0 }, null, [true]])(
    'a body without a boolean isActive is 400 (%j)',
    async body => {
      const { mod, mock } = await load(
        'admin/catalogs/[catalogId]',
        superAdmin()
      );
      const res = await mod.PATCH(patch(KFBM, body), params(KFBM));
      expect(res.status).toBe(400);
      expect(mock.db.transaction).not.toHaveBeenCalled();
    }
  );

  it.each([
    ['ADMIN', admin],
    ['TEMP_ADMIN', tempAdmin],
    ['TRAINER', trainer],
  ])('%s gets 403 and nothing is written', async (_name, makeSession) => {
    const { mod, mock } = await load(
      'admin/catalogs/[catalogId]',
      makeSession()
    );
    const res = await mod.PATCH(patch(KFBM, { isActive: false }), params(KFBM));
    expect(res.status).toBe(403);
    expect(mock.db.transaction).not.toHaveBeenCalled();
    expect(mock.writes('update', 'training_catalogs')).toHaveLength(0);
  });

  it('an anonymous caller gets 401', async () => {
    const { mod, mock } = await load('admin/catalogs/[catalogId]', null);
    const res = await mod.PATCH(
      makeRequest('PATCH', itemUrl(KFBM), { body: { isActive: false } }),
      params(KFBM)
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
        transaction: async () => {
          throw new Error('db down');
        },
      },
    }));
    mockSession(superAdmin());
    const mod = await import('@/app/api/admin/catalogs/[catalogId]/route');
    const res = await mod.PATCH(patch(KFBM, { isActive: false }), params(KFBM));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    errorSpy.mockRestore();
  });
});
