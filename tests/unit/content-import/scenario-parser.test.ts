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

  it('reports an unknown bold heading such as "Aufgabe" instead of reading it as situation', () => {
    const lines = [...full];
    const index = lines.findIndex(para => para.text === 'Lösungsszenario');
    lines[index] = { text: 'Aufgabe', bold: true };
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
