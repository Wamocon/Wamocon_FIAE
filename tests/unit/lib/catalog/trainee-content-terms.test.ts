/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';

// The assignment by phase plan runs per ENROLLMENT: a trainee in two trainings
// gets the content of the current phase of each training, counted with the
// start date and duration of that enrollment. The first enrollment follows the
// profile (as it always did), a further one has its own terms.

const KFBM = '00000000-0000-4000-8000-000000000002';
const FIAE = '00000000-0000-4000-8000-000000000001';
const ORG = '11111111-1111-4111-8111-111111111111';
const NOW = new Date('2026-10-28T08:00:00Z');

const settings = { phase_months: [15, 21] };

const components = [
  { id: 'c1', kind: 'pflicht', phase: 1, orderIndex: 1 },
  { id: 'c2', kind: 'pflicht', phase: 2, orderIndex: 13 },
];
const courses = [
  { id: 'course1', trainingComponentId: 'c1' },
  { id: 'course2', trainingComponentId: 'c2' },
];

const trainee = (extra: Record<string, unknown>) => ({
  traineeId: 't1',
  organizationId: ORG,
  enrollmentId: 'e-kfbm',
  enrollmentStart: null,
  enrollmentDuration: 3,
  profileStart: '2024-01-01', // 34 months before NOW: phase 2 of KfBM
  profileDuration: 3,
  ...extra,
});

async function run(options: {
  catalogId: string;
  enrolled: Record<string, unknown>[];
  siblings: Record<string, unknown>[];
}) {
  jest.resetModules();
  const mock = createTableDb({
    trainingCatalogs: [{ id: options.catalogId, code: 'X', settings }],
    traineeEnrollments: { sequence: [options.enrolled, options.siblings] },
    trainingComponents: components,
    courses,
    quizzes: [],
    traineeElectiveChoices: [],
    courseMembers: [],
    quizAssignments: [],
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const mod = await import('@/lib/catalog/trainee-content');
  const summary = await mod.syncCatalogTraineeContent(mock.db, {
    catalogId: options.catalogId,
    actorId: 'admin',
    execute: false,
    now: NOW,
  });
  return { summary, mock };
}

describe('assignment by phase plan, per enrollment', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a trainee with one enrollment follows the profile, as before', async () => {
    const { summary } = await run({
      catalogId: KFBM,
      enrolled: [trainee({ enrollmentStart: '2026-09-01' })],
      siblings: [
        {
          traineeId: 't1',
          trainingCatalogId: KFBM,
          startDate: '2026-09-01',
          createdAt: new Date('2026-09-01'),
        },
      ],
    });
    // the profile says phase 2, the (copied) start date of the row is ignored
    expect(summary?.details[0].phase).toBe(2);
    expect(summary?.courseMembersMissing).toBe(1);
  });

  it('the first enrollment follows the profile even if there is a second one', async () => {
    const { summary } = await run({
      catalogId: KFBM,
      enrolled: [trainee({ enrollmentStart: '2026-09-01' })],
      siblings: [
        {
          traineeId: 't1',
          trainingCatalogId: KFBM,
          startDate: '2026-09-01',
          createdAt: new Date('2026-09-01'),
        },
        {
          traineeId: 't1',
          trainingCatalogId: FIAE,
          startDate: '2024-01-01',
          createdAt: new Date('2026-10-01'),
        },
      ],
    });
    expect(summary?.details[0].phase).toBe(2);
  });

  it('a further enrollment is counted with its own start date, not the one of the profile', async () => {
    const { summary } = await run({
      catalogId: KFBM,
      enrolled: [trainee({ enrollmentStart: '2026-09-01' })],
      siblings: [
        {
          traineeId: 't1',
          trainingCatalogId: FIAE,
          startDate: '2024-01-01',
          createdAt: new Date('2026-09-01'),
        },
        {
          traineeId: 't1',
          trainingCatalogId: KFBM,
          startDate: '2026-09-01',
          createdAt: new Date('2026-10-01'),
        },
      ],
    });
    // started in September 2026: still phase 1 of KfBM
    expect(summary?.details[0].phase).toBe(1);
    expect(summary?.courseMembersMissing).toBe(1);
  });

  it('a further enrollment is counted with its own duration', async () => {
    const { summary } = await run({
      catalogId: KFBM,
      // 13 months after its start: phase 2 of the shortened KfBM plan (10 months
      // of phase 1), but still phase 1 of the 3 year plan (15 months)
      enrolled: [
        trainee({
          enrollmentStart: '2025-09-28',
          enrollmentDuration: 2,
          profileDuration: 3,
        }),
      ],
      siblings: [
        {
          traineeId: 't1',
          trainingCatalogId: FIAE,
          startDate: '2024-01-01',
          createdAt: new Date('2026-09-01'),
        },
        {
          traineeId: 't1',
          trainingCatalogId: KFBM,
          startDate: '2025-09-28',
          createdAt: new Date('2026-10-01'),
        },
      ],
    });
    expect(summary?.details[0].phase).toBe(2);
  });

  it('a further enrollment without a start date uses the one of the profile', async () => {
    const { summary } = await run({
      catalogId: KFBM,
      enrolled: [trainee({ enrollmentStart: null })],
      siblings: [
        {
          traineeId: 't1',
          trainingCatalogId: FIAE,
          startDate: '2024-01-01',
          createdAt: new Date('2026-09-01'),
        },
        {
          traineeId: 't1',
          trainingCatalogId: KFBM,
          startDate: null,
          createdAt: new Date('2026-10-01'),
        },
      ],
    });
    expect(summary?.details[0].phase).toBe(2);
  });

  it('asks for all enrollments of the trainees it handles, nothing else', async () => {
    const { mock } = await run({
      catalogId: KFBM,
      enrolled: [trainee({})],
      siblings: [
        {
          traineeId: 't1',
          trainingCatalogId: KFBM,
          startDate: null,
          createdAt: new Date('2026-09-01'),
        },
      ],
    });
    const reads = mock.calls.filter(
      c => c.op === 'select' && c.table === 'trainee_enrollments'
    );
    expect(reads).toHaveLength(2);
    expect(mock.filters('select', 'trainee_enrollments').params).toEqual(
      expect.arrayContaining([KFBM, 't1'])
    );
    // a trial run writes nothing
    expect(mock.calls.filter(c => c.op !== 'select')).toHaveLength(0);
  });
});
