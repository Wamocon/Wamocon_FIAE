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

// Module under test: POST /api/auth/resend-confirmation
// (src/app/api/auth/resend-confirmation/route.ts). Sends the confirmation
// e-mail of a self-registration again, limited three ways, and never tells
// whether an account exists for the address.

jest.mock('@supabase/supabase-js', () => ({
  createClient: jest.fn(),
}));

async function setup(options: { preview?: boolean; resend?: jest.Mock } = {}) {
  jest.resetModules();
  const actual: any = jest.requireActual('@/lib/db-schema');
  jest.doMock('@/lib/db-schema', () => ({
    ...actual,
    IS_PREVIEW_SCHEMA: options.preview ?? false,
  }));
  const resend =
    options.resend ??
    (jest.fn() as jest.Mock).mockImplementation(async () => ({
      data: { user: null, session: null },
      error: null,
    }));
  const supa = await import('@supabase/supabase-js');
  (supa.createClient as jest.Mock).mockReturnValue({ auth: { resend } });
  const mod = await import('@/app/api/auth/resend-confirmation/route');
  return {
    POST: mod.POST as (req: any) => Promise<Response>,
    resend,
    createClient: supa.createClient as jest.Mock,
  };
}

function post(body: unknown, ip = '203.0.113.7') {
  return {
    headers: {
      get: (k: string) => (k.toLowerCase() === 'x-forwarded-for' ? ip : null),
    },
    json: async () => body,
  } as any;
}

