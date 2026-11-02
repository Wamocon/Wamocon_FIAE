/**
 * Text folding for the recognition of a navigation request.
 *
 * Same rule as foldUmlauts in dataContext.ts (a typed or spoken "für" meets the
 * keyword "fuer"), kept here as a small copy so that this module has no
 * dependency on the data context (which needs the database). On top of that the
 * punctuation of a sentence is removed and spaces are collapsed, so a keyword
 * with word boundaries matches in a spoken sentence too.
 *
 * @module lib/hai/navigation/fold
 */

const UMLAUT_FOLD: Record<string, string> = {
  ä: 'ae',
  ö: 'oe',
  ü: 'ue',
  ß: 'ss',
};

/** Lower case with ae, oe, ue, ss. */
export function foldUmlauts(text: string): string {
  return text.toLowerCase().replace(/[äöüß]/g, c => UMLAUT_FOLD[c]);
}

/**
 * Folded text for matching: umlauts folded, punctuation (question marks,
 * commas, quotes, brackets) turned into spaces, a full stop kept inside a
 * number ("5.3") and one space between words.
 */
export function foldText(text: string): string {
  return foldUmlauts(text)
    .replace(/[?!,;:"„“”'`´()[\]{}<>]/g, ' ')
    .replace(/\.(?!\d)/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
