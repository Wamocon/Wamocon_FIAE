import { describe, expect, it } from '@jest/globals';
import {
  questionResult,
  summarizeQuizReview,
  type ReviewQuestionInput,
} from '@/lib/trainer/quiz-review';
import { quizScore } from '@/lib/catalog/quiz-grading';

// WMCNL-3006, WMCNL-3007: the review says per question whether the stored
// answer was right, and how many questions were right out of the graded ones.

const mcq = (selected: string | null): ReviewQuestionInput => ({
  questionType: 'MCQ',
  expectedAnswer: null,
  options: [
    { id: 'a', isCorrect: true },
    { id: 'b', isCorrect: false },
  ],
  selectedOptionId: selected,
  textAnswer: null,
});

const text = (
  given: string | null,
  expected: string | null
): ReviewQuestionInput => ({
  questionType: 'TEXT',
  expectedAnswer: expected,
  options: [],
  selectedOptionId: null,
  textAnswer: given,
});

describe('questionResult', () => {
  it('is correct for the right option and wrong for another one', () => {
    expect(questionResult(mcq('a'))).toBe('correct');
    expect(questionResult(mcq('b'))).toBe('wrong');
  });

  it('is unanswered without a stored answer', () => {
    expect(questionResult(mcq(null))).toBe('unanswered');
    expect(questionResult(text(null, 'Berlin'))).toBe('unanswered');
    expect(questionResult(text('   ', 'Berlin'))).toBe('unanswered');
  });

  it('compares a text answer like the grading does: trimmed and case-insensitive', () => {
    expect(questionResult(text('  BERLIN ', 'berlin'))).toBe('correct');
    expect(questionResult(text('Bonn', 'Berlin'))).toBe('wrong');
  });

  it('does not grade a text answer without an expected answer', () => {
    expect(questionResult(text('irgendwas', null))).toBe('ungraded');
    expect(questionResult(text('irgendwas', '  '))).toBe('ungraded');
  });

  it('is wrong for an option that is not one of the listed options', () => {
    expect(questionResult(mcq('zzz'))).toBe('wrong');
  });
});

describe('summarizeQuizReview', () => {
  it('counts the right answers of the graded questions and gives the percentage', () => {
    const summary = summarizeQuizReview([
      mcq('a'),
      mcq('b'),
      mcq('a'),
      text('Berlin', 'berlin'),
    ]);
    expect(summary).toEqual({
      questionCount: 4,
      gradableCount: 4,
      answeredCount: 4,
      correctCount: 3,
      computedScore: 75,
    });
  });

  it('is the same percentage the grading of a submission stores', () => {
    const summary = summarizeQuizReview([mcq('a'), mcq('a'), mcq('b')]);
    expect(summary.computedScore).toBe(quizScore(2, 3));
  });

  it('leaves an ungraded text question out of the percentage', () => {
    const summary = summarizeQuizReview([mcq('a'), text('x', null)]);
    expect(summary.questionCount).toBe(2);
    expect(summary.gradableCount).toBe(1);
    expect(summary.answeredCount).toBe(2);
    expect(summary.computedScore).toBe(100);
  });

  it('says that nothing is stored when no question has an answer', () => {
    const summary = summarizeQuizReview([mcq(null), mcq(null)]);
    expect(summary.answeredCount).toBe(0);
    expect(summary.correctCount).toBe(0);
  });

  it('has no percentage for a quiz without a graded question', () => {
    expect(summarizeQuizReview([text('x', null)]).computedScore).toBeNull();
    expect(summarizeQuizReview([]).computedScore).toBeNull();
  });
});
