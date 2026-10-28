/**
 * @jest-environment node
 */
import {
  DEFAULT_ALLOWED_HOSTS,
  DEFAULT_LIMITS,
  DEFAULT_MODEL,
  KI_ENV,
  SOKRATES_DEFAULT_BASE_URL,
  allowedHostsOf,
  loadKiConfig,
  parseTarget,
} from '@/lib/content-upload/ki/config';
import { loadProviderConfig } from '@/lib/hai/providers/types';

const ON = {
  [KI_ENV.enabled]: 'true',
  [KI_ENV.apiKey]: 'sk-test-0123456789',
};

describe('the configuration of the Sokrates stage', () => {
  it('is off unless the owner switched it on with exactly "true"', () => {
    for (const value of [undefined, '', 'false', 'TRUE', '1', 'yes', ' true']) {
      const env = { ...ON, [KI_ENV.enabled]: value };
      expect(loadKiConfig(env)).toEqual({ ok: false, code: 'DISABLED' });
    }
    expect(loadKiConfig({ [KI_ENV.apiKey]: 'k' })).toEqual({
      ok: false,
      code: 'DISABLED',
    });
  });

  it('needs a key from the environment and refuses one that cannot be a bearer token', () => {
    expect(loadKiConfig({ [KI_ENV.enabled]: 'true' })).toEqual({
      ok: false,
      code: 'NO_KEY',
    });
    for (const key of ['', '   ', 'a b', 'abc\ndef', 'abc\r\nX-Evil: 1']) {
      expect(loadKiConfig({ ...ON, [KI_ENV.apiKey]: key })).toEqual({
        ok: false,
        code: 'NO_KEY',
      });
    }
  });

  it('uses the address of Sokrates by default, with the same default as the chat of the HAI', () => {
    const result = loadKiConfig(ON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.target).toEqual({
      url: `${SOKRATES_DEFAULT_BASE_URL}/chat/completions`,
      host: 'sokrates.test-qualitaetsmanagement.com',
    });
    expect(result.config.policy).toEqual({
      requireHttps: true,
      allowedHosts: DEFAULT_ALLOWED_HOSTS,
    });
    expect(result.config.limits).toEqual(DEFAULT_LIMITS);
    expect(result.config.model).toBe(DEFAULT_MODEL);
    // one place for the default address: the chat and this stage must not drift apart
    const saved = process.env.OPENAI_COMPATIBLE_BASE_URL;
    delete process.env.OPENAI_COMPATIBLE_BASE_URL;
    try {
      expect(loadProviderConfig().openaiCompatible.baseUrl).toBe(
        SOKRATES_DEFAULT_BASE_URL
      );
      expect(loadProviderConfig().openaiCompatible.model).toBe(DEFAULT_MODEL);
    } finally {
      if (saved !== undefined) process.env.OPENAI_COMPATIBLE_BASE_URL = saved;
    }
  });

  it('takes the model of the chat and keeps a safe name', () => {
    const named = loadKiConfig({ ...ON, [KI_ENV.model]: 'sokrates-fast' });
    expect(named.ok && named.config.model).toBe('sokrates-fast');
    const bad = loadKiConfig({ ...ON, [KI_ENV.model]: 'x"; drop table' });
    expect(bad.ok && bad.config.model).toBe(DEFAULT_MODEL);
  });

  describe('the address', () => {
    const policy = { requireHttps: true, allowedHosts: DEFAULT_ALLOWED_HOSTS };

    it('refuses everything but https on a host of the positive list', () => {
      const refused: Array<[string, string]> = [
        ['http://sokrates.test-qualitaetsmanagement.com/api', 'BAD_URL'],
        ['ftp://sokrates.test-qualitaetsmanagement.com/api', 'BAD_URL'],
        ['not a url', 'BAD_URL'],
        ['', 'BAD_URL'],
        [
          'https://user:pw@sokrates.test-qualitaetsmanagement.com/api',
          'BAD_URL',
        ],
        ['https://sokrates.test-qualitaetsmanagement.com/api?x=1', 'BAD_URL'],
        ['https://sokrates.test-qualitaetsmanagement.com/api#frag', 'BAD_URL'],
        ['https://sokrates.test-qualitaetsmanagement.com:8443/api', 'BAD_URL'],
        ['https://api.openai.com/v1', 'HOST_NOT_ALLOWED'],
        [
          'https://generativelanguage.googleapis.com/v1beta',
          'HOST_NOT_ALLOWED',
        ],
        ['https://openrouter.ai/api/v1', 'HOST_NOT_ALLOWED'],
        ['https://api.anthropic.com', 'HOST_NOT_ALLOWED'],
        ['https://localhost/api', 'HOST_NOT_ALLOWED'],
        ['https://127.0.0.1/api', 'HOST_NOT_ALLOWED'],
        // a host that only STARTS or ENDS like the allowed one
        [
          'https://sokrates.test-qualitaetsmanagement.com.evil.example/api',
          'HOST_NOT_ALLOWED',
        ],
        [
          'https://evil-sokrates.test-qualitaetsmanagement.com/api',
          'HOST_NOT_ALLOWED',
        ],
        ['https://test-qualitaetsmanagement.com/api', 'HOST_NOT_ALLOWED'],
      ];
      for (const [url, code] of refused) {
        expect(parseTarget(url, policy)).toEqual({ ok: false, code });
      }
    });

    it('accepts the host in any letter case and keeps the path', () => {
      const result = parseTarget(
        'HTTPS://Sokrates.Test-Qualitaetsmanagement.com/api/',
        policy
      );
      expect(result).toEqual({
        ok: true,
        target: {
          url: 'https://sokrates.test-qualitaetsmanagement.com/api/chat/completions',
          host: 'sokrates.test-qualitaetsmanagement.com',
        },
      });
    });

    it('turns a wrong variable into a refusal instead of an excerpt sent elsewhere', () => {
      for (const url of [
        'https://api.openai.com/v1',
        'http://sokrates.test-qualitaetsmanagement.com/api',
      ]) {
        const result = loadKiConfig({ ...ON, [KI_ENV.baseUrl]: url });
        expect(result.ok).toBe(false);
      }
    });
  });

  describe('the positive list of hosts', () => {
    it('is replaced, not extended, by the variable', () => {
      expect(allowedHostsOf({})).toEqual(DEFAULT_ALLOWED_HOSTS);
      expect(
        allowedHostsOf({
          [KI_ENV.allowedHosts]: 'ki.example.org, Other.Example.org',
        })
      ).toEqual(['ki.example.org', 'other.example.org']);
      const moved = loadKiConfig({
        ...ON,
        [KI_ENV.allowedHosts]: 'ki.example.org',
        [KI_ENV.baseUrl]: 'https://ki.example.org/api',
      });
      expect(moved.ok).toBe(true);
      // the old host is no longer on the list
      expect(
        loadKiConfig({ ...ON, [KI_ENV.allowedHosts]: 'ki.example.org' })
      ).toEqual({ ok: false, code: 'HOST_NOT_ALLOWED' });
    });

    it('refuses names that are no exact host: localhost, IP numbers, wildcards, lists that are too long', () => {
      for (const value of [
        'localhost',
        '10.0.0.1',
        '*.example.org',
        'https://ki.example.org',
        'ki.example.org/api',
        ',,',
        'a.example.org,b.example.org,c.example.org,d.example.org,e.example.org,f.example.org',
      ]) {
        expect(allowedHostsOf({ [KI_ENV.allowedHosts]: value })).toBeNull();
        expect(loadKiConfig({ ...ON, [KI_ENV.allowedHosts]: value })).toEqual({
          ok: false,
          code: 'BAD_HOSTS',
        });
      }
    });
  });

  it('reads the limits with bounds and ignores nonsense', () => {
    const result = loadKiConfig({
      ...ON,
      [KI_ENV.timeoutMs]: '999999',
      [KI_ENV.maxCallsPerRun]: '25',
      [KI_ENV.maxCallsPerDay]: 'many',
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.limits.timeoutMs).toBe(20_000);
    expect(result.config.limits.maxCallsPerRun).toBe(25);
    expect(result.config.limits.maxCallsPerDay).toBe(
      DEFAULT_LIMITS.maxCallsPerDay
    );
    const low = loadKiConfig({ ...ON, [KI_ENV.timeoutMs]: '5' });
    expect(low.ok && low.config.limits.timeoutMs).toBe(1000);
  });

  it('never carries the key in anything but apiKey', () => {
    const result = loadKiConfig(ON);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const { apiKey, ...rest } = result.config;
    expect(apiKey).toBe(ON[KI_ENV.apiKey]);
    expect(JSON.stringify(rest)).not.toContain(ON[KI_ENV.apiKey]);
  });
});
