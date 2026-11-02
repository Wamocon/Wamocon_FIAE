import { countLabel } from '@/lib/i18n/count-label';
import { sortQuizzesByNumber } from '@/lib/trainer/quiz-order';

const texts: Record<string, string> = {
  'x.count': '{count} Azubis',
  'x.count.one': '{count} Azubi',
  'y.count': '{count} Ausbilder',
};
const t = (key: string) => texts[key] ?? key;

describe('countLabel (WMCNL-3027: "1 Azubis")', () => {
  it('uses the singular text for exactly one', () => {
    expect(countLabel(t, 'x.count', 1)).toBe('1 Azubi');
  });

  it('uses the plural text for zero and for more than one', () => {
    expect(countLabel(t, 'x.count', 0)).toBe('0 Azubis');
    expect(countLabel(t, 'x.count', 2)).toBe('2 Azubis');
  });

  it('falls back to the plural text without a singular text', () => {
    expect(countLabel(t, 'y.count', 1)).toBe('1 Ausbilder');
  });
});

describe('sortQuizzesByNumber (WMCNL-3027: list not sorted)', () => {
  it('sorts by the number in the title, numeric and not as text', () => {
    const titles = [
      'K11 Elf',
      'K25.2 Zwei',
      'K1 Eins',
      'K6.1 Sechs',
      'K2 Zwei',
      'K10 Zehn',
    ];
    expect(
      sortQuizzesByNumber(titles.map(title => ({ title }))).map(q => q.title)
    ).toEqual([
      'K1 Eins',
      'K2 Zwei',
      'K6.1 Sechs',
      'K10 Zehn',
      'K11 Elf',
      'K25.2 Zwei',
    ]);
  });

  it('does not change the input and keeps untitled quizzes in order', () => {
    const input = [{ title: 'K2' }, { title: null }, { title: 'K1' }];
    const out = sortQuizzesByNumber(input);
    expect(input[0].title).toBe('K2');
    expect(out.map(q => q.title)).toEqual([null, 'K1', 'K2']);
  });
});
