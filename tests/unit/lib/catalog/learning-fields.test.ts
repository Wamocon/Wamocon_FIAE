/**
 * @jest-environment node
 */
import { describe, it, expect, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

describe('labelTrainingYear', () => {
  it.each([
    ['LF-1', 1],
    ['LF5', 1],
    ['LF-6', 2],
    ['lf 10a', 2],
    ['LF-11', 3],
    ['LF12a', 3],
    ['Projekt X', 1],
    ['', 1],
  ])('maps %p to year %p', async (label, year) => {
    const { labelTrainingYear } = await import('@/lib/catalog/learning-fields');
    expect(labelTrainingYear(label)).toBe(year);
  });
});

describe('catalog cache key and conditions', () => {
  it('keeps catalogs apart in cache keys', async () => {
    const { catalogCacheKey } = await import('@/lib/catalog/scope');
    const a = {
      allowedCatalogIds: [FIAE, KFBM],
      activeCatalogId: FIAE,
      selected: false,
    };
    const b = { ...a, activeCatalogId: KFBM, selected: true };
    expect(catalogCacheKey(a)).toBe(`${FIAE}+${KFBM}`);
    expect(catalogCacheKey(b)).toBe(KFBM);
    expect(catalogCacheKey(a)).not.toBe(catalogCacheKey(b));
  });
});

describe('requireOptionalSessionScope', () => {
  async function load(tables: Record<string, any>, session: unknown) {
    jest.resetModules();
    const { db } = createTableDb(tables);
    jest.doMock('@/db', () => ({ __esModule: true, default: db }));
    jest.doMock('@/lib/auth/session', () => {
      const actual = jest.requireActual('@/lib/auth/session') as any;
      return { ...actual, getSessionUser: async () => session };
    });
    return import('@/lib/catalog/public');
  }
  const request = (query = '') =>
    ({
      url: `http://localhost/api/x${query}`,
      headers: { get: () => null },
    }) as any;

  it('uses the session scope when a session exists', async () => {
    const { requireOptionalSessionScope } = await load(
      {
        trainingCatalogs: [
          { id: FIAE, code: 'FIAE', isActive: true },
          { id: KFBM, code: 'KFBM', isActive: true },
        ],
        organizationCatalogs: [{ trainingCatalogId: KFBM, isEnabled: true }],
      },
      { id: 'tr1', role: 'TRAINER', organizationId: 'org-1' }
    );
    expect(await requireOptionalSessionScope(request())).toMatchObject({
      allowedCatalogIds: [KFBM],
      activeCatalogId: KFBM,
    });
  });

  it('gives an anonymous caller only the active public catalog', async () => {
    const { requireOptionalSessionScope } = await load(
      { trainingCatalogs: [{ id: FIAE, code: 'FIAE', isActive: true }] },
      null
    );
    expect(await requireOptionalSessionScope(request())).toEqual({
      allowedCatalogIds: [FIAE],
      activeCatalogId: FIAE,
      selected: true,
    });
  });

  it('refuses an inactive catalog for an anonymous caller', async () => {
    const { requireOptionalSessionScope } = await load(
      { trainingCatalogs: [{ id: KFBM, code: 'KFBM', isActive: false }] },
      null
    );
    const res = (await requireOptionalSessionScope(
      request('?catalog=KFBM')
    )) as Response;
    expect(res.status).toBe(404);
  });
});
