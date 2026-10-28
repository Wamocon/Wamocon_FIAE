import {
  MAX_ENABLER_DESCRIPTION,
  MAX_USE_CASE_DESCRIPTION,
  USE_CASE_DESCRIPTION_MAX,
  componentDescription,
  lengthChangesOf,
  lengthStats,
  renderLengthChanges,
  describeUseCase,
} from '@/lib/content-import/descriptions';

describe('componentDescription', () => {
  it('is one sentence with the code, the title and the paragraph', () => {
    expect(
      componentDescription({
        code: 'K1',
        title: 'Erfundenes Thema',
        reference: '§ 4 Abs. 2 Nr. 1',
      })
    ).toBe('Komponente K1: Erfundenes Thema (§ 4 Abs. 2 Nr. 1)');
  });

  it('leaves the brackets out without a paragraph', () => {
    expect(
      componentDescription({ code: 'K24.2', title: 'Thema', reference: null })
    ).toBe('Komponente K24.2: Thema');
  });
});

describe('describeUseCase: a short title like FIAE', () => {
  it('is the title when it fits into one line', () => {
    expect(describeUseCase('Erfundene Termine planen')).toBe(
      'Erfundene Termine planen'
    );
  });

  it('is one line: white space is normalized', () => {
    expect(describeUseCase('Erfundene\nTermine   planen')).toBe(
      'Erfundene Termine planen'
    );
  });

  it('cuts a long title at a word with a mark and stays within the limit', () => {
    const title =
      'Einflussfaktoren auf die Wirtschaftlichkeit der betrieblichen Leistungserstellung in erfundenen Unternehmen beachten und bewerten';
    const out = describeUseCase(title);
    expect(out.length).toBeLessThanOrEqual(USE_CASE_DESCRIPTION_MAX);
    expect(out.endsWith('…')).toBe(true);
    expect(title.startsWith(out.slice(0, -1))).toBe(true);
    expect(title.charAt(out.length - 1)).toBe(' ');
  });

  it('is idempotent', () => {
    const once = describeUseCase('Wort '.repeat(60));
    expect(describeUseCase(once)).toBe(once);
  });

  it('is below the limits that validate a plan', () => {
    expect(USE_CASE_DESCRIPTION_MAX).toBeLessThan(MAX_USE_CASE_DESCRIPTION);
    expect(MAX_ENABLER_DESCRIPTION).toBeGreaterThan(956);
  });
});

describe('lengthStats', () => {
  it('names count, minimum, median, mean and maximum', () => {
    expect(lengthStats([10, 20, 30, 100])).toEqual({
      count: 4,
      min: 10,
      median: 25,
      mean: 40,
      max: 100,
    });
    expect(lengthStats([5, 1, 3])).toMatchObject({ median: 3, min: 1, max: 5 });
  });

  it('is null for no values', () => {
    expect(lengthStats([])).toBeNull();
  });
});

describe('lengthChangesOf', () => {
  it('names the lengths of the description columns only', () => {
    expect(
      lengthChangesOf(
        ['title', 'description_text'],
        { title: 'Alt', description_text: 'x'.repeat(500) },
        { title: 'Neu', description_text: 'kurz' }
      )
    ).toEqual({ description_text: { before: 500, after: 4 } });
  });

  it('counts a missing text as 0 and gives undefined without a description column', () => {
    expect(
      lengthChangesOf(
        ['description'],
        { description: null },
        { description: 'abc' }
      )
    ).toEqual({ description: { before: 0, after: 3 } });
    expect(
      lengthChangesOf(['title'], { title: 'a' }, { title: 'b' })
    ).toBeUndefined();
  });
});

describe('renderLengthChanges', () => {
  const differences = [
    {
      table: 'enablers',
      key: 'K1-a',
      columns: ['description_text'],
      lengths: { description_text: { before: 20000, after: 300 } },
    },
    {
      table: 'enablers',
      key: 'K1-b',
      columns: ['description_text'],
      lengths: { description_text: { before: 10000, after: 100 } },
    },
    { table: 'quizzes', key: 'K1-a-low', columns: ['title'] },
  ];

  it('names the rows, the means and the lengths before and after, numbers only', () => {
    const text = renderLengthChanges(differences, false).join('\n');
    expect(text).toContain('## Beschreibungen: Länge vorher und nachher');
    expect(text).toContain(
      '| enablers | description_text | 2 | 15000 | 200 | 20000 | 300 |'
    );
    expect(text).toContain(
      '- enablers K1-a description_text: 20000 auf 300 Zeichen'
    );
    expect(text).toContain('Nicht geändert');
    expect(text).not.toContain('quizzes');
  });

  it('says that the texts were replaced with --update-existing', () => {
    expect(renderLengthChanges(differences, true).join('\n')).toContain(
      'Mit --update-existing ersetzt'
    );
  });

  it('is empty without a description difference and lists at most 200 rows', () => {
    expect(renderLengthChanges([differences[2]], true)).toEqual([]);
    const many = Array.from({ length: 205 }, (_, i) => ({
      ...differences[0],
      key: `K${i}`,
    }));
    const text = renderLengthChanges(many, true).join('\n');
    expect(text).toContain('- und 5 weitere');
  });
});
