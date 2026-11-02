/**
 * The order of the global quizzes in the quiz management: by the number in the
 * title (K1, K2, K6.1, K10, K25.2), numeric and not as plain text, so K2 comes
 * before K10. The list used to come as the database returned it (last changed
 * first), so the quizzes stood as K11, K25.2, K1, K6.1. Pure, no imports.
 */

// numeric: "2" < "10", base: case and accents do not decide
const natural = new Intl.Collator('de', { numeric: true, sensitivity: 'base' });

export function sortQuizzesByNumber<T extends { title?: string | null }>(
  quizzes: readonly T[]
): T[] {
  return [...quizzes].sort((a, b) =>
    natural.compare((a.title ?? '').trim(), (b.title ?? '').trim())
  );
}
