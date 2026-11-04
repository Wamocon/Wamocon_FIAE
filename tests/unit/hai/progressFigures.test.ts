/**
 * @jest-environment node
 */
import { createTableDb } from '../../helpers/mockDb';

// The progress figures of the HAI come from the helpers the pages use, not from
// the rows of enabler_completions (the quiz based completion does not write
// them, so counting them showed 0 % for every trainee, found on the real
// Preview). The database is a table mock that ignores where(), so the rendered
// condition is checked; the progression of the enablers is a double of
// loadCourseProgressions.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const USER = '10000000-0000-4000-8000-000000000001';

type Enabler = {
  id: string;
  title: string;
  completed: boolean;
  locked: boolean;
};

function progression(courseId: string, list: Enabler[]) {
  return {
    progression: {
      courseId,
      enforced: true,
      enablers: list.map(e => ({
        enablerId: e.id,
        state: e.completed ? 'completed' : 'open',
        completed: e.completed,
        locked: e.locked,
        lockReason: null,
        lockedBy: null,
        override: null,
      })),
      completedCount: list.filter(e => e.completed).length,
      totalCount: list.length,
    },
    enablers: list.map((e, i) => ({
      id: e.id,
      title: e.title,
      courseId,
      orderIndex: i,
      isActive: true,
    })),
    quizLinks: [],
    bestScores: new Map(),
  };
}

async function load(config: {
  courses: Array<Record<string, unknown>>;
  progressions?: Record<string, Enabler[]>;
  useCases?: Array<{ id: string; courseId: string }>;
  approved?: Array<{ useCaseId: string; courseId: string }>;
}) {
  jest.resetModules();
  const rec = createTableDb({
    courseMembers: config.courses,
    useCases: config.useCases ?? [],
    useCaseSubmissions: config.approved ?? [],
  });
  const loadCourseProgressions = jest.fn(
    async (_user: string, ids: string[]) =>
      new Map(
        ids
          .filter(id => config.progressions?.[id])
          .map(id => [id, progression(id, config.progressions![id])])
      )
  );
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  jest.doMock('@/lib/catalog/progression-db', () => ({
    __esModule: true,
    loadCourseProgressions,
  }));
  const mod = await import('@/lib/hai/progressFigures');
  return { mod, rec, loadCourseProgressions };
}

const course = (
  id: string,
  title: string,
  chapter: number,
  catalogId = FIAE
) => ({
  id,
  title,
  chapter,
  code: null,
  catalogId,
});

const done = (id: string, title = id): Enabler => ({
  id,
  title,
  completed: true,
  locked: false,
});
const open = (id: string, title = id, locked = false): Enabler => ({
  id,
  title,
  completed: false,
  locked,
});

beforeEach(() => jest.clearAllMocks());

