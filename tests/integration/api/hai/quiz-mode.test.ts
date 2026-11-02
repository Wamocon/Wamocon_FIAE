/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
  traineeSession,
  type FakeSession,
} from '../../../helpers/mockNext';
import { resetRateLimits } from '@/lib/rate-limit';
import { QUIZ_MODE_LIMITS } from '@/lib/hai/quizMode/limits';

// HAI quiz mode: POST /api/hai/quiz-mode/next and /answer. A practice without
// grading with the questions of the lesson quizzes. What this suite pins:
//  - the access rules of the real quiz (occupation, course membership, order of
//    work, active content, lesson quizzes only)
//  - the question before the attempt carries no solution (no is_correct, no
//    explanation, no list of the right options), in no field
//  - the answer route grades on the server, one or several options
//  - nothing is written (no submission, no progress)
//
// The database mock ignores where conditions, so each test sets the rows the
// route would get; the catalog filter itself is asserted on the rendered SQL.

const uid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

const FIAE = uid(0xa1);
const KFBM = uid(0xb1);
const C1 = uid(0xc1); // FIAE course
const C2 = uid(0xc2); // KfBM course
const E1 = uid(0xe1); // FIAE, open
const E2 = uid(0xe2); // FIAE, locked behind E1
const E3 = uid(0xe3); // KfBM
const Q1 = uid(0x51);
const Q2 = uid(0x52);
const Q3 = uid(0x53);
const T = uid(0x71); // trainee FIAE
const K = uid(0x72); // trainee KfBM
const TR = uid(0x73); // trainer

const opt = (
  n: number,
  questionId: string,
  over: Record<string, unknown> = {}
) => ({
  id: uid(0x1000 + n),
  questionId,
  optionText: `Option ${n}`,
  isCorrect: false,
  explanation: null,
  orderIndex: n,
  ...over,
});

// question id -> rows
const QA1 = uid(0x101); // single choice, right option 1, with explanation
const QA2 = uid(0x102); // multiple: options 11 and 12 are right
const QB1 = uid(0x103); // in the locked enabler E2
const QC1 = uid(0x104); // KfBM
const QT = uid(0x105); // free text
const QD = uid(0x106); // defective: no right option

const EXPLANATION = 'Darum ist Option 1 richtig: sie nennt den Schlüssel.';

const questionRow = (
  id: string,
  quizId: string,
  over: Record<string, unknown> = {}
) => ({
  id,
  quizId,
  questionText: `Text ${id.slice(-3)}`,
  questionType: 'MCQ',
  orderIndex: 0,
  ...over,
});

const OPTIONS = [
  opt(1, QA1, { isCorrect: true, explanation: EXPLANATION }),
  opt(2, QA1),
  opt(3, QA1),
  opt(11, QA2, { isCorrect: true, explanation: 'Beide Teile gehören dazu.' }),
  opt(12, QA2, { isCorrect: true }),
  opt(13, QA2),
  opt(21, QB1, { isCorrect: true }),
  opt(22, QB1),
  opt(31, QC1, { isCorrect: true }),
  opt(32, QC1),
  opt(41, QD),
  opt(42, QD),
];

const quizRow = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  isActive: true,
  quizType: 'LESSON',
  trainingCatalogId: FIAE,
  ...over,
});

import {
  computeCourseProgression,
  type ProgressionEnabler,
  type ProgressionQuizLink,
} from '@/lib/catalog/progression';

/** The progression of a course as loadCourseProgressions delivers it. */
function loadedCourse(
  courseId: string,
  enablers: Array<{
    id: string;
    title: string;
    orderIndex: number;
    quizId: string;
  }>,
  overrides: { quizIsActive?: boolean } = {}
) {
  const progressionEnablers: ProgressionEnabler[] = enablers.map(e => ({
    id: e.id,
    title: e.title,
    courseId,
    orderIndex: e.orderIndex,
    isActive: true,
  }));
  const quizLinks: ProgressionQuizLink[] = enablers.map(e => ({
    enablerId: e.id,
    quizId: e.quizId,
    difficulty: 'LOW',
    quizIsActive: overrides.quizIsActive ?? true,
    gradable: true,
  }));
  const bestScores = new Map<string, number>();
  return {
    progression: computeCourseProgression({
      courseId,
      enforced: true,
      enablers: progressionEnablers,
      quizLinks,
      bestScores,
    }),
    enablers: progressionEnablers,
    quizLinks,
    bestScores,
  };
}

