/**
 * Signal words of the voice mode: what the person can say to make the HAI stop
 * talking, to end the conversation or to switch the microphone off. ONE place
 * for the word lists, extendable per language (German first).
 *
 * Three kinds:
 *  - `halt`   the HAI stops at once (voice cut, running chat answer aborted), the
 *             voice mode stays open and keeps listening. Recognised at the START
 *             of an utterance (the first one to three words), already from the
 *             provisional text, so it needs no wait for the end of the utterance.
 *  - `end`    the voice mode ends, like the close button. Only as a whole short
 *             utterance ("Gespräch beenden", "Tschüss"), at the end of the
 *             utterance: "Beenden wir das Kapitel?" is a question.
 *  - `micOff` the microphone goes off until the button is pressed. Whole short
 *             utterance as well.
 *
 * A word in the middle of a sentence never counts ("das war nicht der Stopp",
 * "wir halten das fest"), and only whole words or the listed short phrases do
 * ("Halte durch" is not "Halt"). The text is folded before it is compared:
 * upper and lower case, umlauts (ä = ae, ö = oe, ü = ue, ß = ss), accents and
 * punctuation do not matter, so "Hör auf!", "hoer auf" and "HÖR AUF" are one.
 *
 * Pure logic, no browser, no network. The loudness gate and the echo filter that
 * a signal word has to pass live in useHaiVoice (a signal word never bypasses
 * them: a background talk that says "stopp" does not stop the HAI).
 *
 * @module lib/hai/voice/signalWords
 */

export type SignalKind = 'halt' | 'end' | 'micOff';
export type SignalLanguage = 'de' | 'en';

interface WordList {
  /** Phrases that make the HAI stop (first one to three words of an utterance). */
  halt: readonly string[];
  /** Whole short utterances that end the voice mode. */
  end: readonly string[];
  /** Whole short utterances that switch the microphone off. */
  micOff: readonly string[];
  /** Words that may stand around a command without changing its meaning. */
  fillers: readonly string[];
}

/** The word lists, written the natural way. They are folded when they are used. */
export const SIGNAL_WORDS: Readonly<Record<SignalLanguage, WordList>> = {
  de: {
    halt: [
      'Stopp',
      'Stop',
      'Halt',
      'Warte',
      'Moment',
      'Ruhe',
      'Hör auf',
      'Abbrechen',
      'Pause',
    ],
    end: [
      'Gespräch beenden',
      'Sprachmodus beenden',
      'Beenden',
      'Tschüss',
      'Tschüs',
      'Auf Wiedersehen',
      'Das war es',
      "Das war's",
      'Das war alles',
    ],
    micOff: ['Mikrofon aus', 'Mikrofon ausschalten', 'Mikrofon ausmachen'],
    fillers: [
      'bitte',
      'mal',
      'kurz',
      'jetzt',
      'doch',
      'sofort',
      'hai',
      'danke',
      'ok',
      'okay',
      'also',
      'dann',
      'einmal',
      'einen',
    ],
  },
  en: {
    halt: ['Stop', 'Wait', 'Hold on', 'Pause', 'Quiet', 'Cancel'],
    end: ['End conversation', 'End the conversation', 'Goodbye', 'Bye'],
    micOff: ['Microphone off', 'Mute'],
    fillers: ['please', 'now', 'just', 'ok', 'okay', 'thanks', 'hai'],
  },
};

/** The most words of an utterance that count as "the start" for a halt word. */
export const HALT_START_WORDS = 3;
/** A command (halt, end, micOff) is never longer than this many words. */
export const COMMAND_MAX_WORDS = 5;

/**
 * Folds a text for comparison: lower case, ä ö ü ß as ae oe ue ss, other accents
 * removed, everything that is not a letter or a digit becomes a space.
 */
