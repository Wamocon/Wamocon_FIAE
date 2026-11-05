/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../../helpers/mockDb';
import {
  fakeSession,
  mockSession,
  mockTraineeAccess,
} from '../../../../helpers/mockNext';

// WMCNL-3014: a trainee without a start of the training got the period
// 1 August 2025 to 31 July 2026 (an invented start), so the report of October
// 2026 was not in "the first training year" and the preview counted 0 of 1
// approved reports. Without a start date there is no period: the routes answer
// 422 with a code the page shows as a hint. A custom period, and a trainee
// with a start date, work as before.

const routes = ['aggregate', 'skill-radar', 'evidence'] as const;
const base = 'http://localhost/api/trainer/arbeitszeugnis';

async function call(
  route: (typeof routes)[number],
  profile: Record<string, unknown>,
  query: string
) {
  jest.resetModules();
  mockSession(fakeSession());
  mockTraineeAccess('ok');
  const mock = createTableDb({
    profiles: [{ id: 'trainee-123', fullName: 'Test Azubi', ...profile }],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import(
    `../../../../../src/app/api/trainer/arbeitszeugnis/${route}/[traineeId]/route`
  );
  const res = await mod.GET(
    new Request(`${base}/${route}/trainee-123${query}`) as any,
    { params: Promise.resolve({ traineeId: 'trainee-123' }) }
  );
  return { res, mock };
}

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
});

describe.each(routes)('GET /arbeitszeugnis/%s without a start date', route => {
  it('answers 422 TRAINING_START_MISSING and reads no report', async () => {
    const { res, mock } = await call(route, {}, '?ausbildungsjahr=1');
    expect(res.status).toBe(422);
    const body = await res.json();
    expect(body.code).toBe('TRAINING_START_MISSING');
    expect(body.error).toContain('kein Ausbildungsstart');
    expect(mock.filters('select', 'activity_reports').params).toEqual([]);
  });

  it('takes a custom period without a start date', async () => {
    const { res } = await call(
      route,
      {},
      '?startDate=2026-10-01&endDate=2026-10-31'
    );
    expect(res.status).toBe(200);
  });
});

describe('GET /arbeitszeugnis/aggregate with a start date', () => {
  it('counts the year from the start', async () => {
    const { res } = await call(
      'aggregate',
      { startDate: new Date('2026-08-01T00:00:00.000Z') },
      '?ausbildungsjahr=1'
    );
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.periodStart.slice(0, 10)).toBe('2026-08-01');
    expect(new Date(body.periodEnd).getTime()).toBeGreaterThan(
      new Date('2027-07-30T23:00:00.000Z').getTime()
    );
  });
});
