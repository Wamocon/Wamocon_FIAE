/**
 * Helpers for the occupation (catalog) on the client side. Pure functions, no
 * server imports, so pages and components can use them.
 */

/** Occupation codes are short upper case keys such as FIAE or KFBM. */
const CATALOG_CODE = /^[A-Z0-9_-]{2,16}$/;

/**
 * Occupation code from untrusted input (a query parameter): trimmed and upper
 * case if it has the shape of a code, otherwise undefined. Anything else, also
 * a repeated parameter (an array), never reaches the page or an API call.
 */
export function normalizeCatalogCode(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const code = value.trim().toUpperCase();
  return CATALOG_CODE.test(code) ? code : undefined;
}
