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
