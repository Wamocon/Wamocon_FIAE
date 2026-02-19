/**
 * API Response Caching Utility
 *
 * Uses Next.js Data Cache (`unstable_cache`) so cached data persists across
 * serverless invocations, container restarts, and multiple replicas.
 *
 * The external API (`apiCache.getOrFetch`, `ApiCache.TTL`, `cacheHeaders`)
 * remains unchanged — no route-level changes required.
 */

import { unstable_cache, revalidateTag } from 'next/cache';

export class ApiCache {
  /** Pre-defined TTL durations (milliseconds – kept for backward compat) */
  static readonly TTL = {
    SHORT: 2 * 60 * 1000, // 2 minutes - for frequently changing data
    MEDIUM: 5 * 60 * 1000, // 5 minutes - default, for dashboards
    LONG: 15 * 60 * 1000, // 15 minutes - for rarely changing data (courses, skills)
    EXTRA_LONG: 30 * 60 * 1000, // 30 minutes - for static lookups (lernfelder, criteria)
  };

  /**
   * Derive a resource tag from a cache key.
   * e.g. "trainee_dashboard_abc-123" → "trainee_dashboard"
   *      "trainer_quizzes_xyz__2025" → "trainer_quizzes"
   */
  private getResourceTag(key: string): string {
    const parts = key.split('_');
    return parts.length >= 2 ? `${parts[0]}_${parts[1]}` : key;
  }

  /**
   * Get or fetch data with caching via Next.js Data Cache.
   *
   * @param key    - Unique cache key (e.g. `trainee_dashboard_${userId}`)
   * @param fetcher - Async function that produces the data
   * @param ttlMs  - Time-to-live in **milliseconds** (converted to seconds internally)
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttlMs: number = ApiCache.TTL.MEDIUM
  ): Promise<T> {
    const revalidate = Math.max(1, Math.floor(ttlMs / 1000));
    const tag = this.getResourceTag(key);

    const cachedFn = unstable_cache(fetcher, [key], {
      revalidate,
      tags: [tag],
    });

    return cachedFn();
  }

  /**
   * Invalidate all cache entries that share a resource tag.
   * Call after mutations so the next GET returns fresh data.
   *
   * @example apiCache.invalidate('trainer_quizzes');
   */
  invalidate(tag: string): void {
    revalidateTag(tag);
  }
}

// Singleton instance
export const apiCache = new ApiCache();

/**
 * Cache control headers for API responses
 */
export const cacheHeaders = {
  /**
   * Cache for 2 minutes, allow stale for 5 minutes while revalidating
   */
  short: {
    'Cache-Control': 'public, s-maxage=120, stale-while-revalidate=300',
  },
  /**
   * Cache for 5 minutes, allow stale for 10 minutes while revalidating
   */
  medium: {
    'Cache-Control': 'public, s-maxage=300, stale-while-revalidate=600',
  },
  /**
   * Cache for 15 minutes, allow stale for 30 minutes while revalidating
   */
  long: {
    'Cache-Control': 'public, s-maxage=900, stale-while-revalidate=1800',
  },
  /**
   * No caching (for mutations or sensitive data)
   */
  none: {
    'Cache-Control': 'no-store, no-cache, must-revalidate',
  },
};
