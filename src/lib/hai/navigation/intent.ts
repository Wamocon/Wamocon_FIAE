/**
 * Deterministic recognition of a navigation request ("öffne meine Berichte",
 * "bring mich zum Quiz von Enabler 3", "wo geht es weiter").
 *
 * Keywords and patterns on folded text, like the data intents of
 * dataContext.ts. The model plays no part: the pipeline recognizes the request
 * before any model call, and a recognized request is answered by the server.
 *
 * What is recognized is only WHAT the person wants (a target id and, for an
 * enabler or a use case, the number or the name the person said). Whether the
 * person may go there is decided later against the allow list, the role and the
 * occupation (resolve.ts). A request for a page of another role is recognized
 * on purpose so it can be refused in a friendly way.
 *
 * A navigation request needs two things: a cue (a verb like "öffne" or "bring
 * mich", or the word "Seite") and a target. A learning question, a request for
 * a solution or a question for numbers ("wie viele Berichte") is not a
 * navigation request and stays with the pipeline.
 *
 * Besides WHAT the person wants, `isDirectCommand` tells HOW: a clear command
 * ("Öffne ...", "Bring mich zu ...", "Geh zu ...", "Ich will zum ...") is
 * carried out right away, a question for the way ("Wo finde ich ...") or a
 * softer wish ("Zeig mir ...", "Ich möchte ... sehen") stays an offer that the
 * person confirms.
 *
 * @module lib/hai/navigation/intent
 */

import { foldText } from './fold';
import type { StaticTargetId } from './targets';

/** What the person said about an enabler or a use case: a number or a name. */
export interface ContentReference {
  /** "3", "1a", "5.3": as said, compared with the code and the title. */
  number?: string;
  /** Words of the name, folded, at most six. */
  name?: string;
}

export type NavigationIntent =
  | { kind: 'static'; target: StaticTargetId }
  | { kind: 'continue' }
  | { kind: 'enabler'; ref: ContentReference }
  | { kind: 'use_case'; ref: ContentReference }
  | { kind: 'enabler_quiz'; ref: ContentReference }
  /** A clear command to open "a page" that is none of the known ones. */
  | { kind: 'unknown_page' };

/** A command is short, a long text is a content question. */
const MAX_LENGTH = 160;

/** "Where does it go on" and "what is next": the next step of the trainee. */
const CONTINUE_PATTERNS: readonly RegExp[] = [
  /\bwo\s+(?:geht|gehts)\s+(?:es\s+|s\s+)?(?:jetzt\s+|nun\s+)?weiter\b/,
  /\bwie\s+(?:geht|gehts)\s+(?:es\s+|s\s+)?(?:jetzt\s+|nun\s+)?weiter\b/,
  /\bweiter\s?lernen\b/,
  /\bmit\s+dem\s+lernen\s+weiter\w*/,
  /\bwomit\s+(?:mache|soll|kann)\s+ich\s+(?:\w+\s+)?(?:weiter|weitermachen|anfangen|beginnen)\b/,
  /\bwas\s+(?:lerne|mache|bearbeite)\s+ich\s+(?:\w+\s+)?(?:als\s+)?(?:naechstes|jetzt)\b/,
  /\bwas\s+(?:soll|sollte|kann|muss)\s+ich\s+(?:\w+\s+)?(?:als\s+)?(?:naechstes|jetzt)\s+(?:\w+\s+)?(?:lernen|machen|bearbeiten)\b/,
  /\bnaechste[nrms]?\s+(?:schritt|enabler|lektion|lerneinheit)\b/,
];

