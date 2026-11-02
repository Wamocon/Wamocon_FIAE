/**
 * What counts as content of a hand-in of a trainee (summary of an enabler, use
 * case). Pure functions, shared by the routes and the pages so both sides
 * answer the same: only white space is no content.
 */

/** true when the value is a text with at least one visible character. */
export const hasText = (value: unknown): boolean =>
  typeof value === 'string' && value.trim() !== '';

/**
 * The summary of an enabler has content when the legacy single text or at
 * least one entry of the list of solutions holds a text.
 */
export function enablerSubmissionHasContent(input: {
  solutionText?: unknown;
  solutions?: unknown;
}): boolean {
  if (hasText(input.solutionText)) return true;
  return (
    Array.isArray(input.solutions) &&
    input.solutions.some(
      s =>
        typeof s === 'object' &&
        s !== null &&
        hasText((s as { text?: unknown }).text)
    )
  );
}

/**
 * The hand-in of a use case has content when it has a text, a link with an
 * address or a file. The file is a fact of the storage, the caller passes it.
 */
export function handInOfUseCaseHasContent(input: {
  submissionText?: unknown;
  links?: unknown;
  hasFile?: boolean;
}): boolean {
  if (input.hasFile) return true;
  if (hasText(input.submissionText)) return true;
  return (
    Array.isArray(input.links) &&
    input.links.some(
      l =>
        typeof l === 'object' &&
        l !== null &&
        hasText((l as { url?: unknown }).url)
    )
  );
}

/** Code of the 400 answer of a route for a hand-in without content. */
export const EMPTY_SUBMISSION_CODE = 'EMPTY_SUBMISSION';

/**
 * The weekly report (Ausbildungsnachweis) has content when it has at least one
 * entry with hours. A report without entries, or only with entries of 0 hours,
 * is nothing the trainer could check.
 */
export function activityReportHasContent(entries: unknown): boolean {
  return (
    Array.isArray(entries) &&
    entries.some(
      e =>
        typeof e === 'object' &&
        e !== null &&
        Number((e as { actualHours?: unknown }).actualHours) > 0
    )
  );
}
