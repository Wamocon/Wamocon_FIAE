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
  | { kind: 'enabler_quiz'; ref: ContentReference };

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
];

/**
 * Words that make a message something else: a request for a solution or an
 * explanation, a content question, a question for numbers or dates. Such a
 * message stays with the pipeline.
 */
const NOT_A_COMMAND =
  /\b(?:\w*loesung\w*|\w*antwort\w*|erklaer\w*|was\s+ist|was\s+sind|wie\s+funktioniert|warum|wieso|weshalb|schreib\w*|programmier\w*|code|beispiel\w*|zusammenfass\w*|uebersetz\w*|wie\s?viel\w*|anzahl|status|stand|fortschritt|note|noten|ergebnis\w*|wann|welche[rsmn]?)\b/;

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
  ['statistics', /\b(?:statistik\w*|inhaltsstatistik|auswertung\w*)\b/],
  ['calendar', /\b(?:blockkalender|schulkalender|kalender)\b/],
  ['school', /\b(?:berufsschul\w*|schulbereich|schule)\b/],
  ['organizations', /\b(?:organisation\w*|mandanten)\b/],
  ['users', /\b(?:benutzer\w*|nutzerverwaltung|nutzer\s+verwalten)\b/],
  [
    'activity_reports',
    /\b(?:berichtsheft\w*|taetigkeitsnachweis\w*|ausbildungsnachweis\w*|wochenbericht\w*|berichte[n]?|bericht|nachweise[n]?)\b/,
  ],
  ['trainees', /\b(?:auszubildende[nr]?|azubis|azubi-?verwaltung|trainees)\b/],
  ['profile', /\b(?:profil\w*)\b/],
  ['dashboard', /\b(?:dashboard|startseite|startbildschirm)\b/],
];

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
 * The number or the name that follows the word of a content type ("enabler",
 * "use case") in the folded text, or null if the person named neither.
 */
function referenceAfter(
  text: string,
  keyword: 'enabler' | 'use[ -]?case'
): ContentReference | null {
  const numberMatch = new RegExp(
    `\\b${keyword}\\s*(?:nr|nummer|no|#)?\\s*(\\d+[a-z]?(?:\\.\\d+)*)(?![a-z0-9])`
  ).exec(text);
  if (numberMatch) return { number: numberMatch[1] };

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
  if (!CUE_PATTERNS.some(pattern => pattern.test(text))) return null;

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
  return null;
}
