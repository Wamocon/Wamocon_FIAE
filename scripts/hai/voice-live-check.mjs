#!/usr/bin/env node
/**
 * Check of the speech providers of the HAI voice assistant (read only).
 *
 * Soniox: asks for a short lived key for speech recognition and for speech
 * output, lets the question "Was ist ein Primärschlüssel?" be spoken and sends
 * the generated speech back into the recognition. Sokrates (Open WebUI):
 * calls speech output (MP3) and then speech recognition with that file. A
 * check passes when the term Primärschlüssel comes back.
 *
 * Nothing is written anywhere (no database, no file). The tool never prints a
 * key: only "set yes or no", status codes, durations and the recognized text.
 * Every line goes through scrub(), which also removes the real key and the
 * short lived keys if they ever appear in an error text.
 *
 * The addresses, models and request bodies come from the code of the app, not
 * from a copy: src/lib/hai/voice/sonioxServer.ts and hausAudio.ts have no
 * imports and no aliases, so Node loads them itself (type stripping, Node 22.18
 * or newer). The environment is read from process.env only. Load a file with
 * Node: node --env-file=.env.local scripts/hai/voice-live-check.mjs
 *
 * Usage:
 *   npm run hai:voice-check                    both providers
 *   npm run hai:voice-check -- --only soniox   Soniox only (or: --only haus)
 *   npm run hai:voice-check -- --webm          also the way of the browser (see below)
 *
 * --webm (Soniox): the way the browser takes, which the first probe (raw PCM from
 * Node) does not test. The speech of the probe is encoded to webm/opus with
 * ffmpeg (if ffmpeg is installed, else a clear note), sent in slices of about
 * 100 ms with the real config of the app (audio_format auto, endpoint
 * detection), the times to the first word and to the endpoint are measured. Then
 * a second connection with the same key (may a stock of keys use it twice?) and
 * a second speech stream on the same connection (what a warm connection saves).
 * Costs a few cents of Soniox. Writes nothing.
 *
 * Exit code: 0 everything passed, 1 something failed, 2 not set up (or a wrong
 * call). A failure wins over "not set up". Not part of the CI (no network, no
 * keys): tests/scripts/hai/voice-live-check.test.mjs runs the logic with a
 * replaced fetch and websocket.
 */

import { spawn } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import {
  TTS_SAMPLE_RATE,
  KEY_VALID_SECONDS,
  createSonioxToken,
  loadSonioxConfig,
} from '../../src/lib/hai/voice/sonioxServer.ts';
import {
  audioUrl,
  hausSpeech,
  hausTranscribe,
} from '../../src/lib/hai/voice/hausAudio.ts';
import {
  SOKRATES_DEFAULT_BASE_URL,
  allowedHostsOf,
  parseTarget,
} from '../../src/lib/content-upload/ki/config.ts';

/** The question that is spoken and must come back. */
export const PROBE_TEXT = 'Was ist ein Primärschlüssel?';
/** With and without umlauts (ä, ae, a and ü, ue, u). */
export const PROBE_PATTERN = /prim(?:.|ae)r\s*schl(?:.|ue)ssel/i;

/** Defaults of the models when the variables are not set (names only for Open WebUI). */
const HAUS_DEFAULTS = Object.freeze({
  stt: 'whisper-1',
  tts: 'tts-1',
  voice: 'alloy',
});
const SOCKET_TIMEOUT_MS = 20_000;
const AUDIO_CHUNK_BYTES = 16_384;
const SONIOX_PROTOCOL = 'soniox-api-key';

export const EXIT = Object.freeze({ OK: 0, FAILED: 1, NOT_SET_UP: 2 });
const PROVIDERS = ['soniox', 'haus'];

// ---------------------------------------------------------------------------
// Result rows
// ---------------------------------------------------------------------------

/** @typedef {'ok'|'failed'|'not_set_up'|'skipped'} Outcome */
const OUTCOME_TEXT = {
  ok: 'bestanden',
  failed: 'FEHLER',
  not_set_up: 'nicht eingerichtet',
  skipped: 'übersprungen',
};

const row = (check, outcome, detail) => ({ check, outcome, detail });

function seconds(ms) {
  return `${(ms / 1000).toFixed(1).replace('.', ',')} s`;
}

