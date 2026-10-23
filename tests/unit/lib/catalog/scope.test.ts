/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = '11111111-1111-4111-8111-111111111111';

const catalogRows = [
  { id: FIAE, code: 'FIAE', isActive: true },
  { id: KFBM, code: 'KFBM', isActive: true },
];

function req(opts: { header?: string; query?: string } = {}) {
  return {
    url: `http://localhost/api/x${opts.query ? `?catalog=${opts.query}` : ''}`,
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-catalog' ? (opts.header ?? null) : null,
    },
  };
}

async function load(tables: Record<string, any>) {
  jest.resetModules();
  const { db } = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: db }));
  return import('@/lib/catalog/scope');
}

const trainer = { id: 'tr1', role: 'TRAINER', organizationId: ORG };
const trainee = { id: 't1', role: 'TRAINEE', organizationId: ORG };
const superAdmin = {
  id: 'sa1',
  role: 'ADMIN',
  organizationId: ORG,
  isSuperAdmin: true,
};

describe('catalog scope', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('trainer level', () => {
    it('uses the catalogs enabled for the organization, FIAE first', async () => {
      const { getCatalogScope } = await load({
        trainingCatalogs: catalogRows,
        organizationCatalogs: [
          { trainingCatalogId: KFBM, isEnabled: true },
          { trainingCatalogId: FIAE, isEnabled: true },
        ],
      });
      expect(await getCatalogScope(trainer, req())).toEqual({
        allowedCatalogIds: [FIAE, KFBM],
        activeCatalogId: FIAE,
        selected: false,
      });
    });

    it('ignores disabled and inactive catalogs', async () => {
      const { getCatalogScope } = await load({
        trainingCatalogs: [
          { id: FIAE, code: 'FIAE', isActive: true },
          { id: KFBM, code: 'KFBM', isActive: false },
        ],
        organizationCatalogs: [
          { trainingCatalogId: FIAE, isEnabled: false },
          { trainingCatalogId: KFBM, isEnabled: true },
        ],
      });
      // FIAE disabled, KFBM inactive: nothing left, fail closed
      await expect(getCatalogScope(trainer, req())).rejects.toMatchObject({
        status: 403,
      });
    });

    it('defaults a KfBM only organization to KFBM', async () => {
      const { getCatalogScope } = await load({
        trainingCatalogs: catalogRows,
        organizationCatalogs: [{ trainingCatalogId: KFBM, isEnabled: true }],
      });
      expect(await getCatalogScope(trainer, req())).toMatchObject({
        allowedCatalogIds: [KFBM],
        activeCatalogId: KFBM,
      });
    });

    it('gives a legacy organization without rows the FIAE catalog', async () => {
      const { getCatalogScope } = await load({
        trainingCatalogs: catalogRows,
        organizationCatalogs: [],
      });
      expect(await getCatalogScope(trainer, req())).toMatchObject({
        allowedCatalogIds: [FIAE],
        activeCatalogId: FIAE,
      });
    });

    it('selects a catalog by header or query and validates it', async () => {
      const { getCatalogScope } = await load({
        trainingCatalogs: catalogRows,
        organizationCatalogs: [
          { trainingCatalogId: FIAE, isEnabled: true },
          { trainingCatalogId: KFBM, isEnabled: true },
        ],
      });
      expect(await getCatalogScope(trainer, req({ header: 'kfbm' }))).toEqual({
        allowedCatalogIds: [FIAE, KFBM],
        activeCatalogId: KFBM,
        selected: true,
      });
      expect(
        (await getCatalogScope(trainer, req({ query: 'KFBM' }))).activeCatalogId
      ).toBe(KFBM);
      // header wins over query
      expect(
        (await getCatalogScope(trainer, req({ header: 'FIAE', query: 'KFBM' })))
          .activeCatalogId
      ).toBe(FIAE);
    });

    it('rejects a wrong or foreign x-catalog with 403', async () => {
      const { getCatalogScope } = await load({
        trainingCatalogs: catalogRows,
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
      });
      await expect(
        getCatalogScope(trainer, req({ header: 'KFBM' }))
      ).rejects.toMatchObject({ status: 403 });
      await expect(
        getCatalogScope(trainer, req({ header: 'NOPE' }))
      ).rejects.toMatchObject({ status: 403 });
    });
  });

  describe('trainee', () => {
    it('uses the catalog of the enrollment', async () => {
      const { getCatalogScope } = await load({
        trainingCatalogs: catalogRows,
        organizationCatalogs: [
          { trainingCatalogId: FIAE, isEnabled: true },
          { trainingCatalogId: KFBM, isEnabled: true },
        ],
        traineeEnrollments: [
          { trainingCatalogId: KFBM, startDate: '2026-08-01' },
        ],
      });
      expect(await getCatalogScope(trainee, req())).toEqual({
        allowedCatalogIds: [KFBM],
        activeCatalogId: KFBM,
        selected: false,
      });
    });

    it('falls back to FIAE without an enrollment', async () => {
      const { getCatalogScope } = await load({
        trainingCatalogs: catalogRows,
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
        traineeEnrollments: [],
      });
      expect(await getCatalogScope(trainee, req())).toMatchObject({
        allowedCatalogIds: [FIAE],
        activeCatalogId: FIAE,
      });
    });

    it('takes the latest enrollment as default and allows only enrolled catalogs', async () => {
      const { getCatalogScope } = await load({
        trainingCatalogs: catalogRows,
        organizationCatalogs: [
          { trainingCatalogId: FIAE, isEnabled: true },
          { trainingCatalogId: KFBM, isEnabled: true },
        ],
        traineeEnrollments: [
          { trainingCatalogId: FIAE, startDate: '2024-08-01' },
          { trainingCatalogId: KFBM, startDate: '2026-08-01' },
        ],
      });
      const scope = await getCatalogScope(trainee, req());
      expect(scope.activeCatalogId).toBe(KFBM);
      expect(scope.allowedCatalogIds).toEqual([KFBM, FIAE]);
    });

    it('cannot select a catalog without an enrollment (403)', async () => {
      const { getCatalogScope } = await load({
        trainingCatalogs: catalogRows,
        organizationCatalogs: [
          { trainingCatalogId: FIAE, isEnabled: true },
          { trainingCatalogId: KFBM, isEnabled: true },
        ],
        traineeEnrollments: [],
      });
      await expect(
        getCatalogScope(trainee, req({ header: 'KFBM' }))
      ).rejects.toMatchObject({ status: 403 });
    });

    it('drops an enrollment in a catalog the organization has disabled', async () => {
      const { getCatalogScope } = await load({
        trainingCatalogs: catalogRows,
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
        traineeEnrollments: [
          { trainingCatalogId: KFBM, startDate: '2026-08-01' },
        ],
      });
      await expect(getCatalogScope(trainee, req())).rejects.toMatchObject({
        status: 403,
      });
    });
  });

  describe('super admin', () => {
    it('sees all catalogs including inactive ones', async () => {
      const { getCatalogScope } = await load({
        trainingCatalogs: [
          { id: FIAE, code: 'FIAE', isActive: true },
          { id: KFBM, code: 'KFBM', isActive: false },
        ],
      });
      expect(await getCatalogScope(superAdmin, req())).toEqual({
        allowedCatalogIds: [FIAE, KFBM],
        activeCatalogId: FIAE,
        selected: false,
      });
      expect(
        (await getCatalogScope(superAdmin, req({ header: 'KFBM' })))
          .activeCatalogId
      ).toBe(KFBM);
    });
  });

  describe('fail closed', () => {
    it('answers 503 when the lookup fails, never all catalogs', async () => {
      jest.resetModules();
      const failing = {
        select: jest.fn(() => {
          throw new Error('db down');
        }),
      };
      jest.doMock('@/db', () => ({ __esModule: true, default: failing }));
      jest.doMock('@/lib/db-retry', () => ({
        withDbRetry: (fn: () => unknown) => fn(),
      }));
      const spy = jest.spyOn(console, 'error').mockImplementation(() => {});
      const { getCatalogScope, requireCatalogScope } =
        await import('@/lib/catalog/scope');
      await expect(getCatalogScope(superAdmin, req())).rejects.toMatchObject({
        status: 503,
      });
      const res = (await requireCatalogScope(trainer, req())) as Response;
      expect(res.status).toBe(503);
      spy.mockRestore();
      jest.dontMock('@/lib/db-retry');
    });

    it('requireCatalogScopeForUser rejects an unknown user', async () => {
      const { requireCatalogScopeForUser } = await load({
        profiles: [],
        trainingCatalogs: catalogRows,
      });
      const res = (await requireCatalogScopeForUser(
        'ghost',
        req()
      )) as Response;
      expect(res.status).toBe(403);
    });

    it('requireCatalogScopeForUser resolves role and organization from the profile', async () => {
      const { requireCatalogScopeForUser } = await load({
        profiles: [{ id: 't1', role: 'TRAINEE', organizationId: ORG }],
        trainingCatalogs: catalogRows,
        organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
        traineeEnrollments: [],
      });
      expect(await requireCatalogScopeForUser('t1', req())).toMatchObject({
        activeCatalogId: FIAE,
      });
    });
  });

  describe('helpers', () => {
    it('limits reads to the selection, or to everything allowed', async () => {
      const { readCatalogIds, isCatalogAllowed } = await load({});
      const all = {
        allowedCatalogIds: [FIAE, KFBM],
        activeCatalogId: FIAE,
        selected: false,
      };
      const one = { ...all, activeCatalogId: KFBM, selected: true };
      expect(readCatalogIds(all)).toEqual([FIAE, KFBM]);
      expect(readCatalogIds(one)).toEqual([KFBM]);
      expect(isCatalogAllowed(one, FIAE)).toBe(true);
      expect(isCatalogAllowed(one, 'other')).toBe(false);
      expect(isCatalogAllowed(one, null)).toBe(false);
    });

    it('ensureContentInScope hides records of other catalogs (404)', async () => {
      const { ensureContentInScope } = await load({
        courses: [{ trainingCatalogId: FIAE }],
      });
      const scope = {
        allowedCatalogIds: [KFBM],
        activeCatalogId: KFBM,
        selected: false,
      };
      const res = (await ensureContentInScope(
        scope,
        'course',
        'c1'
      )) as Response;
      expect(res.status).toBe(404);
      const ok = await ensureContentInScope(
        { ...scope, allowedCatalogIds: [FIAE, KFBM] },
        'course',
        'c1'
      );
      expect(ok).toBeNull();
    });

    it('ensureContentInScope answers 404 for a missing record', async () => {
      const { ensureContentInScope } = await load({ courses: [] });
      const scope = {
        allowedCatalogIds: [FIAE],
        activeCatalogId: FIAE,
        selected: false,
      };
      const res = (await ensureContentInScope(
        scope,
        'course',
        'x'
      )) as Response;
      expect(res.status).toBe(404);
    });
  });
});
