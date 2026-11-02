/**
 * The audio calls to Sokrates (Open WebUI or LiteLLM), the pure part of
 * src/lib/hai/voice/hausServer.ts: the address of the audio routes, the calls
 * for speech recognition and speech output and how their answers are read.
 *
 * This file has no imports, so the server code and the check tool
 * (scripts/hai/voice-live-check.mjs, run by Node itself) share one source and
 * the tool never repeats the paths or the request bodies. It stays free of
 * aliases and of syntax that Node cannot strip (no enums, no parameter
 * properties). hausServer re-exports everything, import from there in the app.
 *
 * @module lib/hai/voice/hausAudio
 */

export const STT_TIMEOUT_MS = 30_000;
export const TTS_TIMEOUT_MS = 20_000;
/** The audio that comes back from speech output is capped (about 4 minutes of WAV at 24 kHz). */
export const MAX_SPEECH_BYTES = 12 * 1024 * 1024;
export const MAX_TRANSCRIPT_CHARS = 4_000;

/**
 * Address of an audio endpoint. A base that ends in /v1 (LiteLLM, OpenAI) takes
 * /audio/<name>. The base of Open WebUI (.../api) has its audio routes under
 * /v1/audio/<name> and answers 405 on /audio/<name>.
 */
export function audioUrl(
  baseUrl: string,
  name: 'transcriptions' | 'speech'
): string {
  const base = baseUrl.replace(/\/+$/, '');
  return /\/v1$/.test(base)
    ? `${base}/audio/${name}`
    : `${base}/v1/audio/${name}`;
}

export interface HausConnection {
  baseUrl: string;
  apiKey: string;
}

export interface HausSttConfig extends HausConnection {
  model: string;
}
export interface HausTtsConfig extends HausConnection {
  model: string;
  voice: string;
}

export type HausFailure =
  | 'UPSTREAM_UNAVAILABLE'
  | 'UPSTREAM_REFUSED'
  | 'MODEL_NOT_OFFERED'
  | 'UPSTREAM_BAD_ANSWER';

export function classify(status: number): HausFailure {
  if (status === 401 || status === 403) return 'UPSTREAM_REFUSED';
  // the endpoint does not know the model (or the route): the model is not offered
  if (status === 400 || status === 404 || status === 422) {
    return 'MODEL_NOT_OFFERED';
  }
  return 'UPSTREAM_UNAVAILABLE';
}

export async function call(
  url: string,
  init: RequestInit,
  timeoutMs: number,
  fetchImpl: typeof fetch
): Promise<
  { ok: true; response: Response } | { ok: false; reason: HausFailure }
> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(url, {
      ...init,
      signal: controller.signal,
      cache: 'no-store',
    });
    if (!response.ok) return { ok: false, reason: classify(response.status) };
    return { ok: true, response };
  } catch {
    // network error or timeout: nothing of the request is kept
    return { ok: false, reason: 'UPSTREAM_UNAVAILABLE' };
  } finally {
    // the body is read by the caller before the timer matters again
    clearTimeout(timer);
  }
}

export type TranscribeResult =
  | { ok: true; text: string }
  | { ok: false; reason: HausFailure };

/** Sends one recorded utterance to Sokrates and returns the recognized text. */
export async function hausTranscribe(
  config: HausSttConfig,
  audio: Blob,
  filename: string,
  fetchImpl: typeof fetch = fetch
): Promise<TranscribeResult> {
  const form = new FormData();
  form.append('file', audio, filename);
  form.append('model', config.model);
  form.append('language', 'de');
  form.append('response_format', 'json');
  const result = await call(
    audioUrl(config.baseUrl, 'transcriptions'),
    {
      method: 'POST',
      headers: { Authorization: `Bearer ${config.apiKey}` },
      body: form,
    },
    STT_TIMEOUT_MS,
    fetchImpl
  );
  if (!result.ok) return result;
  const data = (await result.response.json().catch(() => null)) as {
    text?: unknown;
  } | null;
  if (typeof data?.text !== 'string') {
    return { ok: false, reason: 'UPSTREAM_BAD_ANSWER' };
  }
  return { ok: true, text: data.text.trim().slice(0, MAX_TRANSCRIPT_CHARS) };
}

export type SpeechResult =
  | { ok: true; audio: ArrayBuffer; contentType: string }
  | { ok: false; reason: HausFailure };

/** Asks Sokrates to speak one text (a sentence), returns the audio (WAV or MP3, as the server sends it). */
export async function hausSpeech(
  config: HausTtsConfig,
  text: string,
  fetchImpl: typeof fetch = fetch
): Promise<SpeechResult> {
  const result = await call(
    audioUrl(config.baseUrl, 'speech'),
    {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: config.model,
        input: text,
        voice: config.voice,
        response_format: 'wav',
      }),
    },
    TTS_TIMEOUT_MS,
    fetchImpl
  );
  if (!result.ok) return result;
  const declared = Number(result.response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_SPEECH_BYTES) {
    return { ok: false, reason: 'UPSTREAM_BAD_ANSWER' };
  }
  const audio = await result.response.arrayBuffer().catch(() => null);
  if (!audio || audio.byteLength === 0 || audio.byteLength > MAX_SPEECH_BYTES) {
    return { ok: false, reason: 'UPSTREAM_BAD_ANSWER' };
  }
  // Open WebUI answers MP3 whatever response_format says, the browser decodes both
  const declaredType = (result.response.headers.get('content-type') ?? '')
    .split(';')[0]
    .trim()
    .toLowerCase();
  return {
    ok: true,
    audio,
    contentType: declaredType.startsWith('audio/') ? declaredType : 'audio/wav',
  };
}