function kilobytes(bytes) {
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/** The fetch that remembers the last status and its duration (the app code hides the status). */
function recordingFetch(fetchImpl, now) {
  const last = { status: null, ms: 0 };
  const wrapped = async (url, init) => {
    const started = now();
    try {
      const response = await fetchImpl(url, init);
      last.status = response.status;
      return response;
    } catch (error) {
      last.status = null;
      throw error;
    } finally {
      last.ms = now() - started;
    }
  };
  return { fetch: wrapped, last };
}

// ---------------------------------------------------------------------------
// Soniox
// ---------------------------------------------------------------------------

/** One websocket round: open, run `onOpen`, feed every message to `onMessage` until it resolves. */
function socketRound(WebSocketImpl, grant, onOpen, onMessage) {
  return new Promise((resolve, reject) => {
    let socket = null;
    let settled = false;
    const finish = (settle, value) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      try {
        socket?.close();
      } catch {
        // already closed
      }
      settle(value);
    };
    const timer = setTimeout(
      () => finish(reject, new Error('Zeitüberschreitung')),
      SOCKET_TIMEOUT_MS
    );
    try {
      socket = new WebSocketImpl(grant.wsUrl, [SONIOX_PROTOCOL, grant.apiKey]);
    } catch {
      finish(reject, new Error('Verbindung nicht möglich'));
      return;
    }
    socket.onopen = () => {
      try {
        onOpen(socket);
      } catch {
        finish(reject, new Error('Senden nicht möglich'));
      }
    };
    socket.onmessage = event => {
      let message = null;
      try {
        message = JSON.parse(String(event.data));
      } catch {
        return;
      }
      if (!message || typeof message !== 'object') return;
      if (message.error_code !== undefined) {
        finish(
          reject,
          new Error(`Soniox meldet den Fehler ${String(message.error_code)}`)
        );
        return;
      }
      try {
        onMessage(message, value => finish(resolve, value), socket);
      } catch {
        finish(reject, new Error('Antwort nicht lesbar'));
      }
    };
    socket.onerror = () => finish(reject, new Error('Websocket-Fehler'));
    socket.onclose = () =>
      finish(reject, new Error('Verbindung vorzeitig geschlossen'));
  });
}

/** Speaks `text` with Soniox. Resolves with the PCM audio and the timing. */
async function sonioxSpeak(deps, grant, text) {
  const started = deps.now();
  const chunks = [];
  let firstMs = null;
  const streamId = 'voice-live-check';
  await socketRound(
    deps.WebSocketImpl,
    grant,
    socket => {
      socket.send(JSON.stringify({ stream_id: streamId, ...grant.config }));
      socket.send(
        JSON.stringify({ text, text_end: true, stream_id: streamId })
      );
    },
    (message, done) => {
      if (typeof message.audio === 'string' && message.audio.length > 0) {
        if (firstMs === null) firstMs = deps.now() - started;
        chunks.push(Buffer.from(message.audio, 'base64'));
      }
      if (message.audio_end === true || message.terminated === true) {
        done(null);
      }
    }
  );
  return {
    pcm: Buffer.concat(chunks),
    firstMs: firstMs ?? 0,
    totalMs: deps.now() - started,
  };
}

/** Sends PCM audio to the Soniox recognition. Resolves with the recognized text. */
async function sonioxRecognize(deps, grant, pcm) {
  const started = deps.now();
  let text = '';
  await socketRound(
    deps.WebSocketImpl,
    grant,
    socket => {
      // raw PCM from speech output, not the container formats of the browser
      socket.send(
        JSON.stringify({
          ...grant.config,
          audio_format: 'pcm_s16le',
          sample_rate: TTS_SAMPLE_RATE,
          num_channels: 1,
        })
      );
      for (let at = 0; at < pcm.length; at += AUDIO_CHUNK_BYTES) {
        socket.send(pcm.subarray(at, at + AUDIO_CHUNK_BYTES));
      }
      // the end of the stream is an empty text frame
      socket.send('');
    },
    (message, done) => {
      if (Array.isArray(message.tokens)) {
        for (const token of message.tokens) {
          if (
            token?.is_final === true &&
            typeof token.text === 'string' &&
            token.text !== '<end>' &&
            token.text !== '<fin>'
          ) {
            text += token.text;
          }
        }
      }
      if (message.finished === true) done(null);
    }
  );
  return { text: text.trim(), ms: deps.now() - started };
}

