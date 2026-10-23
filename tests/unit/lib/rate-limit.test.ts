import { describe, it, expect, beforeEach } from '@jest/globals';
import {
  checkRateLimit,
  getClientIp,
  resetRateLimits,
} from '@/lib/rate-limit';

describe('rate-limit', () => {
  const options = { limit: 2, windowMs: 1000 };

  beforeEach(() => resetRateLimits());

  it('allows requests up to the limit and then blocks', () => {
    expect(checkRateLimit('k', options, 0)).toMatchObject({
      allowed: true,
      remaining: 1,
    });
    expect(checkRateLimit('k', options, 10)).toMatchObject({
      allowed: true,
      remaining: 0,
    });
    const blocked = checkRateLimit('k', options, 20);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSec).toBe(1);
  });

  it('resets after the window has passed', () => {
    checkRateLimit('k', options, 0);
    checkRateLimit('k', options, 1);
    expect(checkRateLimit('k', options, 500).allowed).toBe(false);
    expect(checkRateLimit('k', options, 1001).allowed).toBe(true);
  });

  it('tracks keys independently', () => {
    checkRateLimit('a', options, 0);
    checkRateLimit('a', options, 0);
    expect(checkRateLimit('a', options, 0).allowed).toBe(false);
    expect(checkRateLimit('b', options, 0).allowed).toBe(true);
  });

  it('reads the client address from proxy headers', () => {
    const headers = (map: Record<string, string>) => ({
      get: (name: string) => map[name] ?? null,
    });
    expect(getClientIp(headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))).toBe(
      '1.2.3.4'
    );
    expect(getClientIp(headers({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
    expect(getClientIp(headers({}))).toBe('unknown');
  });
});
