/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../helpers/mockDb';

// The data context counts the activity reports per occupation: a report belongs
// to one occupation, so a trainee in two trainings gets each count on its own
// and the report of the other training is not mistaken for the report of the
// current week. A trainee with one occupation gets the plain numbers.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

async function load(options: {
  allowed: string[];
  statusRows: { catalogId: string; status: string; cnt: number }[];
  weekRows: { catalogId: string }[];
  scope?: null;
}) {
  jest.resetModules();
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const mock = createTableDb({
    // first select: the counts, second: the rows of the current week
    activityReports: { sequence: [options.statusRows, options.weekRows] },
    trainingCatalogs: [
      { id: FIAE, code: 'FIAE' },
      { id: KFBM, code: 'KFBM' },
    ],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const scopeForUser = jest.fn(async () =>
    options.scope === null
      ? null
      : {
          allowedCatalogIds: options.allowed,
          activeCatalogId: options.allowed[0],
          selected: false,
        }
  );
  jest.doMock('@/lib/catalog/scope', () => ({
    __esModule: true,
    ...(jest.requireActual('@/lib/catalog/scope') as object),
    getCatalogScopeForUserId: scopeForUser,
  }));
  const { fetchReportStatus } = await import('@/lib/hai/dataContext');
  return { fetchReportStatus, mock, scopeForUser };
}

beforeEach(() => jest.clearAllMocks());

describe('fetchReportStatus', () => {
  it('a trainee in two occupations: every occupation has its own numbers', async () => {
    const { fetchReportStatus } = await load({
      allowed: [FIAE, KFBM],
      statusRows: [
        { catalogId: FIAE, status: 'APPROVED', cnt: 5 },
        { catalogId: FIAE, status: 'DRAFT', cnt: 1 },
        { catalogId: KFBM, status: 'SUBMITTED', cnt: 2 },
      ],
      // only the KfBM report belongs to the current week
      weekRows: [{ catalogId: KFBM }],
    });
    const result = await fetchReportStatus('t1');
    expect(result.occupations).toEqual([
      {
        code: 'FIAE',
        draft: 1,
        submitted: 0,
        approved: 5,
        rejected: 0,
        currentWeekExists: false,
      },
      {
        code: 'KFBM',
        draft: 0,
        submitted: 2,
        approved: 0,
        rejected: 0,
        currentWeekExists: true,
      },
    ]);
    // the plain numbers are those of the default occupation (the first one)
    expect(result).toMatchObject({
      draft: 1,
      submitted: 0,
      approved: 5,
      rejected: 0,
      currentWeekExists: false,
    });
  });

  it('a trainee in one occupation: plain numbers, no list', async () => {
    const { fetchReportStatus } = await load({
      allowed: [FIAE],
      statusRows: [
        { catalogId: FIAE, status: 'APPROVED', cnt: 3 },
        { catalogId: FIAE, status: 'REJECTED', cnt: 1 },
      ],
      weekRows: [{ catalogId: FIAE }],
    });
    const result = await fetchReportStatus('t1');
    expect(result).toEqual({
      draft: 0,
      submitted: 0,
      approved: 3,
      rejected: 1,
      currentWeekExists: true,
    });
  });

  it('with an occupation named only that one is counted (no scope lookup)', async () => {
    const { fetchReportStatus, scopeForUser, mock } = await load({
      allowed: [FIAE, KFBM],
      statusRows: [{ catalogId: KFBM, status: 'SUBMITTED', cnt: 2 }],
      weekRows: [],
    });
    const result = await fetchReportStatus('t1', KFBM);
    expect(scopeForUser).not.toHaveBeenCalled();
    expect(result.submitted).toBe(2);
    expect(result.occupations).toBeUndefined();
    const filter = mock.filters('select', 'activity_reports');
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
  });

  it('counts a report of an occupation outside the scope nowhere', async () => {
    const { fetchReportStatus } = await load({
      allowed: [FIAE],
      statusRows: [{ catalogId: KFBM, status: 'SUBMITTED', cnt: 4 }],
      weekRows: [],
    });
    const result = await fetchReportStatus('t1');
    expect(result.submitted).toBe(0);
  });

  it('fails closed without a catalog scope: nothing is counted', async () => {
    const { fetchReportStatus, mock } = await load({
      allowed: [],
      statusRows: [{ catalogId: FIAE, status: 'APPROVED', cnt: 9 }],
      weekRows: [],
      scope: null,
    });
    const result = await fetchReportStatus('t1');
    expect(result).toEqual({
      draft: 0,
      submitted: 0,
      approved: 0,
      rejected: 0,
      currentWeekExists: false,
    });
    expect(mock.calls.filter(c => c.table === 'activity_reports')).toHaveLength(
      0
    );
  });
});
