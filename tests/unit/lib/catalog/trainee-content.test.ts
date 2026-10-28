/**
 * @jest-environment node
 */
import {
  componentsOfPhase,
  currentPhaseOf,
  planTraineeContent,
  type PlanComponent,
} from '@/lib/catalog/trainee-content';

// Which courses and global quizzes a trainee gets for the occupation. The rule
// is the phase plan of the catalog: the compulsory components of the current
// phase, the integrative components (the whole training) and the elective
// components the trainee picked. Nothing else.

const comp = (
  id: string,
  kind: PlanComponent['kind'],
  phase: number | null,
  orderIndex = 0
): PlanComponent => ({ id, kind, phase, orderIndex });

const components: PlanComponent[] = [
  comp('p1a', 'pflicht', 1),
  comp('p1b', 'pflicht', 1),
  comp('p2a', 'pflicht', 2),
  comp('int', 'integrativ', null),
  comp('w1', 'wahl', null),
  comp('w2', 'wahl', null),
  comp('w3', 'wahl', null),
];

describe('componentsOfPhase', () => {
  it('phase 1: compulsory of phase 1 and the integrative ones', () => {
    expect([...componentsOfPhase(components, [], 1)].sort()).toEqual([
      'int',
      'p1a',
      'p1b',
    ]);
  });

  it('phase 2: compulsory of phase 2 and the integrative ones', () => {
    expect([...componentsOfPhase(components, [], 2)].sort()).toEqual([
      'int',
      'p2a',
    ]);
  });

  it('adds the chosen elective components, only those', () => {
    expect([...componentsOfPhase(components, ['w2'], 1)].sort()).toEqual([
      'int',
      'p1a',
      'p1b',
      'w2',
    ]);
  });

  it('ignores a choice that is not an elective component of the catalog', () => {
    // 'p2a' is compulsory, a stray choice id does not pull it in early
    expect(
      [...componentsOfPhase(components, ['p2a', 'gone'], 1)].sort()
    ).toEqual(['int', 'p1a', 'p1b']);
  });

  it('a compulsory component without any phase is not tied to a phase', () => {
    const loose = [comp('free', 'pflicht', null, 0)];
    expect([...componentsOfPhase(loose, [], 1)]).toEqual(['free']);
    expect([...componentsOfPhase(loose, [], 2)]).toEqual(['free']);
  });

  it('a compulsory component of the order range 23 to 26 is integrative', () => {
    const late = [comp('late', 'pflicht', null, 24)];
    expect([...componentsOfPhase(late, [], 1)]).toEqual(['late']);
  });
});

describe('currentPhaseOf', () => {
  const now = new Date('2026-10-28T00:00:00Z');

  it('without a start date the trainee is in phase 1', () => {
    expect(
      currentPhaseOf({
        startDate: null,
        durationYears: 3,
        phaseOneMonths: 15,
        now,
      })
    ).toBe(1);
  });

  it('follows the phase months of the catalog (KfBM 15 months)', () => {
    const start = new Date('2025-09-01T00:00:00Z'); // 13 months
    expect(
      currentPhaseOf({
        startDate: start,
        durationYears: 3,
        phaseOneMonths: 15,
        now,
      })
    ).toBe(1);
    const earlier = new Date('2025-06-01T00:00:00Z'); // 16 months
    expect(
      currentPhaseOf({
        startDate: earlier,
        durationYears: 3,
        phaseOneMonths: 15,
        now,
      })
    ).toBe(2);
  });

  it('a future start date is phase 1', () => {
    const future = new Date('2027-01-01T00:00:00Z');
    expect(
      currentPhaseOf({
        startDate: future,
        durationYears: 3,
        phaseOneMonths: 15,
        now,
      })
    ).toBe(1);
  });
});

describe('planTraineeContent', () => {
  const courses = [
    { id: 'c-p1a', trainingComponentId: 'p1a' },
    { id: 'c-p1b', trainingComponentId: 'p1b' },
    { id: 'c-p2a', trainingComponentId: 'p2a' },
    { id: 'c-int', trainingComponentId: 'int' },
    { id: 'c-w1', trainingComponentId: 'w1' },
    { id: 'c-w2', trainingComponentId: 'w2' },
    { id: 'c-legacy', trainingComponentId: null },
  ];
  const globalQuizzes = [
    { id: 'q-p1a', trainingComponentId: 'p1a' },
    { id: 'q-p2a', trainingComponentId: 'p2a' },
    { id: 'q-w2', trainingComponentId: 'w2' },
    { id: 'q-loose', trainingComponentId: null },
  ];

  it('plans the courses and the global quizzes of the planned components', () => {
    const plan = planTraineeContent({
      phase: 1,
      components,
      electiveComponentIds: ['w2'],
      courses,
      globalQuizzes,
    });
    expect(plan.courseIds.sort()).toEqual(['c-int', 'c-p1a', 'c-p1b', 'c-w2']);
    expect(plan.globalQuizIds.sort()).toEqual(['q-p1a', 'q-w2']);
  });

  it('never plans a course without a component (FIAE courses stay untouched)', () => {
    const plan = planTraineeContent({
      phase: 2,
      components,
      electiveComponentIds: [],
      courses: [{ id: 'fiae-1', trainingComponentId: null }],
      globalQuizzes: [{ id: 'fiae-q', trainingComponentId: null }],
    });
    expect(plan).toEqual({ courseIds: [], globalQuizIds: [] });
  });

  it('a catalog without components plans nothing', () => {
    const plan = planTraineeContent({
      phase: 1,
      components: [],
      electiveComponentIds: [],
      courses,
      globalQuizzes,
    });
    expect(plan).toEqual({ courseIds: [], globalQuizIds: [] });
  });
});