/** The cue of a request to go somewhere. */
const CUE_PATTERNS: readonly RegExp[] = [
  /\boeffn\w*/,
  /\b(?:geh|gehe|gehen|gehst|geht)\s+(?:\w+\s+){0,2}(?:zu|zum|zur|auf|in|ins)\b/,
  /\b(?:bring|bringe|bringst|fuehr|fuehre|fuehrst|leit|leite|leitest)\s+(?:\w+\s+)?(?:mich|uns)\b/,
  /\b(?:navigier|spring|wechsl|wechsel)\w*/,
  /\bzeig\w*\s+(?:mir|uns)\b/,
  /\bwo\s+(?:finde|sehe)\s+ich\b/,
  /\bwie\s+komme\s+ich\s+(?:\w+\s+)?(?:zu|zum|zur|in|auf)\b/,
  /\b(?:moechte|will|moecht)\s+(?:\w+\s+){0,2}(?:zu|zum|zur)\b/,
  /\b(?:seite|link)\b/,
  // "kannst du mich zum Berichtsheft bringen", "mich bitte zur Schule fuehren"
  /\bmich\b(?:\s+\w+){0,5}\s+(?:bringen|fuehren|leiten|weiterleiten|navigieren|schicken|lotsen)\b/,
  // "kannst du mir das Dashboard zeigen"
  /\b(?:mir|uns)\b(?:\s+\w+){0,6}\s+(?:zeigen|anzeigen)\b/,
  // "mach das Dashboard auf", "ruf bitte die Berufsschule auf"
  /\b(?:mach|mache|machst|ruf|rufe|rufst)\b(?:\s+\w+){0,4}\s+auf\b/,
  /\b(?:aufrufen|aufmachen)\b/,
  // "nimm mich mit zum Dashboard", "lass uns zum Profil gehen"
  /\b(?:nimm|nehm\w*)\s+(?:\w+\s+)?(?:mich|uns)\s+(?:\w+\s+)?mit\b/,
  /\blass\s+(?:uns|mich)\b(?:\s+\w+){0,4}\s+(?:gehen|wechseln|oeffnen|springen|navigieren)\b/,
  // "wo ist das Dashboard", "wo kann ich die Berichte sehen"
  /\bwo\s+(?:ist|sind|liegt|liegen)\b/,
  /\bwo\s+kann\s+ich\b.{0,40}\b(?:finden|sehen|einsehen|aufrufen)\b/,
  // "ich moechte meine Berufsschule sehen"
  /\b(?:moechte|will|moecht|wuerde\s+gern\w*)\s+(?:\w+\s+){0,3}(?:sehen|ansehen|anschauen|aufrufen)\b/,
];

/**
 * A short direction without a verb: "zum Dashboard bitte", "zurück zur
 * Startseite", "zu den Quizzen". Only a short text counts, so a sentence that
 * merely starts with "zu" does not.
 */
const SHORT_DIRECTION =
  /^(?:bitte\s+)?(?:zurueck\s+)?(?:zu|zum|zur)\s+(?:\w+\s+){0,2}\w+(?:\s+bitte)?$/;
const SHORT_DIRECTION_MAX_WORDS = 6;

/**
 * Words that make a message something else: a request for a solution or an
 * explanation, a content question, a question for numbers or dates. Such a
 * message stays with the pipeline.
 */
const NOT_A_COMMAND =
  /\b(?:\w*loesung\w*|\w*antwort\w*|erklaer\w*|was\s+ist|was\s+sind|wie\s+funktioniert|warum|wieso|weshalb|schreib\w*|programmier\w*|code|beispiel\w*|zusammenfass\w*|uebersetz\w*|wie\s?viel\w*|anzahl|status|stand|fortschritt|note|noten|ergebnis\w*|wann|welche[rsmn]?|fehler|problem\w*|falsch\w*|kaputt|hilfe|hilf\w*)\b/;

/**
 * Keywords of the static targets, in the order of priority: the first target
 * that matches wins ("die Berichte der Azubis" is the reports, not the list of
 * the trainees).
 */
