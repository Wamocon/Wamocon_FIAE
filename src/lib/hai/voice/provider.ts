/**
 * Choice of the speech provider and the chain of fallbacks (server).
 *
 * The platform admin chooses a main provider and a fallback
 * (src/lib/hai/voice/settings.ts). This module turns that choice, the
 * configuration of the server and the recent failures into
 *   - the state of every provider: ready, not set up (with a stable reason) or
 *     disturbed (it failed a moment ago, with the reason), and
 *   - the chains the browser walks: the first provider that is ready, then the
 *     fallback, then the browser. A provider that is not set up or disturbed is
 *     left out, so the browser does not even try it. The browser as the last
 *     step is always part of a chain: it has no server part and the client
 *     decides whether the browser can do speech at all.
 *
 * "Disturbed" is kept per provider AND per function: listening ('stt') and
 * speaking ('tts') are separate. A failed recognition of Sokrates leaves the
 * listening chain without Sokrates, its speech output stays in the speaking
 * chain (and the other way round). "Not set up" is a property of the whole
 * provider (the configuration of the server), so it holds for both functions.
 *
 * "Disturbed" is remembered in the memory of ONE server instance for a short
 * time (like src/lib/rate-limit.ts, on serverless hosting per warm instance).
 * That is enough: a failing function is skipped for a minute, then tried again.
 * No state is stored in the database and nothing secret is held here.
 *
 * @module lib/hai/voice/provider
 */

import {
  VOICE_FUNCTIONS,
  type VoiceFunction,
  type VoiceProviderId,
  type VoiceSettings,
} from './settings';
import { loadSonioxConfig, type Env as SonioxEnv } from './sonioxServer';
import { hausConfigReason, type Env as HausEnv } from './hausServer';

export type ProviderStatus = 'ready' | 'not_configured' | 'disturbed';

export { VOICE_FUNCTIONS, type VoiceFunction };

/** The state of one function of a provider. */
export interface FunctionState {
  status: ProviderStatus;
  /** A stable code (never free text, never a value of a variable). Null when ready. */
  reason: string | null;
}

export interface ProviderState {
  id: VoiceProviderId;
  /**
   * The summary over both functions: not_configured, else disturbed when at
   * least one function is disturbed (a sign for the admin that something is
   * wrong), else ready. The chains do not use it, they look at `functions`.
   */
  status: ProviderStatus;
  /** A stable code (never free text, never a value of a variable). Null when ready. */
  reason: string | null;
  /** The state per function; the chain of each function is built from it. */
  functions: Record<VoiceFunction, FunctionState>;
}

/** How long a provider that just failed is left out of the chain. */
export const DISTURBED_MS = 60_000;

interface Failure {
  reason: string;
  until: number;
}

const failures = new Map<string, Failure>();

const keyOf = (id: VoiceProviderId, fn: VoiceFunction) => `${id}:${fn}`;

/** A call of one function of the provider just failed on the server side: skip that function for a while. */
export function reportProviderFailure(
  id: VoiceProviderId,
  fn: VoiceFunction,
  reason: string,
  now: number = Date.now()
): void {
  failures.set(keyOf(id, fn), { reason, until: now + DISTURBED_MS });
}

/** A call of the function just worked: it is not disturbed any more. The other function is left alone. */
export function reportProviderSuccess(
  id: VoiceProviderId,
  fn: VoiceFunction
): void {
  failures.delete(keyOf(id, fn));
}

/** The reason of the current failure of this function, or null. Expired entries are dropped. */
export function disturbedReason(
  id: VoiceProviderId,
  fn: VoiceFunction,
  now: number = Date.now()
): string | null {
  const key = keyOf(id, fn);
  const entry = failures.get(key);
  if (!entry) return null;
  if (entry.until <= now) {
    failures.delete(key);
    return null;
  }
  return entry.reason;
}

/** Test helper: forget all failures. */
export function resetProviderHealth(): void {
  failures.clear();
}

/** The summary state of a provider that is set up, from its two functions. */
export function summarize(
  id: VoiceProviderId,
  functions: Record<VoiceFunction, FunctionState>
): ProviderState {
  const disturbed = VOICE_FUNCTIONS.map(fn => functions[fn]).find(
    f => f.status === 'disturbed'
  );
  return disturbed
    ? { id, status: 'disturbed', reason: disturbed.reason, functions }
    : { id, status: 'ready', reason: null, functions };
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
      const off: FunctionState = {
        status: 'not_configured',
        reason: notConfigured,
      };
      return {
        id,
        status: 'not_configured',
        reason: notConfigured,
        functions: { stt: off, tts: off },
      };
    }
    const functionState = (fn: VoiceFunction): FunctionState => {
      const disturbed = disturbedReason(id, fn, now);
      return disturbed
        ? { status: 'disturbed', reason: disturbed }
        : { status: 'ready', reason: null };
    };
    return summarize(id, {
      stt: functionState('stt'),
      tts: functionState('tts'),
    });
  };
  const soniox = loadSonioxConfig(env);
  return {
    soniox: state('soniox', soniox.ok ? null : soniox.reason),
    haus: state('haus', hausConfigReason(env)),
    browser: summarize('browser', {
      stt: { status: 'ready', reason: null },
      tts: { status: 'ready', reason: null },
    }),
  };
}

export interface VoiceChain {
  /** The provider that is used first: the head of `chain`. */
  provider: VoiceProviderId;
  /**
   * Every provider that is ready for at least one function, in the order of the
   * choice. It stays the list that older browsers read (they apply it to both
   * functions and fall over on their own) and the one the consent covers. The
   * browser itself is always part of it.
   */
  chain: VoiceProviderId[];
  /** The order in which the browser tries the providers, per function. The browser is always part of each. */
  chains: Record<VoiceFunction, VoiceProviderId[]>;
}

/**
 * The effective provider and the chains of fallbacks: the choice of the admin,
 * minus every provider that is not ready for the function, plus the browser as
 * the last step. A provider that is disturbed in one function only stays in the
 * chain of the other. No chain is ever empty.
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
  const chainFor = (fn: VoiceFunction): VoiceProviderId[] => {
    const chain: VoiceProviderId[] = [];
    for (const id of wanted) {
      if (chain.includes(id)) continue;
      if (states[id].functions[fn].status === 'ready') chain.push(id);
    }
    return chain;
  };
  const chains = { stt: chainFor('stt'), tts: chainFor('tts') };
  const chain: VoiceProviderId[] = [];
  for (const id of wanted) {
    if (chain.includes(id)) continue;
    if (chains.stt.includes(id) || chains.tts.includes(id)) chain.push(id);
  }
  return { provider: chain[0], chain, chains };
}
