/**
 * @jest-environment node
 */
import { describe, it, expect, beforeEach, jest } from '@jest/globals';
import {
  DEFAULT_VOICE_SETTINGS,
  parseVoiceSettings,
  validateSettingsUpdate,
} from '@/lib/hai/voice/settings';
import {
  DISTURBED_MS,
  providerStates,
  reportProviderFailure,
  reportProviderSuccess,
  resetProviderHealth,
  resolveChain,
} from '@/lib/hai/voice/provider';
import {
  createSonioxToken,
  loadSonioxConfig,
  ttsStreamConfig,
} from '@/lib/hai/voice/sonioxServer';
import {
  hausConfigReason,
  hausModelStatus,
  hausSpeech,
  hausTranscribe,
  loadHausStt,
  loadHausTts,
} from '@/lib/hai/voice/hausServer';

// The server side of the voice providers: the settings of the admin, the state of
// every provider, the chain the browser walks, Soniox (key, region, short lived key)
// and Sokrates (configuration, calls, status). No network: fetch is replaced.

const SECRET = 'sk-test-secret-value';
const HAUS_ENV = {
  OPENAI_COMPATIBLE_API_KEY: SECRET,
  HAI_STT_HAUS_MODEL: 'whisper-1',
  HAI_TTS_HAUS_MODEL: 'tts-1',
  HAI_TTS_HAUS_VOICE: 'alloy',
};

const states = (env: Record<string, string>) => providerStates(env, 1_000);

beforeEach(() => resetProviderHealth());