const FIAE_COURSE_LOADED = () =>
  loadedCourse(C1, [
    { id: E1, title: 'SQL Grundlagen', orderIndex: 0, quizId: Q1 },
    { id: E2, title: 'Normalisierung', orderIndex: 1, quizId: Q2 },
  ]);
const KFBM_COURSE_LOADED = () =>
  loadedCourse(C2, [
    { id: E3, title: 'Rechnungsbearbeitung', orderIndex: 0, quizId: Q3 },
  ]);

type World = {
  tables?: Record<string, any[]>;
  progressions?: Record<string, ReturnType<typeof loadedCourse>>;
  scope?: {
    allowedCatalogIds: string[];
    activeCatalogId: string;
    selected: boolean;
  };
  contentCatalog?: Record<string, string>;
  proPlan?: boolean;
  session?: FakeSession | null;
};

const scopeOf = (...ids: string[]) => ({
  allowedCatalogIds: ids,
  activeCatalogId: ids[0],
  selected: false,
});

async function load(route: 'next' | 'answer', world: World = {}) {
  jest.resetModules();
  resetRateLimits();
  mockSession(world.session === undefined ? traineeSession(T) : world.session);
  const rec = createTableDb({
    courseMembers: [{ id: 'm1', courseId: C1, userId: T }],
    courses: [
      { id: C1, title: 'Datenbanken', isActive: true, trainingCatalogId: FIAE },
    ],
    enablers: [],
    enablerQuizLinks: [],
    quizzes: [quizRow(Q1), quizRow(Q2)],
    questions: [],
    options: OPTIONS,
    ...world.tables,
  });
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  jest.doMock('@/lib/auth-helpers', () => ({
    __esModule: true,
    ...(jest.requireActual('@/lib/auth-helpers') as object),
    requireProPlan: jest.fn(async () => world.proPlan !== false),
  }));
  const scope = world.scope ?? scopeOf(FIAE);
  const contentCatalog = world.contentCatalog ?? {};
  jest.doMock('@/lib/catalog/scope', () => {
    const actual = jest.requireActual('@/lib/catalog/scope') as any;
    const { NextResponse } = jest.requireActual('next/server') as any;
    return {
      __esModule: true,
      ...actual,
      requireCatalogScopeForUser: jest.fn(async () => scope),
      ensureContentInScope: jest.fn(
        async (s: any, kind: string, id: string) => {
          const catalogId = contentCatalog[`${kind}:${id}`];
          return catalogId && s.allowedCatalogIds.includes(catalogId)
            ? null
            : NextResponse.json({ error: 'Not found' }, { status: 404 });
        }
      ),
    };
  });
  const progressions = world.progressions ?? { [C1]: FIAE_COURSE_LOADED() };
  const requireQuizOpen = jest.fn();
  jest.doMock('@/lib/catalog/progression-db', () => {
    const actual = jest.requireActual('@/lib/catalog/progression-db') as any;
    const { NextResponse } = jest.requireActual('next/server') as any;
    requireQuizOpen.mockImplementation(async (...args: unknown[]) => {
      const [, enabler, quizId] = args as [
        string,
        { id: string; courseId: string },
        string,
      ];
      const loaded = progressions[enabler.courseId];
      const entry = loaded?.progression.enablers.find(
        (e: any) => e.enablerId === enabler.id
      );
      if (entry?.locked) {
        return { blocked: actual.enablerLockedResponse(entry), entry: null };
      }
      const chain = loaded
        ? actual
            .quizChainOf(loaded, enabler.id)
            .find((c: any) => c.quizId === quizId)
        : null;
      if (chain && !chain.unlocked) {
        return {
          blocked: NextResponse.json({ code: 'QUIZ_LOCKED' }, { status: 403 }),
          entry: null,
        };
      }
      return { blocked: null, entry: chain ?? null };
    });
    return {
      __esModule: true,
      ...actual,
      loadCourseProgressions: jest.fn(async (_user: string, ids: string[]) => {
        const map = new Map();
        for (const id of ids)
          if (progressions[id]) map.set(id, progressions[id]);
        return map;
      }),
      requireQuizOpen,
    };
  });
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const mod = (await import(`@/app/api/hai/quiz-mode/${route}/route`)) as any;
  return {
    POST: mod.POST as (req: any) => Promise<Response>,
    rec,
    requireQuizOpen,
  };
}