function sonioxTokenFailure(failure, region, otherProbe) {
  if (failure.reason === 'UPSTREAM_REFUSED' && failure.status === 401) {
    const other = region === 'eu' ? 'us' : 'eu';
    if (otherProbe && otherProbe.ok) {
      return `HTTP 401: Der Schlüssel gehört zu einem Projekt einer anderen Region (Gegenprobe in Region ${other}: HTTP ${otherProbe.status}). SONIOX_REGION steht auf ${region}, für diesen Schlüssel braucht es ${other}, oder einen Schlüssel eines Projekts der Region ${region}.`;
    }
    return `HTTP 401: Soniox lehnt den Schlüssel ab${otherProbe ? ` (Gegenprobe in Region ${other}: HTTP ${otherProbe.status}, auch dort abgelehnt, der Schlüssel ist ungültig oder gesperrt)` : ''}.`;
  }
  if (failure.reason === 'UPSTREAM_REFUSED') {
    return `HTTP ${failure.status}: Soniox lehnt die Anfrage ab.`;
  }
  if (failure.reason === 'UPSTREAM_BAD_ANSWER') {
    return 'Soniox antwortet ohne Kurzzeit-Schlüssel.';
  }
  return failure.status === null
    ? 'Soniox ist nicht erreichbar (Netzwerk oder Zeitüberschreitung).'
    : `Soniox antwortet mit HTTP ${failure.status}.`;
}

async function checkSoniox(deps) {
  const rows = [];
  const loaded = loadSonioxConfig(deps.env);
  if (!loaded.ok) {
    rows.push(
      row(
        'Soniox eingerichtet',
        'not_set_up',
        loaded.reason === 'NO_KEY'
          ? 'SONIOX_API_KEY gesetzt: nein'
          : 'SONIOX_REGION muss eu oder us sein'
      )
    );
    return rows;
  }
  const config = loaded.config;
  deps.secrets.add(config.apiKey);
  // what the probe of the browser way needs (--webm)
  deps.probe = { config, grants: {}, pcm: null };
  rows.push(
    row(
      'Soniox eingerichtet',
      'ok',
      `SONIOX_API_KEY gesetzt: ja, Region ${config.region}`
    )
  );

  const grants = {};
  let probed = false;
  for (const [purpose, label] of [
    ['tts', 'Soniox Kurzzeit-Schlüssel Sprachausgabe'],
    ['stt', 'Soniox Kurzzeit-Schlüssel Erkennung'],
  ]) {
    const recorder = recordingFetch(deps.fetchImpl, deps.now);
    const result = await createSonioxToken(
      config,
      purpose,
      'voice-live-check',
      recorder.fetch
    );
    if (result.ok) {
      deps.secrets.add(result.grant.apiKey);
      grants[purpose] = result.grant;
      deps.probe.grants[purpose] = true;
      rows.push(
        row(
          label,
          'ok',
          `HTTP ${recorder.last.status}, ${seconds(recorder.last.ms)}, gültig ${KEY_VALID_SECONDS} s`
        )
      );
      continue;
    }
    // a 401 on one region: ask the other region once, it names the usual cause
    let otherProbe = null;
    if (result.status === 401 && !probed) {
      probed = true;
      const other = loadSonioxConfig({
        ...deps.env,
        SONIOX_REGION: config.region === 'eu' ? 'us' : 'eu',
      });
      if (other.ok) {
        const probeFetch = recordingFetch(deps.fetchImpl, deps.now);
        const probe = await createSonioxToken(
          other.config,
          purpose,
          'voice-live-check',
          probeFetch.fetch
        );
        if (probe.ok) deps.secrets.add(probe.grant.apiKey);
        otherProbe = { ok: probe.ok, status: probeFetch.last.status };
      }
    }
    rows.push(
      row(
        label,
        'failed',
        sonioxTokenFailure(result, config.region, otherProbe)
      )
    );
  }

  // speech output, then the generated speech back into the recognition
  let pcm = null;
  if (!grants.tts) {
    rows.push(
      row('Soniox Sprachausgabe', 'skipped', 'kein Kurzzeit-Schlüssel')
    );
  } else {
    try {
      const spoken = await sonioxSpeak(deps, grants.tts, PROBE_TEXT);
      if (spoken.pcm.length === 0) {
        rows.push(
          row('Soniox Sprachausgabe', 'failed', 'Soniox lieferte keinen Ton.')
        );
      } else {
        pcm = spoken.pcm;
        deps.probe.pcm = spoken.pcm;
        const length = pcm.length / 2 / TTS_SAMPLE_RATE;
        rows.push(
          row(
            'Soniox Sprachausgabe',
            'ok',
            `${seconds(length * 1000)} Sprache nach ${seconds(spoken.firstMs)}, gesamt ${seconds(spoken.totalMs)}`
          )
        );
      }
    } catch (error) {
      rows.push(row('Soniox Sprachausgabe', 'failed', errorText(error)));
    }
  }
  if (!grants.stt || !pcm) {
    rows.push(
      row(
        'Soniox Erkennung (erzeugte Sprache zurück)',
        'skipped',
        !grants.stt ? 'kein Kurzzeit-Schlüssel' : 'keine Sprache erzeugt'
      )
    );
  } else {
    try {
      const heard = await sonioxRecognize(deps, grants.stt, pcm);
      rows.push(
        recognitionRow(
          'Soniox Erkennung (erzeugte Sprache zurück)',
          heard.text,
          heard.ms
        )
      );
    } catch (error) {
      rows.push(
        row(
          'Soniox Erkennung (erzeugte Sprache zurück)',
          'failed',
          errorText(error)
        )
      );
    }
  }
  return rows;
}

