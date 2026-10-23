'use client';

import { useCallback } from 'react';
import { useApiQuery } from '@/lib/hooks/useApiQuery';
import { withCatalogParam } from '@/lib/catalog/request-catalog';

type MeCatalogs = { activeCode?: string | null };

/**
 * The occupation to name in requests of the public lists. It is the active
 * occupation of the signed-in user from GET /api/me/catalogs (a trainee: the
 * enrolled occupation). `withCatalog` adds `?catalog=CODE` only for an
 * occupation other than the default one, so FIAE urls stay unchanged.
 *
 * `ready` turns true once the answer is known (also if the lookup failed, then
 * the urls stay plain, as before the occupations). Wait for it before the first
 * request, otherwise a KfBM user would briefly get FIAE lists.
 *
 * @param enabled false until the user is signed in
 */
export function useRequestCatalog(enabled = true) {
  const query = useApiQuery<MeCatalogs>(enabled ? '/api/me/catalogs' : null, {
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const ready = query.isSuccess || query.isError;
  const catalog = query.data?.activeCode ?? undefined;
  const withCatalog = useCallback(
    (url: string) => withCatalogParam(url, catalog),
    [catalog]
  );
  return { ready, catalog, withCatalog };
}
