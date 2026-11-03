'use client';

/**
 * The pond of the voice mode is the round HAI symbol (HaiButton) itself, grown.
 * It stays grown while the mode is open and until the figure has dived in again.
 * The button and the figure overlay both read the same state from the same
 * input (the view of the voice session), so they never disagree.
 */

import { useEffect, useRef, useState } from 'react';
import type { VoiceModeView } from './voiceSessionContext';
import { DIVE_MS } from './HaiCharacter';
import { usePrefersReducedMotion } from './usePrefersReducedMotion';

export interface PondState {
  /** The mode is open (the figure rises and stands). */
  open: boolean;
  /** The mode just ended and the figure is diving in. */
  diving: boolean;
  /** The symbol is a pond: open or still diving. */
  pond: boolean;
}

export function usePondState(view: VoiceModeView): PondState {
  const reduced = usePrefersReducedMotion();
  const open = view !== 'closed';
  const [diving, setDiving] = useState(false);
  const wasOpen = useRef(false);

  useEffect(() => {
    if (open) {
      wasOpen.current = true;
      setDiving(false);
      return;
    }
    if (!wasOpen.current) return;
    wasOpen.current = false;
    if (reduced) return;
    setDiving(true);
    const timer = setTimeout(() => setDiving(false), DIVE_MS + 150);
    return () => clearTimeout(timer);
  }, [open, reduced]);

  return { open, diving, pond: open || diving };
}
