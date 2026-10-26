/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

// GET /api/training-components delivers phase and kind per component (KfBM S4)
// next to the fields it always had. Existing fields, their values and the
// sort order stay as they were.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const CREATED = new Date('2026-01-01T00:00:00.000Z');

async function load(tables: Record<string, any>) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import('@/app/api/training-components/route');
  return { GET: mod.GET as (req: any) => Promise<Response>, mock };
}

const get = (query = '') =>
  ({ url: `http://localhost/api/training-components${query}` }) as any;

// A FIAE row as it is in the database after the backfill
const fiaeRow = {
  id: 'f1',
  trainingCatalogId: FIAE,
  code: '§4.2.1',
  title: 'Planen',
  description: 'Beschreibung',
  totalWeeks: 4,
  totalHours: 160,
  trainingYear: 1,
  phase: 1,
  kind: 'pflicht',
  orderIndex: 1,
  createdAt: CREATED,
};

describe('/api/training-components phase and kind', () => {
  beforeEach(() => jest.clearAllMocks());

  it('keeps every existing field of a FIAE component and adds phase and kind', async () => {
    const { GET } = await load({
      trainingCatalogs: [{ id: FIAE, code: 'FIAE', isActive: true }],
      trainingComponents: [fiaeRow],
    });
    const res = await GET(get());
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.components).toEqual([
      {
        id: 'f1',
        code: '§4.2.1',
        title: 'Planen',
        description: 'Beschreibung',
        totalWeeks: 4,
        totalHours: 160,
        trainingYear: 1,
        orderIndex: 1,
        createdAt: CREATED.toISOString(),
        phase: 1,
        kind: 'pflicht',
      },
    ]);
  });

  it('delivers the integrative FIAE components with phase null', async () => {
    const { GET } = await load({
      trainingCatalogs: [{ id: FIAE, code: 'FIAE', isActive: true }],
      trainingComponents: [
        {
          ...fiaeRow,
          id: 'f23',
          trainingYear: 3,
          phase: null,
          kind: 'integrativ',
          orderIndex: 23,
        },
      ],
    });
    const body = await (await GET(get())).json();
    expect(body.components[0]).toMatchObject({
      id: 'f23',
      trainingYear: 3,
      phase: null,
      kind: 'integrativ',
    });
  });

  it('delivers KfBM components with phase and kind (elective and integrative)', async () => {
    const { GET, mock } = await load({
      trainingCatalogs: [{ id: KFBM, code: 'KFBM', isActive: true }],
      trainingComponents: [
        {
          ...fiaeRow,
          id: 'k1',
          trainingCatalogId: KFBM,
          code: 'K1',
          phase: 1,
          kind: 'pflicht',
          orderIndex: 1,
        },
        {
          ...fiaeRow,
          id: 'k2',
          trainingCatalogId: KFBM,
          code: 'K2',
          phase: 2,
          kind: 'pflicht',
          orderIndex: 2,
        },
        {
          ...fiaeRow,
          id: 'k3',
          trainingCatalogId: KFBM,
          code: 'W1',
          phase: 2,
          kind: 'wahl',
          orderIndex: 3,
        },
        {
          ...fiaeRow,
          id: 'k4',
          trainingCatalogId: KFBM,
          code: 'I1',
          phase: null,
          kind: 'integrativ',
          orderIndex: 4,
        },
      ],
    });
    const res = await GET(get('?catalog=KFBM'));
    const body = await res.json();

    expect(res.status).toBe(200);
    expect(body.components.map((c: any) => [c.code, c.phase, c.kind])).toEqual([
      ['K1', 1, 'pflicht'],
      ['K2', 2, 'pflicht'],
      ['W1', 2, 'wahl'],
      ['I1', null, 'integrativ'],
    ]);
    expect(mock.filters('select', 'training_components').params).toEqual([
      KFBM,
    ]);
  });

  it('keeps the order of the rows (sorted by the query, not re-sorted)', async () => {
    const { GET } = await load({
      trainingCatalogs: [{ id: FIAE, code: 'FIAE', isActive: true }],
      trainingComponents: [
        { ...fiaeRow, id: 'a', orderIndex: 1 },
        { ...fiaeRow, id: 'b', orderIndex: 2 },
        { ...fiaeRow, id: 'c', orderIndex: 3 },
      ],
    });
    const body = await (await GET(get())).json();
    expect(body.components.map((c: any) => c.id)).toEqual(['a', 'b', 'c']);
  });

  it('shows no phase and the default kind for a row that has neither column filled', async () => {
    const { GET } = await load({
      trainingCatalogs: [{ id: FIAE, code: 'FIAE', isActive: true }],
      trainingComponents: [
        {
          id: 'x',
          code: 'X',
          title: 'Alt',
          totalWeeks: 1,
          totalHours: 40,
          orderIndex: 5,
        },
      ],
    });
    const body = await (await GET(get())).json();
    expect(body.components[0].phase).toBeNull();
    expect(body.components[0].kind).toBe('pflicht');
  });

  it('keeps the cache headers of the public list', async () => {
    const { GET } = await load({
      trainingCatalogs: [{ id: KFBM, code: 'KFBM', isActive: true }],
      trainingComponents: [],
    });
    const res = await GET(get('?catalog=KFBM'));
    expect(res.headers.get('cache-control')).toBe(
      'public, s-maxage=300, stale-while-revalidate=59'
    );
    expect(res.headers.get('x-catalog')).toBe('KFBM');
    expect(res.headers.get('vary')).toBe('X-Catalog');
  });
});
