import { describe, it, expect, beforeEach, afterEach } from '@jest/globals';
import { getSupabasePublicKey, getSupabaseSecretKey } from '@/lib/env';

const NAMES = [
  'SUPABASE_SECRET_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
] as const;

describe('lib/env supabase keys', () => {
  const saved: Record<string, string | undefined> = {};

  beforeEach(() => {
    for (const n of NAMES) {
      saved[n] = process.env[n];
      delete process.env[n];
    }
  });

  afterEach(() => {
    for (const n of NAMES) {
      if (saved[n] === undefined) delete process.env[n];
      else process.env[n] = saved[n];
    }
  });

  it('reads the secret key from the new or the old name', () => {
    expect(getSupabaseSecretKey()).toBeUndefined();
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'legacy-secret';
    expect(getSupabaseSecretKey()).toBe('legacy-secret');
    process.env.SUPABASE_SECRET_KEY = 'sb_secret_test';
    expect(getSupabaseSecretKey()).toBe('sb_secret_test');
  });

  it('reads the public key from the new or the old name', () => {
    expect(getSupabasePublicKey()).toBeUndefined();
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'legacy-public';
    expect(getSupabasePublicKey()).toBe('legacy-public');
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY = 'sb_publishable_test';
    expect(getSupabasePublicKey()).toBe('sb_publishable_test');
  });

  it('treats empty values as unset', () => {
    process.env.SUPABASE_SECRET_KEY = '';
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'fallback';
    expect(getSupabaseSecretKey()).toBe('fallback');
  });
});