describe('voice settings', () => {
  it('defaults to Soniox with the browser as fallback', () => {
    expect(DEFAULT_VOICE_SETTINGS).toEqual({
      primary: 'soniox',
      fallback: 'browser',
    });
    expect(parseVoiceSettings(null)).toEqual(DEFAULT_VOICE_SETTINGS);
    expect(parseVoiceSettings({})).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it('reads stored values and falls back for damaged ones', () => {
    expect(
      parseVoiceSettings({
        voice_provider_primary: 'haus',
        voice_provider_fallback: 'browser',
      })
    ).toEqual({ primary: 'haus', fallback: 'browser' });
    expect(
      parseVoiceSettings({
        voice_provider_primary: 'nonsense',
        voice_provider_fallback: 42,
      })
    ).toEqual(DEFAULT_VOICE_SETTINGS);
  });

  it('never lets the fallback equal the main provider', () => {
    expect(
      parseVoiceSettings({
        voice_provider_primary: 'browser',
        voice_provider_fallback: 'browser',
      })
    ).toEqual({ primary: 'browser', fallback: 'haus' });
    expect(
      parseVoiceSettings({
        voice_provider_primary: 'haus',
        voice_provider_fallback: 'haus',
      })
    ).toEqual({ primary: 'haus', fallback: 'browser' });
  });

  describe('validateSettingsUpdate', () => {
    const current = { primary: 'soniox', fallback: 'browser' } as const;

    it('accepts a complete and a partial change', () => {
      expect(
        validateSettingsUpdate(
          { primary: 'haus', fallback: 'browser' },
          current
        )
      ).toEqual({ ok: true, values: { primary: 'haus', fallback: 'browser' } });
      expect(validateSettingsUpdate({ fallback: 'haus' }, current)).toEqual({
        ok: true,
        values: { primary: 'soniox', fallback: 'haus' },
      });
    });

    it.each([
      [null, 'INVALID_BODY'],
      ['soniox', 'INVALID_BODY'],
      [[], 'INVALID_BODY'],
      [{ primary: 'soniox', extra: 1 }, 'INVALID_BODY'],
      [{}, 'NOTHING_TO_UPDATE'],
      [{ primary: 'google' }, 'INVALID_PRIMARY'],
      [{ primary: 3 }, 'INVALID_PRIMARY'],
      // Soniox is no fallback
      [{ fallback: 'soniox' }, 'INVALID_FALLBACK'],
      [{ fallback: null }, 'INVALID_FALLBACK'],
      [{ primary: 'browser', fallback: 'browser' }, 'SAME_PROVIDER'],
      // a partial change that collides with the stored value
      [{ primary: 'browser' }, 'SAME_PROVIDER'],
    ])('refuses %j with %s', (body, code) => {
      expect(validateSettingsUpdate(body, current)).toEqual({
        ok: false,
        code,
      });
    });
  });
});

describe('Soniox configuration', () => {
  it('is not set up without a key, and never echoes the key', () => {
    expect(loadSonioxConfig({})).toEqual({ ok: false, reason: 'NO_KEY' });
    expect(loadSonioxConfig({ SONIOX_API_KEY: '   ' })).toEqual({
      ok: false,
      reason: 'NO_KEY',
    });
    // a key with a space or a line break could inject a header
    expect(loadSonioxConfig({ SONIOX_API_KEY: 'a b' })).toEqual({
      ok: false,
      reason: 'NO_KEY',
    });
    expect(loadSonioxConfig({ SONIOX_API_KEY: 'a\nb' })).toEqual({
      ok: false,
      reason: 'NO_KEY',
    });
  });

  it('uses the EU region by default with the hosts of the EU', () => {
    const result = loadSonioxConfig({ SONIOX_API_KEY: SECRET });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.config.region).toBe('eu');
    expect(result.config.apiBase).toBe('https://api.eu.soniox.com');
    expect(result.config.sttWsUrl).toBe(
      'wss://stt-rt.eu.soniox.com/transcribe-websocket'
    );
    expect(result.config.ttsWsUrl).toBe(
      'wss://tts-rt.eu.soniox.com/tts-websocket'
    );
  });

  it('takes the hosts of the US region only when asked, and refuses an unknown region', () => {
    const us = loadSonioxConfig({
      SONIOX_API_KEY: SECRET,
      SONIOX_REGION: 'US',
    });
    expect(us.ok && us.config.apiBase).toBe('https://api.soniox.com');
    expect(
      loadSonioxConfig({ SONIOX_API_KEY: SECRET, SONIOX_REGION: 'asia' })
    ).toEqual({ ok: false, reason: 'BAD_REGION' });
  });

  it('keeps a plain voice name and drops anything else', () => {
    const ok = loadSonioxConfig({
      SONIOX_API_KEY: SECRET,
      SONIOX_TTS_VOICE: 'Maya',
    });
    expect(ok.ok && ok.config.ttsVoice).toBe('Maya');
    const bad = loadSonioxConfig({
      SONIOX_API_KEY: SECRET,
      SONIOX_TTS_VOICE: '"; drop',
    });
    expect(bad.ok && bad.config.ttsVoice).toBe('Lena');
  });
});

describe('Soniox short lived key', () => {
  const config = (() => {
    const result = loadSonioxConfig({ SONIOX_API_KEY: SECRET });
    if (!result.ok) throw new Error('config');
    return result.config;
  })();

  const answer = (status: number, body: unknown) =>
    jest.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status,
          headers: { 'content-type': 'application/json' },
        })
    );

  it('asks Soniox for a key for one websocket and hands out only that key', async () => {
    const fetchMock = answer(201, {
      api_key: 'temp-key',
      expires_at: '2026-11-02T10:00:00Z',
    });
    const result = await createSonioxToken(
      config,
      'stt',
      'hai-voice:u1',
      fetchMock as unknown as typeof fetch
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.grant.apiKey).toBe('temp-key');
    expect(result.grant.wsUrl).toBe(
      'wss://stt-rt.eu.soniox.com/transcribe-websocket'
    );
    expect(result.grant.config).toMatchObject({
      model: 'stt-rt-v5',
      audio_format: 'auto',
      enable_endpoint_detection: true,
    });
    // the real key is used for the call and appears nowhere in the grant
    expect(JSON.stringify(result.grant)).not.toContain(SECRET);

    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe('https://api.eu.soniox.com/v1/auth/temporary-api-key');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${SECRET}`
    );
    const sent = JSON.parse(init.body as string);
    expect(sent).toMatchObject({
      usage_type: 'transcribe_websocket',
      expires_in_seconds: 90,
      client_reference_id: 'hai-voice:u1',
    });
    expect(sent.max_session_duration_seconds).toBeLessThanOrEqual(18_000);
  });

  it('asks for a text-to-speech key with the stream settings of the server', async () => {
    const fetchMock = answer(201, { api_key: 'temp-tts' });
    const result = await createSonioxToken(
      config,
      'tts',
      'ref',
      fetchMock as unknown as typeof fetch
    );
    expect(result.ok && result.grant.wsUrl).toBe(
      'wss://tts-rt.eu.soniox.com/tts-websocket'
    );
    expect(result.ok && result.grant.config).toEqual(ttsStreamConfig(config));
    const init = (
      fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    )[1];
    expect(JSON.parse(init.body as string).usage_type).toBe('tts_rt');
    expect(ttsStreamConfig(config)).toMatchObject({
      model: 'tts-rt-v2',
      language: 'de',
      audio_format: 'pcm_s16le',
    });
  });

  it.each([
    [401, 'UPSTREAM_REFUSED'],
    [400, 'UPSTREAM_REFUSED'],
    [429, 'UPSTREAM_UNAVAILABLE'],
    [500, 'UPSTREAM_UNAVAILABLE'],
  ])('reports HTTP %s as %s', async (status, reason) => {
    const result = await createSonioxToken(
      config,
      'stt',
      'ref',
      answer(status, { error: 'x' }) as unknown as typeof fetch
    );
    expect(result).toEqual({ ok: false, reason, status });
  });

  it('reports a network error and an answer without a key', async () => {
    const failing = jest.fn(async () => {
      throw new Error('boom ' + SECRET);
    });
    const down = await createSonioxToken(
      config,
      'stt',
      'ref',
      failing as unknown as typeof fetch
    );
    expect(down).toEqual({
      ok: false,
      reason: 'UPSTREAM_UNAVAILABLE',
      status: null,
    });
    expect(JSON.stringify(down)).not.toContain(SECRET);
    const odd = await createSonioxToken(
      config,
      'stt',
      'ref',
      answer(201, { nothing: true }) as unknown as typeof fetch
    );
    expect(odd).toEqual({
      ok: false,
      reason: 'UPSTREAM_BAD_ANSWER',
      status: null,
    });
  });
});

describe('Sokrates configuration', () => {
  it('is set up with key, both models and a voice', () => {
    expect(hausConfigReason(HAUS_ENV)).toBeNull();
    const stt = loadHausStt(HAUS_ENV);
    const tts = loadHausTts(HAUS_ENV);
    expect(stt.ok && stt.config.baseUrl).toBe(
      'https://sokrates.test-qualitaetsmanagement.com/api'
    );
    expect(stt.ok && stt.config.model).toBe('whisper-1');
    expect(tts.ok && tts.config.voice).toBe('alloy');
  });

  it.each([
    [{ ...HAUS_ENV, OPENAI_COMPATIBLE_API_KEY: '' }, 'NO_KEY'],
    [{ ...HAUS_ENV, HAI_STT_HAUS_MODEL: '' }, 'NO_STT_MODEL'],
    [{ ...HAUS_ENV, HAI_TTS_HAUS_MODEL: '' }, 'NO_TTS_MODEL'],
    [{ ...HAUS_ENV, HAI_TTS_HAUS_VOICE: '' }, 'NO_TTS_VOICE'],
    [{ ...HAUS_ENV, HAI_TTS_HAUS_MODEL: 'bad model;' }, 'NO_TTS_MODEL'],
    [
      { ...HAUS_ENV, OPENAI_COMPATIBLE_BASE_URL: 'http://sokrates.local/api' },
      'BAD_URL',
    ],
    [
      {
        ...HAUS_ENV,
        OPENAI_COMPATIBLE_BASE_URL: 'https://evil.example.com/api',
      },
      'HOST_NOT_ALLOWED',
    ],
  ])(
    'names the reason when something is missing or wrong (%#)',
    (env, reason) => {
      expect(hausConfigReason(env)).toBe(reason);
    }
  );

  it('recognition needs only the key and the recognition model', () => {
    const env = { ...HAUS_ENV, HAI_TTS_HAUS_MODEL: '', HAI_TTS_HAUS_VOICE: '' };
    expect(loadHausStt(env).ok).toBe(true);
    expect(loadHausTts(env)).toEqual({ ok: false, reason: 'NO_TTS_MODEL' });
  });
});

describe('Sokrates calls', () => {
  const stt = (() => {
    const result = loadHausStt(HAUS_ENV);
    if (!result.ok) throw new Error('stt');
    return result.config;
  })();
  const tts = (() => {
    const result = loadHausTts(HAUS_ENV);
    if (!result.ok) throw new Error('tts');
    return result.config;
  })();

  it('sends the recording to the transcription endpoint and returns the text', async () => {
    const fetchMock = jest.fn(
      async () => new Response(JSON.stringify({ text: ' Hallo Welt ' }))
    );
    const result = await hausTranscribe(
      stt,
      new Blob(['audio'], { type: 'audio/webm' }),
      'speech.webm',
      fetchMock as unknown as typeof fetch
    );
    expect(result).toEqual({ ok: true, text: 'Hallo Welt' });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://sokrates.test-qualitaetsmanagement.com/api/audio/transcriptions'
    );
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${SECRET}`
    );
    const form = init.body as FormData;
    expect(form.get('model')).toBe('whisper-1');
    expect(form.get('language')).toBe('de');
    expect(form.get('file')).toBeInstanceOf(Blob);
  });

  it('asks for speech as WAV with the model and the voice of the server', async () => {
    const fetchMock = jest.fn(
      async () => new Response(new Uint8Array([1, 2, 3]))
    );
    const result = await hausSpeech(
      tts,
      'Guten Morgen.',
      fetchMock as unknown as typeof fetch
    );
    expect(result.ok && result.contentType).toBe('audio/wav');
    expect(result.ok && result.audio.byteLength).toBe(3);
    const [url, init] = fetchMock.mock.calls[0] as unknown as [
      string,
      RequestInit,
    ];
    expect(url).toBe(
      'https://sokrates.test-qualitaetsmanagement.com/api/audio/speech'
    );
    expect(JSON.parse(init.body as string)).toEqual({
      model: 'tts-1',
      input: 'Guten Morgen.',
      voice: 'alloy',
      response_format: 'wav',
    });
  });

  it.each([
    [401, 'UPSTREAM_REFUSED'],
    [404, 'MODEL_NOT_OFFERED'],
    [422, 'MODEL_NOT_OFFERED'],
    [502, 'UPSTREAM_UNAVAILABLE'],
  ])('classifies HTTP %s as %s', async (status, reason) => {
    const fetchMock = jest.fn(async () => new Response('x', { status }));
    expect(
      await hausSpeech(tts, 'Hallo', fetchMock as unknown as typeof fetch)
    ).toEqual({ ok: false, reason });
  });

  it('treats a network error, an empty audio and an answer without text as failures', async () => {
    const down = jest.fn(async () => {
      throw new Error('offline');
    });
    expect(
      await hausSpeech(tts, 'Hallo', down as unknown as typeof fetch)
    ).toEqual({ ok: false, reason: 'UPSTREAM_UNAVAILABLE' });
    expect(
      await hausSpeech(
        tts,
        'Hallo',
        (async () => new Response(new Uint8Array(0))) as unknown as typeof fetch
      )
    ).toEqual({ ok: false, reason: 'UPSTREAM_BAD_ANSWER' });
    expect(
      await hausTranscribe(
        stt,
        new Blob(['a']),
        'speech.webm',
        (async () => new Response('{}')) as unknown as typeof fetch
      )
    ).toEqual({ ok: false, reason: 'UPSTREAM_BAD_ANSWER' });
  });

  it('reports whether the server offers the two audio models, without returning ids', async () => {
    const list = (ids: string[]) =>
      (async () =>
        new Response(
          JSON.stringify({ data: ids.map(id => ({ id })) })
        )) as unknown as typeof fetch;
    expect(
      await hausModelStatus(HAUS_ENV, list(['whisper-1', 'tts-1']))
    ).toEqual({
      reachable: true,
      sttOffered: true,
      ttsOffered: true,
    });
    expect(await hausModelStatus(HAUS_ENV, list(['whisper-1']))).toEqual({
      reachable: true,
      sttOffered: true,
      ttsOffered: false,
    });
    const down = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    expect(await hausModelStatus(HAUS_ENV, down)).toEqual({
      reachable: false,
      sttOffered: null,
      ttsOffered: null,
    });
    // without a key nothing is asked
    const never = jest.fn();
    expect(await hausModelStatus({}, never as unknown as typeof fetch)).toEqual(
      { reachable: false, sttOffered: null, ttsOffered: null }
    );
    expect(never).not.toHaveBeenCalled();
  });
});

