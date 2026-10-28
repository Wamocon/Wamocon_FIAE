// Scenario parser with invented example texts in the format of the source files.
import {
  parseScenarioText,
  toTraineeScenario,
} from '@/lib/content-import/source-parsers';
import type { Paragraph } from '@/lib/content-import/types';

const p = (text: string, bold = false): Paragraph => ({ text, bold });

const full: Paragraph[] = [
  p('Szenario 9x) Beispielthema erfunden', true),
  p(''),
  p('Ausgangssituation', true),
  p('Erfundene Person arbeitet bei der Beispiel GmbH.'),
  p('Sie soll eine erfundene Aufgabe erledigen.'),
  p('Lösungsszenario', true),
  p('Zuerst klärt sie die erfundenen Leitfragen.'),
  p('Danach setzt sie die erfundene Lösung um.'),
  p(''),
  p('Wie das Fachwissen zur Lösung beiträgt', true),
  p('Ohne das erfundene Fachwissen wäre die Lösung ungeordnet.'),
];

describe('parseScenarioText', () => {
  it('splits heading and the three sections', () => {
    const { value, issues, ok } = parseScenarioText(full);
    expect(ok).toBe(true);
    expect(issues).toEqual([]);
    expect(value.code).toBe('9x');
    expect(value.title).toBe('Beispielthema erfunden');
    expect(value.situation).toBe(
      'Erfundene Person arbeitet bei der Beispiel GmbH.\n\nSie soll eine erfundene Aufgabe erledigen.'
    );
    expect(value.solution).toBe(
      'Zuerst klärt sie die erfundenen Leitfragen.\n\nDanach setzt sie die erfundene Lösung um.'
    );
    expect(value.knowledgeContribution).toBe(
      'Ohne das erfundene Fachwissen wäre die Lösung ungeordnet.'
    );
  });

  it('marks the situation for trainees and the rest as trainer only', () => {
    const { value } = parseScenarioText(full);
    expect(value.visibility).toEqual({
      situation: 'trainee',
      task: 'trainee',
      solution: 'trainer',
      knowledgeContribution: 'trainer',
    });
  });

  it('gives trainees only the situation', () => {
    const result = parseScenarioText(full);
    const { value } = result;
    const view = toTraineeScenario(result);
    expect(view).toEqual({
      code: '9x',
      title: 'Beispielthema erfunden',
      situation: value.situation,
      task: '',
    });
    expect(JSON.stringify(view)).not.toContain('Leitfragen');
    expect(JSON.stringify(view)).not.toContain('Fachwissen');
  });

  it('reads plain text and the spelling Loesungsszenario with a colon', () => {
    const text = [
      '**Szenario 24.1a) Arbeit planen**',
      'Ausgangssituation:',
      'Eine Lage.',
      'Loesungsszenario:',
      'Eine Lösung.',
      'Wie das Fachwissen zur Loesung beitraegt:',
      'Ein Beitrag.',
    ].join('\n');
    const { value, ok } = parseScenarioText(text);
    expect(ok).toBe(true);
    expect(value.code).toBe('24.1a');
    expect(value.situation).toBe('Eine Lage.');
    expect(value.solution).toBe('Eine Lösung.');
    expect(value.knowledgeContribution).toBe('Ein Beitrag.');
  });

  it('reports a missing section but keeps the others', () => {
    const lines = full.filter(
      para => !/Lösungsszenario|Zuerst klärt|Danach setzt/.test(para.text)
    );
    const result = parseScenarioText(lines);
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.code)).toContain('SECTION_MISSING');
    expect(result.value.situation).toContain('Beispiel GmbH');
    expect(result.value.solution).toBe('');
    expect(result.value.knowledgeContribution).toContain('Fachwissen');
  });

  it('reports an empty section', () => {
    const lines = [
      p('Szenario 9x) Thema', true),
      p('Ausgangssituation', true),
      p('Lösungsszenario', true),
      p('Eine Lösung.'),
      p('Wie das Fachwissen zur Lösung beiträgt', true),
      p('Ein Beitrag.'),
    ];
    const result = parseScenarioText(lines);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'SECTION_EMPTY', severity: 'error' }),
    ]);
  });

  it('reports sections in the wrong order and a repeated section', () => {
    const swapped = [
      p('Szenario 9x) Thema', true),
      p('Lösungsszenario', true),
      p('Eine Lösung.'),
      p('Ausgangssituation', true),
      p('Eine Lage.'),
      p('Wie das Fachwissen zur Lösung beiträgt', true),
      p('Ein Beitrag.'),
    ];
    expect(parseScenarioText(swapped).issues.map(i => i.code)).toContain(
      'SECTION_ORDER'
    );
    const twice = [...full, p('Ausgangssituation', true), p('Noch einmal.')];
    expect(parseScenarioText(twice).issues.map(i => i.code)).toContain(
      'SECTION_DUPLICATE'
    );
  });

  it('accepts another form of the heading with a warning', () => {
    const lines = [
      { ...full[0], text: 'Szenario 9x: Beispielthema erfunden' },
      ...full.slice(1),
    ];
    const result = parseScenarioText(lines);
    expect(result.value.code).toBe('9x');
    expect(result.value.title).toBe('Beispielthema erfunden');
    const issue = result.issues.find(i => i.code === 'HEADING_VARIANT');
    expect(issue?.severity).toBe('warning');
    expect(result.ok).toBe(true);
  });

  it('reports a heading without a code', () => {
    const lines = [p('Ein Titel ohne Nummer', true), ...full.slice(1)];
    const result = parseScenarioText(lines);
    expect(result.value.code).toBeNull();
    expect(result.issues.map(i => i.code)).toContain('HEADING_FORMAT');
    expect(result.ok).toBe(false);
  });

  it('keeps text that comes before the first section as a warning', () => {
    const lines = [full[0], p('Einleitung ohne Abschnitt.'), ...full.slice(1)];
    const result = parseScenarioText(lines);
    expect(result.issues.map(i => i.code)).toContain('UNPARSED_LINE');
    expect(result.ok).toBe(true);
  });

  it('never throws on empty input', () => {
    const result = parseScenarioText('');
    expect(result.ok).toBe(false);
    expect(result.value.situation).toBe('');
  });

  it('gives no trainee view when the file has errors (fail closed)', () => {
    const lines = full.filter(
      para => !/Lösungsszenario|Zuerst|Danach/.test(para.text)
    );
    const broken = parseScenarioText(lines);
    expect(broken.ok).toBe(false);
    expect(toTraineeScenario(broken)).toBeNull();
  });

  it('gives no trainee view when a solution marker is in the situation', () => {
    const result = parseScenarioText(full);
    result.value.situation += '\n\nLösungsszenario\n\nDie Lösung.';
    expect(toTraineeScenario(result)).toBeNull();
  });

  it.each([
    ['Lösungsszenario (nur Trainer)', 'solution'],
    ['Lösungsszenario: Zuerst klärt sie alles.', 'solution'],
    ['Lösungsszenarien', 'solution'],
    ['Wie das Fachwissen zu der Lösung beiträgt', 'knowledge'],
  ])(
    'treats the heading variant "%s" as an error, not as situation text',
    (variant, which) => {
      const lines = [...full];
      const index = lines.findIndex(para =>
        which === 'knowledge'
          ? para.text.startsWith('Wie das')
          : para.text === 'Lösungsszenario'
      );
      lines[index] = { ...lines[index], text: variant };
      const result = parseScenarioText(lines);
      expect(result.ok).toBe(false);
      expect(result.issues.map(i => i.code)).toContain(
        'SECTION_HEADING_VARIANT'
      );
      expect(toTraineeScenario(result)).toBeNull();
    }
  );

  it('accepts the short heading Lösung', () => {
    const lines = full.map(para =>
      para.text === 'Lösungsszenario' ? { ...para, text: 'Lösung' } : para
    );
    const result = parseScenarioText(lines);
    expect(result.ok).toBe(true);
    expect(result.value.solution).toContain('Leitfragen');
  });

  it('splits a soft line break so a heading is not glued to its text', () => {
    const lines = full.map(para =>
      para.text === 'Lösungsszenario'
        ? {
            ...para,
            text: 'Lösungsszenario\nZuerst klärt sie die erfundenen Leitfragen.',
          }
        : para
    );
    const result = parseScenarioText(lines);
    expect(result.ok).toBe(true);
    expect(result.value.situation).not.toContain('Leitfragen');
    expect(result.value.solution).toContain('Leitfragen');
  });

  it('does not take a quiz heading for a scenario heading', () => {
    const result = parseScenarioText([
      { ...full[0], text: 'Quiz 9x: Beispielthema' },
      ...full.slice(1),
    ]);
    expect(result.issues.map(i => i.code)).toContain('HEADING_FORMAT');
  });

  it.each([
    ['Szenario 24/1a) Eigene Arbeit planen', '24.1a'],
    ['Szenario_14j) Verträge vorbereiten', '14j'],
    ['2f) Kalkulationstabellen erstellen', '2f'],
  ])('reads the heading variant "%s" with a warning', (heading, code) => {
    const result = parseScenarioText([
      { ...full[0], text: heading },
      ...full.slice(1),
    ]);
    expect(result.value.code).toBe(code);
    expect(result.issues.map(i => i.code)).toEqual(['HEADING_VARIANT']);
    expect(result.ok).toBe(true);
  });

  it('reports an unknown bold heading such as "Hinweise" instead of reading it as situation', () => {
    const lines = [...full];
    const index = lines.findIndex(para => para.text === 'Lösungsszenario');
    lines[index] = { text: 'Hinweise', bold: true };
    const result = parseScenarioText(lines);
    const found = result.issues.map(i => i.code);
    expect(found).toContain('SECTION_UNKNOWN_HEADING');
    expect(found).toContain('SECTION_MISSING');
    expect(result.ok).toBe(false);
    expect(toTraineeScenario(result)).toBeNull();
  });

  it('does not take a long bold sentence or a bold known heading for an unknown heading', () => {
    const lines = [
      ...full.slice(0, 4),
      {
        text: 'Dies ist ein langer fett gesetzter Satz, der mit Sicherheit keine Überschrift ist, sondern Text.',
        bold: true,
      },
      ...full.slice(4),
    ];
    const result = parseScenarioText(lines);
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
  });
});

