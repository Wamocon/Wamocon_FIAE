import { useSyncExternalStore } from 'react';
import { authFetch } from '@/lib/authFetch';
import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { consumePrefetch } from '@/lib/prefetch';
import {
  getCatalogHeader,
  getServerCatalogSelection,
  isCatalogPending,
  subscribeCatalogSelection,
} from '@/lib/catalog/selection';

/**
 * Query key of an API url. A user with several occupations gets the occupation
 * in the key, so the data of one occupation never comes from the cache for
 * another. A user with a single occupation keeps the plain key `[url]`. Use it
 * for setQueryData (exact key), invalidateQueries([url]) also finds the keys
 * with an occupation (prefix match).
 */
export function apiQueryKey(
  url: string,
  catalog: string | null = getCatalogHeader()
): readonly unknown[] {
  return catalog ? [url, { catalog }] : [url];
}

/**
 * Thin wrapper around `useQuery` for API route fetching.
 *
 * @param url    – API URL string, or `null` to disable the query.
 * @param opts   – Extra query options + `usePrefetch` flag.
 *
 * Usage:
 * ```ts
 * const { data, isLoading, error } = useApiQuery<MyType>(
 *   userId ? `/api/items?userId=${userId}` : null,
 *   { usePrefetch: true },
 * );
 * ```
 */
export function useApiQuery<T>(
  url: string | null,
  opts?: Omit<UseQueryOptions<T, Error>, 'queryKey' | 'queryFn'> & {
    /** Try to consume a response that was prefetched in AuthContext */
    usePrefetch?: boolean;
  }
) {
  const { usePrefetch = false, ...queryOptions } = opts ?? {};
  const catalog = useSyncExternalStore(
    subscribeCatalogSelection,
    getCatalogHeader,
    () => getServerCatalogSelection().header
  );
  // The occupations are still loading and a choice is stored: wait, so the
  // request is not made for the wrong occupation (and under the wrong key).
  const pending = useSyncExternalStore(
    subscribeCatalogSelection,
    isCatalogPending,
    () => getServerCatalogSelection().pending
  );

  return useQuery<T, Error>({
    queryKey: url ? apiQueryKey(url, catalog) : ['__disabled__'],
    queryFn: async () => {
      if (!url) throw new Error('No URL provided');

      // If AuthContext already fired a prefetch for this URL, consume it
      // instead of making a duplicate request. Not with an occupation: the
      // prefetch may have started before the occupation was known.
      if (usePrefetch && !catalog) {
        const prefetched = await consumePrefetch<T>(url);
        if (prefetched) return prefetched;
      }

      const res = await authFetch(url, { cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`API ${res.status}: ${text}`);
      }
      return res.json();
    },
    ...queryOptions,
    enabled: pending ? false : (queryOptions.enabled ?? !!url),
  });
}