describe('loadTraineeCourseFigures', () => {
  it('counts the enablers by the progression of the platform and weights the use cases like the course card', async () => {
    const { mod } = await load({
      courses: [course('c1', 'Datenbanken', 1)],
      progressions: {
        c1: [done('e1'), done('e2'), done('e3'), open('e4')],
      },
      useCases: [
        { id: 'u1', courseId: 'c1' },
        { id: 'u2', courseId: 'c1' },
      ],
      approved: [{ useCaseId: 'u1', courseId: 'c1' }],
    });
    const [figure] = await mod.loadTraineeCourseFigures(USER, [FIAE]);
    expect(figure).toMatchObject({
      courseId: 'c1',
      title: 'Datenbanken',
      enablerTotal: 4,
      enablerDone: 3,
      useCaseTotal: 2,
      useCaseDone: 1,
    });
    // 70 % of 3/4 and 30 % of 1/2: 0.675
    expect(figure.percent).toBe(68);
  });

  it('is not 0 % when the table enabler_completions is empty (the quiz based completion does not write it)', async () => {
    const { mod, rec } = await load({
      courses: [course('c1', 'Netzwerke', 1)],
      progressions: { c1: [done('e1'), done('e2'), open('e3'), open('e4')] },
    });
    const [figure] = await mod.loadTraineeCourseFigures(USER, [FIAE]);
    expect(figure.percent).toBe(50);
    expect(rec.calls.filter(c => c.table === 'enabler_completions')).toEqual(
      []
    );
  });

  it('puts the courses in the order of the training plan, not as the database returns them', async () => {
    const { mod } = await load({
      courses: [
        course('c10', 'Zehn', 10),
        course('c2', 'Zwei', 2),
        course('c1', 'Eins', 1),
      ],
      progressions: {
        c1: [open('a')],
        c2: [open('b')],
        c10: [open('c')],
      },
    });
    const figures = await mod.loadTraineeCourseFigures(USER, [FIAE]);
    expect(figures.map(f => f.title)).toEqual(['Eins', 'Zwei', 'Zehn']);
  });

  it('leaves out a course without an active enabler and without a use case', async () => {
    const { mod } = await load({
      courses: [course('c1', 'Leer', 1), course('c2', 'Mit Enabler', 2)],
      progressions: { c1: [], c2: [open('e1')] },
    });
    const figures = await mod.loadTraineeCourseFigures(USER, [FIAE]);
    expect(figures.map(f => f.title)).toEqual(['Mit Enabler']);
  });

  it('keeps a course with use cases only (the card shows it)', async () => {
    const { mod } = await load({
      courses: [course('c1', 'Nur Use Cases', 1)],
      progressions: { c1: [] },
      useCases: [{ id: 'u1', courseId: 'c1' }],
      approved: [{ useCaseId: 'u1', courseId: 'c1' }],
    });
    const [figure] = await mod.loadTraineeCourseFigures(USER, [FIAE]);
    expect(figure.enablerTotal).toBe(0);
    expect(figure.percent).toBe(100);
  });

  it('counts an approved use case once, however often it was submitted', async () => {
    const { mod } = await load({
      courses: [course('c1', 'Kurs', 1)],
      progressions: { c1: [open('e1')] },
      useCases: [
        { id: 'u1', courseId: 'c1' },
        { id: 'u2', courseId: 'c1' },
      ],
      approved: [
        { useCaseId: 'u1', courseId: 'c1' },
        { useCaseId: 'u1', courseId: 'c1' },
      ],
    });
    const [figure] = await mod.loadTraineeCourseFigures(USER, [FIAE]);
    expect(figure.useCaseDone).toBe(1);
  });

  it('asks for the given occupations only (the courses of another occupation never appear)', async () => {
    const { mod, rec } = await load({
      courses: [course('c1', 'Kurs', 1, KFBM)],
      progressions: { c1: [open('e1')] },
    });
    await mod.loadTraineeCourseFigures(USER, [KFBM]);
    const filter = rec.filters('select', 'course_members');
    expect(filter.params).toContain(KFBM);
    expect(filter.params).not.toContain(FIAE);
    expect(filter.params).toContain(USER);
    expect(filter.sql).toContain('"courses"."is_active" = $');
  });

  it('reads nothing without an occupation (fail closed)', async () => {
    const { mod, rec, loadCourseProgressions } = await load({
      courses: [course('c1', 'Kurs', 1)],
      progressions: { c1: [open('e1')] },
    });
    await expect(mod.loadTraineeCourseFigures(USER, [])).resolves.toEqual([]);
    expect(rec.calls).toEqual([]);
    expect(loadCourseProgressions).not.toHaveBeenCalled();
  });

  it('gives no courses, and asks for no progression, when the person has none', async () => {
    const { mod, loadCourseProgressions } = await load({ courses: [] });
    await expect(mod.loadTraineeCourseFigures(USER, [FIAE])).resolves.toEqual(
      []
    );
    expect(loadCourseProgressions).not.toHaveBeenCalled();
  });

  it('a failed read throws, it is no empty list', async () => {
    const { mod, loadCourseProgressions } = await load({
      courses: [course('c1', 'Kurs', 1)],
    });
    loadCourseProgressions.mockRejectedValueOnce(new Error('db down'));
    await expect(mod.loadTraineeCourseFigures(USER, [FIAE])).rejects.toThrow(
      'db down'
    );
  });
});

describe('firstOpenEnabler', () => {
  const figure = (title: string, list: Enabler[]) =>
    ({
      courseId: title,
      title,
      catalogId: FIAE,
      enablerTotal: list.length,
      enablerDone: 0,
      useCaseTotal: 0,
      useCaseDone: 0,
      percent: 0,
      enablers: list,
    }) as any;

  it('is the first enabler that is not completed and not locked, in the order of the plan', async () => {
    const { mod } = await load({ courses: [] });
    const found = mod.firstOpenEnabler([
      figure('Eins', [done('a'), open('b', 'Gesperrt', true)]),
      figure('Zwei', [open('c', 'Das ist es'), open('d')]),
    ]);
    expect(found?.enabler.title).toBe('Das ist es');
    expect(found?.course.title).toBe('Zwei');
  });

  it('is null when everything is completed or locked', async () => {
    const { mod } = await load({ courses: [] });
    expect(
      mod.firstOpenEnabler([figure('Eins', [done('a'), open('b', 'x', true)])])
    ).toBeNull();
    expect(mod.firstOpenEnabler([])).toBeNull();
  });
});
