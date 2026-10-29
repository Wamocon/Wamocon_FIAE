/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  mockCatalogScope,
  mockSession,
  mockTraineeSession,
  traineeSession,
} from '../../../helpers/mockNext';
import { findSolutionKeys } from '../../../helpers/solutionKeys';

// FIAE regression (release test, phase 6). The rebuild for a second occupation must
// not change what a FIAE trainee, trainer or administrator experiences. Each block
// below proves one assumption with the real route code against a table mock, the
// matrix "test against assumption" is in docs/kfbm-rollout-regression.md.
//
//   R1 the catalog filter leaves the FIAE results unchanged
//   R2 FIAE is the standard occupation, no selection, no tabs
//   R3 quiz rules (W3): global quiz repeatable, lesson quiz locked after the pass,
//      answers only after the submission
//   R4 solution protection for trainees
//
// R5 (roles and gates) is in tests/unit/lib/auth/gates.regression.test.ts.

const FIAE = '00000000-0000-4000-8000-000000000001';
const KFBM = '00000000-0000-4000-8000-000000000002';
const ORG = 'org-1';

const fiaeCatalog = {
  id: FIAE,
  code: 'FIAE',
  title: 'FIAE',
  isActive: true,
  settings: {},
};
const kfbmCatalog = {
  id: KFBM,
  code: 'KFBM',
  title: 'KfBM',
  isActive: true,
  settings: {},
};

function req(url: string, catalog?: string) {
  return {
    url,
    method: 'GET',
    headers: {
      get: (name: string) =>
        name.toLowerCase() === 'x-catalog' ? (catalog ?? null) : null,
    },
    json: async () => ({}),
  } as any;
}

// ---------------------------------------------------------------------------
// R1 and R2: scope and filter
// ---------------------------------------------------------------------------

async function loadRoute(
  route: string,
  tables: Record<string, any>,
  session: ReturnType<typeof fakeSession> | null
) {
  jest.resetModules();
  // the quiz and document blocks replace the catalog scope, these blocks run the real one
  jest.dontMock('@/lib/catalog/scope');
  jest.dontMock('@/lib/catalog/public');
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    verifyPlatformOwner: async () => true,
    getUserOrgId: async () => ORG,
  }));
  mockSession(session);
  const mod = await import(`@/app/api/${route}/route`);
  return { mock, mod };
}

async function loadScope(tables: Record<string, any>) {
  jest.resetModules();
  jest.dontMock('@/lib/catalog/scope');
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  const scope = await import('@/lib/catalog/scope');
  return { scope, mock };
}

const fiaeTrainee = (overrides = {}) =>
  traineeSession('t1', { organizationId: ORG, ...overrides });
const fiaeTrainer = () => fakeSession({ id: 'tr1', organizationId: ORG });
// A FIAE organization is one that has not enabled the second occupation: the
// trainer of an organization with both occupations legitimately sees both.
const fiaeOrg = (world: Record<string, any>) => ({
  ...world,
  organizationCatalogs: (world.organizationCatalogs as any[]).filter(
    r => r.trainingCatalogId === FIAE
  ),
});

// The three states a FIAE organization can be in: before the rebuild (no
// catalog rows at all), the rebuild without the second occupation, and with it.
const WORLDS: Record<string, Record<string, any>> = {
  'before the rebuild (no catalog rows)': {
    trainingCatalogs: [fiaeCatalog],
    organizationCatalogs: [],
    traineeEnrollments: [],
  },
  'FIAE enabled, enrolled in FIAE': {
    trainingCatalogs: [fiaeCatalog],
    organizationCatalogs: [{ trainingCatalogId: FIAE, isEnabled: true }],
    traineeEnrollments: [{ trainingCatalogId: FIAE, startDate: '2025-08-01' }],
  },
  'KfBM exists and is enabled for the organization, the trainee is FIAE only': {
    trainingCatalogs: [fiaeCatalog, kfbmCatalog],
    organizationCatalogs: [
      { trainingCatalogId: FIAE, isEnabled: true },
      { trainingCatalogId: KFBM, isEnabled: true },
    ],
    traineeEnrollments: [{ trainingCatalogId: FIAE, startDate: '2025-08-01' }],
  },
};

