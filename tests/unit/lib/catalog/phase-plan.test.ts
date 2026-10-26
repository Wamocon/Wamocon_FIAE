import { resolvePhasePlan } from '@/lib/catalog/phase-plan';
import { DEFAULT_CATALOG_SETTINGS } from '@/lib/catalog/settings';
import { getPhaseMonthRange } from '@/lib/ausbildung/duration';

// Settings as stored in training_catalogs.settings (snake_case jsonb)
const FIAE = {
  shortening_threshold: 2.45,
  school_organization: 'block',
  phase_months: [18, 18],
};
const KFBM = {
  shortening_threshold: 2.49,
  school_organization: 'weekdays',
  phase_months: [15, 21],
};

describe('resolvePhasePlan', () => {
  describe('FIAE (unchanged behaviour)', () => {
    it('keeps 18 + 18 months for the 3-year plan', () => {
      expect(resolvePhasePlan(FIAE, 3)).toEqual({
        durationYears: 3,
        totalMonths: 36,
        phaseMonths: [18, 18],
      });
    });

    it('keeps 12 + 12 months for the shortened 2-year plan', () => {
      expect(resolvePhasePlan(FIAE, 2)).toEqual({
        durationYears: 2,
        totalMonths: 24,
        phaseMonths: [12, 12],
      });
    });

    it.each([2, 3])(
      'matches the phase one end of the legacy rule for %i years',
      years => {
        const plan = resolvePhasePlan(FIAE, years);
        expect(plan.phaseMonths[0]).toBe(getPhaseMonthRange(years, 1).endMonth);
        expect(plan.phaseMonths[0] + plan.phaseMonths[1]).toBe(years * 12);
      }
    );
  });

  describe('KfBM', () => {
    it('uses 15 + 21 months for the 3-year plan', () => {
      expect(resolvePhasePlan(KFBM, 3).phaseMonths).toEqual([15, 21]);
    });

    it('prorates 15 + 21 to 10 + 14 months without shortening rules', () => {
      const plan = resolvePhasePlan(KFBM, 2);
      expect(plan.phaseMonths).toEqual([10, 14]);
      expect(plan.totalMonths).toBe(24);
    });

    it('prefers shortened_training_rules.phase_months', () => {
      const plan = resolvePhasePlan(
        {
          ...KFBM,
          shortened_training_rules: { phase_months: [12, 12], note: 'x' },
        },
        2
      );
      expect(plan.phaseMonths).toEqual([12, 12]);
    });

    it('ignores the shortening rules for the 3-year plan', () => {
      const plan = resolvePhasePlan(
        { ...KFBM, shortened_training_rules: { phase_months: [12, 12] } },
        3
      );
      expect(plan.phaseMonths).toEqual([15, 21]);
    });

    it.each([
      ['not an array', 'twelve'],
      ['one entry', [12]],
      ['three entries', [8, 8, 8]],
      ['a zero', [0, 24]],
      ['a fraction', [11.5, 12.5]],
      ['text entries', ['12', '12']],
      ['the wrong sum', [10, 10]],
      ['above the limit', [1000, 1000]],
    ])('prorates when the shortening rules have %s', (_label, value) => {
      const plan = resolvePhasePlan(
        { ...KFBM, shortened_training_rules: { phase_months: value } },
        2
      );
      expect(plan.phaseMonths).toEqual([10, 14]);
    });

    it('prorates when the shortening rules are not an object', () => {
      expect(
        resolvePhasePlan({ ...KFBM, shortened_training_rules: 'x' }, 2)
          .phaseMonths
      ).toEqual([10, 14]);
      expect(
        resolvePhasePlan({ ...KFBM, shortened_training_rules: [12, 12] }, 2)
          .phaseMonths
      ).toEqual([10, 14]);
    });

    it('rounds a fractional proration to whole months', () => {
      // 16 / 36 * 24 = 10.67
      const plan = resolvePhasePlan({ phase_months: [16, 20] }, 2);
      expect(plan.phaseMonths).toEqual([11, 13]);
    });
  });

  describe('fallback to the previous values', () => {
    it.each([
      ['undefined', undefined],
      ['null', null],
      ['a string', 'settings'],
      ['a number', 42],
      ['an array', [18, 18]],
      ['an empty object', {}],
      ['unrelated keys', { school_organization: 'block' }],
      ['no phase months', { shortening_threshold: 2.45 }],
    ])('for %s as settings', (_label, settings) => {
      expect(resolvePhasePlan(settings, 3).phaseMonths).toEqual([18, 18]);
      expect(resolvePhasePlan(settings, 2).phaseMonths).toEqual([12, 12]);
    });

    it.each([
      ['not an array', 18],
      ['one entry', [18]],
      ['three entries', [12, 12, 12]],
      ['a zero', [0, 36]],
      ['a negative number', [-6, 42]],
      ['a fraction', [17.5, 18.5]],
      ['text entries', ['18', '18']],
      ['null entries', [null, null]],
      ['the wrong sum', [12, 12]],
      ['a value above the limit', [150, 150]],
    ])('for phase_months with %s', (_label, phaseMonths) => {
      const settings = { phase_months: phaseMonths };
      expect(resolvePhasePlan(settings, 3).phaseMonths).toEqual([18, 18]);
      expect(resolvePhasePlan(settings, 2).phaseMonths).toEqual([12, 12]);
    });

    it('uses the same defaults as the settings module', () => {
      expect(DEFAULT_CATALOG_SETTINGS.phaseMonths).toEqual([18, 18]);
      expect(resolvePhasePlan(null, 3).phaseMonths).toEqual(
        DEFAULT_CATALOG_SETTINGS.phaseMonths
      );
    });
  });

  describe('duration', () => {
    it.each([null, undefined, 1, 4, 2.5, Number.NaN])(
      'treats %p as the 3-year plan',
      years => {
        const plan = resolvePhasePlan(KFBM, years as number | null);
        expect(plan.durationYears).toBe(3);
        expect(plan.phaseMonths).toEqual([15, 21]);
      }
    );
  });

  describe('invariants', () => {
    const inputs: unknown[] = [
      FIAE,
      KFBM,
      { phase_months: [1, 35] },
      { phase_months: [35, 1] },
      { phase_months: [1, 35], shortened_training_rules: {} },
      { phase_months: [35, 1], shortened_training_rules: {} },
      { phase_months: [20, 16] },
      {},
      null,
    ];

    it.each(inputs.map((settings, i) => [i, settings]))(
      'input %i: both phases are positive and add up to the duration',
      (_i, settings) => {
        for (const years of [2, 3]) {
          const [one, two] = resolvePhasePlan(settings, years).phaseMonths;
          expect(Number.isInteger(one)).toBe(true);
          expect(one).toBeGreaterThanOrEqual(1);
          expect(two).toBeGreaterThanOrEqual(1);
          expect(one + two).toBe(years * 12);
        }
      }
    );

    it('does not modify its input', () => {
      const settings = JSON.parse(JSON.stringify(KFBM));
      resolvePhasePlan(settings, 2);
      expect(settings).toEqual(KFBM);
    });

    it('does not share the returned array with the defaults', () => {
      const first = resolvePhasePlan(null, 3);
      first.phaseMonths[0] = 99;
      expect(resolvePhasePlan(null, 3).phaseMonths).toEqual([18, 18]);
      expect(DEFAULT_CATALOG_SETTINGS.phaseMonths).toEqual([18, 18]);
    });
  });
});
