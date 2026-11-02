'use client';

/**
 * Does the person ask the system for less motion (prefers-reduced-motion)?
 * The mascot then shows its state as text and a still picture only.
 */

import { useEffect, useState } from 'react';

const QUERY = '(prefers-reduced-motion: reduce)';

export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    if (
      typeof window === 'undefined' ||
      typeof window.matchMedia !== 'function'
    )
      return;
    const media = window.matchMedia(QUERY);
    setReduced(media.matches);
    const onChange = (event: { matches: boolean }) => setReduced(event.matches);
    media.addEventListener?.('change', onChange);
    return () => media.removeEventListener?.('change', onChange);
  }, []);

  return reduced;
}