function recognitionRow(check, text, ms) {
  return PROBE_PATTERN.test(text)
    ? row(check, 'ok', `erkannt "${text}" nach ${seconds(ms)}`)
    : row(
        check,
        'failed',
        `Der Begriff Primärschlüssel wurde nicht erkannt, erkannt: "${text}"`
      );
}

function errorText(error) {
  return error instanceof Error ? error.message : 'unbekannter Fehler';
}

// ---------------------------------------------------------------------------
// Sokrates (Open WebUI)
// ---------------------------------------------------------------------------

/** The checked address and key of Sokrates, like loadHausConnection in the app. */
function loadHaus(env) {
  const key = (env.OPENAI_COMPATIBLE_API_KEY ?? '').trim();
  if (key.length === 0 || /[\s\u0000-\u001f\u007f]/.test(key)) {
    return { ok: false, reason: 'NO_KEY' };
  }
  const hosts = allowedHostsOf(env);
  if (!hosts) return { ok: false, reason: 'BAD_URL' };
  const parsed = parseTarget(
    env.OPENAI_COMPATIBLE_BASE_URL?.trim() || SOKRATES_DEFAULT_BASE_URL,
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
    baseUrl: parsed.target.url.replace(/\/chat\/completions$/, ''),
    apiKey: key,
  };
}

const HAUS_NOT_SET_UP = {
  NO_KEY: 'OPENAI_COMPATIBLE_API_KEY gesetzt: nein',
  BAD_URL: 'OPENAI_COMPATIBLE_BASE_URL ist keine gültige https-Adresse',
  HOST_NOT_ALLOWED:
    'Der Host von OPENAI_COMPATIBLE_BASE_URL steht nicht auf der Positivliste (CONTENT_UPLOAD_KI_ALLOWED_HOSTS)',
};

/** What a failed call to Sokrates means, by status and by call. */
function hausFailure(what, status) {
  if (status === null) {
    return 'Sokrates ist nicht erreichbar (Netzwerk oder Zeitüberschreitung).';
  }
  if (status === 401 || status === 403) {
    return `HTTP ${status}: Sokrates lehnt den Schlüssel ab.`;
  }
  if (status === 405) {
    return 'HTTP 405: Der Pfad stimmt nicht. Hinter Open WebUI liegen die Audio-Routen unter /v1/audio/, die Adresse muss auf /api enden.';
  }
  if (status === 400 || status === 404 || status === 422) {
    return `HTTP ${status}: Sokrates kennt das Modell oder die Stimme nicht (HAI_STT_HAUS_MODEL, HAI_TTS_HAUS_MODEL, HAI_TTS_HAUS_VOICE).`;
  }
  if (status >= 500) {
    return what === 'stt'
      ? `HTTP ${status}: Der Sprachdienst hinter Open WebUI (Spracherkennung) antwortet mit einem Serverfehler. Open WebUI reicht die Anfrage nur weiter, der Fehler liegt auf Sokrates.`
      : `HTTP ${status}: Der Sprachdienst hinter Open WebUI (Sprachausgabe) antwortet mit einem Serverfehler. Der Fehler liegt auf Sokrates.`;
  }
  return `HTTP ${status}: unerwartete Antwort von Sokrates.`;
}