const post = (route: 'next' | 'answer', body: unknown) =>
  makeRequest('POST', `http://localhost/api/hai/quiz-mode/${route}`, {
    token: 't',
    body,
  });

/** The rows a mixed pool of the FIAE trainee needs. */
const FIAE_POOL: Record<string, any[]> = {
  questions: [
    questionRow(QA1, Q1),
    questionRow(QA2, Q1),
    questionRow(QT, Q1, { questionType: 'TEXT' }),
    questionRow(QD, Q1),
    questionRow(QB1, Q2),
  ],
};

/** Strings that mark a solution. None of them may be in a delivered question. */
function expectNoSolution(body: unknown) {
  const json = JSON.stringify(body);
  expect(json).not.toMatch(/isCorrect|is_correct|correctOption|explanation/i);
  expect(json).not.toContain(EXPLANATION);
  expect(json).not.toContain('Beide Teile gehören dazu.');
  expect(json).not.toMatch(/"correct"/);
}

function expectNoWrites(rec: Awaited<ReturnType<typeof load>>['rec']) {
  expect(rec.calls.filter(c => c.op !== 'select')).toEqual([]);
  for (const table of [
    'quizSubmissions',
    'quizSubmissionAnswers',
    'notifications',
  ]) {
    expect(rec.writes('insert', table)).toEqual([]);
  }
}

