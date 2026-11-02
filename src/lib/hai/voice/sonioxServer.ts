/**
 * Soniox for the voice assistant, the server part.
 *
 * The browser talks to Soniox directly over a websocket (speech recognition and
 * speech output). The server never carries audio. It only holds the real key
 * (SONIOX_API_KEY, never sent to the browser) and hands out a SHORT LIVED key
 * for one connection, as Soniox documents it (POST /v1/auth/temporary-api-key,
 * https://docs.soniox.com/stt/api-reference/auth/create_temporary_api_key).
 *
 * Region: SONIOX_REGION is `eu` (default, the data stays in the European Union)
 * or `us`. The key of a Soniox project belongs to ONE region and must be used with
 * the hosts of that region (https://docs.soniox.com/data-residency):
 *   eu  api.eu.soniox.com, stt-rt.eu.soniox.com, tts-rt.eu.soniox.com
 *   us  api.soniox.com,    stt-rt.soniox.com,    tts-rt.soniox.com
 *
 * Nothing here logs or returns the real key. Reasons are stable codes.
 *
 * @module lib/hai/voice/sonioxServer
 */

export type SonioxRegion = 'eu' | 'us';
export type SonioxReason = 'NO_KEY' | 'BAD_REGION';
export type SonioxPurpose = 'stt' | 'tts';

export type Env = Readonly<Record<string, string | undefined>>;

export interface SonioxConfig {
  apiKey: string;
  region: SonioxRegion;
  apiBase: string;
  sttWsUrl: string;
  ttsWsUrl: string;
  ttsVoice: string;
}

export type SonioxConfigResult =
  | { ok: true; config: SonioxConfig }
  | { ok: false; reason: SonioxReason };

export const SONIOX_ENV = Object.freeze({
  apiKey: 'SONIOX_API_KEY',
  region: 'SONIOX_REGION',
  ttsVoice: 'SONIOX_TTS_VOICE',
} as const);

/** Real-time speech recognition model (the docs name it in their examples). */
export const STT_MODEL = 'stt-rt-v5';
/** Real-time speech output model, the production model (tts-rt-v1 is retired). */
export const TTS_MODEL = 'tts-rt-v2';
/** A German voice that Soniox lists; every voice speaks every language. */
export const DEFAULT_TTS_VOICE = 'Lena';
/** Speaking speed (0.7 to 1.3 allowed), a little faster than the default. */
export const TTS_SPEED = 1.2;
export const TTS_SAMPLE_RATE = 24_000;

/** The key lives this long, it is used at once to open the connection. */
export const KEY_VALID_SECONDS = 90;
/** One recognition round (one utterance) never needs more than this. */
export const STT_SESSION_SECONDS = 180;
/** One answer read aloud never needs more than this. */
export const TTS_SESSION_SECONDS = 600;
/** The call to Soniox gives up after this many milliseconds. */
export const TOKEN_TIMEOUT_MS = 8_000;

const HOSTS: Record<SonioxRegion, { api: string; stt: string; tts: string }> = {
  eu: {
    api: 'https://api.eu.soniox.com',
    stt: 'wss://stt-rt.eu.soniox.com/transcribe-websocket',
    tts: 'wss://tts-rt.eu.soniox.com/tts-websocket',
  },
  us: {
    api: 'https://api.soniox.com',
    stt: 'wss://stt-rt.soniox.com/transcribe-websocket',
    tts: 'wss://tts-rt.soniox.com/tts-websocket',
  },
};

/** A voice name is plain letters and digits, it goes into the config of the stream. */
function voiceOf(raw: string | undefined): string {
  const name = (raw ?? '').trim();
  return /^[A-Za-z0-9][A-Za-z0-9 _-]{0,39}$/.test(name)
    ? name
    : DEFAULT_TTS_VOICE;
}

/**
 * The Soniox settings from the environment, or the stable reason why Soniox is
 * not set up. Pure (reads only its argument). The value of the key never appears
 * in the result of a failure.
 */
export function loadSonioxConfig(env: Env): SonioxConfigResult {
  const key = (env[SONIOX_ENV.apiKey] ?? '').trim();
  // a key with a space or a line break cannot be a bearer token (header injection)
  if (key.length === 0 || /[\s\u0000-\u001f\u007f]/.test(key)) {
    return { ok: false, reason: 'NO_KEY' };
  }
  const rawRegion = (env[SONIOX_ENV.region] ?? '').trim().toLowerCase();
  const region = rawRegion === '' ? 'eu' : rawRegion;
  if (region !== 'eu' && region !== 'us') {
    return { ok: false, reason: 'BAD_REGION' };
  }
  const hosts = HOSTS[region];
  return {
    ok: true,
    config: {
      apiKey: key,
      region,
      apiBase: hosts.api,
      sttWsUrl: hosts.stt,
      ttsWsUrl: hosts.tts,
      ttsVoice: voiceOf(env[SONIOX_ENV.ttsVoice]),
    },
  };
}

