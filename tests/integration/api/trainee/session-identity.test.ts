/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb, renderCondition } from '../../../helpers/mockDb';
import {
  FIAE_CATALOG_ID,
  makeRequest,
  mockSession,
  traineeSession,
} from '../../../helpers/mockNext';

// The routes of a trainee under /api/trainee work on the data of the signed-in
// user only. The identity is the bearer session, a userId or traineeId in the
// query or in the body (older clients still send one) is ignored. 401 and 403
// of the session layer run for every handler in route-guards.test.ts. The table
// mock ignores where(), so the tests read the rendered conditions, the written
// values and the arguments of the catalog scope lookups.

const ME = 't1';
const OTHER = 't2';
const ORG = 'org-1';

const scope = {
  allowedCatalogIds: [FIAE_CATALOG_ID],
  activeCatalogId: FIAE_CATALOG_ID,
  selected: false,
};

type Tables = Record<string, any>;
type Method = 'GET' | 'POST' | 'PATCH' | 'DELETE';

type Case = {
  name: string;
  route: string;
  method: Method;
  /** Path and query, the query names the other person. */
  url: string;
  /** The body names the other person too. */
  body?: unknown;
  params?: Record<string, string>;
  tables?: Tables;
};

async function load(c: Case, session = traineeSession(ME)) {
  jest.resetModules();
  mockSession(session);
  const mock = createTableDb(c.tables ?? {});
  const forUser = jest.fn(async (..._args: any[]) => scope);
  const content = jest.fn(async (..._args: any[]) => scope);
  const getUserOrgId = jest.fn(async (_id: string) => ORG);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({ __esModule: true, getUserOrgId }));
  jest.doMock('@/lib/catalog/scope', () => {
    const actual = jest.requireActual('@/lib/catalog/scope') as any;
    return {
      ...actual,
      requireCatalogScopeForUser: forUser,
      requireContentScopeForUser: content,
    };
  });
  const mod = await import(`@/app/api/${c.route}/route`);
  const req = makeRequest(c.method, `http://localhost${c.url}`, {
    token: 'tok',
    body: c.body,
  });
  const res: Response = await mod[c.method](req, {
    params: Promise.resolve(c.params ?? {}),
  });
  return { res, mock, forUser, content, getUserOrgId };
}

/** Everything the route asked the database for or wrote, as one string. */
function touched(mock: ReturnType<typeof createTableDb>) {
  const params = mock.calls.flatMap(call =>
    (call.where ?? []).flatMap(w => renderCondition(w).params)
  );
  const values = mock.calls.map(call => call.values ?? null);
  return JSON.stringify({ params, values });
}

const ident = (extra: Record<string, unknown> = {}) => ({
  traineeId: OTHER,
  trainee_id: OTHER,
  userId: OTHER,
  ...extra,
});

const answers = [{ questionId: 'q1', selectedOptionId: 'o1' }];

