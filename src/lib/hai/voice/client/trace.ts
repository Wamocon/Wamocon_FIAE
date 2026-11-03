/**
 * Measuring points of the voice assistant in the browser. They answer two
 * questions that cannot be answered from the code alone: where does the time go
 * between "the answer begins" and "the first sound", and why does the assistant
 * hear nothing (which provider took over and why).
 *
 * Off by default. Switch on in the console of the browser:
 *   localStorage.setItem('hai-voice-trace', '1')    (off: removeItem)
 * Then every mark is written to the console as `[hai-voice] name +ms (data)`,
 * set as `performance.mark('hai-voice:name')` and kept in `window.haiVoiceTrace()`
 * (array of { name, at, data }), together with the derived times A to E.
 *
 * Only times, provider ids, states and error codes are ever recorded. NEVER the
 * text of a question or an answer, a transcript, a key or an address: the data
 * of a mark are numbers, booleans and short tokens (letters, digits, `_ . : -`,
 * at most 48 characters). Anything else is dropped, so a slip of a caller cannot
 * leak a sentence.
 *
 * The derived times (what Niko copies from the console):
 *   A  endpoint wait        stt.interim.first -> stt.endpoint
 *   B  server until text    submit -> chat.first.text
 *   C  sentence split       chat.first.text -> piece.first
 *   D  start of the voice   piece.first -> play.first   (the "voice is late" number)
 *   E  start of listening   listen.start -> stt.interim.first
 *   F  key for listening     stt.token.start -> stt.token.end (about 0 when stocked)
 *   G  key for speaking      tts.token.start -> tts.token.end (about 0 when stocked)
 *   H  speech websocket      tts.ws.start -> tts.ws.open (about 0 when warmed up)
 *   I  Soniox speech         piece.first -> tts.audio.first (first sentence to first audio)
 *
 * @module lib/hai/voice/client/trace
 */

export type TraceValue = string | number | boolean;
export type TraceData = Record<string, TraceValue>;

export interface TraceEntry {
  name: string;
  /** Milliseconds since the first mark of this page. */
  at: number;
  data: TraceData;
}

export const TRACE_STORAGE_KEY = 'hai-voice-trace';

const MAX_ENTRIES = 400;
const TOKEN = /^[A-Za-z0-9_.:-]{0,48}$/;

/** The derived times: [label, from, to]. */
export const DERIVED_TIMES: ReadonlyArray<readonly [string, string, string]> = [
  ['A', 'stt.interim.first', 'stt.endpoint'],
  ['B', 'submit', 'chat.first.text'],
  ['C', 'chat.first.text', 'piece.first'],
  ['D', 'piece.first', 'play.first'],
  ['E', 'listen.start', 'stt.interim.first'],
  ['F', 'stt.token.start', 'stt.token.end'],
  ['G', 'tts.token.start', 'tts.token.end'],
  ['H', 'tts.ws.start', 'tts.ws.open'],
  ['I', 'piece.first', 'tts.audio.first'],
];

/** A mark that starts a new round: the marks of the later stages are forgotten. */
const RESETS: Record<string, string[]> = {
  'listen.start': ['stt.'],
  submit: ['chat.', 'piece.', 'tts.', 'play.', 'answer.'],
};

let entries: TraceEntry[] = [];
const lastAt = new Map<string, number>();
let origin: number | null = null;
let clock: () => number = () =>
  typeof performance !== 'undefined' ? performance.now() : Date.now();

export function traceEnabled(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      window.localStorage.getItem(TRACE_STORAGE_KEY) === '1'
    );
  } catch {
    return false;
  }
}

/** Keeps only numbers, booleans and short plain tokens. */
export function sanitizeTraceData(data: Record<string, unknown>): TraceData {
  const clean: TraceData = {};
  for (const [key, value] of Object.entries(data)) {
    if (!TOKEN.test(key)) continue;
    if (typeof value === 'number') {
      if (Number.isFinite(value)) clean[key] = Math.round(value * 1000) / 1000;
    } else if (typeof value === 'boolean') {
      clean[key] = value;
    } else if (typeof value === 'string' && TOKEN.test(value)) {
      clean[key] = value;
    }
  }
  return clean;
}

function publish(): void {
  if (typeof window === 'undefined') return;
  const win = window as unknown as Record<string, unknown>;
  if (!win.haiVoiceTrace) {
    win.haiVoiceTrace = () => entries.slice();
  }
}

/**
 * Records a mark (when the switch is on, otherwise nothing happens and nothing
 * is kept). Never throws.
 */
export function mark(name: string, data: Record<string, unknown> = {}): void {
  if (!traceEnabled()) return;
  try {
    publish();
    const now = clock();
    if (origin === null) origin = now;
    for (const prefix of RESETS[name] ?? []) {
      for (const key of [...lastAt.keys()]) {
        if (key.startsWith(prefix)) lastAt.delete(key);
      }
    }
    lastAt.set(name, now);
    const clean = sanitizeTraceData(data);
    const at = Math.round(now - origin);
    entries.push({ name, at, data: clean });
    if (entries.length > MAX_ENTRIES) entries = entries.slice(-MAX_ENTRIES);
    const detail = Object.keys(clean).length > 0 ? clean : '';
    console.info('[hai-voice]', name, `+${at}ms`, detail);
    if (typeof performance !== 'undefined' && performance.mark) {
      performance.mark(`hai-voice:${name}`);
    }
    for (const [label, from, to] of DERIVED_TIMES) {
      if (to !== name) continue;
      const start = lastAt.get(from);
      if (start === undefined) continue;
      const ms = Math.round(now - start);
      entries.push({ name: `time.${label}`, at, data: { ms } });
      console.info(
        '[hai-voice]',
        `time ${label}`,
        `${ms}ms`,
        `(${from} -> ${to})`
      );
    }
  } catch {
    // a measuring point never disturbs the conversation
  }
}

/** Test helpers. */
export function resetTraceForTests(now?: () => number): void {
  entries = [];
  lastAt.clear();
  origin = null;
  clock =
    now ??
    (() =>
      typeof performance !== 'undefined' ? performance.now() : Date.now());
}

export function traceEntries(): TraceEntry[] {
  return entries.slice();
}

/**
 * The timing of the chat route for a spoken question. The header Server-Timing
 * (`auth;dur=12, prep;dur=140`) carries what happens before the stream starts,
 * the `done` event carries all stages (auth, prep, search, first, total in
 * milliseconds). Both only hold numbers. Splits time B into its parts.
 */
export function markServerTiming(header: string | null | undefined): void {
  if (!header || !traceEnabled()) return;
  const data: Record<string, number> = {};
  for (const part of header.split(',')) {
    const [name, ...params] = part.trim().split(';');
    const dur = params.find(p => p.trim().startsWith('dur='));
    const value = dur ? Number(dur.trim().slice(4)) : NaN;
    if (/^[A-Za-z0-9_-]{1,24}$/.test(name) && Number.isFinite(value)) {
      data[name] = value;
    }
  }
  mark('chat.server.header', data);
}

export function markServerDone(timing: unknown): void {
  if (!timing || typeof timing !== 'object' || !traceEnabled()) return;
  // only numbers: whatever else a server sent is not a time
  const numbers: Record<string, number> = {};
  for (const [key, value] of Object.entries(timing)) {
    if (typeof value === 'number' && Number.isFinite(value))
      numbers[key] = value;
  }
  mark('chat.server', numbers);
}
