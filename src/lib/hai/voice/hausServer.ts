/**
 * Sokrates ("Haus") for the voice assistant, the server part.
 *
 * Sokrates is the own AI server (Open WebUI or LiteLLM in front of the models).
 * Speech recognition and speech output go through the OpenAI compatible audio
 * endpoints of the same address as the chat:
 *   POST <base>/audio/transcriptions   multipart: file, model, language
 *   POST <base>/audio/speech           JSON: model, input, voice, response_format
 * Behind Open WebUI (the address of the chat ends in /api) the audio routes are
 * <base>/v1/audio/..., see audioUrl. Open WebUI answers speech output as MP3 and uses
 * the engines and voices it is set up with, model and voice are only names for it.
 * The audio therefore passes this server and goes on to Sokrates, it is not
 * stored and not logged. The audio never leaves the own infrastructure.
 *
 * Configuration (all from the environment, never from the browser):
 *   OPENAI_COMPATIBLE_BASE_URL   the address (same variable as the chat)
 *   OPENAI_COMPATIBLE_API_KEY    the key (same variable as the chat)
 *   HAI_STT_HAUS_MODEL           model for speech recognition, for example a Whisper model
 *   HAI_TTS_HAUS_MODEL           model for speech output
 *   HAI_TTS_HAUS_VOICE           voice for speech output
 * The address is checked like the address of the content upload (https, no
 * credentials or query, host on the positive list of
 * CONTENT_UPLOAD_KI_ALLOWED_HOSTS), so a wrong value never sends audio to a
 * foreign server. If one value is missing, Sokrates is "not set up" with the
 * stable reason, and the routes answer 503 so that the client falls back.
 *
 * @module lib/hai/voice/hausServer
 */

import {
  SOKRATES_DEFAULT_BASE_URL,
  allowedHostsOf,
  parseTarget,
} from '@/lib/content-upload/ki/config';
import {
  call,
  type HausConnection,
  type HausSttConfig,
  type HausTtsConfig,
} from './hausAudio';

export {
  MAX_SPEECH_BYTES,
  MAX_TRANSCRIPT_CHARS,
  STT_TIMEOUT_MS,
  TTS_TIMEOUT_MS,
  audioUrl,
  hausSpeech,
  hausTranscribe,
} from './hausAudio';
export type {
  HausConnection,
  HausFailure,
  HausSttConfig,
  HausTtsConfig,
  SpeechResult,
  TranscribeResult,
} from './hausAudio';

export type Env = Readonly<Record<string, string | undefined>>;

export type HausReason =
  | 'NO_KEY'
  | 'BAD_URL'
  | 'HOST_NOT_ALLOWED'
  | 'NO_STT_MODEL'
  | 'NO_TTS_MODEL'
  | 'NO_TTS_VOICE'
  | 'MODEL_NOT_OFFERED'
  | 'UNREACHABLE';

export const HAUS_ENV = Object.freeze({
  baseUrl: 'OPENAI_COMPATIBLE_BASE_URL',
  apiKey: 'OPENAI_COMPATIBLE_API_KEY',
  sttModel: 'HAI_STT_HAUS_MODEL',
  ttsModel: 'HAI_TTS_HAUS_MODEL',
  ttsVoice: 'HAI_TTS_HAUS_VOICE',
} as const);

export const MODELS_TIMEOUT_MS = 5_000;

export type HausConnectionResult =
  | { ok: true; connection: HausConnection }
  | { ok: false; reason: 'NO_KEY' | 'BAD_URL' | 'HOST_NOT_ALLOWED' };

const MODEL_NAME = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,99}$/;
const VOICE_NAME = /^[A-Za-z0-9][A-Za-z0-9 ._:/-]{0,59}$/;

