/**
 * @jest-environment node
 */
import {
  CONTENT_CHECK_KI_PRODUCTION_ENV,
  contentCheckKiAvailable,
  contentCheckKiEnv,
  productionSwitchOn,
} from '@/lib/catalog/content-check/ki-availability';
import {
  resetKiDayCalls,
  runKiReview,
} from '@/lib/catalog/content-check/ki-review';
import { cleanSnapshot } from './fixtures';

const SWITCH = CONTENT_CHECK_KI_PRODUCTION_ENV;

describe('where the AI stages may run', () => {
  describe('without the switch (the rule of the content upload)', () => {
    it.each([
      [
        'Vercel preview on the Preview schema',
        { VERCEL_ENV: 'preview' },
        true,
        true,
      ],
      [
        'Vercel preview on another schema',
        { VERCEL_ENV: 'preview' },
        false,
        false,
      ],
      ['vercel dev', { VERCEL_ENV: 'development' }, false, true],
      ['local development', { NODE_ENV: 'development' }, false, true],
      ['local test run', { NODE_ENV: 'test' }, false, true],
      ['Vercel production', { VERCEL_ENV: 'production' }, false, false],
      [
        'production build outside of Vercel',
        { NODE_ENV: 'production' },
        false,
        false,
      ],
      ['unknown Vercel environment', { VERCEL_ENV: 'staging' }, false, false],
    ])('%s: %s', (_name, env, previewSchema, expected) => {
      expect(contentCheckKiAvailable(env, previewSchema)).toBe(expected);
    });

    it('Production stays off, also with another value of the switch', () => {
      for (const value of ['false', '1', 'TRUE', 'yes', '', ' true']) {
        expect(
          contentCheckKiAvailable({ VERCEL_ENV: 'production', [SWITCH]: value })
        ).toBe(false);
      }
    });
  });

  describe('with CONTENT_CHECK_KI_PRODUCTION=true', () => {
    it('Production on Vercel is allowed', () => {
      expect(
        contentCheckKiAvailable({ VERCEL_ENV: 'production', [SWITCH]: 'true' })
      ).toBe(true);
    });

    it('a production build outside of Vercel is allowed', () => {
      expect(
        contentCheckKiAvailable({ NODE_ENV: 'production', [SWITCH]: 'true' })
      ).toBe(true);
    });

    it('does not open an unknown environment (fail closed)', () => {
      expect(
        contentCheckKiAvailable({ VERCEL_ENV: 'staging', [SWITCH]: 'true' })
      ).toBe(false);
    });

    it('does not turn on a Preview deployment on the wrong schema', () => {
      expect(
        contentCheckKiAvailable(
          { VERCEL_ENV: 'preview', [SWITCH]: 'true' },
          false
        )
      ).toBe(false);
    });

    it('changes nothing where the content upload runs anyway', () => {
      expect(
        contentCheckKiAvailable(
          { VERCEL_ENV: 'preview', [SWITCH]: 'true' },
          true
        )
      ).toBe(true);
      expect(
        contentCheckKiAvailable({ NODE_ENV: 'test', [SWITCH]: 'true' })
      ).toBe(true);
    });
  });

  it('the switch counts only in Production', () => {
    expect(
      productionSwitchOn({ VERCEL_ENV: 'production', [SWITCH]: 'true' })
    ).toBe(true);
    expect(
      productionSwitchOn({ VERCEL_ENV: 'preview', [SWITCH]: 'true' })
    ).toBe(false);
    expect(productionSwitchOn({ NODE_ENV: 'test', [SWITCH]: 'true' })).toBe(
      false
    );
    expect(productionSwitchOn({ VERCEL_ENV: 'production' })).toBe(false);
  });

  it('the environment of the AI configuration is the input unchanged, except in Production with the switch', () => {
    const preview = { VERCEL_ENV: 'preview', [SWITCH]: 'true' };
    expect(contentCheckKiEnv(preview)).toBe(preview);
    const production = { VERCEL_ENV: 'production' };
    expect(contentCheckKiEnv(production)).toBe(production);
    expect(
      contentCheckKiEnv({ VERCEL_ENV: 'production', [SWITCH]: 'true' })
    ).toMatchObject({ CONTENT_UPLOAD_KI_ENABLED: 'true' });
  });
});

describe('the review in Production, both states of the switch', () => {
  beforeEach(() => resetKiDayCalls());

  const production = {
    VERCEL_ENV: 'production',
    OPENAI_COMPATIBLE_API_KEY: 'sk-test-only',
    OPENAI_COMPATIBLE_MODEL: 'sokrates-fast',
  };

  const answer = () =>
    new Response(
      JSON.stringify({
        choices: [
          { message: { content: JSON.stringify({ auffaelligkeiten: [] }) } },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5 },
      }),
      { status: 200 }
    );

  it('switch off: nothing is sent and the report says it is not available', async () => {
    const fetchImpl = jest.fn(async () => answer()) as unknown as typeof fetch;
    const result = await runKiReview(cleanSnapshot(), {
      env: production,
      fetchImpl,
    });
    expect(result.ran).toBe(false);
    expect(result.notes.join(' ')).toContain('nicht verfügbar');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('switch on: the review goes to Sokrates only, with the model of the environment', async () => {
    const calls: { url: string; body: any }[] = [];
    const fetchImpl = (async (url: string, init: { body: string }) => {
      calls.push({ url, body: JSON.parse(init.body) });
      return answer();
    }) as unknown as typeof fetch;
    const result = await runKiReview(cleanSnapshot(), {
      env: { ...production, [SWITCH]: 'true' },
      fetchImpl,
    });
    expect(result.ran).toBe(true);
    expect(calls.length).toBeGreaterThan(0);
    for (const call of calls) {
      expect(new URL(call.url).host).toBe(
        'sokrates.test-qualitaetsmanagement.com'
      );
      expect(call.body.model).toBe('sokrates-fast');
    }
  });

  it('switch on, but a key is missing: still nothing is sent', async () => {
    const fetchImpl = jest.fn(async () => answer()) as unknown as typeof fetch;
    const { OPENAI_COMPATIBLE_API_KEY: _key, ...withoutKey } = production;
    const result = await runKiReview(cleanSnapshot(), {
      env: { ...withoutKey, [SWITCH]: 'true' },
      fetchImpl,
    });
    expect(result.ran).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('switch on, but a foreign host is configured: nothing is sent (Sokrates stays the only target)', async () => {
    const fetchImpl = jest.fn(async () => answer()) as unknown as typeof fetch;
    const result = await runKiReview(cleanSnapshot(), {
      env: {
        ...production,
        [SWITCH]: 'true',
        OPENAI_COMPATIBLE_BASE_URL: 'https://api.example.com/v1',
      },
      fetchImpl,
    });
    expect(result.ran).toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });
});