const CASES: Case[] = [
  {
    name: 'annual-summary',
    route: 'trainee/annual-summary',
    method: 'GET',
    url: `/api/trainee/annual-summary?traineeId=${OTHER}`,
  },
  {
    name: 'evaluations list',
    route: 'trainee/evaluations',
    method: 'GET',
    url: `/api/trainee/evaluations?userId=${OTHER}`,
  },
  {
    name: 'evaluations self-assessment',
    route: 'trainee/evaluations',
    method: 'POST',
    url: '/api/trainee/evaluations',
    body: ident({ weekNumber: 3, year: 2027, ausbildungsjahr: 1 }),
  },
  {
    name: 'feedback',
    route: 'trainee/feedback',
    method: 'GET',
    url: `/api/trainee/feedback?traineeId=${OTHER}`,
  },
  {
    name: 'knowledge-notes list',
    route: 'trainee/knowledge-notes',
    method: 'GET',
    url: `/api/trainee/knowledge-notes?traineeId=${OTHER}`,
  },
  {
    name: 'knowledge-notes create',
    route: 'trainee/knowledge-notes',
    method: 'POST',
    url: '/api/trainee/knowledge-notes',
    body: ident({ title: 'T', content: 'C' }),
  },
  {
    name: 'knowledge-notes delete',
    route: 'trainee/knowledge-notes/[noteId]',
    method: 'DELETE',
    url: `/api/trainee/knowledge-notes/n1?traineeId=${OTHER}`,
    params: { noteId: 'n1' },
  },
  {
    name: 'knowledge-notes patch',
    route: 'trainee/knowledge-notes/[noteId]',
    method: 'PATCH',
    url: '/api/trainee/knowledge-notes/n1',
    body: ident({ title: 'New' }),
    params: { noteId: 'n1' },
  },
  {
    name: 'lesson-progress',
    route: 'trainee/lesson-progress',
    method: 'GET',
    url: `/api/trainee/lesson-progress?userId=${OTHER}&lessonId=l1`,
    tables: { subLessons: [{ id: 's1' }] },
  },
  {
    name: 'lessons',
    route: 'trainee/lessons',
    method: 'GET',
    url: `/api/trainee/lessons?userId=${OTHER}`,
    tables: {
      lessons: [{ id: 'l1', title: 'L', module_id: 'm1' }],
      modules: [{ id: 'm1', title: 'M' }],
      subLessons: [{ id: 's1', lessonId: 'l1' }],
    },
  },
  {
    name: 'progress toggle (done)',
    route: 'trainee/progress',
    method: 'POST',
    url: '/api/trainee/progress',
    body: ident({ subLessonId: 's1', completed: true }),
  },
  {
    name: 'progress toggle (open)',
    route: 'trainee/progress',
    method: 'POST',
    url: '/api/trainee/progress',
    body: ident({ subLessonId: 's1', completed: false }),
  },
];

const SCOPED: Case[] = [
  {
    name: 'courses',
    route: 'trainee/courses',
    method: 'GET',
    url: `/api/trainee/courses?traineeId=${OTHER}`,
  },
  {
    name: 'courses detail',
    route: 'trainee/courses/[courseId]',
    method: 'GET',
    url: `/api/trainee/courses/c1?traineeId=${OTHER}`,
    params: { courseId: 'c1' },
  },
  {
    name: 'dashboard',
    route: 'trainee/dashboard',
    method: 'GET',
    url: `/api/trainee/dashboard?userId=${OTHER}`,
  },
  {
    name: 'quizzes',
    route: 'trainee/quizzes',
    method: 'GET',
    url: `/api/trainee/quizzes?userId=${OTHER}`,
  },
  {
    name: 'use-case-hours',
    route: 'trainee/use-case-hours',
    method: 'GET',
    url: `/api/trainee/use-case-hours?traineeId=${OTHER}`,
  },
  {
    name: 'enabler detail',
    route: 'trainee/enablers/[enablerId]',
    method: 'GET',
    url: `/api/trainee/enablers/e1?traineeId=${OTHER}`,
    params: { enablerId: 'e1' },
  },
  {
    name: 'enabler quiz',
    route: 'trainee/enablers/[enablerId]/quiz',
    method: 'GET',
    url: `/api/trainee/enablers/e1/quiz?traineeId=${OTHER}`,
    params: { enablerId: 'e1' },
  },
  {
    name: 'enabler quiz submit',
    route: 'trainee/enablers/[enablerId]/quiz/submit',
    method: 'POST',
    url: '/api/trainee/enablers/e1/quiz/submit',
    body: ident({ answers }),
    params: { enablerId: 'e1' },
  },
  {
    name: 'enabler quizzes',
    route: 'trainee/enablers/[enablerId]/quizzes',
    method: 'GET',
    url: `/api/trainee/enablers/e1/quizzes?traineeId=${OTHER}`,
    params: { enablerId: 'e1' },
  },
  {
    name: 'enabler quiz by difficulty',
    route: 'trainee/enablers/[enablerId]/quizzes/[difficulty]',
    method: 'GET',
    url: `/api/trainee/enablers/e1/quizzes/EASY?traineeId=${OTHER}`,
    params: { enablerId: 'e1', difficulty: 'EASY' },
  },
  {
    name: 'enabler submit',
    route: 'trainee/enablers/[enablerId]/submit',
    method: 'POST',
    url: '/api/trainee/enablers/e1/submit',
    body: ident({ solutionText: 'x' }),
    params: { enablerId: 'e1' },
  },
  {
    name: 'quiz submit',
    route: 'trainee/quizzes/[quizId]/submit',
    method: 'POST',
    url: '/api/trainee/quizzes/q1/submit',
    body: ident({ answers }),
    params: { quizId: 'q1' },
  },
  {
    name: 'quiz review',
    route: 'trainee/quizzes/[quizId]/submit',
    method: 'GET',
    url: `/api/trainee/quizzes/q1/submit?traineeId=${OTHER}`,
    params: { quizId: 'q1' },
  },
  {
    name: 'use case detail',
    route: 'trainee/use-cases/[useCaseId]',
    method: 'GET',
    url: `/api/trainee/use-cases/u1?traineeId=${OTHER}`,
    params: { useCaseId: 'u1' },
  },
  {
    name: 'use case documents',
    route: 'trainee/use-cases/[useCaseId]/documents',
    method: 'GET',
    url: `/api/trainee/use-cases/u1/documents?traineeId=${OTHER}`,
    params: { useCaseId: 'u1' },
  },
  {
    name: 'use case submit',
    route: 'trainee/use-cases/[useCaseId]/submit',
    method: 'POST',
    url: '/api/trainee/use-cases/u1/submit',
    body: ident({ submissionText: 'x' }),
    params: { useCaseId: 'u1' },
  },
];

