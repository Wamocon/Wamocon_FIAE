// Quiz parser with invented example texts in the format of the source files.
import {
  globalQuestionDifficulty,
  parseQuizText,
  toTraineeQuiz,
} from '@/lib/content-import/source-parsers';
import type { Paragraph } from '@/lib/content-import/types';

interface Q {
  n: number;
  text?: string;
  options?: string[];
  answer?: string | null;
  rationale?: string | null;
}

/** Builds one question block as paragraphs in the source style. */
function question(q: Q): Paragraph[] {
  const options = q.options ?? [
    'A) Erste Möglichkeit',
    'B) Zweite Möglichkeit',
    'C) Dritte Möglichkeit',
    'D) Vierte Möglichkeit',
  ];
  const out: Paragraph[] = [
    { text: `${q.n}. ${q.text ?? `Erfundene Frage ${q.n}?`}`, bold: true },
    ...options.map(text => ({ text, bold: false })),
  ];
  if (q.answer !== null) {
    out.push({ text: `Richtige Antwort: ${q.answer ?? 'B'}`, bold: true });
  }
  if (q.rationale !== null) {
    out.push({
      text: `Kurzbegründung: ${q.rationale ?? 'Weil es so erfunden ist.'}`,
      bold: false,
    });
  }
  out.push({ text: '', bold: false });
  return out;
}

const enablerHead = (code = '9x', level = 'leicht'): Paragraph[] => [
  { text: `${code}) Beispielthema erfunden`, bold: false },
  { text: `Quiz, Schwierigkeitsgrad: ${level}`, bold: true },
  { text: '', bold: false },
];

const quiz = (qs: Q[], head = enablerHead()): Paragraph[] => [
  ...head,
  ...qs.flatMap(question),
];

const three = [{ n: 1 }, { n: 2 }, { n: 3 }];

describe('parseQuizText: valid enabler quiz', () => {
  it('parses heading, difficulty, questions, options and solutions', () => {
    const { value, issues, ok } = parseQuizText(quiz(three), {
      expectedQuestions: 3,
    });
    expect(ok).toBe(true);
    expect(issues).toEqual([]);
    expect(value.kind).toBe('enabler');
    expect(value.enablerCode).toBe('9x');
    expect(value.title).toBe('Beispielthema erfunden');
    expect(value.difficulty).toBe('low');
    expect(value.questions).toHaveLength(3);
    expect(value.questions[1]).toMatchObject({
      number: 2,
      text: 'Erfundene Frage 2?',
      correctLetter: 'B',
      rationale: 'Weil es so erfunden ist.',
      difficulty: null,
    });
    expect(value.questions[1].options.map(o => o.letter)).toEqual([
      'A',
      'B',
      'C',
      'D',
    ]);
    expect(value.questions[1].options[2].text).toBe('Dritte Möglichkeit');
  });

  it('maps the three difficulty names to low, medium and high', () => {
    const level = (word: string) =>
      parseQuizText(quiz(three, enablerHead('1a', word))).value.difficulty;
    expect(level('leicht')).toBe('low');
    expect(level('mittel')).toBe('medium');
    expect(level('anspruchsvoll')).toBe('high');
    expect(level('schwer')).toBe('high');
  });

  it('parses a split heading like 24.1a and 24_1a', () => {
    expect(
      parseQuizText(quiz(three, enablerHead('24.1a'))).value.enablerCode
    ).toBe('24.1a');
    expect(
      parseQuizText(quiz(three, enablerHead('24_1a'))).value.enablerCode
    ).toBe('24.1a');
  });

  it('accepts plain text with ** around bold lines', () => {
    const text = [
      '2f) Tabellen erfunden',
      '**Quiz, Schwierigkeitsgrad: mittel**',
      '',
      '**1. Frage eins?**',
      'A) a',
      'B) b',
      'C) c',
      'D) d',
      '**Richtige Antwort: D**',
      'Kurzbegründung: Darum.',
    ].join('\n');
    const { value, ok } = parseQuizText(text);
    expect(ok).toBe(true);
    expect(value.questions[0].text).toBe('Frage eins?');
    expect(value.questions[0].correctLetter).toBe('D');
  });

  it('accepts a list of strings and a rationale over two paragraphs', () => {
    const lines = [
      '2f) Tabellen erfunden',
      'Quiz, Schwierigkeitsgrad: leicht',
      '1. Frage?',
      'A) a',
      'B) b',
      'C) c',
      'D) d',
      'Richtige Antwort: A',
      'Kurzbegründung: Erster Teil.',
      'Zweiter Teil der Begründung.',
    ];
    const { value, ok } = parseQuizText(lines);
    expect(ok).toBe(true);
    expect(value.questions[0].rationale).toBe(
      'Erster Teil. Zweiter Teil der Begründung.'
    );
  });

  it('joins a question text that runs over several paragraphs', () => {
    const lines = [
      '2f) Tabellen erfunden',
      'Quiz, Schwierigkeitsgrad: leicht',
      '1. Erster Teil der Frage',
      'zweiter Teil der Frage?',
      'A) a',
      'B) b',
      'C) c',
      'D) d',
      'Richtige Antwort: C',
      'Kurzbegründung: Darum.',
    ];
    const { value } = parseQuizText(lines);
    expect(value.questions[0].text).toBe(
      'Erster Teil der Frage zweiter Teil der Frage?'
    );
  });

  it('reads the correct letter also from "B) Text" and lower case', () => {
    const a = parseQuizText(quiz([{ n: 1, answer: 'B) Zweite Möglichkeit' }]));
    expect(a.value.questions[0].correctLetter).toBe('B');
    const b = parseQuizText(quiz([{ n: 1, answer: 'c' }]));
    expect(b.value.questions[0].correctLetter).toBe('C');
    expect(b.ok).toBe(true);
    expect(b.issues.map(i => i.code)).toEqual(['ANSWER_LOWERCASE']);
  });
});

