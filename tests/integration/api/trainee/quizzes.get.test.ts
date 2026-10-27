/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import fs from 'fs';
import path from 'path';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  mockCatalogScope,
  mockSession,
  mockTraineeSession,
  traineeSession,
} from '../../../helpers/mockNext';
import { findSolutionKeys } from '../../../helpers/solutionKeys';

// GET /api/trainee/quizzes/[quizId]: the questions of a global quiz for the
// trainee who sits it. The page used to read the database itself, without a
// session, a catalog or an assignment. The route answers for the session user
// only, for an active GLOBAL quiz of the own occupation that is assigned to
// them, and it sends texts only: never the marker of the right option, the
// reasoning, an expected answer or a hint.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const QUIZ_ID = 'aaaaaaa1-0000-4000-8000-000000000001';
const ORG = 'org-1';

const SECRET_REASON = 'SECRET-REASONING';
const SECRET_EXPECTED = 'SECRET-EXPECTED';
const SECRET_HINT = 'SECRET-HINT';

const globalQuiz = {
  id: QUIZ_ID,
  title: 'Global A',
  quizType: 'GLOBAL',
  isActive: true,
  trainingCatalogId: FIAE,
};
const assignment = { id: 'as1', quizId: QUIZ_ID, traineeId: 't1' };
// (the route orders the questions in the query, the mock returns them as listed)
const questions = [
  {
    id: 'q-1',
    quizId: QUIZ_ID,
    questionText: 'First',
    questionType: 'MCQ',
    expectedAnswer: null,
    orderIndex: 1,
  },
  {
    id: 'q-2',
    quizId: QUIZ_ID,
    questionText: 'Second',
    questionType: 'TEXT',
    expectedAnswer: SECRET_EXPECTED,
    hintText: SECRET_HINT,
    orderIndex: 2,
  },
];
const options = [
  {
    id: 'o-b',
    questionId: 'q-1',
    optionText: 'B',
    isCorrect: false,
    explanation: null,
    orderIndex: 2,
  },
  {
    id: 'o-a',
    questionId: 'q-1',
    optionText: 'A',
    isCorrect: true,
    explanation: SECRET_REASON,
    orderIndex: 1,
  },
];

const ctx = (quizId = QUIZ_ID) => ({ params: Promise.resolve({ quizId }) });

function request(url = `http://localhost/api/trainee/quizzes/${QUIZ_ID}`) {
  return {
    url,
    method: 'GET',
    nextUrl: new URL(url),
    headers: { get: () => null },
  } as any;
}

function happyTables() {
  return {
    quizzes: [globalQuiz],
    quizAssignments: [assignment],
    questions,
    options,
  };
}

/** The route with the catalog scope mocked (one FIAE trainee). */
async function load(tables: Record<string, any>, db?: any) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: db ?? mock.db }));
  mockTraineeSession('t1');
  mockCatalogScope();
  const mod = await import('@/app/api/trainee/quizzes/[quizId]/route');
  return { mock, GET: mod.GET };
}

describe('GET /api/trainee/quizzes/[quizId]', () => {
  beforeEach(() => jest.clearAllMocks());

  it('answers an assigned active global quiz with texts in order', async () => {
    const { GET } = await load(happyTables());
    const res = await GET(request(), ctx());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      quiz: {
        id: QUIZ_ID,
        title: 'Global A',
        questions: [
          {
            id: 'q-1',
            questionText: 'First',
            questionType: 'MCQ',
            options: [
              { id: 'o-a', optionText: 'A' },
              { id: 'o-b', optionText: 'B' },
            ],
          },
          {
            id: 'q-2',
            questionText: 'Second',
            questionType: 'TEXT',
            options: [],
          },
        ],
      },
    });
  });

  it('carries no solution key, whatever the rows hold (recursive scan)', async () => {
    const { GET } = await load(happyTables());
    const res = await GET(request(), ctx());
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(findSolutionKeys(body)).toEqual([]);
    const text = JSON.stringify(body);
    expect(text).not.toContain(SECRET_REASON);
    expect(text).not.toContain(SECRET_EXPECTED);
    expect(text).not.toContain(SECRET_HINT);
    expect(text).not.toContain('isCorrect');
  });

  it('does not name a solution column in its source', () => {
    const source = fs.readFileSync(
      path.join(process.cwd(), 'src/app/api/trainee/quizzes/[quizId]/route.ts'),
      'utf8'
    );
    expect(source).not.toMatch(/isCorrect|explanation|expectedAnswer|hintText/);
  });

  it('serves an empty quiz as a quiz without questions', async () => {
    const { GET } = await load({
      ...happyTables(),
      questions: [],
      options: [],
    });
    const res = await GET(request(), ctx());
    expect(res.status).toBe(200);
    expect((await res.json()).quiz.questions).toEqual([]);
  });

  it('is limited to the assignment of the session user, a traineeId in the query is ignored', async () => {
    const { GET, mock } = await load(happyTables());
    const res = await GET(
      request(
        `http://localhost/api/trainee/quizzes/${QUIZ_ID}?traineeId=other`
      ),
      ctx()
    );
    expect(res.status).toBe(200);
    const filter = mock.filters('select', 'quizAssignments');
    expect(filter.params).toContain('t1');
    expect(filter.params).toContain(QUIZ_ID);
    expect(filter.params).not.toContain('other');
  });

  it('404 for an unknown quiz', async () => {
    const { GET } = await load({ ...happyTables(), quizzes: [] });
    const res = await GET(request(), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
  });

  it('404 for an inactive quiz, nothing of its questions is read', async () => {
    const { GET, mock } = await load({
      ...happyTables(),
      quizzes: [{ ...globalQuiz, isActive: false }],
    });
    const res = await GET(request(), ctx());
    expect(res.status).toBe(404);
    expect(mock.calls.some(c => c.table === 'questions')).toBe(false);
    expect(mock.calls.some(c => c.table === 'options')).toBe(false);
  });

  it('404 for a quiz that was never switched on (is_active null)', async () => {
    const { GET } = await load({
      ...happyTables(),
      quizzes: [{ ...globalQuiz, isActive: null }],
    });
    expect((await GET(request(), ctx())).status).toBe(404);
  });

  it('404 for a lesson quiz, it is served by the gated enabler route', async () => {
    const { GET, mock } = await load({
      ...happyTables(),
      quizzes: [{ ...globalQuiz, quizType: 'LESSON' }],
    });
    const res = await GET(request(), ctx());
    expect(res.status).toBe(404);
    expect(mock.calls.some(c => c.table === 'questions')).toBe(false);
  });

  it('404 for a global quiz that is not assigned to the trainee', async () => {
    const { GET, mock } = await load({
      ...happyTables(),
      quizAssignments: [],
    });
    const res = await GET(request(), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
    expect(mock.calls.some(c => c.table === 'questions')).toBe(false);
  });

  it('500 if the database fails', async () => {
    jest.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await load(happyTables(), {
      select: jest.fn(() => {
        throw new Error('boom');
      }),
    });
    const res = await GET(request(), ctx());
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
  });
});

