/**
 * @jest-environment node
 */
import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from '@jest/globals';

// Module under test: GET /auth/callback (src/app/auth/callback/route.ts), the
// link of the confirmation e-mail. It exchanges the token hash and sends the
// person to the login page. The target never comes from the request.

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

const HASH = 'a'.repeat(64);

async function setup(verifyOtp?: jest.Mock) {
  jest.resetModules();
  const verify =
    verifyOtp ??
    (jest.fn() as jest.Mock).mockImplementation(async () => ({
      data: { user: { id: 'u1' }, session: { access_token: 't' } },
      error: null,
    }));
  const supa = await import('@supabase/supabase-js');
  (supa.createClient as jest.Mock).mockReturnValue({
    auth: { verifyOtp: verify },
  });
  const mod = await import('@/app/auth/callback/route');
  return {
    GET: mod.GET as (req: Request) => Promise<Response>,
    verify,
    createClient: supa.createClient as jest.Mock,
  };
}

function get(query: string, headers: Record<string, string> = {}) {
  return new Request(`https://fiae-learn.com/auth/callback${query}`, {
    headers: { 'x-forwarded-for': '203.0.113.7', ...headers },
  });
}

describe('GET /auth/callback', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'http://test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_APP_URL = 'https://fiae-learn.com';
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  it('exchanges the token hash and sends the person to the login page with the notice "done"', async () => {
    const { GET, verify, createClient } = await setup();
    const res = await GET(get(`?token_hash=${HASH}&type=email`));

    expect(res.status).toBe(303);
    expect(res.headers.get('location')).toBe(
      'https://fiae-learn.com/login?confirm=done'
    );
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(verify).toHaveBeenCalledWith({ type: 'email', token_hash: HASH });
    // public key, no session kept on the server
    expect(createClient.mock.calls[0][1]).toBe('anon');
    expect((createClient.mock.calls[0][2] as any).auth.persistSession).toBe(
      false
    );
  });

  it('accepts the older type "signup" too', async () => {
    const { GET, verify } = await setup();
    const res = await GET(get(`?token_hash=${HASH}&type=signup`));
    expect(res.headers.get('location')).toBe(
      'https://fiae-learn.com/login?confirm=done'
    );
    expect(verify).toHaveBeenCalledWith({ type: 'signup', token_hash: HASH });
  });

  it('an expired or used link leads to "failed", without the text of Supabase', async () => {
    const verify = (jest.fn() as jest.Mock).mockImplementation(async () => ({
      data: { user: null, session: null },
      error: { message: 'Email link is invalid or has expired', status: 403 },
    }));
    const { GET } = await setup(verify);
    const res = await GET(get(`?token_hash=${HASH}&type=email`));
    expect(res.status).toBe(303);
    const location = res.headers.get('location') as string;
    expect(location).toBe('https://fiae-learn.com/login?confirm=failed');
    expect(location).not.toMatch(/expired|invalid/i);
  });

  it('an exception of the exchange ends in "failed" and is logged', async () => {
    const verify = (jest.fn() as jest.Mock).mockImplementation(async () => {
      throw new Error('network down');
    });
    const { GET } = await setup(verify);
    const res = await GET(get(`?token_hash=${HASH}&type=email`));
    expect(res.headers.get('location')).toBe(
      'https://fiae-learn.com/login?confirm=failed'
    );
    expect(console.error).toHaveBeenCalled();
  });

  describe('no open redirect', () => {
    it.each([
      'https://evil.example',
      '//evil.example',
      '/\\evil.example',
      'javascript:alert(1)',
      '/trainer/dashboard',
      '/login/../x',
      '%2F%2Fevil.example',
    ])('next=%s is ignored, the person lands on the login page', async next => {
      const { GET } = await setup();
      const res = await GET(
        get(`?token_hash=${HASH}&type=email&next=${encodeURIComponent(next)}`)
      );
      expect(res.headers.get('location')).toBe(
        'https://fiae-learn.com/login?confirm=done'
      );
    });

    it('a malformed configured URL does not break the redirect (production address)', async () => {
      process.env.NEXT_PUBLIC_APP_URL = 'not a url';
      (process.env as Record<string, string | undefined>).NODE_ENV =
        'production';
      const { GET } = await setup();
      const res = await GET(
        get(`?token_hash=${HASH}&type=email`, {
          'x-forwarded-host': 'evil.example',
        })
      );
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(
        'https://fiae-learn.com/login?confirm=done'
      );
    });

    it('the redirect stays on the configured origin, whatever Host header arrives', async () => {
      const { GET } = await setup();
      const res = await GET(
        get(`?token_hash=${HASH}&type=email`, {
          'x-forwarded-host': 'evil.example',
          'x-forwarded-proto': 'https',
          host: 'evil.example',
        })
      );
      expect(new URL(res.headers.get('location') as string).origin).toBe(
        'https://fiae-learn.com'
      );
    });
  });

  describe('input that is not a confirmation', () => {
    it.each([
      ['', 'no token at all (for example after Supabase confirmed itself)'],
      [`?type=email`, 'a type without a token'],
      [`?token_hash=${HASH}`, 'a token without a type'],
    ])('%s: neutral notice "check", nothing is exchanged', async query => {
      const { GET, verify } = await setup();
      const res = await GET(get(query));
      expect(res.status).toBe(303);
      expect(res.headers.get('location')).toBe(
        'https://fiae-learn.com/login?confirm=check'
      );
      expect(verify).not.toHaveBeenCalled();
    });

    it.each(['recovery', 'invite', 'magiclink', 'email_change', 'x'])(
      'the type %s is no confirmation of a sign up: "check", nothing is exchanged',
      async type => {
        const { GET, verify } = await setup();
        const res = await GET(get(`?token_hash=${HASH}&type=${type}`));
        expect(res.headers.get('location')).toBe(
          'https://fiae-learn.com/login?confirm=check'
        );
        expect(verify).not.toHaveBeenCalled();
      }
    );

    it.each(['short', '<script>alert(1)</script>', 'a b c d e f g h i j k'])(
      'an implausible token %j is refused before Supabase is asked',
      async token => {
        const { GET, verify } = await setup();
        const res = await GET(
          get(`?token_hash=${encodeURIComponent(token)}&type=email`)
        );
        expect(res.headers.get('location')).toBe(
          'https://fiae-learn.com/login?confirm=failed'
        );
        expect(verify).not.toHaveBeenCalled();
      }
    );
  });

  it('answers "failed" if the server has no Supabase configuration', async () => {
    delete process.env.SUPABASE_URL;
    delete process.env.SUPABASE_URL_INTERNAL;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const { GET, verify } = await setup();
    const res = await GET(get(`?token_hash=${HASH}&type=email`));
    expect(res.headers.get('location')).toBe(
      'https://fiae-learn.com/login?confirm=failed'
    );
    expect(verify).not.toHaveBeenCalled();
  });

  it('limits the attempts per client address: the 21st within ten minutes is "failed" without an exchange', async () => {
    const { GET, verify } = await setup();
    for (let i = 0; i < 20; i++) {
      const ok = await GET(get(`?token_hash=${HASH}&type=email`));
      expect(ok.headers.get('location')).toMatch(/confirm=done/);
    }
    const blocked = await GET(get(`?token_hash=${HASH}&type=email`));
    expect(blocked.headers.get('location')).toBe(
      'https://fiae-learn.com/login?confirm=failed'
    );
    expect(verify).toHaveBeenCalledTimes(20);

    // another client address is not affected
    const other = await GET(
      get(`?token_hash=${HASH}&type=email`, {
        'x-forwarded-for': '198.51.100.9',
      })
    );
    expect(other.headers.get('location')).toMatch(/confirm=done/);
  });
});
