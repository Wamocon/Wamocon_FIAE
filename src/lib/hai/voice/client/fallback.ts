/**
 * Why a provider of the chain was given up, in a few stable words. The reason
 * comes from the error codes of the providers (see ProviderUnavailableError):
 *
 *   token-<status>[-<reason>]  the key route of this application answered
 *   token-network / token-timeout
 *   tts-error-<code> / stt-error-<code>  Soniox itself reported an error
 *   *-connect-timeout / *-socket-error / *-closed  the websocket
 *
 * The category goes to the measuring points (trace.ts) and to the notice of the
 * voice mode ("I listen through the browser"), so a silent fallback is visible.
 *
 * @module lib/hai/voice/client/fallback
 */

import type { VoiceFunction, VoiceProviderId } from '../settings';

export type FallbackReason =
  | 'key-refused'
  | 'not-configured'
  | 'region'
  | 'organization'
  | 'limit'
  | 'timeout'
  | 'network'
  | 'unavailable';

/** A function (listening or speaking) that now runs on another provider. */
export interface ProviderFallback {
  function: VoiceFunction;
  from: VoiceProviderId;
  /** The provider that takes over, null when nothing is left. */
  to: VoiceProviderId | null;
  reason: FallbackReason;
  /** The raw code (letters, digits, - and _ only), for the measuring points. */
  code: string;
}

/** The raw code in a form that is safe for the measuring points. */
export function reasonCode(reason: string | undefined): string {
  return (reason ?? 'unknown').replace(/[^A-Za-z0-9_.:-]/g, '').slice(0, 48);
}

export function categorizeReason(reason: string | undefined): FallbackReason {
  const code = (reason ?? '').toLowerCase();
  if (/timeout|-408(?!\d)/.test(code)) return 'timeout';
  if (/no_key|not_configured/.test(code)) return 'not-configured';
  if (/region/.test(code)) return 'region';
  if (/-40[23](?!\d)|permission/.test(code)) return 'organization';
  if (/429|concurrent|limit|rate_/.test(code)) return 'limit';
  if (/-40[01](?!\d)|refused/.test(code)) return 'key-refused';
  if (/network|socket-error|closed|tts-error$|stt-error$/.test(code)) {
    return 'network';
  }
  return 'unavailable';
}

/**
 * Errors that will not go away within a second (a refused key, no permission,
 * a missing setup): no retry before the fallback.
 */
export function isPermanentReason(reason: string | undefined): boolean {
  const category = categorizeReason(reason);
  return (
    category === 'key-refused' ||
    category === 'not-configured' ||
    category === 'region' ||
    category === 'organization'
  );
}
