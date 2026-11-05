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
import { createTableDb } from '../../../helpers/mockDb';
import {
  fakeSession,
  makeRequest,
  mockSession,
} from '../../../helpers/mockNext';

// The voice provider routes of the HAI: config, the short lived Soniox key and the
// two Sokrates routes. Every route needs a signed-in user AND the switch of the
// organization (403 VOICE_DISABLED), answers 503 with a reason when the provider is
// not set up or fails (so the client falls back) and never carries a key.

const SECRET = 'sk-real-secret-value';
const ENV_KEYS = [
  'SONIOX_API_KEY',
  'SONIOX_REGION',
  'OPENAI_COMPATIBLE_API_KEY',
  'OPENAI_COMPATIBLE_BASE_URL',
  'HAI_CHAT_PROVIDER',
  'HAI_EMBEDDING_PROVIDER',
  'HAI_STT_HAUS_MODEL',
  'HAI_TTS_HAUS_MODEL',
  'HAI_TTS_HAUS_VOICE',
  'CONTENT_UPLOAD_KI_ALLOWED_HOSTS',
] as const;

const saved: Record<string, string | undefined> = {};
const realFetch = global.fetch;

function setEnv(values: Partial<Record<(typeof ENV_KEYS)[number], string>>) {
  for (const key of ENV_KEYS) delete process.env[key];
  for (const [key, value] of Object.entries(values)) {
    process.env[key] = value;
  }
}

const HAUS = {
  OPENAI_COMPATIBLE_API_KEY: SECRET,
  HAI_STT_HAUS_MODEL: 'whisper-1',
  HAI_TTS_HAUS_MODEL: 'tts-1',
  HAI_TTS_HAUS_VOICE: 'alloy',
};

async function load(
  options: {
    voiceEnabled?: boolean;
    signedIn?: boolean;
    settingsRows?: Array<{ key: string; value: unknown }>;
    settingsFail?: boolean;
  } = {}
) {
  jest.resetModules();
  mockSession(
    options.signedIn === false
      ? null
      : fakeSession({
          id: 'trainee-1',
          role: 'TRAINEE',
          isTrainerLevel: false,
        })
  );
  const rec = createTableDb({ haiSettings: options.settingsRows ?? [] });
  if (options.settingsFail) {
    rec.db.select = jest.fn(() => {
      throw new Error('relation "hai_settings" does not exist');
    });
  }
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  const isVoiceAssistantEnabled = jest.fn(
    async (_userId: string) => options.voiceEnabled !== false
  );
  jest.doMock('@/lib/hai/voiceAccess', () => ({
    __esModule: true,
    isVoiceAssistantEnabled,
  }));
  jest.spyOn(console, 'warn').mockImplementation(() => undefined);
  const config = (await import('@/app/api/hai/voice/config/route')) as any;
  const token = (await import('@/app/api/hai/voice/soniox-token/route')) as any;
  const transcribe =
    (await import('@/app/api/hai/voice/haus/transcribe/route')) as any;
  const speech = (await import('@/app/api/hai/voice/haus/speech/route')) as any;
  const warmup = (await import('@/app/api/hai/voice/warmup/route')) as any;
  return {
    warmup: warmup.POST as (req: unknown) => Promise<Response>,
    config: config.GET as (req: unknown) => Promise<Response>,
    token: token.POST as (req: unknown) => Promise<Response>,
    transcribe: transcribe.POST as (req: unknown) => Promise<Response>,
    speech: speech.POST as (req: unknown) => Promise<Response>,
    isVoiceAssistantEnabled,
  };
}

const get = (url: string) => makeRequest('GET', url, { token: 't' });
const post = (url: string, body: unknown, headers?: Record<string, string>) =>
  makeRequest('POST', url, { token: 't', body, headers });

function upload(
  size: number,
  headers?: Record<string, string>
): ReturnType<typeof makeRequest> {
  const form = new FormData();
  form.append(
    'audio',
    new Blob([new Uint8Array(size)], { type: 'audio/webm' })
  );
  return Object.assign(post('http://localhost/api/x', null, headers), {
    formData: async () => form,
  });
}