async function checkHaus(deps) {
  const rows = [];
  const loaded = loadHaus(deps.env);
  if (!loaded.ok) {
    rows.push(
      row('Sokrates eingerichtet', 'not_set_up', HAUS_NOT_SET_UP[loaded.reason])
    );
    return rows;
  }
  deps.secrets.add(loaded.apiKey);
  const named = (name, fallback) => (deps.env[name] ?? '').trim() || fallback;
  const model = {
    stt: named('HAI_STT_HAUS_MODEL', HAUS_DEFAULTS.stt),
    tts: named('HAI_TTS_HAUS_MODEL', HAUS_DEFAULTS.tts),
    voice: named('HAI_TTS_HAUS_VOICE', HAUS_DEFAULTS.voice),
  };
  rows.push(
    row(
      'Sokrates eingerichtet',
      'ok',
      `OPENAI_COMPATIBLE_API_KEY gesetzt: ja, Pfad ${new URL(audioUrl(loaded.baseUrl, 'speech')).pathname.replace(/speech$/, '...')}`
    )
  );

  const speech = recordingFetch(deps.fetchImpl, deps.now);
  const spoken = await hausSpeech(
    {
      baseUrl: loaded.baseUrl,
      apiKey: loaded.apiKey,
      model: model.tts,
      voice: model.voice,
    },
    PROBE_TEXT,
    speech.fetch
  );
  let audio = null;
  if (!spoken.ok) {
    rows.push(
      row(
        'Sokrates Sprachausgabe',
        'failed',
        hausFailure('tts', speech.last.status)
      )
    );
  } else {
    audio = spoken;
    rows.push(
      row(
        'Sokrates Sprachausgabe',
        'ok',
        `HTTP ${speech.last.status}, ${seconds(speech.last.ms)}, ${spoken.contentType}, ${kilobytes(spoken.audio.byteLength)}`
      )
    );
  }

  if (!audio) {
    rows.push(
      row(
        'Sokrates Erkennung (erzeugte Sprache zurück)',
        'skipped',
        'keine Sprachausgabe als Eingabe'
      )
    );
    return rows;
  }
  const extension = /mpeg|mp3/.test(audio.contentType) ? 'mp3' : 'wav';
  const recognition = recordingFetch(deps.fetchImpl, deps.now);
  const heard = await hausTranscribe(
    { baseUrl: loaded.baseUrl, apiKey: loaded.apiKey, model: model.stt },
    new Blob([audio.audio], { type: audio.contentType }),
    `voice-live-check.${extension}`,
    recognition.fetch
  );
  const label = 'Sokrates Erkennung (erzeugte Sprache zurück)';
  if (!heard.ok) {
    rows.push(
      row(
        label,
        'failed',
        heard.reason === 'UPSTREAM_BAD_ANSWER'
          ? `HTTP ${recognition.last.status}: Die Antwort hat nicht die Form {text, filename}.`
          : hausFailure('stt', recognition.last.status)
      )
    );
    return rows;
  }
  const outcome = recognitionRow(label, heard.text, recognition.last.ms);
  rows.push(
    outcome.outcome === 'ok'
      ? {
          ...outcome,
          detail: `HTTP ${recognition.last.status}, ${outcome.detail}`,
        }
      : outcome
  );
  return rows;
}

// ---------------------------------------------------------------------------
// The way of the browser (--webm): the recording as the browser sends it
// ---------------------------------------------------------------------------

/** About 100 ms of a recording of the browser (webm/opus at 64 kbit/s is 8 KB per second). */
const WEBM_SLICE_BYTES = 800;
/** Silence after the speech, so the endpoint detection has something to detect. */
const SILENCE_SECONDS = 1.5;
/** After the last slice: wait this long for the endpoint, then end the stream. */
const END_WAIT_MS = 3_000;
const SECOND_SENTENCE = 'Das ist die zweite Antwort.';

/**
 * Encodes 24 kHz mono signed 16 bit PCM to webm/opus with ffmpeg (the container
 * the browser records). Resolves null when ffmpeg is not installed.
 */
export function encodeWebmWithFfmpeg(pcm, spawnImpl = spawn) {
  return new Promise((resolve, reject) => {
    let child;
    try {
      child = spawnImpl(
        'ffmpeg',
        [
          '-hide_banner',
          '-loglevel',
          'error',
          '-f',
          's16le',
          '-ar',
          String(TTS_SAMPLE_RATE),
          '-ac',
          '1',
          '-i',
          'pipe:0',
          '-c:a',
          'libopus',
          '-b:a',
          '32k',
          '-f',
          'webm',
          'pipe:1',
        ],
        { stdio: ['pipe', 'pipe', 'pipe'] }
      );
    } catch {
      resolve(null);
      return;
    }
    const out = [];
    child.stdout.on('data', chunk => out.push(chunk));
    child.stdin.on('error', () => undefined);
    child.on('error', error => {
      if (error && error.code === 'ENOENT') resolve(null);
      else reject(new Error('ffmpeg lässt sich nicht starten'));
    });
    child.on('close', code => {
      if (code === 0 && out.length > 0) resolve(Buffer.concat(out));
      else reject(new Error(`ffmpeg endete mit dem Code ${String(code)}`));
    });
    child.stdin.end(pcm);
  });
}

