import {
  FIAE_COMPONENT_CODES,
  FIAE_COMPONENT_PAIRS,
  fiaeLabelOfOrderIndex,
  fiaeOrderIndexOfCode,
  fiaeOrderIndexOfLabel,
  getComponentLabel,
} from '@/lib/catalog/component-label';

// FIAE labels its components like KfBM (K24.1, K24.2): the base component of a pair
// is x.1, its Vertiefung x.2, x is the order index of the base component. A
// component without a Vertiefung keeps its number. Label only: code and order index
// do not change.

// order index -> label, as decided on 02.11.2026
const EXPECTED: Record<number, string> = {
  1: '1',
  2: '2.1',
  3: '3.1',
  4: '4.1',
  5: '5.1',
  6: '6.1',
  7: '7',
  8: '8.1',
  9: '9.1',
  10: '10.1',
  11: '11.1',
  12: '12',
  13: '2.2',
  14: '3.2',
  15: '4.2',
  16: '5.2',
  17: '6.2',
  18: '8.2',
  19: '19',
  20: '9.2',
  21: '10.2',
  22: '11.2',
  23: '23',
  24: '24',
  25: '25',
  26: '26',
};

describe('getComponentLabel for FIAE', () => {
  it('labels all 26 components by their code (the codes of the Preview)', () => {
    for (let n = 1; n <= 26; n++) {
      expect(
        getComponentLabel({
          catalogCode: 'FIAE',
          code: FIAE_COMPONENT_CODES[n],
          orderIndex: n,
        })
      ).toBe(EXPECTED[n]);
    }
  });

  it('labels all 26 components by the code alone and by the order index alone', () => {
    for (let n = 1; n <= 26; n++) {
      expect(
        getComponentLabel({
          catalogCode: 'FIAE',
          code: FIAE_COMPONENT_CODES[n],
        })
      ).toBe(EXPECTED[n]);
      // production codes may differ from the Preview codes, the order index is the same
      expect(
        getComponentLabel({
          catalogCode: 'FIAE',
          code: '§4.2.1',
          orderIndex: n,
        })
      ).toBe(EXPECTED[n]);
      expect(
        getComponentLabel({ catalogCode: 'FIAE', code: null, orderIndex: n })
      ).toBe(EXPECTED[n]);
    }
  });

  it('has the nine pairs as x.1 and x.2 and the eight singles without a dot', () => {
    const pairs = [
      [2, 13],
      [3, 14],
      [4, 15],
      [5, 16],
      [6, 17],
      [8, 18],
      [9, 20],
      [10, 21],
      [11, 22],
    ];
    expect(FIAE_COMPONENT_PAIRS.map(p => [...p])).toEqual(pairs);
    for (const [base, deep] of pairs) {
      expect(fiaeLabelOfOrderIndex(base)).toBe(`${base}.1`);
      expect(fiaeLabelOfOrderIndex(deep)).toBe(`${base}.2`);
    }
    for (const single of [1, 7, 12, 19, 23, 24, 25, 26]) {
      expect(fiaeLabelOfOrderIndex(single)).toBe(String(single));
    }
  });

  it('is case-insensitive for the catalog code', () => {
    expect(getComponentLabel({ catalogCode: 'fiae', code: '2-P2' })).toBe(
      '2.2'
    );
    expect(getComponentLabel({ catalogCode: ' FIAE ', code: '2-P1' })).toBe(
      '2.1'
    );
  });

  it('keeps an unknown code and an order index outside 1 to 26', () => {
    expect(getComponentLabel({ catalogCode: 'FIAE', code: 'XYZ' })).toBe('XYZ');
    expect(
      getComponentLabel({ catalogCode: 'FIAE', code: 'XYZ', orderIndex: 27 })
    ).toBe('XYZ');
    expect(
      getComponentLabel({ catalogCode: 'FIAE', code: 'XYZ', orderIndex: 0 })
    ).toBe('XYZ');
    expect(getComponentLabel({ catalogCode: 'FIAE', code: null })).toBe('');
  });

  it('a known code wins over a different order index', () => {
    expect(
      getComponentLabel({ catalogCode: 'FIAE', code: '2-P2', orderIndex: 5 })
    ).toBe('2.2');
  });
});

describe('getComponentLabel for other catalogs', () => {
  it('leaves KfBM unchanged (K24.2 is the label already)', () => {
    expect(
      getComponentLabel({ catalogCode: 'KFBM', code: 'K24.1', orderIndex: 2 })
    ).toBe('K24.1');
    expect(
      getComponentLabel({ catalogCode: 'KFBM', code: 'K24.2', orderIndex: 13 })
    ).toBe('K24.2');
    expect(getComponentLabel({ catalogCode: 'KFBM', code: 'K1' })).toBe('K1');
  });

  it('leaves a FIAE code unchanged under another catalog and without a catalog', () => {
    expect(
      getComponentLabel({ catalogCode: 'KFBM', code: '2-P2', orderIndex: 13 })
    ).toBe('2-P2');
    expect(
      getComponentLabel({ catalogCode: null, code: '2-P2', orderIndex: 13 })
    ).toBe('2-P2');
    expect(getComponentLabel({ catalogCode: undefined, code: '2-P2' })).toBe(
      '2-P2'
    );
  });
});

describe('the lookups behind the label', () => {
  it('finds the order index of a label (both of a pair) and refuses what is no label', () => {
    expect(fiaeOrderIndexOfLabel('2.1')).toBe(2);
    expect(fiaeOrderIndexOfLabel('2.2')).toBe(13);
    expect(fiaeOrderIndexOfLabel('9.2')).toBe(20);
    expect(fiaeOrderIndexOfLabel('07')).toBe(7);
    expect(fiaeOrderIndexOfLabel('02.1')).toBe(2);
    for (const bad of ['2.3', '13.1', '7.1', '27', '0', 'x', '', '2.']) {
      expect(fiaeOrderIndexOfLabel(bad)).toBeNull();
    }
  });

  it('finds the order index of a code and has 26 different codes', () => {
    expect(fiaeOrderIndexOfCode('10-P2')).toBe(20);
    expect(fiaeOrderIndexOfCode(' INT1 ')).toBe(23);
    expect(fiaeOrderIndexOfCode('K1')).toBeNull();
    expect(fiaeOrderIndexOfCode(null)).toBeNull();
    expect(new Set(Object.values(FIAE_COMPONENT_CODES)).size).toBe(26);
  });

  it('gives no label for a value that is no order index', () => {
    expect(fiaeLabelOfOrderIndex('2')).toBeNull();
    expect(fiaeLabelOfOrderIndex(null)).toBeNull();
    expect(fiaeLabelOfOrderIndex(2.5)).toBeNull();
  });
});
