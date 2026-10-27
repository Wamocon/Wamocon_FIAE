import { buildImportPlan } from '@/lib/content-import/apply/plan';
import {
  readGlobalQuizzes,
  readLessonQuizzes,
} from '@/lib/content-import/quiz-json/read';
import type { QuizJsonRead } from '@/lib/content-import/quiz-json/types';

import { DIR, loadDecisions } from '../apply/fixtures';
import {
  SECTION,
  clone,
  globalFile,
  jsonGlobalQuiz,
  jsonQuiz,
  lessonFile,
  sampleGlobal,
  sampleLesson,
} from './fixtures';

const NOW = new Date('2026-10-26T12:00:00Z');
const decisions = loadDecisions();

const codes = (read: QuizJsonRead, severity?: 'error' | 'warning') =>
  read.findings
    .filter(f => !severity || f.severity === severity)
    .map(f => f.code);

/** Reads the sample after a change of one quiz (the first), returns the first set's findings. */
function lessonWith(change: (quiz: any) => void, index = 0) {
  const file = sampleLesson();
  change(file.quizzes[index]);
  return readLessonQuizzes(file);
}

const firstSet = (quiz: any, level = 'leicht') => quiz.difficulties[level];
const firstQuestion = (quiz: any) => firstSet(quiz).questions[0];

