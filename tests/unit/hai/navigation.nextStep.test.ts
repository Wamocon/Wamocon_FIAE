/**
 * @jest-environment node
 */
import {
  pickNextStep,
  type NextStepEntry,
  type NextStepPlan,
} from '@/lib/hai/navigation/nextStep';
import {
  matchContent,
  type ContentCandidate,
} from '@/lib/hai/navigation/match';

// "Weiter lernen": the next open enabler in course order, refined by the phase
// plan, with the reason in one sentence. And the matching of a number or a name.

let counter = 0;
function entry(overrides: Partial<NextStepEntry> = {}): NextStepEntry {
  counter += 1;
  return {
    enablerId: `e-${String(counter).padStart(3, '0')}`,
    title: `Enabler ${counter}`,
    courseTitle: 'Datenbanken',
    stage: 1,
    chapter: 1,
    orderIndex: counter,
    completed: false,
    locked: false,
    ...overrides,
  };
}

const PHASE_ONE: NextStepPlan = { currentPhase: 1, allowedStages: [1, 3] };
const PHASE_TWO: NextStepPlan = { currentPhase: 2, allowedStages: [1, 2, 3] };

describe('pickNextStep', () => {
  it('takes the first enabler in course order that is open and not completed', () => {
    const entries = [
      entry({
        enablerId: 'a',
        title: 'Erster',
        completed: true,
        orderIndex: 1,
      }),
      entry({ enablerId: 'c', title: 'Dritter', orderIndex: 3 }),
      entry({ enablerId: 'b', title: 'Zweiter', orderIndex: 2 }),
    ];
    const step = pickNextStep(entries, PHASE_ONE);
    expect(step.kind).toBe('next');
    if (step.kind === 'next') expect(step.entry.enablerId).toBe('b');
  });

  it('skips a locked enabler (order of work, exception of the trainer)', () => {
    const step = pickNextStep(
      [
        entry({ enablerId: 'a', orderIndex: 1, locked: true }),
        entry({ enablerId: 'b', orderIndex: 2 }),
      ],
      PHASE_ONE
    );
    expect(step.kind === 'next' && step.entry.enablerId).toBe('b');
  });

  it('names the course and the phase in one sentence', () => {
    const step = pickNextStep(
      [entry({ courseTitle: 'Netzwerke', stage: 1 })],
      PHASE_ONE
    );
    if (step.kind !== 'next') throw new Error('expected a next step');
    expect(step.reason).toBe(
      'Das ist dein nächster freigeschalteter Enabler im Kurs Netzwerke (Phase 1), den du noch nicht abgeschlossen hast.'
    );
    expect(step.reason.match(/\./g)).toHaveLength(1);
  });

  it('puts an enabler of a later phase after the ones of the current phase', () => {
    const entries = [
      entry({ enablerId: 'p2', stage: 2, orderIndex: 1 }),
      entry({ enablerId: 'p1', stage: 1, orderIndex: 9 }),
    ];
    const step = pickNextStep(entries, PHASE_ONE);
    expect(step.kind === 'next' && step.entry.enablerId).toBe('p1');
  });

  it('keeps the integrative skills (stage 3) due in phase one, after phase one', () => {
    const entries = [
      entry({ enablerId: 'integ', stage: 3, orderIndex: 1 }),
      entry({ enablerId: 'p2', stage: 2, orderIndex: 1 }),
    ];
    const step = pickNextStep(entries, PHASE_ONE);
    if (step.kind !== 'next') throw new Error('expected a next step');
    expect(step.entry.enablerId).toBe('integ');
    expect(step.reason).toContain('(Integrative Fertigkeiten)');
  });

  it('offers an enabler of a later phase when nothing else is open and says so', () => {
    const step = pickNextStep(
      [
        entry({ enablerId: 'p1', stage: 1, completed: true }),
        entry({ enablerId: 'p2', stage: 2 }),
      ],
      PHASE_ONE
    );
    if (step.kind !== 'next') throw new Error('expected a next step');
    expect(step.entry.enablerId).toBe('p2');
    expect(step.reason).toContain('nach deinem Plan erst später beginnt');
    expect(step.reason.match(/\./g)).toHaveLength(1);
  });

  it('follows the order of the dashboard in phase two (stage, chapter, order)', () => {
    const entries = [
      entry({ enablerId: 'x', stage: 2, chapter: 2, orderIndex: 1 }),
      entry({ enablerId: 'y', stage: 2, chapter: 1, orderIndex: 5 }),
      entry({
        enablerId: 'z',
        stage: 1,
        chapter: 1,
        orderIndex: 2,
        completed: true,
      }),
    ];
    const step = pickNextStep(entries, PHASE_TWO);
    expect(step.kind === 'next' && step.entry.enablerId).toBe('y');
  });

  it('works without a plan (a first open enabler, no remark)', () => {
    const step = pickNextStep([entry({ stage: 2 })], null);
    if (step.kind !== 'next') throw new Error('expected a next step');
    expect(step.reason).not.toContain('später');
  });

  it('handles an enabler of a course without a stage', () => {
    const step = pickNextStep(
      [entry({ stage: null, chapter: null })],
      PHASE_ONE
    );
    expect(step.kind).toBe('next');
    if (step.kind === 'next') expect(step.reason).not.toContain('(');
  });

  it('says that everything is done, everything is locked, or that there is nothing', () => {
    expect(
      pickNextStep([entry({ completed: true }), entry({ completed: true })])
    ).toEqual({ kind: 'all_done' });
    expect(
      pickNextStep([entry({ locked: true }), entry({ completed: true })])
    ).toEqual({ kind: 'all_locked' });
    expect(pickNextStep([])).toEqual({ kind: 'none' });
  });

  it('writes the course name as plain text (no markup of a trainer title)', () => {
    const step = pickNextStep(
      [entry({ courseTitle: 'Kurs **fett** [Link](http://x.example)' })],
      PHASE_ONE
    );
    if (step.kind !== 'next') throw new Error('expected a next step');
    // the only brackets are the ones of the phase label that the code writes
    expect(step.reason.replace('(Phase 1)', '')).not.toMatch(/[*\[\]()]|:\/\//);
  });
});

describe('matchContent', () => {
  const candidates: ContentCandidate[] = [
    {
      id: '1',
      title: 'Enabler 3: Netzwerke',
      code: '3',
      courseId: 'c1',
      courseTitle: 'K1',
    },
    {
      id: '2',
      title: 'Enabler 3.6: VLAN-Konfiguration',
      code: '3.6',
      courseId: 'c1',
      courseTitle: 'K1',
    },
    {
      id: '3',
      title: 'SQL Grundlagen',
      code: '1a',
      courseId: 'c2',
      courseTitle: 'K2',
    },
    {
      id: '4',
      title: 'SQL Joins',
      code: null,
      courseId: 'c2',
      courseTitle: 'K2',
    },
    {
      id: '5',
      title: 'Normalisierung',
      code: '007',
      courseId: 'c2',
      courseTitle: 'K2',
    },
  ];

  it('finds a number by the code, even with leading zeros', () => {
    expect(matchContent({ number: '7' }, candidates)).toEqual({
      status: 'one',
      item: candidates[4],
    });
    expect(matchContent({ number: '1A' }, candidates)).toEqual({
      status: 'one',
      item: candidates[2],
    });
  });

  it('finds a number in the title and does not mix "3" with "3.6"', () => {
    expect(matchContent({ number: '3' }, candidates)).toEqual({
      status: 'one',
      item: candidates[0],
    });
    expect(matchContent({ number: '3.6' }, candidates)).toEqual({
      status: 'one',
      item: candidates[1],
    });
  });

  it('finds a name by the whole title first, then by a part of it', () => {
    expect(matchContent({ name: 'sql grundlagen' }, candidates)).toEqual({
      status: 'one',
      item: candidates[2],
    });
    expect(matchContent({ name: 'netzwerke' }, candidates)).toEqual({
      status: 'one',
      item: candidates[0],
    });
    const many = matchContent({ name: 'sql' }, candidates);
    expect(many.status).toBe('many');
  });

  it('finds a title with an umlaut by the folded name', () => {
    const list: ContentCandidate[] = [
      {
        id: 'u',
        title: 'Überprüfung der Größe',
        code: null,
        courseId: 'c',
        courseTitle: 'K',
      },
    ];
    expect(
      matchContent({ name: 'ueberpruefung der groesse' }, list).status
    ).toBe('one');
  });

  it('answers none for an unknown number, a short name or an empty reference', () => {
    expect(matchContent({ number: '99' }, candidates)).toEqual({
      status: 'none',
    });
    expect(matchContent({ name: 'ab' }, candidates)).toEqual({
      status: 'none',
    });
    expect(matchContent({}, candidates)).toEqual({ status: 'none' });
    expect(matchContent({ number: '3' }, [])).toEqual({ status: 'none' });
  });

  it('compares only the candidates it is given (nothing outside the scope)', () => {
    const own = candidates.filter(c => c.courseId === 'c1');
    expect(matchContent({ name: 'normalisierung' }, own)).toEqual({
      status: 'none',
    });
  });
});
