/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  FIAE_CATALOG_ID,
  makeAuthedGet,
  mockCatalogScope,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';

// WMCNL-2964: "Statistiken" and "Letzte Aktivitäten" of the profile of a trainee
// showed fixed example values (12 modules, 8 certificates, 156 hours, 85 %).
// They come from the real data of the person now: only the own entries, only
// the occupation of the chosen tab, and nothing that the platform does not
// record (no certificates, no learning hours).

const NOW = Date.now();

async function load(
  tables: Record<string, any>,
  progression: { completedCount: number; totalCount: number }[] = [],
  session: ReturnType<typeof traineeSession> | null = traineeSession('u1')
) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockSession(session);
  mockCatalogScope();
  const loadCourseProgressions = jest.fn(
    async (_userId: string, _courseIds: string[]) =>
      new Map(
        progression.map((p, i) => [`c${i}`, { progression: p } as unknown])
      )
  );
  jest.doMock('@/lib/catalog/progression-db', () => ({
    __esModule: true,
    loadCourseProgressions,
  }));
  const mod = await import('@/app/api/trainee/profile-summary/route');
  return { mod, mock, loadCourseProgressions };
}

const get = (mod: { GET: (r: any) => Promise<Response> }) =>
  mod.GET(
    makeAuthedGet('http://localhost/api/trainee/profile-summary?userId=other')
  );

describe('GET /api/trainee/profile-summary', () => {
  beforeEach(() => jest.clearAllMocks());

  it('401 without a session', async () => {
    const { mod } = await load({}, [], null);
    expect((await get(mod)).status).toBe(401);
  });

  it('answers with the real figures and activities of the trainee', async () => {
    const { mod, loadCourseProgressions } = await load(
      {
        courseMembers: [{ id: 'c1' }, { id: 'c2' }],
        // one row serves the list of the passed quizzes and the activities (the
        // mock ignores conditions): two different quizzes, one passed twice
        quizSubmissions: [
          {
            id: 's1',
            quizId: 'qz1',
            traineeId: 'u1',
            title: 'HTML und CSS',
            score: 80,
            at: new Date(NOW - 60 * 60 * 1000),
          },
          {
            id: 's2',
            quizId: 'qz1',
            traineeId: 'u1',
            title: 'HTML und CSS',
            score: 90,
            at: new Date(NOW - 5 * 60 * 60 * 1000),
          },
          {
            id: 's3',
            quizId: 'qz2',
            traineeId: 'u1',
            title: 'Git',
            score: null,
            at: new Date(NOW - 3 * 60 * 60 * 1000),
          },
        ],
        useCaseSubmissions: [
          {
            id: 'us1',
            useCaseId: 'uc1',
            traineeId: 'u1',
            title: 'Use Case Eins',
            status: 'APPROVED',
            at: new Date(NOW - 24 * 60 * 60 * 1000),
          },
        ],
        enablerCompletions: [
          {
            enablerId: 'e1',
            traineeId: 'u1',
            title: 'Lektion Eins',
            at: new Date(NOW - 2 * 60 * 60 * 1000),
          },
        ],
      },
      [
        { completedCount: 3, totalCount: 10 },
        { completedCount: 1, totalCount: 5 },
      ]
    );
    const res = await get(mod);
    expect(res.status).toBe(200);
    const body = await res.json();

    // The progression of the courses of the session user, by the one definition
    // of the dashboard
    expect(loadCourseProgressions).toHaveBeenCalledWith('u1', ['c1', 'c2']);
    expect(body.stats).toEqual({
      lessonsCompleted: 4,
      lessonsTotal: 15,
      quizzesPassed: 2, // one quiz counts once
      useCasesApproved: 1,
    });
    // The newest first, as structured values (the page translates them)
    expect(
      body.recentActivities.map((a: any) => [a.activityType, a.itemTitle])
    ).toEqual([
      ['QUIZ_SUBMITTED', 'HTML und CSS'],
      ['LESSON_COMPLETED', 'Lektion Eins'],
      ['QUIZ_SUBMITTED', 'Git'],
      ['QUIZ_SUBMITTED', 'HTML und CSS'],
      ['USECASE_SUBMITTED', 'Use Case Eins'],
    ]);
    expect(body.recentActivities[0].score).toBe(80);
    expect(body.recentActivities[2].score).toBeNull();
    expect(body.recentActivities[4].status).toBe('APPROVED');
  });

  it('a trainee without any work sees zeros and no activities, not example values', async () => {
    const { mod } = await load({ courseMembers: [] });
    const body = await (await get(mod)).json();
    expect(body.stats).toEqual({
      lessonsCompleted: 0,
      lessonsTotal: 0,
      quizzesPassed: 0,
      useCasesApproved: 0,
    });
    expect(body.recentActivities).toEqual([]);
    const text = JSON.stringify(body);
    for (const fake of ['156', '85', 'JavaScript Grundlagen']) {
      expect(text).not.toContain(fake);
    }
  });

  it('reads only the own entries (a userId in the query is ignored) and only the occupation of the tab', async () => {
    const { mod, mock } = await load({ courseMembers: [] });
    await get(mod);
    for (const table of [
      'quiz_submissions',
      'use_case_submissions',
      'enabler_completions',
    ]) {
      const f = mock.filters('select', table);
      expect(f.params).toContain('u1');
      expect(f.params).not.toContain('other');
      // the catalog of the quiz, the use case and the course of the lesson
      expect(f.sql).toMatch(/training_catalog_id/);
      expect(f.params).toContain(FIAE_CATALOG_ID);
    }
    // the courses of the trainee are counted in the occupation as well
    expect(mock.filters('select', 'course_members').params).toContain('u1');
    expect(mock.filters('select', 'course_members').sql).toMatch(
      /training_catalog_id/
    );
  });

  it('a quiz counts as passed from the passing score of the platform', async () => {
    const { mod, mock } = await load({ courseMembers: [] });
    await get(mod);
    const f = mock.filters('select', 'quiz_submissions');
    expect(f.sql).toMatch(/"score" >= \$/);
    expect(f.params).toContain(50);
  });

  it('only an approved use case counts', async () => {
    const { mod, mock } = await load({ courseMembers: [] });
    await get(mod);
    expect(mock.filters('select', 'use_case_submissions').params).toContain(
      'APPROVED'
    );
  });
});
