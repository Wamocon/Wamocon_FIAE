import {
  PASS_THRESHOLD,
  bestScoresOf,
  byCourseOrder,
  computeCourseProgression,
  computeQuizChain,
  hasRequiredQuiz,
  isEnablerCompleted,
  isQuizRequired,
  isQuizPassed,
  isSequenceEnforced,
  readSequenceSince,
  type CourseProgressionInput,
  type ProgressionEnabler,
  type ProgressionQuizLink,
} from '@/lib/catalog/progression';

const enabler = (
  id: string,
  orderIndex: number,
  extra: Partial<ProgressionEnabler> = {}
): ProgressionEnabler => ({
  id,
  title: `Enabler ${id}`,
  courseId: 'c1',
  orderIndex,
  isActive: true,
  ...extra,
});

const link = (
  enablerId: string,
  quizId: string,
  difficulty: ProgressionQuizLink['difficulty'] = 'LOW',
  quizIsActive = true,
  gradable = true
): ProgressionQuizLink => ({
  enablerId,
  quizId,
  difficulty,
  quizIsActive,
  gradable,
});

const run = (input: Partial<CourseProgressionInput>) =>
  computeCourseProgression({
    courseId: 'c1',
    enforced: true,
    enablers: [],
    quizLinks: [],
    bestScores: new Map(),
    ...input,
  });

const states = (p: ReturnType<typeof run>) =>
  p.enablers.map(e => `${e.enablerId}:${e.state}`);

describe('quiz passing and the definition of a completed enabler', () => {
  it('passes at 50 percent, not below', () => {
    expect(PASS_THRESHOLD).toBe(50);
    expect(isQuizPassed(50)).toBe(true);
    expect(isQuizPassed(49)).toBe(false);
    expect(isQuizPassed(undefined)).toBe(false);
    expect(isQuizPassed(null)).toBe(false);
  });

  it('keeps the best score per quiz', () => {
    const best = bestScoresOf([
      { quizId: 'q1', score: 20 },
      { quizId: 'q1', score: 80 },
      { quizId: 'q1', score: 60 },
      { quizId: 'q2', score: null },
    ]);
    expect(best.get('q1')).toBe(80);
    expect(best.get('q2')).toBe(0);
  });

  it('is completed without a quiz (content only)', () => {
    expect(isEnablerCompleted([], new Map())).toBe(true);
    expect(hasRequiredQuiz([])).toBe(false);
  });

  it('needs every active quiz passed', () => {
    const links = [link('e1', 'q1', 'LOW'), link('e1', 'q2', 'MEDIUM')];
    expect(isEnablerCompleted(links, new Map([['q1', 90]]))).toBe(false);
    expect(
      isEnablerCompleted(
        links,
        new Map([
          ['q1', 90],
          ['q2', 49],
        ])
      )
    ).toBe(false);
    expect(
      isEnablerCompleted(
        links,
        new Map([
          ['q1', 90],
          ['q2', 50],
        ])
      )
    ).toBe(true);
  });

  it('ignores an inactive quiz, it does not exist for the trainee', () => {
    const links = [link('e1', 'q1', 'LOW', false)];
    expect(isEnablerCompleted(links, new Map())).toBe(true);
    expect(hasRequiredQuiz(links)).toBe(false);
  });

  describe('a quiz without a gradable question is no prerequisite', () => {
    it('is not required, whatever the attempts are', () => {
      expect(isQuizRequired(link('e1', 'q1'))).toBe(true);
      expect(isQuizRequired(link('e1', 'q1', 'LOW', true, false))).toBe(false);
      expect(isQuizRequired(link('e1', 'q1', 'LOW', false, true))).toBe(false);
      // an old row without the flag counts as gradable (the safe side)
      expect(
        isQuizRequired({
          enablerId: 'e1',
          quizId: 'q1',
          difficulty: 'LOW',
          quizIsActive: true,
        })
      ).toBe(true);
    });

    it('an enabler with only such quizzes is completed without any attempt', () => {
      const links = [
        link('e1', 'q1', 'LOW', true, false),
        link('e1', 'q2', 'MEDIUM', true, false),
      ];
      expect(isEnablerCompleted(links, new Map())).toBe(true);
      expect(hasRequiredQuiz(links)).toBe(false);
    });

    it('is completed when every gradable quiz is passed, the other one is ignored', () => {
      const links = [
        link('e1', 'q1', 'LOW', true, true),
        link('e1', 'q2', 'MEDIUM', true, false),
      ];
      expect(isEnablerCompleted(links, new Map())).toBe(false);
      expect(isEnablerCompleted(links, new Map([['q1', 49]]))).toBe(false);
      expect(isEnablerCompleted(links, new Map([['q1', 50]]))).toBe(true);
      expect(hasRequiredQuiz(links)).toBe(true);
    });

    it('does not block the next enabler of the order', () => {
      const p = run({
        enablers: [enabler('e1', 1), enabler('e2', 2)],
        quizLinks: [
          link('e1', 'q1', 'LOW', true, false),
          link('e2', 'q2', 'LOW'),
        ],
      });
      expect(states(p)).toEqual(['e1:completed', 'e2:open']);
      expect(p.completedCount).toBe(1);
    });

    it('a gradable quiz still blocks, the ungradable one beside it does not', () => {
      const p = run({
        enablers: [enabler('e1', 1), enabler('e2', 2)],
        quizLinks: [
          link('e1', 'q1', 'LOW'),
          link('e1', 'q1b', 'MEDIUM', true, false),
          link('e2', 'q2', 'LOW'),
        ],
      });
      expect(states(p)).toEqual(['e1:open', 'e2:locked']);
      const done = run({
        enablers: [enabler('e1', 1), enabler('e2', 2)],
        quizLinks: [
          link('e1', 'q1', 'LOW'),
          link('e1', 'q1b', 'MEDIUM', true, false),
          link('e2', 'q2', 'LOW'),
        ],
        bestScores: new Map([['q1', 50]]),
      });
      expect(states(done)).toEqual(['e1:completed', 'e2:open']);
    });

    it('such an enabler counts as content only, so an earlier open enabler still locks it', () => {
      // it was never "really" completed (nothing to pass), like a content only enabler
      const p = run({
        enablers: [enabler('e1', 1), enabler('e2', 2)],
        quizLinks: [
          link('e1', 'q1', 'LOW'),
          link('e2', 'q2', 'LOW', true, false),
        ],
      });
      expect(states(p)).toEqual(['e1:open', 'e2:locked']);
    });
  });

  it('does not look at scenarios or use cases: only quizzes are input', () => {
    // The function has no parameter for a scenario submission, so an enabler
    // with a scenario (even a rejected one) completes through its quizzes
    expect(isEnablerCompleted([link('e1', 'q1')], new Map([['q1', 70]]))).toBe(
      true
    );
  });
});

