// The cleaning that comes first, before any check of an excerpt
// (docs/ki-upload-konzept.md, 5.3, protection rule 1).
//
// The order matters: a zero width character in the middle of "Kurzbegründung"
// or a look-alike letter in "Richtige Antwort" must not hide the marker of a
// solution from the checks that follow, so the text is cleaned before any
// check looks at it. The cleaning is the one of sanitizePromptData (src/lib/
// prompt-sanitize.ts) plus Unicode normalization (NFKC) and the removal of all
// format characters. It is idempotent.

import { sanitizePromptData } from '../prompt-sanitize';

/**
 * Control characters (but not tab, line feed, carriage return and the next
 * line mark, which sanitizePromptData turns into a line break), all format
 * characters (Cf: zero width, joiners, bidi marks, tags, soft hyphen), every
 * character that is ignorable by default (combining grapheme joiner, Hangul
 * fillers, variation selectors, the tag letters) and the blank Braille
 * pattern. None of them has a visible form, so none of them may split a word.
 */
const REMOVE =
  /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F\u0080-\u0084\u0086-\u009F\p{Cf}\ufe00-\ufe0f\p{Default_Ignorable_Code_Point}\u{2800}]/gu;

/** Combining marks that are left after the composition: no letter takes them. */
const LEFTOVER_MARKS = /\p{M}/gu;

/** The text of a document, ready for the checks of an excerpt. */
export function sanitizeExcerptText(text: string): string {
  const stripped = text.normalize('NFKC').replace(REMOVE, '');
  // Removing characters can bring a letter and an accent together: once more.
  // A mark that no letter takes (it stays apart after the composition) would
  // split a word as well, so it goes.
  return sanitizePromptData(
    stripped.normalize('NFKC').replace(LEFTOVER_MARKS, '')
  );
}

// Letters of other alphabets that look like Latin letters. NFKC does not
// merge them, a text with "Аntwort" (Cyrillic А) would pass a check for
// "Antwort". The fold is only used to look for markers, the excerpt itself
// is not changed by it.
const LOOK_ALIKES: Record<string, string> = {
  // Cyrillic, lower case
  һ: 'h',
  ԝ: 'w',
  ӏ: 'l',
  к: 'k',
  м: 'm',
  а: 'a',
  е: 'e',
  о: 'o',
  р: 'p',
  с: 'c',
  х: 'x',
  у: 'y',
  і: 'i',
  ј: 'j',
  ѕ: 's',
  ԁ: 'd',
  ɡ: 'g',
  // Cyrillic, upper case
  А: 'A',
  В: 'B',
  Е: 'E',
  К: 'K',
  М: 'M',
  Н: 'H',
  О: 'O',
  Р: 'P',
  С: 'C',
  Т: 'T',
  Х: 'X',
  І: 'I',
  Ј: 'J',
  Ѕ: 'S',
  // Greek and others
  ρ: 'p',
  κ: 'k',
  υ: 'u',
  τ: 't',
  ϲ: 'c',
  ı: 'i',
  ο: 'o',
  ι: 'i',
  ν: 'v',
  Α: 'A',
  Β: 'B',
  Ε: 'E',
  Ζ: 'Z',
  Η: 'H',
  Ι: 'I',
  Κ: 'K',
  Μ: 'M',
  Ν: 'N',
  Ο: 'O',
  Ρ: 'P',
  Τ: 'T',
  Υ: 'Y',
  Χ: 'X',
};
const LOOK_ALIKE_PATTERN = new RegExp(
  `[${Object.keys(LOOK_ALIKES).join('')}]`,
  'g'
);

const DIAERESIS = String.fromCharCode(0x308);

/**
 * Accents on letters: "Kurzbegŕündung" is "Kurzbegründung" with an accent on the
 * r. The accent is taken off every letter except the diaeresis of a, o and u,
 * which the German markers spell with (ä, ö, ü).
 */
function foldAccents(text: string): string {
  return text
    .normalize('NFD')
    .replace(/^\p{M}+/u, '')
    .replace(/(\P{M})(\p{M}+)/gu, (all, base: string, marks: string) =>
      /[aouAOU]/.test(base) && marks === DIAERESIS ? all : base
    )
    .normalize('NFC');
}

/**
 * Replaces look-alike letters of other alphabets by the Latin letters and takes
 * accents off the letters (but not the German umlauts).
 */
export function foldConfusables(text: string): string {
  return foldAccents(text).replace(LOOK_ALIKE_PATTERN, ch => LOOK_ALIKES[ch]);
}
