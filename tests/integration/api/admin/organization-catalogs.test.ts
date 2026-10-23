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

// GET and PUT /api/admin/organizations/[orgId]/catalogs:
//  - GET: the platform admin reads every organization and sees inactive
//    catalogs, ADMIN and TEMP_ADMIN read their own organization only (another
//    one is 404) and only see active catalogs. TRAINER 403, anonymous 401.
//  - PUT: only the platform admin writes. ADMIN, TEMP_ADMIN and TRAINER get
//    403 (also for their own organization), anonymous gets 401.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';
const OTHER_ORG = '22222222-2222-4222-8222-222222222222';

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

const defaultTables = {
  trainingCatalogs: [fiae, kfbm],
  organizations: [{ id: ORG }],
  organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
  traineeEnrollments: [],
  profiles: [{ count: 0 }],
};

async function load(
  session: ReturnType<typeof fakeSession> | null,
  tables: Record<string, any> = defaultTables
) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(session);
  const mod =
    await import('@/app/api/admin/organizations/[orgId]/catalogs/route');
  return { mock, mod };
}

const url = (orgId: string) =>
  `http://localhost/api/admin/organizations/${orgId}/catalogs`;
const params = (orgId: string) => ({ params: Promise.resolve({ orgId }) });
const get = (orgId: string, token: string | null = 't') =>
  makeRequest('GET', url(orgId), { token });
const put = (orgId: string, body: unknown) =>
  makeRequest('PUT', url(orgId), { token: 't', body });

