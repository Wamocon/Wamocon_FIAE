// Table rows for a trainee in a course with the order of work in force: the
// course c1 of the catalog cat1 has the enablers e1 (first) and e2 (second),
// e1 has the quiz q1, e2 has q2 (LOW) and q3 (MEDIUM). The trainee t1 joined
// the catalog after the cut-off date, so the order applies.
//
// createTableDb answers every select of a table with the same rows, so the
// route under test reads the FIRST row as "its" enabler or quiz: pass the one
// the route works on as `target`.

export type WorldOptions = {
  /** The enabler the route works on (first row of enablers). */
  target?: 'e1' | 'e2';
  /** The lesson quiz the route works on (first row of quizzes and links). */
  targetQuiz?: 'q1' | 'q2' | 'q3';
  /** Does the order apply to the trainee (joined after the cut-off date)? */
  enforced?: boolean;
  /** Best scores already reached, by quiz id. */
  scores?: Record<string, number>;
  /** The exception of the trainee for an enabler (true, false, null). */
  overrides?: Array<{ enablerId: string; isActive: boolean | null }>;
  /** Use enablers e1 and e2 as inactive? */
  inactive?: Array<'e1' | 'e2'>;
};

const E = {
  e1: { id: 'e1', courseId: 'c1', title: 'Enabler Eins', orderIndex: 1 },
  e2: { id: 'e2', courseId: 'c1', title: 'Enabler Zwei', orderIndex: 2 },
};
const LINKS = {
  q1: { enablerId: 'e1', quizId: 'q1', difficulty: 'LOW' },
  q2: { enablerId: 'e2', quizId: 'q2', difficulty: 'LOW' },
  q3: { enablerId: 'e2', quizId: 'q3', difficulty: 'MEDIUM' },
};
const QUIZZES = {
  q1: { id: 'q1', title: 'Quiz 1', isActive: true, quizType: 'LESSON' },
  q2: { id: 'q2', title: 'Quiz 2', isActive: true, quizType: 'LESSON' },
  q3: { id: 'q3', title: 'Quiz 3', isActive: true, quizType: 'LESSON' },
};

export function progressionWorld(options: WorldOptions = {}) {
  const target = options.target ?? 'e2';
  const targetQuiz = options.targetQuiz ?? 'q2';
  const enforced = options.enforced ?? true;
  const inactive = new Set(options.inactive ?? []);
  const first = <T>(all: T[], pick: (x: T) => boolean) => [
    ...all.filter(pick),
    ...all.filter(x => !pick(x)),
  ];

  const enablers = first(
    (['e1', 'e2'] as const).map(id => ({
      ...E[id],
      isActive: !inactive.has(id),
      descriptionText: 'Material text',
      scenarioPdfUrl: null,
      pptUrl: null,
      videoUrl: null,
    })),
    e => e.id === target
  );
  const quizIds = ['q1', 'q2', 'q3'] as const;
  return {
    courses: [
      {
        id: 'c1',
        title: 'Kurs',
        trainingCatalogId: 'cat1',
        createdById: 'tr1',
        isActive: true,
      },
    ],
    trainingCatalogs: [
      {
        id: 'cat1',
        settings: { sequence_since: '2026-11-01T00:00:00.000Z' },
      },
    ],
    // joined after the cut-off date (order applies) or before (grandfathered)
    traineeEnrollments: [
      {
        trainingCatalogId: 'cat1',
        createdAt: new Date(
          enforced ? '2026-11-05T08:00:00Z' : '2026-10-05T08:00:00Z'
        ),
      },
    ],
    profiles: [{ organizationId: 'org1', createdAt: new Date('2020-01-01') }],
    courseMembers: [{ userId: 't1', courseId: 'c1', role: 'TRAINEE' }],
    enablers,
    enablerQuizLinks: first(
      quizIds.map(id => LINKS[id]),
      l => l.quizId === targetQuiz
    ),
    quizzes: first(
      quizIds.map(id => QUIZZES[id]),
      q => q.id === targetQuiz
    ),
    quizSubmissions: Object.entries(options.scores ?? {}).map(
      ([quizId, score]) => ({ quizId, traineeId: 't1', score })
    ),
    traineeEnablerOverrides: (options.overrides ?? []).map(o => ({
      traineeId: 't1',
      ...o,
    })),
    enablerSubmissions: [],
    useCaseSubmissions: [],
    questions: [
      { id: 'qq1', quizId: targetQuiz, questionText: 'Q?', orderIndex: 1 },
    ],
    options: [
      { id: 'oo1', questionId: 'qq1', optionText: 'A', isCorrect: true },
      { id: 'oo2', questionId: 'qq1', optionText: 'B', isCorrect: false },
    ],
  };
}
