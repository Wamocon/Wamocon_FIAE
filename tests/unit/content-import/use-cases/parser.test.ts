import { toParagraphs } from '@/lib/content-import/source-parsers';
import {
  USE_CASE_SOLUTION_FIELDS,
  assignmentText,
  hasUseCaseSolutionMarker,
  parseUseCaseText,
  renderBlocks,
  toTraineeUseCase,
} from '@/lib/content-import/use-cases/parser';

import { bold, plain, table, useCaseParagraphs } from './fixtures';

const codes = (result: ReturnType<typeof parseUseCaseText>) =>
  result.issues.map(i => `${i.severity}:${i.code}`);

describe('parseUseCaseText: a complete document', () => {
  const result = parseUseCaseText(useCaseParagraphs('4a'));

  it('has no issue at all', () => {
    expect(codes(result)).toEqual([]);
    expect(result.ok).toBe(true);
  });

  it('reads code and title from the heading', () => {
    expect(result.value.code).toBe('4a');
    expect(result.value.title).toBe('Erfundener Titel 4a');
  });

  it('splits the sections and keeps the data table inside the situation', () => {
    const v = result.value;
    expect(v.topics).toBe('Erfundenes Thema A: Lehrsatz 4a.');
    expect(v.situation).toBe(
      [
        'Die erfundene Firma 4a hat ein Problem.',
        'Eckdaten',
        'Die Daten stehen in der Tabelle.',
        'Posten | Menge\nSchrauben | 12\nMuttern | ',
      ].join('\n\n')
    );
    expect(v.hasDataTable).toBe(true);
    expect(v.objective).toBe('Erstellen Sie einen erfundenen Vorschlag 4a.');
    expect(v.steps).toBe(
      'Erster Schritt: Daten erfassen.\n\nZweiter Schritt: Ergebnis begründen.'
    );
    expect(v.solution).toContain('OMEGA-4a');
    expect(v.solution).toContain('Posten | Ergebnis\nSchrauben | ZETA-4a');
    expect(v.criteria).toBe('');
  });

  it('marks what is a solution', () => {
    expect(USE_CASE_SOLUTION_FIELDS).toEqual(['solution', 'criteria']);
    expect(result.value.visibility).toEqual({
      topics: 'trainee',
      situation: 'trainee',
      objective: 'trainee',
      steps: 'trainee',
      solution: 'trainer',
      criteria: 'trainer',
    });
  });

  it('reads plain text input too (one line per paragraph, ** is bold)', () => {
    const text = [
      '2b) Titel',
      '**Ausgangssituation**',
      'Lage.',
      '**Zielsetzung**',
      'Ziel.',
      '**Weg zum Ziel**',
      'Schritt.',
      '**Musterlösung**',
      'Lösung.',
    ].join('\n');
    const parsed = parseUseCaseText(text);
    expect(parsed.ok).toBe(true);
    expect(parsed.value.solution).toBe('Lösung.');
    // the optional topics and the data table are only noted
    expect(codes(parsed)).toEqual([
      'warning:SECTION_MISSING',
      'warning:DATA_HEADING_MISSING',
    ]);
  });
});