describe('state of the providers and the chain', () => {
  const soniox = { SONIOX_API_KEY: SECRET };

  it('Soniox is not set up without a key, the browser is always ready', () => {
    const s = states({});
    expect(s.soniox).toEqual({
      id: 'soniox',
      status: 'not_configured',
      reason: 'NO_KEY',
    });
    expect(s.haus.status).toBe('not_configured');
    expect(s.browser).toEqual({ id: 'browser', status: 'ready', reason: null });
  });

  it('starts with Soniox when it is set up, then the browser', () => {
    expect(resolveChain(DEFAULT_VOICE_SETTINGS, states(soniox))).toEqual({
      provider: 'soniox',
      chain: ['soniox', 'browser'],
    });
  });

  it('skips Soniox without a key and ends at the browser', () => {
    expect(resolveChain(DEFAULT_VOICE_SETTINGS, states({}))).toEqual({
      provider: 'browser',
      chain: ['browser'],
    });
  });

  it('Soniox disturbed, Sokrates not set up: the browser takes over', () => {
    reportProviderFailure('soniox', 'UPSTREAM_UNAVAILABLE', 500);
    const s = providerStates(soniox, 1_000);
    expect(s.soniox).toEqual({
      id: 'soniox',
      status: 'disturbed',
      reason: 'UPSTREAM_UNAVAILABLE',
    });
    expect(resolveChain({ primary: 'soniox', fallback: 'haus' }, s)).toEqual({
      provider: 'browser',
      chain: ['browser'],
    });
  });

  it('Soniox disturbed, Sokrates ready: Sokrates, then the browser', () => {
    reportProviderFailure('soniox', 'UPSTREAM_REFUSED', 500);
    const s = providerStates({ ...soniox, ...HAUS_ENV }, 1_000);
    expect(resolveChain({ primary: 'soniox', fallback: 'haus' }, s)).toEqual({
      provider: 'haus',
      chain: ['haus', 'browser'],
    });
  });

  it('all three ready: main provider, fallback, browser in this order', () => {
    const s = states({ ...soniox, ...HAUS_ENV });
    expect(
      resolveChain({ primary: 'soniox', fallback: 'haus' }, s).chain
    ).toEqual(['soniox', 'haus', 'browser']);
    expect(
      resolveChain({ primary: 'haus', fallback: 'browser' }, s).chain
    ).toEqual(['haus', 'browser']);
    // the browser as the main provider keeps Sokrates as its fallback
    expect(
      resolveChain({ primary: 'browser', fallback: 'haus' }, s).chain
    ).toEqual(['browser', 'haus']);
  });

  it('a failure is forgotten after a minute and after a success', () => {
    reportProviderFailure('soniox', 'UPSTREAM_UNAVAILABLE', 0);
    expect(providerStates(soniox, DISTURBED_MS - 1).soniox.status).toBe(
      'disturbed'
    );
    expect(providerStates(soniox, DISTURBED_MS).soniox.status).toBe('ready');
    reportProviderFailure('soniox', 'UPSTREAM_UNAVAILABLE', Date.now());
    reportProviderSuccess('soniox');
    expect(providerStates(soniox).soniox.status).toBe('ready');
  });
});
