/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  mockCatalogScope,
  mockTraineeSession,
} from '../../../helpers/mockNext';
import { progressionWorld } from '../../../helpers/progressionWorld';

// GET /api/trainee/lesson-quizzes: the quizzes of the Themenkreise (Niedrig,
// Mittel, Hoch) of the session user, so the page "Quizze & Tests" lists every
// quiz of the trainee (WMCNL-2938).

async function load(tables: Record<string, any>) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockTraineeSession('t1');
  mockCatalogScope();
  const mod = await import('@/app/api/trainee/lesson-quizzes/route');
  return { mock, GET: mod.GET };
}

const request = () =>
  ({ url: 'http://localhost/api/trainee/lesson-quizzes' }) as any;

describe('GET /api/trainee/lesson-quizzes', () => {
  beforeEach(() => jest.clearAllMocks());

  it('lists the quizzes of every Themenkreise in the order of work, with the lock', async () => {
    const { GET } = await load(progressionWorld({ enforced: true }));
    const res = await GET(request());
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(
      body.map((q: any) => [q.enablerId, q.difficulty, q.id, q.locked])
    ).toEqual([
      ['e1', 'LOW', 'q1', false],
      // e2 waits for the pass of e1
      ['e2', 'LOW', 'q2', true],
      ['e2', 'MEDIUM', 'q3', true],
    ]);
    expect(body[0]).toMatchObject({
      kind: 'LESSON',
      enablerTitle: 'Enabler Eins',
      courseTitle: 'Kurs',
    });
  });

  it('opens the next Themenkreis once the one before it is passed', async () => {
    const { GET } = await load(
      progressionWorld({ enforced: true, scores: { q1: 80 } })
    );
    const body = await (await GET(request())).json();
    expect(body.map((q: any) => q.locked)).toEqual([false, false, false]);
  });

  it('leaves an inactive Themenkreis out', async () => {
    const { GET } = await load(progressionWorld({ inactive: ['e2'] }));
    const body = await (await GET(request())).json();
    expect(body.map((q: any) => q.enablerId)).toEqual(['e1']);
  });

  it('is empty for a trainee without a course', async () => {
    const { GET } = await load({
      ...progressionWorld(),
      courseMembers: [],
    });
    const res = await GET(request());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual([]);
  });

  it('asks for the courses of the occupation that is chosen and of the session user only', async () => {
    const { mock, GET } = await load(progressionWorld());
    await GET(request());
    const courses = mock.filters('select', 'courses');
    expect(courses.sql).toContain('"is_active" = $');
    expect(courses.sql).toContain('training_catalog_id');
    const members = mock.filters('select', 'course_members');
    expect(members.params.map(String)).toContain('t1');
  });
});