describe('trainee routes: the session is the only identity', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  });

  describe.each(CASES)('$name', c => {
    it('works on the data of the session user, never on the named person', async () => {
      const { mock, getUserOrgId } = await load(c);
      const text = touched(mock);
      expect(text).not.toContain(OTHER);
      expect(text).toContain(ME);
      for (const call of getUserOrgId.mock.calls) {
        expect(call).toEqual([ME]);
      }
    });
  });

  describe.each(SCOPED)('$name (catalog scope)', c => {
    it('checks the occupation of the session user and touches nobody else', async () => {
      const { mock, forUser, content, getUserOrgId } = await load(c);
      const lookups = [...forUser.mock.calls, ...content.mock.calls];
      // The catalog check ran for the session user and for nobody else
      expect(lookups.length).toBeGreaterThan(0);
      for (const call of lookups) expect(call[0]).toBe(ME);
      expect(touched(mock)).not.toContain(OTHER);
      for (const call of getUserOrgId.mock.calls) {
        expect(call).toEqual([ME]);
      }
    });

    it('answers an anonymous caller before any catalog check', async () => {
      jest.resetModules();
      mockSession(null);
      const mock = createTableDb();
      const forUser = jest.fn(async () => scope);
      jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
      jest.doMock('@/lib/catalog/scope', () => {
        const actual = jest.requireActual('@/lib/catalog/scope') as any;
        return {
          ...actual,
          requireCatalogScopeForUser: forUser,
          requireContentScopeForUser: forUser,
        };
      });
      const mod = await import(`@/app/api/${c.route}/route`);
      const res: Response = await mod[c.method](
        makeRequest(c.method, `http://localhost${c.url}`, { body: c.body }),
        { params: Promise.resolve(c.params ?? {}) }
      );
      expect(res.status).toBe(401);
      expect(forUser).not.toHaveBeenCalled();
      expect(mock.db.select).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('trainer level: read only, inside the organization scope', () => {
    const TRAINEE_UUID = '22222222-2222-4222-8222-222222222222';
    const trainer = {
      ...traineeSession('trainer-1'),
      role: 'TRAINER',
      isTrainerLevel: true,
    };
    const traineeProfile = (organizationId: string, role = 'TRAINEE') => ({
      id: TRAINEE_UUID,
      role,
      organizationId,
    });
    const evaluation = {
      id: 'ev1',
      traineeId: TRAINEE_UUID,
      weekNumber: 3,
      year: 2027,
      ausbildungsjahr: 1,
      status: 'APPROVED',
      selfRating: '2',
      trainerRating: '2',
    };

    const READS = [
      {
        name: 'evaluations',
        route: 'trainee/evaluations',
        url: (id: string) => `/api/trainee/evaluations?userId=${id}`,
        table: 'weekly_evaluations',
        tables: { weeklyEvaluations: [evaluation] },
      },
      {
        name: 'annual-summary',
        route: 'trainee/annual-summary',
        url: (id: string) => `/api/trainee/annual-summary?traineeId=${id}`,
        table: 'weekly_evaluations',
        tables: { weeklyEvaluations: [evaluation] },
      },
    ];

    describe.each(READS)('$name', r => {
      const run = (
        profiles: any[],
        id: string | null,
        session: any = trainer
      ) =>
        load(
          {
            name: r.name,
            route: r.route,
            method: 'GET',
            url: id === null ? r.url('').split('?')[0] : r.url(id),
            tables: { ...r.tables, profiles },
          },
          session
        );

      it('a trainer reads a trainee of the own organization', async () => {
        const { res, mock } = await run([traineeProfile(ORG)], TRAINEE_UUID);
        expect(res.status).toBe(200);
        expect(mock.filters('select', r.table).params).toContain(TRAINEE_UUID);
        // Nothing was written
        expect(mock.db.insert).not.toHaveBeenCalled();
        expect(mock.db.update).not.toHaveBeenCalled();
        expect(mock.db.delete).not.toHaveBeenCalled();
      });

      it('a trainer gets 404 for a trainee of another organization, no data is read', async () => {
        const { res, mock } = await run(
          [traineeProfile('org-2')],
          TRAINEE_UUID
        );
        expect(res.status).toBe(404);
        expect(mock.filters('select', r.table).params).toEqual([]);
      });

      it('a trainer gets 404 for a person who is not a trainee', async () => {
        const { res, mock } = await run(
          [traineeProfile(ORG, 'TRAINER')],
          TRAINEE_UUID
        );
        expect(res.status).toBe(404);
        expect(mock.filters('select', r.table).params).toEqual([]);
      });

      it('a trainer needs to name the trainee (400)', async () => {
        const { res } = await run([traineeProfile(ORG)], null);
        expect(res.status).toBe(400);
      });

      it('a trainee naming a trainee of the same organization still gets the own data', async () => {
        const { res, mock } = await run(
          [traineeProfile(ORG)],
          TRAINEE_UUID,
          traineeSession(ME)
        );
        expect(res.status).toBe(200);
        const { params } = mock.filters('select', r.table);
        expect(params).toContain(ME);
        expect(params).not.toContain(TRAINEE_UUID);
        // No profile was looked up for a trainee
        expect(mock.filters('select', 'profiles').params).toEqual([]);
      });
    });

    it('the occupation check of the trainer answers for the route (404)', async () => {
      jest.resetModules();
      mockSession(trainer);
      const mock = createTableDb({
        profiles: [traineeProfile(ORG)],
        weeklyEvaluations: [evaluation],
      });
      jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
      const { NextResponse } = jest.requireActual('next/server') as any;
      const ensure = jest.fn(async () =>
        NextResponse.json({ error: 'Not found' }, { status: 404 })
      );
      jest.doMock('@/lib/catalog/trainee-scope', () => ({
        __esModule: true,
        ensureTraineeInCatalog: ensure,
      }));
      const mod = await import('@/app/api/trainee/evaluations/route');
      const res: Response = await mod.GET(
        makeRequest(
          'GET',
          `http://localhost/api/trainee/evaluations?userId=${TRAINEE_UUID}`,
          { token: 'tok', headers: { 'x-catalog': 'KFBM' } }
        )
      );
      expect(res.status).toBe(404);
      expect(ensure).toHaveBeenCalledTimes(1);
      expect(mock.filters('select', 'weekly_evaluations').params).toEqual([]);
    });

    it('the self-assessment (POST) stays with the trainee: a trainer cannot change the evaluation of a trainee', async () => {
      const { res, mock } = await load(
        {
          name: 'self-assessment',
          route: 'trainee/evaluations',
          method: 'POST',
          url: '/api/trainee/evaluations',
          body: {
            userId: TRAINEE_UUID,
            weekNumber: 3,
            year: 2027,
            ausbildungsjahr: 1,
          },
          tables: { weeklyEvaluations: [] },
        },
        trainer
      );
      // The trainer is the identity, the evaluation of the trainee is untouched
      expect(res.status).toBe(404);
      expect(mock.filters('select', 'weekly_evaluations').params).toContain(
        'trainer-1'
      );
      expect(touched(mock)).not.toContain(TRAINEE_UUID);
      expect(mock.db.update).not.toHaveBeenCalled();
    });
  });

  // -------------------------------------------------------------------------
  describe('answers that changed with the session', () => {
    it('works without any id in the query (the 400 for a missing id is gone)', async () => {
      const { res, mock } = await load({
        name: 'feedback',
        route: 'trainee/feedback',
        method: 'GET',
        url: '/api/trainee/feedback',
      });
      expect(res.status).toBe(200);
      expect(touched(mock)).toContain(ME);
    });

    it('evaluation detail: an evaluation of someone else is a 404', async () => {
      const foreign = {
        id: 'ev1',
        traineeId: OTHER,
        selfComment: 'private',
      };
      const { res } = await load({
        name: 'evaluation detail',
        route: 'trainee/evaluations/[id]',
        method: 'GET',
        url: '/api/trainee/evaluations/ev1',
        params: { id: 'ev1' },
        tables: { weeklyEvaluations: [foreign] },
      });
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain('private');
    });

    it('evaluation detail: the own evaluation is returned', async () => {
      const own = { id: 'ev1', traineeId: ME, selfComment: 'mine' };
      const { res } = await load({
        name: 'evaluation detail',
        route: 'trainee/evaluations/[id]',
        method: 'GET',
        url: '/api/trainee/evaluations/ev1',
        params: { id: 'ev1' },
        tables: { weeklyEvaluations: [own], weeklySoftskillRatings: [] },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).evaluation.selfComment).toBe('mine');
    });

    it('knowledge note detail: a note of someone else is a 404, no longer a 403', async () => {
      const foreign = { id: 'n1', traineeId: OTHER, content: 'private' };
      const { res } = await load({
        name: 'note',
        route: 'trainee/knowledge-notes/[noteId]',
        method: 'GET',
        // the old client sent the owner it wanted to read as traineeId
        url: `/api/trainee/knowledge-notes/n1?traineeId=${OTHER}`,
        params: { noteId: 'n1' },
        tables: { knowledgeNotes: [foreign] },
      });
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toContain('private');
    });

    it('knowledge note detail: without traineeId only the own note is read', async () => {
      // This used to return any note by id
      const foreign = { id: 'n1', traineeId: OTHER, content: 'private' };
      const { res } = await load({
        name: 'note',
        route: 'trainee/knowledge-notes/[noteId]',
        method: 'GET',
        url: '/api/trainee/knowledge-notes/n1',
        params: { noteId: 'n1' },
        tables: { knowledgeNotes: [foreign] },
      });
      expect(res.status).toBe(404);
    });

    it('knowledge note detail: the own note is returned', async () => {
      const own = { id: 'n1', traineeId: ME, content: 'mine' };
      const { res } = await load({
        name: 'note',
        route: 'trainee/knowledge-notes/[noteId]',
        method: 'GET',
        url: '/api/trainee/knowledge-notes/n1',
        params: { noteId: 'n1' },
        tables: { knowledgeNotes: [own] },
      });
      expect(res.status).toBe(200);
      expect((await res.json()).note.content).toBe('mine');
    });

    it('knowledge notes: the writes carry the owner in their where', async () => {
      const del = await load({
        name: 'delete',
        route: 'trainee/knowledge-notes/[noteId]',
        method: 'DELETE',
        url: `/api/trainee/knowledge-notes/n1?traineeId=${OTHER}`,
        params: { noteId: 'n1' },
      });
      expect(del.res.status).toBe(200);
      expect(del.mock.filters('delete', 'knowledge_notes').params).toEqual([
        'n1',
        ME,
      ]);

      const patch = await load({
        name: 'patch',
        route: 'trainee/knowledge-notes/[noteId]',
        method: 'PATCH',
        url: '/api/trainee/knowledge-notes/n1',
        body: { trainee_id: OTHER, content: 'changed' },
        params: { noteId: 'n1' },
      });
      expect(patch.res.status).toBe(200);
      expect(patch.mock.filters('update', 'knowledge_notes').params).toEqual([
        'n1',
        ME,
      ]);
    });

    it('knowledge notes: a new note belongs to the session user', async () => {
      const { res, mock } = await load({
        name: 'create',
        route: 'trainee/knowledge-notes',
        method: 'POST',
        url: '/api/trainee/knowledge-notes',
        body: { trainee_id: OTHER, title: 'T', content: 'C' },
      });
      expect(res.status).toBe(201);
      expect(mock.writes('insert', 'knowledge_notes')).toEqual([
        expect.objectContaining({ traineeId: ME, organizationId: ORG }),
      ]);
    });

    it('knowledge notes: title and content stay required', async () => {
      const { res } = await load({
        name: 'create',
        route: 'trainee/knowledge-notes',
        method: 'POST',
        url: '/api/trainee/knowledge-notes',
        body: { content: 'C' },
      });
      expect(res.status).toBe(400);
    });

    it('progress: the row is written for the session user', async () => {
      const { res, mock } = await load({
        name: 'progress',
        route: 'trainee/progress',
        method: 'POST',
        url: '/api/trainee/progress',
        body: { userId: OTHER, subLessonId: 's1', completed: true },
      });
      expect(res.status).toBe(200);
      expect(mock.writes('insert', 'progress')).toEqual([
        { user_id: ME, sub_lesson_id: 's1' },
      ]);
    });

    it('progress: reopening deletes only the own row', async () => {
      const { mock } = await load({
        name: 'progress',
        route: 'trainee/progress',
        method: 'POST',
        url: '/api/trainee/progress',
        body: { userId: OTHER, subLessonId: 's1', completed: false },
      });
      expect(mock.filters('delete', 'progress').params).toEqual([ME, 's1']);
    });

    it('progress: the body is still validated', async () => {
      const { res } = await load({
        name: 'progress',
        route: 'trainee/progress',
        method: 'POST',
        url: '/api/trainee/progress',
        body: { userId: ME, completed: true },
      });
      expect(res.status).toBe(400);
    });

    it('evaluations: a self-assessment changes only the own evaluation', async () => {
      const own = { id: 'ev1', traineeId: ME, status: 'DRAFT' };
      const { res, mock } = await load({
        name: 'self-assessment',
        route: 'trainee/evaluations',
        method: 'POST',
        url: '/api/trainee/evaluations',
        body: {
          userId: OTHER,
          weekNumber: 3,
          year: 2027,
          ausbildungsjahr: 1,
          selfRating: '2',
        },
        tables: { weeklyEvaluations: [own] },
      });
      expect(res.status).toBe(200);
      expect(mock.filters('select', 'weekly_evaluations').params).toContain(ME);
      expect(touched(mock)).not.toContain(OTHER);
    });

    it('evaluations: week, year and phase stay required', async () => {
      const { res } = await load({
        name: 'self-assessment',
        route: 'trainee/evaluations',
        method: 'POST',
        url: '/api/trainee/evaluations',
        body: { userId: ME },
      });
      expect(res.status).toBe(400);
    });

    it('lesson-progress: the lessonId stays required', async () => {
      const { res } = await load({
        name: 'lesson-progress',
        route: 'trainee/lesson-progress',
        method: 'GET',
        url: `/api/trainee/lesson-progress?userId=${ME}`,
      });
      expect(res.status).toBe(400);
    });

    it('submit routes: the notification for the trainer names the session user as actor', async () => {
      const { res, mock } = await load({
        name: 'use case submit',
        route: 'trainee/use-cases/[useCaseId]/submit',
        method: 'POST',
        url: '/api/trainee/use-cases/u1/submit',
        body: { traineeId: OTHER, submissionText: 'x' },
        params: { useCaseId: 'u1' },
        tables: {
          useCases: [{ id: 'u1', courseId: 'c1', isActive: true, title: 'U' }],
          courseMembers: [{ userId: ME, courseId: 'c1', role: 'TRAINEE' }],
          useCaseSubmissions: [],
        },
      });
      expect(res.status).toBeLessThan(300);
      const inserted = mock.writes('insert', 'use_case_submissions');
      expect(inserted[0]).toEqual(
        expect.objectContaining({ traineeId: ME, organizationId: ORG })
      );
      expect(touched(mock)).not.toContain(OTHER);
    });
  });
});
