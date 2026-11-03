/**
 * The real browser parts behind the providers: the calls to the routes of this
 * application (always through authFetch, the routes need the bearer token), the
 * websocket, the microphone, the recorder and one shared audio context.
 *
 * Only the calls to /api/hai/voice/... are made here, so the scan of
 * tests/unit/hai/browserCalls.test.ts finds them and checks that they use
 * authFetch.
 *
 * @module lib/hai/voice/client/deps
 */

import { authFetch } from '@/lib/authFetch';
import type { AudioContextLike } from './audio';
import type { VoiceClientDeps } from './engine';
import type {
  MediaStreamLike,
  MicProfile,
  RecorderLike,
  TokenGrant,
} from './soniox';
import { createTokenStore, type TokenPurpose } from './tokenStore';
import { mark } from './trace';
import { ProviderUnavailableError, type VoiceConfig } from './types';
import { VOICE_FUNCTIONS, VOICE_PROVIDERS } from '../settings';

/** What the browser needs to use a cloud provider at all. */
export function cloudVoiceSupport(
  win: (Window & Record<string, unknown>) | null | undefined
): boolean {
  if (!win) return false;
  const nav = win.navigator as Navigator | undefined;
  return (
    !!nav?.mediaDevices?.getUserMedia &&
    typeof win.MediaRecorder !== 'undefined' &&
    typeof win.WebSocket !== 'undefined' &&
    !!(win.AudioContext || win.webkitAudioContext)
  );
}

/** Reads the answer of GET /api/hai/voice/config. Null if it is not what we expect. */
export function parseVoiceConfig(data: unknown): VoiceConfig | null {
  const value = data as {
    provider?: unknown;
    chain?: unknown;
    chains?: unknown;
    region?: unknown;
  } | null;
  if (!value || !Array.isArray(value.chain)) return null;
  const known = VOICE_PROVIDERS as readonly string[];
  const providersOf = (list: unknown[]) =>
    list.filter(
      (id): id is VoiceConfig['provider'] =>
        typeof id === 'string' && known.includes(id)
    );
  const chain = providersOf(value.chain);
  if (chain.length === 0) return null;
  // the chain per function: used only when both are there and not empty, else
  // (an older server) `chain` holds for both functions
  const raw = value.chains as Record<string, unknown> | null | undefined;
  const parsed = VOICE_FUNCTIONS.map(fn =>
    Array.isArray(raw?.[fn]) ? providersOf(raw[fn] as unknown[]) : []
  );
  const chains = parsed.every(list => list.length > 0)
    ? { stt: parsed[0], tts: parsed[1] }
    : undefined;
  return {
    provider: chain[0],
    chain,
    ...(chains ? { chains } : {}),
    region:
      value.region === 'eu' || value.region === 'us' ? value.region : null,
  };
}