describe('parseUseCaseText: the heading', () => {
  it.each([
    ['24.1a) Titel', '24.1a'],
    ['24_1a) Titel', '24.1a'],
    ['6.2d) Titel', '6.2d'],
  ])('reads %s as %s', (heading, code) => {
    const parsed = parseUseCaseText(useCaseParagraphs('x', { heading }));
    expect(parsed.value.code).toBe(code);
    expect(codes(parsed)).toEqual([]);
  });

  it.each(['UC 4a: Titel', 'UC_4a) Titel', '4a - Titel', '25/1b) Titel'])(
    'accepts the variant "%s" with a warning',
    heading => {
      const parsed = parseUseCaseText(useCaseParagraphs('x', { heading }));
      expect(parsed.ok).toBe(true);
      expect(parsed.value.code).not.toBeNull();
      expect(codes(parsed)).toEqual(['warning:HEADING_VARIANT']);
    }
  );

  it.each(['Ein Titel ohne Code', '3D-Druck) Titel', '4A) Großbuchstabe'])(
    'refuses "%s" as heading',
    heading => {
      const parsed = parseUseCaseText(useCaseParagraphs('x', { heading }));
      expect(parsed.ok).toBe(false);
      expect(parsed.value.code).toBeNull();
      expect(parsed.value.title).toBe(heading);
      expect(codes(parsed)).toContain('error:HEADING_FORMAT');
    }
  );

  it('the messages about a heading quote no text of the document', () => {
    for (const heading of [
      'Geheimer Titel ohne Code',
      'UC 4a: Geheimer Titel',
    ]) {
      const parsed = parseUseCaseText(useCaseParagraphs('x', { heading }));
      for (const issue of parsed.issues) {
        expect(issue.message).not.toContain('Geheimer');
      }
    }
  });

  it('skips empty paragraphs before the heading', () => {
    const parsed = parseUseCaseText([
      plain(''),
      plain('   '),
      ...useCaseParagraphs('4a'),
    ]);
    expect(parsed.value.code).toBe('4a');
  });
});