describe('R2: FIAE is the standard occupation, no selection needed', () => {
  beforeEach(() => jest.clearAllMocks());

  it.each(Object.entries(WORLDS))(
    'a FIAE trainee: %s',
    async (_name, world) => {
      const { scope } = await loadScope({
        profiles: [{ id: 't1', role: 'TRAINEE', organizationId: ORG }],
        ...world,
      });
      const result = await scope.getCatalogScope(
        { id: 't1', role: 'TRAINEE', organizationId: ORG },
        req('http://localhost/api/trainee/courses')
      );
      expect(result).toEqual({
        allowedCatalogIds: [FIAE],
        activeCatalogId: FIAE,
        selected: false,
      });
      expect(scope.readCatalogIds(result)).toEqual([FIAE]);
    }
  );

  it('a trainee without any enrollment row is a FIAE trainee (legacy accounts)', async () => {
    const { scope } = await loadScope({
      trainingCatalogs: [fiaeCatalog, kfbmCatalog],
      organizationCatalogs: [],
      traineeEnrollments: [],
    });
    const result = await scope.getCatalogScope({
      id: 't1',
      role: 'TRAINEE',
      organizationId: ORG,
    });
    expect(result.activeCatalogId).toBe(FIAE);
    expect(result.allowedCatalogIds).toEqual([FIAE]);
  });

  it('a trainer of an organization without catalog rows works in FIAE', async () => {
    const { scope } = await loadScope({
      trainingCatalogs: [fiaeCatalog, kfbmCatalog],
      organizationCatalogs: [],
    });
    const result = await scope.getCatalogScope({
      id: 'tr1',
      role: 'TRAINER',
      organizationId: ORG,
    });
    expect(result).toEqual({
      allowedCatalogIds: [FIAE],
      activeCatalogId: FIAE,
      selected: false,
    });
  });

  it('a FIAE trainee gets one occupation and no tab from /api/me/catalogs', async () => {
    const { mod } = await loadRoute(
      'me/catalogs',
      {
        ...WORLDS[
          'KfBM exists and is enabled for the organization, the trainee is FIAE only'
        ],
      },
      fiaeTrainee()
    );
    const res = await mod.GET(req('http://localhost/api/me/catalogs'));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.catalogs.map((c: any) => c.code)).toEqual(['FIAE']);
    expect(body.activeCode).toBe('FIAE');
    expect(body.selected).toBe(false);
  });

  it('the public catalog list falls back to FIAE for a visitor without a choice', async () => {
    const { mod, mock } = await loadRoute(
      'trainee/lernfelder',
      {
        trainingCatalogs: [fiaeCatalog, kfbmCatalog],
        trainingCatalogLearningFields: [],
      },
      null
    );
    const res = await mod.GET(req('http://localhost/api/trainee/lernfelder'));
    expect(res.status).toBe(200);
    expect(
      mock.filters('select', 'training_catalog_learning_fields').params
    ).toEqual([FIAE]);
  });
});

