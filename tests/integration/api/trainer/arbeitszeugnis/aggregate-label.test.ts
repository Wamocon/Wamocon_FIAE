/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  fakeSession,
  mockSession,
  mockTraineeAccess,
} from '../../../../helpers/mockNext';
import { createTableDb } from '../../../../helpers/mockDb';

// The component grades of the certificate view show the label of a FIAE component
// (2.1, 2.2) next to the code, KfBM and unknown catalogs keep the code.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

const entry = (over: Record<string, unknown>) => ({
  entryId: 'e',
  traineeGrade: '2',
  trainerGrade: '2',
  actualHours: 8,
  isGradeApproved: true,
  useCaseId: 'u',
  useCaseLetter: 'a',
  useCaseDescription: 'x',
  reportPeriodStart: new Date('2026-09-01'),
  ...over,
});

async function aggregate(rows: unknown[]) {
  jest.resetModules();
  mockSession(fakeSession());
  mockTraineeAccess('ok');
  const mock = createTableDb({
    activityReportUseCaseEntries: rows,
    profiles: [{ id: 'trainee-123', fullName: 'Test Azubi' }],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod =
    await import('../../../../../src/app/api/trainer/arbeitszeugnis/aggregate/[traineeId]/route');
  const res = await mod.GET(
    new Request(
      'http://localhost/api/trainer/arbeitszeugnis/aggregate/trainee-123?ausbildungsjahr=1'
    ) as any,
    { params: Promise.resolve({ traineeId: 'trainee-123' }) }
  );
  return { res, body: await res.json() };
}

describe('API: aggregate delivers the label of a component', () => {
  beforeEach(() => jest.clearAllMocks());

  it('labels FIAE components 2.1 and 2.2 and keeps the code', async () => {
    const { res, body } = await aggregate([
      entry({
        componentId: 'c2',
        componentCode: '2-P1',
        componentTitle: 'Informieren',
        componentOrderIndex: 2,
        componentCatalogId: FIAE,
      }),
      entry({
        componentId: 'c13',
        componentCode: '2-P2',
        componentTitle: 'Informieren (Vertiefung)',
        componentOrderIndex: 13,
        componentCatalogId: FIAE,
      }),
      entry({
        componentId: 'c23',
        componentCode: 'INT1',
        componentTitle: 'Berufsbildung',
        componentOrderIndex: 23,
        componentCatalogId: FIAE,
      }),
    ]);
    expect(res.status).toBe(200);
    expect(
      body.components.map((c: any) => [c.componentCode, c.componentLabel])
    ).toEqual([
      ['2-P1', '2.1'],
      ['2-P2', '2.2'],
      ['INT1', '23'],
    ]);
  });

  it('leaves KfBM as it is', async () => {
    const { body } = await aggregate([
      entry({
        componentId: 'k',
        componentCode: 'K24.2',
        componentTitle: 'Vertiefung',
        componentOrderIndex: 13,
        componentCatalogId: KFBM,
      }),
    ]);
    expect(body.components[0].componentLabel).toBe('K24.2');
  });
});
