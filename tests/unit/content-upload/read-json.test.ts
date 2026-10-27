/**
 * @jest-environment node
 */
import {
  JSON_SHAPE_LIMITS,
  detectQuizJsonKind,
  hasUsableSet,
  isTooComplex,
  readQuizJson,
} from '@/lib/content-upload/read-json';

import {
  clone,
  jsonQuiz,
  lessonFile,
  sampleGlobal,
  sampleLesson,
  SAMPLE_SPECS,
} from '../content-import/quiz-json/fixtures';

const bytes = (value: unknown) =>
  new TextEncoder().encode(
    typeof value === 'string' ? value : JSON.stringify(value)
  );

const refusal = (input: Uint8Array, options = {}) => {
  const result = readQuizJson(input, options);
  if (result.status !== 'rejected') throw new Error('expected a refusal');
  return result;
};

describe('readQuizJson: valid files', () => {
  it('reads the enabler quizzes and says which kind they are from the head', () => {
    const result = readQuizJson(bytes(sampleLesson()));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.kind).toBe('lesson');
    expect(result.summary).toMatchObject({
      kind: 'lesson',
      quizzes: 5,
      sets: 15,
      questions: 150,
      setsWithErrors: 0,
      errors: 0,
      unmapped: 0,
    });
    expect(result.summary.components).toEqual([
      'K1',
      'K10',
      'K20',
      'K6.1',
      'K6.2',
    ]);
    expect(hasUsableSet(result.summary)).toBe(true);
  });

  it('reads the global quizzes', () => {
    const result = readQuizJson(bytes(sampleGlobal()));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.kind).toBe('global');
    expect(result.summary).toMatchObject({
      quizzes: 5,
      sets: 5,
      questions: 100,
    });
  });

  it('takes the kind from the content and never from a name (there is no name here)', () => {
    expect(detectQuizJsonKind(sampleLesson())).toBe('lesson');
    expect(detectQuizJsonKind(sampleGlobal())).toBe('global');
  });

  it('drops one byte order mark and reads umlauts', () => {
    const file = sampleLesson();
    file.quizzes[0].difficulties.leicht.questions[0].question =
      'Erfundene Frage mit Umlauten: ÄÖÜ äöü ß?';
    const body = new TextEncoder().encode(JSON.stringify(file));
    const withBom = new Uint8Array(body.length + 3);
    withBom.set([0xef, 0xbb, 0xbf], 0);
    withBom.set(body, 3);
    expect(readQuizJson(withBom).status).toBe('ok');
  });

  it('keeps the questions and answers out of the summary (numbers and codes only)', () => {
    const file = sampleLesson();
    const result = readQuizJson(bytes(file));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    const text = JSON.stringify(result.summary);
    expect(text).not.toMatch(/Erfundene Frage/);
    expect(text).not.toMatch(/Begründung/);
    expect(text).not.toMatch(/Antwort/);
  });

  it('counts the sets with errors and keeps the file readable', () => {
    const file = sampleLesson();
    file.quizzes[1].difficulties.leicht.questions[0].correct_answer = 'Z';
    const result = readQuizJson(bytes(file));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.summary.setsWithErrors).toBe(1);
    expect(result.summary.errors).toBeGreaterThan(0);
    expect(result.summary.findingCodes).toContain('ANSWER_INVALID');
    expect(hasUsableSet(result.summary)).toBe(true);
  });

  it('passes the expected number of questions of a global quiz on', () => {
    const result = readQuizJson(bytes(sampleGlobal()), {
      expectedGlobalQuestions: 25,
    });
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.summary.findingCodes).toContain('QUESTION_COUNT');
    expect(result.summary.setsWithErrors).toBe(5);
    expect(hasUsableSet(result.summary)).toBe(false);
  });
});