describe('GET /api/trainee/quizzes/[quizId] guards and scope', () => {
  beforeEach(() => jest.clearAllMocks());

  async function loadReal(
    session: ReturnType<typeof fakeSession> | null,
    tables: Record<string, any>
  ) {
    jest.resetModules();
    // The earlier tests mocked the scope, this one runs the real one
    jest.dontMock('@/lib/catalog/scope');
    jest.dontMock('@/lib/catalog/public');
    const mock = createTableDb({
      trainingCatalogs: [
        { id: FIAE, code: 'FIAE', isActive: true },
        { id: KFBM, code: 'KFBM', isActive: true },
      ],
      organizationCatalogs: [
        { trainingCatalogId: FIAE, isEnabled: true },
        { trainingCatalogId: KFBM, isEnabled: true },
      ],
      profiles: [
        {
          id: 't1',
          role: 'TRAINEE',
          organizationId: ORG,
          isPlatformOwner: false,
        },
      ],
      // The trainee learns for the KfBM only
      traineeEnrollments: [
        { trainingCatalogId: KFBM, startDate: '2026-09-01' },
      ],
      ...tables,
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    mockSession(session);
    const mod = await import('@/app/api/trainee/quizzes/[quizId]/route');
    return { mock, GET: mod.GET };
  }

  it('401 without a session, the database is not touched', async () => {
    const { GET, mock } = await loadReal(null, happyTables());
    const res = await GET(request(), ctx());
    expect(res.status).toBe(401);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('403 for a trainer, the route is for the trainee who sits the quiz', async () => {
    const { GET, mock } = await loadReal(fakeSession(), happyTables());
    const res = await GET(request(), ctx());
    expect(res.status).toBe(403);
    expect(mock.db.select).not.toHaveBeenCalled();
  });

  it('404 for a quiz of another occupation, the same answer as for a missing one', async () => {
    // The trainee is a FIAE trainee, the quiz belongs to the KfBM
    const { GET, mock } = await loadReal(traineeSession('t1'), {
      ...happyTables(),
      quizzes: [{ ...globalQuiz, trainingCatalogId: KFBM }],
      traineeEnrollments: [
        { trainingCatalogId: FIAE, startDate: '2026-09-01' },
      ],
    });
    const res = await GET(request(), ctx());
    expect(res.status).toBe(404);
    expect(await res.json()).toEqual({ error: 'Not found' });
    expect(mock.calls.some(c => c.table === 'questions')).toBe(false);
  });

  it('404 for a quiz of an occupation the organization has not enabled', async () => {
    const { GET } = await loadReal(traineeSession('t1'), {
      ...happyTables(),
      organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
      traineeEnrollments: [
        { trainingCatalogId: FIAE, startDate: '2026-01-01' },
        { trainingCatalogId: KFBM, startDate: '2026-09-01' },
      ],
      quizzes: [{ ...globalQuiz, trainingCatalogId: KFBM }],
    });
    expect((await GET(request(), ctx())).status).toBe(404);
  });

  it('404 for an id that is no uuid, without a query on the quiz table', async () => {
    const { GET, mock } = await loadReal(traineeSession('t1'), happyTables());
    const res = await GET(request(), ctx('not-a-uuid'));
    expect(res.status).toBe(404);
    expect(mock.calls.some(c => c.table === 'quizzes')).toBe(false);
  });

  it('serves a quiz of the own occupation', async () => {
    const { GET } = await loadReal(traineeSession('t1'), {
      ...happyTables(),
      quizzes: [{ ...globalQuiz, trainingCatalogId: KFBM }],
    });
    const res = await GET(request(), ctx());
    expect(res.status).toBe(200);
  });
});
