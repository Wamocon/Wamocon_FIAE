import {
  EXPECTED_COMPONENT_CODES,
  KFBM_COMPONENT_WEEKS,
  RAHMENPLAN_WEEK_TOTALS,
  officialWeeksOf,
  sumWeeks,
  validateComponentWeeks,
} from '@/lib/content-import/apply/component-weeks';
import type { ComponentWeeks } from '@/lib/content-import/apply/component-weeks';

import { loadDecisions } from './fixtures';

const copy = (): ComponentWeeks[] =>
  KFBM_COMPONENT_WEEKS.map(entry => ({ ...entry }));
const byCode = (code: string) =>
  KFBM_COMPONENT_WEEKS.find(e => e.code === code) as ComponentWeeks;

describe('component weeks of the training framework plan', () => {
  it('is sound as it is shipped', () => {
    expect(validateComponentWeeks()).toEqual([]);
  });

  it('covers exactly the 27 components of the import, once each', () => {
    const codes = KFBM_COMPONENT_WEEKS.map(e => e.code);
    expect(codes).toHaveLength(27);
    expect(new Set(codes).size).toBe(27);
    expect([...codes].sort()).toEqual([...EXPECTED_COMPONENT_CODES].sort());
  });

  it('names the same components as the presets (K18 out, K6, K24 and K25 split)', () => {
    const d = loadDecisions();
    const numbers = [
      ...d.components.mandatoryNumbers,
      ...d.components.electiveNumbers,
      ...d.components.integrativeNumbers,
    ];
    const split = new Set([6, 24, 25]);
    const derived = numbers
      .flatMap(n => (split.has(n) ? [`K${n}.1`, `K${n}.2`] : [`K${n}`]))
      .sort();
    expect(derived).toHaveLength(27);
    expect(KFBM_COMPONENT_WEEKS.map(e => e.code).sort()).toEqual(derived);
    expect(KFBM_COMPONENT_WEEKS.map(e => e.code)).not.toContain('K18');
  });

  it('holds the whole weeks printed in the plan, one value per block', () => {
    const weeks = Object.fromEntries(
      KFBM_COMPONENT_WEEKS.map(e => [e.code, e.weeks])
    );
    expect(weeks).toEqual({
      K1: 11,
      K2: 11,
      K3: 7,
      K4: 5,
      K5: 7,
      'K6.1': 6,
      'K6.2': 11,
      K7: 11,
      K8: 13,
      K9: 13,
      K10: 22,
      K11: 22,
      K12: 22,
      K13: 22,
      K14: 22,
      K15: 22,
      K16: 22,
      K17: 22,
      K19: 22,
      K20: null,
      K21: null,
      K22: null,
      K23: null,
      'K24.1': 4,
      'K24.2': 2,
      'K25.1': 2,
      'K25.2': 9,
    });
    for (const e of KFBM_COMPONENT_WEEKS) {
      if (e.weeks !== null) expect(Number.isInteger(e.weeks)).toBe(true);
    }
  });

  it('puts the split positions into the two periods of the plan', () => {
    expect([byCode('K6.1').period, byCode('K6.2').period]).toEqual([
      'months-1-15',
      'months-16-36',
    ]);
    expect([byCode('K24.1').period, byCode('K24.2').period]).toEqual([
      'months-1-15',
      'months-16-36',
    ]);
    expect([byCode('K25.1').period, byCode('K25.2').period]).toEqual([
      'months-1-15',
      'months-16-36',
    ]);
    // the two parts of a position belong to the same position of the regulation
    expect(byCode('K6.1').position).toBe(byCode('K6.2').position);
    expect(byCode('K24.1').position).toBe('C5');
    expect(byCode('K25.2').position).toBe('C6');
  });

  it('adds up to the totals the plan states, per section and period', () => {
    const t = RAHMENPLAN_WEEK_TOTALS;
    // section A: "Wochen insgesamt: 58 | 37" (BIBB, chapter 2.2.1)
    expect(sumWeeks(KFBM_COMPONENT_WEEKS, 'A', 'months-1-15')).toBe(58);
    expect(sumWeeks(KFBM_COMPONENT_WEEKS, 'A', 'months-16-36')).toBe(37);
    // section C positions 5 and 6: 4 + 2 and 2 + 9
    expect(sumWeeks(KFBM_COMPONENT_WEEKS, 'C', 'months-1-15')).toBe(6);
    expect(sumWeeks(KFBM_COMPONENT_WEEKS, 'C', 'months-16-36')).toBe(11);
    // the electives: nine imported components, 22 weeks each, none before month 16
    expect(sumWeeks(KFBM_COMPONENT_WEEKS, 'B', 'months-1-15')).toBe(0);
    expect(sumWeeks(KFBM_COMPONENT_WEEKS, 'B', 'months-16-36')).toBe(9 * 22);
    // a training chooses two of them: 44 weeks. Three years of 52 weeks.
    const chosen = t.electiveEach * t.electivesChosen;
    expect(chosen).toBe(44);
    expect(58 + 6).toBe(64);
    expect(37 + 11 + chosen).toBe(92);
    expect(64 + 92).toBe(156);
    expect(t.weeksPerTrainingYear * t.trainingYears).toBe(156);
    expect(t.total).toBe(156);
  });

  it('keeps the periods in line with the folders of the source (Teil 1 and Teil 2)', () => {
    // Teil 1 (1 to 15 months) holds nine components, the other pflicht and all
    // elective components lie in Teil 2 (16 to 36 months)
    const teil1 = [
      'K1',
      'K2',
      'K3',
      'K4',
      'K5',
      'K6.1',
      'K7',
      'K24.1',
      'K25.1',
    ];
    expect(
      KFBM_COMPONENT_WEEKS.filter(e => e.period === 'months-1-15').map(
        e => e.code
      )
    ).toEqual(teil1);
    const teil2 = KFBM_COMPONENT_WEEKS.filter(
      e => e.period === 'months-16-36'
    ).map(e => e.code);
    expect(teil2).toEqual([
      'K6.2',
      'K8',
      'K9',
      'K10',
      'K11',
      'K12',
      'K13',
      'K14',
      'K15',
      'K16',
      'K17',
      'K19',
      'K24.2',
      'K25.2',
    ]);
    expect(
      KFBM_COMPONENT_WEEKS.filter(e => e.period === 'whole-training').map(
        e => e.code
      )
    ).toEqual(['K20', 'K21', 'K22', 'K23']);
  });

  it('gives the weeks of a code, null where the plan prints none', () => {
    expect(officialWeeksOf('K6.2')).toBe(11);
    expect(officialWeeksOf('K20')).toBeNull();
    expect(officialWeeksOf('K18')).toBeUndefined();
    expect(officialWeeksOf('K99')).toBeUndefined();
  });
});