describe('readQuizJson: wrong and hostile files', () => {
  it('refuses a file above the size limit before it looks at the content', () => {
    expect(refusal(bytes(sampleLesson()), { maxBytes: 100 }).code).toBe(
      'TOO_LARGE'
    );
    const big = new Uint8Array(32 * 1024 * 1024 + 1).fill(0x20);
    expect(refusal(big).code).toBe('TOO_LARGE');
  });

  it('refuses bytes that are no UTF-8, without repairing them', () => {
    const body = Array.from(bytes(sampleLesson()));
    body.splice(40, 0, 0xc3, 0x28); // an invalid sequence
    expect(refusal(Uint8Array.from(body)).code).toBe('NOT_UTF8');
    expect(refusal(Uint8Array.from([0xff, 0xfe, 0x7b, 0x00])).code).toBe(
      'NOT_UTF8'
    );
  });

  it.each([
    ['empty', ''],
    ['text', 'kein json'],
    ['unfinished', '{"schema_version": "1.0", "quizzes": ['],
    ['trailing comma', '{"schema_version": "1.0",}'],
    ['single quotes', "{'schema_version': '1.0'}"],
    ['comment', '{"schema_version": "1.0"} // x'],
  ])('refuses invalid JSON (%s)', (_name, text) => {
    expect(refusal(bytes(text)).code).toBe('NOT_JSON');
  });

  it.each([
    ['array', '[]'],
    ['number', '42'],
    ['string', '"x"'],
    ['null', 'null'],
    ['boolean', 'true'],
  ])('refuses JSON that is no object (%s)', (_name, text) => {
    expect(refusal(bytes(text)).code).toBe('NOT_AN_OBJECT');
  });

  it('refuses an object that is no quiz file and another schema version', () => {
    expect(refusal(bytes({ hello: 'world' })).code).toBe('NOT_QUIZ_JSON');
    expect(refusal(bytes({ schema_version: '1.0' })).code).toBe(
      'NOT_QUIZ_JSON'
    );
    expect(
      refusal(bytes({ ...sampleLesson(), schema_version: '2.0' })).code
    ).toBe('SCHEMA_VERSION');
    expect(refusal(bytes({ ...sampleLesson(), schema_version: 1 })).code).toBe(
      'SCHEMA_VERSION'
    );
  });

  it('refuses a head that says nothing about its kind or says both', () => {
    expect(
      refusal(bytes({ schema_version: '1.0', quiz_count: 0, quizzes: [] })).code
    ).toBe('KIND_UNKNOWN');
    const both = clone(sampleLesson());
    both.quizzes[0].questions = [];
    expect(refusal(bytes(both)).code).toBe('KIND_UNKNOWN');
    expect(
      refusal(
        bytes({ schema_version: '1.0', quiz_count: 1, quizzes: [{ id: 'x' }] })
      ).code
    ).toBe('KIND_UNKNOWN');
  });

  it('refuses a file whose head or structure the strict reader cannot trust', () => {
    const wrongCount = { ...sampleLesson(), quiz_count: 99 };
    const r = refusal(bytes(wrongCount));
    expect(r.code).toBe('SCHEMA_REFUSED');
    expect(r.findingCodes).toContain('QUIZ_COUNT');
    const extra = { ...sampleLesson(), exploit: true };
    expect(refusal(bytes(extra)).findingCodes).toContain('UNKNOWN_FIELD');
    const levels = { ...sampleLesson(), difficulty_levels: ['a', 'b', 'c'] };
    expect(refusal(bytes(levels)).findingCodes).toContain('LEVELS_HEADER');
  });

  it('refuses a list of no quiz at all', () => {
    const empty = { ...lessonFile([]) };
    expect(refusal(bytes(empty)).code).toBe('NO_QUIZ');
  });

  it('refuses a deep nesting before it parses anything, in a blink and without a gigabyte', () => {
    const deep = '['.repeat(200_000) + ']'.repeat(200_000);
    const nestedObjects = `{"a":`.repeat(100_000) + '1' + '}'.repeat(100_000);
    const empties = `{"schema_version":"1.0","quizzes":[],"x":[${'{},'.repeat(1_100_000)}{}]}`;
    const started = Date.now();
    const before = process.memoryUsage().rss;
    expect(refusal(bytes(deep)).code).toBe('TOO_COMPLEX');
    expect(refusal(bytes(nestedObjects)).code).toBe('TOO_COMPLEX');
    expect(refusal(bytes(empties)).code).toBe('TOO_COMPLEX');
    expect(Date.now() - started).toBeLessThan(3000);
    expect(process.memoryUsage().rss - before).toBeLessThan(300 * 1024 * 1024);
  });

  it('reads the shape by bytes: a string with brackets, quotes and escapes counts for nothing', () => {
    const limit = JSON_SHAPE_LIMITS.maxDepth;
    const nest = (depth: number) => '['.repeat(depth) + ']'.repeat(depth);
    expect(isTooComplex(bytes(nest(limit)))).toBe(false);
    expect(isTooComplex(bytes(nest(limit + 1)))).toBe(true);
    expect(isTooComplex(bytes(`{"a":"${'[{'.repeat(500)}"}`))).toBe(false);
    // an escaped backslash ends no string, an escaped quote does not either
    expect(isTooComplex(bytes(`{"a":"x\\\\","b":"${'['.repeat(500)}"}`))).toBe(
      false
    );
    expect(isTooComplex(bytes(`{"a":"\\"${'['.repeat(500)}"}`))).toBe(false);
    expect(isTooComplex(bytes(`{"a":"x\\\\"${'['.repeat(20)}`))).toBe(true);
    // multi byte characters hold no byte of a bracket or a quote
    expect(isTooComplex(bytes(`{"a":"${'ÄÖÜß€😀'.repeat(1000)}"}`))).toBe(
      false
    );
    // unbalanced brackets are the business of the parser
    expect(isTooComplex(bytes(']]]]}}}}'))).toBe(false);
    expect(refusal(bytes(']]]]}}}}')).code).toBe('NOT_JSON');
    // a real file is far below the limits
    expect(isTooComplex(bytes(sampleLesson()))).toBe(false);
  });

  it('reads a file with a very long text as a file with an error in one set, not as a refusal', () => {
    const file = clone(sampleLesson());
    file.quizzes[0].difficulties.leicht.questions[0].explanation = 'a'.repeat(
      3_000_000
    );
    const result = readQuizJson(bytes(file));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.summary.setsWithErrors).toBe(1);
    expect(result.summary.errorCodes).toContain('RATIONALE_TOO_LONG');
  });

  it('puts the codes of errors in front: a hint never takes their place', () => {
    const file = clone(sampleLesson());
    file.quizzes[0].difficulties.leicht.questions[0].correct_answer = 'Z';
    const result = readQuizJson(bytes(file));
    expect(result.status).toBe('ok');
    if (result.status !== 'ok') return;
    expect(result.summary.errorCodes).toEqual(['ANSWER_INVALID']);
    expect(result.summary.findingCodes).toContain('ANSWER_INVALID');
  });

  it('does not let a name like __proto__ or constructor reach a prototype', () => {
    const polluted = sampleLesson();
    const text = JSON.stringify(polluted).replace(
      '"quiz_count"',
      '"__proto__":{"isAdmin":true},"constructor":{"x":1},"quiz_count"'
    );
    const result = readQuizJson(bytes(text));
    expect(result.status).toBe('rejected');
    expect(({} as Record<string, unknown>).isAdmin).toBeUndefined();
    expect(Object.prototype).not.toHaveProperty('isAdmin');
    if (result.status === 'rejected') {
      expect(result.findingCodes).toContain('UNKNOWN_FIELD');
    }
  });

  it('never throws, whatever the bytes are', () => {
    for (let seed = 1; seed <= 200; seed += 1) {
      const length = (seed * 37) % 400;
      const data = new Uint8Array(length);
      let x = seed;
      for (let i = 0; i < length; i += 1) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        data[i] = x & 0xff;
      }
      expect(() => readQuizJson(data)).not.toThrow();
    }
    expect(() => readQuizJson(new ArrayBuffer(0))).not.toThrow();
  });

  it('does not run anything that the content asks for (a script text stays text)', () => {
    const file = sampleLesson();
    file.quizzes[0].difficulties.leicht.questions[0].question =
      '<script>globalThis.__pwned = 1</script> ${process.exit(1)} {{7*7}}';
    const result = readQuizJson(bytes(file));
    expect(result.status).toBe('ok');
    expect((globalThis as Record<string, unknown>).__pwned).toBeUndefined();
  });

  it('keeps the specs of the sample as they are (guards the fixtures of these tests)', () => {
    expect(SAMPLE_SPECS).toHaveLength(5);
    expect(jsonQuiz(SAMPLE_SPECS[0]).id).toBe('1a');
  });
});