describe('parseQuizText: errors are collected, not thrown', () => {
  const codes = (qs: Q[], head?: Paragraph[]) =>
    parseQuizText(quiz(qs, head)).issues.map(i => i.code);

  it('reports a missing option and still returns the other questions', () => {
    const result = parseQuizText(
      quiz([{ n: 1 }, { n: 2, options: ['A) a', 'B) b', 'C) c'] }, { n: 3 }])
    );
    expect(result.ok).toBe(false);
    expect(result.value.questions).toHaveLength(3);
    const issue = result.issues.find(i => i.code === 'OPTION_COUNT');
    expect(issue).toMatchObject({ question: 2, severity: 'error' });
  });

  it('reports a wrong option order and a fifth option', () => {
    expect(
      codes([{ n: 1, options: ['A) a', 'C) c', 'B) b', 'D) d'] }])
    ).toContain('OPTION_ORDER');
    expect(
      codes([{ n: 1, options: ['A) a', 'B) b', 'C) c', 'D) d', 'E) e'] }])
    ).toContain('OPTION_COUNT');
  });

  it('reports two correct answers, as two lines and as one line', () => {
    const twoLines: Paragraph[] = [
      ...enablerHead(),
      { text: '1. Frage?', bold: true },
      { text: 'A) a', bold: false },
      { text: 'B) b', bold: false },
      { text: 'C) c', bold: false },
      { text: 'D) d', bold: false },
      { text: 'Richtige Antwort: A', bold: true },
      { text: 'Richtige Antwort: C', bold: true },
      { text: 'Kurzbegründung: Darum.', bold: false },
    ];
    const a = parseQuizText(twoLines);
    expect(a.issues.map(i => i.code)).toContain('ANSWER_MULTIPLE');
    expect(codes([{ n: 1, answer: 'A, C' }])).toContain('ANSWER_MULTIPLE');
    expect(codes([{ n: 1, answer: 'B und D' }])).toContain('ANSWER_MULTIPLE');
  });

  it('reports a missing answer, an invalid letter and a missing rationale', () => {
    expect(codes([{ n: 1, answer: null }])).toContain('ANSWER_MISSING');
    expect(codes([{ n: 1, answer: 'F' }])).toContain('ANSWER_INVALID');
    expect(codes([{ n: 1, rationale: null }])).toContain('RATIONALE_MISSING');
  });

  it('reports a gap and a repeated number in the numbering', () => {
    expect(codes([{ n: 1 }, { n: 3 }, { n: 4 }])).toContain(
      'QUESTION_NUMBER_GAP'
    );
    expect(codes([{ n: 1 }, { n: 2 }, { n: 2 }])).toContain(
      'QUESTION_NUMBER_GAP'
    );
    expect(codes([{ n: 2 }, { n: 3 }])).toContain('QUESTION_NUMBER_GAP');
  });

  it('reports a wrong question count only when a count is expected', () => {
    const result = parseQuizText(quiz(three), { expectedQuestions: 20 });
    expect(result.issues.map(i => i.code)).toContain('QUESTION_COUNT');
    expect(parseQuizText(quiz(three)).issues).toEqual([]);
  });

  it('reports a file without any question', () => {
    const result = parseQuizText(enablerHead());
    expect(result.ok).toBe(false);
    expect(result.issues.map(i => i.code)).toContain('NO_QUESTIONS');
  });

  it('reports an empty input and never throws', () => {
    expect(parseQuizText('').ok).toBe(false);
    expect(parseQuizText([]).issues.length).toBeGreaterThan(0);
  });

  it('reports a missing or unknown difficulty line', () => {
    const noLevel: Paragraph[] = [
      { text: '1a) Thema', bold: false },
      ...question({ n: 1 }),
    ];
    expect(parseQuizText(noLevel).issues.map(i => i.code)).toContain(
      'DIFFICULTY_MISSING'
    );
    expect(codes(three, enablerHead('1a', 'extrem'))).toContain(
      'DIFFICULTY_UNKNOWN'
    );
  });

  it('warns about text it cannot place', () => {
    const lines = [
      ...enablerHead(),
      { text: 'Vorbemerkung ohne Nummer', bold: false },
      ...question({ n: 1 }),
    ];
    const result = parseQuizText(lines);
    expect(result.issues.map(i => i.code)).toContain('UNPARSED_LINE');
    expect(result.ok).toBe(true);
  });
});

