import { useQuery, type UseQueryOptions } from '@tanstack/react-query';
import { consumePrefetch } from '@/lib/prefetch';

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

  return useQuery<T, Error>({
    queryKey: url ? [url] : ['__disabled__'],
    queryFn: async () => {
      if (!url) throw new Error('No URL provided');

      // If AuthContext already fired a prefetch for this URL, consume it
      // instead of making a duplicate request.
      if (usePrefetch) {
        const prefetched = await consumePrefetch<T>(url);
        if (prefetched) return prefetched;
      }

      const res = await fetch(url, { cache: 'no-store' });
      if (!res.ok) {
        const text = await res.text().catch(() => '');
        throw new Error(`API ${res.status}: ${text}`);
      }
      return res.json();
    },
    enabled: !!url,
    ...queryOptions,
  });
}
