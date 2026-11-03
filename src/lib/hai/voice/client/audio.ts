/**
 * Audio helpers of the browser side: ordered playback of audio pieces and a
 * simple detector for the end of speech. Pure logic against small interfaces
 * (AudioContextLike), so tests run without an audio device.
 *
 * @module lib/hai/voice/client/audio
 */

import { getOutputTap } from './outputLevel';
import { mark } from './trace';

// ============================================================================
// THE PARTS OF THE WEB AUDIO API THAT ARE USED
// ============================================================================

export interface AudioBufferLike {
  readonly duration: number;
  copyToChannel(source: Float32Array, channelNumber: number): void;
}

export interface AudioSourceLike {
  buffer: AudioBufferLike | null;
  onended: (() => void) | null;
  connect(destination: unknown): void;
  start(when?: number): void;
  stop(): void;
}

export interface AnalyserLike {
  fftSize: number;
  getFloatTimeDomainData(array: Float32Array): void;
  disconnect?(): void;
}

export interface AudioContextLike {
  readonly currentTime: number;
  readonly destination: unknown;
  readonly state?: string;
  resume(): Promise<void>;
  createBuffer(
    channels: number,
    length: number,
    sampleRate: number
  ): AudioBufferLike;
  createBufferSource(): AudioSourceLike;
  decodeAudioData(data: ArrayBuffer): Promise<AudioBufferLike>;
  createMediaStreamSource?(stream: unknown): {
    connect(node: unknown): void;
    disconnect?(): void;
  };
  createAnalyser?(): AnalyserLike;
}

// ============================================================================
// PCM
// ============================================================================

/** Bytes of a base64 string. */
export function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

/**
 * Signed 16 bit little endian samples to floats between -1 and 1. An odd last
 * byte (a sample cut in two by the chunk border) is returned as `rest` and
 * belongs in front of the next chunk.
 */
export function pcm16ToFloat32(
  bytes: Uint8Array,
  carry?: Uint8Array | null
): { samples: Float32Array; rest: Uint8Array | null } {
  let data = bytes;
  if (carry && carry.length > 0) {
    data = new Uint8Array(carry.length + bytes.length);
    data.set(carry, 0);
    data.set(bytes, carry.length);
  }
  const count = Math.floor(data.length / 2);
  const samples = new Float32Array(count);
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let i = 0; i < count; i++) {
    samples[i] = view.getInt16(i * 2, true) / 32768;
  }
  const rest = data.length % 2 === 1 ? data.slice(data.length - 1) : null;
  return { samples, rest };
}

// ============================================================================
// ORDERED PLAYBACK
// ============================================================================

/**
 * Lead for the playback (against stutter when the provider delivers in chunks).
 * It starts at `base` (default 0: the first sound is not delayed) and grows only
 * after the measurement showed an audible gap: the audio ran out before the next
 * chunk arrived. Then the next start waits `grow` (100 ms), after the next gap
 * twice that, up to `max` (250 ms), like damicon (0.25 s, doubled after a gap).
 * The learned lead holds for the whole page. `base` can be set in localStorage
 * ('hai-voice-lead', milliseconds, 0 to 250), 'off' keeps it at 0 for good.
 */
export const LEAD_GROW_S = 0.1;
export const LEAD_MAX_S = 0.25;
export const LEAD_STORAGE_KEY = 'hai-voice-lead';
/** Smaller gaps than this are rounding errors of the audio clock, not stutter. */
const GAP_EPSILON_S = 0.02;

let learnedLead = 0;

/** For tests: forget the learned lead. */
export function resetLeadForTests(): void {
  learnedLead = 0;
}

export function currentLeadSeconds(): number {
  let base = 0;
  let off = false;
  try {
    const raw = window.localStorage.getItem(LEAD_STORAGE_KEY);
    if (raw === 'off') off = true;
    else if (raw !== null && Number.isFinite(Number(raw))) {
      base = Math.min(LEAD_MAX_S, Math.max(0, Number(raw) / 1000));
    }
  } catch {
    // no storage: the default
  }
  return off ? 0 : Math.max(base, learnedLead);
}