describe('parseQuizText: heading variants', () => {
  it('accepts another form of the heading with a warning', () => {
    const lines = quiz(three, [
      { text: 'Quiz 1b: Grundfunktionen anwenden', bold: false },
      { text: 'Quiz, Schwierigkeitsgrad: leicht', bold: true },
    ]);
    const result = parseQuizText(lines);
    expect(result.value.enablerCode).toBe('1b');
    expect(result.value.title).toBe('Grundfunktionen anwenden');
    const issue = result.issues.find(i => i.code === 'HEADING_VARIANT');
    expect(issue?.severity).toBe('warning');
    expect(result.ok).toBe(true);
  });

  it('reports a heading that carries no code', () => {
    const lines = quiz(three, [
      { text: 'Beispielthema ganz ohne Nummer', bold: false },
      { text: 'Quiz, Schwierigkeitsgrad: leicht', bold: true },
    ]);
    const result = parseQuizText(lines);
    expect(result.value.enablerCode).toBeNull();
    expect(result.issues.map(i => i.code)).toContain('HEADING_FORMAT');
    expect(result.ok).toBe(false);
  });
});

describe('parseQuizText: global quiz', () => {
  const globalHead: Paragraph[] = [
    {
      text: '06.1) Auftragsbearbeitung durchführen (§ 4 Abs. 2 Nr. 6)',
      bold: true,
    },
    { text: 'Global Quiz', bold: true },
  ];
  const twenty = Array.from({ length: 20 }, (_, i) => ({ n: i + 1 }));

  it('detects the global quiz, reads the component and the bands', () => {
    const result = parseQuizText(quiz(twenty, globalHead), {
      expectedQuestions: 20,
    });
    expect(result.ok).toBe(true);
    expect(result.value.kind).toBe('global');
    expect(result.value.componentKey).toBe('06.1');
    expect(result.value.enablerCode).toBeNull();
    expect(result.value.title).toBe(
      'Auftragsbearbeitung durchführen (§ 4 Abs. 2 Nr. 6)'
    );
    expect(result.value.difficulty).toBe('mixed');
    const d = result.value.questions.map(q => q.difficulty);
    expect(d.slice(0, 5)).toEqual(Array(5).fill('low'));
    expect(d.slice(5, 15)).toEqual(Array(10).fill('medium'));
    expect(d.slice(15)).toEqual(Array(5).fill('high'));
  });

  it('gives the band of a question number', () => {
    expect(globalQuestionDifficulty(1)).toBe('low');
    expect(globalQuestionDifficulty(5)).toBe('low');
    expect(globalQuestionDifficulty(6)).toBe('medium');
    expect(globalQuestionDifficulty(15)).toBe('medium');
    expect(globalQuestionDifficulty(16)).toBe('high');
    expect(globalQuestionDifficulty(20)).toBe('high');
  });
});