/** The speech with a pause at the end, as 16 bit PCM. */
function withSilence(pcm) {
  return Buffer.concat([
    pcm,
    Buffer.alloc(Math.round(TTS_SAMPLE_RATE * SILENCE_SECONDS) * 2),
  ]);
}

/**
 * Sends the webm recording in slices like the browser does (the config of the
 * app first, then binary frames) and ends the stream the way the app does: at
 * the endpoint (token <end>) with an empty text frame, or after a wait.
 */
async function sonioxRecognizeWebm(deps, grant, webm, options = {}) {
  const started = deps.now();
  let text = '';
  let firstMs = null;
  let endpointMs = null;
  let lastSentAt = started;
  let slices = 0;
  let ended = false;
  await socketRound(
    deps.WebSocketImpl,
    grant,
    socket => {
      // exactly what the browser sends: the config of the app, no change
      socket.send(JSON.stringify(grant.config));
      const limit = options.maxSlices ?? Infinity;
      for (
        let at = 0;
        at < webm.length && slices < limit;
        at += WEBM_SLICE_BYTES
      ) {
        socket.send(webm.subarray(at, at + WEBM_SLICE_BYTES));
        slices += 1;
      }
      lastSentAt = deps.now();
      if (options.endAfterSend) {
        ended = true;
        socket.send('');
        return;
      }
      setTimeout(() => {
        if (!ended) {
          ended = true;
          socket.send('');
        }
      }, deps.endWaitMs);
    },
    (message, done, socket) => {
      if (Array.isArray(message.tokens)) {
        for (const token of message.tokens) {
          if (typeof token?.text !== 'string') continue;
          if (token.text === '<end>') {
            if (endpointMs === null) endpointMs = deps.now() - lastSentAt;
            if (!ended) {
              ended = true;
              socket.send('');
            }
            continue;
          }
          if (token.text === '<fin>') continue;
          if (firstMs === null) firstMs = deps.now() - started;
          if (token.is_final === true) text += token.text;
        }
      }
      if (message.finished === true) done(null);
    }
  );
  return {
    text: text.trim(),
    firstMs,
    endpointMs,
    slices,
    ms: deps.now() - started,
  };
}

/** Two speech streams one after the other on ONE connection. */
async function sonioxSpeakTwice(deps, grant) {
  const connectStarted = deps.now();
  let secondStarted = 0;
  let firstMs = null;
  let secondMs = null;
  let stage = 1;
  const id = n => `voice-live-check-${n}`;
  const start = (socket, n, text) => {
    socket.send(JSON.stringify({ stream_id: id(n), ...grant.config }));
    socket.send(JSON.stringify({ text, text_end: true, stream_id: id(n) }));
  };
  await socketRound(
    deps.WebSocketImpl,
    grant,
    socket => start(socket, 1, PROBE_TEXT),
    (message, done, socket) => {
      if (typeof message.audio === 'string' && message.audio.length > 0) {
        if (stage === 1 && firstMs === null) {
          firstMs = deps.now() - connectStarted;
        }
        if (stage === 2 && secondMs === null) {
          secondMs = deps.now() - secondStarted;
        }
      }
      if (message.terminated === true && message.stream_id === id(1)) {
        stage = 2;
        secondStarted = deps.now();
        start(socket, 2, SECOND_SENTENCE);
      } else if (message.terminated === true && message.stream_id === id(2)) {
        done(null);
      }
    }
  );
  return { firstMs, secondMs };
}

async function freshRecognitionKey(deps, config, label, rows) {
  const recorder = recordingFetch(deps.fetchImpl, deps.now);
  const result = await createSonioxToken(
    config,
    'stt',
    'voice-live-check',
    recorder.fetch
  );
  if (!result.ok) {
    rows.push(row(label, 'failed', sonioxTokenFailure(result, config.region)));
    return null;
  }
  deps.secrets.add(result.grant.apiKey);
  return result.grant;
}

/**
 * The probe of the way the browser takes (the recognition gets the container
 * of a MediaRecorder with the real config of the app incl. endpoint detection),
 * the second connection with the same key and the second speech stream on the
 * same connection. Needs ffmpeg for the webm file; without it a clear note.
 */
