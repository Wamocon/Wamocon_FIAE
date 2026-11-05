/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

// WMCNL-2959: the database orders the code as text, so the Lernfelder came as
// LF-1, LF-10, LF-11, LF-12, LF-2. Both lists answer in the order of the
// numbers.

const FIAE = '00000000-0000-4000-8000-000000000001';
const codes = ['LF-1', 'LF-10', 'LF-11', 'LF-12', 'LF-2', 'LF-3', 'LF-9'];
const row = (code: string) => ({
  id: `id-${code}`,
  label: code,
  title: `Titel ${code}`,
  description: null,
  trainingCatalogId: FIAE,
  createdAt: new Date('2026-01-01'),
  updatedAt: new Date('2026-01-01'),
});

async function load(route: string) {
  jest.resetModules();
  const mock = createTableDb({
    trainingCatalogs: [{ id: FIAE, code: 'FIAE', isActive: true }],
    trainingCatalogLearningFields: codes.map(row),
    useCases: [{ c: 0 }],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  // an anonymous caller gets the public catalog FIAE
  jest.doMock('@/lib/auth/session', () => {
    const actual = jest.requireActual('@/lib/auth/session') as any;
    return { ...actual, getSessionUser: async () => null };
  });
  jest.doMock('@/lib/api-cache', () => {
    const actual = jest.requireActual('@/lib/api-cache') as any;
    return {
      ...actual,
      apiCache: {
        getOrFetch: async (_key: string, fn: () => Promise<unknown>) => fn(),
        invalidate: () => undefined,
      },
    };
  });
  return import(`@/app/api/${route}/route`);
}

const request = (url: string) =>
  ({
    url,
    method: 'GET',
    headers: { get: () => null },
  }) as any;

describe('the Lernfelder in the order of their numbers', () => {
  beforeEach(() => jest.clearAllMocks());

  it('GET /api/trainee/school/lernfelder (the notes)', async () => {
    const mod = await load('trainee/school/lernfelder');
    const res = await mod.GET(
      request('http://localhost/api/trainee/school/lernfelder')
    );
    const body = await res.json();
    expect(body.lernfelder.map((l: any) => l.code)).toEqual([
      'LF-1',
      'LF-2',
      'LF-3',
      'LF-9',
      'LF-10',
      'LF-11',
      'LF-12',
    ]);
  });

  it('GET /api/trainee/lernfelder (the cards)', async () => {
    const mod = await load('trainee/lernfelder');
    const res = await mod.GET(
      request('http://localhost/api/trainee/lernfelder')
    );
    const body = await res.json();
    expect(body.lernfelder.map((l: any) => l.label)).toEqual([
      'LF-1',
      'LF-2',
      'LF-3',
      'LF-9',
      'LF-10',
      'LF-11',
      'LF-12',
    ]);
  });
});
