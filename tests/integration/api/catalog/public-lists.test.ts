/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

async function load(
  route: 'training-components' | 'training-use-cases',
  tables: Record<string, any>
) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import(`@/app/api/${route}/route`);
  return { GET: mod.GET as (req: any) => Promise<Response>, mock };
}

const get = (query = '') => ({ url: `http://localhost/api/x${query}` }) as any;

describe('public catalog lists', () => {
  beforeEach(() => jest.clearAllMocks());

  describe('/api/training-components', () => {
    const catalogs = [
      { id: FIAE, code: 'FIAE', isActive: true },
      { id: KFBM, code: 'KFBM', isActive: true },
    ];

    it('defaults to FIAE and filters components by that catalog', async () => {
      const { GET, mock } = await load('training-components', {
        trainingCatalogs: [catalogs[0]],
        trainingComponents: [
          { id: 'c1', code: '1-P1', title: 'A', orderIndex: 1 },
        ],
      });
      const res = await GET(get());
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.components).toHaveLength(1);
      const filter = mock.filters('select', 'training_components');
      expect(filter.sql).toContain('"training_catalog_id"');
      expect(filter.params).toContain(FIAE);
      expect(filter.params).not.toContain(KFBM);
      expect(res.headers.get('x-catalog')).toBe('FIAE');
      expect(res.headers.get('vary')).toContain('X-Catalog');
      expect(res.headers.get('cache-control')).toContain('s-maxage');
    });

    it('serves another active catalog by code, case-insensitive', async () => {
      const { GET, mock } = await load('training-components', {
        trainingCatalogs: [catalogs[1]],
        trainingComponents: [{ id: 'k1', code: 'K1', title: 'K' }],
      });
      const res = await GET(get('?catalog=kfbm'));
      expect(res.status).toBe(200);
      expect(res.headers.get('x-catalog')).toBe('KFBM');
      expect(mock.filters('select', 'training_components').params).toEqual([
        KFBM,
      ]);
    });

    it('does not deliver inactive catalogs (404)', async () => {
      const { GET, mock } = await load('training-components', {
        trainingCatalogs: [{ id: KFBM, code: 'KFBM', isActive: false }],
        trainingComponents: [{ id: 'k1' }],
      });
      const res = await GET(get('?catalog=KFBM'));
      expect(res.status).toBe(404);
      // components are never queried for an unusable catalog
      expect(mock.calls.some(c => c.table === 'training_components')).toBe(
        false
      );
    });

    it('answers 404 for an unknown catalog code', async () => {
      const { GET } = await load('training-components', {
        trainingCatalogs: [],
      });
      expect((await GET(get('?catalog=NOPE'))).status).toBe(404);
    });
  });

  describe('/api/training-use-cases', () => {
    it('limits the join to the components of the selected catalog', async () => {
      const { GET, mock } = await load('training-use-cases', {
        trainingCatalogs: [{ id: KFBM, code: 'KFBM', isActive: true }],
        trainingUseCases: [
          {
            id: 'u1',
            componentId: 'k1',
            letter: 'a)',
            description: 'x',
            plannedHours: 8,
            orderIndex: 1,
            componentCode: 'K1',
            componentTitle: 'KfBM component',
          },
        ],
      });
      const res = await GET(get('?catalog=KFBM'));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.useCases[0].component.code).toBe('K1');
      const filter = mock.filters('select', 'training_use_cases');
      expect(filter.sql).toContain(
        '"training_components"."training_catalog_id"'
      );
      expect(filter.params).toEqual([KFBM]);
      expect(res.headers.get('x-catalog')).toBe('KFBM');
      expect(res.headers.get('cache-control')).toBe('no-store');
    });

    it('does not deliver inactive catalogs', async () => {
      const { GET } = await load('training-use-cases', {
        trainingCatalogs: [{ id: KFBM, code: 'KFBM', isActive: false }],
      });
      expect((await GET(get('?catalog=KFBM'))).status).toBe(404);
    });
  });
});
