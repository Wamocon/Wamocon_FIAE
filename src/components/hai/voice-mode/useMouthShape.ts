'use client';

/**
 * Drives the mouth of the HAI figure while the HAI speaks.
 *
 * Every animation frame it decides the shape of the mouth and writes it to the
 * element as `data-mouth` (closed, half, open, round); CSS shows the matching
 * mouth. There is NO React state per frame: nothing re-renders, only an
 * attribute changes, and only when the shape changed.
 *
 * Where the shape comes from (`data-mouth-source`):
 *  - "level":  the loudness of the audio that is played (Web Audio providers,
 *              read from the analyser of lib/hai/voice/client/outputLevel.ts)
 *  - "rhythm": the browser's own speech (speechSynthesis) is speaking, which
 *              gives no level: a rhythm pattern of syllable beats
 *  - "none":   nothing is audible (between two sentences, or not speaking):
 *              the mouth is closed
 */

import { useEffect, type RefObject } from 'react';
import { readOutputLevel } from '@/lib/hai/voice/client/outputLevel';
import { MouthDriver, type MouthShape } from './mouth';

/** The level from which the played audio counts as audible. */
const AUDIBLE = 0.02;

export interface MouthSources {
  /** Loudness of the played audio (0 to 1), null if there is no analyser. */
  readLevel: () => number | null;
  /** Is the browser's own speech speaking right now? */
  browserSpeaking: () => boolean;
  /** Random numbers for the rhythm pattern. */
  random: () => number;
  /** Milliseconds, for the rhythm pattern. */
  now: () => number;
  /** Calls `callback` at the next frame, returns a way to cancel. */
  schedule: (callback: () => void) => () => void;
}

function browserSpeaking(): boolean {
  try {
    return (
      typeof window !== 'undefined' &&
      'speechSynthesis' in window &&
      window.speechSynthesis.speaking
    );
  } catch {
    return false;
  }
}

export const defaultMouthSources: MouthSources = {
  readLevel: readOutputLevel,
  browserSpeaking,
  random: Math.random,
  now: () => (typeof performance !== 'undefined' ? performance.now() : 0),
  schedule: callback => {
    if (typeof window === 'undefined' || !window.requestAnimationFrame) {
      const timer = setTimeout(callback, 50);
      return () => clearTimeout(timer);
    }
    const handle = window.requestAnimationFrame(callback);
    return () => window.cancelAnimationFrame(handle);
  },
};

function write(
  element: HTMLElement,
  shape: MouthShape,
  source: 'level' | 'rhythm' | 'none'
) {
  if (element.getAttribute('data-mouth') !== shape) {
    element.setAttribute('data-mouth', shape);
  }
  if (element.getAttribute('data-mouth-source') !== source) {
    element.setAttribute('data-mouth-source', source);
  }
}

/**
 * @param ref     the element that carries `data-mouth`
 * @param active  true while the HAI speaks; otherwise the mouth stays closed
 * @param sources replaceable for tests (a fake analyser, a fake clock)
 */
export function useMouthShape(
  ref: RefObject<HTMLElement | null>,
  active: boolean,
  sources: MouthSources = defaultMouthSources
): void {
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (!active) {
      write(element, 'closed', 'none');
      return;
    }
    const driver = new MouthDriver(sources.random);
    let cancel: () => void = () => undefined;

    const frame = () => {
      const level = sources.readLevel();
      if (level !== null && level >= AUDIBLE) {
        write(element, driver.fromLevel(level), 'level');
      } else if (sources.browserSpeaking()) {
        write(element, driver.fromRhythm(sources.now()), 'rhythm');
      } else {
        // silence between two sentences: a new beat starts from closed lips
        driver.fromLevel(0);
        write(element, 'closed', 'none');
      }
      cancel = sources.schedule(frame);
    };
    frame();
    return () => cancel();
  }, [ref, active, sources]);
}
