/**
 * Full page reload. Kept in its own module so tests can replace it (jsdom does
 * not implement navigation). After a change of the occupation the page loads
 * again, so no component keeps data of the previous occupation.
 */
export function reloadPage(): void {
  window.location.reload();
}
