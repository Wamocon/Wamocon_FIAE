'use client';

/**
 * Does the organization of the person allow the voice assistant (GET
 * /api/hai/voice)? The same check the microphone of the chat always made, now
 * read once by the voice session. The question is asked only when `wanted` is
 * true (the chat was opened), so a page without HAI use makes no call.
 */

import { useEffect, useState } from 'react';
import { authFetch } from '@/lib/authFetch';

export function useVoiceEnabled(wanted: boolean): boolean {
  const [enabled, setEnabled] = useState(false);

  useEffect(() => {
    if (!wanted) return;
    let cancelled = false;
    authFetch('/api/hai/voice')
      .then(res => (res.ok ? res.json() : null))
      .then(data => {
        if (!cancelled) setEnabled(data?.enabled === true);
      })
      .catch(() => {
        if (!cancelled) setEnabled(false);
      });
    return () => {
      cancelled = true;
    };
  }, [wanted]);

  return enabled;
}
