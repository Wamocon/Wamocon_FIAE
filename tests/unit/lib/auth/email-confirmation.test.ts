import {
  CONFIRM_TARGETS,
  DEFAULT_CONFIRM_TARGET,
  EmailNotConfirmedError,
  authRedirectBase,
  confirmRedirectPath,
  confirmationRedirectUrl,
  isEmailNotConfirmedError,
  isEmailRateLimitError,
  isPlausibleTokenHash,
  normalizeConfirmNotice,
  parseConfirmOtpType,
  safeConfirmTarget,
} from '@/lib/auth/email-confirmation';

// The callback of the confirmation e-mail may only send a person to a path of
// the positive list: no open redirect.

const headers = (values: Record<string, string> = {}) => ({
  get: (name: string) => values[name.toLowerCase()] ?? null,
});

describe('safeConfirmTarget (positive list, no open redirect)', () => {
  it('the list holds the login page only', () => {
    expect([...CONFIRM_TARGETS]).toEqual(['/login']);
    expect(DEFAULT_CONFIRM_TARGET).toBe('/login');
  });

  it('passes a path of the list unchanged', () => {
    expect(safeConfirmTarget('/login')).toBe('/login');
    expect(safeConfirmTarget(['/login', 'https://evil.example'])).toBe(
      '/login'
    );
  });

  it.each([
    undefined,
    null,
    '',
    '/',
    '/trainer/dashboard',
    '/login/',
    '/login?x=1',
    '/login#x',
    '/Login',
    ' /login',
    '//evil.example',
    '/\\evil.example',
    '\\\\evil.example',
    'https://evil.example',
    'http://evil.example/login',
    'javascript:alert(1)',
    'data:text/html,x',
    '/login/../trainer',
    '/%2e%2e/login',
    '%2F%2Fevil.example',
    '/login%0d%0aLocation:https://evil.example',
    42,
    {},
    [],
  ])('falls back to the login page for %j', value => {
    expect(safeConfirmTarget(value)).toBe('/login');
  });
});

describe('confirmRedirectPath', () => {
  it('adds the notice to a target of the list', () => {
    expect(confirmRedirectPath('/login', 'done')).toBe('/login?confirm=done');
    expect(confirmRedirectPath('/login', 'failed')).toBe(
      '/login?confirm=failed'
    );
  });

  it('never builds a path outside the list', () => {
    expect(confirmRedirectPath('https://evil.example', 'done')).toBe(
      '/login?confirm=done'
    );
  });
});

describe('parseConfirmOtpType', () => {
  it('accepts the confirmation of a sign up only', () => {
    expect(parseConfirmOtpType('email')).toBe('email');
    expect(parseConfirmOtpType('signup')).toBe('signup');
  });

  it.each([
    'recovery',
    'invite',
    'magiclink',
    'email_change',
    'EMAIL',
    '',
    null,
    undefined,
    1,
  ])('refuses %j', value => {
    expect(parseConfirmOtpType(value)).toBeNull();
  });
});

describe('isPlausibleTokenHash', () => {
  it('accepts hex and url safe hashes of a sensible length', () => {
    expect(isPlausibleTokenHash('a'.repeat(64))).toBe(true);
    expect(isPlausibleTokenHash('pkce_AbC-123_xyz')).toBe(true);
  });

  it.each([
    '',
    'short',
    'a'.repeat(201),
    'abc def ghi jkl',
    '<script>12345',
    null,
    5,
  ])('refuses %j', value => {
    expect(isPlausibleTokenHash(value)).toBe(false);
  });
});

describe('normalizeConfirmNotice', () => {
  it('passes the known notices', () => {
    expect(normalizeConfirmNotice('done')).toBe('done');
    expect(normalizeConfirmNotice('failed')).toBe('failed');
    expect(normalizeConfirmNotice(['check', 'x'])).toBe('check');
  });

  it.each([undefined, '', 'DONE', '<script>', '__proto__', 7, []])(
    'ignores %j',
    value => {
      expect(normalizeConfirmNotice(value)).toBeNull();
    }
  );
});

describe('authRedirectBase and confirmationRedirectUrl', () => {
  const saved = { ...process.env };
  beforeEach(() => {
    (process.env as Record<string, string | undefined>).NODE_ENV = 'test';
    delete process.env.NEXT_PUBLIC_APP_URL;
    delete process.env.NEXT_PUBLIC_SITE_URL;
  });
  afterEach(() => {
    process.env = { ...saved };
  });

  it('the configured public URL wins over forged headers', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://fiae-learn.com/';
    const forged = headers({
      'x-forwarded-host': 'evil.example',
      'x-forwarded-proto': 'https',
      host: 'evil.example',
    });
    expect(authRedirectBase(forged)).toBe('https://fiae-learn.com');
    expect(confirmationRedirectUrl(forged)).toBe(
      'https://fiae-learn.com/auth/callback'
    );
  });

  it('NEXT_PUBLIC_SITE_URL is the second choice', () => {
    process.env.NEXT_PUBLIC_SITE_URL = 'https://site.example';
    expect(authRedirectBase(headers())).toBe('https://site.example');
  });

  it('without configuration it uses the headers of the request', () => {
    expect(
      authRedirectBase(
        headers({
          'x-forwarded-host': 'preview.fiae-learn.com',
          'x-forwarded-proto': 'https',
        })
      )
    ).toBe('https://preview.fiae-learn.com');
    expect(authRedirectBase(headers({ host: 'localhost:3000' }))).toBe(
      'http://localhost:3000'
    );
  });

  it('and falls back to the production address', () => {
    expect(authRedirectBase(headers())).toBe('https://fiae-learn.com');
  });

  it('a production build without a configured URL does not trust the headers', () => {
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = 'production';
    expect(
      authRedirectBase(
        headers({
          'x-forwarded-host': 'evil.example',
          'x-forwarded-proto': 'https',
        })
      )
    ).toBe('https://fiae-learn.com');
  });

  it('a malformed configured URL counts as not configured (no exception)', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'not a url';
    const env = process.env as Record<string, string | undefined>;
    env.NODE_ENV = 'production';
    expect(authRedirectBase(headers({ host: 'evil.example' }))).toBe(
      'https://fiae-learn.com'
    );
  });

  it('only the origin of the configured URL is used', () => {
    process.env.NEXT_PUBLIC_APP_URL = 'https://fiae-learn.com/some/path?x=1';
    expect(authRedirectBase(headers())).toBe('https://fiae-learn.com');
  });
});

describe('isEmailRateLimitError', () => {
  it('knows the limits of Supabase on sending e-mails', () => {
    expect(isEmailRateLimitError({ status: 429 })).toBe(true);
    expect(isEmailRateLimitError({ code: 'over_email_send_rate_limit' })).toBe(
      true
    );
    expect(isEmailRateLimitError({ code: 'over_request_rate_limit' })).toBe(
      true
    );
  });

  it.each([
    null,
    undefined,
    {},
    { status: 400 },
    { code: 'weak_password' },
    'x',
  ])('not %j', value => {
    expect(isEmailRateLimitError(value)).toBe(false);
  });
});

describe('EmailNotConfirmedError', () => {
  it('is recognised, and a plain error is not', () => {
    const error = new EmailNotConfirmedError();
    expect(isEmailNotConfirmedError(error)).toBe(true);
    expect(error).toBeInstanceOf(Error);
    expect(error.message).toBe('E-Mail ist noch nicht bestätigt.');
    expect(isEmailNotConfirmedError(new Error('x'))).toBe(false);
    expect(isEmailNotConfirmedError(null)).toBe(false);
  });
});
