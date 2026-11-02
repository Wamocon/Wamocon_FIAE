/**
 * @jest-environment node
 */
import { createTableDb } from '../../helpers/mockDb';

// The database side of the navigation: the records a trainee may be taken to
// are limited to the catalogs of the person, active records and the courses the
// trainee is a member of. The helper of the order of work is replaced here, its
// own tests are in the progression tests.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const USER = '10000000-0000-4000-8000-000000000001';

const mockProgressions = jest.fn();
const mockEnablerProgression = jest.fn();

async function load(tables: Record<string, any[]>) {
  jest.resetModules();
  const rec = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  jest.doMock('@/lib/catalog/progression-db', () => ({
    __esModule: true,
    loadCourseProgressions: (...args: unknown[]) => mockProgressions(...args),
    getEnablerProgression: (...args: unknown[]) =>
      mockEnablerProgression(...args),
  }));
  const data = await import('@/lib/hai/navigation/data');
  return { rec, data };
}

beforeEach(() => jest.clearAllMocks());

describe('loadTraineeEnablers and loadTraineeUseCases', () => {
  it('limits the query to the catalogs, active records and active courses', async () => {
    const { rec, data } = await load({
      enablers: [
        {
          id: 'e1',
          title: 'SQL',
          code: '1a',
          courseId: 'c1',
          courseTitle: 'Datenbanken',
        },
      ],
    });
    const result = await data.loadTraineeEnablers(USER, [FIAE]);
    expect(result).toEqual([
      {
        id: 'e1',
        title: 'SQL',
        code: '1a',
        courseId: 'c1',
        courseTitle: 'Datenbanken',
      },
    ]);
    const { sql, params } = rec.filters('select', 'enablers');
    expect(sql).toContain('"is_active"');
    expect(sql).toContain('"training_catalog_id" in');
    expect(params).toContain(FIAE);
    expect(params).not.toContain(KFBM);
  });

  it('keeps the trainee a member of the course (join on the user id)', async () => {
    const { rec, data } = await load({ use_cases: [] });
    await data.loadTraineeUseCases(USER, [FIAE, KFBM]);
    const call = rec.calls.find(c => c.table === 'use_cases');
    expect(call).toBeDefined();
    const { params } = rec.filters('select', 'use_cases');
    expect(params).toEqual(expect.arrayContaining([FIAE, KFBM]));
  });

  it('asks nothing for a person without a catalog (fail closed)', async () => {
    const { rec, data } = await load({ enablers: [{ id: 'x' }] });
    expect(await data.loadTraineeEnablers(USER, [])).toEqual([]);
    expect(await data.loadTraineeUseCases(USER, [])).toEqual([]);
    expect(await data.loadNextStepEntries(USER, [])).toEqual([]);
    expect(rec.db.select).not.toHaveBeenCalled();
  });

  it('maps a record without a code to null', async () => {
    const { data } = await load({
      use_cases: [
        {
          id: 'u1',
          title: 'Bestellsystem',
          code: null,
          courseId: 'c1',
          courseTitle: 'K',
        },
      ],
    });
    const [row] = await data.loadTraineeUseCases(USER, [FIAE]);
    expect(row.code).toBeNull();
  });
});

describe('loadEnablerLock', () => {
  it('reads the lock and the quizzes from the helper of the order of work', async () => {
    const { data } = await load({});
    mockEnablerProgression.mockResolvedValue({
      enabler: {
        locked: true,
        lockedBy: { enablerId: 'e0', title: 'Enabler 2' },
      },
      loaded: {
        quizLinks: [
          { enablerId: 'e1', quizIsActive: true },
          { enablerId: 'other', quizIsActive: true },
        ],
      },
    });
    expect(
      await data.loadEnablerLock(USER, { id: 'e1', courseId: 'c1' })
    ).toEqual({
      locked: true,
      lockedByTitle: 'Enabler 2',
      hasActiveQuiz: true,
    });
    expect(mockEnablerProgression).toHaveBeenCalledWith(USER, {
      id: 'e1',
      courseId: 'c1',
    });
  });

  it('counts only active quizzes of this enabler and knows a manual lock', async () => {
    const { data } = await load({});
    mockEnablerProgression.mockResolvedValue({
      enabler: { locked: false, lockedBy: null },
      loaded: {
        quizLinks: [
          { enablerId: 'e1', quizIsActive: false },
          { enablerId: 'other', quizIsActive: true },
        ],
      },
    });
    expect(
      await data.loadEnablerLock(USER, { id: 'e1', courseId: 'c1' })
    ).toEqual({
      locked: false,
      lockedByTitle: null,
      hasActiveQuiz: false,
    });
  });

  it('answers null when the enabler is not active for the trainee', async () => {
    const { data } = await load({});
    mockEnablerProgression.mockResolvedValue(null);
    expect(
      await data.loadEnablerLock(USER, { id: 'e1', courseId: 'c1' })
    ).toBeNull();
  });
});

describe('loadNextStepEntries', () => {
  it('builds the entries from the courses and the order of work', async () => {
    const { rec, data } = await load({
      course_members: [
        { id: 'c1', title: 'Datenbanken', year: 1, chapter: 2 },
        { id: 'c2', title: 'Netzwerke', year: null, chapter: null },
      ],
    });
    mockProgressions.mockResolvedValue(
      new Map([
        [
          'c1',
          {
            enablers: [
              {
                id: 'e1',
                title: 'SQL',
                courseId: 'c1',
                orderIndex: 3,
                isActive: true,
              },
            ],
            progression: {
              enablers: [
                { enablerId: 'e1', completed: false, locked: true },
                { enablerId: 'ghost', completed: false, locked: false },
              ],
            },
          },
        ],
      ])
    );
    const entries = await data.loadNextStepEntries(USER, [FIAE]);
    // a course without a loaded progression and a state without an enabler are skipped
    expect(entries).toEqual([
      {
        enablerId: 'e1',
        title: 'SQL',
        courseTitle: 'Datenbanken',
        stage: 1,
        chapter: 2,
        orderIndex: 3,
        completed: false,
        locked: true,
      },
    ]);
    expect(mockProgressions).toHaveBeenCalledWith(USER, ['c1', 'c2']);
    const { params } = rec.filters('select', 'course_members');
    expect(params).toContain(FIAE);
  });

  it('answers an empty list for a trainee without courses', async () => {
    const { data } = await load({ course_members: [] });
    expect(await data.loadNextStepEntries(USER, [FIAE])).toEqual([]);
    expect(mockProgressions).not.toHaveBeenCalled();
  });
});