describe('R1: the catalog filter leaves the FIAE results unchanged', () => {
  beforeEach(() => jest.clearAllMocks());

  const courseRows = [
    {
      id: 'bbbbbbb3-0000-4000-8000-000000000003',
      title: 'Grundlagen',
      year: 1,
      chapter: 1,
    },
    {
      id: 'bbbbbbb3-0000-4000-8000-000000000004',
      title: 'Datenbanken',
      year: 1,
      chapter: 2,
    },
  ];
  const fieldRows = [
    {
      id: 'f1',
      title: 'LF1',
      label: 'LF1',
      description: 'Beschreibung',
      trainingCatalogId: FIAE,
      createdAt: '2025-01-01T00:00:00.000Z',
    },
  ];

  // The mock returns the rows it is given whatever the where() says. So the
  // answer of a route is the same in every world exactly when the route's own
  // shaping does not depend on the catalog data around it, and the rendered
  // filter shows which catalogs the read was limited to.
  it.each(Object.entries(WORLDS))(
    'trainer course list: same answer, FIAE filter only (%s)',
    async (_name, world) => {
      const { mock, mod } = await loadRoute(
        'trainer/courses',
        { ...fiaeOrg(world), courses: courseRows },
        fiaeTrainer()
      );
      const res = await mod.GET(req('http://localhost/api/trainer/courses'));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.courses.map((c: any) => c.title)).toEqual([
        'Grundlagen',
        'Datenbanken',
      ]);
      const filter = mock.filters('select', 'courses');
      expect(filter.params).toContain(FIAE);
      expect(filter.params).not.toContain(KFBM);
    }
  );

  it('the answers of the worlds are identical', async () => {
    const bodies: string[] = [];
    for (const world of Object.values(WORLDS)) {
      const { mod } = await loadRoute(
        'trainer/courses',
        { ...fiaeOrg(world), courses: courseRows },
        fiaeTrainer()
      );
      bodies.push(
        JSON.stringify(
          await (
            await mod.GET(req('http://localhost/api/trainer/courses'))
          ).json()
        )
      );
    }
    expect(new Set(bodies).size).toBe(1);
  });

  it.each(Object.entries(WORLDS))(
    'trainee learning fields: FIAE filter only (%s)',
    async (_name, world) => {
      const { mock, mod } = await loadRoute(
        'trainee/lernfelder',
        {
          ...world,
          profiles: [{ id: 't1', role: 'TRAINEE', organizationId: ORG }],
          trainingCatalogLearningFields: fieldRows,
          useCases: [],
        },
        fiaeTrainee()
      );
      const res = await mod.GET(req('http://localhost/api/trainee/lernfelder'));
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.lernfelder).toHaveLength(1);
      expect(body.lernfelder[0]).toMatchObject({
        label: 'LF1',
        useCaseCount: 0,
      });
      const filter = mock.filters('select', 'training_catalog_learning_fields');
      expect(filter.params).toEqual([FIAE]);
    }
  );

  it('trainee course list: the FIAE trainee asks the database for FIAE courses and nothing else', async () => {
    for (const world of Object.values(WORLDS)) {
      const { mock, mod } = await loadRoute(
        'trainee/courses',
        {
          ...world,
          profiles: [{ id: 't1', role: 'TRAINEE', organizationId: ORG }],
          courseMembers: [{ userId: 't1', courseId: courseRows[0].id }],
          courses: [],
        },
        fiaeTrainee()
      );
      const res = await mod.GET(req('http://localhost/api/trainee/courses'));
      expect(res.status).toBe(200);
      const params = mock.filters('select', 'courses').params;
      expect(params).toContain(FIAE);
      expect(params).not.toContain(KFBM);
    }
  });

  it('the super admin keeps the view over everything, a chosen occupation narrows it', async () => {
    const superAdmin = fakeSession({
      id: 'sa1',
      role: 'SUPER_ADMIN',
      isAdmin: true,
      isSuperAdmin: true,
    });
    const world =
      WORLDS[
        'KfBM exists and is enabled for the organization, the trainee is FIAE only'
      ];
    const all = await loadRoute(
      'trainer/courses',
      { ...world, courses: [] },
      superAdmin
    );
    await all.mod.GET(req('http://localhost/api/trainer/courses'));
    expect(all.mock.filters('select', 'courses').params).toEqual(
      expect.arrayContaining([FIAE, KFBM])
    );
    const one = await loadRoute(
      'trainer/courses',
      { ...world, courses: [] },
      superAdmin
    );
    await one.mod.GET(req('http://localhost/api/trainer/courses', 'FIAE'));
    expect(one.mock.filters('select', 'courses').params).toEqual([FIAE]);
  });
});

// ---------------------------------------------------------------------------
// R3: quiz rules (W3)
// ---------------------------------------------------------------------------

const SECRET_1 = 'REASONING-ONE';
const SECRET_2 = 'REASONING-TWO';
const lessonQuiz = { id: 'q1', isActive: true, quizType: 'LESSON' };
const globalQuiz = { id: 'q1', isActive: true, quizType: 'GLOBAL' };
const questions = [
  { id: 'q-1', quizId: 'q1', questionText: 'Q1', orderIndex: 1 },
  { id: 'q-2', quizId: 'q1', questionText: 'Q2', orderIndex: 2 },
];
const options = [
  {
    id: 'o-1',
    questionId: 'q-1',
    optionText: 'A',
    isCorrect: true,
    explanation: SECRET_1,
  },
  {
    id: 'o-2',
    questionId: 'q-1',
    optionText: 'B',
    isCorrect: false,
    explanation: null,
  },
  {
    id: 'o-3',
    questionId: 'q-2',
    optionText: 'C',
    isCorrect: true,
    explanation: SECRET_2,
  },
  {
    id: 'o-4',
    questionId: 'q-2',
    optionText: 'D',
    isCorrect: false,
    explanation: null,
  },
];
const quizTables = (quiz: typeof lessonQuiz | typeof globalQuiz) => ({
  quizzes: [quiz],
  enablerQuizLinks: [{ quizId: 'q1', enablerId: 'e1', difficulty: 'LOW' }],
  enablers: [{ id: 'e1', isActive: true, courseId: 'c1', title: 'E1' }],
  courseMembers: [{ userId: 't1', courseId: 'c1', role: 'TRAINEE' }],
  courses: [{ id: 'c1', createdById: 'tr1' }],
  quizAssignments: [{ quizId: 'q1', traineeId: 't1' }],
  questions,
  options,
  quizSubmissions: [] as any[],
  quizSubmissionAnswers: [] as any[],
});
const right = [
  { questionId: 'q-1', selectedOptionId: 'o-1' },
  { questionId: 'q-2', selectedOptionId: 'o-3' },
];
const wrong = [
  { questionId: 'q-1', selectedOptionId: 'o-2' },
  { questionId: 'q-2', selectedOptionId: 'o-4' },
];