// The section "Aufgabe" ----------------------------------------------------------

const taskLines: Paragraph[] = [
  p('Die erfundene Person soll drei erfundene Dinge ordnen.'),
  p('Dabei beachtet sie die erfundenen Vorgaben.'),
];
const TASK_TEXT =
  'Die erfundene Person soll drei erfundene Dinge ordnen.\n\nDabei beachtet sie die erfundenen Vorgaben.';

/** The full scenario with a task section after the situation (index 5). */
const withTask = (heading = 'Aufgabe'): Paragraph[] => [
  ...full.slice(0, 5),
  p(heading, true),
  ...taskLines,
  ...full.slice(5),
];

describe('parseScenarioText: the section Aufgabe', () => {
  it('reads the task as its own part that trainees may see', () => {
    const { value, issues, ok } = parseScenarioText(withTask());
    expect(ok).toBe(true);
    expect(issues).toEqual([]);
    expect(value.task).toBe(TASK_TEXT);
    expect(value.visibility.task).toBe('trainee');
    // the other parts are not touched
    const plain = parseScenarioText(full).value;
    expect(value.situation).toBe(plain.situation);
    expect(value.solution).toBe(plain.solution);
    expect(value.knowledgeContribution).toBe(plain.knowledgeContribution);
    expect(value.situation).not.toContain('Vorgaben');
    expect(value.solution).not.toContain('Vorgaben');
  });

  it('leaves the task empty and the result unchanged when there is none', () => {
    const { value, issues } = parseScenarioText(full);
    expect(value.task).toBe('');
    expect(issues).toEqual([]);
  });

  it.each(['Aufgabe', 'Aufgabenstellung', 'Aufgaben', 'Aufgabe:', 'AUFGABE'])(
    'accepts the heading "%s"',
    heading => {
      const { value, issues, ok } = parseScenarioText(withTask(heading));
      expect(ok).toBe(true);
      expect(issues).toEqual([]);
      expect(value.task).toBe(TASK_TEXT);
    }
  );

  it('reads the task in plain text with a bold marker', () => {
    const text = [
      '**Szenario 24.1a) Arbeit planen**',
      'Ausgangssituation:',
      'Eine Lage.',
      '**Aufgabenstellung**',
      'Eine Aufgabe.',
      'Loesungsszenario:',
      'Eine Lösung.',
      'Wie das Fachwissen zur Loesung beitraegt:',
      'Ein Beitrag.',
    ].join('\n');
    const { value, ok, issues } = parseScenarioText(text);
    expect(issues).toEqual([]);
    expect(ok).toBe(true);
    expect(value.task).toBe('Eine Aufgabe.');
    expect(value.solution).toBe('Eine Lösung.');
  });

  it('accepts the task directly before the solution, with an empty line', () => {
    const lines = [
      ...full.slice(0, 5),
      p('Aufgabe', true),
      ...taskLines,
      p(''),
      ...full.slice(5),
    ];
    const { value, issues, ok } = parseScenarioText(lines);
    expect(issues).toEqual([]);
    expect(ok).toBe(true);
    expect(value.task).toBe(TASK_TEXT);
    const plain = parseScenarioText(full).value;
    expect(value.solution).toBe(plain.solution);
    expect(value.knowledgeContribution).toBe(plain.knowledgeContribution);
  });

  // A task is visible text. A heading "Aufgabe" inside or after the solution
  // parts, or before the situation, must never turn solution text visible.
  it.each([
    [
      'at the end, after the knowledge part',
      () => [...full, p('Aufgabe', true), p('Weiterer erfundener Schritt.')],
    ],
    [
      'between the solution and the knowledge part',
      () => [
        ...full.slice(0, 9),
        p('Aufgaben', true),
        p('Weiterer erfundener Schritt.'),
        ...full.slice(9),
      ],
    ],
    [
      'before the situation',
      () => [
        full[0],
        p('Aufgabe', true),
        p('Weiterer erfundener Schritt.'),
        ...full.slice(1),
      ],
    ],
  ])(
    'refuses a task heading %s and keeps its text out of the view',
    (_where, build) => {
      const result = parseScenarioText(build());
      expect(result.ok).toBe(false);
      expect(result.issues.map(i => i.code)).toContain('SECTION_ORDER');
      expect(result.value.task).toBe('');
      expect(result.value.situation).not.toContain('Weiterer');
      expect(toTraineeScenario(result)).toBeNull();
    }
  );

  it('keeps the text after a misplaced task heading in the section before it', () => {
    const result = parseScenarioText([
      ...full,
      p('Aufgabe', true),
      p('Weiterer erfundener Schritt.'),
    ]);
    expect(result.value.knowledgeContribution).toContain('Weiterer');
    expect(result.value.task).toBe('');
  });

  it('warns about a task with a line that looks like the heading of a solution, the file stays usable', () => {
    const lines = withTask();
    lines.splice(7, 0, p('Erwartete Lösung'));
    const result = parseScenarioText(lines);
    expect(result.issues).toEqual([
      expect.objectContaining({
        code: 'TASK_SOLUTION_HEADING',
        severity: 'warning',
      }),
    ]);
    expect(result.ok).toBe(true);
    // the whole scenario is public, so the view is not refused for it
    expect(toTraineeScenario(result)).not.toBeNull();
    const view = parseScenarioText(withTask());
    view.value.task += '\n\nAntwortschlüssel';
    expect(toTraineeScenario(view)).not.toBeNull();
  });

  it('does not let the task disturb the order check of the other parts', () => {
    const swapped = [
      p('Szenario 9x) Thema', true),
      p('Lösungsszenario', true),
      p('Eine Lösung.'),
      p('Aufgabe', true),
      p('Eine Aufgabe.'),
      p('Ausgangssituation', true),
      p('Eine Lage.'),
      p('Wie das Fachwissen zur Lösung beiträgt', true),
      p('Ein Beitrag.'),
    ];
    const codes = parseScenarioText(swapped).issues.map(i => i.code);
    expect(new Set(codes)).toEqual(new Set(['SECTION_ORDER']));
  });

  it('reports a task that stands twice', () => {
    const twice = [...withTask(), p('Aufgabe', true), p('Noch eine.')];
    const result = parseScenarioText(twice);
    expect(result.issues.map(i => i.code)).toContain('SECTION_DUPLICATE');
    expect(result.ok).toBe(false);
    expect(toTraineeScenario(result)).toBeNull();
  });

  it('reports an empty task', () => {
    const lines = [...full.slice(0, 5), p('Aufgabe', true), ...full.slice(5)];
    const result = parseScenarioText(lines);
    expect(result.issues).toEqual([
      expect.objectContaining({ code: 'SECTION_EMPTY', severity: 'error' }),
    ]);
    expect(result.ok).toBe(false);
    expect(toTraineeScenario(result)).toBeNull();
  });

  it('reports a bold heading that only looks like the task', () => {
    const result = parseScenarioText(withTask('Aufgabe (nur Trainer)'));
    expect(result.issues.map(i => i.code)).toContain('SECTION_UNKNOWN_HEADING');
    expect(result.ok).toBe(false);
  });

  it('does not take a running sentence that starts with the word for a heading', () => {
    const lines = [
      ...full.slice(0, 4),
      p('Aufgabe der Person ist es, die erfundene Lage zu ordnen.'),
      ...full.slice(4),
    ];
    const result = parseScenarioText(lines);
    expect(result.ok).toBe(true);
    expect(result.value.task).toBe('');
    expect(result.value.situation).toContain('Aufgabe der Person');
  });

  describe('what trainees get', () => {
    it('adds the task to the view and nothing of the solution', () => {
      const result = parseScenarioText(withTask());
      const view = toTraineeScenario(result);
      expect(view).toEqual({
        code: '9x',
        title: 'Beispielthema erfunden',
        situation: result.value.situation,
        task: TASK_TEXT,
      });
      const shown = JSON.stringify(view);
      for (const hidden of ['Leitfragen', 'Fachwissen', 'Lösung umsetzt']) {
        expect(shown).not.toContain(hidden);
      }
    });

    it('lets a task use the word Lösung in running text', () => {
      const lines = withTask();
      lines[6] = p('Entwickeln Sie eine Lösung für die erfundene Lage.');
      const view = toTraineeScenario(parseScenarioText(lines));
      expect(view?.task).toContain('eine Lösung für');
    });

    it.each([
      ['a solution heading', 'Lösungsszenario'],
      ['a rationale label', 'Kurzbegründung: Eine erfundene Begründung.'],
      ['a label of the right answer', 'Richtige Antwort: B'],
      ['the heading of the knowledge part', 'Fachwissen zur Lösung'],
    ])('refuses a task that carries %s', (_what, text) => {
      const result = parseScenarioText(withTask());
      result.value.task += `\n\n${text}`;
      expect(toTraineeScenario(result)).toBeNull();
    });

    it.each([
      [
        'a paragraph of the solution',
        (lines: Paragraph[]) => {
          lines[7] = p('  Zuerst klärt sie die erfundenen LEITFRAGEN. ');
        },
      ],
      [
        'a paragraph of the knowledge part',
        (lines: Paragraph[]) => {
          lines[7] = p(
            'Ohne das erfundene Fachwissen wäre die Lösung ungeordnet.'
          );
        },
      ],
      [
        'a part of a longer solution paragraph',
        (lines: Paragraph[]) => {
          lines[6] = p('Danach setzt sie die erfundene Lösung');
        },
      ],
    ])(
      'warns about a task that repeats %s and keeps the file',
      (_what, edit) => {
        const lines = withTask();
        edit(lines);
        const result = parseScenarioText(lines);
        expect(result.issues.map(i => `${i.severity}:${i.code}`)).toContain(
          'warning:TASK_SOLUTION_OVERLAP'
        );
        expect(result.issues.every(i => i.severity === 'warning')).toBe(true);
        expect(result.ok).toBe(true);
        expect(toTraineeScenario(result)).not.toBeNull();
      }
    );

    it('still refuses a task that carries a marker word after parsing (fail closed)', () => {
      const result = parseScenarioText(withTask());
      result.value.task = `${result.value.task}\n\nRichtige Antwort: B`;
      expect(toTraineeScenario(result)).toBeNull();
    });
  });

  describe('a task heading where the solution heading should be', () => {
    const inPlace = (): Paragraph[] =>
      full.map(para =>
        para.text === 'Lösungsszenario' ? p('Aufgabe', true) : para
      );

    it('reads the section as the solution (trainer only) and says so', () => {
      const result = parseScenarioText(inPlace());
      expect(result.ok).toBe(true);
      expect(result.issues).toEqual([
        expect.objectContaining({
          code: 'TASK_AS_SOLUTION',
          severity: 'warning',
        }),
      ]);
      expect(result.value.solution).toBe(
        parseScenarioText(full).value.solution
      );
      expect(result.value.task).toBe('');
      expect(result.value.visibility.solution).toBe('trainer');
    });

    it('keeps that text away from trainees', () => {
      const result = parseScenarioText(inPlace());
      const view = toTraineeScenario(result);
      expect(view).not.toBeNull();
      expect(view?.task).toBe('');
      const shown = JSON.stringify(view);
      expect(shown).not.toContain('Leitfragen');
      expect(shown).not.toContain('Fachwissen');
    });

    it('also works with the other heading forms and reports a missing knowledge part', () => {
      for (const heading of ['Aufgabenstellung', 'Aufgaben', 'Aufgabe:']) {
        const lines = full.map(para =>
          para.text === 'Lösungsszenario' ? p(heading, true) : para
        );
        const result = parseScenarioText(lines);
        expect(result.ok).toBe(true);
        expect(result.value.solution).toContain('Leitfragen');
      }
      const result = parseScenarioText(inPlace().slice(0, 9));
      expect(result.issues.map(i => i.code)).toEqual([
        'TASK_AS_SOLUTION',
        'SECTION_MISSING',
      ]);
    });

    it('still checks the order of the parts', () => {
      const lines = [
        ...full.slice(0, 5),
        ...full.slice(9),
        p('Aufgabe', true),
        p('Eine Lösung.'),
      ];
      const result = parseScenarioText(lines);
      expect(result.issues.map(i => i.code)).toContain('SECTION_ORDER');
      expect(result.ok).toBe(false);
    });

    it('does not do it when a solution heading exists, the task stays a task', () => {
      const result = parseScenarioText(withTask());
      expect(result.issues).toEqual([]);
      expect(result.value.task).toBe(TASK_TEXT);
    });
  });
});
