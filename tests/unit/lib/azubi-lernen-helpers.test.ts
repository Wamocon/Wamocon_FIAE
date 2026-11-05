import {
  enablerSubmissionHasContent,
  hasText,
  handInOfUseCaseHasContent,
} from '@/lib/submission-input';
import {
  ENABLER_WEIGHT,
  USE_CASE_WEIGHT,
  courseProgressPercent,
} from '@/lib/catalog/course-progress';
import { capitalizeFirst, themenkreisDescription } from '@/lib/display-text';
import {
  KFBM_UNIVERSE_FIELDS,
  layoutUniverseFields,
} from '@/lib/landing/universeLearningFields';

describe('hand-in content (WMCNL-2925, WMCNL-2926)', () => {
  it('only white space is no text', () => {
    expect(hasText('Text')).toBe(true);
    expect(hasText(' a ')).toBe(true);
    for (const empty of ['', ' ', '\n\t ', null, undefined, 3, {}]) {
      expect(hasText(empty)).toBe(false);
    }
  });

  it('a summary needs a text in the single field or in one solution', () => {
    expect(enablerSubmissionHasContent({})).toBe(false);
    expect(enablerSubmissionHasContent({ solutionText: '  ' })).toBe(false);
    expect(enablerSubmissionHasContent({ solutions: 'x' })).toBe(false);
    expect(
      enablerSubmissionHasContent({ solutions: [{ text: ' ' }, null, 5] })
    ).toBe(false);
    expect(enablerSubmissionHasContent({ solutionText: 'a' })).toBe(true);
    expect(
      enablerSubmissionHasContent({
        solutions: [{ text: ' ' }, { text: 'b' }],
      })
    ).toBe(true);
  });

  it('a use case hand-in needs a text, a link with an address or a file', () => {
    expect(handInOfUseCaseHasContent({})).toBe(false);
    expect(
      handInOfUseCaseHasContent({
        submissionText: ' ',
        links: [{ url: ' ' }, null],
      })
    ).toBe(false);
    expect(handInOfUseCaseHasContent({ submissionText: 'a' })).toBe(true);
    expect(handInOfUseCaseHasContent({ links: [{ url: 'https://a' }] })).toBe(
      true
    );
    expect(handInOfUseCaseHasContent({ hasFile: true })).toBe(true);
  });
});

describe('percentage of a course (WMCNL-2930)', () => {
  const counts = (
    enablerDone: number,
    enablerTotal: number,
    useCaseDone: number,
    useCaseTotal: number
  ) => ({ enablerDone, enablerTotal, useCaseDone, useCaseTotal });

  it('weights enablers 70 and use cases 30 percent', () => {
    expect(ENABLER_WEIGHT).toBe(0.7);
    expect(USE_CASE_WEIGHT).toBe(0.3);
  });

  it('explains the values of the bug report: all use cases still open', () => {
    // 3 of 6, 5 of 10, 2 of 4: half of the enablers is 35 percent
    expect(courseProgressPercent(counts(3, 6, 0, 1))).toBe(35);
    expect(courseProgressPercent(counts(5, 10, 0, 2))).toBe(35);
    expect(courseProgressPercent(counts(2, 4, 0, 1))).toBe(35);
    // 1 of 3 is 23, 10 of 21 is 33
    expect(courseProgressPercent(counts(1, 3, 0, 1))).toBe(23);
    expect(courseProgressPercent(counts(10, 21, 0, 1))).toBe(33);
  });

  it('is the share of one part alone when the other part does not exist', () => {
    expect(courseProgressPercent(counts(3, 6, 0, 0))).toBe(50);
    expect(courseProgressPercent(counts(0, 0, 1, 4))).toBe(25);
    expect(courseProgressPercent(counts(0, 0, 0, 0))).toBe(0);
  });

  it('reaches 100 only with everything done', () => {
    expect(courseProgressPercent(counts(6, 6, 1, 1))).toBe(100);
    expect(courseProgressPercent(counts(6, 6, 0, 1))).toBe(70);
  });
});

describe('display of titles and texts (WMCNL-2933)', () => {
  it('starts a title with a capital letter', () => {
    expect(capitalizeFirst('bürowirtschaftliche Abläufe organisieren')).toBe(
      'Bürowirtschaftliche Abläufe organisieren'
    );
    expect(capitalizeFirst('kaufmännische Steuerung')).toBe(
      'Kaufmännische Steuerung'
    );
    expect(capitalizeFirst('Schon groß')).toBe('Schon groß');
    expect(capitalizeFirst('2. Lehrjahr')).toBe('2. Lehrjahr');
    expect(capitalizeFirst('')).toBe('');
    expect(capitalizeFirst(null)).toBe('');
  });

  it('says Themenkreis in the generated intro of an imported description', () => {
    expect(
      themenkreisDescription(
        'In diesem Modul "Wege der Informationsbeschaffung" werden folgende Inhalte behandelt:\n- a'
      )
    ).toBe(
      'In diesem Themenkreis "Wege der Informationsbeschaffung" werden folgende Inhalte behandelt:\n- a'
    );
    expect(
      themenkreisDescription('In dieser Datei werden Themen behandelt')
    ).toBe('In dieser Datei werden Themen behandelt');
    expect(themenkreisDescription('Im Modul der Woche')).toBe(
      'Im Modul der Woche'
    );
  });
});

describe('learning fields of the KfBM planet (WMCNL-2978)', () => {
  it('has the 13 official learning fields with title and hours', () => {
    expect(KFBM_UNIVERSE_FIELDS).toHaveLength(13);
    expect(KFBM_UNIVERSE_FIELDS[0]).toMatchObject({
      id: 1,
      short: 'LF1',
      name: 'Die eigene Rolle im Betrieb mitgestalten und den Betrieb präsentieren',
      hours: 40,
      year: 1,
      komps: 0,
      uc: 0,
    });
    expect(
      KFBM_UNIVERSE_FIELDS.reduce((sum, f) => sum + (f.hours ?? 0), 0)
    ).toBe(880);
  });

  it('spreads 12 fields 4, 4, 4 as before and 13 fields 4, 4, 5', () => {
    const perRing = (n: number) => {
      const rings = [0, 0, 0];
      for (const p of layoutUniverseFields(n)) rings[p.ring] += 1;
      return rings;
    };
    expect(perRing(12)).toEqual([4, 4, 4]);
    expect(perRing(13)).toEqual([4, 4, 5]);
    // the first field of the first ring keeps the start angle of the old layout
    expect(layoutUniverseFields(12)[0].angle).toBeCloseTo(0.3);
    expect(layoutUniverseFields(12)[4].angle).toBeCloseTo(0.8);
  });
});
