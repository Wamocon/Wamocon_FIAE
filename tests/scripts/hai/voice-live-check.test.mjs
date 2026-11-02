// The check tool of the speech providers (scripts/hai/voice-live-check.mjs) with
// a replaced fetch and a replaced websocket: no network, no keys. Pinned here:
// the happy path, the wrong region of Soniox (401), a 500 of the speech
// recognition behind Open WebUI, "not set up" (exit code 2), the arguments, and
// that no key and no short lived key ever shows in the output.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { runVoiceCheck } from '../../../scripts/hai/voice-live-check.mjs';

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
  const impl = async (url, init = {}) => {
    const address = String(url);
    calls.push({ url: address, init });
    if (address.endsWith('/v1/auth/temporary-api-key')) {
      const host = new URL(address).host;
      const status = options.sonioxStatus?.[host] ?? 201;
      if (status !== 201) return json(status, { error: 'refused' });
      const usage = JSON.parse(init.body).usage_type;
      return json(201, { api_key: `TEMP-${usage}-${host}` });
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
  class FakeSocket {
    constructor(url, protocols) {
      this.url = url;
      this.protocols = protocols;
      this.sent = [];
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
      // recognition: the empty text frame ends the audio
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

async function run(env, { argv = [], fetchOptions, socketOptions } = {}) {
  const fetchDouble = fakeFetch(fetchOptions);
  const socketDouble = fakeSocketClass(socketOptions);
  const lines = [];
  const result = await runVoiceCheck({
    env,
    argv,
    fetchImpl: fetchDouble.impl,
    WebSocketImpl: socketDouble.Class,
    write: line => lines.push(line),
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
      recognized: `Primärschlüssel ${SONIOX_KEY} TEMP-transcribe_websocket-api.eu.soniox.com`,
    },
    fetchOptions: {
      transcribe: json(200, { text: `Primärschlüssel ${HAUS_KEY}` }),
    },
  });
  assertNoSecret(out);
  assert.match(out, /\[verborgen\]/);
});
