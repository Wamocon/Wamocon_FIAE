/**
 * HAI quiz mode: does a message ask to be quizzed?
 *
 * Plain code, no model: like the data intents in dataContext.ts, a request of
 * the person ("Frag mich zu SQL ab", "Quiz mich zu diesem Enabler") is
 * recognized by patterns and the turn ends with a fixed text plus the start
 * signal for the quiz card. The questions themselves come from the quiz routes
 * (/api/hai/quiz-mode), never from the model.
 *
 * What counts: an imperative or a polite request to be asked, tested or
 * quizzed ("frag mich ab", "kannst du mich abfragen", "teste mich", "quiz
 * mich", "starte ein Quiz", "Quiz-Modus"). What does not count: a question
 * about the word ("Was ist ein Quiz?", "Wie funktioniert der Quiz-Modus?") and
 * long texts (a pasted document is no request).
 *
 * The result names the topic (the words after "zu", "über", "in") and whether
 * the person means the enabler the chat is open in ("zu diesem Enabler").
 *
 * @module lib/hai/quizMode/detect
 */

import { foldText, QUIZ_MODE_MAX_TOPIC_CHARS } from './logic';

export interface QuizModeRequest {
  /** What to be asked about, as written by the person, or null for "anything". */
  topic: string | null;
  /** The person means the enabler of the open chat ("diesen Enabler"). */
  thisEnabler: boolean;
}

/** Longer texts are not checked. */
const MAX_CHECKED_CHARS = 200;

/** A question about the word or the feature, not a request to start. */
const ABOUT_THE_FEATURE =
  /^\s*(?:was|wie|wo|wann|warum|wozu|wofuer|wieso|weshalb|wer|welche[rsmn]?|gibt es|gibt's)\b/;

/** "das Quiz von Enabler 3": the quiz page of an enabler, not the quiz mode. */
const QUIZ_OF_AN_ENABLER =
  /\bquiz\w*\s+(?:von|vom|des|zu|zum)\s+(?:dem\s+)?enabler\s+(?:nr\.?\s*)?(?:\d|[a-z0-9]{3,})/;

const TRIGGERS: RegExp[] = [
  // "frag mich ab", "frag mich zu SQL ab", "frage mich bitte aus", "fragst du mich ... ab"
  /\bfrag\w*\b.{0,120}\bmich\b.{0,120}\b(?:ab|aus)\b/,
  /\bfrag\w*\b.{0,30}\bmich\b\s*[.!?]*$/,
  // "kannst du mich abfragen", "ich moechte mich abfragen lassen"
  /\bmich\b.{0,120}\babfrag\w*/,
  // "quiz mich", "quizze mich", "quizz mich zu ..."
  /\bquizz?\w*\s+mich\b/,
  // "teste mich", "pruef mich", "hoer mich ab"
  /\b(?:teste?|pruef\w*)\s+mich\b/,
  /\bhoer\w*\s+mich\b.{0,120}\bab\b/,
  /\b(?:teste?|pruefe?)\s+(?:mein|unser)\w*\s+wissen\b/,
  // "starte ein Quiz", "mach ein Quiz mit mir", "lass uns ein Quiz machen"
  /\b(?:starte?|beginne?)\b.{0,30}\b(?:quiz\w*|abfrage)\b/,
  /\b(?:mach\w*|lass\w*)\b.{0,30}\b(?:quiz\w*|abfrage)\b.{0,30}\bmit\s+(?:mir|uns)\b/,
  /\blass\s+uns\b.{0,30}\b(?:quiz\w*|abfrage)\b/,
  // "Quiz-Modus starten", "Quiz-Modus"
  /\b(?:starte?|oeffne\w*|aktiviere?\w*|beginne?|schalte\w*)\b.{0,30}\bquiz[- ]?modus\b/,
  /^\s*(?:den |das )?quiz[- ]?modus(?:\s+(?:starten|an|bitte))?\s*[.!?]*$/,
  // "/quiz sql", the suggestion of the chat
  /^\s*\/quiz\b/,
];

/** "diesem Enabler", "dieses Thema", "das aktuelle Kapitel": the open enabler. */
const THIS_ENABLER =
  /\b(?:dies\w*|aktuell\w*)\s+(?:enabler|thema|kapitel|lektion|modul|kurs|inhalt|bereich|abschnitt)\b/;

/** "zu SQL", "über Joins", "rund um Normalisierung", "zum Thema Netzwerke". */
const TOPIC_AFTER_PREPOSITION =
  /(?<![\p{L}\p{N}])(?:zum\s+thema|zu\s+dem\s+thema|zu(?:m|r)?|ueber|über|rund\s+um|bei|in|thema)\s+(.+)$/iu;

/** Words that end a topic and belong to the request ("ab", "bitte"). */
const TRAILING_FILLER =
  /(?:[\s,.!?]+|^)(?:bitte|mal|kurz|jetzt|noch|einmal|nochmal|ab|abfragen|aus|lassen|auf|los)[\s.!?]*$/iu;

const LEADING_ARTICLE =
  /^(?:dem|der|den|die|das|einem|einer|einen|eine|ein|meinem|meinen|meiner|unser\w*)\s+/iu;

/** A "topic" that means no topic at all. */
const NO_TOPIC =
  /^(?:alles|allem|allen|egal|beliebig\w*|gemischt\w*|querbeet|allgemein\w*|irgendwas|etwas)\b/;

function cleanTopic(raw: string): string | null {
  let topic = raw.trim();
  for (let i = 0; i < 6; i++) {
    const next = topic
      .replace(TRAILING_FILLER, '')
      .replace(/[\s,.!?;:]+$/u, '')
      .trim();
    if (next === topic) break;
    topic = next;
  }
  topic = topic.replace(LEADING_ARTICLE, '').trim();
  topic = topic.replace(/^["'„“]+|["'“”]+$/gu, '').trim();
  if (topic.length < 2) return null;
  if (NO_TOPIC.test(foldText(topic))) return null;
  return topic.slice(0, QUIZ_MODE_MAX_TOPIC_CHARS).trim() || null;
}

export function detectQuizModeRequest(
  message: unknown
): QuizModeRequest | null {
  if (typeof message !== 'string') return null;
  const text = message.trim();
  if (text === '' || text.length > MAX_CHECKED_CHARS) return null;

  const folded = foldText(text);
  // "Wie funktioniert der Quiz-Modus?" has the word but is a question about it.
  // "Kannst du mich abfragen?" starts with a verb and stays a request.
  if (ABOUT_THE_FEATURE.test(folded)) return null;
  // "Starte das Quiz von Enabler 3" goes to a page of the platform (the
  // navigation of the agent layer), it is no request to be quizzed
  if (QUIZ_OF_AN_ENABLER.test(folded)) return null;
  if (!TRIGGERS.some(pattern => pattern.test(folded))) return null;

  if (THIS_ENABLER.test(folded)) return { topic: null, thisEnabler: true };

  const withoutCommand = text.replace(/^\s*\/quiz\b/i, '');
  const found = TOPIC_AFTER_PREPOSITION.exec(withoutCommand);
  const topic = found
    ? cleanTopic(found[1])
    : /^\s*\/quiz\b/i.test(text)
      ? cleanTopic(withoutCommand)
      : null;
  return { topic, thisEnabler: false };
}