/** The checked address and key of Sokrates, or the reason why there are none. */
export function loadHausConnection(env: Env): HausConnectionResult {
  const key = (env[HAUS_ENV.apiKey] ?? '').trim();
  if (key.length === 0 || /[\s\u0000-\u001f\u007f]/.test(key)) {
    return { ok: false, reason: 'NO_KEY' };
  }
  const hosts = allowedHostsOf(env);
  if (!hosts) return { ok: false, reason: 'BAD_URL' };
  const parsed = parseTarget(
    env[HAUS_ENV.baseUrl]?.trim() || SOKRATES_DEFAULT_BASE_URL,
    { requireHttps: true, allowedHosts: hosts }
  );
  if (!parsed.ok) {
    return {
      ok: false,
      reason:
        parsed.code === 'HOST_NOT_ALLOWED' ? 'HOST_NOT_ALLOWED' : 'BAD_URL',
    };
  }
  return {
    ok: true,
    connection: {
      baseUrl: parsed.target.url.replace(/\/chat\/completions$/, ''),
      apiKey: key,
    },
  };
}

export type HausSttResult =
  | { ok: true; config: HausSttConfig }
  | { ok: false; reason: HausReason };
export type HausTtsResult =
  | { ok: true; config: HausTtsConfig }
  | { ok: false; reason: HausReason };

export function loadHausStt(env: Env): HausSttResult {
  const connection = loadHausConnection(env);
  if (!connection.ok) return connection;
  const model = (env[HAUS_ENV.sttModel] ?? '').trim();
  if (!MODEL_NAME.test(model)) return { ok: false, reason: 'NO_STT_MODEL' };
  return { ok: true, config: { ...connection.connection, model } };
}

export function loadHausTts(env: Env): HausTtsResult {
  const connection = loadHausConnection(env);
  if (!connection.ok) return connection;
  const model = (env[HAUS_ENV.ttsModel] ?? '').trim();
  if (!MODEL_NAME.test(model)) return { ok: false, reason: 'NO_TTS_MODEL' };
  const voice = (env[HAUS_ENV.ttsVoice] ?? '').trim();
  if (!VOICE_NAME.test(voice)) return { ok: false, reason: 'NO_TTS_VOICE' };
  return { ok: true, config: { ...connection.connection, model, voice } };
}

/**
 * Is Sokrates set up for the whole voice assistant (recognition AND output)?
 * Configuration only, no network call: the chain of providers must not wait for
 * a remote server on every request.
 */
export function hausConfigReason(env: Env): HausReason | null {
  const stt = loadHausStt(env);
  if (!stt.ok) return stt.reason;
  const tts = loadHausTts(env);
  if (!tts.ok) return tts.reason;
  return null;
}

export interface HausModelStatus {
  /** Sokrates answered the list of models. */
  reachable: boolean;
  /**
   * The model of speech recognition is in the list. null: not known (no model
   * configured, not reachable, or not in the list: Open WebUI does not list its audio
   * engines, so a missing entry proves nothing).
   */
  sttOffered: boolean | null;
  /** The model of speech output is in the list (null as above). */
  ttsOffered: boolean | null;
}

/**
 * Asks Sokrates which models it offers (GET <base>/models) and checks the two
 * audio models against the list. Only for the admin status page, never for the
 * chain of providers at run time. The ids of the list are not returned.
 */
export async function hausModelStatus(
  env: Env,
  fetchImpl: typeof fetch = fetch
): Promise<HausModelStatus> {
  const connection = loadHausConnection(env);
  if (!connection.ok) {
    return { reachable: false, sttOffered: null, ttsOffered: null };
  }
  const result = await call(
    `${connection.connection.baseUrl}/models`,
    {
      method: 'GET',
      headers: { Authorization: `Bearer ${connection.connection.apiKey}` },
    },
    MODELS_TIMEOUT_MS,
    fetchImpl
  );
  if (!result.ok) {
    return { reachable: false, sttOffered: null, ttsOffered: null };
  }
  const data = (await result.response.json().catch(() => null)) as {
    data?: unknown;
  } | null;
  const ids = new Set<string>();
  if (Array.isArray(data?.data)) {
    for (const entry of data.data as Array<{ id?: unknown }>) {
      if (typeof entry?.id === 'string') ids.add(entry.id);
    }
  }
  const sttModel = (env[HAUS_ENV.sttModel] ?? '').trim();
  const ttsModel = (env[HAUS_ENV.ttsModel] ?? '').trim();
  return {
    reachable: true,
    sttOffered: MODEL_NAME.test(sttModel) && ids.has(sttModel) ? true : null,
    ttsOffered: MODEL_NAME.test(ttsModel) && ids.has(ttsModel) ? true : null,
  };
}