describe('parseUseCaseText: errors and warnings, it never throws', () => {
  it('reports empty input', () => {
    for (const input of ['', [], [plain(' ')], null, undefined, 42]) {
      const parsed = parseUseCaseText(input as never);
      expect(parsed.ok).toBe(false);
      expect(codes(parsed)).toEqual(['error:EMPTY_INPUT']);
    }
  });

  it.each([
    ['situation', 'Ausgangssituation'],
    ['objective', 'Zielsetzung'],
    ['steps', 'Weg zum Ziel'],
    ['solution', 'Musterlösung'],
  ])('a missing %s is an error', (section, label) => {
    const parsed = parseUseCaseText(
      useCaseParagraphs('4a', { omit: [section] })
    );
    expect(parsed.ok).toBe(false);
    const missing = parsed.issues.find(i => i.code === 'SECTION_MISSING');
    expect(missing?.severity).toBe('error');
    expect(missing?.message).toContain(label);
  });

  it('missing topics and a missing data table are warnings, the file is usable', () => {
    const parsed = parseUseCaseText(
      useCaseParagraphs('4a', { omit: ['topics', 'data'] })
    );
    expect(parsed.ok).toBe(true);
    expect(codes(parsed)).toEqual([
      'warning:SECTION_MISSING',
      'warning:DATA_HEADING_MISSING',
    ]);
    expect(parsed.value.topics).toBe('');
    expect(parsed.value.hasDataTable).toBe(false);
  });

  it('an empty required section is an error, an empty topics section a warning', () => {
    const base = useCaseParagraphs('4a');
    // remove the text paragraph that follows the heading line of a section
    const without = (name: string) => {
      const out = [...base];
      const at = out.findIndex(p => p.text === name);
      out.splice(at + 1, 1);
      return out;
    };
    const objective = parseUseCaseText(without('Zielsetzung'));
    expect(codes(objective)).toContain('error:SECTION_EMPTY');
    expect(objective.ok).toBe(false);
    const topics = parseUseCaseText(without('Behandelte Themen'));
    expect(codes(topics)).toEqual(['warning:SECTION_EMPTY']);
    expect(topics.ok).toBe(true);
  });

  it('a duplicate section heading is an error', () => {
    const parsed = parseUseCaseText([
      ...useCaseParagraphs('4a'),
      bold('Zielsetzung'),
      plain('Noch einmal.'),
    ]);
    expect(parsed.ok).toBe(false);
    expect(codes(parsed)).toContain('error:SECTION_DUPLICATE');
  });

  it('sections in the wrong order are an error', () => {
    const base = useCaseParagraphs('4a');
    const at = (name: string) => base.findIndex(p => p.text === name);
    const swapped = [
      ...base.slice(0, at('Zielsetzung')),
      ...base.slice(at('Weg zum Ziel'), at('Musterlösung')),
      ...base.slice(at('Zielsetzung'), at('Weg zum Ziel')),
      ...base.slice(at('Musterlösung')),
    ];
    const parsed = parseUseCaseText(swapped);
    expect(parsed.ok).toBe(false);
    expect(codes(parsed)).toEqual(['error:SECTION_ORDER']);
  });

  it('a section name that is not bold, or stands in a table, is text and gets a warning', () => {
    const parsed = parseUseCaseText(
      useCaseParagraphs('4a', {
        extraSteps: [
          plain('Zielsetzung'),
          ...table([['Zielsetzung', 'Weg zum Ziel']]).map(p => ({
            ...p,
            bold: true,
          })),
        ],
      })
    );
    expect(parsed.ok).toBe(true);
    expect(codes(parsed)).toEqual(['warning:SECTION_HEADING_NOT_BOLD']);
    expect(parsed.value.objective).toBe(
      'Erstellen Sie einen erfundenen Vorschlag 4a.'
    );
    expect(parsed.value.steps).toContain('Zielsetzung');
  });

  it.each([
    ['not bold', (text: string) => plain(text)],
    ['in a table', (text: string) => ({ ...bold(text), row: 9, cell: 9 })],
  ])(
    'a solution heading that is %s is an error, its text must not stay visible',
    (_name, make) => {
      for (const heading of ['Musterlösung', 'Bewertungskriterien']) {
        const base = useCaseParagraphs('4a', { omit: ['solution'] });
        const parsed = parseUseCaseText([
          ...base,
          make(heading),
          plain('Die Antwort steht hier.'),
        ]);
        expect(parsed.ok).toBe(false);
        expect(codes(parsed)).toContain('error:SOLUTION_HEADING_NOT_BOLD');
        expect(toTraineeUseCase(parsed)).toBeNull();
      }
    }
  );

  it('a heading with invisible direction marks is still read as a heading', () => {
    const parsed = parseUseCaseText(
      useCaseParagraphs('4a').map(p =>
        p.text === 'Musterlösung' ? { ...p, text: '‎Musterl‫ösung‏' } : p
      )
    );
    expect(codes(parsed)).toEqual([]);
    expect(parsed.value.solution).toContain('OMEGA');
  });

  it('a line that is only the heading of the criteria is a marker in visible text, the word in a sentence is not', () => {
    expect(
      hasUseCaseSolutionMarker(['Vorher\nBewertungskriterien\nNachher'])
    ).toBe(true);
    expect(hasUseCaseSolutionMarker(['Bewertungskriterien:'])).toBe(true);
    expect(hasUseCaseSolutionMarker(['Die Bewertungskriterien gelten.'])).toBe(
      false
    );
  });

  it('text before the first section is ignored with a warning', () => {
    const base = useCaseParagraphs('4a');
    const parsed = parseUseCaseText([
      base[0],
      plain('Ein Vorspann, der in keinen Abschnitt gehört.'),
      ...base.slice(1),
    ]);
    expect(parsed.ok).toBe(true);
    expect(codes(parsed)).toEqual(['warning:UNPARSED_LINE']);
    expect(parsed.value.situation).not.toContain('Vorspann');
  });

  it('reads the optional criteria as a solution section of its own', () => {
    const parsed = parseUseCaseText(
      useCaseParagraphs('4a', { criteria: 'Erfundenes Kriterium KAPPA.' })
    );
    expect(codes(parsed)).toEqual([]);
    expect(parsed.value.criteria).toBe('Erfundenes Kriterium KAPPA.');
    expect(parsed.value.solution).not.toContain('KAPPA');
  });

  it('criteria before the solution are an order error', () => {
    const base = useCaseParagraphs('4a', { criteria: 'Kriterium.' });
    const at = (name: string) => base.findIndex(p => p.text === name);
    const parsed = parseUseCaseText([
      ...base.slice(0, at('Musterlösung')),
      ...base.slice(at('Bewertungskriterien')),
      ...base.slice(at('Musterlösung'), at('Bewertungskriterien')),
    ]);
    expect(codes(parsed)).toContain('error:SECTION_ORDER');
  });
});

