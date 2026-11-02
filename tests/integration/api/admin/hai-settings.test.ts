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
  traineeSession,
} from '../../../helpers/mockNext';

// The HAI admin routes (speech provider of the voice assistant): only the platform
// admin may read or change the settings and see the state of the providers. The
// values are validated, the admin who saved is written down, and no answer carries
// a key, an address or a model name.

const SECRET = 'sk-real-secret-value';
const ENV_KEYS = [
  'SONIOX_API_KEY',
  'SONIOX_REGION',
  'OPENAI_COMPATIBLE_API_KEY',
  'OPENAI_COMPATIBLE_BASE_URL',
  'HAI_STT_HAUS_MODEL',
  'HAI_TTS_HAUS_MODEL',
  'HAI_TTS_HAUS_VOICE',
] as const;
const saved: Record<string, string | undefined> = {};
const realFetch = global.fetch;

const SUPER = fakeSession({
  id: 'super-1',
  role: 'SUPER_ADMIN',
  isSuperAdmin: true,
  isAdmin: true,
  isPlatformOwner: true,
});

type Caller = ReturnType<typeof fakeSession> | null;

async function load(
  caller: Caller,
  options: {
    rows?: Array<{ key: string; value: unknown }>;
    insertFails?: boolean;
  } = {}
) {
  jest.resetModules();
  mockSession(caller);
  const rec = createTableDb({ haiSettings: options.rows ?? [] });
  if (options.insertFails) {
    rec.db.insert = jest.fn(() => {
      throw new Error('relation "hai_settings" does not exist');
    });
  }
  jest.doMock('@/db', () => ({ __esModule: true, default: rec.db }));
  jest.spyOn(console, 'error').mockImplementation(() => undefined);
  const settings = (await import('@/app/api/admin/hai/settings/route')) as any;
  const status =
    (await import('@/app/api/admin/hai/voice-status/route')) as any;
  return {
    rec,
    getSettings: settings.GET as (r: unknown) => Promise<Response>,
    putSettings: settings.PUT as (r: unknown) => Promise<Response>,
    status: status.GET as (r: unknown) => Promise<Response>,
  };
}

const get = () =>
  makeRequest('GET', 'http://localhost/api/admin/hai/x', { token: 't' });
const put = (body: unknown) =>
  makeRequest('PUT', 'http://localhost/api/admin/hai/settings', {
    token: 't',
    body,
  });

beforeEach(() => {
  for (const key of ENV_KEYS) {
    saved[key] = process.env[key];
    delete process.env[key];
  }
});
afterEach(() => {
  for (const key of ENV_KEYS) {
    if (saved[key] === undefined) delete process.env[key];
    else process.env[key] = saved[key];
  }
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

describe('who may use the HAI admin routes', () => {
  const callers: Array<[string, Caller, number]> = [
    ['anonymous', null, 401],
    ['a trainee', traineeSession('t1'), 403],
    ['a trainer', fakeSession({ role: 'TRAINER' }), 403],
    [
      'an ADMIN of a customer organization',
      fakeSession({
        role: 'ADMIN',
        isAdmin: true,
        isSuperAdmin: false,
        isPlatformOwner: false,
      }),
      403,
    ],
  ];

  it.each(callers)(
    '%s is turned away on all three routes',
    async (_n, caller, code) => {
      const r = await load(caller);
      expect((await r.getSettings(get())).status).toBe(code);
      expect((await r.putSettings(put({ primary: 'haus' }))).status).toBe(code);
      expect((await r.status(get())).status).toBe(code);
      // nothing was written
      expect(r.rec.db.insert).not.toHaveBeenCalled();
    }
  );
});

describe('GET /api/admin/hai/settings', () => {
  it('returns the defaults while nothing is stored, and the options', async () => {
    const r = await load(SUPER);
    const res = await r.getSettings(get());
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: { primary: 'soniox', fallback: 'browser' },
      options: {
        primary: ['soniox', 'haus', 'browser'],
        fallback: ['haus', 'browser'],
      },
    });
  });

  it('returns what was stored', async () => {
    const r = await load(SUPER, {
      rows: [
        { key: 'voice_provider_primary', value: 'haus' },
        { key: 'voice_provider_fallback', value: 'browser' },
      ],
    });
    const body = await (await r.getSettings(get())).json();
    expect(body.settings).toEqual({ primary: 'haus', fallback: 'browser' });
  });
});

