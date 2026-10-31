/**
 * @jest-environment node
 */
import { describe, it, expect, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  makeRequest,
  mockCatalogScope,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';

// The Rahmenplan of KfBM has no hours per use case yet (planned_hours 0). Such a
// use case must not be "exhausted" or "overbooked": the hours route leaves it
// out (the page treats a use case without an entry as allowed) and the list of
// use cases says hoursLimited false. FIAE keeps its behavior.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ME = '11111111-1111-4111-8111-111111111111';

async function load(route: string, rows: Record<string, any>) {
  jest.resetModules();
  mockSession(traineeSession(ME, { organizationId: 'org-1' }));
  mockCatalogScope();
  const mock = createTableDb(rows);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  return import(`@/app/api/${route}/route`);
}

const useCases = [
  { id: 'u-kfbm-0', plannedHours: 0, catalogId: KFBM },
  { id: 'u-kfbm-40', plannedHours: 40, catalogId: KFBM },
  { id: 'u-fiae-0', plannedHours: 0, catalogId: FIAE },
  { id: 'u-fiae-40', plannedHours: 40, catalogId: FIAE },
];

describe('use cases without hours', () => {
  it('the hours route leaves out a KfBM use case without hours and keeps the others', async () => {
    const mod = await load('trainee/use-case-hours', {
      activityReports: [],
      trainingUseCases: useCases,
    });
    const res = await mod.GET(
      makeRequest('GET', 'http://localhost/api/trainee/use-case-hours')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const ids = body.useCaseHours.map((u: any) => u.useCaseId);
    expect(ids).not.toContain('u-kfbm-0');
    expect(ids).toEqual(
      expect.arrayContaining(['u-kfbm-40', 'u-fiae-0', 'u-fiae-40'])
    );
    const fiaeZero = body.useCaseHours.find((u: any) => u.useCaseId === 'u-fiae-0');
    expect(fiaeZero.remainingHours).toBe(0);
  });

  it('the list of use cases says hoursLimited false only for KfBM without hours', async () => {
    const mod = await load('training-use-cases', {
      trainingCatalogs: [{ id: KFBM, code: 'KFBM', isActive: true }],
      trainingUseCases: useCases.map(u => ({
        ...u,
        componentId: 'c-1',
        letter: 'a',
        description: 'x',
        orderIndex: 1,
        createdAt: new Date(),
        componentCode: 'K1',
        componentTitle: 'T',
      })),
    });
    const res = await mod.GET(
      makeRequest('GET', 'http://localhost/api/training-use-cases?catalog=KFBM')
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    const byId = Object.fromEntries(
      body.useCases.map((u: any) => [u.id, u.hoursLimited])
    );
    expect(byId['u-kfbm-0']).toBe(false);
    expect(byId['u-kfbm-40']).toBe(true);
    expect(byId['u-fiae-0']).toBe(true);
    expect(byId['u-fiae-40']).toBe(true);
  });
});
