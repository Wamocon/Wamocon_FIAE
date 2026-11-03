// The check tool of the speech providers (scripts/hai/voice-live-check.mjs) with
// a replaced fetch and a replaced websocket: no network, no keys. Pinned here:
// the happy path, the wrong region of Soniox (401), a 500 of the speech
// recognition behind Open WebUI, "not set up" (exit code 2), the arguments, and
// that no key and no short lived key ever shows in the output.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import {
  encodeWebmWithFfmpeg,
  parseArgs,
  runVoiceCheck,
} from '../../../scripts/hai/voice-live-check.mjs';

const SONIOX_KEY = 'soniox-real-key-0123456789';
const HAUS_KEY = 'sk-haus-real-key-abcdef';
const SONIOX_ENV = { SONIOX_API_KEY: SONIOX_KEY };
const HAUS_ENV = { OPENAI_COMPATIBLE_API_KEY: HAUS_KEY };
const BOTH_ENV = { ...SONIOX_ENV, ...HAUS_ENV };
const QUESTION = 'Was ist ein Primärschlüssel?';

const json = (status, body) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });

/**
 * A fetch that answers like the services. `options` changes single answers:
 * sonioxStatus (by host), transcribe (a Response or a function).
 */
function fakeFetch(options = {}) {
  const calls = [];
  let issued = 0;
  const impl = async (url, init = {}) => {
    const address = String(url);
    calls.push({ url: address, init });
    if (address.endsWith('/v1/auth/temporary-api-key')) {
      const host = new URL(address).host;
      const status = options.sonioxStatus?.[host] ?? 201;
      if (status !== 201) return json(status, { error: 'refused' });
      const usage = JSON.parse(init.body).usage_type;
      issued += 1;
      return json(201, { api_key: `TEMP-${usage}-${host}-${issued}` });
    }
    if (address.endsWith('/v1/audio/speech')) {
      return (
        options.speech ??
        new Response(new Uint8Array(24_000).fill(7), {
          status: 200,
          headers: { 'content-type': 'audio/mpeg' },
        })
      );
    }
    if (address.endsWith('/v1/audio/transcriptions')) {
      return (
        options.transcribe ?? json(200, { text: QUESTION, filename: 'x.mp3' })
      );
    }
    return json(404, {});
  };
  return { impl, calls };
}

/** A websocket that behaves like the Soniox endpoints (speech output and recognition). */
function fakeSocketClass(options = {}) {
  const sockets = [];
  const usedKeys = new Set();
  class FakeSocket {
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.sent = [];
      this.binary = 0;
      sockets.push(this);
      setTimeout(() => this.onopen?.(), 0);
    }
    emit(message) {
      setTimeout(() => this.onmessage?.({ data: JSON.stringify(message) }), 0);
    }
    send(data) {
      this.sent.push(data);
      if (this.url.includes('tts-rt')) {
        if (typeof data === 'string' && data.includes('text_end')) {
          if (options.ttsError) {
            this.emit({ error_code: 503, error_message: 'busy' });
            return;
          }
          const stream = JSON.parse(data).stream_id;
          const pcm = Buffer.alloc(24_000 * 2 * 1.5);
          this.emit({ audio: pcm.toString('base64'), stream_id: stream });
          this.emit({ audio_end: true, stream_id: stream });
          this.emit({ terminated: true, stream_id: stream });
        }
        return;
      }
      // recognition: a key that was used once is refused (option rejectReuse)
      if (
        options.rejectReuse &&
        typeof data === 'string' &&
        data.startsWith('{')
      ) {
        if (usedKeys.has(this.protocols[1])) {
          this.emit({ error_code: 400, error_message: 'key used' });
          return;
        }
        usedKeys.add(this.protocols[1]);
      }
      // the container of the browser: words while the audio comes, the endpoint after the
      // third slice (option webmEndpoint)
      if (options.webmEndpoint && typeof data !== 'string') {
        this.binary += 1;
        if (this.binary === 1) {
          this.emit({ tokens: [{ text: 'Was', is_final: false }] });
        }
        if (this.binary === 3) {
          this.endpointSent = true;
          this.emit({
            tokens: [
              { text: options.recognized ?? QUESTION, is_final: true },
              { text: '<end>', is_final: true },
            ],
          });
        }
        return;
      }
      // recognition: the empty text frame ends the audio
      if (data === '' && this.endpointSent) {
        this.emit({ tokens: [], finished: true });
        return;
      }
      if (data === '') {
        this.emit({
          tokens: [
            { text: options.recognized ?? QUESTION, is_final: true },
            { text: '<end>', is_final: true },
          ],
        });
        this.emit({ tokens: [], finished: true });
      }
    }
    close() {}
  }
  return { Class: FakeSocket, sockets };
}