/** The effective providers for this caller. Null when the server does not answer. */
export async function fetchVoiceConfig(): Promise<VoiceConfig | null> {
  try {
    const res = await authFetch('/api/hai/voice/config', {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return parseVoiceConfig(await res.json());
  } catch {
    return null;
  }
}

function recorderOptions(): MediaRecorderOptions | undefined {
  // webm with opus where the browser knows it (Chrome, Firefox, Edge), else the default (Safari: mp4)
  const types = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
  const supported = types.find(
    type =>
      typeof MediaRecorder.isTypeSupported === 'function' &&
      MediaRecorder.isTypeSupported(type)
  );
  return supported ? { mimeType: supported } : undefined;
}

/** localStorage key to switch the microphone back to the processed signal (diagnosis). */
export const MIC_PROFILE_KEY = 'hai-voice-mic';

/**
 * The microphone for the recognition on Soniox.
 *
 *  - `raw`: the recording the model was trained on and what the official web
 *    SDK asks for: no echo cancellation, no noise suppression (they cut off the
 *    start of syllables and quiet sounds), automatic gain on (quiet speakers),
 *    one channel, 16 kHz as a wish (many browsers record with 48 kHz anyway, the
 *    container tells Soniox). For one round at a time: the microphone is off
 *    while the assistant speaks, so its own voice cannot come back in.
 *  - `live`: for the microphone that stays open while the assistant speaks
 *    (interrupting by voice). The echo cancellation MUST be on, otherwise the
 *    assistant hears itself and interrupts itself. The noise suppression stays
 *    off (it is what cuts syllables), the automatic gain on.
 *  - `processed`: the browser's own treatment, echo and noise (Sokrates).
 *
 * `override` is the value of localStorage['hai-voice-mic'] ('raw', 'live' or
 * 'processed'): it replaces the profile of the recognition on Soniox, to compare
 * the settings on a device. The Sokrates recognition keeps `processed`.
 */
export function micConstraints(
  profile: MicProfile = 'raw',
  override?: string | null
): MediaTrackConstraints {
  const wanted: MicProfile =
    profile !== 'processed' &&
    (override === 'raw' || override === 'live' || override === 'processed')
      ? override
      : profile;
  if (wanted === 'processed') {
    return { channelCount: 1, echoCancellation: true, noiseSuppression: true };
  }
  return {
    channelCount: 1,
    sampleRate: { ideal: 16_000 },
    echoCancellation: wanted === 'live',
    noiseSuppression: false,
    autoGainControl: true,
  };
}

function readMicOverride(): string | null {
  try {
    return window.localStorage.getItem(MIC_PROFILE_KEY);
  } catch {
    return null;
  }
}

/** A short stable word of what the key route answered, for the reason of a fallback. */
function tokenFailureDetail(data: unknown): string {
  const reason = (data as { reason?: unknown } | null)?.reason;
  return typeof reason === 'string'
    ? `-${reason
        .toLowerCase()
        .replace(/[^a-z_]/g, '')
        .slice(0, 24)}`
    : '';
}

/** The real parts of the cloud providers. Create it in the browser only. */
export function createCloudDeps(): VoiceClientDeps {
  let context: AudioContextLike | null = null;

  async function fetchFreshToken(purpose: TokenPurpose): Promise<TokenGrant> {
    {
      let res: Response;
      try {
        res = await authFetch('/api/hai/voice/soniox-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            purpose: purpose === 'tts' ? 'tts' : 'stt',
            // a recognition that stays open over the conversation needs a longer session
            ...(purpose === 'stt-live' ? { live: true } : {}),
          }),
        });
      } catch {
        throw new ProviderUnavailableError('token-network');
      }
      if (!res.ok) {
        // the reason of the server (no key, refused, region ...) rides along
        const body = await res.json().catch(() => null);
        throw new ProviderUnavailableError(
          `token-${res.status}${tokenFailureDetail(body)}`
        );
      }
      const data = (await res
        .json()
        .catch(() => null)) as Partial<TokenGrant> | null;
      if (
        !data ||
        typeof data.apiKey !== 'string' ||
        typeof data.wsUrl !== 'string' ||
        !data.wsUrl.startsWith('wss://') ||
        !data.config ||
        typeof data.config !== 'object'
      ) {
        throw new ProviderUnavailableError('token-shape');
      }
      return {
        apiKey: data.apiKey,
        wsUrl: data.wsUrl,
        expiresInSeconds: Number(data.expiresInSeconds) || 0,
        config: data.config,
      };
    }
  }

  // a key for each purpose is fetched ahead of its use (one key per connection)
  const tokens = createTokenStore(fetchFreshToken);

  return {
    fetchToken: purpose => tokens.take(purpose),

    prefetchToken(purpose) {
      tokens.prefetch(purpose);
    },

    warmServer() {
      // the route pings Sokrates with a time limit and answers { warmed, ms }
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 5_000);
      void authFetch('/api/hai/voice/warmup', {
        method: 'POST',
        signal: controller.signal,
      })
        .then(res => res.json().catch(() => null))
        .then(data => {
          const result = data as { warmed?: unknown; ms?: unknown } | null;
          mark('server.warm', {
            warmed: result?.warmed === true,
            ms: typeof result?.ms === 'number' ? result.ms : -1,
          });
        })
        .catch(() => undefined)
        .finally(() => clearTimeout(timer));
    },

    async transcribe(audio) {
      const form = new FormData();
      form.append('audio', audio, 'speech.webm');
      let res: Response;
      try {
        res = await authFetch('/api/hai/voice/haus/transcribe', {
          method: 'POST',
          body: form,
        });
      } catch {
        throw new ProviderUnavailableError('transcribe-network');
      }
      if (!res.ok) {
        throw new ProviderUnavailableError(`transcribe-${res.status}`);
      }
      const data = (await res.json().catch(() => null)) as {
        text?: unknown;
      } | null;
      if (typeof data?.text !== 'string') {
        throw new ProviderUnavailableError('transcribe-shape');
      }
      return data.text;
    },

    async speak(text) {
      let res: Response;
      try {
        res = await authFetch('/api/hai/voice/haus/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ text }),
        });
      } catch {
        throw new ProviderUnavailableError('speech-network');
      }
      if (!res.ok) throw new ProviderUnavailableError(`speech-${res.status}`);
      return res.arrayBuffer();
    },

    createSocket(url, protocols) {
      const socket = new WebSocket(url, protocols);
      return socket as unknown as ReturnType<VoiceClientDeps['createSocket']>;
    },

    async getUserMedia(
      profile: MicProfile = 'processed'
    ): Promise<MediaStreamLike> {
      return (await navigator.mediaDevices.getUserMedia({
        audio: micConstraints(profile, readMicOverride()),
      })) as unknown as MediaStreamLike;
    },

    createRecorder(stream): RecorderLike {
      return new MediaRecorder(
        stream as MediaStream,
        recorderOptions()
      ) as unknown as RecorderLike;
    },

    audioContext() {
      if (!context) {
        const win = window as unknown as Record<string, unknown>;
        const Ctor = (win.AudioContext ||
          win.webkitAudioContext) as new () => AudioContext;
        context = new Ctor() as unknown as AudioContextLike;
      }
      return context;
    },
  };
}