const TARGET_PATTERNS: ReadonlyArray<readonly [StaticTargetId, RegExp]> = [
  [
    'reviews',
    /\b(?:offene[nrms]?\s+(?:bewertungen|reviews?)|bewertungen\s+offen|reviews?|pruefliste|zu\s+bewerten\w*)\b/,
  ],
  [
    'content_management',
    /\b(?:inhaltsverwaltung|inhalte\s+verwalten|content\s?-?\s?management|kursverwaltung|modulverwaltung)\b/,
  ],
  ['quizzes', /\b(?:quiz|quizze|quizzen|quiz\s?-?\s?verwaltung)\b/],
  // the menu entry "Lernen" of a trainee: "meine Kurse", "zum Lernen"
  [
    'courses',
    /\b(?:kurse[nrs]?|lernbereich\w*|lernseite|lernstoff|lerninhalte?|lernmodule?|zum\s+lernen)\b/,
  ],
  ['statistics', /\b(?:statistik\w*|inhaltsstatistik|auswertung\w*)\b/],
  ['calendar', /\b(?:blockkalender|schulkalender|kalender)\b/],
  ['school', /\b(?:berufsschul\w*|schulbereich|schule)\b/],
  ['organizations', /\b(?:organisation\w*|mandanten)\b/],
  ['users', /\b(?:benutzer\w*|nutzerverwaltung|nutzer\s+verwalten)\b/],
  [
    'activity_reports',
    /\b(?:berichtsheft\w*|taetigkeitsnachweis\w*|ausbildungsnachweis\w*|wochenbericht\w*|berichte[n]?|bericht|nachweise[n]?)\b/,
  ],
  // after the reports: "das Feedback zu meinem Bericht" is about the report
  [
    'trainer_feedback',
    /\b(?:(?:ausbilder|trainer)-?\s?feedback|feedback\w*|rueckmeldung\w*)\b/,
  ],
  ['trainees', /\b(?:auszubildende[nr]?|azubis|azubi-?verwaltung|trainees)\b/],
  ['profile', /\b(?:profil\w*)\b/],
  ['dashboard', /\b(?:dashboard|startseite|startbildschirm)\b/],
];

/** A command for an unknown page is shorter than a command with a content name. */
const UNKNOWN_PAGE_MAX_LENGTH = 100;

/**
 * "öffne die Seite Wetter", "geh zur Seite Rezepte", "bring mich zur Seite
 * Horoskop": a verb of going, then (at most two words later) the word "Seite"
 * and a name that is no number.
 */
const UNKNOWN_PAGE =
  /\b(?:oeffn\w*|(?:geh|gehe|gehen)|(?:bring|fuehr|leit)\w*\s+(?:\w+\s+)?(?:mich|uns)|zeig\w*\s+(?:mir|uns))\s+(?:\w+\s+){0,2}(?:seite|seiten)\s+(?!\d)\w{3,}/;

/** Words in front of a name that are not part of it (an article, a filler). */
const LEADING_FILLER = new Set([
  'der',
  'die',
  'das',
  'den',
  'dem',
  'nummer',
  'nr',
  'mal',
  'bitte',
]);

/**
 * A preposition right after the content type says what the record is about
 * ("den Use Case zur Anwendungsentwicklung", "den Enabler zum Thema SQL"), it
 * does not name the record. Such a message is a content question and stays with
 * the pipeline.
 */
const TOPIC_PREPOSITION = new Set([
  'zu',
  'zum',
  'zur',
  'ueber',
  'von',
  'fuer',
  'im',
  'in',
  'bei',
  'aus',
]);

/** Words that end a name: the rest of the command is no part of it. */
const NAME_STOP = new Set([
  'bitte',
  'oeffnen',
  'oeffne',
  'zeigen',
  'zeig',
  'ansehen',
  'anschauen',
  'aufmachen',
  'starten',
  'gehen',
  'wechseln',
  'und',
  'oder',
  'auf',
  'an',
  'doch',
  'mal',
  'jetzt',
  'sofort',
  'im',
  'in',
  'fuer',
  'ist',
  'hat',
  'kannst',
  'koennen',
  'du',
]);

const MAX_NAME_WORDS = 6;

/**
 * A number said as a word ("Enabler drei"): a speech recognizer often writes
 * the word and not the digit. Up to twenty, "ein" and "eine" are left out on
 * purpose (they are articles).
 */
