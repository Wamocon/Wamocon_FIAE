/**
 * File names in a message (pure, no server imports): the comparison form of a
 * name and the keys a message holds. Shared by the file questions
 * (documentQuery.ts) and the navigation (navigation/intent.ts), so "Öffne das
 * Dokument Szenario_14i" and "Was steht in Szenario_14i.pdf?" read a name the
 * same way.
 *
 * @module lib/hai/documentNames
 */

import { foldText } from './navigation/fold';
import { FILE_EXTENSIONS } from './pageContext/shared';

export const STOPWORDS = new Set([
  'der',
  'die',
  'das',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einen',
  'einem',
  'einer',
  'von',
  'vom',
  'zu',
  'zum',
  'zur',
  'im',
  'in',
  'am',
  'an',
  'auf',
  'aus',
  'bei',
  'mit',
  'fuer',
  'ueber',
  'und',
  'oder',
  'hat',
  'ist',
  'sind',
  'gibt',
  'es',
  'mir',
  'mich',
  'wie',
  'was',
  'wer',
  'welche',
  'welcher',
  'welches',
  'welchen',
  'heisst',
  'heissen',
  'steht',
  'stehen',
  'zeig',
  'zeige',
  'nenne',
  'bitte',
  'diese',
  'dieses',
  'dieser',
  'datei',
  'dateien',
  'dokument',
  'dokumente',
  'anhang',
  'unterlagen',
  'unterlage',
  'pdf',
  'pdfs',
  'enabler',
  'use',
  'case',
  'kurs',
  'alle',
  'meine',
  'gehoert',
  'gehoeren',
  'dazu',
  'hier',
  'noch',
]);

/**
 * The comparison form of a file name or title: umlauts folded, lower case,
 * extension cut off, underscore, hyphen, dots and spaces as one space. The SQL
 * below builds the same form, so "Datenbank_Grundlagen.pdf", "datenbank
 * grundlagen" and "Datenbank-Grundlagen" are one key.
 */
export function normalizeFileKey(name: string): string {
  const withoutExtension = name
    .trim()
    .replace(new RegExp(`\\.(?:${FILE_EXTENSIONS.join('|')})$`, 'i'), '');
  return foldText(withoutExtension.replace(/[_\-.]+/g, ' '))
    .replace(/\s+/g, ' ')
    .trim();
}

/** All contiguous phrases of 1 to 6 words, longest first, without stop words at the edges. */
function phrasesOf(text: string): string[] {
  const words = normalizeFileKey(text).split(' ').filter(Boolean);
  const phrases: string[] = [];
  for (let start = 0; start < words.length; start++) {
    for (let end = Math.min(words.length, start + 6); end > start; end--) {
      const slice = words.slice(start, end);
      if (STOPWORDS.has(slice[0]) || STOPWORDS.has(slice[slice.length - 1])) {
        continue;
      }
      const phrase = slice.join(' ');
      if (phrase.length >= 4) phrases.push(phrase);
    }
  }
  return [...new Set(phrases)].sort((a, b) => b.length - a.length);
}

const WORD = '[\\p{L}\\p{N}_\\-]+';
const EXT_NAME_RE = new RegExp(
  `(${WORD}(?: ${WORD}){0,5})\\.(?:${FILE_EXTENSIONS.join('|')})\\b`,
  'giu'
);
const QUOTED_RE = /["„“”'«»‚‘’]([^"„“”'«»‚‘’]{3,80})["„“”'«»‚‘’]/gu;
const BEFORE_KEYWORD_RE = new RegExp(
  `(${WORD}(?: ${WORD}){0,3}) (?:pdf|datei|dokument)\\b`,
  'giu'
);
const AFTER_KEYWORD_RE = new RegExp(
  `\\b(?:datei|dokument|pdf|anhang|unterlage)\\s+(${WORD}(?: ${WORD}){0,3})`,
  'giu'
);

/**
 * Comparison keys for a file name in the message, longest first. Sources: a
 * name with an extension (the extension is optional for the match), a quoted
 * text, and the words after "Datei", "Dokument", "PDF" when they look like a
 * name (several words, or a word with underscore, hyphen or digit). A key that
 * is only a stop word or shorter than 4 characters is dropped.
 */
export function extractFileNameKeys(message: string): FileNameKey[] {
  const found = new Map<string, boolean>();
  const add = (raw: string) => {
    // the longest phrase of a source may match a file name in part, the
    // shorter ones (parts of the same words) only a file that has exactly that name
    phrasesOf(raw).forEach((key, index) => {
      if (!found.has(key) || (index === 0 && !found.get(key))) {
        found.set(key, index === 0);
      }
    });
  };
  for (const m of message.matchAll(EXT_NAME_RE)) add(m[1]);
  for (const m of message.matchAll(QUOTED_RE)) add(m[1]);
  for (const m of message.matchAll(AFTER_KEYWORD_RE)) {
    const raw = m[1];
    const looksLikeName =
      /[_\-0-9]/.test(raw) ||
      normalizeFileKey(raw)
        .split(' ')
        .filter(w => w && !STOPWORDS.has(w)).length >= 2;
    if (looksLikeName) add(raw);
  }
  // spoken: the name before the noun ("datenbank grundlagen pdf")
  for (const m of message.matchAll(BEFORE_KEYWORD_RE)) {
    const raw = m[1];
    const words = normalizeFileKey(raw)
      .split(' ')
      .filter(w => w && !STOPWORDS.has(w));
    if (words.length >= 2) add(raw);
  }
  return [...found.entries()]
    .map(([key, partial]) => ({ key, partial }))
    .sort((a, b) => b.key.length - a.key.length)
    .slice(0, 12);
}

/** A comparison key and whether a file name may contain it (else it must be equal). */
export interface FileNameKey {
  key: string;
  partial: boolean;
}