async function loadQuiz(
  routePath: string,
  tables: Record<string, any>
): Promise<{ mock: ReturnType<typeof createTableDb>; mod: any }> {
  jest.resetModules();
  const mock = createTableDb(tables);
  jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    getUserOrgId: async () => 'org1',
  }));
  mockTraineeSession('t1');
  mockCatalogScope();
  const mod = await import(`@/app/api/${routePath}/route`);
  return { mock, mod };
}

const SUBMIT = 'trainee/quizzes/[quizId]/submit';
const quizCtx = { params: Promise.resolve({ quizId: 'q1' }) };
const post = (answers: unknown) =>
  ({
    url: 'http://localhost/api/trainee/quizzes/q1/submit',
    json: async () => ({ answers }),
  }) as any;
const getReq = (url: string) => ({ url }) as any;

describe('R3: quiz rules (W3)', () => {
  beforeEach(() => jest.clearAllMocks());

  it('a global quiz can be handed in again and again, the attempt number counts up', async () => {
    for (const [previous, expectedAttempt] of [
      [0, 1],
      [1, 2],
      [4, 5],
    ] as const) {
      const { mod, mock } = await loadQuiz(SUBMIT, {
        ...quizTables(globalQuiz),
        quizSubmissions: Array.from({ length: previous }, (_, i) => ({
          id: `s${i}`,
          quizId: 'q1',
          traineeId: 't1',
          score: 100,
        })),
      });
      const res = await mod.POST(post(right), quizCtx);
      const body = await res.json();
      expect(res.status).toBe(200);
      expect(body.locked).toBe(false);
      expect(mock.writes('insert', 'quizSubmissions')[0]).toMatchObject({
        attemptNumber: expectedAttempt,
      });
    }
  });

  it('a lesson quiz is repeated until it is passed, then it is locked and takes no new attempt', async () => {
    const failed = await loadQuiz(SUBMIT, {
      ...quizTables(lessonQuiz),
      quizSubmissions: [{ id: 's1', quizId: 'q1', traineeId: 't1', score: 0 }],
    });
    const again = await (await failed.mod.POST(post(right), quizCtx)).json();
    expect(again.locked).toBe(false);
    expect(failed.mock.writes('insert', 'quizSubmissions')).toHaveLength(1);

    const passed = await loadQuiz(SUBMIT, {
      ...quizTables(lessonQuiz),
      quizSubmissions: [
        { id: 's1', quizId: 'q1', traineeId: 't1', score: 100 },
      ],
      quizSubmissionAnswers: [
        { submissionId: 's1', questionId: 'q-1', selectedOptionId: 'o-1' },
        { submissionId: 's1', questionId: 'q-2', selectedOptionId: 'o-3' },
      ],
    });
    const locked = await (await passed.mod.POST(post(wrong), quizCtx)).json();
    expect(locked.locked).toBe(true);
    expect(locked.score).toBe(100);
    expect(passed.mock.writes('insert', 'quizSubmissions')).toEqual([]);
  });

  it('the pass mark is 50 percent', async () => {
    const half = await loadQuiz(SUBMIT, quizTables(lessonQuiz));
    const body = await (
      await half.mod.POST(
        post([
          { questionId: 'q-1', selectedOptionId: 'o-1' },
          { questionId: 'q-2', selectedOptionId: 'o-4' },
        ]),
        quizCtx
      )
    ).json();
    expect(body.score).toBe(50);
    const below = await loadQuiz(SUBMIT, quizTables(lessonQuiz));
    const failedBody = await (
      await below.mod.POST(post(wrong), quizCtx)
    ).json();
    expect(failedBody.score).toBe(0);
    // 50 percent passes: the next attempt finds the quiz locked
    const passed = await loadQuiz(SUBMIT, {
      ...quizTables(lessonQuiz),
      quizSubmissions: [{ id: 's1', quizId: 'q1', traineeId: 't1', score: 50 }],
      quizSubmissionAnswers: [
        { submissionId: 's1', questionId: 'q-1', selectedOptionId: 'o-1' },
        { submissionId: 's1', questionId: 'q-2', selectedOptionId: 'o-4' },
      ],
    });
    expect(
      (await (await passed.mod.POST(post(wrong), quizCtx)).json()).locked
    ).toBe(true);
    // 49 does not
    const almost = await loadQuiz(SUBMIT, {
      ...quizTables(lessonQuiz),
      quizSubmissions: [{ id: 's1', quizId: 'q1', traineeId: 't1', score: 49 }],
    });
    expect(
      (await (await almost.mod.POST(post(wrong), quizCtx)).json()).locked
    ).toBe(false);
  });

  it('the questions of a global quiz come without any solution before the submission', async () => {
    const { mod } = await loadQuiz(
      'trainee/quizzes/[quizId]',
      quizTables(globalQuiz)
    );
    const res = await mod.GET(
      getReq('http://localhost/api/trainee/quizzes/q1'),
      quizCtx
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.quiz.questions).toHaveLength(2);
    expect(findSolutionKeys(body)).toEqual([]);
    const text = JSON.stringify(body);
    expect(text).not.toContain(SECRET_1);
    expect(text).not.toContain(SECRET_2);
  });

  it('before a submission the review route answers 404 and carries no solution', async () => {
    const { mod } = await loadQuiz(SUBMIT, quizTables(globalQuiz));
    const res = await mod.GET(
      getReq('http://localhost/api/trainee/quizzes/q1/submit'),
      quizCtx
    );
    expect(res.status).toBe(404);
    expect(findSolutionKeys(await res.json())).toEqual([]);
  });

  it('a wrong answer set is refused without a solution and stores nothing', async () => {
    const { mod, mock } = await loadQuiz(SUBMIT, quizTables(globalQuiz));
    const res = await mod.POST(
      post([{ questionId: 'q-1', selectedOptionId: 'o-1' }]),
      quizCtx
    );
    expect(res.status).toBe(400);
    const text = JSON.stringify(await res.json());
    expect(text).not.toContain(SECRET_1);
    expect(mock.writes('insert', 'quizSubmissions')).toEqual([]);
  });

  it('the solution of a question comes back only after that question was answered', async () => {
    const { mod } = await loadQuiz(SUBMIT, {
      ...quizTables(globalQuiz),
      quizSubmissions: [{ id: 's1', quizId: 'q1', traineeId: 't1', score: 0 }],
      quizSubmissionAnswers: [
        { submissionId: 's1', questionId: 'q-1', selectedOptionId: 'o-2' },
      ],
    });
    const body = await (
      await mod.GET(
        getReq('http://localhost/api/trainee/quizzes/q1/submit'),
        quizCtx
      )
    ).json();
    expect(body.feedback.map((f: any) => f.questionId)).toEqual(['q-1']);
    expect(JSON.stringify(body)).not.toContain(SECRET_2);
  });

  it('a failed lesson quiz attempt does not give the key away', async () => {
    const { mod } = await loadQuiz(SUBMIT, quizTables(lessonQuiz));
    const body = await (await mod.POST(post(wrong), quizCtx)).json();
    expect(body.score).toBe(0);
    const text = JSON.stringify(body);
    expect(text).not.toContain(SECRET_1);
    expect(text).not.toContain('o-1');
  });
});

