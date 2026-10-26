import {
  cleanTitle,
  titlesFromJson,
  titlesFromSourceCsv,
} from '@/lib/content-import/learning-fields/titles';

// Invented rows in the shape of the column "Quellen" of the source list. The
// titles are made up.
const line = (id: string, sources: string[]) =>
  `${id};Erfundener Titel;LF1;"${sources.join(' | ').replace(/"/g, '""')}"`;

describe('cleanTitle', () => {
  it('collapses spaces, removes control characters and trims', () => {
    expect(cleanTitle('  Erfunden \r\n Eins\u0002 ')).toBe('Erfunden Eins');
    expect(cleanTitle(null)).toBe('');
  });
});

describe('titlesFromSourceCsv', () => {
  it('takes title and school year of each learning field from the chapter list', () => {
    const csv = [
      'Enabler-ID;Enabler-Titel;Lernfelder;Quellen',
      line('1a', [
        'Buch 1 (1. AJ), LF1 "Alpha": Kap. 1 (S.1-2)',
        'Buch 2 (2. AJ), LF5 "Beta Gamma": Kap. 2',
      ]),
      line('1b', ['Buch 1 (1. AJ), LF1 "Alpha": Kap. 3']),
      line('1c', [
        'Buch 3 (3. AJ), LF13 "Delta/Epsilon": (kein Kapitel-Match)',
      ]),
    ].join('\r\n');
    const set = titlesFromSourceCsv(csv);
    expect(set.titles).toEqual({
      1: 'Alpha',
      5: 'Beta Gamma',
      13: 'Delta/Epsilon',
    });
    expect(set.years).toEqual({ 1: 1, 5: 2, 13: 3 });
    expect(set.source).toBe('csv');
    expect(set.warnings).toEqual([]);
  });

  it('uses the most frequent title and says so when the titles differ', () => {
    const csv = [
      line('1a', ['B (1. AJ), LF2 "Eins": x']),
      line('1b', ['B (1. AJ), LF2 "Eins": y']),
      line('1c', ['B (1. AJ), LF2 "Zwei": z']),
      line('1d', ['B (2. AJ), LF2 "Eins": z']),
    ].join('\n');
    const set = titlesFromSourceCsv(csv);
    expect(set.titles[2]).toBe('Eins');
    expect(set.years[2]).toBe(1);
    expect(set.warnings).toEqual([
      'LF2: 2 different titles in the source list, the most frequent one is used.',
      'LF2: 2 different school years in the source list, the most frequent one is reported.',
    ]);
  });

  it('breaks a tie by the title that sorts first and ignores numbers outside 1 to 13', () => {
    const csv = [
      line('1a', ['B (1. AJ), LF3 "Zebra": x', 'B (1. AJ), LF3 "Anton": y']),
      line('1b', ['B (1. AJ), LF14 "Außerhalb": y']),
    ].join('\n');
    const set = titlesFromSourceCsv(csv);
    expect(set.titles).toEqual({ 3: 'Anton' });
    expect(set.warnings).toEqual([
      'LF3: 2 different titles in the source list, the most frequent one is used.',
      'LF14 is outside 1 to 13 and is ignored.',
    ]);
  });

  it('finds nothing in text without chapter entries', () => {
    expect(titlesFromSourceCsv('a;b;c\n1;2;3')).toEqual({
      titles: {},
      years: {},
      source: 'csv',
      warnings: [],
    });
  });
});

describe('titlesFromJson', () => {
  it('reads a map of LF codes or numbers to titles', () => {
    const result = titlesFromJson(
      JSON.stringify({ LF1: ' Eins ', '2': 'Zwei', LF13: 'Dreizehn' })
    );
    expect(result).toEqual({
      ok: true,
      set: {
        titles: { 1: 'Eins', 2: 'Zwei', 13: 'Dreizehn' },
        years: {},
        source: 'json',
        warnings: [],
      },
    });
  });

  it('refuses everything that is not a clean map', () => {
    const error = (text: string) => {
      const result = titlesFromJson(text);
      return result.ok ? null : result.errors;
    };
    expect(error('{kaputt')).toEqual(['The titles file is not valid JSON.']);
    expect(error('[1]')).toEqual(['The titles file must be a JSON object.']);
    expect(
      error(JSON.stringify({ LF14: 'x', Foo: 'y', LF2: '', LF3: 5 }))
    ).toEqual([
      'The key LF14 is not a learning field of 1 to 13.',
      'The key Foo is not a learning field of 1 to 13.',
      'The title of LF2 must be a non-empty text.',
      'The title of LF3 must be a non-empty text.',
    ]);
    expect(error(JSON.stringify({ LF1: 'x'.repeat(201) }))).toEqual([
      'The title of LF1 is longer than 200 characters.',
    ]);
  });
});
