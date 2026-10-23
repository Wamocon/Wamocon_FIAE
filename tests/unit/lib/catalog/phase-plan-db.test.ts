/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import { mockCatalogScope } from '../../../helpers/mockNext';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

const fiaeSettings = { phase_months: [18, 18] };
const kfbmSettings = { phase_months: [15, 21] };

async function load(tables: Record<string, any>, db?: any) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: db ?? mock.db }));
  const mod = await import('@/lib/catalog/phase-plan-db');
  return { mod, mock };
}

describe('phase plan loading', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  describe('loadPhasePlan', () => {
    it('reads the settings of the catalog (FIAE 18 + 18, shortened 12 + 12)', async () => {
      const { mod, mock } = await load({
        trainingCatalogs: [{ settings: fiaeSettings }],
      });
      expect((await mod.loadPhasePlan(FIAE, 3)).phaseMonths).toEqual([18, 18]);
      expect((await mod.loadPhasePlan(FIAE, 2)).phaseMonths).toEqual([12, 12]);
      const filter = mock.filters('select', 'training_catalogs');
      expect(filter.sql).toContain('"id"');
      expect(filter.params).toContain(FIAE);
    });

    it('reads the settings of KfBM (15 + 21, shortened 10 + 14)', async () => {
      const { mod } = await load({
        trainingCatalogs: [{ settings: kfbmSettings }],
      });
      expect((await mod.loadPhasePlan(KFBM, 3)).phaseMonths).toEqual([15, 21]);
      expect((await mod.loadPhasePlan(KFBM, 2)).phaseMonths).toEqual([10, 14]);
    });

    it('falls back to the previous values for unknown or unusable settings', async () => {
      const unknown = await load({ trainingCatalogs: [] });
      expect((await unknown.mod.loadPhasePlan(KFBM, 3)).phaseMonths).toEqual([
        18, 18,
      ]);

      const broken = await load({
        trainingCatalogs: [{ settings: { phase_months: 'x' } }],
      });
      expect((await broken.mod.loadPhasePlan(KFBM, 2)).phaseMonths).toEqual([
        12, 12,
      ]);
    });

    it('does not query without a catalog and uses the defaults', async () => {
      const { mod, mock } = await load({
        trainingCatalogs: [{ settings: kfbmSettings }],
      });
      expect((await mod.loadPhasePlan(null, 3)).phaseMonths).toEqual([18, 18]);
      expect((await mod.loadPhasePlan(undefined, 2)).phaseMonths).toEqual([
        12, 12,
      ]);
      expect(mock.calls).toHaveLength(0);
    });

    it('does not throw when the lookup fails and uses the defaults', async () => {
      const failing = {
        select: () => {
          throw new Error('syntax error at or near "from"');
        },
      };
      const { mod } = await load({}, failing);
      expect((await mod.loadPhasePlan(KFBM, 3)).phaseMonths).toEqual([18, 18]);
      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('loadPhasePlanForUser', () => {
    async function loadForUser(
      scope: {
        allowedCatalogIds: string[];
        activeCatalogId: string;
        selected: boolean;
      } | null,
      tables: Record<string, any>
    ) {
      jest.resetModules();
      const mock = createTableDb(tables);
      jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
      if (scope) {
        mockCatalogScope(scope);
      } else {
        jest.doMock('@/lib/catalog/scope', () => ({
          __esModule: true,
          getCatalogScopeForUserId: async () => null,
        }));
      }
      return import('@/lib/catalog/phase-plan-db');
    }

    it('uses the active catalog of the user', async () => {
      const mod = await loadForUser(
        {
          allowedCatalogIds: [KFBM],
          activeCatalogId: KFBM,
          selected: false,
        },
        { trainingCatalogs: [{ settings: kfbmSettings }] }
      );
      expect((await mod.loadPhasePlanForUser('t1', 3)).phaseMonths).toEqual([
        15, 21,
      ]);
    });

    it('uses the defaults when the scope cannot be determined', async () => {
      const mod = await loadForUser(null, {
        trainingCatalogs: [{ settings: kfbmSettings }],
      });
      expect((await mod.loadPhasePlanForUser('t1', 3)).phaseMonths).toEqual([
        18, 18,
      ]);
    });

    it('uses the defaults when the scope lookup throws', async () => {
      jest.resetModules();
      jest.doMock('@/db', () => ({
        __esModule: true,
        default: createTableDb({}).db,
      }));
      jest.doMock('@/lib/catalog/scope', () => ({
        __esModule: true,
        getCatalogScopeForUserId: async () => {
          throw new Error('boom');
        },
      }));
      const mod = await import('@/lib/catalog/phase-plan-db');
      expect((await mod.loadPhasePlanForUser('t1', 2)).phaseMonths).toEqual([
        12, 12,
      ]);
    });
  });
});
