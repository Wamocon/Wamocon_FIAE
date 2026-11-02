/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  buildAnswerBody,
  isAskable,
  gradeAnswer,
  matchSpokenChoice,
  matchesTopic,
  selectCandidates,
  selectionBelongsTo,
  shuffleOptions,
  shuffled,
  speechTextOf,
  toPublicQuestion,
  topicWords,
  type QuizCandidate,
  type QuizQuestionSource,
} from '@/lib/hai/quizMode/logic';

// Behavior under test: src/lib/hai/quizMode/logic.ts. The quiz mode asks the
// questions of the lesson quizzes without grading. What matters most: the
// question for the browser (toPublicQuestion) carries no solution and no
// explanation, whatever the source holds, and an attempt is graded exactly.

const opt = (
  id: string,
  text: string,
  isCorrect: boolean,
  extra: Partial<QuizQuestionSource['options'][number]> = {}
) => ({
  id,
  text,
  isCorrect,
  explanation: null,
  orderIndex: null,
  ...extra,
});

const question = (
  overrides: Partial<QuizQuestionSource> = {}
): QuizQuestionSource => ({
  id: 'q1',
  text: 'Was ist ein Primärschlüssel?',
  enablerId: 'e1',
  enablerTitle: 'SQL Grundlagen',
  courseTitle: 'Datenbanken',
  enablerHref: '/trainee/enablers/e1',
  options: [
    opt('a', 'Ein eindeutiger Bezeichner', true, {
      explanation: 'Er identifiziert eine Zeile eindeutig.',
      orderIndex: 0,
    }),
    opt('b', 'Ein Index über alle Spalten', false, { orderIndex: 1 }),
    opt('c', 'Ein Fremdschlüssel', false, { orderIndex: 2 }),
    opt('d', 'Eine Sicherungskopie', false, { orderIndex: 3 }),
  ],
  ...overrides,
});

/** A random source that returns the given values in turn. */
const rngOf = (...values: number[]) => {
  let i = 0;
  return () => values[i++ % values.length];
};

describe('toPublicQuestion: nothing of the solution leaves with the question', () => {
  it('has exactly the public fields, no solution field anywhere', () => {
    const publicQuestion = toPublicQuestion(question(), rngOf(0.1, 0.9, 0.5));
    expect(Object.keys(publicQuestion).sort()).toEqual([
      'courseTitle',
      'enablerHref',
      'enablerId',
      'enablerTitle',
      'id',
      'multiple',
      'options',
      'text',
    ]);
    for (const option of publicQuestion.options) {
      expect(Object.keys(option).sort()).toEqual(['id', 'text']);
    }
  });

  it('does not contain the explanation or the word is_correct in the serialized form', () => {
    const json = JSON.stringify(toPublicQuestion(question()));
    expect(json).not.toContain('Er identifiziert eine Zeile eindeutig.');
    expect(json).not.toMatch(/isCorrect|is_correct|correct|explanation/i);
  });

  it('keeps all options and loses none', () => {
    const ids = toPublicQuestion(question())
      .options.map(o => o.id)
      .sort();
    expect(ids).toEqual(['a', 'b', 'c', 'd']);
  });

  it('marks a question with more than one right option as multiple', () => {
    const multi = question({
      options: [
        opt('a', 'Eins', true),
        opt('b', 'Zwei', true),
        opt('c', 'Drei', false),
      ],
    });
    expect(toPublicQuestion(multi).multiple).toBe(true);
    expect(toPublicQuestion(question()).multiple).toBe(false);
  });
});

