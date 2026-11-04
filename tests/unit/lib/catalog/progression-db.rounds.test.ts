/**
 * @jest-environment node
 */
import { getTableName, is } from 'drizzle-orm';
import { PgTable } from 'drizzle-orm/pg-core';

// loadCourseProgressions starts its queries as early as their input is known
// (three rounds to the database instead of four). The result must be the same as
// before, so the fixture below has a known answer; the order of the calls shows
// that the courses, the enablers and the profile run side by side and that the
// links do not wait for the catalogs and the enrollments.

const TRAINEE = '10000000-0000-4000-8000-000000000001';
const CATALOG = '00000000-0000-4000-8000-000000000002';

const rows: Record<string, any[]> = {
  courses: [{ id: 'c1', trainingCatalogId: CATALOG }],
  enablers: [
    { id: 'e1', title: 'Eins', courseId: 'c1', orderIndex: 1, isActive: true },
    { id: 'e2', title: 'Zwei', courseId: 'c1', orderIndex: 2, isActive: true },
    { id: 'e3', title: 'Aus', courseId: 'c1', orderIndex: 3, isActive: false },
  ],
  profiles: [{ createdAt: new Date('2026-08-01T00:00:00Z') }],
  training_catalogs: [{ id: CATALOG, settings: null }],
  trainee_enrollments: [
    { trainingCatalogId: CATALOG, createdAt: new Date('2026-08-01T00:00:00Z') },
  ],
  enabler_quiz_links: [
    { enablerId: 'e1', quizId: 'q1', difficulty: null },
    { enablerId: 'e2', quizId: 'q2', difficulty: null },
  ],
  quizzes: [
    { id: 'q1', isActive: true },
    { id: 'q2', isActive: true },
  ],
  // q1 passed, q2 attempted but below the passing score
  quiz_submissions: [
    { quizId: 'q1', score: 90 },
    { quizId: 'q2', score: 30 },
  ],
  trainee_enabler_overrides: [],
  questions: [
    { quizId: 'q1', questionType: 'MULTIPLE_CHOICE', hasExpectedAnswer: true },
    { quizId: 'q2', questionType: 'MULTIPLE_CHOICE', hasExpectedAnswer: true },
  ],
};

let events: string[];
let failTable: string | null;

function tableOf(t: unknown): string {
  return is(t as never, PgTable) ? getTableName(t as never) : 'unknown';
}

function makeDb() {
  // Like a drizzle query builder: it does nothing until it is awaited, and it
  // runs AGAIN for every then() or catch() on it
  const query = (columns: unknown) => ({
    from: (table: unknown) => {
      const name = tableOf(table);
      const run = () => {
        events.push(`start ${name}`);
        return new Promise<any[]>((resolve, reject) => {
          // one real tick per query, so queries that run side by side overlap
          setTimeout(() => {
            events.push(`end ${name}`);
            if (failTable === name) reject(new Error(`${name} failed`));
            else resolve(rows[name] ?? []);
          }, 5);
        });
      };
      const chain: any = {
        where: () => chain,
        then: (a: any, b: any) => run().then(a, b),
        catch: (b: any) => run().catch(b),
      };
      void columns;
      return chain;
    },
  });
  return { select: (columns: unknown) => query(columns) };
}

async function load() {
  jest.resetModules();
  events = [];
  failTable = null;
  jest.doMock('@/db', () => ({ __esModule: true, default: makeDb() }));
  return await import('@/lib/catalog/progression-db');
}

const at = (name: string) => events.indexOf(name);

describe('loadCourseProgressions', () => {
  it('gives the known answer of the fixture: one of two active enablers completed, the inactive one skipped', async () => {
    const { loadCourseProgressions } = await load();
    const result = await loadCourseProgressions(TRAINEE, ['c1']);
    const course = result.get('c1')!;
    expect(course.progression.totalCount).toBe(2);
    expect(course.progression.completedCount).toBe(1);
    expect(
      course.progression.enablers.map(e => [e.enablerId, e.completed])
    ).toEqual([
      ['e1', true],
      ['e2', false],
    ]);
    expect(course.enablers.map(e => e.id)).toEqual(['e1', 'e2', 'e3']);
    expect(course.quizLinks).toEqual([
      expect.objectContaining({
        enablerId: 'e1',
        quizId: 'q1',
        quizIsActive: true,
        gradable: true,
      }),
      expect.objectContaining({
        enablerId: 'e2',
        quizId: 'q2',
        quizIsActive: true,
        gradable: true,
      }),
    ]);
    expect(course.bestScores.get('q1')).toBe(90);
    expect(course.bestScores.get('q2')).toBe(30);
  });

  it('starts the courses, the enablers and the profile together, the links before the catalogs are done', async () => {
    const { loadCourseProgressions } = await load();
    await loadCourseProgressions(TRAINEE, ['c1']);
    // side by side: all three start before the first of them ends
    expect(at('start enablers')).toBeLessThan(at('end courses'));
    expect(at('start profiles')).toBeLessThan(at('end courses'));
    // the catalogs and the enrollments wait for the courses only
    expect(at('start training_catalogs')).toBeGreaterThan(at('end courses'));
    expect(at('start trainee_enrollments')).toBeGreaterThan(at('end courses'));
    // the links and the exceptions wait for the enablers only
    expect(at('start enabler_quiz_links')).toBeGreaterThan(at('end enablers'));
    expect(at('start trainee_enabler_overrides')).toBeGreaterThan(
      at('end enablers')
    );
    // the attempts need the links
    expect(at('start quiz_submissions')).toBeGreaterThan(
      at('end enabler_quiz_links')
    );
    expect(at('start quizzes')).toBeGreaterThan(at('end enabler_quiz_links'));
  });

  it('sends every query exactly once (a query builder runs again for each then or catch)', async () => {
    const { loadCourseProgressions } = await load();
    await loadCourseProgressions(TRAINEE, ['c1']);
    const starts = events.filter(e => e.startsWith('start '));
    expect(starts).toHaveLength(10);
    expect(new Set(starts).size).toBe(starts.length);
  });

  it('asks for nothing without courses', async () => {
    const { loadCourseProgressions } = await load();
    await expect(loadCourseProgressions(TRAINEE, [])).resolves.toEqual(
      new Map()
    );
    expect(events).toEqual([]);
  });

  it.each([
    'courses',
    'enablers',
    'profiles',
    'training_catalogs',
    'trainee_enabler_overrides',
    'quiz_submissions',
  ])(
    'a failed read of %s throws (a write guard must never go on a guess), with no unhandled rejection',
    async table => {
      const { loadCourseProgressions } = await load();
      failTable = table;
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', onUnhandled);
      await expect(loadCourseProgressions(TRAINEE, ['c1'])).rejects.toThrow(
        `${table} failed`
      );
      // let the rest of the queries finish and any unhandled rejection surface
      await new Promise(resolve => setTimeout(resolve, 50));
      process.off('unhandledRejection', onUnhandled);
      expect(unhandled).toEqual([]);
    }
  );
});
