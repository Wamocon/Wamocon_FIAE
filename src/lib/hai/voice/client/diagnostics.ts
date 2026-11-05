/**
 * The diagnosis of the voice mode: what the level gate decided about the last
 * utterances, kept ALWAYS (unlike the measuring points of trace.ts, which are off
 * by default). It answers "why did the assistant not hear me?" from the device of
 * the person, without a console and without a test run.
 *
 * What is kept: the last 50 entries (a ring buffer), in memory and in the
 * sessionStorage of the tab (gone with the tab). Only numbers and short tokens:
 * the level of the utterance (mean, peak), the threshold, the room level, the
 * reference of the person, the confidence of the recognition, the reason and the
 * setting. NEVER the text of an utterance, a transcript, a key or an address.
 * Nothing is sent to a server: the person copies the diagnosis by a button and
 * hands it to the test team (Jira ticket).
 *
 * @module lib/hai/voice/client/diagnostics
 */

import type { GateSnapshot, Sensitivity } from '../levelGate';

export const DIAG_STORAGE_KEY = 'hai-voice-diag';
export const DIAG_MAX_ENTRIES = 50;

/** An entry: what was decided, about which numbers. */
export interface DiagEntry {
  /** Clock time of the decision (ms since 1970). */
  t: number;
  /** discarded, hint (counted, but with a hint), calibration, choice (way out offered) */
  kind: string;
  /** The reason as a short token: quiet, background, confidence, clipped, loud ... */
  why: string;
  mean: number;
  peak: number;
  threshold: number;
  ambient: number;
  reference: number | null;
  confidence: number | null;
  setting: Sensitivity;
}

const TOKEN = /^[A-Za-z0-9_.:-]{0,48}$/;
const SETTINGS: readonly string[] = ['off', 'normal', 'strict'];

let entries: DiagEntry[] = [];
let loaded = false;
let micInfo: Record<string, number | boolean | string> = {};
let micDevice = '';
let clock: () => number = () => Date.now();

function storage(): Storage | null {
  try {
    return typeof window !== 'undefined' ? window.sessionStorage : null;
  } catch {
    return null;
  }
}

const round = (value: number) => Math.round(value * 10_000) / 10_000;
const finite = (value: unknown): value is number =>
  typeof value === 'number' && Number.isFinite(value);

/** Keeps only what an entry may hold: numbers, null and short plain tokens. */
export function sanitizeEntry(raw: Partial<DiagEntry>): DiagEntry | null {
  if (!finite(raw.t)) return null;
  const token = (value: unknown, fallback: string) =>
    typeof value === 'string' && TOKEN.test(value) ? value : fallback;
  const number = (value: unknown) => (finite(value) ? round(value) : 0);
  const optional = (value: unknown) => (finite(value) ? round(value) : null);
  return {
    t: Math.round(raw.t),
    kind: token(raw.kind, 'unknown'),
    why: token(raw.why, 'unknown'),
    mean: number(raw.mean),
    peak: number(raw.peak),
    threshold: number(raw.threshold),
    ambient: number(raw.ambient),
    reference: optional(raw.reference),
    confidence: optional(raw.confidence),
    setting: SETTINGS.includes(String(raw.setting))
      ? (raw.setting as Sensitivity)
      : 'normal',
  };
}

function load(): void {
  if (loaded) return;
  loaded = true;
  try {
    const text = storage()?.getItem(DIAG_STORAGE_KEY);
    if (!text) return;
    const parsed: unknown = JSON.parse(text);
    if (!Array.isArray(parsed)) return;
    for (const item of parsed) {
      const clean = sanitizeEntry(item as Partial<DiagEntry>);
      if (clean) entries.push(clean);
    }
    entries = entries.slice(-DIAG_MAX_ENTRIES);
  } catch {
    entries = [];
  }
}

function save(): void {
  try {
    storage()?.setItem(DIAG_STORAGE_KEY, JSON.stringify(entries));
  } catch {
    // private window or full storage: the buffer in memory stays
  }
}

