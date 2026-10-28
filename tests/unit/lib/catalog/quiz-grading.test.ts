import {
  gradableCountOf,
  hasGradableQuestion,
  isQuestionGradable,
  quizIdsWithGradableQuestion,
  quizScore,
  textAnswerMatches,
} from '@/lib/catalog/quiz-grading';

// The ONE distinction between a question that can be graded and one that
// cannot: a choice question always can, a free text question only with an
// expected answer. The grading of a submission and the definition of "enabler
// completed" (progression.ts) both use it.

describe('isQuestionGradable', () => {
  it('a choice question is gradable', () => {
    expect(isQuestionGradable({ questionType: 'MCQ' })).toBe(true);
    expect(isQuestionGradable({ questionType: null })).toBe(true);
    expect(isQuestionGradable({})).toBe(true);
  });

  it('a free text question with an expected answer is gradable', () => {
    expect(
      isQuestionGradable({ questionType: 'TEXT', expectedAnswer: 'Docker' })
    ).toBe(true);
  });

  it('a free text question without an expected answer is not gradable', () => {
    expect(isQuestionGradable({ questionType: 'TEXT' })).toBe(false);
    expect(
      isQuestionGradable({ questionType: 'TEXT', expectedAnswer: null })
    ).toBe(false);
    expect(
      isQuestionGradable({ questionType: 'TEXT', expectedAnswer: '' })
    ).toBe(false);
    expect(
      isQuestionGradable({ questionType: 'TEXT', expectedAnswer: ' \n\t ' })
    ).toBe(false);
  });

  it('treats NBSP, byte order mark and ideographic space as blank (same as the SQL pattern)', () => {
    expect(
      isQuestionGradable({
        questionType: 'TEXT',
        expectedAnswer: ' ﻿　',
      })
    ).toBe(false);
  });

  it('takes the fact of an expected answer where the text is not loaded', () => {
    expect(
      isQuestionGradable({ questionType: 'TEXT', hasExpectedAnswer: true })
    ).toBe(true);
    expect(
      isQuestionGradable({ questionType: 'TEXT', hasExpectedAnswer: false })
    ).toBe(false);
    // the fact wins over a text that is given as well
    expect(
      isQuestionGradable({
        questionType: 'TEXT',
        hasExpectedAnswer: false,
        expectedAnswer: 'x',
      })
    ).toBe(false);
    expect(
      isQuestionGradable({ questionType: 'MCQ', hasExpectedAnswer: false })
    ).toBe(true);
  });

  it('an expected answer on a choice question does not change anything', () => {
    expect(
      isQuestionGradable({ questionType: 'MCQ', expectedAnswer: null })
    ).toBe(true);
  });
});

describe('gradableCountOf and hasGradableQuestion', () => {
  const text = { questionType: 'TEXT', expectedAnswer: null };
  const textWithKey = { questionType: 'TEXT', expectedAnswer: 'x' };
  const choice = { questionType: 'MCQ' };

  it('counts only the gradable questions', () => {
    expect(gradableCountOf([text, textWithKey, choice, text])).toBe(2);
    expect(gradableCountOf([text, text])).toBe(0);
    expect(gradableCountOf([])).toBe(0);
  });

  it('a quiz without a gradable question has none', () => {
    expect(hasGradableQuestion([text, text])).toBe(false);
    expect(hasGradableQuestion([])).toBe(false);
    expect(hasGradableQuestion([text, choice])).toBe(true);
  });
});

describe('quizScore', () => {
  it('is the percentage of the gradable questions', () => {
    expect(quizScore(1, 2)).toBe(50);
    expect(quizScore(2, 2)).toBe(100);
    expect(quizScore(0, 4)).toBe(0);
    expect(quizScore(1, 3)).toBe(33);
    expect(quizScore(2, 3)).toBe(67);
  });

  it('is null without a gradable question (not automatically gradable)', () => {
    expect(quizScore(0, 0)).toBeNull();
  });
});

describe('textAnswerMatches', () => {
  it('compares trimmed and case-insensitive', () => {
    expect(textAnswerMatches('  docker ', 'Docker')).toBe(true);
    expect(textAnswerMatches('Kubernetes', 'Docker')).toBe(false);
  });
});

describe('quizIdsWithGradableQuestion', () => {
  it('lists the quizzes that have at least one gradable question', () => {
    const ids = quizIdsWithGradableQuestion([
      { quizId: 'a', questionType: 'TEXT', expectedAnswer: null },
      { quizId: 'a', questionType: 'TEXT', expectedAnswer: ' ' },
      { quizId: 'b', questionType: 'TEXT', expectedAnswer: null },
      { quizId: 'b', questionType: 'MCQ', expectedAnswer: null },
      { quizId: 'c', questionType: 'TEXT', expectedAnswer: 'x' },
    ]);
    expect(Array.from(ids).sort()).toEqual(['b', 'c']);
  });

  it('an empty list gives an empty set', () => {
    expect(quizIdsWithGradableQuestion([]).size).toBe(0);
  });
});