// ---------------------------------------------------------------------------
// R4: solution protection for trainees
// ---------------------------------------------------------------------------

describe('R4: a trainee never gets a solution document', () => {
  beforeEach(() => jest.clearAllMocks());

  const USE_CASE = 'bbbbbbb5-0000-4000-8000-000000000005';
  const ENABLER = 'bbbbbbb4-0000-4000-8000-000000000004';
  const doc = (overrides: Record<string, unknown> = {}) => ({
    id: 'd',
    useCaseId: USE_CASE,
    enablerId: null,
    organizationId: null,
    title: 'Dokument',
    description: null,
    documentType: 'THEORY',
    visibility: 'ALL',
    fileName: 'a.pdf',
    fileSize: 1,
    mimeType: 'application/pdf',
    storageUrl: 'https://example.test/storage/v1/object/public/content/a.pdf',
    orderIndex: 1,
    pageCount: 1,
    ...overrides,
  });
  const rows = [
    doc({ id: 'task' }),
    doc({ id: 'solution', documentType: 'TRAINER_SOLUTION' }),
    doc({ id: 'private', storageUrl: 'private://content-solutions/a.pdf' }),
    doc({ id: 'trainer-only', visibility: 'TRAINER_ONLY' }),
    doc({
      id: 'word',
      mimeType:
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    }),
    doc({ id: 'empty', storageUrl: '  ' }),
  ];

  async function loadDocs(routePath: string, tables: Record<string, any>) {
    jest.resetModules();
    const mock = createTableDb(tables);
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    mockSession(traineeSession('t1', { organizationId: ORG }));
    mockCatalogScope();
    const mod = await import(`@/app/api/${routePath}/route`);
    return { mock, mod };
  }

  it('use case documents: the task is listed, the model solution and every private reference are not', async () => {
    const { mod, mock } = await loadDocs(
      'trainee/use-cases/[useCaseId]/documents',
      {
        profiles: [{ id: 't1', role: 'TRAINEE', organizationId: ORG }],
        useCases: [
          { id: USE_CASE, courseId: 'c1', title: 'UC', isActive: true },
        ],
        courseMembers: [{ userId: 't1', courseId: 'c1' }],
        contentDocuments: rows,
      }
    );
    const res = await mod.GET(
      getReq(`http://localhost/api/trainee/use-cases/${USE_CASE}/documents`),
      { params: Promise.resolve({ useCaseId: USE_CASE }) }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    // the mock ignores where(): the route filters the rows once more itself
    expect(body.documents.map((d: any) => d.id)).not.toContain('solution');
    expect(body.documents.map((d: any) => d.id)).not.toContain('private');
    expect(body.documents.map((d: any) => d.id)).not.toContain('word');
    expect(body.documents.map((d: any) => d.id)).not.toContain('empty');
    expect(body.documents.map((d: any) => d.id)).toContain('task');
    const text = JSON.stringify(body);
    expect(text).not.toContain('private://');
    expect(text).not.toContain('TRAINER_SOLUTION');
    // and the query itself excludes them
    const where = mock.filters('select', 'content_documents');
    expect(where.params).toContain('TRAINER_SOLUTION');
    expect(where.sql).toContain('private://');
  });

  it('enabler documents: the same rule holds', async () => {
    const { mod } = await loadDocs('trainee/enablers/[enablerId]/documents', {
      profiles: [{ id: 't1', role: 'TRAINEE', organizationId: ORG }],
      enablers: [
        {
          id: ENABLER,
          courseId: 'c1',
          isActive: true,
          trainingCatalogId: FIAE,
        },
      ],
      courseMembers: [{ userId: 't1', courseId: 'c1' }],
      contentDocuments: rows.map(r => ({
        ...r,
        useCaseId: null,
        enablerId: ENABLER,
      })),
    });
    const res = await mod.GET(
      getReq(`http://localhost/api/trainee/enablers/${ENABLER}/documents`),
      { params: Promise.resolve({ enablerId: ENABLER }) }
    );
    const body = await res.json();
    expect(res.status).toBe(200);
    const ids = body.documents.map((d: any) => d.id);
    expect(ids).toContain('task');
    for (const hidden of [
      'solution',
      'private',
      'trainer-only',
      'word',
      'empty',
    ]) {
      expect(ids).not.toContain(hidden);
    }
    expect(JSON.stringify(body)).not.toContain('private://');
  });

  it('a trainer is not served by the trainee route (403)', async () => {
    jest.resetModules();
    const mock = createTableDb({});
    jest.doMock('@/db', () => ({ __esModule: true, default: mock.db }));
    mockSession(fakeSession({ id: 'tr1', organizationId: ORG }));
    mockCatalogScope();
    const mod =
      await import('@/app/api/trainee/enablers/[enablerId]/documents/route');
    const res = await mod.GET(
      getReq(`http://localhost/api/trainee/enablers/${ENABLER}/documents`),
      { params: Promise.resolve({ enablerId: ENABLER }) }
    );
    expect(res.status).toBe(403);
  });
});
