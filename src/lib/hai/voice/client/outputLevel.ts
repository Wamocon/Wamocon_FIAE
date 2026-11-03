/**
 * Loudness of the speech output (read only), for the mouth of the HAI figure.
 *
 * The providers that play audio through Web Audio (Soniox, Sokrates) schedule
 * their sources in `OrderedPlayback` (audio.ts). That class additionally
 * connects every source to ONE analyser per audio context (a tap: the sound
 * still goes to the destination exactly as before). The voice mode reads the
 * loudness of that analyser every animation frame. Nothing here changes what is
 * played, when, or by which provider.
 *
 * The browser's own speech (speechSynthesis) has no audio graph and therefore
 * no level: the voice mode then uses a rhythm pattern (see voice-mode/mouth.ts).
 *
 * @module lib/hai/voice/client/outputLevel
 */

import type { AnalyserLike, AudioContextLike } from './audio';

const taps = new WeakMap<object, AnalyserLike>();
let latest: AnalyserLike | null = null;
let samples: Float32Array | null = null;

/**
 * The analyser that listens to the output of this audio context (created once
 * per context), or null when the context cannot make one (old browsers, test
 * doubles). Connect a source to it IN ADDITION to the destination.
 */
export function getOutputTap(ctx: AudioContextLike): AnalyserLike | null {
  if (!ctx.createAnalyser) return null;
  let tap = taps.get(ctx) ?? null;
  if (!tap) {
    try {
      tap = ctx.createAnalyser();
      tap.fftSize = 512;
    } catch {
      return null;
    }
    taps.set(ctx, tap);
  }
  latest = tap;
  return tap;
}

/**
 * Loudness of what is played right now, 0 (silence) to 1, or null while no
 * playback ever made a tap (the browser's speech, or nothing spoken yet).
 * Normal speech has a root mean square of about 0.05 to 0.3, so it is scaled up.
 */
export function readOutputLevel(): number | null {
  if (!latest) return null;
  if (!samples || samples.length !== latest.fftSize) {
    samples = new Float32Array(latest.fftSize);
  }
  try {
    latest.getFloatTimeDomainData(samples);
  } catch {
    return null;
  }
  let sum = 0;
  for (let i = 0; i < samples.length; i++) sum += samples[i] * samples[i];
  const rms = Math.sqrt(sum / samples.length);
  return Math.min(1, rms * 3.5);
}

/** For tests: forget the tap. */
export function resetOutputLevel(): void {
  latest = null;
  samples = null;
}
