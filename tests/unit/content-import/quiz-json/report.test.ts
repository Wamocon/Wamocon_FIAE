import {
  readGlobalQuizzes,
  readLessonQuizzes,
} from '@/lib/content-import/quiz-json/read';
import {
  renderQuizJsonReport,
  summarizeQuizJson,
} from '@/lib/content-import/quiz-json/report';

import { DIR } from '../apply/fixtures';
import {
  clone,
  jsonQuiz,
  lessonFile,
  sampleGlobal,
  sampleLesson,
} from './fixtures';

describe('the report of check-quizzes', () => {
  const lesson = sampleLesson();
  lesson.quizzes[0].difficulties.leicht.questions.length = 8;
  lesson.quizzes[1].difficulties.mittel.questions[2].correct_answer = 'Z';
  lesson.quizzes[2].title = 'Erfundenes Thema ohne Kennung';
  const global = clone(sampleGlobal());
  global.quizzes[3].questions.pop();
  const summary = summarizeQuizJson(
    readLessonQuizzes(lesson),
    readGlobalQuizzes(global)
  );

  it('counts quizzes, sets, levels and questions per component', () => {
    expect(summary.lesson).toMatchObject({
      read: true,
      quizzes: 5,
      sets: 15,
      questions: 148,
      setsWithErrors: 1,
      byLevel: { low: 5, medium: 5, high: 5 },
    });
    expect(summary.lesson.byComponent.map(c => c.component)).toEqual([
      'K1',
      'K6.1',
      'K6.2',
      'K10',
      'K20',
    ]);
    expect(summary.lesson.byComponent[0]).toEqual({
      component: 'K1',
      quizzes: 1,
      sets: 3,
      questions: 28,
    });
    expect(summary.lesson.byQuestionCount).toEqual([
      { questions: 8, sets: 1, ids: ['1a/low'] },
      expect.objectContaining({ questions: 10, sets: 14 }),
    ]);
    expect(summary.global).toMatchObject({ quizzes: 5, sets: 5 });
  });

  it('groups the findings by code with the ids they name', () => {
    expect(summary.lesson.findings).toEqual([
      {
        severity: 'error',
        code: 'ANSWER_INVALID',
        count: 1,
        ids: ['6a/medium#3'],
      },
      {
        severity: 'warning',
        code: 'QUESTION_COUNT',
        count: 1,
        ids: ['1a/low'],
      },
      { severity: 'warning', code: 'TITLE_HEADING', count: 1, ids: ['6d'] },
    ]);
    expect(summary.global.findings).toEqual([
      { severity: 'error', code: 'QUESTION_COUNT', count: 1, ids: ['10'] },
    ]);
  });

  it('renders German Markdown with numbers and ids, no content and no dashes', () => {
    const text = renderQuizJsonReport(summary);
    expect(text).toContain('Quizze: 5, Sätze: 15, Fragen: 148');
    expect(text).toContain('Stufen: leicht 5, mittel 5, schwer 5.');
    expect(text).toContain('| Fehler | ANSWER_INVALID | 1 | 6a/medium#3 |');
    expect(text).toContain('| 8 | 1 | 1a/low |');
    expect(text).not.toContain('Erfundene');
    expect(text).not.toContain('ZETA');
    expect(text).not.toMatch(/[–—]/);
  });

  it('says so when a file was refused or not given', () => {
    const refused = summarizeQuizJson(
      readLessonQuizzes({ ...sampleLesson(), schema_version: '2' }),
      null
    );
    expect(refused.lesson.read).toBe(false);
    expect(refused.lesson.findings[0].code).toBe('SCHEMA_VERSION');
    expect(refused.global.findings).toEqual([]);
    const text = renderQuizJsonReport(refused);
    expect(text).toContain('Die Datei wurde nicht gelesen');
  });

  it('shortens long id lists', () => {
    const letters = 'abcdefghijklmnopqrst'.split('');
    const big = lessonFile(
      letters.map(letter =>
        jsonQuiz({ id: `1${letter}`, componentId: '01', dir: DIR.k1, count: 9 })
      )
    );
    const result = summarizeQuizJson(readLessonQuizzes(big), null);
    const row = result.lesson.byQuestionCount[0];
    expect(row.sets).toBe(60);
    expect(row.ids).toHaveLength(40);
    expect(renderQuizJsonReport(result)).toContain('1a/low');
    expect(renderQuizJsonReport(result)).toContain('und weitere');
  });
});

describe('the report for a side that was not given', () => {
  it('says "Nicht angegeben" and does not claim a refusal', () => {
    const text = renderQuizJsonReport(
      summarizeQuizJson(readLessonQuizzes(sampleLesson()), null)
    );
    expect(text).toContain('Nicht angegeben.');
    expect(text).not.toContain('abgelehnt');
  });

  it('names an entry without an id by its position', () => {
    const file = sampleLesson();
    file.quizzes[1] = 'text';
    const text = renderQuizJsonReport(
      summarizeQuizJson(readLessonQuizzes(file), null)
    );
    expect(text).toContain('(Eintrag 2)');
  });
});
