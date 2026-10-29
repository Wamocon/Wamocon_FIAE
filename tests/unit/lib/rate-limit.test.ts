import { describe, it, expect, beforeEach } from '@jest/globals';
import { checkRateLimit, getClientIp, resetRateLimits } from '@/lib/rate-limit';

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

  it('a flood of new keys drops the oldest ones, not the counters of everybody', () => {
    const strict = { limit: 1, windowMs: 1_000_000 };
    // a victim whose counter is the newest of all
    for (let i = 0; i < 4999; i++) checkRateLimit(`old-${i}`, strict, 0);
    checkRateLimit('victim', strict, 0);
    expect(checkRateLimit('victim', strict, 1).allowed).toBe(false);
    // an attacker adds keys until the map overflows
    for (let i = 0; i < 600; i++) checkRateLimit(`flood-${i}`, strict, 2);
    // the oldest keys went, the victim is still counted
    expect(checkRateLimit('old-0', strict, 3).allowed).toBe(true);
    expect(checkRateLimit('victim', strict, 3).allowed).toBe(false);
  });

  it('reads the client address from proxy headers', () => {
    const headers = (map: Record<string, string>) => ({
      get: (name: string) => map[name] ?? null,
    });
    expect(
      getClientIp(headers({ 'x-forwarded-for': '1.2.3.4, 5.6.7.8' }))
    ).toBe('1.2.3.4');
    expect(getClientIp(headers({ 'x-real-ip': '9.9.9.9' }))).toBe('9.9.9.9');
    expect(getClientIp(headers({}))).toBe('unknown');
  });
});