describe('renderBlocks', () => {
  it('writes table rows as lines with " | " and keeps empty cells', () => {
    const text = renderBlocks([
      plain('Vor'),
      ...table([
        ['A', 'B'],
        ['', 'D'],
      ]),
      plain('Nach'),
    ]);
    expect(text).toBe('Vor\n\nA | B\n | D\n\nNach');
  });

  it('joins several paragraphs of one cell with a space', () => {
    const text = renderBlocks([
      { text: 'eins', bold: false, row: 1, cell: 1 },
      { text: 'zwei', bold: false, row: 1, cell: 1 },
      { text: 'drei', bold: false, row: 1, cell: 2 },
    ]);
    expect(text).toBe('eins zwei | drei');
  });

  it('drops empty paragraphs and rows without any text', () => {
    expect(
      renderBlocks([
        plain(''),
        plain('x'),
        { text: '', bold: false, row: 1, cell: 1 },
        { text: '', bold: false, row: 1, cell: 2 },
        plain('y'),
      ])
    ).toBe('x\n\ny');
  });

  it('gives paragraphs of a row without a cell number a cell each', () => {
    expect(
      renderBlocks([
        { text: 'a', bold: false, row: 1 },
        { text: 'b', bold: false, row: 1 },
      ])
    ).toBe('a | b');
  });

  it('separates two tables that follow each other by their row numbers', () => {
    const text = renderBlocks([
      ...table([['A', 'B']], 1, 1),
      ...table([['C', 'D']], 2, 3),
    ]);
    expect(text).toBe('A | B\nC | D');
  });

  it('keeps table information when it is passed through toParagraphs', () => {
    const [first] = toParagraphs([
      { text: 'Zelle', bold: true, row: 4, cell: 9 },
    ]);
    expect(first).toEqual({ text: 'Zelle', bold: true, row: 4, cell: 9 });
    const [text] = toParagraphs(['nur Text']);
    expect('row' in text).toBe(false);
  });
});

describe('toTraineeUseCase: solution protection', () => {
  const view = (options = {}) =>
    toTraineeUseCase(parseUseCaseText(useCaseParagraphs('4a', options)));

  it('gives only the visible fields', () => {
    const trainee = view();
    expect(trainee).not.toBeNull();
    expect(Object.keys(trainee as object).sort()).toEqual([
      'code',
      'objective',
      'situation',
      'steps',
      'title',
      'topics',
    ]);
    const json = JSON.stringify(trainee);
    expect(json).not.toContain('OMEGA');
    expect(json).not.toContain('ZETA');
    expect(json).not.toContain('Musterlösung');
  });

  it('refuses a file with an error', () => {
    expect(view({ omit: ['solution'] })).toBeNull();
  });

  it('refuses a visible text that shows a solution marker', () => {
    for (const word of [
      'Vergleichen Sie mit der Musterlösung.',
      'Richtige Antwort: B',
      'Kurzbegründung: weil',
      'Lösungsszenario folgt',
      'Fachwissen zur Lösung',
      'Musterloesung',
    ]) {
      const trainee = view({ extraSteps: [plain(word)] });
      expect(trainee).toBeNull();
    }
  });

  it('does not take the word Bewertungskriterien for a marker, tasks use it', () => {
    const trainee = view({
      extraSteps: [plain('Die sieben Bewertungskriterien addieren.')],
    });
    expect(trainee).not.toBeNull();
    expect(trainee?.steps).toContain('Bewertungskriterien');
  });

  it('refuses a marker in the title', () => {
    expect(view({ heading: '4a) Musterlösung für das Büro' })).toBeNull();
  });

  it('hasUseCaseSolutionMarker looks at every text', () => {
    expect(hasUseCaseSolutionMarker(['ok', 'noch ok'])).toBe(false);
    expect(hasUseCaseSolutionMarker(['ok', 'Musterlösung'])).toBe(true);
  });

  it('the assignment text names the three visible sections in order', () => {
    const parsed = parseUseCaseText(useCaseParagraphs('4a'));
    const text = assignmentText(parsed.value);
    expect(text.indexOf('Ausgangssituation')).toBe(0);
    expect(text.indexOf('Zielsetzung')).toBeGreaterThan(
      text.indexOf('Ausgangssituation')
    );
    expect(text.indexOf('Weg zum Ziel')).toBeGreaterThan(
      text.indexOf('Zielsetzung')
    );
    expect(text).not.toContain('OMEGA');
  });
});
