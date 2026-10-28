/**
 * Occupation tabs (one tab per training) on the content and list pages of
 * trainer level users and of trainees with more than one enrollment. Pure
 * functions without server or React imports.
 *
 * The chosen occupation is part of the URL (`?catalog=CODE`), so the page can
 * be shared and the back button works. Order of precedence for the occupation
 * a user works in:
 *
 *   1. the code in the URL, if it is one of the tab occupations,
 *   2. the choice stored in the browser (comfort only, same check),
 *   3. the default of the server (platform default, FIAE first),
 *   4. the first tab occupation.
 *
 * Every value that does not name a tab occupation is dropped (fail closed to
 * the next rule). The server checks the code again against the scope of the
 * session, nothing here widens a right.
 */

import { normalizeCatalogCode } from '@/lib/catalog/client';

/** Name of the query parameter, same as CATALOG_QUERY_PARAM on the server. */
export const CATALOG_TAB_PARAM = 'catalog';

/**
 * Pages that show the tabs: lists and dashboards whose content depends on the
 * occupation. Exact paths, so a detail page of a record (which belongs to one
 * occupation) never offers a switch that would end in "not found".
 */
export const CATALOG_TAB_PATHS: readonly string[] = [
  '/trainer/dashboard',
  '/trainer/content-management',
  '/trainer/quiz-management',
  '/trainer/trainees',
  '/trainer/reviews',
  '/trainer/evaluations',
  '/trainer/calendar',
  '/trainer/school',
  '/trainer/activity-reports',
  '/trainer/activity-reports/arbeitszeugnis',
  // The trainee area: the pages whose content depends on the training. A
  // trainee with several enrollments picks one with the same tabs, only
  // among the own enrollments (the server checks it again). The detail pages
  // (a quiz, a use case) belong to one training and show no tabs.
  '/trainee/dashboard',
  '/trainee/courses',
  '/trainee/quizzes',
  '/trainee/school',
  '/trainee/activity-reports',
];

export function isCatalogTabPath(pathname: string | null | undefined): boolean {
  if (!pathname) return false;
  const path =
    pathname.length > 1 && pathname.endsWith('/')
      ? pathname.slice(0, -1)
      : pathname;
  return CATALOG_TAB_PATHS.includes(path);
}

/** Occupation code of a query string (`?catalog=kfbm`), or null. */
export function catalogFromSearch(
  search: string | null | undefined
): string | null {
  if (!search) return null;
  const values = new URLSearchParams(search).getAll(CATALOG_TAB_PARAM);
  // a repeated parameter is ambiguous: ignore it
  if (values.length !== 1) return null;
  return normalizeCatalogCode(values[0]) ?? null;
}

/** `pathname` and `search` with `catalog=CODE` set, other parameters kept. */
export function withCatalogInUrl(
  pathname: string,
  search: string | null | undefined,
  code: string,
  hash = ''
): string {
  const params = new URLSearchParams(search ?? '');
  params.set(CATALOG_TAB_PARAM, normalizeCatalogCode(code) ?? code);
  return `${pathname}?${params.toString()}${hash}`;
}

/**
 * The occupation to work in among the tab occupations `codes`. Unchecked
 * values (URL, storage, server) only count if they are one of `codes`.
 */
export function pickTabCatalog(input: {
  codes: readonly string[];
  fromUrl?: string | null;
  stored?: string | null;
  serverActive?: string | null;
}): string | null {
  const ok = (code: string | null | undefined) =>
    !!code && input.codes.includes(code) ? code : null;
  return (
    ok(input.fromUrl) ??
    ok(input.stored) ??
    ok(input.serverActive) ??
    input.codes[0] ??
    null
  );
}