async function run(
  env,
  {
    argv = [],
    fetchOptions,
    socketOptions,
    encodeWebm,
    endWaitMs = 20,
    realtime = false,
  } = {}
) {
  const fetchDouble = fakeFetch(fetchOptions);
  const socketDouble = fakeSocketClass(socketOptions);
  const lines = [];
  const result = await runVoiceCheck({
    env,
    argv,
    fetchImpl: fetchDouble.impl,
    WebSocketImpl: socketDouble.Class,
    write: line => lines.push(line),
    endWaitMs,
    realtime,
    ...(encodeWebm ? { encodeWebm } : {}),
  });
  return {
    ...result,
    out: lines.join('\n'),
    calls: fetchDouble.calls,
    sockets: socketDouble.sockets,
  };
}

const SECRETS = [SONIOX_KEY, HAUS_KEY, 'TEMP-'];

function assertNoSecret(out) {
  for (const secret of SECRETS) {
    assert.ok(!out.includes(secret), `the output shows ${secret}`);
  }
}

test('everything works: exit code 0, both providers pass, the term comes back', async () => {
  const { exitCode, out, rows } = await run(BOTH_ENV);
  assert.equal(exitCode, 0, out);
  assert.equal(rows.length, 8);
  assert.ok(
    rows.every(r => r.outcome === 'ok'),
    out
  );
  assert.match(out, /Soniox Sprachausgabe\s+bestanden/);
  assert.match(
    out,
    /Soniox Erkennung[^\n]*bestanden[^\n]*erkannt "Was ist ein Primärschlüssel\?"/
  );
  assert.match(
    out,
    /Sokrates Sprachausgabe\s+bestanden\s+HTTP 200, [\d,]+ s, audio\/mpeg, 23 KB/
  );
  assert.match(out, /Sokrates Erkennung[^\n]*bestanden\s+HTTP 200/);
  assert.match(out, /Exitcode 0\./);
  assertNoSecret(out);
});

test('the websockets get the short lived keys, the real key never leaves the key request', async () => {
  const { sockets, calls } = await run(BOTH_ENV);
  assert.equal(sockets.length, 2);
  for (const socket of sockets) {
    assert.equal(socket.protocols[0], 'soniox-api-key');
    assert.ok(socket.protocols[1].startsWith('TEMP-'));
    assert.notEqual(socket.protocols[1], SONIOX_KEY);
    assert.ok(
      socket.sent.every(m => typeof m !== 'string' || !m.includes(SONIOX_KEY))
    );
  }
  // EU is the default region: the addresses come from the code of the app
  const tokenCalls = calls.filter(c => c.url.endsWith('/temporary-api-key'));
  assert.deepEqual(
    tokenCalls.map(c => new URL(c.url).host),
    ['api.eu.soniox.com', 'api.eu.soniox.com']
  );
  assert.equal(
    tokenCalls[0].init.headers.Authorization,
    `Bearer ${SONIOX_KEY}`
  );
  assert.deepEqual(
    tokenCalls.map(c => JSON.parse(c.init.body).usage_type),
    ['tts_rt', 'transcribe_websocket']
  );
  assert.equal(sockets[0].url, 'wss://tts-rt.eu.soniox.com/tts-websocket');
  assert.equal(
    sockets[1].url,
    'wss://stt-rt.eu.soniox.com/transcribe-websocket'
  );
  // the speech output is sent as the text of the question, in UTF-8
  const text = JSON.parse(sockets[0].sent[1]).text;
  assert.equal(text, QUESTION);
  // the recognition gets raw PCM and an empty text frame at the end
  const config = JSON.parse(sockets[1].sent[0]);
  assert.equal(config.audio_format, 'pcm_s16le');
  assert.equal(sockets[1].sent.at(-1), '');
});