describe('validateComponentWeeks: strict', () => {
  it('rejects a missing component', () => {
    const entries = copy().filter(e => e.code !== 'K9');
    expect(validateComponentWeeks(entries).join(' ')).toMatch(/K9 is missing/);
  });

  it('rejects a duplicate and an unknown code', () => {
    const entries = [...copy(), { ...byCode('K1') }];
    expect(validateComponentWeeks(entries).join(' ')).toMatch(
      /K1 is listed twice/
    );
    const odd = copy();
    odd[0] = { ...odd[0], code: 'K18' };
    const text = validateComponentWeeks(odd).join(' ');
    expect(text).toMatch(/K18 is not a component of the import/);
    expect(text).toMatch(/K1 is missing/);
  });

  it('rejects fractions, zero, negative and absurd weeks', () => {
    for (const weeks of [10.5, 0, -3, 157, Number.NaN]) {
      const entries = copy();
      entries[0] = { ...entries[0], weeks };
      expect(validateComponentWeeks(entries).join(' ')).toMatch(
        /K1 needs whole weeks/
      );
    }
  });

  it('rejects weeks where the plan prints none and no weeks where it does', () => {
    const withWeeks = copy().map(e =>
      e.code === 'K20' ? { ...e, weeks: 4 } : e
    );
    expect(validateComponentWeeks(withWeeks).join(' ')).toMatch(
      /K20 is whole-training and must have no weeks/
    );
    const without = copy().map(e =>
      e.code === 'K1' ? { ...e, weeks: null } : e
    );
    expect(validateComponentWeeks(without).join(' ')).toMatch(
      /K1 needs whole weeks/
    );
  });

  it('rejects a wrong sum against the plan (one week too many in section A)', () => {
    const entries = copy().map(e => (e.code === 'K3' ? { ...e, weeks: 8 } : e));
    const text = validateComponentWeeks(entries).join(' ');
    expect(text).toMatch(
      /section A months-1-15 adds up to 59, the plan says 58/
    );
    expect(text).toMatch(/a training adds up to 157 weeks/);
  });

  it('rejects a moved block of a split position', () => {
    const entries = copy().map(e =>
      e.code === 'K24.2' ? { ...e, weeks: 3 } : e
    );
    expect(validateComponentWeeks(entries).join(' ')).toMatch(
      /section C months-16-36 adds up to 12, the plan says 11/
    );
  });

  it('rejects an elective that is not 22 weeks in the second period', () => {
    const entries = copy().map(e =>
      e.code === 'K12' ? { ...e, weeks: 20 } : e
    );
    expect(validateComponentWeeks(entries).join(' ')).toMatch(
      /K12 is a Wahlqualifikation/
    );
    const early = copy().map(e =>
      e.code === 'K12' ? { ...e, period: 'months-1-15' as const } : e
    );
    expect(validateComponentWeeks(early).join(' ')).toMatch(
      /K12 is a Wahlqualifikation/
    );
  });

  it('rejects a position that does not match the component number', () => {
    const entries = copy().map(e =>
      e.code === 'K10' ? { ...e, position: 'B2' } : e
    );
    expect(validateComponentWeeks(entries).join(' ')).toMatch(
      /K10 must be position B1/
    );
  });

  it('rejects a page outside the plan', () => {
    const entries = copy().map(e => (e.code === 'K4' ? { ...e, page: 3 } : e));
    expect(validateComponentWeeks(entries).join(' ')).toMatch(
      /K4 names a page outside the plan/
    );
  });
});
