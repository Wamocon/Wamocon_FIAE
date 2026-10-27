// The source fields of the JSON (paths of the Word files) are not used by the
// import: a missing one is a note, a wrong type is an error.
import {
  readGlobalQuizzes,
  readLessonQuizzes,
} from '@/lib/content-import/quiz-json/read';

import { sampleGlobal, sampleLesson } from './fixtures';

describe('source fields and spelling of the section', () => {
  it('a source that is null is a note and the level is still read', () => {
    const file = sampleLesson();
    file.quizzes[0].difficulties.leicht.source = null;
    const read = readLessonQuizzes(file);
    expect(read.findings.map(f => [f.severity, f.code, f.level])).toEqual([
      ['warning', 'SOURCE_NULL', 'low'],
    ]);
    expect(read.sets[0].errors).toBe(0);
  });

  it('a global quiz without a source (null) is a note', () => {
    const file = sampleGlobal();
    file.quizzes[2].source = null;
    const read = readGlobalQuizzes(file);
    expect(read.findings.map(f => [f.severity, f.code, f.id])).toEqual([
      ['warning', 'SOURCE_NULL', '06.2'],
    ]);
    expect(read.files).toHaveLength(5);
  });

  it('a source that is an object or a number is an error', () => {
    const file = sampleGlobal();
    file.quizzes[0].source = { Word: 'x' };
    file.quizzes[1].source_file = 5;
    delete file.quizzes[2].source_json;
    const read = readGlobalQuizzes(file);
    expect(read.findings.map(f => [f.severity, f.code, f.id]).sort()).toEqual([
      ['error', 'SOURCE_TYPE', '01'],
      ['error', 'SOURCE_TYPE', '06.1'],
      ['error', 'SOURCE_TYPE', '06.2'],
    ]);
  });

  it('a category spelled with combining marks equals the section (NFC)', () => {
    const file = sampleLesson();
    const quiz = file.quizzes[4];
    expect(quiz.training_section).toContain('während');
    quiz.category = quiz.category.normalize('NFD');
    expect(quiz.category).not.toBe(quiz.training_section);
    expect(readLessonQuizzes(file).findings).toEqual([]);
  });
});

describe('smaller findings', () => {
  it('an empty source_warnings list is no warning', () => {
    const file = sampleLesson();
    file.quizzes[0].difficulties.leicht.questions[0].source_warnings = [];
    expect(readLessonQuizzes(file).findings).toEqual([]);
  });

  it('an entry without an id is named by its position in the list', () => {
    const file = sampleLesson();
    file.quizzes[2] = 'text';
    file.quiz_count = 5;
    const read = readLessonQuizzes(file);
    expect(read.findings.map(f => [f.code, f.id, f.entry])).toEqual([
      ['QUIZ_NOT_OBJECT', null, 3],
    ]);
  });
});