/**
 * One piece of speech in the playback. Chunks of audio are pushed as they
 * arrive, `finish()` says there are no more, `fail()` that the provider could
 * not deliver it. `done` resolves when the last chunk has been played and
 * rejects when the piece failed (once its turn has come).
 */
export interface PlaybackSlot {
  push(buffer: AudioBufferLike): void;
  finish(): void;
  fail(error: Error): void;
  readonly done: Promise<void>;
}

interface SlotState {
  queue: AudioBufferLike[];
  playing: number;
  finished: boolean;
  error: Error | null;
  resolve: () => void;
  reject: (error: Error) => void;
}

/**
 * Plays the pieces one after the other, in the order they were opened, however
 * late their audio arrives. Several pieces may be generated at the same time,
 * only the first one in line is played. A piece that failed reports its failure
 * when it is the first in line: what plays before it is not cut off.
 */
export class OrderedPlayback {
  private slots: SlotState[] = [];
  private sources = new Set<AudioSourceLike>();
  private nextStart = 0;
  private cancelled = false;
  private firstScheduled = false;
  private started = false;

  constructor(private readonly ctx: AudioContextLike) {}

  open(): PlaybackSlot {
    let resolve!: () => void;
    let reject!: (error: Error) => void;
    const done = new Promise<void>((res, rej) => {
      resolve = res;
      reject = rej;
    });
    const slot: SlotState = {
      queue: [],
      playing: 0,
      finished: false,
      error: null,
      resolve,
      reject,
    };
    this.slots.push(slot);
    return {
      done,
      push: buffer => {
        if (this.cancelled || slot.finished || slot.error) return;
        slot.queue.push(buffer);
        this.pump();
      },
      finish: () => {
        if (slot.finished) return;
        slot.finished = true;
        this.pump();
      },
      fail: error => {
        if (slot.finished || slot.error) return;
        slot.error = error;
        this.pump();
      },
    };
  }

  /** Stops what plays and forgets what is waiting. No promise settles after this. */
  cancel(): void {
    this.cancelled = true;
    this.slots = [];
    for (const source of this.sources) {
      source.onended = null;
      try {
        source.stop();
      } catch {
        // not started or already stopped
      }
    }
    this.sources.clear();
  }

  private pump(): void {
    if (this.cancelled) return;
    // the pieces that are over report, in order
    for (;;) {
      const head = this.slots[0];
      if (!head) break;
      if (head.error) {
        this.slots.shift();
        head.reject(head.error);
        continue;
      }
      if (head.finished && head.queue.length === 0 && head.playing === 0) {
        this.slots.shift();
        head.resolve();
        continue;
      }
      break;
    }
    // Schedule what is ready, in order. A piece whose audio is complete lets the
    // next one be scheduled while it still plays (no gap between two sentences).
    // A piece that is still receiving, or that failed, holds the later ones back.
    for (const slot of this.slots) {
      if (slot.error) break;
      while (slot.queue.length > 0) this.schedule(slot, slot.queue.shift()!);
      if (!slot.finished) break;
    }
  }