export function foldText(text: string): string {
  return text
    .toLowerCase()
    .replace(/ä/g, 'ae')
    .replace(/ö/g, 'oe')
    .replace(/ü/g, 'ue')
    .replace(/ß/g, 'ss')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

/** The words of a folded text. */
function foldedWords(text: string): string[] {
  const folded = foldText(text);
  return folded ? folded.split(' ') : [];
}

interface Compiled {
  halt: string[][];
  end: string[];
  micOff: string[];
  fillers: Set<string>;
}

function compile(languages: readonly SignalLanguage[]): Compiled {
  const compiled: Compiled = {
    halt: [],
    end: [],
    micOff: [],
    fillers: new Set(),
  };
  for (const language of languages) {
    const list = SIGNAL_WORDS[language];
    if (!list) continue;
    compiled.halt.push(...list.halt.map(foldedWords));
    compiled.end.push(...list.end.map(foldText));
    compiled.micOff.push(...list.micOff.map(foldText));
    for (const filler of list.fillers) compiled.fillers.add(foldText(filler));
  }
  return compiled;
}

const compiledCache = new Map<string, Compiled>();
function compiledFor(languages: readonly SignalLanguage[]): Compiled {
  const key = languages.join(',');
  let compiled = compiledCache.get(key);
  if (!compiled) {
    compiled = compile(languages);
    compiledCache.set(key, compiled);
  }
  return compiled;
}

export interface Signal {
  kind: SignalKind;
  /**
   * The whole utterance is the command (only the command and fillers). A halt word
   * with a question behind it is not pure: the HAI stops, the question is asked.
   */
  pure: boolean;
}

/** Words of the utterance that are not fillers. */
function withoutFillers(words: string[], fillers: Set<string>): string[] {
  return words.filter(word => !fillers.has(word));
}

/** Does the list of words start with the phrase (whole words)? */
function startsWith(words: string[], phrase: string[]): boolean {
  if (phrase.length === 0 || words.length < phrase.length) return false;
  return phrase.every((word, index) => words[index] === word);
}

/**
 * Does the text start with a halt word? Looks at the first one to three words
 * only, so it also works on a provisional text that is still growing. Returns
 * whether the whole text is just the command (see Signal.pure).
 */
export function haltAtStart(
  text: string,
  languages: readonly SignalLanguage[] = ['de']
): Signal | null {
  const compiled = compiledFor(languages);
  const words = foldedWords(text);
  if (words.length === 0) return null;
  // "Hör bitte auf": a polite "bitte" inside the phrase does not hide it
  const head = words
    .filter(word => word !== 'bitte')
    .slice(0, HALT_START_WORDS);
  const hit = compiled.halt.some(phrase => startsWith(head, phrase));
  if (!hit) return null;
  const rest = withoutFillers(words, compiled.fillers);
  const pure =
    words.length <= COMMAND_MAX_WORDS &&
    rest.length > 0 &&
    rest.every(word => compiled.halt.some(phrase => phrase.includes(word)));
  return { kind: 'halt', pure };
}

/**
 * Classifies a FINISHED utterance: halt at the start, or the whole utterance is
 * an end or a microphone-off command. Null for everything else, so the
 * utterance is an ordinary question.
 */
export function classifySignal(
  text: string,
  languages: readonly SignalLanguage[] = ['de']
): Signal | null {
  const compiled = compiledFor(languages);
  const words = foldedWords(text);
  if (words.length === 0 || words.length > COMMAND_MAX_WORDS + 2) return null;
  // the core of the utterance without the words that only soften it
  const core = withoutFillers(words, compiled.fillers).join(' ');
  if (words.length <= COMMAND_MAX_WORDS) {
    if (compiled.end.includes(core)) return { kind: 'end', pure: true };
    if (compiled.micOff.includes(core)) return { kind: 'micOff', pure: true };
  }
  return haltAtStart(text, languages);
}

/**
 * Words that count as speech for an interruption: letters and digits, at least
 * two (a single letter is a breath or a click).
 */
export function speechWords(text: string): string[] {
  return text
    .toLowerCase()
    .split(/\s+/)
    .map(word => word.replace(/[^\p{L}\p{N}]/gu, ''))
    .filter(word => word.length >= 2);
}