/** What the browser sends first to the recognition websocket (the key goes in the handshake). */
export function sttSessionConfig() {
  return {
    model: STT_MODEL,
    audio_format: 'auto' as const,
    language_hints: ['de'],
    enable_endpoint_detection: true,
    max_endpoint_delay_ms: 1_500,
    // Words the model would otherwise mishear. They weigh, they do not restrict.
    context: {
      general: [
        { key: 'domain', value: 'Vocational training in IT in Germany' },
        {
          key: 'topic',
          value:
            'Questions of apprentices to the learning assistant HAI of the platform Wamocon (learning fields, exams, training records)',
        },
      ],
      terms: [
        'HAI',
        'Wamocon',
        'Fachinformatiker',
        'Anwendungsentwicklung',
        'Systemintegration',
        'Lernfeld',
        'Lernfelder',
        'Ausbildungsnachweis',
        'Berichtsheft',
        'IHK',
        'Azubi',
      ],
    },
  };
}

/** What the browser sends to open one speech output stream (the key goes in the handshake). */
export function ttsStreamConfig(config: SonioxConfig) {
  return {
    model: TTS_MODEL,
    language: 'de',
    voice: config.ttsVoice,
    audio_format: 'pcm_s16le' as const,
    sample_rate: TTS_SAMPLE_RATE,
    speed: TTS_SPEED,
  };
}

export interface SonioxTokenGrant {
  apiKey: string;
  wsUrl: string;
  expiresInSeconds: number;
  /** What the browser sends first on the websocket (without any key). */
  config:
    | ReturnType<typeof sttSessionConfig>
    | ReturnType<typeof ttsStreamConfig>;
}

export type SonioxTokenFailure =
  | 'UPSTREAM_REFUSED'
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_BAD_ANSWER';

export type SonioxTokenResult =
  | { ok: true; grant: SonioxTokenGrant }
  | { ok: false; reason: SonioxTokenFailure; status: number | null };

/**
 * Asks Soniox for a short lived key for one purpose. `fetchImpl` is replaceable
 * for tests. The real key is only used as the bearer token of this call.
 */
export async function createSonioxToken(
  config: SonioxConfig,
  purpose: SonioxPurpose,
  clientReference: string,
  fetchImpl: typeof fetch = fetch
): Promise<SonioxTokenResult> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TOKEN_TIMEOUT_MS);
  try {
    const response = await fetchImpl(
      `${config.apiBase}/v1/auth/temporary-api-key`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          usage_type: purpose === 'stt' ? 'transcribe_websocket' : 'tts_rt',
          expires_in_seconds: KEY_VALID_SECONDS,
          max_session_duration_seconds:
            purpose === 'stt' ? STT_SESSION_SECONDS : TTS_SESSION_SECONDS,
          client_reference_id: clientReference.slice(0, 256),
        }),
        signal: controller.signal,
        cache: 'no-store',
      }
    );
    if (response.status === 400 || response.status === 401) {
      return { ok: false, reason: 'UPSTREAM_REFUSED', status: response.status };
    }
    if (!response.ok) {
      return {
        ok: false,
        reason: 'UPSTREAM_UNAVAILABLE',
        status: response.status,
      };
    }
    const data = (await response.json().catch(() => null)) as {
      api_key?: unknown;
    } | null;
    if (typeof data?.api_key !== 'string' || data.api_key.length === 0) {
      return { ok: false, reason: 'UPSTREAM_BAD_ANSWER', status: null };
    }
    return {
      ok: true,
      grant: {
        apiKey: data.api_key,
        wsUrl: purpose === 'stt' ? config.sttWsUrl : config.ttsWsUrl,
        expiresInSeconds: KEY_VALID_SECONDS,
        config:
          purpose === 'stt' ? sttSessionConfig() : ttsStreamConfig(config),
      },
    };
  } catch {
    // network error or timeout: nothing of the request or the key is kept
    return { ok: false, reason: 'UPSTREAM_UNAVAILABLE', status: null };
  } finally {
    clearTimeout(timer);
  }
}