describe('POST /api/hai/quiz-mode/next', () => {
  beforeEach(() => jest.clearAllMocks());

  it('answers 401 without a session', async () => {
    const { POST } = await load('next', { session: null });
    const res = await POST(post('next', {}));
    expect(res.status).toBe(401);
  });

  it('answers 403 without the PRO plan, like the chat', async () => {
    const { POST, rec } = await load('next', { proPlan: false });
    const res = await POST(post('next', {}));
    expect(res.status).toBe(403);
    expect(rec.db.select).not.toHaveBeenCalled();
  });

  it.each([
    ['an enabler id that is no uuid', { enablerId: 'abc' }],
    ['a history with a non uuid', { exclude: ['x'] }],
    ['a topic that is a number', { topic: 5 }],
    ['a body that is no object', 'text'],
  ])('answers 400 for %s and reads nothing', async (_name, body) => {
    const { POST, rec } = await load('next');
    const res = await POST(post('next', body));
    expect(res.status).toBe(400);
    expect(rec.db.select).not.toHaveBeenCalled();
  });

  it('answers 400 for a body that is no JSON', async () => {
    const { POST } = await load('next');
    const req = makeRequest('POST', 'http://localhost/api/hai/quiz-mode/next', {
      token: 't',
    });
    req.json = async () => {
      throw new SyntaxError('bad json');
    };
    expect((await POST(req)).status).toBe(400);
  });

  it('limits the calls per person and answers 429 with Retry-After', async () => {
    const { POST } = await load('next');
    for (let i = 0; i < QUIZ_MODE_LIMITS.next.limit; i++) {
      expect((await POST(post('next', { enablerId: 'bad' }))).status).toBe(400);
    }
    const res = await POST(post('next', { enablerId: 'bad' }));
    expect(res.status).toBe(429);
    expect(Number(res.headers.get('Retry-After'))).toBeGreaterThanOrEqual(1);
  });

  it('delivers a question of an open enabler without any solution field', async () => {
    const { POST, rec } = await load('next', {
      tables: { ...FIAE_POOL },
    });
    const res = await POST(post('next', {}));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body.status).toBe('ok');
    expect(Object.keys(body).sort()).toEqual([
      'question',
      'remaining',
      'status',
      'total',
    ]);
    expect(Object.keys(body.question).sort()).toEqual([
      'courseTitle',
      'enablerHref',
      'enablerId',
      'enablerTitle',
      'id',
      'multiple',
      'options',
      'text',
    ]);
    for (const option of body.question.options) {
      expect(Object.keys(option).sort()).toEqual(['id', 'text']);
    }
    expectNoSolution(body);
    expect(body.question.enablerId).toBe(E1);
    expect(body.question.enablerHref).toBe(`/trainee/enablers/${E1}`);
    expectNoWrites(rec);
  });

  it('serves only questions of the open enabler: not the locked one, not free text, not a defective one', async () => {
    const { POST } = await load('next', { tables: { ...FIAE_POOL } });
    const served = new Set<string>();
    // The pool has two askable questions in the open enabler: QA1 and QA2
    for (let i = 0; i < 12; i++) {
      const body = await (await POST(post('next', {}))).json();
      served.add(body.question.id);
    }
    expect([...served].sort()).toEqual([QA1, QA2].sort());
  });

  it('counts the pool without the locked enabler and the free text question', async () => {
    const { POST } = await load('next', { tables: { ...FIAE_POOL } });
    const body = await (await POST(post('next', {}))).json();
    // QA1, QA2 and the defective QD are candidates, QT and QB1 are not
    expect(body.total).toBe(3);
  });

  it('marks a question with more than one right option as multiple', async () => {
    const { POST } = await load('next', { tables: { ...FIAE_POOL } });
    const body = await (await POST(post('next', { exclude: [QA1] }))).json();
    expect(body.question.id).toBe(QA2);
    expect(body.question.multiple).toBe(true);
    expectNoSolution(body);
  });

  it('shuffles the options (not always the order of the author)', async () => {
    const { POST } = await load('next', { tables: { ...FIAE_POOL } });
    const orders = new Set<string>();
    for (let i = 0; i < 25; i++) {
      const body = await (await POST(post('next', { exclude: [QA2] }))).json();
      orders.add(body.question.options.map((o: any) => o.id).join());
    }
    expect(orders.size).toBeGreaterThan(1);
  });

  it('does not repeat a question of the history and reports when all are through', async () => {
    const { POST } = await load('next', { tables: { ...FIAE_POOL } });
    const first = await (await POST(post('next', { exclude: [QA1] }))).json();
    expect(first.question.id).toBe(QA2);
    const done = await (
      await POST(post('next', { exclude: [QA1, QA2] }))
    ).json();
    expect(done).toEqual({ status: 'exhausted', question: null, total: 3 });
  });

  it('narrows by topic and says so when nothing fits', async () => {
    const { POST } = await load('next', { tables: { ...FIAE_POOL } });
    const fit = await (await POST(post('next', { topic: 'SQL' }))).json();
    expect(fit.status).toBe('ok');
    const none = await (await POST(post('next', { topic: 'Kochen' }))).json();
    expect(none).toEqual({
      status: 'empty',
      question: null,
      reason: 'no_topic_match',
    });
  });

  it('says there is no content when the trainee has no course', async () => {
    const { POST } = await load('next', {
      tables: { courseMembers: [], ...FIAE_POOL },
    });
    const body = await (await POST(post('next', {}))).json();
    expect(body).toEqual({
      status: 'empty',
      question: null,
      reason: 'no_content',
    });
  });

  it('limits the courses to the occupation of the person (rendered SQL)', async () => {
    const { POST, rec } = await load('next', { tables: { ...FIAE_POOL } });
    await POST(post('next', {}));
    const filter = rec.filters('select', 'courses');
    expect(filter.sql).toMatch(/training_catalog_id/);
    expect(filter.params).toContain(FIAE);
    expect(filter.params).not.toContain(KFBM);
  });

  it('serves only courses the trainee is a member of (rendered SQL)', async () => {
    const { POST, rec } = await load('next', { tables: { ...FIAE_POOL } });
    await POST(post('next', {}));
    const members = rec.filters('select', 'courseMembers');
    expect(members.params).toContain(T);
    const courses = rec.filters('select', 'courses');
    expect(courses.params).toContain(C1);
    expect(courses.params).not.toContain(C2);
  });

  it('drops a quiz that lies outside the occupation, even if it is linked', async () => {
    const { POST } = await load('next', {
      tables: {
        ...FIAE_POOL,
        quizzes: [quizRow(Q1, { trainingCatalogId: KFBM }), quizRow(Q2)],
      },
    });
    const body = await (await POST(post('next', {}))).json();
    expect(body).toEqual({
      status: 'empty',
      question: null,
      reason: 'no_content',
    });
  });

  it('drops a global quiz and an inactive quiz', async () => {
    const globalOnly = await load('next', {
      tables: {
        ...FIAE_POOL,
        quizzes: [quizRow(Q1, { quizType: 'GLOBAL' }), quizRow(Q2)],
      },
    });
    expect(
      (await (await globalOnly.POST(post('next', {}))).json()).status
    ).toBe('empty');
    const inactive = await load('next', {
      tables: {
        ...FIAE_POOL,
        quizzes: [quizRow(Q1, { isActive: false }), quizRow(Q2)],
      },
    });
    expect((await (await inactive.POST(post('next', {}))).json()).status).toBe(
      'empty'
    );
  });

  describe('with an enabler named by the chat', () => {
    it('serves that enabler only', async () => {
      const { POST } = await load('next', {
        tables: {
          ...FIAE_POOL,
          enablers: [{ id: E1, courseId: C1, isActive: true }],
        },
        contentCatalog: { [`enabler:${E1}`]: FIAE },
      });
      for (let i = 0; i < 8; i++) {
        const body = await (await POST(post('next', { enablerId: E1 }))).json();
        expect(body.status).toBe('ok');
        expect(body.question.enablerId).toBe(E1);
      }
    });

    it('answers 404 for an enabler of another occupation (KfBM for a FIAE trainee)', async () => {
      const { POST, rec } = await load('next', {
        tables: { ...FIAE_POOL },
        contentCatalog: { [`enabler:${E3}`]: KFBM },
      });
      const res = await POST(post('next', { enablerId: E3 }));
      expect(res.status).toBe(404);
      expect(JSON.stringify(await res.json())).not.toMatch(/Rechnung/);
      // not a single question was read
      expect(rec.filters('select', 'questions').sql).toBe('');
    });

    it('answers 404 for an enabler id that does not exist', async () => {
      const { POST } = await load('next', { tables: { ...FIAE_POOL } });
      const res = await POST(post('next', { enablerId: uid(0xdead) }));
      expect(res.status).toBe(404);
    });

    it('answers 403 ENABLER_LOCKED for a locked enabler, without a question', async () => {
      const { POST } = await load('next', {
        tables: {
          ...FIAE_POOL,
          enablers: [{ id: E2, courseId: C1, isActive: true }],
        },
        contentCatalog: { [`enabler:${E2}`]: FIAE },
      });
      const res = await POST(post('next', { enablerId: E2 }));
      expect(res.status).toBe(403);
      const body = await res.json();
      expect(body.code).toBe('ENABLER_LOCKED');
      expect(JSON.stringify(body)).not.toMatch(/Text 103|Option 21/);
    });

    it('answers 403 when the trainee is no member of the course of the enabler', async () => {
      const { POST } = await load('next', {
        tables: {
          ...FIAE_POOL,
          courseMembers: [{ id: 'm9', courseId: C2, userId: T }],
          enablers: [{ id: E1, courseId: C1, isActive: true }],
        },
        contentCatalog: { [`enabler:${E1}`]: FIAE },
      });
      const res = await POST(post('next', { enablerId: E1 }));
      expect(res.status).toBe(403);
    });
  });

  describe('as a trainer', () => {
    const trainerWorld = (): World => ({
      session: fakeSession({ id: TR, role: 'TRAINER' }),
      scope: scopeOf(FIAE, KFBM),
      tables: {
        courses: [
          {
            id: C1,
            title: 'Datenbanken',
            isActive: true,
            trainingCatalogId: FIAE,
          },
          {
            id: C2,
            title: 'Rechnungswesen',
            isActive: true,
            trainingCatalogId: KFBM,
          },
        ],
        enablers: [
          { id: E1, title: 'SQL Grundlagen', courseId: C1 },
          { id: E2, title: 'Normalisierung', courseId: C1 },
          { id: E3, title: 'Rechnungsbearbeitung', courseId: C2 },
        ],
        enablerQuizLinks: [
          { enablerId: E1, quizId: Q1 },
          { enablerId: E2, quizId: Q2 },
          { enablerId: E3, quizId: Q3 },
        ],
        quizzes: [
          quizRow(Q1),
          quizRow(Q2),
          quizRow(Q3, { trainingCatalogId: KFBM }),
        ],
        questions: [
          questionRow(QA1, Q1),
          questionRow(QB1, Q2),
          questionRow(QC1, Q3),
        ],
      },
    });

    it('may be asked from the occupations of the organization, locked enablers included', async () => {
      const { POST, rec } = await load('next', trainerWorld());
      const body = await (await POST(post('next', {}))).json();
      expect(body.status).toBe('ok');
      expect(body.total).toBe(3);
      expect(body.question.enablerHref).toBeNull();
      expectNoSolution(body);
      // no membership query, no order of work for a trainer
      expect(rec.filters('select', 'courseMembers').sql).toBe('');
      expectNoWrites(rec);
    });

    it('is limited to the occupations in the scope (rendered SQL)', async () => {
      const world = trainerWorld();
      world.scope = scopeOf(FIAE);
      const { POST, rec } = await load('next', world);
      await POST(post('next', {}));
      const filter = rec.filters('select', 'courses');
      expect(filter.params).toContain(FIAE);
      expect(filter.params).not.toContain(KFBM);
    });

    it('can narrow to one enabler', async () => {
      const world = trainerWorld();
      world.contentCatalog = { [`enabler:${E2}`]: FIAE };
      world.tables!.enablers = [
        { id: E2, title: 'Normalisierung', courseId: C1, isActive: true },
      ];
      world.tables!.courses = [
        {
          id: C1,
          title: 'Datenbanken',
          isActive: true,
          trainingCatalogId: FIAE,
        },
      ];
      const { POST } = await load('next', world);
      const body = await (await POST(post('next', { enablerId: E2 }))).json();
      expect(body.status).toBe('ok');
      expect(body.question.enablerId).toBe(E2);
      expect(body.total).toBe(1);
    });
  });

  it('answers 500 without detail when the database fails, and logs no option text', async () => {
    const { POST, rec } = await load('next', { tables: { ...FIAE_POOL } });
    (rec.db.select as jest.Mock).mockImplementation(() => {
      throw new Error('db down');
    });
    const res = await POST(post('next', {}));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
  });
});

