/**
 * What the review of a quiz submission shows per question and in total
 * (WMCNL-3006, WMCNL-3007). Pure functions, used by the route that builds the
 * review and by the page that shows it.
 *
 * The score of a submission is the percentage of the graded questions that were
 * answered right (src/lib/catalog/quiz-grading.ts): a choice question is always
 * graded, a free text question only with an expected answer. The review says
 * "x of y right" with the same y, so the percentage can be followed. A
 * submission can also hold a score without any stored answer (older or seeded
 * data); the review then says so instead of showing empty questions.
 */

import {
  isQuestionGradable,
  isTextQuestion,
  quizScore,
  textAnswerMatches,
} from '@/lib/catalog/quiz-grading';

export type ReviewQuestionInput = {
  questionType: string;
  expectedAnswer: string | null;
  options: Array<{ id: string; isCorrect: boolean }>;
  selectedOptionId: string | null;
  textAnswer: string | null;
};

/**
 * `unanswered`: nothing is stored for the question. `ungraded`: a free text
 * answer without an expected answer, neither right nor wrong.
 */
export type QuestionResult = 'correct' | 'wrong' | 'unanswered' | 'ungraded';

export function questionResult(q: ReviewQuestionInput): QuestionResult {
  if (isTextQuestion(q)) {
    const given = q.textAnswer?.trim() ? q.textAnswer : null;
    if (given === null) return 'unanswered';
    if (!isQuestionGradable(q)) return 'ungraded';
    return textAnswerMatches(given, q.expectedAnswer as string)
      ? 'correct'
      : 'wrong';
  }
  if (!q.selectedOptionId) return 'unanswered';
  const chosen = q.options.find(o => o.id === q.selectedOptionId);
  return chosen?.isCorrect ? 'correct' : 'wrong';
}

export type QuizReviewSummary = {
  /** Questions of the quiz. */
  questionCount: number;
  /** Questions that count for the percentage. */
  gradableCount: number;
  /** Questions with a stored answer. */
  answeredCount: number;
  /** Graded questions answered right. */
  correctCount: number;
  /** The percentage these answers give, null when no question is graded. */
  computedScore: number | null;
};

export function summarizeQuizReview(
  questions: ReviewQuestionInput[]
): QuizReviewSummary {
  let gradableCount = 0;
  let answeredCount = 0;
  let correctCount = 0;
  for (const q of questions) {
    const result = questionResult(q);
    if (result !== 'unanswered') answeredCount += 1;
    if (isQuestionGradable(q)) gradableCount += 1;
    if (result === 'correct') correctCount += 1;
  }
  return {
    questionCount: questions.length,
    gradableCount,
    answeredCount,
    correctCount,
    computedScore: quizScore(correctCount, gradableCount),
  };
}
