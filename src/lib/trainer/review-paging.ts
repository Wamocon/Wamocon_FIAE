/**
 * Paging of the open review lists of a trainer (WMCNL-2999). The lists used to
 * answer with every row (lessons, use cases) or with a hard cut at 200 rows
 * (quizzes) and no hint that more existed: the dashboard counted 2158 open
 * reviews while the page showed 200 and ended. Now every list answers one page
 * together with the total of the same filter, and the page loads more on
 * request. The size of a page is bounded on the server, so no request can ask
 * for an unlimited list.
 */

/** Rows of the first page and of every following page. */
export const REVIEWS_PAGE_SIZE = 50;
/** The most rows one request may ask for. */
export const REVIEWS_MAX_PAGE_SIZE = 100;

export type ReviewPaging = { limit: number; offset: number };

function positiveInt(value: string | null): number | null {
  if (value === null || !/^\d{1,9}$/.test(value.trim())) return null;
  return Number(value.trim());
}

/**
 * limit and offset from a query string: whole numbers only, a limit between 1
 * and REVIEWS_MAX_PAGE_SIZE (default REVIEWS_PAGE_SIZE), an offset of 0 or more
 * (default 0). Anything else falls back to the default instead of failing.
 */
export function parsePaging(params: URLSearchParams): ReviewPaging {
  const limit = positiveInt(params.get('limit'));
  const offset = positiveInt(params.get('offset'));
  return {
    limit:
      limit === null || limit < 1
        ? REVIEWS_PAGE_SIZE
        : Math.min(limit, REVIEWS_MAX_PAGE_SIZE),
    offset: offset ?? 0,
  };
}

/** The status filter of the lessons and use cases list. */
export type ReviewStatusFilter = 'pending' | 'all' | 'approved' | 'rejected';

/**
 * The status the list is limited to, from `status` (pending, all, approved,
 * rejected) or, for the old links of the dashboard, from `onlyPending`.
 * Without either the list is not limited.
 */
export function parseStatusFilter(params: URLSearchParams): ReviewStatusFilter {
  const status = params.get('status');
  if (
    status === 'pending' ||
    status === 'all' ||
    status === 'approved' ||
    status === 'rejected'
  ) {
    return status;
  }
  return params.get('onlyPending') === 'true' ? 'pending' : 'all';
}

/** The kind of quiz a quiz list is limited to, null for every kind. */
export function parseQuizType(
  params: URLSearchParams
): 'LESSON' | 'GLOBAL' | null {
  const type = params.get('quizType');
  return type === 'LESSON' || type === 'GLOBAL' ? type : null;
}

/** Longest search text the quiz list takes. */
export const MAX_SEARCH_LENGTH = 100;

/** The search text of a list, trimmed and bounded; null when there is none. */
export function parseSearch(params: URLSearchParams): string | null {
  const raw = params.get('q');
  if (!raw) return null;
  const text = raw.trim().slice(0, MAX_SEARCH_LENGTH);
  return text === '' ? null : text;
}