  private schedule(slot: SlotState, buffer: AudioBufferLike): void {
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    source.connect(this.ctx.destination);
    // read only tap for the mouth of the HAI figure (outputLevel.ts), the sound is unchanged
    const tap = getOutputTap(this.ctx);
    if (tap) source.connect(tap);
    const now = this.ctx.currentTime;
    // late: sound played before, and it ran out before this chunk arrived (an audible gap)
    const late = this.started && now > this.nextStart + GAP_EPSILON_S;
    if (late) {
      learnedLead = Math.min(
        LEAD_MAX_S,
        learnedLead === 0 ? LEAD_GROW_S : learnedLead * 2
      );
      mark('play.gap', {
        ms: Math.round((now - this.nextStart) * 1000),
        lead: learnedLead,
      });
    }
    let start = Math.max(now, this.nextStart);
    // the lead holds the start back when sound starts (or starts again after a gap)
    if (!this.started || late)
      start = Math.max(start, now + currentLeadSeconds());
    this.started = true;
    if (!this.firstScheduled) {
      this.firstScheduled = true;
      // the state of the context tells at once if the sound cannot play (suspended)
      mark('play.first', { ctx: this.ctx.state ?? 'unknown' });
    }
    this.nextStart = start + buffer.duration;
    slot.playing += 1;
    this.sources.add(source);
    source.onended = () => {
      this.sources.delete(source);
      slot.playing -= 1;
      this.pump();
    };
    source.start(start);
  }
}

/** Runs at most `limit` tasks at the same time, the rest waits in line. */
export class Limiter {
  private active = 0;
  private waiting: Array<() => void> = [];

  constructor(private readonly limit: number) {}

  async run<T>(task: () => Promise<T>): Promise<T> {
    if (this.active >= this.limit) {
      await new Promise<void>(resolve => this.waiting.push(resolve));
    }
    this.active += 1;
    try {
      return await task();
    } finally {
      this.active -= 1;
      this.waiting.shift()?.();
    }
  }
}

// ============================================================================
// END OF SPEECH
// ============================================================================

export interface VoiceActivityOptions {
  /** Loudness (RMS, 0 to 1) from which a sound counts as speech. */
  threshold: number;
  /** Silence after speech that ends the utterance. */
  silenceMs: number;
  /** Speech shorter than this does not count (a click, a cough). */
  minSpeechMs: number;
  /** Nobody speaks within this time: give up on this round. */
  noSpeechMs: number;
  /** The longest utterance. */
  maxMs: number;
}

export const DEFAULT_VOICE_ACTIVITY: VoiceActivityOptions = {
  threshold: 0.015,
  silenceMs: 1_200,
  minSpeechMs: 300,
  noSpeechMs: 8_000,
  maxMs: 30_000,
};

export type VoiceActivityVerdict = 'wait' | 'speech-ended' | 'no-speech';

/**
 * A simple detector for the end of an utterance from the loudness of the
 * microphone. It serves the recognition on Sokrates, which transcribes a whole
 * utterance after it ended (Soniox detects the end by itself). Feed it the
 * loudness every few tens of milliseconds.
 */
export class VoiceActivity {
  private startedAt: number | null = null;
  private lastFeed = 0;
  private lastSpeechAt = 0;
  private speechMs = 0;

  constructor(
    private readonly options: VoiceActivityOptions = DEFAULT_VOICE_ACTIVITY
  ) {}

  /** True once enough speech was heard. */
  get heardSpeech(): boolean {
    return this.speechMs >= this.options.minSpeechMs;
  }

  feed(rms: number, nowMs: number): VoiceActivityVerdict {
    const o = this.options;
    if (this.startedAt === null) {
      this.startedAt = nowMs;
      this.lastFeed = nowMs;
    }
    if (rms >= o.threshold) {
      this.speechMs += nowMs - this.lastFeed;
      this.lastSpeechAt = nowMs;
    }
    this.lastFeed = nowMs;
    const elapsed = nowMs - this.startedAt;
    if (this.heardSpeech) {
      if (nowMs - this.lastSpeechAt >= o.silenceMs) return 'speech-ended';
      if (elapsed >= o.maxMs) return 'speech-ended';
      return 'wait';
    }
    if (elapsed >= o.noSpeechMs) return 'no-speech';
    return 'wait';
  }
}

/** Loudness (RMS) of a block of samples. */
export function rmsOf(samples: Float32Array): number {
  if (samples.length === 0) return 0;
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  return Math.sqrt(sum / samples.length);
}
