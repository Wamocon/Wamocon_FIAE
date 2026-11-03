/**
 * A small stock of short lived Soniox keys, one slot per purpose (listening and
 * speaking). The key is fetched from this application while the person still
 * speaks or the model still thinks, so the websocket can open without the way
 * over the server (login, organization switch, rate limit, call to Soniox).
 *
 * A key is handed out at most ONCE: it is not known whether Soniox accepts a key
 * for a second connection (the keys are not created as `single_use`, but the
 * documentation names no default), and a refused second connection would be a
 * silent fallback to the browser. One key per connection is always safe.
 *
 * @module lib/hai/voice/client/tokenStore
 */

import type { TokenGrant } from './soniox';

/** `stt-live`: the key of a recognition that stays open over the whole conversation (longer session). */
export type TokenPurpose = 'stt' | 'stt-live' | 'tts';

/** A stocked key is not used in its last seconds: the connection needs a moment. */
export const TOKEN_MARGIN_MS = 15_000;

interface Slot {
  promise: Promise<TokenGrant>;
  /** The time from which the key must not be used any more (set when it arrived). */
  validUntil: number;
}

export interface TokenStore {
  /** Fetches a key in advance. Never throws, does nothing when one is stocked. */
  prefetch(purpose: TokenPurpose): void;
  /** The stocked key if there is a valid one, else a fresh one from the server. */
  take(purpose: TokenPurpose): Promise<TokenGrant>;
  /** Forgets the stock (a connection was refused: the next key must be fresh). */
  clear(): void;
}

export function createTokenStore(
  fetchFresh: (purpose: TokenPurpose) => Promise<TokenGrant>,
  now: () => number = () => Date.now()
): TokenStore {
  const slots = new Map<TokenPurpose, Slot>();

  const stock = (purpose: TokenPurpose): Slot => {
    const slot: Slot = {
      promise: fetchFresh(purpose),
      validUntil: Number.POSITIVE_INFINITY,
    };
    slots.set(purpose, slot);
    slot.promise.then(
      grant => {
        const seconds =
          grant.expiresInSeconds > 0 ? grant.expiresInSeconds : 60;
        slot.validUntil = now() + seconds * 1000 - TOKEN_MARGIN_MS;
      },
      () => {
        // a failed advance fetch is forgotten, the real call asks again
        if (slots.get(purpose) === slot) slots.delete(purpose);
      }
    );
    return slot;
  };

  return {
    prefetch(purpose) {
      const slot = slots.get(purpose);
      if (slot && now() < slot.validUntil) return;
      stock(purpose);
    },
    async take(purpose) {
      const slot = slots.get(purpose);
      slots.delete(purpose);
      if (slot) {
        try {
          const grant = await slot.promise;
          if (now() < slot.validUntil) return grant;
        } catch {
          // fall through: ask again, the error of THIS call is the one that counts
        }
      }
      return fetchFresh(purpose);
    },
    clear() {
      slots.clear();
    },
  };
}