describe('order of the enablers inside a course', () => {
  const three = [enabler('e1', 1), enabler('e2', 2), enabler('e3', 3)];
  const quizzes = [link('e1', 'q1'), link('e2', 'q2'), link('e3', 'q3')];

  it('opens the first active enabler, locks the others with the reason', () => {
    const p = run({ enablers: three, quizLinks: quizzes });
    expect(states(p)).toEqual(['e1:open', 'e2:locked', 'e3:locked']);
    expect(p.enablers[1]).toMatchObject({
      locked: true,
      lockReason: 'SEQUENCE',
      lockedBy: { enablerId: 'e1', title: 'Enabler e1' },
    });
    // the first enabler to finish, also for the one behind
    expect(p.enablers[2].lockedBy).toEqual({
      enablerId: 'e1',
      title: 'Enabler e1',
    });
    expect(p.enablers[0].lockedBy).toBeNull();
  });

  it('opens the next enabler when the one before is passed', () => {
    const p = run({
      enablers: three,
      quizLinks: quizzes,
      bestScores: new Map([['q1', 50]]),
    });
    expect(states(p)).toEqual(['e1:completed', 'e2:open', 'e3:locked']);
    expect(p.enablers[2].lockedBy?.enablerId).toBe('e2');
    expect(p.completedCount).toBe(1);
    expect(p.totalCount).toBe(3);
  });

  it('keeps the next enabler locked after a failed attempt, the quiz can be repeated', () => {
    const failed = run({
      enablers: three,
      quizLinks: quizzes,
      bestScores: new Map([['q1', 30]]),
    });
    expect(states(failed)).toEqual(['e1:open', 'e2:locked', 'e3:locked']);
    // the repetition that passes opens it
    const passed = run({
      enablers: three,
      quizLinks: quizzes,
      bestScores: new Map([['q1', 30 + 40]]),
    });
    expect(states(passed)).toEqual(['e1:completed', 'e2:open', 'e3:locked']);
  });

  it('is all completed when everything is passed', () => {
    const p = run({
      enablers: three,
      quizLinks: quizzes,
      bestScores: new Map([
        ['q1', 100],
        ['q2', 100],
        ['q3', 100],
      ]),
    });
    expect(states(p)).toEqual(['e1:completed', 'e2:completed', 'e3:completed']);
  });

  it('sorts by order_index and breaks a tie by id', () => {
    const p = run({
      enablers: [enabler('b', 2), enabler('z', 1), enabler('a', 1)],
      quizLinks: [link('a', 'qa'), link('z', 'qz'), link('b', 'qb')],
    });
    expect(p.enablers.map(e => e.enablerId)).toEqual(['a', 'z', 'b']);
    expect(states(p)).toEqual(['a:open', 'z:locked', 'b:locked']);
    expect(
      byCourseOrder({ id: 'x', orderIndex: 1 }, { id: 'x', orderIndex: 1 })
    ).toBe(0);
  });

  it('skips inactive enablers as if they did not exist', () => {
    const p = run({
      enablers: [
        enabler('e1', 1),
        enabler('e2', 2, { isActive: false }),
        enabler('e3', 3),
        enabler('e4', 4, { isActive: null }),
      ],
      quizLinks: [link('e1', 'q1'), link('e2', 'q2'), link('e3', 'q3')],
      bestScores: new Map([['q1', 80]]),
    });
    // e2 is not listed and does not block e3
    expect(states(p)).toEqual(['e1:completed', 'e3:open']);
    expect(p.totalCount).toBe(2);
  });

  it('opens the first active enabler even when the earlier ones are inactive', () => {
    const p = run({
      enablers: [enabler('e1', 1, { isActive: false }), enabler('e2', 2)],
      quizLinks: [link('e2', 'q2')],
    });
    expect(states(p)).toEqual(['e2:open']);
  });

  it('lets an enabler without an active quiz pass through (content only)', () => {
    const p = run({
      enablers: [enabler('e1', 1), enabler('e2', 2), enabler('e3', 3)],
      quizLinks: [link('e2', 'q2', 'LOW', false), link('e3', 'q3')],
    });
    // e1 has nothing to pass: completed, e2 is open, its inactive quiz is no hurdle
    expect(states(p)).toEqual(['e1:completed', 'e2:completed', 'e3:open']);
    expect(p.completedCount).toBe(2);
  });

  it('shows an enabler without a quiz behind an open one as locked, counted as completed', () => {
    const p = run({
      enablers: [enabler('e1', 1), enabler('e2', 2), enabler('e3', 3)],
      quizLinks: [link('e1', 'q1'), link('e3', 'q3')],
    });
    expect(states(p)).toEqual(['e1:open', 'e2:locked', 'e3:locked']);
    // the count of the course list stays what the strict rule always counted
    expect(p.enablers[1].completed).toBe(true);
    expect(p.completedCount).toBe(1);
    // e3 names the enabler to finish first
    expect(p.enablers[2].lockedBy?.enablerId).toBe('e1');
  });

  it('never locks an enabler that was really completed', () => {
    // A quiz of e1 is added later: e1 is open again, but e2 was already passed
    const p = run({
      enablers: [enabler('e1', 1), enabler('e2', 2)],
      quizLinks: [link('e1', 'q1'), link('e2', 'q2')],
      bestScores: new Map([['q2', 90]]),
    });
    expect(states(p)).toEqual(['e1:open', 'e2:completed']);
  });

  it('keeps courses apart', () => {
    const a = run({
      courseId: 'cA',
      enablers: [enabler('a1', 1, { courseId: 'cA' })],
      quizLinks: [link('a1', 'qa1')],
    });
    const b = run({
      courseId: 'cB',
      enablers: [enabler('b1', 1, { courseId: 'cB' })],
      quizLinks: [link('b1', 'qb1')],
      bestScores: new Map([['qb1', 100]]),
    });
    expect(states(a)).toEqual(['a1:open']);
    expect(states(b)).toEqual(['b1:completed']);
  });

  it('handles a course without enablers', () => {
    const p = run({});
    expect(p.enablers).toEqual([]);
    expect(p.completedCount).toBe(0);
    expect(p.totalCount).toBe(0);
  });
});