beforeEach(() => {
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  setEnv({});
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('who may call the voice routes', () => {
  it('turns an anonymous caller away with 401 on every route', async () => {
    const r = await load({ signedIn: false });
    for (const res of [
      await r.config(get('http://localhost/api/hai/voice/config')),
      await r.token(post('http://localhost/api/x', { purpose: 'stt' })),
      await r.transcribe(upload(10)),
      await r.speech(post('http://localhost/api/x', { text: 'Hallo' })),
      await r.warmup(post('http://localhost/api/x', {})),
    ]) {
      expect(res.status).toBe(401);
    }
    expect(r.isVoiceAssistantEnabled).not.toHaveBeenCalled();
  });

  it('answers 403 VOICE_DISABLED on every route when the organization has it off, and does nothing', async () => {
    setEnv({ SONIOX_API_KEY: SECRET, ...HAUS });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await load({ voiceEnabled: false });
    for (const res of [
      await r.config(get('http://localhost/api/hai/voice/config')),
      await r.token(post('http://localhost/api/x', { purpose: 'stt' })),
      await r.transcribe(upload(10)),
      await r.speech(post('http://localhost/api/x', { text: 'Hallo' })),
      await r.warmup(post('http://localhost/api/x', {})),
    ]) {
      expect(res.status).toBe(403);
      expect(await res.json()).toMatchObject({ code: 'VOICE_DISABLED' });
    }
    // no key was asked for, no audio or text went anywhere
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('GET /api/hai/voice/config', () => {
  it('without any key the browser alone is in charge', async () => {
    const r = await load();
    const res = await r.config(get('http://localhost/api/hai/voice/config'));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      provider: 'browser',
      chain: ['browser'],
      chains: { stt: ['browser'], tts: ['browser'] },
      region: null,
    });
  });

  it('with the key of Soniox: Soniox first, the browser behind, region EU, no key in the answer', async () => {
    setEnv({ SONIOX_API_KEY: SECRET });
    const r = await load();
    const res = await r.config(get('http://localhost/api/hai/voice/config'));
    const text = await res.text();
    expect(JSON.parse(text)).toEqual({
      provider: 'soniox',
      chain: ['soniox', 'browser'],
      chains: { stt: ['soniox', 'browser'], tts: ['soniox', 'browser'] },
      region: 'eu',
    });
    expect(text).not.toContain(SECRET);
  });

  it('follows the choice of the admin: Soniox, then Sokrates, then the browser', async () => {
    setEnv({ SONIOX_API_KEY: SECRET, ...HAUS });
    const r = await load({
      settingsRows: [
        { key: 'voice_provider_primary', value: 'soniox' },
        { key: 'voice_provider_fallback', value: 'haus' },
      ],
    });
    const body = await (
      await r.config(get('http://localhost/api/hai/voice/config'))
    ).json();
    expect(body.chain).toEqual(['soniox', 'haus', 'browser']);
  });

  it('Sokrates as the main provider is skipped while a variable is missing', async () => {
    setEnv({
      OPENAI_COMPATIBLE_API_KEY: SECRET,
      HAI_STT_HAUS_MODEL: 'whisper-1',
    });
    const r = await load({
      settingsRows: [
        { key: 'voice_provider_primary', value: 'haus' },
        { key: 'voice_provider_fallback', value: 'browser' },
      ],
    });
    const body = await (
      await r.config(get('http://localhost/api/hai/voice/config'))
    ).json();
    expect(body.chain).toEqual(['browser']);
  });

  it('uses the defaults while the table does not exist yet', async () => {
    setEnv({ SONIOX_API_KEY: SECRET });
    const r = await load({ settingsFail: true });
    const res = await r.config(get('http://localhost/api/hai/voice/config'));
    expect(res.status).toBe(200);
    expect((await res.json()).chain).toEqual(['soniox', 'browser']);
  });
});

describe('POST /api/hai/voice/soniox-token', () => {
  it('without a key: 503 NOT_CONFIGURED with the reason, nothing is asked', async () => {
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await load();
    const res = await r.token(
      post('http://localhost/api/x', { purpose: 'stt' })
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({
      error: 'Speech provider not available',
      code: 'NOT_CONFIGURED',
      reason: 'NO_KEY',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a listening key for the live mode gets the long session, the round the short one', async () => {
    setEnv({ SONIOX_API_KEY: SECRET });
    const bodies: Array<Record<string, unknown>> = [];
    global.fetch = (async (_url: string, init?: { body?: string }) => {
      bodies.push(JSON.parse(String(init?.body)));
      return new Response(JSON.stringify({ api_key: 'temp-key' }), {
        status: 201,
      });
    }) as unknown as typeof fetch;
    const r = await load();
    await r.token(post('http://localhost/api/x', { purpose: 'stt' }));
    await r.token(
      post('http://localhost/api/x', { purpose: 'stt', live: true })
    );
    await r.token(
      post('http://localhost/api/x', { purpose: 'stt', live: 'yes' })
    );
    // speaking has no live mode: the flag changes nothing
    await r.token(
      post('http://localhost/api/x', { purpose: 'tts', live: true })
    );
    expect(bodies.map(b => b.usage_type)).toEqual([
      'transcribe_websocket',
      'transcribe_websocket',
      'transcribe_websocket',
      'tts_rt',
    ]);
    expect(bodies.map(b => b.max_session_duration_seconds)).toEqual([
      180, 900, 180, 600,
    ]);
  });

  it.each([[{}], [{ purpose: 'admin' }], [null]])(
    'refuses the body %j with 400',
    async body => {
      setEnv({ SONIOX_API_KEY: SECRET });
      const r = await load();
      const res = await r.token(post('http://localhost/api/x', body));
      expect(res.status).toBe(400);
    }
  );

  it('hands out the short lived key and the config, never the real key', async () => {
    setEnv({ SONIOX_API_KEY: SECRET });
    const fetchMock = jest.fn(
      async () =>
        new Response(JSON.stringify({ api_key: 'temp-key' }), { status: 201 })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await load();
    const res = await r.token(
      post('http://localhost/api/x', { purpose: 'tts' })
    );
    const text = await res.text();
    expect(res.status).toBe(200);
    const body = JSON.parse(text);
    expect(body.apiKey).toBe('temp-key');
    expect(body.wsUrl).toBe('wss://tts-rt.eu.soniox.com/tts-websocket');
    expect(body.config.voice).toBeTruthy();
    expect(text).not.toContain(SECRET);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('Soniox refuses listening: 503 UPSTREAM_FAILED, and the config leaves Soniox out of the listening chain only', async () => {
    setEnv({ SONIOX_API_KEY: SECRET });
    global.fetch = (async () =>
      new Response('no', { status: 401 })) as unknown as typeof fetch;
    const r = await load();
    const res = await r.token(
      post('http://localhost/api/x', { purpose: 'stt' })
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      code: 'UPSTREAM_FAILED',
      reason: 'UPSTREAM_REFUSED',
    });
    const config = await (
      await r.config(get('http://localhost/api/hai/voice/config'))
    ).json();
    // changed on purpose: it used to be ['browser'] for both functions
    expect(config.chains).toEqual({
      stt: ['browser'],
      tts: ['soniox', 'browser'],
    });
    // the list older browsers read still holds Soniox: it can still speak
    expect(config.chain).toEqual(['soniox', 'browser']);
    expect(config.provider).toBe('soniox');
  });

  it('Soniox refuses speaking: it leaves the speaking chain only, listening stays', async () => {
    setEnv({ SONIOX_API_KEY: SECRET });
    global.fetch = (async () =>
      new Response('no', { status: 401 })) as unknown as typeof fetch;
    const r = await load();
    expect(
      (await r.token(post('http://localhost/api/x', { purpose: 'tts' }))).status
    ).toBe(503);
    const config = await (
      await r.config(get('http://localhost/api/hai/voice/config'))
    ).json();
    expect(config.chains).toEqual({
      stt: ['soniox', 'browser'],
      tts: ['browser'],
    });
    expect(config.chain).toEqual(['soniox', 'browser']);
  });

  it('Soniox refuses both: both chains and the list leave it out; a working call of one function frees only that one', async () => {
    setEnv({ SONIOX_API_KEY: SECRET });
    let refuse = true;
    global.fetch = (async () =>
      refuse
        ? new Response('no', { status: 401 })
        : new Response(JSON.stringify({ api_key: 'k' }), {
            status: 201,
          })) as unknown as typeof fetch;
    const r = await load();
    const ask = (purpose: string) =>
      r.token(post('http://localhost/api/x', { purpose }));
    const chains = async () =>
      (
        await (
          await r.config(get('http://localhost/api/hai/voice/config'))
        ).json()
      ).chains;
    expect((await ask('stt')).status).toBe(503);
    expect((await ask('tts')).status).toBe(503);
    const both = await (
      await r.config(get('http://localhost/api/hai/voice/config'))
    ).json();
    expect(both.chains).toEqual({ stt: ['browser'], tts: ['browser'] });
    expect(both.chain).toEqual(['browser']);
    // Soniox answers again: the call for speaking works, listening is still out
    refuse = false;
    expect((await ask('tts')).status).toBe(200);
    expect(await chains()).toEqual({
      stt: ['browser'],
      tts: ['soniox', 'browser'],
    });
  });

  it('limits the calls per person', async () => {
    setEnv({ SONIOX_API_KEY: SECRET });
    global.fetch = (async () =>
      new Response(JSON.stringify({ api_key: 'k' }), {
        status: 201,
      })) as unknown as typeof fetch;
    const r = await load();
    let last = 200;
    for (let i = 0; i < 41; i++) {
      last = (await r.token(post('http://localhost/api/x', { purpose: 'stt' })))
        .status;
    }
    expect(last).toBe(429);
  });
});

describe('POST /api/hai/voice/haus/transcribe', () => {
  it('without the models: 503 NOT_CONFIGURED with the reason', async () => {
    setEnv({ OPENAI_COMPATIBLE_API_KEY: SECRET });
    const r = await load();
    const res = await r.transcribe(upload(100));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      code: 'NOT_CONFIGURED',
      reason: 'NO_STT_MODEL',
    });
  });

  it('refuses a recording that is too large (declared and actual) with 413', async () => {
    setEnv(HAUS);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await load();
    expect(
      (
        await r.transcribe(
          upload(10, { 'content-length': String(6 * 1024 * 1024) })
        )
      ).status
    ).toBe(413);
    expect((await r.transcribe(upload(5 * 1024 * 1024 + 1))).status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses an empty recording and a body without a file with 400', async () => {
    setEnv(HAUS);
    const r = await load();
    expect((await r.transcribe(upload(0))).status).toBe(400);
    const noFile = Object.assign(post('http://localhost/api/x', null), {
      formData: async () => new FormData(),
    });
    expect((await r.transcribe(noFile)).status).toBe(400);
    const broken = Object.assign(post('http://localhost/api/x', null), {
      formData: async () => {
        throw new Error('not multipart');
      },
    });
    expect((await r.transcribe(broken)).status).toBe(400);
  });

  it('passes the recording on to Sokrates and returns the text', async () => {
    setEnv(HAUS);
    const fetchMock = jest.fn(
      async () => new Response(JSON.stringify({ text: 'Was ist ein Join?' }))
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await load();
    const res = await r.transcribe(upload(2048));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'Was ist ein Join?' });
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(
      'https://sokrates.test-qualitaetsmanagement.com/api/v1/audio/transcriptions'
    );
  });

  it('Open WebUI answers { text, filename }: the client gets only the text', async () => {
    setEnv(HAUS);
    global.fetch = (async () =>
      new Response(
        JSON.stringify({ text: 'Was ist ein Join?', filename: 'a.webm' })
      )) as unknown as typeof fetch;
    const r = await load();
    const res = await r.transcribe(upload(2048));
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ text: 'Was ist ein Join?' });
  });

  it('a 500 of the speech service behind Open WebUI: 503 UPSTREAM_FAILED, then the config leaves Sokrates out of the listening chain for a while (the browser listens), speaking stays', async () => {
    setEnv(HAUS);
    global.fetch = (async () =>
      new Response('{"detail":"Internal Server Error"}', {
        status: 500,
      })) as unknown as typeof fetch;
    const r = await load({
      settingsRows: [
        { key: 'voice_provider_primary', value: 'haus' },
        { key: 'voice_provider_fallback', value: 'browser' },
      ],
    });
    const before = await (
      await r.config(get('http://localhost/api/hai/voice/config'))
    ).json();
    expect(before.chain).toEqual(['haus', 'browser']);
    const res = await r.transcribe(upload(100));
    expect(res.status).toBe(503);
    const body = await res.json();
    expect(body).toMatchObject({
      code: 'UPSTREAM_FAILED',
      reason: 'UPSTREAM_UNAVAILABLE',
    });
    // the answer names no address, no key and no model
    expect(JSON.stringify(body)).not.toMatch(
      /sokrates|whisper|tts-1|alloy|sk-real/i
    );
    const after = await (
      await r.config(get('http://localhost/api/hai/voice/config'))
    ).json();
    // changed on purpose: it used to be ['browser'] for both functions
    expect(after.chains).toEqual({
      stt: ['browser'],
      tts: ['haus', 'browser'],
    });
    expect(after.chain).toEqual(['haus', 'browser']);
  });

  it('Sokrates does not offer the model: 503, the client falls back', async () => {
    setEnv(HAUS);
    global.fetch = (async () =>
      new Response('no such model', {
        status: 404,
      })) as unknown as typeof fetch;
    const r = await load();
    const res = await r.transcribe(upload(100));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      code: 'NOT_CONFIGURED',
      reason: 'MODEL_NOT_OFFERED',
    });
  });

  it('Sokrates is down: 503 UPSTREAM_FAILED', async () => {
    setEnv(HAUS);
    global.fetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const r = await load();
    const res = await r.transcribe(upload(100));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      code: 'UPSTREAM_FAILED',
      reason: 'UPSTREAM_UNAVAILABLE',
    });
  });
});

describe('POST /api/hai/voice/haus/speech', () => {
  it('without model or voice: 503 NOT_CONFIGURED with the reason', async () => {
    setEnv({ ...HAUS, HAI_TTS_HAUS_VOICE: '' });
    const r = await load();
    const res = await r.speech(
      post('http://localhost/api/x', { text: 'Hallo' })
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({
      code: 'NOT_CONFIGURED',
      reason: 'NO_TTS_VOICE',
    });
  });

  it.each([[{}], [{ text: '' }], [{ text: '   ' }], [{ text: 5 }], [null]])(
    'refuses the body %j with 400',
    async body => {
      setEnv(HAUS);
      const r = await load();
      expect(
        (await r.speech(post('http://localhost/api/x', body))).status
      ).toBe(400);
    }
  );

  it('refuses a text of more than 1000 characters with 413', async () => {
    setEnv(HAUS);
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await load();
    const res = await r.speech(
      post('http://localhost/api/x', { text: 'a'.repeat(1001) })
    );
    expect(res.status).toBe(413);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('returns the audio of Sokrates as WAV', async () => {
    setEnv(HAUS);
    global.fetch = (async () =>
      new Response(
        new Uint8Array([82, 73, 70, 70])
      )) as unknown as typeof fetch;
    const r = await load();
    const res = await r.speech(
      post('http://localhost/api/x', { text: 'Hallo.' })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/wav');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(
      new Uint8Array([82, 73, 70, 70])
    );
  });

  it('passes the MP3 of Open WebUI on as audio/mpeg, byte for byte, from /v1/audio/speech', async () => {
    setEnv(HAUS);
    const mp3 = new Uint8Array([0x49, 0x44, 0x33, 4, 0, 0, 1, 2, 3, 4]);
    const fetchMock = jest.fn(
      async () =>
        new Response(mp3, {
          status: 200,
          headers: { 'Content-Type': 'audio/mpeg' },
        })
    );
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await load();
    const res = await r.speech(
      post('http://localhost/api/x', { text: 'Hallo.' })
    );
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('audio/mpeg');
    expect(new Uint8Array(await res.arrayBuffer())).toEqual(mp3);
    const [url] = fetchMock.mock.calls[0] as unknown as [string];
    expect(url).toBe(
      'https://sokrates.test-qualitaetsmanagement.com/api/v1/audio/speech'
    );
  });

  it('Sokrates fails: 503 and the client falls back', async () => {
    setEnv(HAUS);
    global.fetch = (async () =>
      new Response('err', { status: 500 })) as unknown as typeof fetch;
    const r = await load();
    const res = await r.speech(
      post('http://localhost/api/x', { text: 'Hallo.' })
    );
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ code: 'UPSTREAM_FAILED' });
  });

  it('Sokrates cannot speak: it leaves the speaking chain only, listening stays', async () => {
    setEnv(HAUS);
    global.fetch = (async () =>
      new Response('err', { status: 500 })) as unknown as typeof fetch;
    const r = await load({
      settingsRows: [
        { key: 'voice_provider_primary', value: 'haus' },
        { key: 'voice_provider_fallback', value: 'browser' },
      ],
    });
    expect(
      (await r.speech(post('http://localhost/api/x', { text: 'Hallo.' })))
        .status
    ).toBe(503);
    const config = await (
      await r.config(get('http://localhost/api/hai/voice/config'))
    ).json();
    expect(config.chains).toEqual({
      stt: ['haus', 'browser'],
      tts: ['browser'],
    });
    expect(config.chain).toEqual(['haus', 'browser']);
  });

  it('Sokrates fails in both functions: both chains and the list end at the browser', async () => {
    setEnv(HAUS);
    global.fetch = (async () =>
      new Response('err', { status: 500 })) as unknown as typeof fetch;
    const r = await load({
      settingsRows: [
        { key: 'voice_provider_primary', value: 'haus' },
        { key: 'voice_provider_fallback', value: 'browser' },
      ],
    });
    await r.speech(post('http://localhost/api/x', { text: 'Hallo.' }));
    await r.transcribe(upload(100));
    const config = await (
      await r.config(get('http://localhost/api/hai/voice/config'))
    ).json();
    expect(config.chains).toEqual({ stt: ['browser'], tts: ['browser'] });
    expect(config.chain).toEqual(['browser']);
    expect(config.provider).toBe('browser');
  });
});

describe('POST /api/hai/voice/warmup', () => {
  it('pings the own server with the key as bearer, a time limit and nothing in the body', async () => {
    setEnv({
      OPENAI_COMPATIBLE_API_KEY: SECRET,
      OPENAI_COMPATIBLE_BASE_URL: 'https://sokrates.example/api/',
    });
    const calls: Array<{ url: string; init: Record<string, any> }> = [];
    global.fetch = (async (url: string, init: Record<string, any>) => {
      calls.push({ url, init });
      return new Response('{"data":[]}', { status: 200 });
    }) as unknown as typeof fetch;
    const r = await load();
    const res = await r.warmup(post('http://localhost/api/x', {}));
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.warmed).toBe(true);
    expect(typeof body.ms).toBe('number');
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://sokrates.example/api/models');
    expect(calls[0].init.method).toBe('GET');
    expect(calls[0].init.body).toBeUndefined();
    expect(calls[0].init.signal).toBeInstanceOf(AbortSignal);
    expect(calls[0].init.headers.Authorization).toBe(`Bearer ${SECRET}`);
    // the answer carries no key and no content
    expect(JSON.stringify(body)).not.toContain(SECRET);
    expect(res.headers.get('cache-control')).toContain('no-store');
  });

  it('calls no provider outside the house: chat and search run elsewhere', async () => {
    setEnv({
      OPENAI_COMPATIBLE_API_KEY: SECRET,
      HAI_CHAT_PROVIDER: 'gemini',
      HAI_EMBEDDING_PROVIDER: 'gemini',
    });
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await load();
    const res = await r.warmup(post('http://localhost/api/x', {}));
    expect(await res.json()).toEqual({ warmed: false, ms: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does nothing without a key for the own server', async () => {
    setEnv({});
    const fetchMock = jest.fn();
    global.fetch = fetchMock as unknown as typeof fetch;
    const r = await load();
    const res = await r.warmup(post('http://localhost/api/x', {}));
    expect(await res.json()).toEqual({ warmed: false, ms: 0 });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a server that is not reachable is no error: warmed false, 200', async () => {
    setEnv({ OPENAI_COMPATIBLE_API_KEY: SECRET });
    global.fetch = (async () => {
      throw new Error('ECONNREFUSED');
    }) as unknown as typeof fetch;
    const r = await load();
    const res = await r.warmup(post('http://localhost/api/x', {}));
    expect(res.status).toBe(200);
    expect((await res.json()).warmed).toBe(false);
  });

  it('a server that does not answer in time is given up after three seconds', async () => {
    setEnv({ OPENAI_COMPATIBLE_API_KEY: SECRET });
    jest.useFakeTimers();
    try {
      global.fetch = ((_url: string, init: { signal: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          init.signal.addEventListener('abort', () =>
            reject(new Error('aborted'))
          );
        })) as unknown as typeof fetch;
      const r = await load();
      const pending = r.warmup(post('http://localhost/api/x', {}));
      await jest.advanceTimersByTimeAsync(3_100);
      const res = await pending;
      expect((await res.json()).warmed).toBe(false);
    } finally {
      jest.useRealTimers();
    }
  });

  it('a person who calls it in a loop is slowed down: 429 after twenty calls in a minute', async () => {
    setEnv({ OPENAI_COMPATIBLE_API_KEY: SECRET });
    global.fetch = (async () =>
      new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const r = await load();
    let last = 200;
    for (let i = 0; i < 22; i++) {
      last = (await r.warmup(post('http://localhost/api/x', {}))).status;
    }
    expect(last).toBe(429);
  });
});