describe('shuffleOptions', () => {
  it('does not change the source', () => {
    const source = question().options;
    const before = JSON.stringify(source);
    shuffleOptions(source, rngOf(0.2, 0.7));
    expect(JSON.stringify(source)).toBe(before);
  });

  it('produces different orders for different random values', () => {
    const source = question().options;
    const first = shuffleOptions(source, rngOf(0.0, 0.0, 0.0)).map(o => o.id);
    const second = shuffleOptions(source, rngOf(0.99, 0.99, 0.99)).map(
      o => o.id
    );
    expect(first).not.toEqual(second);
  });

  it('keeps "Alle genannten" and "Keine der oben genannten" at the end in the author order', () => {
    const source = [
      opt('a', 'Erste', true, { orderIndex: 0 }),
      opt('b', 'Zweite', false, { orderIndex: 1 }),
      opt('c', 'Alle oben genannten Antworten', false, { orderIndex: 2 }),
      opt('d', 'Dritte', false, { orderIndex: 3 }),
      opt('e', 'Keine der oben genannten', false, { orderIndex: 4 }),
    ];
    for (const r of [0, 0.3, 0.6, 0.99]) {
      const ids = shuffleOptions(source, rngOf(r)).map(o => o.id);
      expect(ids.slice(-2)).toEqual(['c', 'e']);
      expect(ids.slice(0, 3).sort()).toEqual(['a', 'b', 'd']);
    }
  });

  it('starts from the order of the author when rows have no stored position', () => {
    const rows = [
      { id: 'x', text: 'X', orderIndex: 2 },
      { id: 'y', text: 'Y', orderIndex: 0 },
      { id: 'z', text: 'Z', orderIndex: null },
    ];
    // rng that never swaps (always the last index): the order is the sorted one
    const ids = shuffleOptions(rows, () => 0.9999).map(o => o.id);
    expect(ids).toEqual(['y', 'x', 'z']);
  });
});

describe('shuffled', () => {
  it('returns a permutation and leaves the input alone', () => {
    const input = [1, 2, 3, 4, 5];
    const out = shuffled(input, rngOf(0.1, 0.4, 0.8));
    expect(out.slice().sort()).toEqual(input);
    expect(input).toEqual([1, 2, 3, 4, 5]);
  });
});

describe('isAskable', () => {
  it('accepts a normal choice question', () => {
    expect(isAskable(question())).toBe(true);
  });

  it.each([
    ['no right option', [opt('a', 'A', false), opt('b', 'B', false)]],
    ['every option right', [opt('a', 'A', true), opt('b', 'B', true)]],
    ['one option only', [opt('a', 'A', true)]],
    ['a blank option', [opt('a', 'A', true), opt('b', '  ', false)]],
  ])('rejects a question with %s', (_name, options) => {
    expect(isAskable(question({ options }))).toBe(false);
  });

  it('rejects a blank question text', () => {
    expect(isAskable(question({ text: '   ' }))).toBe(false);
  });
});

describe('gradeAnswer', () => {
  it('is right for the one right option and gives the explanation', () => {
    const verdict = gradeAnswer(question(), ['a']);
    expect(verdict.correct).toBe(true);
    expect(verdict.correctOptionIds).toEqual(['a']);
    expect(verdict.explanation).toBe('Er identifiziert eine Zeile eindeutig.');
  });

  it('is wrong for another option and still names the right one', () => {
    const verdict = gradeAnswer(question(), ['b']);
    expect(verdict.correct).toBe(false);
    expect(verdict.correctOptionIds).toEqual(['a']);
  });

  it('is wrong for the right option plus a wrong one', () => {
    expect(gradeAnswer(question(), ['a', 'b']).correct).toBe(false);
  });

  const multi = question({
    options: [
      opt('a', 'Eins', true, { explanation: 'Erstens.' }),
      opt('b', 'Zwei', true, { explanation: 'Erstens.' }),
      opt('c', 'Drei', false),
      opt('d', 'Vier', false),
    ],
  });

  it('is right for a multiple question only with exactly all right options', () => {
    expect(gradeAnswer(multi, ['a', 'b']).correct).toBe(true);
    expect(gradeAnswer(multi, ['b', 'a']).correct).toBe(true);
  });

  it.each([
    ['only one of the right options', ['a']],
    ['all right and a wrong one', ['a', 'b', 'c']],
    ['only wrong ones', ['c', 'd']],
  ])('is wrong for a multiple question with %s', (_name, picked) => {
    expect(gradeAnswer(multi, picked).correct).toBe(false);
  });

  it('joins distinct explanations once and gives null when there is none', () => {
    expect(gradeAnswer(multi, ['a']).explanation).toBe('Erstens.');
    const none = question({
      options: [opt('a', 'A', true), opt('b', 'B', false)],
    });
    expect(gradeAnswer(none, ['a']).explanation).toBeNull();
    const two = question({
      options: [
        opt('a', 'A', true, { explanation: 'Eins.' }),
        opt('b', 'B', true, { explanation: 'Zwei.' }),
        opt('c', 'C', false, { explanation: 'Falsch erklärt.' }),
      ],
    });
    // the explanation of a wrong option is never used
    expect(gradeAnswer(two, ['a', 'b']).explanation).toBe('Eins.\n\nZwei.');
  });
});