describe('readLessonQuizzes: a valid file', () => {
  const read = readLessonQuizzes(sampleLesson());

  it('has no finding and no unmapped quiz', () => {
    expect(read.fatal).toBe(false);
    expect(read.findings).toEqual([]);
    expect(read.unmapped).toEqual([]);
    expect(read.quizzes).toBe(5);
  });

  it('gives one file per level and one enabler per quiz, with the keys of the Word path', () => {
    expect(read.files).toHaveLength(5 * 4);
    const keys = read.files.map(f => f.info.key);
    for (const key of [
      'quiz:1a:low',
      'quiz:6.1a:medium',
      'quiz:6.2d:high',
      'quiz:10a:low',
      'quiz:20a:high',
      'enabler:6.2d',
      'enabler:20a',
    ]) {
      expect(keys).toContain(key);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('counts the sets with their questions', () => {
    expect(read.sets).toHaveLength(15);
    expect(read.sets.every(s => s.questions === 10 && s.errors === 0)).toBe(
      true
    );
    expect(read.sets.find(s => s.id === '6d')).toMatchObject({
      componentCode: 'K6.2',
      level: 'low',
      key: 'quiz:6.2d:low',
    });
  });

  it('maps the ids of a split component (24_1a) like the folder of the Word tree', () => {
    const quiz = jsonQuiz({
      id: '24_1a',
      componentId: '24.1',
      dir: `${SECTION.t1}/24.1 - Erfundene Organisation (§ 4 Abs. 4 Nr. 5)`,
      title: '24a) Erfundene Organisation planen',
    });
    const result = readLessonQuizzes(lessonFile([quiz]));
    expect(result.findings).toEqual([]);
    expect(result.files.map(f => f.info.key)).toContain('quiz:24.1a:low');
    expect(result.files.map(f => f.info.enablerCode)).toContain('K24.1-a');
  });

  it('turns every level into a planner file that the planner treats like a Word file', () => {
    const plan = buildImportPlan(read.files, decisions, { now: NOW });
    expect(plan.skipped).toEqual([]);
    expect(plan.quizzes.map(q => q.code)).toContain('K6.2-d-high');
    expect(plan.enablers.map(e => e.code)).toEqual([
      'K1-a',
      'K6.1-a',
      'K6.2-d',
      'K10-a',
      'K20-a',
    ]);
  });
});

describe('readLessonQuizzes: the head of the file', () => {
  const fatal = (raw: unknown, options = {}) => {
    const read = readLessonQuizzes(raw, options);
    expect(read.fatal).toBe(true);
    expect(read.files).toEqual([]);
    return codes(read);
  };

  it('refuses what is no object, no list or another schema version', () => {
    expect(fatal(null)).toEqual(['NOT_OBJECT']);
    expect(fatal([])).toEqual(['NOT_OBJECT']);
    expect(fatal('{}')).toEqual(['NOT_OBJECT']);
    expect(fatal({ ...sampleLesson(), schema_version: '2.0' })).toContain(
      'SCHEMA_VERSION'
    );
    expect(fatal({ ...sampleLesson(), quizzes: {} })).toContain(
      'QUIZZES_MISSING'
    );
  });

  it('names unknown fields of the head and does not read the file', () => {
    expect(fatal({ ...sampleLesson(), generated_by: 'x' })).toEqual([
      'UNKNOWN_FIELD',
    ]);
  });

  it('refuses a head that does not fit the list (a cut file)', () => {
    expect(fatal({ ...sampleLesson(), quiz_count: 6 })).toEqual(['QUIZ_COUNT']);
    expect(
      fatal({ ...sampleLesson(), difficulty_levels: ['leicht', 'mittel'] })
    ).toEqual(['LEVELS_HEADER']);
    expect(
      fatal({
        ...sampleLesson(),
        difficulty_levels: ['mittel', 'leicht', 'schwer'],
      })
    ).toEqual(['LEVELS_HEADER']);
  });

  it('refuses a file over the limits', () => {
    expect(fatal(sampleLesson(), { limits: { maxQuizzes: 4 } })).toEqual([
      'TOO_MANY_QUIZZES',
    ]);
    expect(
      fatal(sampleLesson(), { limits: { maxTotalQuestions: 100 } })
    ).toEqual(['TOO_MANY_QUESTIONS']);
  });

  it('does not read an unknown field named like a prototype member as a real field', () => {
    const raw = JSON.parse(
      JSON.stringify(sampleLesson()).replace(
        '"schema_version"',
        '"__proto__":{"polluted":true},"schema_version"'
      )
    );
    expect(({} as any).polluted).toBeUndefined();
    expect(fatal(raw)).toEqual(['UNKNOWN_FIELD']);
  });
});

describe('readLessonQuizzes: unknown fields are reported, not ignored', () => {
  it.each([
    ['quiz', (q: any) => (q.extra = 1)],
    ['curriculum_component', (q: any) => (q.curriculum_component.extra = 1)],
    ['source_files', (q: any) => (q.source_files.Extra = 'x')],
    ['difficulty set', (q: any) => (firstSet(q).extra = 1)],
    ['question', (q: any) => (firstQuestion(q).extra = 1)],
    ['option', (q: any) => (firstQuestion(q).options[0].extra = 1)],
  ])('in the %s', (_where, change) => {
    const read = lessonWith(change);
    const finding = read.findings.find(f => f.code === 'UNKNOWN_FIELD');
    expect(finding).toBeDefined();
    expect(finding?.id).toBe('1a');
    expect(finding?.message).toMatch(/extra/i);
  });

  it('an unknown field of a set skips that level only', () => {
    const read = lessonWith(q => (firstSet(q).extra = 1));
    const plan = buildImportPlan(read.files, decisions, { now: NOW });
    expect(plan.skipped.map(s => [s.key, s.code])).toEqual([
      ['quiz:1a:low', 'PARSE_ERROR'],
    ]);
    expect(plan.quizzes.map(q => q.code)).toContain('K1-a-medium');
    expect(plan.quizzes.map(q => q.code)).not.toContain('K1-a-low');
  });

  it('an unknown level is reported for the quiz', () => {
    const read = lessonWith(q => (q.difficulties.extrem = firstSet(q)));
    expect(codes(read, 'error')).toContain('UNKNOWN_LEVEL');
  });

  it('keeps an odd field name out of the message', () => {
    const read = lessonWith(q => (q['<script>alert(1)</script>'] = 1));
    const finding = read.findings.find(f => f.code === 'UNKNOWN_FIELD');
    expect(finding?.message).toContain('(unusual name)');
    expect(finding?.message).not.toContain('script');
  });
});

describe('readLessonQuizzes: questions and options', () => {
  const only = (read: QuizJsonRead) => {
    const errors = read.findings.filter(f => f.severity === 'error');
    return errors.map(f => [f.code, f.id, f.level, f.question]);
  };

  it('an answer that is none of the options', () => {
    for (const answer of ['E', 'b', 'AB', 1, null]) {
      const read = lessonWith(q => (firstQuestion(q).correct_answer = answer));
      expect(only(read)).toEqual([['ANSWER_INVALID', '1a', 'low', 1]]);
    }
    const missing = lessonWith(q => delete firstQuestion(q).correct_answer);
    expect(only(missing)).toEqual([['ANSWER_MISSING', '1a', 'low', 1]]);
  });

  it('three or five options', () => {
    const three = lessonWith(q => firstQuestion(q).options.pop());
    expect(only(three)).toEqual([['OPTION_COUNT', '1a', 'low', 1]]);
    const five = lessonWith(q =>
      firstQuestion(q).options.push({ key: 'E', text: 'fünfte Antwort' })
    );
    expect(only(five)).toEqual([['OPTION_COUNT', '1a', 'low', 1]]);
    const none = lessonWith(q => delete firstQuestion(q).options);
    expect(only(none)).toContainEqual(['OPTION_COUNT', '1a', 'low', 1]);
  });

  it('option keys in another order or twice', () => {
    const swapped = lessonWith(q => {
      const o = firstQuestion(q).options;
      [o[0].key, o[1].key] = [o[1].key, o[0].key];
    });
    expect(codes(swapped, 'error')).toEqual(['OPTION_ORDER']);
    const twice = lessonWith(q => (firstQuestion(q).options[1].key = 'A'));
    expect(codes(twice, 'error')).toContain('OPTION_ORDER');
  });

  it('an empty option, an empty question and an empty explanation', () => {
    expect(
      codes(
        lessonWith(q => (firstQuestion(q).options[2].text = '   ')),
        'error'
      )
    ).toEqual(['OPTION_EMPTY']);
    expect(
      codes(
        lessonWith(q => (firstQuestion(q).question = '')),
        'error'
      )
    ).toEqual(['TEXT_EMPTY']);
    expect(
      codes(
        lessonWith(q => (firstQuestion(q).explanation = ' ')),
        'error'
      )
    ).toEqual(['RATIONALE_MISSING']);
    expect(
      codes(
        lessonWith(q => delete firstQuestion(q).explanation),
        'error'
      )
    ).toEqual(['RATIONALE_MISSING']);
    expect(
      codes(
        lessonWith(q => (firstQuestion(q).options[0].text = 5)),
        'error'
      )
    ).toEqual(['OPTION_EMPTY']);
  });

  it('two options with the same text, even in another case or with other spacing', () => {
    const read = lessonWith(q => {
      firstQuestion(q).options[3].text = '  ERSTE   Antwort ';
    });
    expect(only(read)).toEqual([['OPTION_DUPLICATE', '1a', 'low', 1]]);
  });

  it('a question twice in one set', () => {
    const read = lessonWith(q => {
      firstSet(q).questions[4].question = firstSet(q).questions[1].question;
    });
    expect(only(read)).toEqual([['QUESTION_DUPLICATE', '1a', 'low', 5]]);
  });

  it('the same question in two sets is no duplicate', () => {
    const read = lessonWith(q => {
      q.difficulties.mittel.questions[0].question =
        q.difficulties.leicht.questions[0].question;
    });
    expect(read.findings).toEqual([]);
  });

  it('a question id used twice in the file', () => {
    const read = lessonWith(q => {
      q.difficulties.mittel.questions[0].id =
        q.difficulties.leicht.questions[0].id;
    });
    expect(only(read)).toEqual([['ID_DUPLICATE', '1a', 'medium', 1]]);
  });

  it('numbers that do not run from 1 up', () => {
    const read = lessonWith(q => (firstSet(q).questions[2].number = 7));
    expect(only(read)).toEqual([['NUMBER_SEQUENCE', '1a', 'low', 3]]);
  });

  it('control characters (a NUL would break the insert)', () => {
    const read = lessonWith(q => (firstQuestion(q).question = 'Frage\u0000 x'));
    expect(codes(read, 'error')).toEqual(['TEXT_CONTROL']);
    const option = lessonWith(
      q => (firstQuestion(q).options[0].text = 'a\u0007b')
    );
    expect(codes(option, 'error')).toEqual(['TEXT_CONTROL']);
  });

  it('cleans the texts like the Word parser (spaces, invisible marks)', () => {
    const read = lessonWith(q => {
      firstQuestion(q).question = '  Erfundene ​Frage \n  X?  ';
    });
    expect(read.findings).toEqual([]);
    const content = read.files[0].content as any;
    expect(content.result.value.questions[0].text).toBe('Erfundene Frage X?');
  });

  it('an explanation, option or question over the limits', () => {
    expect(
      codes(
        readLessonQuizzes(sampleLesson(), { limits: { maxQuestionChars: 5 } }),
        'error'
      )
    ).toContain('TEXT_TOO_LONG');
    expect(
      codes(
        readLessonQuizzes(sampleLesson(), { limits: { maxOptionChars: 5 } }),
        'error'
      )
    ).toContain('OPTION_TOO_LONG');
    expect(
      codes(
        readLessonQuizzes(sampleLesson(), {
          limits: { maxExplanationChars: 5 },
        }),
        'error'
      )
    ).toContain('RATIONALE_TOO_LONG');
  });

  it('too many questions in a set, none in a set', () => {
    expect(
      codes(
        readLessonQuizzes(sampleLesson(), {
          limits: { maxQuestionsPerSet: 9 },
        }),
        'error'
      )
    ).toContain('TOO_MANY_QUESTIONS');
    expect(
      codes(
        lessonWith(q => (firstSet(q).questions = [])),
        'error'
      )
    ).toEqual(['NO_QUESTIONS']);
    expect(
      codes(
        lessonWith(q => delete firstSet(q).questions),
        'error'
      )
    ).toEqual(['NO_QUESTIONS']);
  });

  it('a set with eight questions is a warning, not an error', () => {
    const read = lessonWith(q => (firstSet(q).questions.length = 8));
    expect(read.findings.map(f => [f.severity, f.code, f.level])).toEqual([
      ['warning', 'QUESTION_COUNT', 'low'],
    ]);
    const plan = buildImportPlan(read.files, decisions, { now: NOW });
    expect(
      plan.quizzes.find(q => q.code === 'K1-a-low')?.questions
    ).toHaveLength(8);
    expect(plan.warnings).toEqual(['quiz:1a:low: QUESTION_COUNT']);
  });

  it('a source warning is imported but reported with the question number', () => {
    const read = lessonWith(q => {
      firstQuestion(q).source_warnings = ['erfundener Hinweis'];
    });
    expect(
      read.findings.map(f => [f.severity, f.code, f.id, f.level, f.question])
    ).toEqual([['warning', 'SOURCE_WARNING', '1a', 'low', 1]]);
    const bad = lessonWith(q => (firstQuestion(q).source_warnings = 'x'));
    expect(codes(bad, 'error')).toEqual(['SOURCE_WARNINGS_INVALID']);
    const empty = lessonWith(q => (firstQuestion(q).source_warnings = ['']));
    expect(codes(empty, 'error')).toEqual(['SOURCE_WARNINGS_INVALID']);
  });

  it('an entry that is no object', () => {
    const read = lessonWith(q => (firstSet(q).questions[1] = 'text'));
    expect(only(read)).toEqual([['QUESTION_NOT_OBJECT', '1a', 'low', 2]]);
    const option = lessonWith(q => (firstQuestion(q).options[1] = 'text'));
    expect(codes(option, 'error')).toContain('OPTION_INVALID');
  });

  it('an error in one level skips that level only, with the reason', () => {
    const read = lessonWith(q => (firstQuestion(q).correct_answer = 'E'));
    const plan = buildImportPlan(read.files, decisions, { now: NOW });
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toMatchObject({
      key: 'quiz:1a:low',
      type: 'quiz',
      code: 'PARSE_ERROR',
    });
    expect(plan.skipped[0].reason).toContain('ANSWER_INVALID (question 1)');
    expect(plan.quizzes.map(q => q.code)).toEqual(
      expect.arrayContaining(['K1-a-medium', 'K1-a-high'])
    );
  });
});

describe('readLessonQuizzes: levels, labels and sources', () => {
  it('a label that differs from the level', () => {
    const read = lessonWith(q => (firstSet(q).label = 'mittel'));
    expect(codes(read, 'error')).toEqual(['LABEL_MISMATCH']);
  });

  it('a level that is missing is listed as skipped with its key', () => {
    const read = lessonWith(q => delete q.difficulties.schwer);
    expect(read.unmapped).toHaveLength(1);
    expect(read.unmapped[0]).toMatchObject({
      key: 'quiz:1a:high',
      code: 'LEVEL_MISSING',
      type: 'quiz',
      componentCode: 'K1',
    });
    expect(
      read.files.filter(f => f.info.key?.startsWith('quiz:1a:'))
    ).toHaveLength(2);
    const all = lessonWith(q => (q.difficulties = null));
    expect(all.unmapped.map(u => u.code)).toEqual([
      'LEVEL_MISSING',
      'LEVEL_MISSING',
      'LEVEL_MISSING',
    ]);
  });

  it('the source of a level must be text', () => {
    expect(
      codes(
        lessonWith(q => (firstSet(q).source = 5)),
        'error'
      )
    ).toEqual(['SOURCE_TYPE']);
    expect(
      codes(
        lessonWith(q => delete firstSet(q).attached_source),
        'error'
      )
    ).toEqual(['SOURCE_TYPE']);
  });

  it('a Word path in source_files that names another key is a warning', () => {
    const read = lessonWith(q => {
      q.source_files.Low = q.source_files.Low.replace('1a_Quiz', '1b_Quiz');
    });
    expect(read.findings.map(f => [f.severity, f.code, f.level])).toEqual([
      ['warning', 'SOURCE_PATH_MISMATCH', 'low'],
    ]);
    expect(
      codes(
        lessonWith(q => delete q.source_files),
        'warning'
      )
    ).toEqual(['SOURCE_FILES']);
  });

  it('a category that differs from the section is a warning', () => {
    const read = lessonWith(q => (q.category = 'anders'));
    expect(read.findings.map(f => [f.severity, f.code])).toEqual([
      ['warning', 'CATEGORY_MISMATCH'],
    ]);
  });
});

describe('readLessonQuizzes: the title and the enabler', () => {
  it('a title that is no heading of the enabler gives no enabler file and a warning', () => {
    const read = lessonWith(q => (q.title = 'Erfundenes Thema ohne Kennung'));
    expect(read.findings.map(f => [f.severity, f.code])).toEqual([
      ['warning', 'TITLE_HEADING'],
    ]);
    expect(read.files.some(f => f.rel === 'quiz-json#1a/enabler')).toBe(false);
    expect(read.files.filter(f => f.info.type === 'enabler')).toHaveLength(4);
    const plan = buildImportPlan(read.files, decisions, { now: NOW });
    expect(plan.skipped.map(s => s.code)).toEqual([
      'ENABLER_MISSING',
      'ENABLER_MISSING',
      'ENABLER_MISSING',
    ]);
  });

  it('one stray character before the code is read without it, with a warning', () => {
    const read = lessonWith(q => (q.title = 'w1a) Erfundenes Thema'));
    expect(read.findings.map(f => [f.severity, f.code])).toEqual([
      ['warning', 'TITLE_REPAIRED'],
    ]);
    const enabler = read.files.find(f => f.rel === 'quiz-json#1a/enabler');
    expect((enabler?.content as any).paragraphs[0].text).toBe(
      '1a) Erfundenes Thema'
    );
    const plan = buildImportPlan(read.files, decisions, { now: NOW });
    expect(plan.enablers.find(e => e.code === 'K1-a')).toMatchObject({
      title: 'Erfundenes Thema',
      descriptionText: null,
    });
    expect(plan.skipped).toEqual([]);
    expect(plan.warnings).toContain('quiz:1a:low: TITLE_REPAIRED');
  });

  it('a stray prefix is only repaired when the id of the quiz confirms the code', () => {
    for (const title of [
      'w1b) Erfundenes Thema',
      'abc1a) Erfundenes Thema',
      'w 1a) Erfundenes Thema',
      'w1a Erfundenes Thema',
    ]) {
      const read = lessonWith(q => (q.title = title));
      expect(codes(read, 'warning')).toEqual(['TITLE_HEADING']);
      expect(read.files.some(f => f.rel === 'quiz-json#1a/enabler')).toBe(
        false
      );
    }
  });

  it('a heading of another enabler does not count', () => {
    const read = lessonWith(q => (q.title = '1b) Erfundenes Thema'));
    expect(codes(read, 'warning')).toEqual(['TITLE_HEADING']);
  });

  it('the variant 25/1b) is read like the planner reads it', () => {
    const quiz = jsonQuiz({
      id: '25_1b',
      componentId: '25.1',
      dir: `${SECTION.t1}/25.1 - Erfundene Zusammenarbeit (§ 4 Abs. 4 Nr. 6)`,
      title: '25/1b) Aufgaben im Team planen',
    });
    const read = readLessonQuizzes(lessonFile([quiz]));
    expect(read.findings).toEqual([]);
    const enabler = read.files.find(f => f.info.type === 'enabler');
    expect((enabler?.content as any).paragraphs[0].text).toBe(
      '25/1b) Aufgaben im Team planen'
    );
    const plan = buildImportPlan(read.files, decisions, { now: NOW });
    expect(plan.enablers[0]).toMatchObject({
      code: 'K25.1-b',
      title: 'Aufgaben im Team planen',
      descriptionText: null,
    });
  });

  it('no enabler file when every level has an error', () => {
    const read = lessonWith(q => {
      for (const level of ['leicht', 'mittel', 'schwer']) {
        q.difficulties[level].questions[0].correct_answer = 'Z';
      }
    });
    expect(read.files.some(f => f.rel === 'quiz-json#1a/enabler')).toBe(false);
    expect(read.files.some(f => f.rel === 'quiz-json#6a/enabler')).toBe(true);
  });
});

describe('readLessonQuizzes: ids and components that cannot be mapped', () => {
  const unmapped = (read: QuizJsonRead) =>
    read.unmapped.map(u => [u.code, u.file]);

  it('an id without the form 10a or 24_1a', () => {
    for (const id of ['A1', '1', '10', '1aa', 5, null, '24.1a']) {
      const read = lessonWith(q => (q.id = id));
      expect(read.unmapped.map(u => u.code)).toEqual(['ID_INVALID']);
      expect(read.unmapped[0].file).toBe('quiz-json#entry-1');
      expect(read.files.filter(f => f.rel.includes('#entry'))).toEqual([]);
    }
  });

  it('an entry that is no object', () => {
    const file = sampleLesson();
    file.quizzes[2] = 'text';
    const read = readLessonQuizzes(file);
    expect(unmapped(read)).toEqual([['QUIZ_NOT_OBJECT', 'quiz-json#entry-3']]);
    expect(read.files).toHaveLength(4 * 4);
  });

  it('an id of another component than the one named', () => {
    expect(unmapped(lessonWith(q => (q.id = '11a')))).toEqual([
      ['COMPONENT_MISMATCH', 'quiz-json#11a'],
    ]);
    // 6a lies in 06.1, an id with a split must name the same split
    expect(
      unmapped(
        lessonWith(q => {
          q.id = '6_2a';
          q.curriculum_component = {
            id: '06.1',
            title: q.curriculum_component.title,
          };
        })
      )[0][0]
    ).toBe('COMPONENT_MISMATCH');
    // an id with a split in a component without one
    expect(unmapped(lessonWith(q => (q.id = '1_1a')))[0][0]).toBe(
      'COMPONENT_MISMATCH'
    );
  });

  it('a component without a usable id or title', () => {
    for (const component of [
      null,
      {},
      { id: '1', title: 'x' },
      { id: '01' },
      { id: '01', title: 'a/b' },
      { id: '01', title: 'a\\b' },
      { id: '01', title: 'a\nb' },
    ]) {
      const read = lessonWith(q => (q.curriculum_component = component));
      expect(unmapped(read)[0][0]).toBe('COMPONENT_INVALID');
    }
  });

  it('a section that is missing or holds path characters', () => {
    for (const section of [undefined, '', '../x', 'a\\b']) {
      const read = lessonWith(q => (q.training_section = section));
      expect(unmapped(read)[0][0]).toBe('SECTION_INVALID');
    }
  });

  it('a path that does not fit the scheme (unknown section, title without number)', () => {
    expect(
      unmapped(lessonWith(q => (q.training_section = 'Irgendein Teil')))[0][0]
    ).toBe('PATH_MAPPING');
    expect(
      unmapped(
        lessonWith(q => {
          q.curriculum_component.title = 'Erfundenes Thema ohne Nummer';
        })
      )[0][0]
    ).toBe('PATH_MAPPING');
    expect(
      unmapped(
        lessonWith(q => {
          q.curriculum_component.title = '02 - Anderes Thema';
        })
      )[0][0]
    ).toBe('PATH_MAPPING');
  });

  it('an id used twice: none of the entries is read', () => {
    const file = sampleLesson();
    file.quizzes.push(clone(file.quizzes[0]));
    file.quiz_count = 6;
    const read = readLessonQuizzes(file);
    expect(read.unmapped.map(u => [u.code, u.key])).toEqual([
      ['ID_DUPLICATE', 'quiz:1a'],
      ['ID_DUPLICATE', 'quiz:1a'],
    ]);
    expect(read.files.some(f => f.rel.startsWith('quiz-json#1a/'))).toBe(false);
  });

  it('two ids for the same enabler: none of them is read', () => {
    const file = lessonFile([
      jsonQuiz({
        id: '6a',
        componentId: '06.1',
        dir: DIR.k6_1,
        title: '6a) Erfundenes Thema',
      }),
      jsonQuiz({
        id: '6_1a',
        componentId: '06.1',
        dir: DIR.k6_1,
        title: '6a) Erfundenes Thema',
      }),
    ]);
    const read = readLessonQuizzes(file);
    expect(read.unmapped.map(u => u.code)).toEqual([
      'KEY_DUPLICATE',
      'KEY_DUPLICATE',
    ]);
    expect(read.files).toEqual([]);
  });

  it('one component with two titles or two sections is a conflict for all its quizzes', () => {
    const second = jsonQuiz({
      id: '1b',
      componentId: '01',
      dir: DIR.k1,
      title: '1b) Zweites Thema',
    });
    second.curriculum_component.title = '01 - Anderer Titel (§ 4 Abs. 2 Nr. 1)';
    const read = readLessonQuizzes(
      lessonFile([
        jsonQuiz({
          id: '1a',
          componentId: '01',
          dir: DIR.k1,
          title: '1a) Erstes Thema',
        }),
        second,
      ])
    );
    expect(
      read.findings.filter(f => f.code === 'COMPONENT_CONFLICT').map(f => f.id)
    ).toEqual(['1a', '1b']);
    const plan = buildImportPlan(read.files, decisions, { now: NOW });
    expect(plan.quizzes).toEqual([]);
    // no enabler is planned for a component that names two titles
    expect(
      plan.skipped.filter(s => s.code === 'ENABLER_MISSING').map(s => s.key)
    ).toHaveLength(6);
  });
});

describe('readLessonQuizzes: findings never quote the file', () => {
  it('no text of the file in a finding or a skip reason', () => {
    const secret = 'GEHEIMNIS-QUARK-4711';
    const file = sampleLesson();
    const quiz = file.quizzes[0];
    firstQuestion(quiz).question = `${secret} Frage?`;
    firstQuestion(quiz).correct_answer = 'Z';
    firstQuestion(quiz).options[1].text = `${secret} zwei`;
    firstQuestion(quiz).options[2].text = `${secret} zwei`;
    firstQuestion(quiz).explanation = secret;
    quiz.title = `${secret}`;
    quiz.extra = secret;
    quiz.source_files.Low = secret;
    const read = readLessonQuizzes(file);
    const plan = buildImportPlan(read.files, decisions, {
      now: NOW,
      extra: { skipped: read.unmapped },
    });
    const dump = JSON.stringify([
      read.findings,
      read.unmapped,
      plan.skipped,
      plan.warnings,
    ]);
    expect(dump).not.toContain(secret);
    expect(read.findings.length).toBeGreaterThan(2);
  });
});

describe('the planner treats the JSON like the Word path for solutions', () => {
  it('skips a quiz whose visible text shows a solution marker', () => {
    const read = lessonWith(q => {
      firstQuestion(q).options[0].text = 'Richtige Antwort: B';
    });
    const plan = buildImportPlan(read.files, decisions, { now: NOW });
    expect(plan.skipped.map(s => [s.key, s.code])).toEqual([
      ['quiz:K1-a-low', 'SOLUTION_MARKER'],
    ]);
  });
});

describe('readGlobalQuizzes', () => {
  const global = (change: (quiz: any) => void) => {
    const file = sampleGlobal();
    change(file.quizzes[0]);
    return readGlobalQuizzes(file);
  };

  it('reads a valid file: one global quiz per component with the key of the Word path', () => {
    const read = readGlobalQuizzes(sampleGlobal());
    expect(read.fatal).toBe(false);
    expect(read.findings).toEqual([]);
    expect(read.files.map(f => f.info.key)).toEqual([
      'global-quiz:01',
      'global-quiz:06.1',
      'global-quiz:06.2',
      'global-quiz:10',
      'global-quiz:20',
    ]);
    expect(read.sets.map(s => [s.id, s.componentCode, s.questions])).toEqual([
      ['01', 'K1', 20],
      ['06.1', 'K6.1', 20],
      ['06.2', 'K6.2', 20],
      ['10', 'K10', 20],
      ['20', 'K20', 20],
    ]);
    const content = read.files[0].content as any;
    expect(content.result.value.kind).toBe('global');
    expect(content.result.value.questions[0].difficulty).toBe('low');
    expect(content.result.value.questions[5].difficulty).toBe('medium');
    expect(content.result.value.questions[19].difficulty).toBe('high');
  });

  it('refuses a head that does not fit and unknown fields of the head', () => {
    for (const raw of [
      { ...sampleGlobal(), schema_version: '1.1' },
      { ...sampleGlobal(), quiz_count: 1 },
      { ...sampleGlobal(), difficulty_levels: ['leicht'] },
      { ...sampleGlobal(), quizzes: 'x' },
    ]) {
      const read = readGlobalQuizzes(raw);
      expect(read.fatal).toBe(true);
      expect(read.files).toEqual([]);
    }
  });

  it('wants exactly 20 questions', () => {
    const read = global(q => q.questions.pop());
    expect(codes(read, 'error')).toEqual(['QUESTION_COUNT']);
    const plan = buildImportPlan(
      [...read.files, ...readLessonQuizzes(sampleLesson()).files],
      decisions,
      { now: NOW }
    );
    expect(plan.skipped.map(s => [s.key, s.code])).toEqual([
      ['global-quiz:01', 'PARSE_ERROR'],
    ]);
    expect(
      readGlobalQuizzes(sampleGlobal(), { expectedGlobalQuestions: 19 })
        .findings
    ).not.toEqual([]);
  });

  it('checks the questions like the lesson quizzes', () => {
    expect(
      codes(
        global(q => (q.questions[0].correct_answer = 'E')),
        'error'
      )
    ).toEqual(['ANSWER_INVALID']);
    expect(
      codes(
        global(q => q.questions[0].options.pop()),
        'error'
      )
    ).toEqual(['OPTION_COUNT']);
    expect(
      codes(
        global(
          q => (q.questions[1].options[1].text = q.questions[1].options[0].text)
        ),
        'error'
      )
    ).toEqual(['OPTION_DUPLICATE']);
    expect(
      codes(
        global(q => (q.questions[3].question = q.questions[2].question)),
        'error'
      )
    ).toEqual(['QUESTION_DUPLICATE']);
    expect(
      codes(
        global(q => (q.extra = 1)),
        'error'
      )
    ).toEqual(['UNKNOWN_FIELD']);
  });

  it('an id that is no component id or that names another component', () => {
    for (const id of ['1', '1a', '06.10', 5, undefined]) {
      const read = global(q => (q.id = id));
      expect(read.unmapped.map(u => u.code)).toEqual(['ID_INVALID']);
    }
    const mismatch = global(q => (q.curriculum_component.id = '02'));
    expect(mismatch.unmapped.map(u => u.code)).toEqual(['COMPONENT_MISMATCH']);
    const noComponent = global(q => delete q.curriculum_component);
    expect(noComponent.unmapped.map(u => u.code)).toEqual([
      'COMPONENT_MISMATCH',
    ]);
  });

  it('a title that does not start with the component id, missing sources', () => {
    expect(
      codes(
        global(q => (q.curriculum_component.title = '02) Anderes Thema')),
        'error'
      )
    ).toEqual(['COMPONENT_TITLE']);
    expect(
      codes(
        global(q => delete q.source_json),
        'error'
      )
    ).toEqual(['SOURCE_TYPE']);
  });

  it('a component listed twice: none of the entries is read', () => {
    const file = sampleGlobal();
    file.quizzes.push(clone(file.quizzes[1]));
    file.quiz_count = 6;
    const read = readGlobalQuizzes(file);
    expect(read.unmapped.map(u => [u.code, u.key])).toEqual([
      ['ID_DUPLICATE', 'global-quiz:06.1'],
      ['ID_DUPLICATE', 'global-quiz:06.1'],
    ]);
    expect(read.files).toHaveLength(4);
  });

  it('an entry that is no object', () => {
    const file = globalFile([jsonGlobalQuiz('01'), 'x']);
    const read = readGlobalQuizzes(file);
    expect(read.unmapped.map(u => [u.code, u.file])).toEqual([
      ['QUIZ_NOT_OBJECT', 'global-quiz-json#entry-2'],
    ]);
  });

  it('a component with a global quiz but no lesson quiz is rejected by the planner like in Word', () => {
    const read = readGlobalQuizzes(globalFile([jsonGlobalQuiz('01')]));
    const plan = buildImportPlan(read.files, decisions, { now: NOW });
    expect(plan.quizzes).toEqual([]);
    expect(plan.skipped.map(s => s.code)).toEqual(['NO_GROUP']);
  });
});
