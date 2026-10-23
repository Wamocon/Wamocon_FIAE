/**
 * Catalog selection for the public (anonymous) lists. There is no session, so
 * the caller can only choose among active catalogs by code (query parameter
 * `catalog`, default FIAE). The catalog code is part of the URL and therefore
 * of the CDN cache key; the response also names it in `X-Catalog` and
 * `Vary`, so shared caches never mix catalogs.
 */

import { sql } from 'drizzle-orm';
import db from '@/db';
import { trainingCatalogs } from '@/db/migrations/schemas/schema';
import { withDbRetry } from '@/lib/db-retry';
import {
  CATALOG_QUERY_PARAM,
  FIAE_CATALOG_ID,
  type CatalogRequestLike,
} from '@/lib/catalog/scope';

export type PublicCatalog = { id: string; code: string };

/**
 * Active catalog selected by `?catalog=CODE`, the FIAE catalog without a
 * parameter, or null if the code is unknown or the catalog is not active.
 */
export async function resolvePublicCatalog(
  request: CatalogRequestLike
): Promise<PublicCatalog | null> {
  let code: string | null = null;
  if (request.url) {
    try {
      code =
        new URL(request.url, 'http://localhost').searchParams
          .get(CATALOG_QUERY_PARAM)
          ?.trim() || null;
    } catch {
      code = null;
    }
  }

  const rows = (await withDbRetry(() =>
    db
      .select({
        id: trainingCatalogs.id,
        code: trainingCatalogs.code,
        isActive: trainingCatalogs.isActive,
      })
      .from(trainingCatalogs)
      .where(
        code
          ? sql`lower(${trainingCatalogs.code}) = ${code.toLowerCase()}`
          : sql`${trainingCatalogs.id} = ${FIAE_CATALOG_ID}`
      )
      .limit(1)
  )) as { id: string; code: string; isActive: boolean }[];

  const row = rows[0];
  if (!row || row.isActive !== true) return null;
  return { id: String(row.id), code: String(row.code) };
}

/** Headers of a public list response for one catalog. */
export function publicCatalogHeaders(
  catalog: PublicCatalog,
  cacheControl: string
): Record<string, string> {
  return {
    'Cache-Control': cacheControl,
    'X-Catalog': catalog.code,
    Vary: 'X-Catalog',
  };
}
