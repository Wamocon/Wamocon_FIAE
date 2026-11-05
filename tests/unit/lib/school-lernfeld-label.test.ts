import { formatLernfeldLabel } from '@/lib/school/lernfeld-label';

// WMCNL-2961: the Lernfeld codes read "LF-1" in FIAE and "LF1" in KfBM.
describe('formatLernfeldLabel', () => {
  it.each([
    ['LF-1', 'LF-1'],
    ['LF1', 'LF-1'],
    ['lf12', 'LF-12'],
    ['LF 7', 'LF-7'],
    ['LF-12a', 'LF-12a'],
    ['LF13', 'LF-13'],
  ])('writes %s as %s', (code, shown) => {
    expect(formatLernfeldLabel(code)).toBe(shown);
  });

  it('leaves everything else unchanged', () => {
    expect(formatLernfeldLabel('SONSTIGES')).toBe('SONSTIGES');
    expect(formatLernfeldLabel('')).toBe('');
    expect(formatLernfeldLabel(null)).toBe('');
  });
});
