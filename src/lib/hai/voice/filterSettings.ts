/**
 * The settings of the protection against background voices, kept in the browser
 * (localStorage, one choice per device: the room and the microphone belong to
 * the device, not to the account). Pure functions over a storage object, so
 * tests need no browser.
 *
 *  - sensitivity   'normal' (default) or 'strict' (only my voice, loud and near)
 *  - push to talk  off (default) or on: the microphone records only while a
 *                  button or the space bar is held
 *  - signal words  on (default) or off: "Stopp", "Gespräch beenden" and so on
 *
 * @module lib/hai/voice/filterSettings
 */

import type { Sensitivity } from './levelGate';

export interface FilterStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export const SENSITIVITY_KEY = 'hai-voice-sensitivity';
export const PUSH_TO_TALK_KEY = 'hai-voice-ptt';
export const SIGNAL_WORDS_KEY = 'hai-voice-signals';
/** Set after the first hint "Sag Stopp, wenn ich aufhören soll." was shown. */
export const SIGNAL_HINT_KEY = 'hai-voice-signal-hint-seen';

export interface FilterSettings {
  sensitivity: Sensitivity;
  pushToTalk: boolean;
  signalWords: boolean;
}

export const DEFAULT_FILTER_SETTINGS: Readonly<FilterSettings> = Object.freeze({
  sensitivity: 'normal',
  pushToTalk: false,
  signalWords: true,
});

function read(storage: FilterStorage | null, key: string): string | null {
  try {
    return storage?.getItem(key) ?? null;
  } catch {
    return null;
  }
}

/** Reads the three settings. Anything unknown or unreadable is the default. */
export function readFilterSettings(
  storage: FilterStorage | null
): FilterSettings {
  return {
    sensitivity:
      read(storage, SENSITIVITY_KEY) === 'strict' ? 'strict' : 'normal',
    pushToTalk: read(storage, PUSH_TO_TALK_KEY) === 'on',
    signalWords: read(storage, SIGNAL_WORDS_KEY) !== 'off',
  };
}

/** Writes one value. A storage that refuses (private window) leaves the choice for this visit only. */
export function writeFilterSetting(
  storage: FilterStorage | null,
  key: string,
  value: string
): void {
  try {
    storage?.setItem(key, value);
  } catch {
    // the choice holds for this visit only
  }
}

export function signalHintSeen(storage: FilterStorage | null): boolean {
  return read(storage, SIGNAL_HINT_KEY) === 'yes';
}