describe('exception per trainee', () => {
  const two = [enabler('e1', 1), enabler('e2', 2), enabler('e3', 3)];
  const quizzes = [link('e1', 'q1'), link('e2', 'q2'), link('e3', 'q3')];

  it('releases an enabler out of turn', () => {
    const p = run({
      enablers: two,
      quizLinks: quizzes,
      overrides: new Map([['e3', true]]),
    });
    expect(states(p)).toEqual(['e1:open', 'e2:locked', 'e3:open']);
    expect(p.enablers[2].override).toBe(true);
    expect(p.enablers[2].lockReason).toBeNull();
  });

  it('locks an enabler that the order would open', () => {
    const p = run({
      enablers: two,
      quizLinks: quizzes,
      bestScores: new Map([['q1', 100]]),
      overrides: new Map([['e2', false]]),
    });
    expect(states(p)).toEqual(['e1:completed', 'e2:locked', 'e3:locked']);
    expect(p.enablers[1]).toMatchObject({
      lockReason: 'MANUAL',
      lockedBy: null,
      override: false,
    });
    // the one behind waits for the locked one
    expect(p.enablers[2].lockedBy?.enablerId).toBe('e2');
  });

  it('can lock the first enabler', () => {
    const p = run({
      enablers: two,
      quizLinks: quizzes,
      overrides: new Map([['e1', false]]),
    });
    expect(states(p)).toEqual(['e1:locked', 'e2:locked', 'e3:locked']);
  });

  it('treats null like no exception', () => {
    const p = run({
      enablers: two,
      quizLinks: quizzes,
      overrides: new Map([['e2', null]]),
    });
    expect(states(p)).toEqual(['e1:open', 'e2:locked', 'e3:locked']);
    expect(p.enablers[1].override).toBeNull();
  });

  it('does not lock an enabler that is already completed', () => {
    const p = run({
      enablers: two,
      quizLinks: quizzes,
      bestScores: new Map([['q1', 100]]),
      overrides: new Map([['e1', false]]),
    });
    expect(p.enablers[0].state).toBe('completed');
  });
});

