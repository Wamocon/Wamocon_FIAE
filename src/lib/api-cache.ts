/**
 * API Response Caching Utility
 * Implements in-memory caching for API responses to reduce database load
 */

interface CacheEntry<T> {
  data: T;
  timestamp: number;
}

class ApiCache {
  private cache: Map<string, CacheEntry<any>> = new Map();
  private readonly defaultTTL = 2 * 60 * 1000; // 2 minutes default

  /**
   * Get cached data if available and not expired
   */
  get<T>(key: string, ttl: number = this.defaultTTL): T | null {
    const entry = this.cache.get(key);
    if (!entry) return null;

    const age = Date.now() - entry.timestamp;
    if (age > ttl) {
      this.cache.delete(key);
      return null;
    }

    return entry.data;
  }

  /**
   * Store data in cache
   */
  set<T>(key: string, data: T): void {
    this.cache.set(key, {
      data,
      timestamp: Date.now(),
    });
  }

  /**
   * Clear specific key or all cache
   */
  clear(key?: string): void {
    if (key) {
      this.cache.delete(key);
    } else {
      this.cache.clear();
    }
  }

  /**
   * Get or fetch data with caching
   */
  async getOrFetch<T>(
    key: string,
    fetcher: () => Promise<T>,
    ttl: number = this.defaultTTL
  ): Promise<T> {
    const cached = this.get<T>(key, ttl);
    if (cached !== null) {
      return cached;
    }

    const data = await fetcher();
    this.set(key, data);
    return data;
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
