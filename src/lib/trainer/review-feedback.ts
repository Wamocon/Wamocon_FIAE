/**
 * Whether a review carries a feedback for the trainee (WMCNL-3000). A use case
 * could be rejected with an empty feedback field: the trainee saw "rejected"
 * and nothing about what to improve. A rejection now needs a feedback, on the
 * server and on the page, and both ask this one function.
 *
 * A feedback is a text with a visible character, or, for a lesson with several
 * scenarios, at least one such text among the feedbacks per scenario.
 */

const hasText = (value: unknown): boolean =>
  typeof value === 'string' && value.trim() !== '';

export function hasReviewFeedback(
  trainerFeedback: unknown,
  feedbacks?: unknown
): boolean {
  if (hasText(trainerFeedback)) return true;
  return (
    Array.isArray(feedbacks) &&
    feedbacks.some(f => hasText((f as { feedback?: unknown } | null)?.feedback))
  );
}

/** The code of the 400 answer when a rejection comes without a feedback. */
export const FEEDBACK_REQUIRED = 'FEEDBACK_REQUIRED';
