/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import { mockTraineeSession } from '../../../helpers/mockNext';
import { findSolutionKeys } from '../../../helpers/solutionKeys';

// GET /api/trainee/enablers/[enablerId]/quizzes/[difficulty]: the questions of
// a lesson quiz for a trainee. The answer is the place where a solution would
// leak, so the rows of the mock carry every solution field the tables have and
// the test checks that none of them reaches the response.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';

const SECRET = 'SECRET-REASONING-the-right-one';
const SECRET_EXPECTED = 'SECRET-EXPECTED-ANSWER';

const enablerRow = { id: 'e1', isActive: true, courseId: 'c1' };
const memberRow = { userId: 't1', courseId: 'c1' };
const linkRow = { enablerId: 'e1', quizId: 'q1', difficulty: 'LOW' };
const quizRow = { id: 'q1', title: 'Quiz Title', isActive: true };
const questionRows = [
  {
    id: 'q-2',
    quizId: 'q1',
    questionText: 'B',
    questionType: 'TEXT',
    orderIndex: 2,
    expectedAnswer: SECRET_EXPECTED,
  },
  {
    id: 'q-1',
    quizId: 'q1',
    questionText: 'A',
    questionType: 'MCQ',
    orderIndex: 1,
    expectedAnswer: null,
  },
];
const optionRows = [
  {
    id: 'o-1',
    questionId: 'q-1',
    optionText: 'A1',
    isCorrect: true,
    explanation: SECRET,
    rationale: SECRET,
  },
  {
    id: 'o-2',
    questionId: 'q-1',
    optionText: 'A2',
    isCorrect: false,
    explanation: null,
    rationale: null,
  },
];

const scopeOf = (id: string) => ({
  allowedCatalogIds: [id],
  activeCatalogId: id,
  selected: false,
});

type Tables = Record<string, any>;

async function load(tables: Tables, catalogScope = scopeOf(FIAE)) {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  mockTraineeSession('t1');
  const { mockCatalogScope } = await import('../../../helpers/mockNext');
  mockCatalogScope(catalogScope);
  const mod =
    await import('@/app/api/trainee/enablers/[enablerId]/quizzes/[difficulty]/route');
  return { mock, GET: mod.GET };
}

const call = (GET: any, difficulty = 'LOW') =>
  GET(
    {
      url: `http://localhost/api/trainee/enablers/e1/quizzes/${difficulty}?traineeId=t1`,
    } as any,
    { params: Promise.resolve({ enablerId: 'e1', difficulty }) }
  ) as Promise<Response>;

const fullTables = (): Tables => ({
  enablers: [enablerRow],
  courseMembers: [memberRow],
  enablerQuizLinks: [linkRow],
  quizzes: [quizRow],
  questions: questionRows,
  options: optionRows,
});