const NUMBER_WORDS: Readonly<Record<string, string>> = {
  eins: '1',
  zwei: '2',
  drei: '3',
  vier: '4',
  fuenf: '5',
  sechs: '6',
  sieben: '7',
  acht: '8',
  neun: '9',
  zehn: '10',
  elf: '11',
  zwoelf: '12',
  dreizehn: '13',
  vierzehn: '14',
  fuenfzehn: '15',
  sechzehn: '16',
  siebzehn: '17',
  achtzehn: '18',
  neunzehn: '19',
  zwanzig: '20',
};
const NUMBER_WORD_PATTERN = Object.keys(NUMBER_WORDS)
  .sort((a, b) => b.length - a.length)
  .join('|');

/**
 * The number or the name that follows the word of a content type ("enabler",
 * "use case") in the folded text, or null if the person named neither.
 */
function referenceAfter(
  text: string,
  keyword: 'enabler' | 'use[ -]?case'
): ContentReference | null {
  // "Enabler 3", "Enabler Nummer 3", "Enabler E3" and the spoken "Enabler e
  // drei": an optional "nr", "nummer", "no", "#" or "e" in front of the number
  const numberMatch = new RegExp(
    `\\b${keyword}\\s*(?:(?:nr|nummer|no|#|ee?)\\s*)?(\\d+[a-z]?(?:\\.\\d+)*)(?![a-z0-9])`
  ).exec(text);
  if (numberMatch) return { number: numberMatch[1] };
  // a number word must stand alone: "drei" yes, "Drei-Schichten-Modell" no
  const wordMatch = new RegExp(
    `\\b${keyword}\\s*(?:(?:nr|nummer|no|ee?)\\s*)?(${NUMBER_WORD_PATTERN})(?![a-z0-9-])`
  ).exec(text);
  if (wordMatch) return { number: NUMBER_WORDS[wordMatch[1]] };

  const nameMatch = new RegExp(`\\b${keyword}\\s+(.+)$`).exec(text);
  if (!nameMatch) return null;
  // "mit dem Namen X" and "namens X" name the record on purpose
  const rest = nameMatch[1].replace(/^(?:mit\s+dem\s+namen|namens)\s+/, '');
  const words = rest.split(' ');
  while (words.length > 0 && LEADING_FILLER.has(words[0])) words.shift();
  if (words.length === 0 || TOPIC_PREPOSITION.has(words[0])) return null;
  const kept: string[] = [];
  for (const word of words) {
    if (NAME_STOP.has(word)) break;
    kept.push(word);
    if (kept.length >= MAX_NAME_WORDS) break;
  }
  const name = kept.join(' ').trim();
  return name.length >= 3 ? { name } : null;
}

/** "starte das Quiz von Enabler 3": a verb of starting counts for a quiz of an enabler only. */
function isStartOfEnablerQuiz(text: string): boolean {
  return (
    /\bstart\w*/.test(text) &&
    /\benabler\b/.test(text) &&
    /\bquiz\w*\b/.test(text)
  );
}

function isShortDirection(text: string): boolean {
  return (
    text.split(' ').length <= SHORT_DIRECTION_MAX_WORDS &&
    SHORT_DIRECTION.test(text)
  );
}

function hasCue(text: string): boolean {
  return (
    CUE_PATTERNS.some(pattern => pattern.test(text)) ||
    isShortDirection(text) ||
    isStartOfEnablerQuiz(text)
  );
}

/** The question for the way ("wo finde ich", "wie komme ich", "wo geht es weiter"). */
const WAY_QUESTION =
  /\b(?:wo|wohin)\s+(?:\w+\s+){0,2}(?:finde|sehe|ist|sind|liegt|liegen|geht|gehts|kann|muss|soll)\b|\bwie\s+(?:komme|geht|gehts|kann|finde|gelange)\b|\bwas\s+(?:soll|sollte|kann|muss|lerne|mache|bearbeite)\b|\bnaechste[nrms]?\s+(?:schritt|enabler|lektion|lerneinheit)\b/;

