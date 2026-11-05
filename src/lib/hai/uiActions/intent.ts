/**
 * What the message of the PERSON asks for: an input (fill, search, filter,
 * focus, scroll) or a page. Pure, a fixed word list on the folded text (lower
 * case, ae oe ue ss, no punctuation), no model.
 *
 * It is the second line against prompt injection: the tools section only gets
 * into the prompt, and a block of the model is only accepted, when the message
 * of the person itself asks for it. A page text or a document that says "fill
 * field X with ..." reaches the model as data and triggers nothing, because the
 * person did not ask.
 *
 * @module lib/hai/uiActions/intent
 */

import { foldText } from '../navigation/fold';

export interface UiIntent {
  /** The person asks to enter, search, filter, focus or scroll. */
  fill: boolean;
  /** The person asks to go to a page or where something is. */
  open: boolean;
}

/** An input, a search, a filter, the focus or the scroll position. */
const FILL_PATTERNS: readonly RegExp[] = [
  /\beintrag\w*/,
  /\btrag\w*\b.*\bein\b/,
  /\bfuell\w*/,
  /\bausfuell\w*/,
  /\bbefuell\w*/,
  /\bvorausfuell\w*/,
  /\bschreib\w*\b.*\b(?:ein|in|ins|im|auf|fuer|als)\b/,
  /\bformulier\w*/,
  /\bsetz\w*\b.*\b(?:ein|in|ins|auf|als)\b/,
  /\beingeb\w*/,
  /\bgib\b.*\bein\b/,
  /\btipp\w*\b.*\b(?:ein|in|ins)\b/,
  /\bergaenz\w*/,
  /\baufsetz\w*/,
  /\bsuch\w*\s+(?:nach|mir|in)\b/,
  /\bfilter\w*/,
  /\bfokus\w*/,
  /\bscroll\w*/,
  /\bcursor\b/,
  /\bspring\w*\b.*\b(?:feld|formular|eingabe)\b/,
  /\b(?:zum|zu dem|zur)\s+(?:feld|formular|eingabefeld|textfeld|suchfeld)\b/,
];

/** A page: to open it, to go there, where it is. */
const OPEN_PATTERNS: readonly RegExp[] = [
  /\boeffn\w*/,
  /\bgeh\w*\b.*\b(?:zu|zum|zur|auf)\b/,
  /\bbring\w*\s+mich\b/,
  /\bfuehr\w*\s+mich\b/,
  /\bnavigier\w*/,
  /\bwo\s+(?:finde|ist|sind|geht)\b/,
  /\bmenue\w*/,
  /\bwechsel\w*\b.*\b(?:zu|zum|zur|auf)\b/,
];

/** The intent of a message of the person. Both false for plain questions. */
export function detectUiIntent(message: unknown): UiIntent {
  if (typeof message !== 'string' || !message.trim()) {
    return { fill: false, open: false };
  }
  // a very long text is no short request, it is pasted content
  const folded = foldText(message.slice(0, 600));
  return {
    fill: FILL_PATTERNS.some(pattern => pattern.test(folded)),
    open: OPEN_PATTERNS.some(pattern => pattern.test(folded)),
  };
}

/** Whether the message asks for anything the tools can do. */
export function hasUiIntent(intent: UiIntent): boolean {
  return intent.fill || intent.open;
}
