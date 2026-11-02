import { joinHardLineBreaks } from '@/lib/text/paragraphs';

describe('joinHardLineBreaks (WMCNL-3021: Lernfeldtext mit harten Zeilenumbrüchen)', () => {
  it('joins the lines of a printed paragraph and keeps the paragraphs', () => {
    expect(
      joinHardLineBreaks(
        'Die Schülerinnen und Schüler besitzen\ndie Kompetenz, Telefonate\nzu führen.\n\nSie planen ihre\nArbeit.'
      )
    ).toBe(
      'Die Schülerinnen und Schüler besitzen die Kompetenz, Telefonate zu führen.\n\nSie planen ihre Arbeit.'
    );
  });

  it('keeps list items on their own line', () => {
    expect(joinHardLineBreaks('Inhalte:\n- Telefon\n- E-Mail\n1. Brief')).toBe(
      'Inhalte:\n- Telefon\n- E-Mail\n1. Brief'
    );
  });

  it('handles Windows line breaks, blank lines with spaces and empty input', () => {
    expect(joinHardLineBreaks('A\r\nB\r\n\r\nC')).toBe('A B\n\nC');
    expect(joinHardLineBreaks('A\n \nB')).toBe('A\n\nB');
    expect(joinHardLineBreaks(null)).toBe('');
    expect(joinHardLineBreaks('')).toBe('');
  });
});
