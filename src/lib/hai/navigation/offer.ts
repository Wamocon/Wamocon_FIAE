/**
 * The navigation offer of the HAI: what the chat answer carries so that the
 * interface can show a card with the button "Öffnen".
 *
 * The server builds it (never the model), the client shows it and checks it
 * once more before it opens the page. The offer is a display only, it carries
 * no authority: the page itself checks the rights again on every call, like for
 * a link typed into the address bar. An offer never writes anything.
 *
 * Pure module without server imports, shared by the server and the client.
 *
 * @module lib/hai/navigation/offer
 */

import { isAllowedNavigationPath } from './targets';

export interface NavigationOffer {
  /** Internal path from the allow list (targets.ts), never a free path. */
  path: string;
  /** Name of the page, the label of the card (German). */
  label: string;
  /** One short reason, why this page (German). */
  reason: string;
  /**
   * The person gave a clear command ("Öffne ...", "Bring mich zu ...", "Geh
   * zu ..."): the interface opens the page right away, the card only reports
   * it. Without it the card waits for the tap on "Öffnen" (or a spoken "ja").
   * Set by the server from the command, never by the model.
   */
  auto?: boolean;
}

const MAX_TEXT = 200;

function cleanText(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const text = value.replace(/[\u0000-\u001f]/g, ' ').trim();
  return text ? text.slice(0, MAX_TEXT) : null;
}

/**
 * An offer from untrusted input (the answer of the server as the client reads
 * it), or undefined if it is malformed or its path is not on the allow list.
 * Only the four known members are taken over.
 */
export function toNavigationOffer(raw: unknown): NavigationOffer | undefined {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    return undefined;
  }
  const { path, label, reason, auto } = raw as Record<string, unknown>;
  if (!isAllowedNavigationPath(path)) return undefined;
  const cleanLabel = cleanText(label);
  const cleanReason = cleanText(reason);
  if (!cleanLabel || !cleanReason) return undefined;
  return {
    path,
    label: cleanLabel,
    reason: cleanReason,
    ...(auto === true ? { auto: true } : {}),
  };
}