describe('selectionBelongsTo', () => {
  it('accepts own options and rejects a foreign id', () => {
    expect(selectionBelongsTo(question(), ['a', 'c'])).toBe(true);
    expect(selectionBelongsTo(question(), ['a', 'zzz'])).toBe(false);
  });
});

describe('topic filter', () => {
  it('finds a stem: "Primärschlüsseln" finds "Primärschlüssel"', () => {
    expect(
      matchesTopic('Primärschlüsseln', 'Was ist ein Primärschlüssel?')
    ).toBe(true);
  });

  it('is case and umlaut insensitive, and needs every word', () => {
    expect(matchesTopic('sql', 'SQL Grundlagen')).toBe(true);
    expect(matchesTopic('primaerschluessel', 'Primärschlüssel')).toBe(true);
    expect(matchesTopic('SQL Joins', 'SQL Grundlagen')).toBe(false);
    expect(matchesTopic('SQL Grundlagen', 'Grundlagen von SQL')).toBe(true);
  });

  it('matches everything without a topic', () => {
    expect(matchesTopic(null, 'irgendwas')).toBe(true);
    expect(matchesTopic('  ', 'irgendwas')).toBe(true);
    expect(topicWords('zu')).toEqual([]);
  });

  it('keeps short technical words like C#', () => {
    expect(matchesTopic('C#', 'Einführung in C# Klassen')).toBe(true);
  });
});

describe('selectCandidates', () => {
  const pool: QuizCandidate[] = [
    ['q1', 'SQL Grundlagen', 'Was ist SELECT?'],
    ['q2', 'SQL Grundlagen', 'Was ist ein JOIN?'],
    ['q3', 'Netzwerke', 'Was ist ein Router?'],
  ].map(([id, enablerTitle, text]) => ({
    id,
    text,
    enablerId: `e-${id}`,
    enablerTitle,
    courseTitle: null,
    enablerHref: null,
  }));

  it('takes the history out and counts', () => {
    const sel = selectCandidates(pool, { exclude: ['q1'] });
    expect(sel.remaining.map(c => c.id)).toEqual(['q2', 'q3']);
    expect(sel.total).toBe(3);
    expect(sel.asked).toBe(1);
  });

  it('narrows by topic and counts only the topic', () => {
    const sel = selectCandidates(pool, { topic: 'SQL', exclude: ['q1', 'q2'] });
    expect(sel.remaining).toEqual([]);
    expect(sel.total).toBe(2);
    expect(sel.asked).toBe(2);
  });

  it('has no candidate and no total for an unknown topic', () => {
    const sel = selectCandidates(pool, { topic: 'Kochen' });
    expect(sel.total).toBe(0);
    expect(sel.remaining).toEqual([]);
  });

  it('ignores ids in the history that are not in the pool', () => {
    const sel = selectCandidates(pool, { exclude: ['other'] });
    expect(sel.remaining).toHaveLength(3);
    expect(sel.asked).toBe(0);
  });
});

describe('voice interface', () => {
  const publicQuestion = toPublicQuestion(question(), () => 0.9999);

  it('builds the text to read from the public question, with letters and without a solution', () => {
    const text = speechTextOf(publicQuestion);
    expect(text).toContain('Was ist ein Primärschlüssel?');
    expect(text).toContain('A: Ein eindeutiger Bezeichner');
    expect(text).toContain('D: Eine Sicherungskopie');
    expect(text).not.toMatch(/richtig ist|korrekt|Lösung|Er identifiziert/i);
  });

  it('says so when several answers are right', () => {
    const multi = toPublicQuestion(
      question({
        options: [
          opt('a', 'Eins', true),
          opt('b', 'Zwei', true),
          opt('c', 'Drei', false),
        ],
      })
    );
    expect(speechTextOf(multi)).toContain('Mehrere Antworten sind richtig.');
  });

  it.each([
    ['A', 4, 0],
    ['b', 4, 1],
    ['Antwort B', 4, 1],
    ['Option c', 4, 2],
    ['die zweite', 4, 1],
    ['Die dritte.', 4, 2],
    ['ich nehme D', 4, 3],
    ['3', 4, 2],
    ['erste', 4, 0],
    ['fünfte', 6, 4],
  ])('understands "%s" as a choice', (said, count, index) => {
    expect(matchSpokenChoice(said, count as number)).toBe(index);
  });

  it.each([
    ['', 4],
    ['E', 4],
    ['die fünfte', 4],
    ['Was ist ein Primärschlüssel eigentlich genau', 4],
    ['vielleicht', 4],
    ['9', 4],
  ])('does not take "%s" for a choice', (said, count) => {
    expect(matchSpokenChoice(said, count as number)).toBeNull();
  });
});