/** A clear command to go somewhere: the verb says "do it", not "show me" or "where". */
const DIRECT_PATTERNS: readonly RegExp[] = [
  /\boeffn\w*/,
  /\b(?:geh|gehe|gehen|gehst|geht)\s+(?:\w+\s+){0,2}(?:zu|zum|zur|auf|in|ins)\b/,
  /\b(?:bring|bringe|bringst|fuehr|fuehre|fuehrst|leit|leite|leitest)\s+(?:\w+\s+)?(?:mich|uns)\b/,
  /\bmich\b(?:\s+\w+){0,5}\s+(?:bringen|fuehren|leiten|weiterleiten|navigieren|schicken|lotsen)\b/,
  /\b(?:navigier|spring|wechsl|wechsel)\w*/,
  /\b(?:mach|mache|machst|ruf|rufe|rufst)\b(?:\s+\w+){0,4}\s+auf\b/,
  /\b(?:aufrufen|aufmachen)\b/,
  /\b(?:nimm|nehm\w*)\s+(?:\w+\s+)?(?:mich|uns)\s+(?:\w+\s+)?mit\b/,
  /\blass\s+(?:uns|mich)\b(?:\s+\w+){0,4}\s+(?:gehen|wechseln|oeffnen|springen|navigieren)\b/,
  /\b(?:moechte|will|moecht)\s+(?:\w+\s+){0,2}(?:zu|zum|zur)\b/,
  // "weiter lernen", "mit dem Lernen weiter": the command to go on
  /\bweiter\s?lernen\b/,
  /\bmit\s+dem\s+lernen\s+weiter\w*/,
];

/**
 * Whether the message is a clear command to go somewhere ("Öffne den
 * Ausbildungsnachweis", "Bring mich zum Dashboard", "Geh zu den Quizzen", "Ich
 * will zum Kalender", "Ich will weiterlernen") and not a question for the way
 * ("Wo finde ich ..."), a softer wish ("Zeig mir ...", "Ich möchte ... sehen")
 * or a bare name. The server opens the page right away for a command and offers
 * it with a button for the rest.
 *
 * Only about HOW it was said: whether the page may be opened at all is decided
 * by resolve.ts.
 */
export function isDirectCommand(message: string): boolean {
  if (typeof message !== 'string') return false;
  const text = foldText(message);
  if (!text || text.length > MAX_LENGTH) return false;
  if (WAY_QUESTION.test(text)) return false;
  return (
    DIRECT_PATTERNS.some(pattern => pattern.test(text)) ||
    isShortDirection(text) ||
    isStartOfEnablerQuiz(text)
  );
}

/**
 * The navigation request in a message, or null when there is none.
 */
export function detectNavigationIntent(
  message: string
): NavigationIntent | null {
  if (typeof message !== 'string') return null;
  const text = foldText(message);
  if (!text || text.length > MAX_LENGTH) return null;

  if (CONTINUE_PATTERNS.some(pattern => pattern.test(text))) {
    return { kind: 'continue' };
  }

  if (NOT_A_COMMAND.test(text)) return null;
  if (!hasCue(text)) return null;

  const mentionsEnabler = /\benabler\b/.test(text);
  if (mentionsEnabler) {
    const ref = referenceAfter(text, 'enabler');
    if (!ref) return null;
    return /\bquiz\w*\b/.test(text)
      ? { kind: 'enabler_quiz', ref }
      : { kind: 'enabler', ref };
  }

  if (/\buse[ -]?case\b/.test(text)) {
    const ref = referenceAfter(text, 'use[ -]?case');
    return ref ? { kind: 'use_case', ref } : null;
  }

  for (const [target, pattern] of TARGET_PATTERNS) {
    if (pattern.test(text)) return { kind: 'static', target };
  }

  // A clear command to open "a page" that is none of ours: it is answered with
  // "that page is not known" (no question of rights) instead of going to the
  // model. Narrow on purpose: a short text, the word "Seite" right after the
  // verb, and not a page number ("Seite 5").
  if (text.length <= UNKNOWN_PAGE_MAX_LENGTH && UNKNOWN_PAGE.test(text)) {
    return { kind: 'unknown_page' };
  }
  return null;
}