test('Sokrates is called under /v1/audio, speech output as JSON, recognition with the MP3', async () => {
  const { calls } = await run(HAUS_ENV, { argv: ['--only', 'haus'] });
  const speech = calls.find(c => c.url.endsWith('/v1/audio/speech'));
  const transcription = calls.find(c =>
    c.url.endsWith('/v1/audio/transcriptions')
  );
  assert.equal(
    speech.url,
    'https://sokrates.test-qualitaetsmanagement.com/api/v1/audio/speech'
  );
  assert.equal(speech.init.headers['Content-Type'], 'application/json');
  assert.equal(JSON.parse(speech.init.body).input, QUESTION);
  assert.equal(JSON.parse(speech.init.body).model, 'tts-1');
  const file = transcription.init.body.get('file');
  assert.equal(file.type, 'audio/mpeg');
  assert.equal(file.name, 'voice-live-check.mp3');
  assert.equal(transcription.init.body.get('model'), 'whisper-1');
});

test('the term is also found without umlauts', async () => {
  const { exitCode, out } = await run(SONIOX_ENV, {
    argv: ['--only', 'soniox'],
    socketOptions: { recognized: 'Was ist ein Primaerschluessel' },
  });
  assert.equal(exitCode, 0, out);
});

test('another text is a failure and names what was heard', async () => {
  const { exitCode, out } = await run(SONIOX_ENV, {
    argv: ['--only', 'soniox'],
    socketOptions: { recognized: 'Hallo Welt' },
  });
  assert.equal(exitCode, 1);
  assert.match(
    out,
    /Der Begriff Primärschlüssel wurde nicht erkannt, erkannt: "Hallo Welt"/
  );
});

test('Soniox 401 in the wrong region: exit code 1 with the cause, the other region is asked once', async () => {
  const { exitCode, out, calls, rows } = await run(SONIOX_ENV, {
    argv: ['--only', 'soniox'],
    fetchOptions: { sonioxStatus: { 'api.eu.soniox.com': 401 } },
  });
  assert.equal(exitCode, 1);
  assert.match(out, /Schlüssel gehört zu einem Projekt einer anderen Region/);
  assert.match(out, /Gegenprobe in Region us: HTTP 201/);
  assert.match(out, /Soniox Sprachausgabe\s+übersprungen/);
  // two requests to eu (speech output and recognition), one counter probe to us
  assert.equal(
    calls.filter(c => c.url.includes('api.eu.soniox.com')).length,
    2
  );
  assert.equal(calls.filter(c => c.url.includes('//api.soniox.com')).length, 1);
  assert.equal(rows.filter(r => r.outcome === 'failed').length, 2);
  assertNoSecret(out);
});

test('Soniox 401 in both regions: the key is named invalid', async () => {
  const { exitCode, out } = await run(SONIOX_ENV, {
    argv: ['--only', 'soniox'],
    fetchOptions: {
      sonioxStatus: { 'api.eu.soniox.com': 401, 'api.soniox.com': 401 },
    },
  });
  assert.equal(exitCode, 1);
  assert.match(out, /auch dort abgelehnt/);
  assert.ok(!out.includes('einer anderen Region'));
});

test('Soniox not reachable: failure without a status', async () => {
  const lines = [];
  const { exitCode } = await runVoiceCheck({
    env: SONIOX_ENV,
    argv: ['--only', 'soniox'],
    fetchImpl: async () => {
      throw new Error(`connect ECONNREFUSED ${SONIOX_KEY}`);
    },
    WebSocketImpl: fakeSocketClass().Class,
    write: line => lines.push(line),
  });
  assert.equal(exitCode, 1);
  assert.match(lines.join('\n'), /Soniox ist nicht erreichbar/);
  assertNoSecret(lines.join('\n'));
});

test('the speech output of Soniox reports an error: failure, the recognition is skipped', async () => {
  const { exitCode, out } = await run(SONIOX_ENV, {
    argv: ['--only', 'soniox'],
    socketOptions: { ttsError: true },
  });
  assert.equal(exitCode, 1);
  assert.match(
    out,
    /Soniox Sprachausgabe\s+FEHLER\s+Soniox meldet den Fehler 503/
  );
  assert.match(out, /Soniox Erkennung[^\n]*übersprungen/);
});