describe('buildAnswerBody: the solution only when it is released', () => {
  const multi = () =>
    question({
      options: [
        opt('a', 'Erster Teil', true, { explanation: 'Beide gehören dazu.' }),
        opt('b', 'Zweiter Teil', true),
        opt('c', 'Falsch', false),
      ],
    });

  // Every key a withheld answer may have. A new solution field in the body
  // makes this test red, which is the point.
  const WITHHELD_KEYS = [
    'correct',
    'correctCount',
    'enablerId',
    'multiple',
    'selectedOptionIds',
    'solutionWithheld',
  ];

  it('withheld: has exactly the allowed keys, no right option and no explanation', () => {
    const body = buildAnswerBody(question(), ['b'], false);
    expect(Object.keys(body).sort()).toEqual(WITHHELD_KEYS);
    expect(body).toEqual({
      solutionWithheld: true,
      correct: false,
      selectedOptionIds: ['b'],
      multiple: false,
      correctCount: null,
      enablerId: 'e1',
    });
  });

  it('withheld: nothing of the solution is anywhere in the body, whatever the source holds', () => {
    const json = JSON.stringify(buildAnswerBody(question(), ['b'], false));
    expect(json).not.toMatch(
      /isCorrect|is_correct|correctOption|explanation|"solution"|"key"/i
    );
    expect(json).not.toContain('Er identifiziert eine Zeile eindeutig.');
    // the right option 'a' was not selected, so its id is not in the body
    expect(json).not.toContain('"a"');
    expect(json).not.toContain('Ein eindeutiger Bezeichner');
  });

  it('withheld: says right for the right option, and still no solution field', () => {
    const body = buildAnswerBody(question(), ['a'], false);
    expect(body.correct).toBe(true);
    expect(Object.keys(body).sort()).toEqual(WITHHELD_KEYS);
  });

  it('withheld: names the number of right options of a multiple choice question only', () => {
    const body = buildAnswerBody(multi(), ['a'], false);
    expect(body).toMatchObject({
      solutionWithheld: true,
      correct: false,
      multiple: true,
      correctCount: 2,
    });
    expect(Object.keys(body).sort()).toEqual(WITHHELD_KEYS);
    expect(JSON.stringify(body)).not.toContain('Beide gehören dazu.');
    expect(buildAnswerBody(question(), ['a'], false)).toMatchObject({
      multiple: false,
      correctCount: null,
    });
  });

  it('withheld: grades a multiple choice question exactly like the released one', () => {
    for (const selected of [['a'], ['a', 'b'], ['b', 'c'], ['c']]) {
      expect(buildAnswerBody(multi(), selected, false).correct).toBe(
        buildAnswerBody(multi(), selected, true).correct
      );
    }
    expect(buildAnswerBody(multi(), ['b', 'a'], false).correct).toBe(true);
  });

  it('released: carries the right options and the explanation', () => {
    expect(buildAnswerBody(question(), ['b'], true)).toEqual({
      solutionWithheld: false,
      correct: false,
      selectedOptionIds: ['b'],
      correctOptionIds: ['a'],
      explanation: 'Er identifiziert eine Zeile eindeutig.',
      multiple: false,
      enablerId: 'e1',
    });
    const several = buildAnswerBody(multi(), ['a', 'b'], true);
    expect(several).toMatchObject({
      correct: true,
      correctOptionIds: ['a', 'b'],
      multiple: true,
    });
  });

  it('does not change the source', () => {
    const source = question();
    const before = JSON.stringify(source);
    buildAnswerBody(source, ['b'], false);
    buildAnswerBody(source, ['b'], true);
    expect(JSON.stringify(source)).toBe(before);
  });
});
