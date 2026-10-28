// Shortening of German running text at sentence borders. Pure functions: no
// file access, no database, no model. Used by the import to turn the long text
// of a source document into the short description that FIAE has for the same
// kind of content (docs/kfbm-import-runbook.md, "Beschreibungen im FIAE-Umfang").
//
// The rules are fixed and deterministic, so the same text always gives the same
// result and a second run over a result changes nothing (idempotent):
//  - white space is normalized (runs of white space become one space)
//  - whole sentences are kept, in order, as long as they fit into the limit
//  - if even the first sentence does not fit, it is cut at a word border and
//    marked with an ellipsis (only a single word that is longer than the limit
//    itself is cut inside)
//  - the result is never longer than the limit

/** Words before a full stop that do not end a sentence (compared in lower case). */
const ABBREVIATIONS = new Set([
  'abb',
  'abs',
  'anm',
  'art',
  'bsp',
  'bspw',
  'bzw',
  'ca',
  'dr',
  'etc',
  'evtl',
  'exkl',
  'ff',
  'ggf',
  'inkl',
  'kap',
  'lfd',
  'max',
  'min',
  'mio',
  'nr',
  'prof',
  'sog',
  'std',
  'tab',
  'str',
  'tel',
  'tsd',
  'usw',
  'vgl',
  'zzgl',
]);

const MONTHS = new Set([
  'januar',
  'februar',
  'märz',
  'april',
  'mai',
  'juni',
  'juli',
  'august',
  'september',
  'oktober',
  'november',
  'dezember',
]);

/** A character that may open a sentence. */
const SENTENCE_START = /^[A-ZÄÖÜ„"“(\d]/;

const normalize = (text: string) => text.replace(/\s+/g, ' ').trim();

/**
 * The sentence ends of a text: a full stop, question mark or exclamation mark
 * (with closing quotes or brackets) followed by a space and a capital letter, a
 * digit or an opening quote. A full stop after an abbreviation ("z. B.", "d. h.",
 * "Abs.", "Nr."), after a single letter, or after a number that is an ordinal
 * ("14. November") is no sentence end.
 */
export function splitSentences(text: string): string[] {
  const t = normalize(text);
  if (t.length === 0) return [];
  const sentences: string[] = [];
  let start = 0;
  const ends = /[.!?]["”“)»]*(?= )/g;
  let match: RegExpExecArray | null;
  while ((match = ends.exec(t)) !== null) {
    const end = match.index + match[0].length;
    const rest = t.slice(end + 1);
    if (!SENTENCE_START.test(rest)) continue;
    if (match[0].startsWith('.')) {
      const before = t.slice(start, match.index);
      const word = before
        .slice(before.lastIndexOf(' ') + 1)
        .replace(/^[("„“"]+/, '');
      if (word.length === 1 || ABBREVIATIONS.has(word.toLowerCase())) continue;
      if (/^\d+$/.test(word)) {
        // an ordinal in front of a month name ("14. November") goes on
        const next = (rest.match(/^(\S+)/)?.[1] ?? '').toLowerCase();
        if (MONTHS.has(next)) continue;
      }
    }
    sentences.push(t.slice(start, end));
    start = end + 1;
  }
  const last = t.slice(start);
  if (last.length > 0) sentences.push(last);
  return sentences;
}

const ELLIPSIS = '…';

/** Cuts one sentence at a word border so that it fits with the ellipsis. */
function cutAtWord(sentence: string, max: number): string {
  const room = Math.max(0, max - ELLIPSIS.length);
  if (room === 0) return '';
  let cut = sentence.slice(0, room + 1);
  // the cut must fall between two words: drop the word that is only partly in
  const space = cut.lastIndexOf(' ');
  if (cut.length > room && space > 0) {
    cut = cut.slice(0, space);
  } else if (cut.length > room) {
    // a single word that is longer than the limit (a compound word, an
    // address): the only cut that is left, between two characters, never
    // inside a surrogate pair
    let units = '';
    for (const char of cut) {
      if (units.length + char.length > room) break;
      units += char;
    }
    cut = units;
  }
  cut = cut.replace(/[\s,;:(\[–-]+$/u, '');
  return cut.length > 0 ? `${cut}${ELLIPSIS}` : '';
}

/**
 * The text shortened to at most `max` characters: whole sentences from the
 * start, or, when the first sentence alone is too long, that sentence cut at a
 * word with an ellipsis. A text that fits is returned with normalized white
 * space only.
 */
export function shortenText(text: string, max: number): string {
  const t = normalize(text);
  if (t.length <= max) return t;
  let out = '';
  for (const sentence of splitSentences(t)) {
    const next = out ? `${out} ${sentence}` : sentence;
    if (next.length > max) break;
    out = next;
  }
  if (out) return out;
  return cutAtWord(t, max);
}