test('Sokrates answers 500 on the recognition: exit code 1, the speech service behind Open WebUI is named', async () => {
  const { exitCode, out, rows } = await run(HAUS_ENV, {
    argv: ['--only', 'haus'],
    fetchOptions: { transcribe: new Response('boom', { status: 500 }) },
  });
  assert.equal(exitCode, 1);
  assert.match(out, /Sokrates Sprachausgabe\s+bestanden/);
  assert.match(
    out,
    /HTTP 500: Der Sprachdienst hinter Open WebUI \(Spracherkennung\) antwortet mit einem Serverfehler/
  );
  assert.equal(rows.find(r => r.check.includes('Erkennung')).outcome, 'failed');
  assertNoSecret(out);
});

test('Sokrates answers 405 on the speech output: the path is named, the recognition is skipped', async () => {
  const { exitCode, out } = await run(HAUS_ENV, {
    argv: ['--only', 'haus'],
    fetchOptions: { speech: new Response('no', { status: 405 }) },
  });
  assert.equal(exitCode, 1);
  assert.match(out, /HTTP 405: Der Pfad stimmt nicht/);
  assert.match(out, /Sokrates Erkennung[^\n]*übersprungen/);
});

test('Sokrates refuses the key: 401 is named', async () => {
  const { out } = await run(HAUS_ENV, {
    argv: ['--only', 'haus'],
    fetchOptions: { speech: new Response('no', { status: 401 }) },
  });
  assert.match(out, /HTTP 401: Sokrates lehnt den Schlüssel ab/);
});

test('an answer of the recognition without the form {text, filename} is a failure', async () => {
  const { exitCode, out } = await run(HAUS_ENV, {
    argv: ['--only', 'haus'],
    fetchOptions: { transcribe: json(200, { result: 'x' }) },
  });
  assert.equal(exitCode, 1);
  assert.match(
    out,
    /HTTP 200: Die Antwort hat nicht die Form \{text, filename\}/
  );
});

test('nothing is set up: exit code 2, no request is made, only "set yes or no" is said', async () => {
  const { exitCode, out, calls, sockets } = await run({});
  assert.equal(exitCode, 2);
  assert.match(
    out,
    /Soniox eingerichtet\s+nicht eingerichtet\s+SONIOX_API_KEY gesetzt: nein/
  );
  assert.match(
    out,
    /Sokrates eingerichtet\s+nicht eingerichtet\s+OPENAI_COMPATIBLE_API_KEY gesetzt: nein/
  );
  assert.equal(calls.length, 0);
  assert.equal(sockets.length, 0);
});

test('a wrong region value or a foreign host is "not set up", not a failure', async () => {
  const { exitCode, out, calls } = await run({
    SONIOX_API_KEY: SONIOX_KEY,
    SONIOX_REGION: 'asia',
    OPENAI_COMPATIBLE_API_KEY: HAUS_KEY,
    OPENAI_COMPATIBLE_BASE_URL: 'https://attacker.example/api',
  });
  assert.equal(exitCode, 2);
  assert.match(out, /SONIOX_REGION muss eu oder us sein/);
  assert.match(out, /nicht auf der Positivliste/);
  assert.equal(calls.length, 0, 'a key is never sent to a foreign host');
});

test('a failure wins over "not set up"', async () => {
  const { exitCode } = await run(SONIOX_ENV, {
    fetchOptions: { sonioxStatus: { 'api.eu.soniox.com': 401 } },
  });
  // Soniox fails, Sokrates is not set up
  assert.equal(exitCode, 1);
});

test('--only limits the providers, in both spellings', async () => {
  const soniox = await run(BOTH_ENV, { argv: ['--only', 'soniox'] });
  assert.ok(soniox.rows.every(r => r.check.startsWith('Soniox')));
  assert.equal(soniox.exitCode, 0);
  const haus = await run(BOTH_ENV, { argv: ['--only=haus'] });
  assert.ok(haus.rows.every(r => r.check.startsWith('Sokrates')));
  assert.equal(haus.sockets.length, 0);
});

