'use client';

/**
 * The space bar of push to talk: held down it records, released it sends. Works
 * on the whole page while the voice mode is open and push to talk is on.
 *
 * What does NOT record, so typing and the usual use of the page stay safe:
 *  - the focus is in a text field (input, textarea, select, contenteditable),
 *  - the focus is on something that the space bar uses itself (button, link,
 *    checkbox, switch, ...), except the hold button of push to talk (it marks
 *    itself with `data-ptt-button`),
 *  - a modifier key is held (Ctrl, Alt, Meta),
 *  - the key repeats (only the first press counts).
 * A release is also made when the window loses the focus or the page is hidden,
 * so the microphone never stays open behind the person's back.
 */

import { useEffect, useRef } from 'react';

const OWN_USE =
  'input, textarea, select, button, a[href], summary, [contenteditable]:not([contenteditable="false"]), [role="button"], [role="switch"], [role="checkbox"], [role="textbox"], [role="combobox"], [role="menuitem"], [role="tab"]';

/** May the space bar start a recording while this element has the focus? */
export function spaceMayRecord(target: EventTarget | null): boolean {
  const element = target as Element | null;
  if (!element || typeof element.closest !== 'function') return true;
  if (element.closest('[data-ptt-button]')) return true;
  return element.closest(OWN_USE) === null;
}

interface Options {
  enabled: boolean;
  onDown: () => void;
  onUp: () => void;
}

export function usePushToTalkKeys({ enabled, onDown, onUp }: Options): void {
  const down = useRef(onDown);
  const up = useRef(onUp);
  down.current = onDown;
  up.current = onUp;

  useEffect(() => {
    if (!enabled) return;
    let pressed = false;
    const release = () => {
      if (!pressed) return;
      pressed = false;
      up.current();
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      if (event.repeat) {
        // the space bar of a recording must not scroll the page either
        if (pressed) event.preventDefault();
        return;
      }
      if (event.ctrlKey || event.altKey || event.metaKey) return;
      if (event.defaultPrevented) return;
      if (!spaceMayRecord(event.target)) return;
      event.preventDefault();
      if (pressed) return;
      pressed = true;
      down.current();
    };
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.code !== 'Space' && event.key !== ' ') return;
      if (!pressed) return;
      event.preventDefault();
      release();
    };
    const onHidden = () => {
      if (document.visibilityState === 'hidden') release();
    };
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('keyup', onKeyUp);
    window.addEventListener('blur', release);
    document.addEventListener('visibilitychange', onHidden);
    return () => {
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('keyup', onKeyUp);
      window.removeEventListener('blur', release);
      document.removeEventListener('visibilitychange', onHidden);
      release();
    };
  }, [enabled]);
}