async function checkSonioxWebm(deps) {
  const rows = [];
  const probe = deps.probe;
  const CHECK = 'Soniox Browserweg (webm/opus, Endpunkterkennung)';
  const SECOND = 'Soniox zweite Verbindung mit demselben Schlüssel';
  const TWICE = 'Soniox zweiter Sprach-Strom auf derselben Verbindung';
  if (!probe?.config) {
    rows.push(row(CHECK, 'skipped', 'Soniox ist nicht eingerichtet'));
    return rows;
  }

  // two speech streams on one connection (no ffmpeg needed)
  if (!probe.grants?.tts) {
    rows.push(row(TWICE, 'skipped', 'kein Kurzzeit-Schlüssel'));
  } else {
    const ttsKey = await (async () => {
      // the key of the first probe was used once: a fresh one for this connection
      const result = await createSonioxToken(
        probe.config,
        'tts',
        'voice-live-check',
        deps.fetchImpl
      );
      if (result.ok) deps.secrets.add(result.grant.apiKey);
      return result.ok ? result.grant : null;
    })();
    if (!ttsKey) {
      rows.push(row(TWICE, 'failed', 'kein Kurzzeit-Schlüssel'));
    } else {
      try {
        const twice = await sonioxSpeakTwice(deps, ttsKey);
        rows.push(
          twice.firstMs === null || twice.secondMs === null
            ? row(TWICE, 'failed', 'Soniox lieferte nicht für beide Sätze Ton.')
            : row(
                TWICE,
                'ok',
                `erster Satz nach ${seconds(twice.firstMs)} (mit Verbindungsaufbau), zweiter Satz nach ${seconds(twice.secondMs)} auf der stehenden Verbindung`
              )
        );
      } catch (error) {
        rows.push(row(TWICE, 'failed', errorText(error)));
      }
    }
  }

  if (!probe.pcm) {
    rows.push(row(CHECK, 'skipped', 'keine Sprache erzeugt'));
    rows.push(row(SECOND, 'skipped', 'keine Sprache erzeugt'));
    return rows;
  }
  let webm = null;
  try {
    webm = await deps.encodeWebm(withSilence(probe.pcm));
  } catch (error) {
    rows.push(row(CHECK, 'failed', errorText(error)));
    rows.push(row(SECOND, 'skipped', 'keine Aufnahme erzeugt'));
    return rows;
  }
  if (!webm) {
    const note =
      'ffmpeg nicht gefunden: die Probe kodiert die Sprache mit ffmpeg zu webm/opus wie der Browser (Windows: winget install Gyan.FFmpeg).';
    rows.push(row(CHECK, 'skipped', note));
    rows.push(row(SECOND, 'skipped', note));
    return rows;
  }

  const grant = await freshRecognitionKey(deps, probe.config, CHECK, rows);
  if (!grant) {
    rows.push(row(SECOND, 'skipped', 'kein Kurzzeit-Schlüssel'));
    return rows;
  }
  try {
    const heard = await sonioxRecognizeWebm(deps, grant, webm);
    const outcome = recognitionRow(CHECK, heard.text, heard.ms);
    const endpoint =
      heard.endpointMs === null
        ? 'kein Endpunkt gemeldet'
        : `Endpunkt ${seconds(heard.endpointMs)} nach dem letzten Stück`;
    const first =
      heard.firstMs === null
        ? 'kein Wort'
        : `erstes Wort nach ${seconds(heard.firstMs)}`;
    const prefix = `${heard.slices} Stücke (${kilobytes(webm.length)}), ${first}, ${endpoint}, `;
    rows.push({ ...outcome, detail: `${prefix}${outcome.detail}` });
  } catch (error) {
    rows.push(row(CHECK, 'failed', errorText(error)));
  }

  // the same key for a second connection: may the stock of keys use it twice?
  try {
    await sonioxRecognizeWebm(deps, grant, webm, {
      maxSlices: 3,
      endAfterSend: true,
    });
    rows.push(
      row(
        SECOND,
        'ok',
        'angenommen: der Schlüssel darf in seiner Laufzeit mehrfach genutzt werden (die App gibt ihn trotzdem nur einmal aus, das ist sicher)'
      )
    );
  } catch (error) {
    const text = errorText(error);
    rows.push(
      text.startsWith('Soniox meldet den Fehler')
        ? row(
            SECOND,
            'ok',
            `abgelehnt (${text}): der Schlüssel gilt für eine Verbindung, die App gibt jeden Schlüssel nur einmal aus, das ist richtig so`
          )
        : row(SECOND, 'failed', text)
    );
  }
  return rows;
}