describe('PUT /api/admin/hai/settings', () => {
  it('saves both choices in one statement and writes down who saved', async () => {
    const r = await load(SUPER);
    const res = await r.putSettings(
      put({ primary: 'haus', fallback: 'browser' })
    );
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      settings: { primary: 'haus', fallback: 'browser' },
    });
    const writes = r.rec.writes('insert', 'hai_settings');
    expect(writes).toHaveLength(1);
    expect(writes[0]).toEqual([
      { key: 'voice_provider_primary', value: 'haus', updatedBy: 'super-1' },
      {
        key: 'voice_provider_fallback',
        value: 'browser',
        updatedBy: 'super-1',
      },
    ]);
  });

  it('a field that is left out keeps its value', async () => {
    const r = await load(SUPER, {
      rows: [
        { key: 'voice_provider_primary', value: 'soniox' },
        { key: 'voice_provider_fallback', value: 'browser' },
      ],
    });
    const res = await r.putSettings(put({ fallback: 'haus' }));
    expect(await res.json()).toEqual({
      settings: { primary: 'soniox', fallback: 'haus' },
    });
  });

  it.each([
    [{ primary: 'google' }, 'INVALID_PRIMARY'],
    [{ fallback: 'soniox' }, 'INVALID_FALLBACK'],
    [{ primary: 'browser', fallback: 'browser' }, 'SAME_PROVIDER'],
    [{}, 'NOTHING_TO_UPDATE'],
    [{ primary: 'haus', note: 'x' }, 'INVALID_BODY'],
    [null, 'INVALID_BODY'],
  ])('refuses %j with 400 %s and writes nothing', async (body, code) => {
    const r = await load(SUPER);
    const res = await r.putSettings(put(body));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: 'Invalid settings', code });
    expect(r.rec.db.insert).not.toHaveBeenCalled();
  });

  it('tells the admin when the choice could not be saved', async () => {
    const r = await load(SUPER, { insertFails: true });
    const res = await r.putSettings(put({ primary: 'haus' }));
    expect(res.status).toBe(500);
    expect(await res.json()).toEqual({
      error: 'Settings could not be saved',
      code: 'SAVE_FAILED',
    });
  });
});

describe('GET /api/admin/hai/voice-status', () => {
  it('nothing is set up: Soniox and Sokrates say why, the browser is ready', async () => {
    const r = await load(SUPER);
    const body = await (await r.status(get())).json();
    expect(body.providers.soniox).toMatchObject({
      status: 'not_configured',
      reason: 'NO_KEY',
      keySet: false,
    });
    expect(body.providers.haus).toMatchObject({
      status: 'not_configured',
      reason: 'NO_KEY',
      keySet: false,
    });
    expect(body.providers.browser).toEqual({
      id: 'browser',
      status: 'ready',
      reason: null,
    });
    expect(body.effective).toEqual({ provider: 'browser', chain: ['browser'] });
  });

  it('everything set up and reachable: ready, and no value of a variable in the answer', async () => {
    process.env.SONIOX_API_KEY = SECRET;
    process.env.OPENAI_COMPATIBLE_API_KEY = SECRET;
    process.env.HAI_STT_HAUS_MODEL = 'whisper-private-model';
    process.env.HAI_TTS_HAUS_MODEL = 'tts-private-model';
    process.env.HAI_TTS_HAUS_VOICE = 'private-voice';
    global.fetch = (async () =>
      new Response(
        JSON.stringify({
          data: [{ id: 'whisper-private-model' }, { id: 'tts-private-model' }],
        })
      )) as unknown as typeof fetch;
    const r = await load(SUPER);
    const res = await r.status(get());
    const text = await res.text();
    const body = JSON.parse(text);
    expect(body.providers.soniox).toMatchObject({
      status: 'ready',
      keySet: true,
      region: 'eu',
    });
    expect(body.providers.haus).toMatchObject({
      status: 'ready',
      keySet: true,
      reachable: true,
      sttOffered: true,
      ttsOffered: true,
    });
    expect(body.effective.chain).toEqual(['soniox', 'browser']);
    for (const value of [
      SECRET,
      'whisper-private-model',
      'tts-private-model',
      'private-voice',
      'sokrates.test-qualitaetsmanagement.com',
    ]) {
      expect(text).not.toContain(value);
    }
  });

  it('Sokrates is configured but does not answer: disturbed, UNREACHABLE', async () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = SECRET;
    process.env.HAI_STT_HAUS_MODEL = 'whisper-1';
    process.env.HAI_TTS_HAUS_MODEL = 'tts-1';
    process.env.HAI_TTS_HAUS_VOICE = 'alloy';
    global.fetch = (async () => {
      throw new Error('offline');
    }) as unknown as typeof fetch;
    const r = await load(SUPER);
    const body = await (await r.status(get())).json();
    expect(body.providers.haus).toMatchObject({
      status: 'disturbed',
      reason: 'UNREACHABLE',
      reachable: false,
    });
  });

  it('Sokrates does not list the audio model: not set up, MODEL_NOT_OFFERED', async () => {
    process.env.OPENAI_COMPATIBLE_API_KEY = SECRET;
    process.env.HAI_STT_HAUS_MODEL = 'whisper-1';
    process.env.HAI_TTS_HAUS_MODEL = 'tts-1';
    process.env.HAI_TTS_HAUS_VOICE = 'alloy';
    global.fetch = (async () =>
      new Response(
        JSON.stringify({ data: [{ id: 'whisper-1' }] })
      )) as unknown as typeof fetch;
    const r = await load(SUPER);
    const body = await (await r.status(get())).json();
    expect(body.providers.haus).toMatchObject({
      status: 'not_configured',
      reason: 'MODEL_NOT_OFFERED',
      sttOffered: true,
      ttsOffered: false,
    });
  });
});