describe('GET /api/trainee/enablers/[enablerId]/quizzes/[difficulty]', () => {
  beforeEach(() => jest.clearAllMocks());

  it('returns the questions and the options with id and text only', async () => {
    const { GET } = await load(fullTables());
    const res = await call(GET);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      quiz: {
        id: 'q1',
        title: 'Quiz Title',
        difficulty: 'LOW',
        questions: [
          {
            id: 'q-2',
            questionText: 'B',
            questionType: 'TEXT',
            options: [],
          },
          {
            id: 'q-1',
            questionText: 'A',
            questionType: 'MCQ',
            options: [
              { id: 'o-1', optionText: 'A1' },
              { id: 'o-2', optionText: 'A2' },
            ],
          },
        ],
      },
    });
  });

  it('lists the options in the order of the author (order_index, old rows after it in stored order)', async () => {
    const { GET } = await load({
      ...fullTables(),
      options: [
        { id: 'o-b', questionId: 'q-1', optionText: 'B', orderIndex: 2 },
        { id: 'o-old', questionId: 'q-1', optionText: 'Old', orderIndex: null },
        { id: 'o-a', questionId: 'q-1', optionText: 'A', orderIndex: 1 },
      ],
    });
    const body = await (await call(GET)).json();
    const q1 = body.quiz.questions.find((q: any) => q.id === 'q-1');
    expect(q1.options.map((o: any) => o.id)).toEqual(['o-a', 'o-b', 'o-old']);
    expect(findSolutionKeys(body)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain('orderIndex');
  });

  it('carries no solution key anywhere in the answer (recursive scan)', async () => {
    const { GET } = await load(fullTables());
    const res = await call(GET);
    const body = await res.json();
    expect(findSolutionKeys(body)).toEqual([]);
    // and none of the secret values, whatever key they would sit under
    const text = JSON.stringify(body);
    expect(text).not.toContain(SECRET);
    expect(text).not.toContain(SECRET_EXPECTED);
  });

  it('asks the database for the columns of the trainee view only', async () => {
    const { GET, mock } = await load(fullTables());
    await call(GET);
    // every select that names its columns leaves out the solution columns, so
    // is_correct, explanation and expected_answer never leave the database layer
    const named = (mock.db.select as jest.Mock).mock.calls
      .map(args => args[0] as Record<string, unknown> | undefined)
      .filter(Boolean) as Record<string, unknown>[];
    const optionsSelect = named.find(f => 'optionText' in f);
    const questionsSelect = named.find(f => 'questionText' in f);
    expect(optionsSelect).toBeDefined();
    expect(questionsSelect).toBeDefined();
    for (const fields of named) {
      expect(Object.keys(fields)).not.toEqual(
        expect.arrayContaining(['isCorrect'])
      );
      expect(Object.keys(fields)).not.toContain('explanation');
      expect(Object.keys(fields)).not.toContain('expectedAnswer');
    }
  });

  it('404 for an inactive enabler', async () => {
    const { GET } = await load({
      ...fullTables(),
      enablers: [{ ...enablerRow, isActive: false }],
    });
    const res = await call(GET);
    expect(res.status).toBe(404);
    expect(findSolutionKeys(await res.json())).toEqual([]);
  });

  it('403 for a trainee who is not a member of the course', async () => {
    const { GET } = await load({ ...fullTables(), courseMembers: [] });
    const res = await call(GET);
    expect(res.status).toBe(403);
    expect(await res.json()).toEqual({ error: 'Forbidden' });
  });

  it('404 without a quiz of that difficulty', async () => {
    const { GET } = await load({ ...fullTables(), enablerQuizLinks: [] });
    expect((await call(GET, 'HIGH')).status).toBe(404);
  });

  it('404 for an inactive quiz', async () => {
    const { GET } = await load({
      ...fullTables(),
      quizzes: [{ ...quizRow, isActive: false }],
    });
    expect((await call(GET)).status).toBe(404);
  });

  it('500 without any detail of the quiz when the database fails', async () => {
    const errorSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
    jest.resetModules();
    const failing = {
      select: jest.fn(() => {
        throw new Error(`boom ${SECRET}`);
      }),
    };
    jest.doMock('@/db', () => ({ __esModule: true, default: failing }));
    mockTraineeSession('t1');
    const { mockCatalogScope } = await import('../../../helpers/mockNext');
    mockCatalogScope();
    const mod =
      await import('@/app/api/trainee/enablers/[enablerId]/quizzes/[difficulty]/route');
    const res = await call(mod.GET);
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
    errorSpy.mockRestore();
  });
});

describe('the same route for foreign content', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a KfBM trainee does not get a FIAE enabler (404), no question is read', async () => {
    jest.resetModules();
    // the real catalog scope, not the fake of the tests above
    jest.dontMock('@/lib/catalog/scope');
    jest.dontMock('@/lib/catalog/public');
    const mock = createTableDb({
      trainingCatalogs: [
        { id: FIAE, code: 'FIAE', isActive: true },
        { id: KFBM, code: 'KFBM', isActive: true },
      ],
      profiles: [
        {
          id: 't1',
          role: 'TRAINEE',
          organizationId: 'org-1',
          isPlatformOwner: false,
        },
      ],
      organizationCatalogs: [
        { trainingCatalogId: FIAE, isEnabled: true },
        { trainingCatalogId: KFBM, isEnabled: true },
      ],
      traineeEnrollments: [
        { trainingCatalogId: KFBM, startDate: '2026-08-01' },
      ],
      enablers: [{ ...enablerRow, trainingCatalogId: FIAE }],
      courseMembers: [memberRow],
      enablerQuizLinks: [linkRow],
      quizzes: [quizRow],
      questions: questionRows,
      options: optionRows,
    });
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    jest.doMock('@/lib/auth-helpers', () => ({
      __esModule: true,
      verifyPlatformOwner: async () => true,
      getUserOrgId: async () => 'org-1',
    }));
    mockTraineeSession('t1');
    const mod =
      await import('@/app/api/trainee/enablers/[enablerId]/quizzes/[difficulty]/route');
    const res = await call(mod.GET);
    expect(res.status).toBe(404);
    const body = await res.json();
    expect(findSolutionKeys(body)).toEqual([]);
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(mock.filters('select', 'options').sql).toBe('');
    expect(mock.filters('select', 'questions').sql).toBe('');
  });
});