test('a wrong call gives the usage and exit code 2', async () => {
  for (const argv of [['--only', 'cloud'], ['--only'], ['--verbose']]) {
    const { exitCode, out, calls } = await run(BOTH_ENV, { argv });
    assert.equal(exitCode, 2, argv.join(' '));
    assert.match(out, /Aufruf: node scripts\/hai\/voice-live-check\.mjs/);
    assert.equal(calls.length, 0);
  }
});

test('no key and no short lived key in the output, even if a service repeats them', async () => {
  const { out } = await run(BOTH_ENV, {
    // a recognized text that contains the keys (a hostile or broken service)
    socketOptions: {
      recognized: `Primärschlüssel ${SONIOX_KEY} TEMP-transcribe_websocket-api.eu.soniox.com-2`,
    },
    fetchOptions: {
      transcribe: json(200, { text: `Primärschlüssel ${HAUS_KEY}` }),
    },
  });
  assertNoSecret(out);
  assert.match(out, /\[verborgen\]/);
});

// ---------------------------------------------------------------------------
// --webm: the way of the browser
// ---------------------------------------------------------------------------

const WEBM_FILE = Buffer.alloc(5_000, 1);
const fakeEncode = async pcm => {
  assert.ok(pcm.length > 0);
  return WEBM_FILE;
};
const WEBM = ['--only', 'soniox', '--webm'];
const WEBM_SOCKETS = { webmEndpoint: true };
const isWebmSocket = s =>
  s.url.includes('stt-rt') && JSON.parse(s.sent[0]).audio_format === 'auto';

test('--webm is an argument of the check, it belongs to Soniox', () => {
  assert.deepEqual(parseArgs(['--webm']), {
    providers: ['soniox', 'haus'],
    webm: true,
  });
  assert.deepEqual(parseArgs([]), {
    providers: ['soniox', 'haus'],
    webm: false,
  });
  assert.match(
    parseArgs(['--only', 'haus', '--webm']).error,
    /--webm gehört zu Soniox/
  );
});

test('without --webm there is no probe of the browser way and no ffmpeg call', async () => {
  const { rows } = await run(SONIOX_ENV, {
    argv: ['--only', 'soniox'],
    encodeWebm: async () => {
      throw new Error('must not be called');
    },
  });
  assert.equal(rows.length, 5);
  assert.ok(rows.every(r => !r.check.includes('Browserweg')));
});

test('--webm sends the recording as the browser does: container in slices, the config of the app, endpoint', async () => {
  const { exitCode, rows, out, sockets } = await run(SONIOX_ENV, {
    argv: WEBM,
    encodeWebm: fakeEncode,
    socketOptions: WEBM_SOCKETS,
  });
  assert.equal(exitCode, 0, out);
  assert.ok(
    rows.every(r => r.outcome === 'ok'),
    out
  );
  assert.match(
    out,
    /Soniox Browserweg \(webm\/opus, Endpunkterkennung\)\s+bestanden\s+7 Stücke \(5 KB\), erstes Wort nach [\d,]+ s, Endpunkt [\d,]+ s nach dem Ende der Sprache, erkannt "Was ist ein Primärschlüssel\?"/
  );
  assert.match(
    out,
    /Soniox zweite Verbindung mit demselben Schlüssel\s+bestanden\s+angenommen/
  );
  assert.match(
    out,
    /Soniox zweiter Sprach-Strom auf derselben Verbindung\s+bestanden\s+erster Satz nach [\d,]+ s \(mit Verbindungsaufbau\), zweiter Satz nach [\d,]+ s auf der stehenden Verbindung/
  );
  // the recognition of the browser way: the config of the app, unchanged, then binary slices
  const webm = sockets.find(isWebmSocket);
  const config = JSON.parse(webm.sent[0]);
  assert.equal(config.audio_format, 'auto');
  assert.equal(config.enable_endpoint_detection, true);
  assert.equal(config.endpoint_sensitivity, 0.2);
  assert.equal(config.endpoint_latency_adjustment_level, 1);
  assert.equal(config.max_endpoint_delay_ms, 1000);
  assert.equal(config.sample_rate, undefined);
  const slices = webm.sent.filter(m => typeof m !== 'string');
  assert.equal(slices.length, 7);
  assert.ok(slices.slice(0, -1).every(m => m.length === 800));
  assert.equal(
    slices.reduce((n, m) => n + m.length, 0),
    5_000
  );
  // the end of the stream is an empty text frame, sent at the endpoint
  assert.equal(webm.sent.at(-1), '');
  assertNoSecret(out);
});

