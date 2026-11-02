/**
 * Choice of the speech provider and the chain of fallbacks (server).
 *
 * The platform admin chooses a main provider and a fallback
 * (src/lib/hai/voice/settings.ts). This module turns that choice, the
 * configuration of the server and the recent failures into
 *   - the state of every provider: ready, not set up (with a stable reason) or
 *     disturbed (it failed a moment ago, with the reason), and
 *   - the chain the browser walks: the first provider that is ready, then the
 *     fallback, then the browser. A provider that is not set up or disturbed is
 *     left out, so the browser does not even try it. The browser as the last
 *     step is always part of the chain: it has no server part and the client
 *     decides whether the browser can do speech at all.
 *
 * "Disturbed" is remembered in the memory of ONE server instance for a short
 * time (like src/lib/rate-limit.ts, on serverless hosting per warm instance).
 * That is enough: a failing provider is skipped for a minute, then tried again.
 * No state is stored in the database and nothing secret is held here.
 *
 * @module lib/hai/voice/provider
 */

import { type VoiceProviderId, type VoiceSettings } from './settings';
import { loadSonioxConfig, type Env as SonioxEnv } from './sonioxServer';
import { hausConfigReason, type Env as HausEnv } from './hausServer';

export type ProviderStatus = 'ready' | 'not_configured' | 'disturbed';

export interface ProviderState {
  id: VoiceProviderId;
  status: ProviderStatus;
  /** A stable code (never free text, never a value of a variable). Null when ready. */
  reason: string | null;
}

/** How long a provider that just failed is left out of the chain. */
export const DISTURBED_MS = 60_000;

interface Failure {
  reason: string;
  until: number;
}

const failures = new Map<VoiceProviderId, Failure>();

/** A call to the provider just failed on the server side: skip it for a while. */
export function reportProviderFailure(
  id: VoiceProviderId,
  reason: string,
  now: number = Date.now()
): void {
  failures.set(id, { reason, until: now + DISTURBED_MS });
}

/** A call to the provider just worked: it is not disturbed any more. */
export function reportProviderSuccess(id: VoiceProviderId): void {
  failures.delete(id);
}

/** The reason of the current failure, or null. Expired entries are dropped. */
export function disturbedReason(
  id: VoiceProviderId,
  now: number = Date.now()
): string | null {
  const entry = failures.get(id);
  if (!entry) return null;
  if (entry.until <= now) {
    failures.delete(id);
    return null;
  }
  return entry.reason;
}

/** Test helper: forget all failures. */
export function resetProviderHealth(): void {
  failures.clear();
}

/** The state of the three providers for this environment and moment. */
export function providerStates(
  env: SonioxEnv & HausEnv,
  now: number = Date.now()
): Record<VoiceProviderId, ProviderState> {
  const state = (
    id: VoiceProviderId,
    notConfigured: string | null
  ): ProviderState => {
    if (notConfigured) {
      return { id, status: 'not_configured', reason: notConfigured };
    }
    const disturbed = disturbedReason(id, now);
    if (disturbed) return { id, status: 'disturbed', reason: disturbed };
    return { id, status: 'ready', reason: null };
  };
  const soniox = loadSonioxConfig(env);
  return {
    soniox: state('soniox', soniox.ok ? null : soniox.reason),
    haus: state('haus', hausConfigReason(env)),
    browser: { id: 'browser', status: 'ready', reason: null },
  };
}

export interface VoiceChain {
  /** The provider that is used first: the head of the chain. */
  provider: VoiceProviderId;
  /** The order in which the browser tries the providers. The browser itself is always part of it. */
  chain: VoiceProviderId[];
}

/**
 * The effective provider and the chain of fallbacks: the choice of the admin,
 * minus every provider that is not ready, plus the browser as the last step.
 * The chain is never empty.
 */
export function resolveChain(
  settings: VoiceSettings,
  states: Record<VoiceProviderId, ProviderState>
): VoiceChain {
  const wanted: VoiceProviderId[] = [
    settings.primary,
    settings.fallback,
    'browser',
  ];
  const chain: VoiceProviderId[] = [];
  for (const id of wanted) {
    if (chain.includes(id)) continue;
    if (states[id].status === 'ready') chain.push(id);
  }
  return { provider: chain[0], chain };
}
