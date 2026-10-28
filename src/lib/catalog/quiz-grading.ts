/**
 * The ONE distinction between a quiz question that can be graded and one that
 * cannot. This module is pure (no database, no server imports).
 *
 * Rule (decision of the owner, 28.10.2026): a free text question without an
 * expected answer has no solution to compare with. It is NOT graded: it is
 * neither counted as right nor as wrong, it is taken out of the numerator and
 * the denominator of the percentage, and it does not count for passing. A quiz
 * made only of such questions is not automatically gradable: it has no score
 * and is never a prerequisite of anything (see progression.ts).
 *
 * A choice question is always gradable. Its behaviour does not change.
 *
 * Two places use this and must not drift apart: the grading of a submission
 * (src/app/api/trainee/quizzes/[quizId]/submit/route.ts) and the definition of
 * "enabler completed" (src/lib/catalog/progression.ts with the loader in
 * src/lib/catalog/progression-db.ts).
 */

export interface GradingQuestion {
  questionType?: string | null;
  expectedAnswer?: string | null;
  /**
   * Whether the question has a non blank expected answer, for a caller that
   * must not load the text itself (the order of work only asks for the fact,
   * the expected answer never leaves the database layer). When given, it wins
   * over expectedAnswer.
   */
  hasExpectedAnswer?: boolean;
}

/**
 * The same "not blank" test for a database that cannot run JavaScript: a
 * Postgres (ARE) pattern that matches a text with at least one character that
 * String.prototype.trim does not remove. progression-db.ts uses it so that the
 * order of work and the grading of a submission never disagree on whether an
 * expected answer exists (a text of only NBSP or a byte order mark is blank
 * for both).
 */
export const NON_BLANK_SQL_PATTERN =
  '[^\\t\\n\\v\\f\\r \\u00a0\\u1680\\u2000-\\u200a\\u2028\\u2029\\u202f\\u205f\\u3000\\ufeff]';

/** True for a free text question. Everything else is a choice question. */
export function isTextQuestion(question: GradingQuestion): boolean {
  return question.questionType === 'TEXT';
}

/**
 * True when the question has a solution to grade against: a choice question
 * always, a free text question only with a non blank expected answer.
 */
export function isQuestionGradable(question: GradingQuestion): boolean {
  if (!isTextQuestion(question)) return true;
  if (typeof question.hasExpectedAnswer === 'boolean') {
    return question.hasExpectedAnswer;
  }
  return (
    typeof question.expectedAnswer === 'string' &&
    question.expectedAnswer.trim() !== ''
  );
}

/** How many of the questions are graded. */
export function gradableCountOf(
  questions: ReadonlyArray<GradingQuestion>
): number {
  return questions.filter(isQuestionGradable).length;
}

/** True when at least one question can be graded. */
export function hasGradableQuestion(
  questions: ReadonlyArray<GradingQuestion>
): boolean {
  return questions.some(isQuestionGradable);
}

/** A typed answer against the expected one: trimmed, case-insensitive. */
export function textAnswerMatches(given: string, expected: string): boolean {
  return given.trim().toLowerCase() === expected.trim().toLowerCase();
}

/**
 * The percentage of the graded questions, rounded. null when no question was
 * graded: the quiz is not automatically gradable and has no score.
 */
export function quizScore(
  correctCount: number,
  gradableCount: number
): number | null {
  if (gradableCount <= 0) return null;
  return Math.round((correctCount / gradableCount) * 100);
}

/** The ids of the quizzes that have at least one gradable question. */
export function quizIdsWithGradableQuestion(
  rows: ReadonlyArray<GradingQuestion & { quizId: unknown }>
): Set<string> {
  const ids = new Set<string>();
  for (const row of rows) {
    if (isQuestionGradable(row)) ids.add(String(row.quizId));
  }
  return ids;
}
