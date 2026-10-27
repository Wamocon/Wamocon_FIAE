'use client';

import { useCallback, useEffect, useRef, useState } from 'react';

/**
 * The text of a live region (aria-live="polite") that is not set more often than
 * every `intervalMs`: a progress of hundreds of files must not be read out at every
 * step. The latest message of a busy interval is set when the interval is over. A
 * message that is `immediate` (an error) is set at once.
 */
export function useThrottledAnnouncement(intervalMs = 5000) {
  const [text, setText] = useState('');
  const last = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const pending = useRef<string | null>(null);

  const announce = useCallback(
    (message: string, immediate = false) => {
      const wait = last.current + intervalMs - Date.now();
      if (immediate || wait <= 0) {
        if (timer.current) clearTimeout(timer.current);
        timer.current = undefined;
        pending.current = null;
        last.current = Date.now();
        setText(message);
        return;
      }
      pending.current = message;
      if (!timer.current) {
        timer.current = setTimeout(() => {
          timer.current = undefined;
          if (pending.current !== null) {
            last.current = Date.now();
            setText(pending.current);
            pending.current = null;
          }
        }, wait);
      }
    },
    [intervalMs]
  );

  useEffect(
    () => () => {
      if (timer.current) clearTimeout(timer.current);
    },
    []
  );

  return [text, announce] as const;
}
