/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

// The lists of the components and the use cases deliver a label next to the code:
// FIAE 2.1 and 2.2 for a pair, the plain number for a single component. The code
// and the order index stay as they are, KfBM and unknown codes are unchanged.

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
  return { GET: mod.GET as (req: any) => Promise<Response> };
}

const get = (query = '') => ({ url: `http://localhost/api/x${query}` }) as any;

describe('component labels in the public lists', () => {
  beforeEach(() => jest.clearAllMocks());

  it('/api/training-components labels the FIAE pairs 2.1 and 2.2 and keeps code and order', async () => {
    const { GET } = await load('training-components', {
      trainingCatalogs: [{ id: FIAE, code: 'FIAE', isActive: true }],
      trainingComponents: [
        { id: 'a', code: '1-P1', title: 'Planen', orderIndex: 1 },
        { id: 'b', code: '2-P1', title: 'Informieren', orderIndex: 2 },
        { id: 'c', code: '2-P2', title: 'Informieren V', orderIndex: 13 },
        { id: 'd', code: '10-P1', title: 'Konzipieren', orderIndex: 9 },
        { id: 'e', code: '10-P2', title: 'Konzipieren V', orderIndex: 20 },
        { id: 'f', code: 'INT4', title: 'Umweltschutz', orderIndex: 26 },
      ],
    });
    const body = await (await GET(get())).json();
    expect(
      body.components.map((c: any) => [c.code, c.orderIndex, c.label])
    ).toEqual([
      ['1-P1', 1, '1'],
      ['2-P1', 2, '2.1'],
      ['2-P2', 13, '2.2'],
      ['10-P1', 9, '9.1'],
      ['10-P2', 20, '9.2'],
      ['INT4', 26, '17'],
    ]);
  });

  it('/api/training-components leaves a KfBM component as it is', async () => {
    const { GET } = await load('training-components', {
      trainingCatalogs: [{ id: KFBM, code: 'KFBM', isActive: true }],
      trainingComponents: [
        { id: 'k', code: 'K24.2', title: 'Vertiefung', orderIndex: 2 },
      ],
    });
    const body = await (await GET(get('?catalog=KFBM'))).json();
    expect(body.components[0].label).toBe('K24.2');
    expect(body.components[0].code).toBe('K24.2');
  });

  it('/api/training-use-cases labels the component of a use case by catalog, code and order index', async () => {
    const useCase = (id: string, code: string, orderIndex: number) => ({
      id,
      componentId: `c-${id}`,
      letter: 'a)',
      description: 'x',
      plannedHours: 8,
      orderIndex: 1,
      componentCode: code,
      componentTitle: 'T',
      componentOrderIndex: orderIndex,
    });
    const { GET } = await load('training-use-cases', {
      trainingCatalogs: [{ id: FIAE, code: 'FIAE', isActive: true }],
      trainingUseCases: [
        useCase('u1', '3-P1', 3),
        useCase('u2', '3-P2', 14),
        useCase('u3', 'INT1', 23),
      ],
    });
    const body = await (await GET(get())).json();
    expect(
      body.useCases.map((u: any) => [u.component.code, u.component.label])
    ).toEqual([
      ['3-P1', '3.1'],
      ['3-P2', '3.2'],
      ['INT1', '14'],
    ]);
  });

  it('/api/training-use-cases leaves KfBM as it is', async () => {
    const { GET } = await load('training-use-cases', {
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
          componentTitle: 'KfBM',
          componentOrderIndex: 1,
        },
      ],
    });
    const body = await (await GET(get('?catalog=KFBM'))).json();
    expect(body.useCases[0].component.label).toBe('K1');
  });
});
