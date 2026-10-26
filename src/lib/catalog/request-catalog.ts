/**
 * Occupation (catalog) in the requests of a page. Pure functions, no server
 * imports, so pages and components can use them.
 *
 * The public lists (/api/training-components, /api/training-use-cases) name the
 * occupation in the URL (`?catalog=CODE`) and serve FIAE without it. A page
 * therefore adds the parameter only for another occupation, so the requests of
 * a FIAE user stay exactly as they were.
 */

import { normalizeCatalogCode } from '@/lib/catalog/client';

/** The occupation a request without a catalog parameter gets. */
export const DEFAULT_CATALOG_CODE = 'FIAE';

/**
 * `url` with `catalog=CODE` appended, unless the occupation is the default one,
 * unknown or not a valid code, or the url already names a catalog.
 */
export function withCatalogParam(
  url: string,
  catalog: string | null | undefined
): string {
  const code = normalizeCatalogCode(catalog);
  if (!code || code === DEFAULT_CATALOG_CODE) return url;
  if (/[?&]catalog=/.test(url)) return url;
  return `${url}${url.includes('?') ? '&' : '?'}catalog=${encodeURIComponent(code)}`;
}
