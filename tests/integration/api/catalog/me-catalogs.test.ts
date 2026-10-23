/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import { fakeSession, mockSession } from '../../../helpers/mockNext';

// GET /api/me/catalogs: the occupations of the signed in user. It runs the real
// catalog scope (src/lib/catalog/scope.ts) against a table mock.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'org-1';

const catalogs = [
  {
    id: KFBM,
    code: 'KFBM',
    title: 'Kaufmann/-frau für Büromanagement',
    isActive: true,
  },
  {
    id: FIAE,
    code: 'FIAE',
    title: 'Fachinformatiker/in Anwendungsentwicklung',
    isActive: true,
  },
];
const inactive = {
  id: '00000000-0000-4000-8000-000000000009',
  code: 'ZZZ',
  title: 'Nicht freigegeben',
  isActive: false,
};
const fiaeOnly = [{ trainingCatalogId: FIAE, isEnabled: true }];
const kfbmOnly = [{ trainingCatalogId: KFBM, isEnabled: true }];
const both = [...fiaeOnly, ...kfbmOnly];

function req(url = 'http://localhost/api/me/catalogs', header?: string) {
  return {
    url,
    method: 'GET',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-catalog' ? (header ?? null) : null,
    },
  } as any;
}

async function load(
  tables: Record<string, any>,
  session: ReturnType<typeof fakeSession> | null
) {
  jest.resetModules();
  const mock = createTableDb({ trainingCatalogs: catalogs, ...tables });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(session);
  const mod = await import('@/app/api/me/catalogs/route');
  return { GET: mod.GET as (r: any) => Promise<Response>, mock };
}

const trainee = (overrides = {}) =>
  fakeSession({
    id: 'tn1',
    role: 'TRAINEE',
    organizationId: ORG,
    isTrainerLevel: false,
    ...overrides,
  });
const trainer = () => fakeSession({ id: 'tr1', organizationId: ORG });
const superAdmin = () =>
  fakeSession({
    id: 'sa1',
    role: 'SUPER_ADMIN',
    isAdmin: true,
    isSuperAdmin: true,
  });

describe('GET /api/me/catalogs', () => {
  beforeEach(() => jest.clearAllMocks());

  it('answers 401 without a session', async () => {
    const { GET } = await load({ organizationCatalogs: fiaeOnly }, null);
    expect((await GET(req())).status).toBe(401);
  });

  it('gives a trainee without an enrollment the FIAE catalog (legacy behavior)', async () => {
    const { GET } = await load(
      { organizationCatalogs: fiaeOnly, traineeEnrollments: [] },
      trainee()
    );
    const res = await GET(req());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      catalogs: [
        { code: 'FIAE', title: 'Fachinformatiker/in Anwendungsentwicklung' },
      ],
      activeCode: 'FIAE',
      selected: false,
    });
  });

  it('gives a KfBM trainee only KfBM, also in an organization with both occupations', async () => {
    const { GET } = await load(
      {
        organizationCatalogs: both,
        traineeEnrollments: [
          { trainingCatalogId: KFBM, startDate: '2026-09-01' },
        ],
      },
      trainee()
    );
    const body = await (await GET(req())).json();
    expect(body.catalogs.map((c: any) => c.code)).toEqual(['KFBM']);
    expect(body.activeCode).toBe('KFBM');
    expect(body.selected).toBe(false);
  });

  it('refuses a KfBM trainee the FIAE catalog (403)', async () => {
    const { GET } = await load(
      {
        organizationCatalogs: both,
        traineeEnrollments: [
          { trainingCatalogId: KFBM, startDate: '2026-09-01' },
        ],
      },
      trainee()
    );
    const res = await GET(req('http://localhost/api/me/catalogs?catalog=FIAE'));
    expect(res.status).toBe(403);
  });

  it('accepts the own occupation by code, case-insensitive, and marks it selected', async () => {
    const { GET } = await load(
      {
        organizationCatalogs: both,
        traineeEnrollments: [
          { trainingCatalogId: KFBM, startDate: '2026-09-01' },
        ],
      },
      trainee()
    );
    const body = await (
      await GET(req('http://localhost/api/me/catalogs?catalog=kfbm'))
    ).json();
    expect(body.activeCode).toBe('KFBM');
    expect(body.selected).toBe(true);
  });

  it('lists both occupations for a trainer of an organization with both, FIAE first', async () => {
    const { GET } = await load({ organizationCatalogs: both }, trainer());
    const body = await (await GET(req())).json();
    expect(body.catalogs.map((c: any) => c.code)).toEqual(['FIAE', 'KFBM']);
    expect(body.activeCode).toBe('FIAE');

    const chosen = await (
      await GET(req('http://localhost/api/me/catalogs', 'KFBM'))
    ).json();
    expect(chosen.activeCode).toBe('KFBM');
    expect(chosen.selected).toBe(true);
  });

  it('never lists an occupation the organization has not enabled', async () => {
    const { GET } = await load({ organizationCatalogs: fiaeOnly }, trainer());
    const body = await (await GET(req())).json();
    expect(body.catalogs.map((c: any) => c.code)).toEqual(['FIAE']);
    const res = await GET(req('http://localhost/api/me/catalogs?catalog=KFBM'));
    expect(res.status).toBe(403);
  });

  it('refuses an unknown or inactive code like a foreign one (403)', async () => {
    const { GET } = await load(
      {
        trainingCatalogs: [...catalogs, inactive],
        organizationCatalogs: [
          ...both,
          { trainingCatalogId: inactive.id, isEnabled: true },
        ],
      },
      trainer()
    );
    expect(
      (await GET(req('http://localhost/api/me/catalogs?catalog=ZZZ'))).status
    ).toBe(403);
    expect(
      (await GET(req('http://localhost/api/me/catalogs?catalog=NOPE'))).status
    ).toBe(403);
  });

  it('lets the super admin choose among all occupations', async () => {
    const { GET } = await load(
      { organizationCatalogs: kfbmOnly },
      superAdmin()
    );
    const body = await (await GET(req())).json();
    expect(body.catalogs.map((c: any) => c.code)).toEqual(['FIAE', 'KFBM']);
  });

  it('gives out only code and title, never an id, and is not cached', async () => {
    const { GET } = await load({ organizationCatalogs: both }, trainer());
    const res = await GET(req());
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(FIAE);
    expect(text).not.toContain(KFBM);
    expect(res.headers.get('cache-control')).toBe('private, no-store');
  });

  it('answers 503 and hides the details when the scope cannot be determined', async () => {
    const { GET, mock } = await load({ organizationCatalogs: both }, trainer());
    mock.db.select.mockImplementationOnce(() => {
      throw new Error('connection refused at 10.0.0.1');
    });
    const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
    const res = await GET(req());
    spy.mockRestore();
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain('10.0.0.1');
  });
});