describe('solution protection', () => {
  it('lists the solution fields and strips them for trainees', () => {
    const result = parseQuizText(quiz(three));
    const { value } = result;
    expect(value.solutionFields).toEqual(['correctLetter', 'rationale']);
    expect(Object.isFrozen(value.solutionFields)).toBe(true);
    const view = toTraineeQuiz(result);
    expect(view).not.toBeNull();
    expect(JSON.stringify(view)).not.toContain('Weil es so erfunden ist');
    for (const q of view!.questions) {
      expect(q).not.toHaveProperty('correctLetter');
      expect(q).not.toHaveProperty('rationale');
      expect(q.options).toHaveLength(4);
    }
    expect(view!.title).toBe(value.title);
    // the original stays untouched
    expect(value.questions[0].correctLetter).toBe('B');
  });

  it('gives no trainee view when the file has errors (fail closed)', () => {
    const broken = parseQuizText(
      quiz([{ n: 1 }, { n: 2, options: ['A) a', 'B) b', 'C) c'] }])
    );
    expect(broken.ok).toBe(false);
    expect(toTraineeQuiz(broken)).toBeNull();
  });

  it('gives no trainee view when a solution marker ends up in visible text', () => {
    const result = parseQuizText(quiz(three));
    result.value.questions[0].options[3].text = 'd Richtige Antwort: B';
    expect(result.ok).toBe(true);
    expect(toTraineeQuiz(result)).toBeNull();
    const leak = parseQuizText(quiz(three));
    leak.value.questions[1].text = 'Frage? Kurzbegründung: Darum';
    expect(toTraineeQuiz(leak)).toBeNull();
  });

  it('keeps a soft line break from gluing the solution to an option', () => {
    const lines: Paragraph[] = [
      ...enablerHead(),
      { text: '1. Frage?', bold: true },
      { text: 'A) a', bold: false },
      { text: 'B) b', bold: false },
      { text: 'C) c', bold: false },
      {
        text: 'D) d\nRichtige Antwort: B\nKurzbegründung: Weil X',
        bold: false,
      },
    ];
    const result = parseQuizText(lines);
    expect(result.ok).toBe(true);
    const q = result.value.questions[0];
    expect(q.options[3].text).toBe('d');
    expect(q.correctLetter).toBe('B');
    expect(q.rationale).toBe('Weil X');
    expect(JSON.stringify(toTraineeQuiz(result))).not.toContain('Weil X');
  });
});

