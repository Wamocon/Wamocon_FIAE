/**
 * The tab of the review page the card "Offene Reviews" of the dashboard opens.
 * Client safe (no database), the filters of the counts are in pending-reviews.ts.
 */

export type ReviewView = 'enablers' | 'usecases' | 'quizzes';

/**
 * The tab of the review page the card of the dashboard opens: the first one
 * that has something to review (the page itself opens on the enablers, which
 * can be empty while quizzes wait).
 */
export function reviewViewFor(counts: {
  pendingEnablers?: number;
  pendingUseCases?: number;
  pendingQuiz?: number;
}): ReviewView {
  if ((counts.pendingEnablers ?? 0) > 0) return 'enablers';
  if ((counts.pendingUseCases ?? 0) > 0) return 'usecases';
  if ((counts.pendingQuiz ?? 0) > 0) return 'quizzes';
  return 'enablers';
}
