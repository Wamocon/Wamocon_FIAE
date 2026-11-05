import { shortenLabel, wrapLabel } from '@/components/dashboard/chart-labels';

// WMCNL-2954: the names of skills and question sets were cut ("Auftragsbear-
// beitung durchführ...") or overlapped in the charts.
describe('wrapLabel', () => {
  it('breaks a long name into lines at the spaces', () => {
    expect(wrapLabel('Auftragsbearbeitung durchführen', 16, 2)).toEqual([
      'Auftragsbearbeitung',
      'durchführen',
    ]);
    expect(wrapLabel('Netzwerke planen und aufbauen', 16, 2)).toEqual([
      'Netzwerke planen',
      'und aufbauen',
    ]);
  });

  it('keeps a short name on one line', () => {
    expect(wrapLabel('Teamarbeit', 16, 2)).toEqual(['Teamarbeit']);
  });

  it('cuts only what does not fit into the last line', () => {
    const lines = wrapLabel(
      'Informationsverarbeitung in Betrieben und Verwaltungen organisieren',
      16,
      2
    );
    expect(lines).toHaveLength(2);
    expect(lines[0]).toBe('Informationsverarbeitung');
    expect(lines[1].endsWith('...')).toBe(true);
    expect(lines[1].length).toBeLessThanOrEqual(16);
  });

  it('answers an empty name with no line', () => {
    expect(wrapLabel('', 16, 2)).toEqual([]);
    expect(wrapLabel('   ', 16, 2)).toEqual([]);
  });
});

describe('shortenLabel', () => {
  it('cuts with three dots only when needed', () => {
    expect(shortenLabel('Kurz', 24)).toBe('Kurz');
    expect(shortenLabel('Informationsverarbeitung im Betrieb', 24)).toBe(
      'Informationsverarbeit...'
    );
    expect(
      shortenLabel('Informationsverarbeitung im Betrieb', 24)
    ).toHaveLength(24);
  });
});
