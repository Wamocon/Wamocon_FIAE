'use client';

import { useCallback } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useCatalog } from '@/contexts/CatalogContext';
import { authFetch } from '@/lib/authFetch';
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
 * A user with several occupations chooses one in the switcher (CatalogContext).
 * GET /api/me/catalogs is asked without the choice, so its `activeCode` is only
 * the default of the server. The choice of the context wins as soon as it is
 * known, and `ready` waits for it, otherwise a trainer who chose KfBM would
 * get the FIAE lists. Without a provider the context is neutral and only the
 * answer of the server counts.
 *
 * The answer belongs to ONE user, so the id of the user is part of the query
 * key. A key made of the url alone would hand the answer of the previous user
 * to the next one who signs in within the same tab (the cache survives a
 * sign-out), and a KfBM trainee would get FIAE lists.
 *
 * @param userId id of the signed-in user, nothing (null or undefined) until then
 */
export function useRequestCatalog(userId: string | null | undefined) {
  const query = useQuery<MeCatalogs, Error>({
    queryKey: ['me-catalogs', userId ?? null],
    queryFn: async () => {
      const res = await authFetch('/api/me/catalogs', { cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`API ${res.status}: ${text}`);
      }
      return res.json();
    },
    enabled: !!userId,
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
  const { status: catalogStatus, activeCode: chosenCode } = useCatalog();
  const ready =
    (query.isSuccess || query.isError) && catalogStatus !== 'loading';
  const catalog =
    (catalogStatus === 'ready' ? chosenCode : null) ??
    query.data?.activeCode ??
    undefined;
  const withCatalog = useCallback(
    (url: string) => withCatalogParam(url, catalog),
    [catalog]
  );
  return { ready, catalog, withCatalog };
}
