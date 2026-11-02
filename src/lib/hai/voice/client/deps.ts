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
import type { MediaStreamLike, RecorderLike, TokenGrant } from './soniox';
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

/** The real parts of the cloud providers. Create it in the browser only. */
export function createCloudDeps(): VoiceClientDeps {
  let context: AudioContextLike | null = null;

  return {
    async fetchToken(purpose): Promise<TokenGrant> {
      let res: Response;
      try {
        res = await authFetch('/api/hai/voice/soniox-token', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ purpose }),
        });
      } catch {
        throw new ProviderUnavailableError('token-network');
      }
      if (!res.ok) throw new ProviderUnavailableError(`token-${res.status}`);
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

    async getUserMedia(): Promise<MediaStreamLike> {
      return navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
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
