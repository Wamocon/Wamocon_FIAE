import { catalogFromSearch, withCatalogInUrl } from '@/lib/catalog/tabs';

/**
 * Full page reload. Kept in its own module so tests can replace it (jsdom does
 * not implement navigation). After a change of the occupation the page loads
 * again, so no component keeps data of the previous occupation.
 */
export function reloadPage(): void {
  window.location.reload();
}

/**
 * Leave the page for another one with a full page load (also replaceable in
 * tests). Used after a change of the occupation on the occupation choice page,
 * so the destination starts with the new occupation and clean data.
 */
export function navigateTo(url: string): void {
  window.location.assign(url);
}

/**
 * Name the occupation of a tab in the URL of the page: a new history entry, so
 * the back button returns to the previous occupation. If the current URL names
 * no occupation yet, it gets the previous one first (replace), otherwise back
 * would lead to an address that means "whatever is stored".
 */
export function pushCatalogUrl(previous: string | null, next: string): void {
  const { pathname, search, hash } = window.location;
  if (previous && !catalogFromSearch(search)) {
    window.history.replaceState(
      window.history.state,
      '',
      withCatalogInUrl(pathname, search, previous, hash)
    );
  }
  window.history.pushState(
    null,
    '',
    withCatalogInUrl(pathname, search, next, hash)
  );
}
