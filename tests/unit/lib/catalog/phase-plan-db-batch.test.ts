/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

// loadPhasePlansForUsers: the phase plans of many trainees in two queries (the
// trainer lists, KfBM S4b). Same rule as the scope of one trainee: the
// occupation of the latest enrollment, FIAE without an enrollment.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

const catalogs = [
  { id: FIAE, settings: { phase_months: [18, 18] } },
  { id: KFBM, settings: { phase_months: [15, 21] } },
];

async function load(tables: Record<string, any>, db?: any) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: db ?? mock.db }));
  const mod = await import('@/lib/catalog/phase-plan-db');
  return { mod, mock };
}

describe('loadPhasePlansForUsers', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  it('gives each trainee the plan of the occupation they are enrolled in', async () => {
    const { mod } = await load({
      traineeEnrollments: [
        { traineeId: 'k1', trainingCatalogId: KFBM, startDate: '2026-08-01' },
        { traineeId: 'f1', trainingCatalogId: FIAE, startDate: '2026-08-01' },
      ],
      trainingCatalogs: catalogs,
    });
    const plans = await mod.loadPhasePlansForUsers([
      { id: 'k1', durationYears: 3 },
      { id: 'f1', durationYears: 3 },
    ]);
    expect(plans.get('k1')?.phaseMonths).toEqual([15, 21]);
    expect(plans.get('f1')?.phaseMonths).toEqual([18, 18]);
  });

  it('uses the duration of each trainee (KfBM shortened is 10 + 14)', async () => {
    const { mod } = await load({
      traineeEnrollments: [
        { traineeId: 'k1', trainingCatalogId: KFBM, startDate: '2026-08-01' },
        { traineeId: 'f1', trainingCatalogId: FIAE, startDate: '2026-08-01' },
      ],
      trainingCatalogs: catalogs,
    });
    const plans = await mod.loadPhasePlansForUsers([
      { id: 'k1', durationYears: 2 },
      { id: 'f1', durationYears: 2 },
    ]);
    expect(plans.get('k1')?.phaseMonths).toEqual([10, 14]);
    expect(plans.get('f1')?.phaseMonths).toEqual([12, 12]);
  });

  it('gives a trainee without an enrollment the FIAE plan, as the catalog scope does', async () => {
    const { mod } = await load({
      traineeEnrollments: [],
      trainingCatalogs: catalogs,
    });
    const plans = await mod.loadPhasePlansForUsers([
      { id: 'legacy', durationYears: 3 },
    ]);
    expect(plans.get('legacy')?.phaseMonths).toEqual([18, 18]);
  });

  it('reads the FIAE settings, not a fixed value, for a trainee without an enrollment', async () => {
    const { mod, mock } = await load({
      traineeEnrollments: [],
      trainingCatalogs: [{ id: FIAE, settings: { phase_months: [16, 20] } }],
    });
    const plans = await mod.loadPhasePlansForUsers([
      { id: 'legacy', durationYears: 3 },
    ]);
    expect(plans.get('legacy')?.phaseMonths).toEqual([16, 20]);
    expect(mock.filters('select', 'training_catalogs').params).toContain(FIAE);
  });

  it('takes the enrollment that started last', async () => {
    const { mod } = await load({
      traineeEnrollments: [
        { traineeId: 't1', trainingCatalogId: FIAE, startDate: '2024-08-01' },
        { traineeId: 't1', trainingCatalogId: KFBM, startDate: '2026-08-01' },
      ],
      trainingCatalogs: catalogs,
    });
    const plans = await mod.loadPhasePlansForUsers([
      { id: 't1', durationYears: 3 },
    ]);
    expect(plans.get('t1')?.phaseMonths).toEqual([15, 21]);
  });

  it('asks for the enrollments of the listed trainees and the catalogs in use, nothing else', async () => {
    const { mod, mock } = await load({
      traineeEnrollments: [
        { traineeId: 'k1', trainingCatalogId: KFBM, startDate: '2026-08-01' },
      ],
      trainingCatalogs: catalogs,
    });
    await mod.loadPhasePlansForUsers([
      { id: 'k1', durationYears: 3 },
      { id: 'k2', durationYears: 3 },
    ]);
    expect(mock.calls.filter(c => c.op === 'select')).toHaveLength(2);
    const enrollments = mock.filters('select', 'trainee_enrollments');
    expect(enrollments.params).toEqual(expect.arrayContaining(['k1', 'k2']));
    expect(mock.filters('select', 'training_catalogs').params).toEqual(
      expect.arrayContaining([KFBM, FIAE])
    );
  });

  it('reads from the database it is given and leaves the main one alone (HAI)', async () => {
    const { mod, mock: main } = await load({
      traineeEnrollments: [],
      trainingCatalogs: [],
    });
    const other = createTableDb({
      traineeEnrollments: [
        { traineeId: 'k1', trainingCatalogId: KFBM, startDate: '2026-08-01' },
      ],
      trainingCatalogs: catalogs,
    });
    const plans = await mod.loadPhasePlansForUsers(
      [{ id: 'k1', durationYears: 3 }],
      other.db
    );
    expect(plans.get('k1')?.phaseMonths).toEqual([15, 21]);
    expect(main.calls).toHaveLength(0);
    expect(other.calls.length).toBeGreaterThan(0);
  });

  it('known difference to the scope of one trainee: it ignores whether the occupation is active or enabled for the organization', async () => {
    // The scope would skip an inactive catalog (and then fall back to 18 + 18),
    // the list takes the occupation the trainee is enrolled in.
    const { mod } = await load({
      traineeEnrollments: [
        { traineeId: 'k1', trainingCatalogId: KFBM, startDate: '2026-08-01' },
      ],
      trainingCatalogs: [
        { id: KFBM, isActive: false, settings: { phase_months: [15, 21] } },
      ],
      organizationCatalogs: [],
    });
    const plans = await mod.loadPhasePlansForUsers([
      { id: 'k1', durationYears: 3 },
    ]);
    expect(plans.get('k1')?.phaseMonths).toEqual([15, 21]);
  });

  it('does not query for an empty list', async () => {
    const { mod, mock } = await load({});
    expect((await mod.loadPhasePlansForUsers([])).size).toBe(0);
    expect(mock.calls).toHaveLength(0);
  });

  it('gives every listed trainee a plan, also with a missing catalog row', async () => {
    const { mod } = await load({
      traineeEnrollments: [
        { traineeId: 'k1', trainingCatalogId: KFBM, startDate: '2026-08-01' },
      ],
      trainingCatalogs: [],
    });
    const plans = await mod.loadPhasePlansForUsers([
      { id: 'k1', durationYears: 3 },
      { id: 'k2', durationYears: 2 },
    ]);
    expect(plans.get('k1')?.phaseMonths).toEqual([18, 18]);
    expect(plans.get('k2')?.phaseMonths).toEqual([12, 12]);
  });

  it('does not throw when the lookup fails and uses the previous lengths', async () => {
    const failing = {
      select: () => {
        throw new Error('relation does not exist');
      },
    };
    const { mod } = await load({}, failing);
    const plans = await mod.loadPhasePlansForUsers([
      { id: 'k1', durationYears: 3 },
      { id: 'k2', durationYears: 2 },
    ]);
    expect(plans.get('k1')?.phaseMonths).toEqual([18, 18]);
    expect(plans.get('k2')?.phaseMonths).toEqual([12, 12]);
    expect(console.error).toHaveBeenCalled();
  });
});
