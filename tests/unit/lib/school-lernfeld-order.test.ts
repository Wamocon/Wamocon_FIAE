import {
  compareLernfeldLabels,
  formatLernfeldLabel,
} from '@/lib/school/lernfeld-label';

// WMCNL-2959: the Lernfelder came as text: LF-1, LF-10, LF-11, LF-12, LF-2.
describe('compareLernfeldLabels', () => {
  const sorted = (codes: string[]) => [...codes].sort(compareLernfeldLabels);

  it('orders by the number, not as text', () => {
    expect(
      sorted(['LF-1', 'LF-10', 'LF-11', 'LF-12', 'LF-2', 'LF-3', 'LF-9'])
    ).toEqual(['LF-1', 'LF-2', 'LF-3', 'LF-9', 'LF-10', 'LF-11', 'LF-12']);
  });

  it('reads LF1 (KfBM) like LF-1 (FIAE)', () => {
    expect(sorted(['LF10', 'LF2', 'LF1', 'LF13', 'LF9'])).toEqual([
      'LF1',
      'LF2',
      'LF9',
      'LF10',
      'LF13',
    ]);
    expect(sorted(['LF-2', 'LF1', 'LF-10'])).toEqual(['LF1', 'LF-2', 'LF-10']);
  });

  it('puts a letter after its number and codes without a number last', () => {
    expect(sorted(['LF-12', 'SONSTIGES', 'LF-12a', 'LF-2', 'LF-12b'])).toEqual([
      'LF-2',
      'LF-12',
      'LF-12a',
      'LF-12b',
      'SONSTIGES',
    ]);
  });

  it('is stable for equal codes and empty values', () => {
    expect(compareLernfeldLabels('LF-3', 'LF-3')).toBe(0);
    expect(compareLernfeldLabels(null, undefined)).toBe(0);
    expect(formatLernfeldLabel('LF1')).toBe('LF-1');
  });
});