describe('POST /api/hai/quiz-mode/answer', () => {
  beforeEach(() => jest.clearAllMocks());

  /** The rows of the chain question, quiz, link, enabler, course for one question. */
  const chain = (over: Record<string, any> = {}): Record<string, any[]> => ({
    questions: [questionRow(QA1, Q1)],
    quizzes: [quizRow(Q1)],
    enablerQuizLinks: [{ enablerId: E1 }],
    enablers: [
      { id: E1, title: 'SQL Grundlagen', courseId: C1, isActive: true },
    ],
    courses: [
      { id: C1, title: 'Datenbanken', isActive: true, trainingCatalogId: FIAE },
    ],
    ...over,
  });

  const answer = (questionId: string, optionIds: string[]) =>
    post('answer', { questionId, optionIds });

  it('answers 401 without a session', async () => {
    const { POST } = await load('answer', { session: null });
    expect((await POST(answer(QA1, [uid(0x1001)]))).status).toBe(401);
  });

  it('answers 403 without the PRO plan', async () => {
    const { POST } = await load('answer', { proPlan: false, tables: chain() });
    expect((await POST(answer(QA1, [uid(0x1001)]))).status).toBe(403);
  });

  it.each([
    ['no question id', { optionIds: [uid(0x1001)] }],
    [
      'a question id that is no uuid',
      { questionId: 'x', optionIds: [uid(0x1001)] },
    ],
    ['no options', { questionId: QA1, optionIds: [] }],
    ['an option id that is no uuid', { questionId: QA1, optionIds: ['x'] }],
    [
      'the same option twice',
      { questionId: QA1, optionIds: [uid(0x1001), uid(0x1001)] },
    ],
  ])('answers 400 for %s and reads nothing', async (_name, body) => {
    const { POST, rec } = await load('answer', { tables: chain() });
    const res = await POST(post('answer', body));
    expect(res.status).toBe(400);
    expect(rec.db.select).not.toHaveBeenCalled();
  });

  it('is right for the right option, and returns the solution and the explanation after the attempt', async () => {
    const { POST, rec } = await load('answer', { tables: chain() });
    const res = await POST(answer(QA1, [uid(0x1001)]));
    expect(res.status).toBe(200);
    expect(res.headers.get('Cache-Control')).toBe('no-store');
    const body = await res.json();
    expect(body).toEqual({
      correct: true,
      selectedOptionIds: [uid(0x1001)],
      correctOptionIds: [uid(0x1001)],
      explanation: EXPLANATION,
      multiple: false,
      enablerId: E1,
    });
    expectNoWrites(rec);
  });

  it('is wrong for another option, and still gives the right one', async () => {
    const { POST } = await load('answer', { tables: chain() });
    const body = await (await POST(answer(QA1, [uid(0x1002)]))).json();
    expect(body.correct).toBe(false);
    expect(body.correctOptionIds).toEqual([uid(0x1001)]);
    expect(body.explanation).toBe(EXPLANATION);
  });

  describe('a question with several right options', () => {
    const multi = () => chain({ questions: [questionRow(QA2, Q1)] });

    it('is right only with exactly all right options', async () => {
      const { POST } = await load('answer', { tables: multi() });
      const body = await (
        await POST(answer(QA2, [uid(0x100c), uid(0x100b)]))
      ).json();
      expect(body.correct).toBe(true);
      expect(body.multiple).toBe(true);
      expect(body.correctOptionIds.sort()).toEqual(
        [uid(0x100b), uid(0x100c)].sort()
      );
    });

    it.each([
      ['one of the right options', [uid(0x100b)]],
      [
        'the right ones and a wrong one',
        [uid(0x100b), uid(0x100c), uid(0x100d)],
      ],
      ['only the wrong one', [uid(0x100d)]],
    ])('is wrong with %s', async (_name, ids) => {
      const { POST } = await load('answer', { tables: multi() });
      expect((await (await POST(answer(QA2, ids))).json()).correct).toBe(false);
    });
  });

  it('answers 400 for an option of another question', async () => {
    const { POST } = await load('answer', { tables: chain() });
    // option 21 belongs to the question QB1, not to QA1
    const res = await POST(answer(QA1, [uid(0x1015)]));
    expect(res.status).toBe(400);
    expect(JSON.stringify(await res.json())).not.toMatch(/correct/i);
  });

  it('answers 400 when two options are sent for a choice question', async () => {
    const { POST } = await load('answer', { tables: chain() });
    const res = await POST(answer(QA1, [uid(0x1001), uid(0x1002)]));
    expect(res.status).toBe(400);
  });

  it('answers 404 for a question that does not exist, and for free text', async () => {
    const missing = await load('answer', { tables: chain({ questions: [] }) });
    expect((await missing.POST(answer(uid(0x999), [uid(0x1001)]))).status).toBe(
      404
    );
    const text = await load('answer', {
      tables: chain({
        questions: [questionRow(QT, Q1, { questionType: 'TEXT' })],
      }),
    });
    expect((await text.POST(answer(QT, [uid(0x1001)]))).status).toBe(404);
  });

  it('answers 404 for a question of another occupation: the quiz and the course', async () => {
    const quizOutside = await load('answer', {
      tables: chain({ quizzes: [quizRow(Q1, { trainingCatalogId: KFBM })] }),
    });
    const res = await quizOutside.POST(answer(QA1, [uid(0x1001)]));
    expect(res.status).toBe(404);
    expect(JSON.stringify(await res.json())).not.toMatch(/Option|Darum/);

    const courseOutside = await load('answer', {
      tables: chain({
        courses: [
          { id: C1, title: 'X', isActive: true, trainingCatalogId: KFBM },
        ],
      }),
    });
    expect((await courseOutside.POST(answer(QA1, [uid(0x1001)]))).status).toBe(
      404
    );
  });

  it('answers 404 for a global quiz, an inactive quiz, an inactive enabler, an inactive course', async () => {
    const cases: Array<Record<string, any[]>> = [
      chain({ quizzes: [quizRow(Q1, { quizType: 'GLOBAL' })] }),
      chain({ quizzes: [quizRow(Q1, { isActive: false })] }),
      chain({
        enablers: [{ id: E1, title: 'X', courseId: C1, isActive: false }],
      }),
      chain({
        courses: [
          { id: C1, title: 'X', isActive: false, trainingCatalogId: FIAE },
        ],
      }),
      chain({ enablerQuizLinks: [] }),
    ];
    for (const tables of cases) {
      const { POST } = await load('answer', { tables });
      expect((await POST(answer(QA1, [uid(0x1001)]))).status).toBe(404);
    }
  });

  it('answers 403 for a trainee who is no member of the course', async () => {
    const { POST } = await load('answer', {
      tables: chain({ courseMembers: [] }),
    });
    const res = await POST(answer(QA1, [uid(0x1001)]));
    expect(res.status).toBe(403);
    expect(JSON.stringify(await res.json())).not.toMatch(/correct|Darum/);
  });

  it('answers 403 ENABLER_LOCKED for a question of a locked enabler, with no solution', async () => {
    const { POST, requireQuizOpen } = await load('answer', {
      tables: chain({
        questions: [questionRow(QB1, Q2)],
        quizzes: [quizRow(Q2)],
        enablers: [
          { id: E2, title: 'Normalisierung', courseId: C1, isActive: true },
        ],
      }),
    });
    const res = await POST(answer(QB1, [uid(0x1015)]));
    expect(res.status).toBe(403);
    const body = await res.json();
    expect(body.code).toBe('ENABLER_LOCKED');
    expect(JSON.stringify(body)).not.toMatch(/correctOption|explanation/);
    expect(requireQuizOpen).toHaveBeenCalledWith(
      T,
      { id: E2, courseId: C1 },
      Q2
    );
  });

  it('lets a trainer answer without membership and without the order of work', async () => {
    const { POST, requireQuizOpen, rec } = await load('answer', {
      session: fakeSession({ id: TR, role: 'TRAINER' }),
      scope: scopeOf(FIAE, KFBM),
      tables: chain({
        questions: [questionRow(QB1, Q2)],
        quizzes: [quizRow(Q2)],
        enablers: [
          { id: E2, title: 'Normalisierung', courseId: C1, isActive: true },
        ],
        courseMembers: [],
      }),
    });
    const res = await POST(answer(QB1, [uid(0x1015)]));
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.correct).toBe(true);
    expect(requireQuizOpen).not.toHaveBeenCalled();
    expectNoWrites(rec);
  });

  it('limits the calls per person and answers 429', async () => {
    const { POST } = await load('answer', { tables: chain() });
    for (let i = 0; i < QUIZ_MODE_LIMITS.answer.limit; i++) {
      await POST(post('answer', {}));
    }
    expect((await POST(post('answer', {}))).status).toBe(429);
  });

  it('answers 500 without detail when the database fails', async () => {
    const { POST, rec } = await load('answer', { tables: chain() });
    (rec.db.select as jest.Mock).mockImplementation(() => {
      throw new Error('db down');
    });
    const res = await POST(answer(QA1, [uid(0x1001)]));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({ error: 'Internal Server Error' });
  });
});