/** Notes an entry (never throws). The ring buffer drops the oldest beyond 50. */
export function recordDiagnosis(raw: Omit<DiagEntry, 't'>): void {
  try {
    load();
    const clean = sanitizeEntry({ ...raw, t: clock() });
    if (!clean) return;
    entries.push(clean);
    if (entries.length > DIAG_MAX_ENTRIES) {
      entries = entries.slice(-DIAG_MAX_ENTRIES);
    }
    save();
  } catch {
    // the diagnosis never disturbs the conversation
  }
}

/** The kept entries, oldest first. */
export function diagnosisEntries(): DiagEntry[] {
  load();
  return entries.slice();
}

/**
 * What the browser really delivers for the microphone (the settings of the track:
 * sample rate, gain control, echo cancellation, state of the audio context) and the
 * name of the device if the browser tells it. Numbers, booleans and short tokens.
 */
export function noteMicrophone(
  info: Record<string, unknown>,
  device?: string | null
): void {
  const clean: Record<string, number | boolean | string> = {};
  for (const [key, value] of Object.entries(info)) {
    if (!TOKEN.test(key)) continue;
    if (finite(value)) clean[key] = round(value);
    else if (typeof value === 'boolean') clean[key] = value;
    else if (typeof value === 'string' && TOKEN.test(value)) clean[key] = value;
  }
  micInfo = clean;
  // a device name has spaces and brackets, so it is only shortened
  micDevice =
    typeof device === 'string' ? device.replace(/\s+/g, ' ').slice(0, 80) : '';
}

export interface DiagnosisContext {
  gate: GateSnapshot;
  pushToTalk: boolean;
  signalWords: boolean;
  calibration: string;
  calibrationReason: string | null;
  provider: string;
  live: boolean;
}

/** The whole diagnosis as an object (what "Diagnose kopieren" puts on the clipboard). */
export function buildDiagnosis(context: DiagnosisContext) {
  load();
  const round4 = (value: number | null) =>
    value === null ? null : round(value);
  const nav = typeof navigator !== 'undefined' ? navigator : null;
  return {
    type: 'hai-voice-diagnosis',
    version: 1,
    createdAt: new Date(clock()).toISOString(),
    browser: nav?.userAgent?.slice(0, 200) ?? 'unknown',
    language: nav?.language ?? 'unknown',
    setting: context.gate.sensitivity,
    pushToTalk: context.pushToTalk,
    signalWords: context.signalWords,
    provider: context.provider,
    liveMicrophone: context.live,
    calibration: {
      state: context.calibration,
      reason: context.calibrationReason,
    },
    microphone: {
      profile:
        typeof micInfo.profile === 'string' ? micInfo.profile : 'unknown',
      delivered: micInfo,
      device: micDevice || null,
    },
    gate: {
      samples: context.gate.samples,
      maxLevel: round(context.gate.maxLevel),
      ambient: round(context.gate.ambient),
      reference: round4(context.gate.reference),
      threshold: round(context.gate.threshold),
      calibrated: context.gate.calibrated,
    },
    entries: entries.slice(),
  };
}

/** Test helpers. */
export function resetDiagnosticsForTests(now?: () => number): void {
  entries = [];
  loaded = false;
  micInfo = {};
  micDevice = '';
  clock = now ?? (() => Date.now());
  try {
    storage()?.removeItem(DIAG_STORAGE_KEY);
  } catch {
    // nothing stored
  }
}

/**
 * Puts a text on the clipboard. The clipboard API where the browser allows it, else a
 * hidden text field and the old copy command. True when it worked, never throws.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // refused (no permission, no secure context): the old way follows
  }
  try {
    if (typeof document === 'undefined') return false;
    const field = document.createElement('textarea');
    field.value = text;
    field.setAttribute('readonly', '');
    field.style.position = 'fixed';
    field.style.opacity = '0';
    document.body.appendChild(field);
    field.select();
    const done =
      typeof document.execCommand === 'function' &&
      document.execCommand('copy');
    document.body.removeChild(field);
    return done === true;
  } catch {
    return false;
  }
}