test('--webm: the browser way gets a fresh key, the second connection reuses that key', async () => {
  const { sockets, calls } = await run(SONIOX_ENV, {
    argv: WEBM,
    encodeWebm: fakeEncode,
    socketOptions: WEBM_SOCKETS,
  });
  const usages = calls
    .filter(c => c.url.endsWith('/temporary-api-key'))
    .map(c => JSON.parse(c.init.body).usage_type);
  // tts and stt of the first probe, a fresh tts key for the two streams, a fresh stt key
  assert.deepEqual(usages, [
    'tts_rt',
    'transcribe_websocket',
    'tts_rt',
    'transcribe_websocket',
  ]);
  const webmSockets = sockets.filter(isWebmSocket);
  assert.equal(webmSockets.length, 2);
  assert.equal(webmSockets[0].protocols[1], webmSockets[1].protocols[1]);
  // the second connection sends only three slices and ends the stream
  assert.equal(
    webmSockets[1].sent.filter(m => typeof m !== 'string').length,
    3
  );
  assert.equal(webmSockets[1].sent.at(-1), '');
  // one connection with two streams
  const twoStreams = sockets
    .filter(s => s.url.includes('tts-rt'))
    .find(s => s.sent.filter(m => m.includes('text_end')).length === 2);
  assert.ok(twoStreams);
  assert.equal(
    JSON.parse(twoStreams.sent[3]).text,
    'Das ist die zweite Antwort.'
  );
});

test('--webm: a service that refuses a key for a second connection is no failure, it is named', async () => {
  const { exitCode, out, rows } = await run(SONIOX_ENV, {
    argv: WEBM,
    encodeWebm: fakeEncode,
    socketOptions: { ...WEBM_SOCKETS, rejectReuse: true },
  });
  assert.equal(exitCode, 0, out);
  const second = rows.find(r => r.check.includes('zweite Verbindung'));
  assert.equal(second.outcome, 'ok');
  assert.match(second.detail, /abgelehnt \(Soniox meldet den Fehler 400\)/);
  assert.match(second.detail, /jeden Schlüssel nur einmal aus/);
});

test('--webm without ffmpeg: a clear note, the two streams on one connection are still measured', async () => {
  const { exitCode, out, rows } = await run(SONIOX_ENV, {
    argv: WEBM,
    encodeWebm: async () => null,
  });
  assert.equal(exitCode, 0, out);
  assert.match(out, /ffmpeg nicht gefunden/);
  assert.match(out, /winget install Gyan\.FFmpeg/);
  assert.equal(
    rows.find(r => r.check.includes('Browserweg')).outcome,
    'skipped'
  );
  assert.equal(
    rows.find(r => r.check.includes('zweite Verbindung')).outcome,
    'skipped'
  );
  assert.equal(rows.find(r => r.check.includes('Sprach-Strom')).outcome, 'ok');
});

test('--webm: ffmpeg that fails is an error of the probe', async () => {
  const { exitCode, rows } = await run(SONIOX_ENV, {
    argv: WEBM,
    encodeWebm: async () => {
      throw new Error('ffmpeg endete mit dem Code 1');
    },
  });
  assert.equal(exitCode, 1);
  const failed = rows.find(r => r.check.includes('Browserweg'));
  assert.equal(failed.outcome, 'failed');
  assert.match(failed.detail, /ffmpeg endete mit dem Code 1/);
});

test('--webm: a recording that Soniox does not understand is an error with what was heard', async () => {
  const { exitCode, rows } = await run(SONIOX_ENV, {
    argv: WEBM,
    encodeWebm: fakeEncode,
    socketOptions: { ...WEBM_SOCKETS, recognized: 'Hallo Welt' },
  });
  assert.equal(exitCode, 1);
  const failed = rows.find(r => r.check.includes('Browserweg'));
  assert.equal(failed.outcome, 'failed');
  assert.match(failed.detail, /erkannt: "Hallo Welt"/);
});

test('--webm: when no endpoint comes the stream is ended after a wait', async () => {
  // this fake reports no <end> before the empty frame
  const { rows, out } = await run(SONIOX_ENV, {
    argv: WEBM,
    encodeWebm: fakeEncode,
    socketOptions: {},
  });
  const probe = rows.find(r => r.check.includes('Browserweg'));
  assert.ok(probe.detail.includes('7 Stücke'), out);
});