describe('grandfathering', () => {
  const two = [enabler('e1', 1), enabler('e2', 2)];
  const quizzes = [link('e1', 'q1'), link('e2', 'q2')];

  it('locks nothing when the order is not enforced', () => {
    const p = run({ enforced: false, enablers: two, quizLinks: quizzes });
    expect(p.enforced).toBe(false);
    expect(states(p)).toEqual(['e1:open', 'e2:open']);
    expect(p.enablers.every(e => !e.locked && e.lockedBy === null)).toBe(true);
  });

  it('ignores exceptions when the order is not enforced, old rows lock nobody', () => {
    const p = run({
      enforced: false,
      enablers: two,
      quizLinks: quizzes,
      overrides: new Map([['e1', false]]),
    });
    expect(states(p)).toEqual(['e1:open', 'e2:open']);
    expect(p.enablers[0].override).toBeNull();
  });

  it('still shows completed enablers', () => {
    const p = run({
      enforced: false,
      enablers: two,
      quizLinks: quizzes,
      bestScores: new Map([['q2', 80]]),
    });
    expect(states(p)).toEqual(['e1:open', 'e2:completed']);
  });

  const since = new Date('2026-11-01T00:00:00.000Z');

  it('applies to a trainee who joined on or after the cut-off date', () => {
    expect(
      isSequenceEnforced(since, new Date('2026-11-01T00:00:00.000Z'))
    ).toBe(true);
    expect(
      isSequenceEnforced(since, new Date('2026-12-24T10:00:00.000Z'))
    ).toBe(true);
  });

  it('does not apply to a trainee who joined before', () => {
    expect(
      isSequenceEnforced(since, new Date('2026-10-31T23:59:59.999Z'))
    ).toBe(false);
  });

  it('does not apply without a cut-off date or without a date of joining', () => {
    expect(isSequenceEnforced(null, new Date())).toBe(false);
    expect(isSequenceEnforced(undefined, new Date())).toBe(false);
    expect(isSequenceEnforced(since, null)).toBe(false);
    expect(isSequenceEnforced(since, undefined)).toBe(false);
    expect(isSequenceEnforced(new Date('nope'), new Date())).toBe(false);
    expect(isSequenceEnforced(since, new Date('nope'))).toBe(false);
  });

  it('reads the cut-off date tolerantly from the stored settings', () => {
    expect(
      readSequenceSince({
        sequence_since: '2026-11-01T00:00:00.000Z',
      })?.toISOString()
    ).toBe('2026-11-01T00:00:00.000Z');
    expect(readSequenceSince({})).toBeNull();
    expect(readSequenceSince(null)).toBeNull();
    expect(readSequenceSince('x')).toBeNull();
    expect(readSequenceSince({ sequence_since: 5 })).toBeNull();
    expect(readSequenceSince({ sequence_since: 'garbage' })).toBeNull();
  });
});

