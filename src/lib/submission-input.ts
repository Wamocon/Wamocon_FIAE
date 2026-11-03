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

/** Longest address of a link of a hand-in (browsers cope with about 2000). */
export const MAX_LINK_URL_LENGTH = 2000;

/** Code of the 400 answer of a route for a link that is no http or https address. */
export const INVALID_LINK_CODE = 'INVALID_LINK';

/**
 * true when the value is a usable link of a hand-in: an http or https address
 * with a host, no white space inside and not longer than MAX_LINK_URL_LENGTH.
 * Leading and trailing white space is ignored (the route stores the trimmed
 * value). An empty value is not a link, the caller skips empty rows.
 */
export function isValidLinkUrl(value: unknown): boolean {
  if (typeof value !== 'string') return false;
  const url = value.trim();
  if (url === '' || url.length > MAX_LINK_URL_LENGTH) return false;
  if (/\s/.test(url)) return false;
  try {
    const parsed = new URL(url);
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:') &&
      parsed.hostname !== ''
    );
  } catch {
    return false;
  }
}

/**
 * Index of the first link row with an address that is no valid link, or -1.
 * Rows without an address are skipped (an empty row is no link).
 */
export function firstInvalidLinkIndex(links: unknown): number {
  if (!Array.isArray(links)) return -1;
  return links.findIndex(l => {
    if (typeof l !== 'object' || l === null) return false;
    const url = (l as { url?: unknown }).url;
    return hasText(url) && !isValidLinkUrl(url);
  });
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