describe('GET /api/admin/organizations/[orgId]/catalogs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('the platform admin sees every organization and inactive catalogs', async () => {
    const { mod } = await load(superAdmin(), {
      ...defaultTables,
      trainingCatalogs: [fiae, { ...kfbm, isActive: false }],
    });
    const res = await mod.GET(get(ORG), params(ORG));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.organizationId).toBe(ORG);
    expect(
      body.catalogs.map((c: any) => [c.code, c.isActive, c.isEnabled])
    ).toEqual([
      ['FIAE', true, true],
      ['KFBM', false, false],
    ]);
  });

  it.each([
    ['ADMIN', admin],
    ['TEMP_ADMIN', tempAdmin],
  ])(
    '%s reads the own organization, active catalogs only',
    async (_n, make) => {
      const { mod } = await load(make(), {
        ...defaultTables,
        trainingCatalogs: [fiae, { ...kfbm, isActive: false }],
      });
      const res = await mod.GET(get(ORG), params(ORG));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.catalogs.map((c: any) => c.code)).toEqual(['FIAE']);
    }
  );

  it.each([
    ['ADMIN', admin],
    ['TEMP_ADMIN', tempAdmin],
  ])('%s gets 404 for a foreign organization', async (_n, make) => {
    const { mod, mock } = await load(make());
    const res = await mod.GET(get(OTHER_ORG), params(OTHER_ORG));
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Organization not found' });
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('an organization that does not exist is 404', async () => {
    const { mod } = await load(superAdmin(), {
      ...defaultTables,
      organizations: [],
    });
    const res = await mod.GET(get(ORG), params(ORG));
    expect(res.status).toBe(404);
  });

  it('an id that is no uuid is 404', async () => {
    const { mod, mock } = await load(superAdmin());
    const res = await mod.GET(get('nope'), params('nope'));
    expect(res.status).toBe(404);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('TRAINER gets 403', async () => {
    const { mod, mock } = await load(trainer());
    const res = await mod.GET(get(ORG), params(ORG));
    expect(res.status).toBe(403);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('an anonymous caller gets 401', async () => {
    const { mod, mock } = await load(null);
    const res = await mod.GET(get(ORG, null), params(ORG));
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
    const mod =
      await import('@/app/api/admin/organizations/[orgId]/catalogs/route');
    const res = await mod.GET(get(ORG), params(ORG));
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });
});

describe('PUT /api/admin/organizations/[orgId]/catalogs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('the platform admin enables a catalog for an organization', async () => {
    const { mod, mock } = await load(superAdmin());
    const res = await mod.PUT(
      put(ORG, { catalogId: KFBM, isEnabled: true }),
      params(ORG)
    );
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'organization_catalogs')).toEqual([
      { organizationId: ORG, trainingCatalogId: KFBM, isEnabled: true },
    ]);
    const body = await res.json();
    expect(body.organizationId).toBe(ORG);
    expect(body.catalogs).toHaveLength(2);
  });

  it('gives an organization without rows its FIAE row as well', async () => {
    const { mod, mock } = await load(superAdmin(), {
      ...defaultTables,
      organizationCatalogs: [],
    });
    const res = await mod.PUT(
      put(ORG, { catalogId: KFBM, isEnabled: true }),
      params(ORG)
    );
    expect(res.status).toBe(200);
    expect(mock.writes('insert', 'organization_catalogs')).toEqual([
      { organizationId: ORG, trainingCatalogId: FIAE, isEnabled: true },
      { organizationId: ORG, trainingCatalogId: KFBM, isEnabled: true },
    ]);
  });

  it('the last enabled catalog answers 409', async () => {
    const { mod, mock } = await load(superAdmin());
    const res = await mod.PUT(
      put(ORG, { catalogId: FIAE, isEnabled: false }),
      params(ORG)
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({ code: 'LAST_ENABLED_CATALOG' });
    expect(mock.writes('insert', 'organization_catalogs')).toHaveLength(0);
  });

  it('a catalog with enrolled trainees of the organization answers 409', async () => {
    const { mod, mock } = await load(superAdmin(), {
      ...defaultTables,
      organizationCatalogs: [
        { trainingCatalogId: FIAE, isEnabled: true },
        { trainingCatalogId: KFBM, isEnabled: true },
      ],
      traineeEnrollments: [{ catalogId: KFBM, count: 2 }],
    });
    const res = await mod.PUT(
      put(ORG, { catalogId: KFBM, isEnabled: false }),
      params(ORG)
    );
    expect(res.status).toBe(409);
    expect(await res.json()).toMatchObject({
      code: 'CATALOG_IN_USE',
      count: 2,
    });
    expect(mock.writes('insert', 'organization_catalogs')).toHaveLength(0);
  });

  it('an unknown catalog is 404', async () => {
    const unknown = '99999999-9999-4999-8999-999999999999';
    const { mod } = await load(superAdmin());
    const res = await mod.PUT(
      put(ORG, { catalogId: unknown, isEnabled: true }),
      params(ORG)
    );
    expect(res.status).toBe(404);
    expect(await res.json()).toMatchObject({ code: 'CATALOG_NOT_FOUND' });
  });

  it('an organization that does not exist is 404', async () => {
    const { mod, mock } = await load(superAdmin(), {
      ...defaultTables,
      organizations: [],
    });
    const res = await mod.PUT(
      put(ORG, { catalogId: KFBM, isEnabled: true }),
      params(ORG)
    );
    expect(res.status).toBe(404);
    expect(mock.writes('insert', 'organization_catalogs')).toHaveLength(0);
  });

  it('an organization id that is no uuid is 404', async () => {
    const { mod, mock } = await load(superAdmin());
    const res = await mod.PUT(
      put('nope', { catalogId: KFBM, isEnabled: true }),
      params('nope')
    );
    expect(res.status).toBe(404);
    expect(mock.db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    [{}],
    [{ catalogId: KFBM }],
    [{ isEnabled: true }],
    [{ catalogId: 'nope', isEnabled: true }],
    [{ catalogId: KFBM, isEnabled: 'true' }],
    [null],
  ])('an invalid body is 400 (%j)', async body => {
    const { mod, mock } = await load(superAdmin());
    const res = await mod.PUT(put(ORG, body), params(ORG));
    expect(res.status).toBe(400);
    expect(mock.db.transaction).not.toHaveBeenCalled();
  });

  it.each([
    ['ADMIN', admin],
    ['TEMP_ADMIN', tempAdmin],
    ['TRAINER', trainer],
  ])('%s gets 403 even for the own organization', async (_n, make) => {
    const { mod, mock } = await load(make());
    const res = await mod.PUT(
      put(ORG, { catalogId: KFBM, isEnabled: true }),
      params(ORG)
    );
    expect(res.status).toBe(403);
    expect(mock.db.transaction).not.toHaveBeenCalled();
    expect(mock.writes('insert', 'organization_catalogs')).toHaveLength(0);
  });

  it('TEMP_ADMIN of another organization gets 403 as well', async () => {
    const { mod, mock } = await load(tempAdmin(OTHER_ORG));
    const res = await mod.PUT(
      put(ORG, { catalogId: KFBM, isEnabled: true }),
      params(ORG)
    );
    expect(res.status).toBe(403);
    expect(mock.db.transaction).not.toHaveBeenCalled();
  });

  it('an anonymous caller gets 401', async () => {
    const { mod, mock } = await load(null);
    const res = await mod.PUT(
      makeRequest('PUT', url(ORG), {
        body: { catalogId: KFBM, isEnabled: true },
      }),
      params(ORG)
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
    const mod =
      await import('@/app/api/admin/organizations/[orgId]/catalogs/route');
    const res = await mod.PUT(
      put(ORG, { catalogId: KFBM, isEnabled: true }),
      params(ORG)
    );
    expect(res.status).toBe(500);
    errorSpy.mockRestore();
  });
});