describe('POST /api/auth/resend-confirmation', () => {
  const saved = { ...process.env };

  beforeEach(() => {
    jest.clearAllMocks();
    process.env.SUPABASE_URL = 'http://test';
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon';
    delete process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
    process.env.NEXT_PUBLIC_APP_URL = 'https://fiae-learn.com';
    jest.spyOn(console, 'warn').mockImplementation(() => undefined);
    jest.spyOn(console, 'error').mockImplementation(() => undefined);
  });

  afterEach(() => {
    process.env = { ...saved };
    jest.restoreAllMocks();
  });

  it('asks Supabase to send the sign up e-mail again, with the public key and the callback as target', async () => {
    const { POST, resend, createClient } = await setup();
    const res = await POST(post({ email: ' Azubi@Example.com ' }));
    const body: any = await res.json();

    expect(res.status).toBe(200);
    expect(body.success).toBe(true);
    expect(resend).toHaveBeenCalledWith({
      type: 'signup',
      email: 'Azubi@Example.com',
      options: { emailRedirectTo: 'https://fiae-learn.com/auth/callback' },
    });
    expect(createClient.mock.calls[0][1]).toBe('anon');
  });

  it('answers the same for an address Supabase does not know or has already confirmed', async () => {
    const known = await setup();
    const a = await known.POST(post({ email: 'known@example.com' }));
    const aBody = await a.json();

    const failing = (jest.fn() as jest.Mock).mockImplementation(async () => ({
      data: { user: null, session: null },
      error: { status: 400, code: 'user_not_found', message: 'secret detail' },
    }));
    const unknown = await setup({ resend: failing });
    const b = await unknown.POST(post({ email: 'nobody@example.com' }));
    const bBody = await b.json();

    expect(b.status).toBe(a.status);
    expect(bBody).toEqual(aBody);
    expect(JSON.stringify(bBody)).not.toMatch(/secret detail/);
    expect(console.warn).toHaveBeenCalled();
  });

  it('the limit of Supabase is not shown either: it only hits an existing, unconfirmed account, so the status would tell who is registered', async () => {
    const plain = await setup();
    const a = await plain.POST(post({ email: 'unknown@example.com' }));
    const aBody = await a.json();

    const limited = (jest.fn() as jest.Mock).mockImplementation(async () => ({
      data: { user: null, session: null },
      error: { status: 429, code: 'over_email_send_rate_limit', message: 'x' },
    }));
    const { POST } = await setup({ resend: limited });
    const res = await POST(post({ email: 'azubi@example.com' }));
    expect(res.status).toBe(a.status);
    expect(await res.json()).toEqual(aBody);
    expect(console.warn).toHaveBeenCalled();
  });

  it('500 with a generic text if the call throws', async () => {
    const broken = (jest.fn() as jest.Mock).mockImplementation(async () => {
      throw new Error('boom internal');
    });
    const { POST } = await setup({ resend: broken });
    const res = await POST(post({ email: 'azubi@example.com' }));
    expect(res.status).toBe(500);
    expect(JSON.stringify(await res.json())).not.toMatch(/boom internal/);
  });

  describe('input', () => {
    it.each([
      [{}],
      [{ email: '' }],
      [{ email: 'not-an-email' }],
      [{ email: ['a@b.de'] }],
      [{ email: 42 }],
      [{ email: `${'a'.repeat(250)}@example.com` }],
    ])('400 and no e-mail for %j', async payload => {
      const { POST, resend } = await setup();
      const res = await POST(post(payload));
      expect(res.status).toBe(400);
      expect(resend).not.toHaveBeenCalled();
    });

    it('400 for an unreadable body', async () => {
      const { POST, resend } = await setup();
      const res = await POST({
        headers: { get: () => null },
        json: async () => {
          throw new Error('bad json');
        },
      });
      expect(res.status).toBe(400);
      expect(resend).not.toHaveBeenCalled();
    });

    it('500 if the Supabase configuration is missing', async () => {
      delete process.env.SUPABASE_URL;
      delete process.env.SUPABASE_URL_INTERNAL;
      delete process.env.NEXT_PUBLIC_SUPABASE_URL;
      const { POST, resend } = await setup();
      const res = await POST(post({ email: 'azubi@example.com' }));
      expect(res.status).toBe(500);
      expect(resend).not.toHaveBeenCalled();
    });
  });

  describe('rate limits', () => {
    it('one request per address and minute: the second is 429 with Retry-After and sends nothing', async () => {
      const { POST, resend } = await setup();
      const first = await POST(post({ email: 'azubi@example.com' }));
      expect(first.status).toBe(200);
      const second = await POST(post({ email: 'AZUBI@example.com' }));
      expect(second.status).toBe(429);
      expect(Number(second.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect((await second.json()).error).toMatch(/eine Minute/);
      expect(resend).toHaveBeenCalledTimes(1);
    });

    it('a different address is not affected by the minute limit', async () => {
      const { POST, resend } = await setup();
      await POST(post({ email: 'one@example.com' }));
      const other = await POST(post({ email: 'two@example.com' }));
      expect(other.status).toBe(200);
      expect(resend).toHaveBeenCalledTimes(2);
    });

    it('at most five e-mails per address and hour', async () => {
      const { POST, resend } = await setup();
      const realNow = Date.now;
      let offset = 0;
      Date.now = () => realNow() + offset;
      try {
        for (let i = 0; i < 5; i++) {
          const ok = await POST(
            post({ email: 'azubi@example.com' }, `203.0.113.${i + 1}`)
          );
          expect(ok.status).toBe(200);
          // past the minute limit, still inside the hour
          offset += 61 * 1000;
        }
        const blocked = await POST(
          post({ email: 'azubi@example.com' }, '203.0.113.99')
        );
        expect(blocked.status).toBe(429);
        expect((await blocked.json()).error).toMatch(/zu oft/);
        expect(resend).toHaveBeenCalledTimes(5);
      } finally {
        Date.now = realNow;
      }
    });

    it('at most ten requests per client address and hour', async () => {
      const { POST, resend } = await setup();
      for (let i = 0; i < 10; i++) {
        const ok = await POST(post({ email: `azubi${i}@example.com` }));
        expect(ok.status).toBe(200);
      }
      const blocked = await POST(post({ email: 'azubi10@example.com' }));
      expect(blocked.status).toBe(429);
      expect(Number(blocked.headers.get('Retry-After'))).toBeGreaterThan(0);
      expect(resend).toHaveBeenCalledTimes(10);

      const other = await POST(
        post({ email: 'azubi11@example.com' }, '198.51.100.9')
      );
      expect(other.status).toBe(200);
    });
  });

  it('is switched off in Preview (shared Auth of Production), before anything happens', async () => {
    const { POST, resend, createClient } = await setup({ preview: true });
    const res = await POST(post({ email: 'azubi@example.com' }));
    expect(res.status).toBe(403);
    expect((await res.json()).code).toBe('PREVIEW_ADMIN_DISABLED');
    expect(resend).not.toHaveBeenCalled();
    expect(createClient).not.toHaveBeenCalled();
  });
});