describe('parseQuizText: hardening', () => {
  const codes = (qs: Q[], head?: Paragraph[]) =>
    parseQuizText(quiz(qs, head)).issues.map(i => i.code);

  it.each(['B) und C)', 'B + C', 'B C', 'B sowie D', 'A und nicht B'])(
    'reports several correct answers in "%s"',
    answer => {
      expect(codes([{ n: 1, answer }])).toContain('ANSWER_MULTIPLE');
    }
  );

  it('still reads a single answer with explaining text', () => {
    const r = parseQuizText(
      quiz([{ n: 1, answer: 'C) Die Hardware des Rechners' }])
    );
    expect(r.value.questions[0].correctLetter).toBe('C');
    expect(r.ok).toBe(true);
  });

  it('treats a wrapped line inside a question as an error', () => {
    const lines: Paragraph[] = [
      ...enablerHead(),
      { text: '1. Frage?', bold: true },
      { text: 'A) a', bold: false },
      { text: 'B) b', bold: false },
      { text: 'C) c', bold: false },
      { text: 'D) d', bold: false },
      { text: 'und hier geht die Option weiter', bold: false },
      { text: 'Richtige Antwort: B', bold: true },
      { text: 'Kurzbegründung: Darum.', bold: false },
    ];
    const r = parseQuizText(lines);
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toMatchObject({ code: 'UNPARSED_LINE', question: 1 });
  });

  it('does not take a headline that merely starts with a number for a heading', () => {
    for (const head of ['24Stunden Plan', '3D-Druck im Betrieb', '1B) Titel']) {
      const r = parseQuizText(
        quiz(three, [
          { text: head, bold: false },
          { text: 'Quiz, Schwierigkeitsgrad: leicht', bold: true },
        ])
      );
      expect(r.value.enablerCode).toBeNull();
      expect(r.issues.map(i => i.code)).toContain('HEADING_FORMAT');
    }
  });

  it('does not take a scenario heading for a quiz heading', () => {
    const r = parseQuizText(
      quiz(three, [
        { text: 'Szenario 1b: Titel', bold: false },
        { text: 'Quiz, Schwierigkeitsgrad: leicht', bold: true },
      ])
    );
    expect(r.issues.map(i => i.code)).toContain('HEADING_FORMAT');
  });

  it('does not take longer words for the labels', () => {
    const lines: Paragraph[] = [
      ...enablerHead(),
      { text: '1. Frage?', bold: true },
      { text: 'A) a', bold: false },
      { text: 'Richtige Antworten: B', bold: false },
      { text: 'Kurzbegründungen sind wichtig', bold: false },
    ];
    const r = parseQuizText(lines);
    const found = r.issues.map(i => i.code);
    expect(found).toContain('ANSWER_MISSING');
    expect(found).toContain('RATIONALE_MISSING');
  });

  it('reads decomposed umlauts and ignores zero width characters', () => {
    const lines = quiz(three).map(p => ({
      ...p,
      text: p.text
        .replace('Kurzbegründung', 'Kurzbegru\u0308ndung')
        .replace(/^Richtige/, '\u200bRichtige'),
    }));
    const r = parseQuizText(lines);
    expect(r.ok).toBe(true);
    expect(r.value.questions[0].rationale).toBe('Weil es so erfunden ist.');
  });

  it('expects 20 questions for a global quiz without being told', () => {
    const head: Paragraph[] = [
      { text: '06.1) Titel (§ 4 Abs. 2 Nr. 6)', bold: true },
      { text: 'Global Quiz', bold: true },
    ];
    const nineteen = Array.from({ length: 19 }, (_, i) => ({ n: i + 1 }));
    expect(codes(nineteen, head)).toContain('QUESTION_COUNT');
  });

  it('keeps a numbered line inside a question text as text', () => {
    const lines: Paragraph[] = [
      ...enablerHead(),
      { text: '1. Welche Aussage stimmt', bold: true },
      { text: '2. Quartal ist gemeint?', bold: false },
      { text: 'A) a', bold: false },
      { text: 'B) b', bold: false },
      { text: 'C) c', bold: false },
      { text: 'D) d', bold: false },
      { text: 'Richtige Antwort: B', bold: true },
      { text: 'Kurzbegründung: Darum.', bold: false },
    ];
    const r = parseQuizText(lines);
    expect(r.ok).toBe(true);
    expect(r.value.questions).toHaveLength(1);
    expect(r.value.questions[0].text).toBe(
      'Welche Aussage stimmt 2. Quartal ist gemeint?'
    );
  });

  it('accepts a difficulty with an added note in brackets', () => {
    expect(
      parseQuizText(quiz(three, enablerHead('1a', 'mittel (Anwendung)'))).value
        .difficulty
    ).toBe('medium');
  });

  it('does not throw on input that is not a string or list', () => {
    expect(parseQuizText(undefined as never).ok).toBe(false);
    expect(parseQuizText([undefined, null, { text: 5 }] as never).ok).toBe(
      false
    );
  });
});

