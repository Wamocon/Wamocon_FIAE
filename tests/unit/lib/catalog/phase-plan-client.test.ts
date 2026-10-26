import {
  phaseOneMonthsFromAnswer,
  resolvePhaseMonthsByDuration,
  resolvePhasePlan,
} from '@/lib/catalog/phase-plan';
import { getPhaseMonthRange } from '@/lib/ausbildung/duration';

// The phase plan on its way to the browser (KfBM S4b): the server answers both
// durations of an occupation (GET /api/me/catalogs), the browser picks the one
// of the user and hands the length of phase 1 to the duration helpers.

const FIAE = { phase_months: [18, 18] };
const KFBM = { phase_months: [15, 21] };

describe('resolvePhaseMonthsByDuration', () => {
  it('FIAE: 18 + 18 months, 12 + 12 months shortened', () => {
    expect(resolvePhaseMonthsByDuration(FIAE)).toEqual({
      '3': [18, 18],
      '2': [12, 12],
    });
  });

  it('KfBM: 15 + 21 months, 10 + 14 months shortened', () => {
    expect(resolvePhaseMonthsByDuration(KFBM)).toEqual({
      '3': [15, 21],
      '2': [10, 14],
    });
  });

  it('uses shortened_training_rules of the catalog', () => {
    expect(
      resolvePhaseMonthsByDuration({
        ...KFBM,
        shortened_training_rules: { phase_months: [12, 12] },
      })
    ).toEqual({ '3': [15, 21], '2': [12, 12] });
  });

  it.each([null, undefined, {}, 'x', { phase_months: 'x' }])(
    'falls back to the previous lengths for unusable settings (%j)',
    settings => {
      expect(resolvePhaseMonthsByDuration(settings)).toEqual({
        '3': [18, 18],
        '2': [12, 12],
      });
    }
  );
});

describe('phaseOneMonthsFromAnswer', () => {
  const answer = { '3': [15, 21], '2': [10, 14] };

  it('picks phase one of the duration of the user', () => {
    expect(phaseOneMonthsFromAnswer(answer, 3)).toBe(15);
    expect(phaseOneMonthsFromAnswer(answer, 2)).toBe(10);
  });

  it('treats a missing or invalid duration like 3 years', () => {
    expect(phaseOneMonthsFromAnswer(answer, null)).toBe(15);
    expect(phaseOneMonthsFromAnswer(answer, undefined)).toBe(15);
    expect(phaseOneMonthsFromAnswer(answer, 5)).toBe(15);
  });

  it.each([
    ['nothing', undefined],
    ['null', null],
    ['a string', 'x'],
    ['an array', [15, 21]],
    ['an empty object', {}],
    ['a pair of strings', { '3': ['15', '21'] }],
    ['a pair that is too short', { '3': [15] }],
    ['a pair that is too long', { '3': [15, 20, 1] }],
    ['a pair with a fraction', { '3': [14.5, 21.5] }],
    ['a pair with a zero month', { '3': [0, 36] }],
    ['a negative month', { '3': [-3, 39] }],
    ['a pair that does not add up to 36', { '3': [15, 20] }],
    [
      'a shortened pair that does not add up to 24',
      { '3': [15, 21], '2': [10, 10] },
    ],
  ])('gives nothing for %s, so the previous lengths apply', (_name, value) => {
    const years = _name.startsWith('a shortened') ? 2 : 3;
    expect(phaseOneMonthsFromAnswer(value, years)).toBeUndefined();
  });

  it('gives nothing for the other duration when only one is valid', () => {
    expect(phaseOneMonthsFromAnswer({ '3': [15, 21] }, 2)).toBeUndefined();
    expect(phaseOneMonthsFromAnswer({ '3': [15, 21] }, 3)).toBe(15);
  });

  it.each([
    ['FIAE', FIAE],
    ['KfBM', KFBM],
    ['nothing', null],
  ])(
    '%s: the browser gets the same phase one as the server',
    (_n, settings) => {
      for (const years of [2, 3]) {
        expect(
          phaseOneMonthsFromAnswer(
            resolvePhaseMonthsByDuration(settings),
            years
          )
        ).toBe(resolvePhasePlan(settings, years).phaseMonths[0]);
      }
    }
  );

  it('FIAE labels stay exactly as before (1. bis 18. / 19. bis 36. Monat)', () => {
    const one = phaseOneMonthsFromAnswer(resolvePhaseMonthsByDuration(FIAE), 3);
    expect(getPhaseMonthRange(3, 1, one)).toEqual(getPhaseMonthRange(3, 1));
    expect(getPhaseMonthRange(3, 2, one)).toEqual(getPhaseMonthRange(3, 2));
    const two = phaseOneMonthsFromAnswer(resolvePhaseMonthsByDuration(FIAE), 2);
    expect(getPhaseMonthRange(2, 1, two)).toEqual(getPhaseMonthRange(2, 1));
    expect(getPhaseMonthRange(2, 2, two)).toEqual(getPhaseMonthRange(2, 2));
  });

  it('KfBM labels: 1. bis 15. and 16. bis 36. Monat', () => {
    const one = phaseOneMonthsFromAnswer(resolvePhaseMonthsByDuration(KFBM), 3);
    expect(getPhaseMonthRange(3, 1, one)).toEqual({
      startMonth: 1,
      endMonth: 15,
    });
    expect(getPhaseMonthRange(3, 2, one)).toEqual({
      startMonth: 16,
      endMonth: 36,
    });
  });
});
