/**
 * Pure helpers of the voice assistant (WMCNL-2907): what is read aloud, in which
 * pieces, when the day starts, and what ends the conversation. No audio, no
 * network, no React: everything here is testable without a browser.
 *
 * Modelled on the speech mode of damicon: the answer is read sentence by sentence
 * while it still streams, markup is not spoken, and once a day the assistant opens
 * the day with the question for the day at a glance.
 *
 * @module lib/hai/voice/speech
 */

import { classifySignal } from './signalWords';

// ============================================================================
// WHAT IS READ ALOUD
// ============================================================================

const EMOJI =
  /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}\u{200D}]/gu;

/**
 * Text of an answer without markup, so that a voice reads it as a sentence:
 * code blocks and links to addresses are dropped, emphasis and list marks lose
 * their signs, emojis and source marks like [1] are removed. The prompt asks the
 * model for plain speech already; this is the safety net for the rest.
 */
export function toSpeakableText(text: string): string {
  return (
    text
      // fenced code is not read aloud
      .replace(/```[\s\S]*?(```|$)/g, ' ')
      // [text](address) -> text, bare addresses go
      .replace(/\[([^\]]+)\]\((?:https?:\/\/|\/)[^)]*\)/g, '$1')
      .replace(/https?:\/\/\S+/g, ' ')
      // source marks: [1], [Quelle 2], (Quelle: ...)
      .replace(/\[(?:Quelle\s*)?\d+\]/gi, ' ')
      .replace(/\((?:Quelle|Quellen)[^)]*\)/gi, ' ')
      // headings, quotes, list marks at the start of a line
      .replace(/^\s{0,3}#{1,6}\s+/gm, '')
      .replace(/^\s{0,3}>\s?/gm, '')
      .replace(/^\s*(?:[-*+•]|\d+[.)])\s+/gm, '')
      // emphasis and inline code (an underscore only at word boundaries: snake_case stays)
      .replace(/\*\*(.+?)\*\*/g, '$1')
      .replace(/\*(\S(?:.*?\S)?)\*/g, '$1')
      .replace(/(^|\s)__(.+?)__(?=\s|[.,;:!?]|$)/g, '$1$2')
      .replace(/(^|\s)_(\S(?:.*?\S)?)_(?=\s|[.,;:!?]|$)/g, '$1$2')
      .replace(/`([^`]*)`/g, '$1')
      // table bars and rules
      .replace(/^\s*\|?[-:| ]{3,}\|?\s*$/gm, ' ')
      .replace(/^\s*\|\s*/gm, '')
      .replace(/\s*\|\s*$/gm, '')
      .replace(/\s*\|\s*/g, ', ')
      .replace(EMOJI, '')
      .replace(/\s*\n\s*/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim()
  );
}

// Abbreviations that end in a full stop without ending a sentence
const ABBREVIATIONS = new Set([
  'z',
  'b',
  'd',
  'h',
  'u',
  'a',
  'ca',
  'bzw',
  'usw',
  'etc',
  'nr',
  'vgl',
  'ggf',
  'evtl',
  'inkl',
  'max',
  'min',
  'abs',
  'str',
  'dr',
  'prof',
  'sog',
  'bspw',
]);

const MIN_PIECE = 24;

/**
 * Splits text into sentences that are finished and the rest that still grows.
 * A full stop after an abbreviation ("z. B.", "bzw.") or after a number ("am 3.
 * Mai") does not end a sentence. Very short pieces are joined with the next one,
 * a voice reads "Ja." and "Okay." better inside a longer piece. The end of the
 * text is never a finished sentence: it may still grow.
 */
export function splitSentences(text: string): {
  sentences: string[];
  rest: string;
} {
  const sentences: string[] = [];
  let start = 0;
  const pattern = /([.!?…:]+)(\s+|$)/g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    const end = match.index + match[1].length;
    // the end of the text is not yet a sentence
    if (match[2] === '' && end === text.length) break;
    const before = text.slice(start, match.index);
    if (match[1] === '.') {
      const word = /([A-Za-zÄÖÜäöüß]+)$/.exec(before)?.[1];
      if (word && ABBREVIATIONS.has(word.toLowerCase())) continue;
      if (/\d$/.test(before)) continue;
    }
    const piece = text.slice(start, end);
    if (piece.trim().length < MIN_PIECE) continue;
    sentences.push(piece.trim());
    start = end + match[2].length;
  }
  return { sentences, rest: text.slice(start).trim() };
}

/**
 * What to read next of an answer that is still streaming: the finished sentences
 * after the first `spokenCount` ones. With `final` the rest is read too, as the
 * last piece. `spokenCount` is the number of pieces read so far.
 */
export function nextSpeechPieces(
  fullText: string,
  spokenCount: number,
  final: boolean
): string[] {
  const { sentences, rest } = splitSentences(toSpeakableText(fullText));
  const pieces = final && rest ? [...sentences, rest] : sentences;
  return pieces.slice(spokenCount);
}

// ============================================================================
// THE DAY STARTS WITH A QUESTION
// ============================================================================

/** The question the assistant asks for the day at a glance, by time of day. */
export function dayStartMessage(hour: number): string {
  const greeting =
    hour < 11 ? 'Guten Morgen' : hour < 17 ? 'Guten Tag' : 'Guten Abend';
  return `${greeting}, was steht heute an?`;
}

const DAY_KEY_PREFIX = 'hai-voice-day-start:';

/** The day in Berlin as YYYY-MM-DD (the training runs in Germany). */
export function berlinDay(now: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Berlin',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(now);
}

export function berlinHour(now: Date): number {
  const hour = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Europe/Berlin',
    hour: '2-digit',
    hourCycle: 'h23',
  }).format(now);
  return Number(hour);
}

export interface SimpleStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

/** Has the day not yet started for this person? Storage may throw: then it is due. */
export function dayStartDue(
  storage: SimpleStorage | null,
  userId: string,
  now: Date
): boolean {
  try {
    return storage?.getItem(DAY_KEY_PREFIX + userId) !== berlinDay(now);
  } catch {
    return true;
  }
}

export function markDayStart(
  storage: SimpleStorage | null,
  userId: string,
  now: Date
): void {
  try {
    storage?.setItem(DAY_KEY_PREFIX + userId, berlinDay(now));
  } catch {
    // no storage (private window): the start is offered again next time
  }
}

// ============================================================================
// WHAT ENDS THE CONVERSATION
// ============================================================================

/**
 * A whole short utterance that ends the conversation ("Gespräch beenden",
 * "Tschüss", ...). A question that only contains the word does not. "Stopp" is
 * no longer one of them: it makes the HAI stop talking and keeps the
 * conversation open (see signalWords.ts, where all the word lists are).
 */
export function isStopCommand(utterance: string): boolean {
  return classifySignal(utterance)?.kind === 'end';
}

// ============================================================================
// BROWSER SUPPORT
// ============================================================================

export interface VoiceSupport {
  recognition: boolean;
  synthesis: boolean;
}

/** What the browser can do. Pass `window`; null on the server. */
export function voiceSupport(
  win: (Window & Record<string, unknown>) | null | undefined
): VoiceSupport {
  if (!win) return { recognition: false, synthesis: false };
  return {
    recognition: !!(win.SpeechRecognition || win.webkitSpeechRecognition),
    synthesis: 'speechSynthesis' in win,
  };
}