describe('lock chain of the lesson quizzes', () => {
  const all = [
    link('e1', 'qL', 'LOW'),
    link('e1', 'qM', 'MEDIUM'),
    link('e1', 'qH', 'HIGH'),
  ];

  it('opens only LOW at the start', () => {
    const chain = computeCourseChain(all, new Map(), new Set());
    expect(chain.map(c => [c.difficulty, c.unlocked])).toEqual([
      ['LOW', true],
      ['MEDIUM', false],
      ['HIGH', false],
    ]);
    expect(chain[1].after).toBe('LOW');
    expect(chain[0].after).toBeNull();
  });

  it('opens MEDIUM after an attempt at LOW, passed or not', () => {
    const chain = computeCourseChain(
      all,
      new Map([['qL', 10]]),
      new Set(['qL'])
    );
    expect(chain.map(c => c.unlocked)).toEqual([true, true, false]);
    expect(chain[0]).toMatchObject({ submitted: true, passed: false });
  });

  it('opens HIGH after an attempt at MEDIUM', () => {
    const chain = computeCourseChain(
      all,
      new Map([
        ['qL', 80],
        ['qM', 60],
      ]),
      new Set(['qL', 'qM'])
    );
    expect(chain.map(c => c.unlocked)).toEqual([true, true, true]);
    expect(chain[0].passed).toBe(true);
  });

  it('skips a quiz that does not exist or is inactive', () => {
    const chain = computeCourseChain(
      [
        link('e1', 'qM', 'MEDIUM'),
        link('e1', 'qH', 'HIGH'),
        link('e1', 'qL', 'LOW', false),
      ],
      new Map(),
      new Set()
    );
    // MEDIUM is the first existing quiz and open, HIGH follows MEDIUM
    expect(chain.map(c => [c.difficulty, c.unlocked, c.after])).toEqual([
      ['MEDIUM', true, null],
      ['HIGH', false, 'MEDIUM'],
    ]);
  });

  it('a quiz without a gradable question is always open and gates nobody', () => {
    // LOW cannot be graded: MEDIUM does not wait for an attempt at LOW, and LOW
    // itself can be handed in at any time (it only gets stored)
    const chain = computeCourseChain(
      [
        link('e1', 'qL', 'LOW', true, false),
        link('e1', 'qM', 'MEDIUM'),
        link('e1', 'qH', 'HIGH'),
      ],
      new Map(),
      new Set()
    );
    expect(chain.map(c => [c.difficulty, c.unlocked, c.after])).toEqual([
      ['LOW', true, null],
      ['MEDIUM', true, null],
      ['HIGH', false, 'MEDIUM'],
    ]);
  });

  it('skips an ungradable quiz in the middle for the quiz behind it', () => {
    const chain = computeCourseChain(
      [
        link('e1', 'qL', 'LOW'),
        link('e1', 'qM', 'MEDIUM', true, false),
        link('e1', 'qH', 'HIGH'),
      ],
      new Map(),
      new Set()
    );
    // HIGH waits for LOW, not for the quiz that cannot be graded
    expect(chain.map(c => [c.difficulty, c.unlocked, c.after])).toEqual([
      ['LOW', true, null],
      ['MEDIUM', true, null],
      ['HIGH', false, 'LOW'],
    ]);
  });

  it('is empty without quizzes and ignores a link without a difficulty', () => {
    expect(computeCourseChain([], new Map(), new Set())).toEqual([]);
    expect(
      computeCourseChain([link('e1', 'q', null)], new Map(), new Set())
    ).toEqual([]);
  });
});

function computeCourseChain(
  links: ProgressionQuizLink[],
  best: Map<string, number>,
  submitted: Set<string>
) {
  return computeQuizChain(links, best, submitted);
}