describe('parseQuizText: variants found in the real sources', () => {
  it('reads a slash as the split of the heading, with a warning', () => {
    const r = parseQuizText(
      quiz(three, [
        { text: '25/1b) Aufgaben im Team planen', bold: false },
        { text: 'Quiz, Schwierigkeitsgrad: leicht', bold: true },
      ])
    );
    expect(r.value.enablerCode).toBe('25.1b');
    expect(r.issues.map(i => i.code)).toEqual(['HEADING_VARIANT']);
    expect(r.ok).toBe(true);
  });

  it('reads a global quiz whose paragraph reference stands on its own line', () => {
    const head: Paragraph[] = [
      { text: '04) Koordinations- und Organisationsaufgaben', bold: true },
      { text: '(§ 4 Abs. 2 Nr. 4)', bold: true },
      { text: 'Global Quiz', bold: true },
    ];
    const twenty = Array.from({ length: 20 }, (_, i) => ({ n: i + 1 }));
    const r = parseQuizText(quiz(twenty, head));
    expect(r.value.kind).toBe('global');
    expect(r.value.componentKey).toBe('04');
    expect(r.value.title).toBe(
      'Koordinations- und Organisationsaufgaben (§ 4 Abs. 2 Nr. 4)'
    );
    expect(r.issues.map(i => i.code)).toEqual(['HEADING_VARIANT']);
    expect(r.ok).toBe(true);
  });

  it('reports a file that starts with a question as heading missing', () => {
    const lines: Paragraph[] = [
      { text: '1. Warum ist das so', bold: true },
      { text: 'und weiter in der Frage?', bold: false },
      { text: 'A) a', bold: false },
      { text: 'B) b', bold: false },
      { text: 'C) c', bold: false },
      { text: 'D) d', bold: false },
      { text: 'Richtige Antwort: D', bold: true },
      { text: 'Kurzbegründung: Darum.', bold: false },
    ];
    const r = parseQuizText(lines);
    const found = r.issues.map(i => i.code);
    expect(found).toContain('HEADING_MISSING');
    expect(found).not.toContain('QUESTION_NUMBER_GAP');
    expect(r.value.questions).toHaveLength(1);
    expect(r.ok).toBe(false);
  });

  it('reports the label "Antwort:" without "Richtige" as a missing answer', () => {
    const lines: Paragraph[] = [
      ...enablerHead(),
      { text: '1. Frage?', bold: true },
      { text: 'A) a', bold: false },
      { text: 'B) b', bold: false },
      { text: 'C) c', bold: false },
      { text: 'D) d', bold: false },
      { text: 'Antwort: B', bold: true },
      { text: 'Kurzbegründung: Darum.', bold: false },
    ];
    const found = parseQuizText(lines).issues.map(i => i.code);
    expect(found).toContain('ANSWER_MISSING');
    expect(found).toContain('UNPARSED_LINE');
  });
});

describe('parseQuizText: question start', () => {
  it('reads a question number without a blank after the dot', () => {
    const lines: Paragraph[] = [
      ...enablerHead(),
      { text: '1.Frage ohne Leerzeichen?', bold: true },
      { text: 'A) a', bold: false },
      { text: 'B) b', bold: false },
      { text: 'C) c', bold: false },
      { text: 'D) d', bold: false },
      { text: 'Richtige Antwort: A', bold: true },
      { text: 'Kurzbegründung: Darum.', bold: false },
    ];
    const r = parseQuizText(lines);
    expect(r.ok).toBe(true);
    expect(r.value.questions[0].text).toBe('Frage ohne Leerzeichen?');
  });
});