// ---------------------------------------------------------------------------
// Run and output
// ---------------------------------------------------------------------------

export const USAGE =
  'Aufruf: node scripts/hai/voice-live-check.mjs [--only soniox|haus] [--webm]';

/** The providers to check, or an error text. */
export function parseArgs(argv) {
  let only = null;
  let webm = false;
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--only' || arg.startsWith('--only=')) {
      const value =
        arg === '--only' ? argv[(i += 1)] : arg.slice('--only='.length);
      if (!PROVIDERS.includes(value)) {
        return { error: `--only kennt soniox oder haus. ${USAGE}` };
      }
      only = value;
    } else if (arg === '--webm') {
      webm = true;
    } else {
      return { error: `Unbekannter Schalter ${arg}. ${USAGE}` };
    }
  }
  if (webm && only === 'haus') {
    return { error: `--webm gehört zu Soniox. ${USAGE}` };
  }
  return { providers: only ? [only] : PROVIDERS, webm };
}

export function exitCodeOf(rows) {
  if (rows.some(r => r.outcome === 'failed')) return EXIT.FAILED;
  if (rows.some(r => r.outcome === 'not_set_up')) return EXIT.NOT_SET_UP;
  return EXIT.OK;
}

function table(rows) {
  const width = Math.max(...rows.map(r => r.check.length), 'Prüfung'.length);
  const status = Math.max(
    ...rows.map(r => OUTCOME_TEXT[r.outcome].length),
    'Ergebnis'.length
  );
  const line = (a, b, c) => `${a.padEnd(width)}  ${b.padEnd(status)}  ${c}`;
  return [
    line('Prüfung', 'Ergebnis', 'Einzelheiten'),
    line('-'.repeat(width), '-'.repeat(status), '-'.repeat(12)),
    ...rows.map(r => line(r.check, OUTCOME_TEXT[r.outcome], r.detail)),
  ];
}

/**
 * Runs the checks. Everything from outside is passed in (environment, fetch,
 * websocket, output, clock), so the tests replace it. Returns the exit code
 * and the rows; the lines written are the table and a summary.
 */
export async function runVoiceCheck({
  env = process.env,
  argv = [],
  fetchImpl = globalThis.fetch,
  WebSocketImpl = globalThis.WebSocket,
  write = line => process.stdout.write(`${line}\n`),
  now = () => performance.now(),
  encodeWebm = encodeWebmWithFfmpeg,
  endWaitMs = END_WAIT_MS,
} = {}) {
  const parsed = parseArgs(argv);
  if ('error' in parsed) {
    write(parsed.error);
    return { exitCode: EXIT.NOT_SET_UP, rows: [] };
  }
  const secrets = new Set();
  // a secret that slips into any text is replaced before it is written
  const scrub = text => {
    let clean = String(text);
    for (const secret of secrets) {
      if (secret) clean = clean.split(secret).join('[verborgen]');
    }
    return clean;
  };
  const deps = {
    env,
    fetchImpl,
    WebSocketImpl,
    now,
    secrets,
    encodeWebm,
    endWaitMs,
    probe: null,
  };
  const rows = [];
  for (const provider of parsed.providers) {
    try {
      rows.push(
        ...(await (provider === 'soniox' ? checkSoniox(deps) : checkHaus(deps)))
      );
      if (provider === 'soniox' && parsed.webm) {
        rows.push(...(await checkSonioxWebm(deps)));
      }
    } catch (error) {
      rows.push(
        row(
          provider === 'soniox' ? 'Soniox' : 'Sokrates',
          'failed',
          `unerwarteter Fehler: ${errorText(error)}`
        )
      );
    }
  }
  const exitCode = exitCodeOf(rows);
  for (const line of table(rows)) write(scrub(line));
  const count = outcome => rows.filter(r => r.outcome === outcome).length;
  write(
    scrub(
      `\n${count('ok')} bestanden, ${count('failed')} Fehler, ${count('not_set_up')} nicht eingerichtet, ${count('skipped')} übersprungen. Exitcode ${exitCode}.`
    )
  );
  return { exitCode, rows };
}

const isMain =
  process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isMain) {
  runVoiceCheck({ argv: process.argv.slice(2) }).then(
    ({ exitCode }) => {
      process.exitCode = exitCode;
    },
    () => {
      process.stdout.write('Das Prüfwerkzeug ist abgestürzt.\n');
      process.exitCode = EXIT.FAILED;
    }
  );
}