test('--webm: Soniox not set up gives the probe no ground, and no ffmpeg call', async () => {
  const { exitCode, rows } = await run(
    {},
    {
      argv: WEBM,
      encodeWebm: async () => {
        throw new Error('must not be called');
      },
    }
  );
  assert.equal(exitCode, 2);
  assert.equal(
    rows.find(r => r.check.includes('Browserweg')).outcome,
    'skipped'
  );
});

test('--webm: no key and no short lived key in the output', async () => {
  const { out } = await run(SONIOX_ENV, {
    argv: WEBM,
    encodeWebm: fakeEncode,
    socketOptions: {
      ...WEBM_SOCKETS,
      recognized: `Primärschlüssel ${SONIOX_KEY} TEMP-transcribe_websocket-api.eu.soniox.com-2 TEMP-transcribe_websocket-api.eu.soniox.com-4`,
    },
  });
  assertNoSecret(out);
});

// ffmpeg itself, with a replaced process
function fakeSpawn({
  error,
  code = 0,
  output = Buffer.from('webm-bytes'),
} = {}) {
  const calls = [];
  const impl = (command, args) => {
    calls.push({ command, args });
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stdin = Object.assign(new EventEmitter(), {
      end() {
        setTimeout(() => {
          if (error) {
            child.emit('error', error);
            return;
          }
          if (output.length > 0) child.stdout.emit('data', output);
          child.emit('close', code);
        }, 0);
      },
    });
    return child;
  };
  return { impl, calls };
}

test('ffmpeg is called with raw PCM on stdin and gives webm/opus on stdout', async () => {
  const spawned = fakeSpawn();
  const webm = await encodeWebmWithFfmpeg(Buffer.alloc(100), spawned.impl);
  assert.equal(webm.toString(), 'webm-bytes');
  assert.equal(spawned.calls[0].command, 'ffmpeg');
  const args = spawned.calls[0].args.join(' ');
  assert.match(args, /-f s16le -ar 24000 -ac 1 -i pipe:0/);
  assert.match(args, /-c:a libopus/);
  assert.match(args, /-f webm pipe:1/);
});

test('ffmpeg that is not installed gives null, one that fails gives an error', async () => {
  const missing = fakeSpawn({
    error: Object.assign(new Error('x'), { code: 'ENOENT' }),
  });
  assert.equal(await encodeWebmWithFfmpeg(Buffer.alloc(1), missing.impl), null);
  const broken = fakeSpawn({ code: 1 });
  await assert.rejects(
    encodeWebmWithFfmpeg(Buffer.alloc(1), broken.impl),
    /ffmpeg endete mit dem Code 1/
  );
  const empty = fakeSpawn({ output: Buffer.alloc(0) });
  await assert.rejects(encodeWebmWithFfmpeg(Buffer.alloc(1), empty.impl));
  const crash = fakeSpawn({ error: new Error('boom') });
  await assert.rejects(
    encodeWebmWithFfmpeg(Buffer.alloc(1), crash.impl),
    /ffmpeg lässt sich nicht starten/
  );
  const throwing = () => {
    throw new Error('spawn failed');
  };
  assert.equal(await encodeWebmWithFfmpeg(Buffer.alloc(1), throwing), null);
});

test('--webm in real time: the slices are paced over the length of the recording, like the browser', async () => {
  const started = Date.now();
  const { rows, out } = await run(SONIOX_ENV, {
    argv: WEBM,
    encodeWebm: fakeEncode,
    socketOptions: WEBM_SOCKETS,
    realtime: true,
  });
  const elapsed = Date.now() - started;
  const probe = rows.find(r => r.check.includes('Browserweg'));
  assert.equal(probe.outcome, 'ok', out);
  // 1,5 s of speech and 1,5 s of silence, the endpoint comes after the third slice of seven,
  // so about 1,3 s are spent pacing (and not poured in at once)
  assert.ok(elapsed > 1_000, `elapsed ${elapsed} ms`);
  // the endpoint came early: not all seven slices were needed
  assert.match(probe.detail, /^[1-7] Stücke/);
});
