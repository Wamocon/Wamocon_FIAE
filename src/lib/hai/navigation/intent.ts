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
import {
  extractFileNameKeys,
  normalizeFileKey,
  type FileNameKey,
} from '../documentNames';
import type { StaticTargetId } from './targets';

/** What the person said about an enabler or a use case: a number or a name. */
export interface ContentReference {
  /** "3", "1a", "5.3": as said, compared with the code and the title. */
  number?: string;
  /** Words of the name, folded, at most six. */
  name?: string;
}

/** A record that holds documents: an enabler or a use case. */
export type ContentType = 'enabler' | 'use_case';

/** Which documents a word asks for: any file, a teaching text, a scenario, a task. */
export type DocKind = 'any' | 'theory' | 'scenario' | 'task';

/** The enabler or use case a document request names. */
export interface ContentParent {
  type: ContentType;
  ref: ContentReference;
}

export type NavigationIntent =
  | { kind: 'static'; target: StaticTargetId }
  /** A course by number or name ("den Kurs Datenbanken"), without a name the page "Lernen". */
  | { kind: 'course'; ref: ContentReference }
  /**
   * A document: of a named enabler or use case (parent), by its file name, or
   * "this one" (demonstrative: the page the person is on, or the last turns).
   */
  | {
      kind: 'document';
      docKind: DocKind;
      parent: ContentParent | null;
      fileKeys: FileNameKey[];
      demonstrative: boolean;
    }
  /**
   * A clear command to open something that matches no page: answered by the
   * platform with the nearest pages as cards, never by the model.
   */
  | { kind: 'unmatched'; query: string }
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
  /\b(?:wie\s+oeffne|\w*loesung\w*|\w*antwort\w*|erklaer\w*|was\s+ist|was\s+sind|wie\s+funktioniert|warum|wieso|weshalb|schreib\w*|programmier\w*|code|beispiel\w*|zusammenfass\w*|uebersetz\w*|wie\s?viel\w*|anzahl|status|stand|fortschritt|note|noten|ergebnis\w*|wann|welche[rsmn]?|fehler|problem\w*|falsch\w*|kaputt|hilfe|hilf\w*)\b/;

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
  // the weekly evaluations (after the open reviews: "offene Bewertungen" is the review list)
  [
    'evaluations',
    /\b(?:wochenbewertung\w*|leistungsbewertung\w*|selbstbewertung\w*|selbsteinschaetzung\w*|bewertungen)\b/,
  ],
  ['certificate', /\b(?:arbeitszeugnis\w*|zeugnis\w*)\b/],
  ['hai_memory', /\b(?:hai\s?-?\s?gedaechtnis|gedaechtnis\s?verwaltung)\b/],
  ['hai_admin', /\b(?:hai\s?-?\s?verwaltung|hai\s?-?\s?admin\w*)\b/],
  [
    'content_upload',
    /\b(?:inhalts\s?-?\s?import|inhaltsimport|content\s?-?\s?upload|inhalte\s+(?:importieren|hochladen))\b/,
  ],
  [
    'content_management',
    /\b(?:inhaltsverwaltung|inhalte\s+verwalten|content\s?-?\s?management|kursverwaltung|modulverwaltung)\b/,
  ],
  ['quizzes', /\b(?:quiz|quizze|quizzen|quiz\s?-?\s?verwaltung)\b/],
  // the menu entry "Lernen" of a trainee: "meine Kurse", "zum Lernen"
  [
    'courses',
    /\b(?:kurse[nrs]?|lernbereich\w*|lernseite|lernstoff|lerninhalte?|lernmodule?|zum\s+lernen|(?:bereich|menuepunkt|rubrik|reiter)\s+lernen)\b/,
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
  // the menu entry "Auszubildende" and the words trainers use for it:
  // "Auszubildenden-Übersicht", "Azubi-Übersicht", "Azubiliste", "meine Azubis"
  [
    'trainees',
    /\b(?:auszubildende[nr]?|azubis|azubi-?\s?(?:verwaltung|uebersicht|liste|seite|bereich)|azubiliste|trainees|lehrlinge)\b/,
  ],
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
  keyword: string
): ContentReference | null {
  // "Enabler 3", "Enabler Nummer 3", "Enabler E3" and the spoken "Enabler e
  // drei": an optional "nr", "nummer", "no", "#" or "e" in front of the number
  const numberMatch = new RegExp(
    `\\b(?:${keyword})\\s*(?:(?:nr|nummer|no|#|ee?)\\s*)?(\\d+[a-z]?(?:\\.\\d+)*)(?![a-z0-9])`
  ).exec(text);
  if (numberMatch) return { number: numberMatch[1] };
  // a number word must stand alone: "drei" yes, "Drei-Schichten-Modell" no
  const wordMatch = new RegExp(
    `\\b(?:${keyword})\\s*(?:(?:nr|nummer|no|ee?)\\s*)?(${NUMBER_WORD_PATTERN})(?![a-z0-9-])`
  ).exec(text);
  if (wordMatch) return { number: NUMBER_WORDS[wordMatch[1]] };

  const nameMatch = new RegExp(`\\b(?:${keyword})\\s+(.+)$`).exec(text);
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

/** The folded text asks for the way ("wo finde ich", "wie komme ich dahin"), no command. */
export function isWayQuestion(foldedText: string): boolean {
  return WAY_QUESTION.test(foldedText);
}

/**
 * All static targets a text names (menu names and words for them), in the order
 * of the priority list, each once. No cue is needed: it is used on the earlier
 * messages of a conversation to find the page that was talked about.
 */
export function mentionedTargets(message: string): StaticTargetId[] {
  if (typeof message !== 'string') return [];
  const text = foldText(message);
  if (!text) return [];
  return TARGET_PATTERNS.filter(([, pattern]) => pattern.test(text)).map(
    ([target]) => target
  );
}

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
  // "lies das Dokument X": reading is a command next to a document word
  /\blies\b(?!.*\bvor\b)/,
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

// ============================================================================
// DOCUMENTS, COURSES AND UNMATCHED COMMANDS
// ============================================================================

/** The words for a record that holds documents, with the pattern the reference follows. */
const ENABLER_WORDS = 'enabler|themenkreis(?:e|en)?';
const USE_CASE_WORDS =
  'use[ -]?cases?|usecases?|anwendungsfall|anwendungsfaelle';
const COURSE_WORDS = 'kurs|modul';

/**
 * The words for documents, in the order of priority (a scenario beats a plain
 * "PDF"). Folded text. "Dokumentation" is not a document word.
 */
const DOC_NOUNS: ReadonlyArray<readonly [DocKind, string]> = [
  ['scenario', 'szenari(?:o|en|os|um)'],
  [
    'task',
    'aufgabe|aufgaben|aufgabenstellung(?:en)?|uebung(?:en|sblatt|sblaetter)?',
  ],
  [
    'theory',
    'lehrtext\\w*|lerntext\\w*|theorie(?:text|dokument|unterlage\\w*)?|skript\\w*|unterlage|unterlagen|material|materialien|handout\\w*|lernunterlage\\w*',
  ],
  [
    'any',
    'dokument(?:e|en|s)?|datei(?:en|name|namen)?|pdfs?|anhang|anhaenge\\w*',
  ],
];
const ALL_DOC_NOUNS = DOC_NOUNS.map(([, source]) => source).join('|');

/**
 * The document words in the singular. "diese Datei" points at one file, a plural
 * ("die Szenarien", "die Dokumente") asks for a list, which the file questions
 * of the pipeline answer.
 */
const SINGULAR_DOC_NOUNS =
  'szenario|aufgabe|aufgabenstellung|uebung|uebungsblatt|lehrtext|lerntext|theorietext|skript|unterlage|material|handout|lernunterlage|dokument|datei|pdf|anhang';

/** "Lies das Dokument X": reading is a cue next to a document word (not "lies mir vor"). */
const READ_CUE = /\b(?:lies|lese|lesen)\b(?!.*\bvor\b)/;

/**
 * "diese Datei", "das PDF", "das Szenario dazu", "meine Unterlage hier": a
 * document word that ends the sentence (ignoring small filler words), with an
 * article or "dieses" before it. Without a named record or file this means "the
 * one of the page, or of the last turns".
 */
const DEMONSTRATIVE = new RegExp(
  `\\b(?:diese[rnms]?|dies|das|die|der|den|dem|mein\\w*)\\s+(?:\\w+\\s+)?(?:${SINGULAR_DOC_NOUNS})(?:\\s+(?:hier|dazu|davon|dort|bitte|mal|jetzt|sofort|auf|an|noch\\s?mal|nochmal|auch|bitte))*$`
);

/**
 * A short follow-up about the record of the last turns without a verb: "und das
 * PDF dazu", "das Szenario dazu bitte". Only a document word and "dazu" (or
 * "davon", "hierzu", "dort") count, nothing longer.
 */
const FOLLOW_DOCUMENT = new RegExp(
  `^(?:(?:und|dann|bitte|noch|auch|jetzt|mal)\\s+)*(?:das|die|den)\\s+(?:${SINGULAR_DOC_NOUNS})\\s+(?:dazu|davon|hierzu|dort)(?:\\s+(?:bitte|mal|jetzt|noch))*$`
);

function firstDocKind(text: string): DocKind | null {
  for (const [kind, source] of DOC_NOUNS) {
    if (new RegExp(`\\b(?:${source})\\b`).test(text)) return kind;
  }
  return null;
}

function firstIndexOf(text: string, source: string): number {
  const found = new RegExp(`\\b(?:${source})\\b`).exec(text);
  return found ? found.index : -1;
}

/**
 * The file name in a document request. A message that names an enabler or use
 * case holds a file name only with an extension or an underscore ("zu Enabler 3
 * die Datei Skript_3.pdf"), else the words of its title would count as a file
 * name. A scenario code ("Szenario K14-i", "Szenario 14i") is a name too.
 */
function fileKeysOf(
  message: string,
  text: string,
  hasParent: boolean
): FileNameKey[] {
  const keys: FileNameKey[] = [];
  const explicit = /\.[a-z0-9]{2,5}\b|_/i.test(message);
  if (!hasParent || explicit) keys.push(...extractFileNameKeys(message));
  const code =
    /\bszenari(?:o|en|os)\s+(k?\d+[a-z]?(?:\s?-\s?[a-z])?)(?![a-z0-9])/.exec(
      text
    );
  if (code) {
    const key = normalizeFileKey(`szenario ${code[1]}`);
    if (key && !keys.some(existing => existing.key === key)) {
      keys.push({ key, partial: true });
    }
  }
  return keys.slice(0, 12);
}

/**
 * A document request: of an enabler or use case ("das Szenario zu Enabler 3",
 * "PDF zum Use Case Bestellsystem"), by file name ("das Dokument
 * Szenario_14i"), or "this one" ("diese Datei", "das PDF dazu").
 *
 * An enabler whose TITLE holds a document word ("Enabler Szenario Planung") is
 * still an enabler: a document word after the name of the record is part of the
 * name, only a number may be followed by it ("Enabler 3 Szenario").
 */
function detectDocumentIntent(
  text: string,
  message: string
): NavigationIntent | null {
  const docKind = firstDocKind(text);
  if (!docKind) return null;
  const docIndex = firstIndexOf(text, ALL_DOC_NOUNS);

  let parent: ContentParent | null = null;
  const enablerAt = firstIndexOf(text, ENABLER_WORDS);
  const useCaseAt = firstIndexOf(text, USE_CASE_WORDS);
  const kind: ContentType | null =
    enablerAt >= 0 && (useCaseAt < 0 || enablerAt < useCaseAt)
      ? 'enabler'
      : useCaseAt >= 0
        ? 'use_case'
        : null;
  if (kind) {
    const ref = referenceAfter(
      text,
      kind === 'enabler' ? ENABLER_WORDS : USE_CASE_WORDS
    );
    const keywordAt = kind === 'enabler' ? enablerAt : useCaseAt;
    // the document word after the keyword is part of a title, not a request for
    // a document, unless the reference is a number
    if (ref && docIndex > keywordAt && !ref.number) return null;
    if (ref) parent = { type: kind, ref };
  }

  const fileKeys = fileKeysOf(message, text, parent !== null);
  const demonstrative =
    !parent && fileKeys.length === 0 && DEMONSTRATIVE.test(text);
  if (!parent && fileKeys.length === 0 && !demonstrative) return null;
  return { kind: 'document', docKind, parent, fileKeys, demonstrative };
}

/** The verbs of an unmatched command (a command, never a question or a wish). */
const UNMATCHED_CUE =
  /\boeffn\w*|\b(?:geh|gehe|gehen)\s+(?:\w+\s+){0,2}(?:zu|zum|zur|auf|in|ins)\b|\b(?:bring|bringe|fuehr|fuehre|leit|leite)\s+(?:\w+\s+)?(?:mich|uns)\s+(?:\w+\s+)?(?:zu|zum|zur|in|ins|auf)\b|\bnavigier\w*|\b(?:mach|mache|ruf|rufe)\b(?:\s+\w+){0,4}\s+auf\b|\baufrufen\b/;

/**
 * Words that carry no target: an article, a pronoun, "Seite", a verb of going, a
 * filler. A command with only these ("öffne die Seite", "bring mich dahin") is a
 * follow-up that the history resolves, not an unknown page.
 */
const EMPTY_OBJECT_WORDS = new Set([
  ...LEADING_FILLER,
  'seite',
  'sie',
  'es',
  'dort',
  'dahin',
  'dorthin',
  'hin',
  'mich',
  'uns',
  'mir',
  'doch',
  'jetzt',
  'dann',
  'sofort',
  'noch',
  'ein',
  'eine',
  'einen',
  'zum',
  'zur',
  'auf',
  'ins',
  'du',
  'kannst',
  'oeffne',
  'oeffnen',
  'geh',
  'gehe',
  'gehen',
  'bring',
  'bringe',
  'fuehr',
  'fuehre',
  'leit',
  'leite',
  'navigier',
  'navigiere',
  'mach',
  'mache',
  'ruf',
  'rufe',
  'aufrufen',
  'bitte',
]);

/**
 * Whether a command to open something names something: at least one word that is
 * no filler, no idiom ("geh auf meine Frage ein") and no path or address (a made
 * up path never becomes a request, it stays with the pipeline).
 */
function namesSomething(text: string): boolean {
  if (/[/\\]|:\/\/|\bwww\b/.test(text)) return false;
  if (/\bgeh\w*\b.*\bein\b/.test(text)) return false;
  if (/\b(?:frage|fragen)\b/.test(text)) return false;
  return text
    .split(' ')
    .some(word => word.length >= 3 && !EMPTY_OBJECT_WORDS.has(word));
}

/** What stands after the keyword is no name (empty or a filler): "Öffne den Enabler". */
function isBareKeyword(text: string, keyword: string): boolean {
  const rest = new RegExp(`\\b(?:${keyword})\\s*(.*)$`).exec(text)?.[1] ?? '';
  const words = rest
    .split(' ')
    .filter(word => word && !LEADING_FILLER.has(word) && !NAME_STOP.has(word));
  return words.length === 0;
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

  const blocker = NOT_A_COMMAND.exec(text);
  if (blocker) {
    // The word "Lösung" alone does not block a command that names a FILE
    // ("Öffne das Dokument UC_1b_Musterloesung"): the file questions and the
    // access rules answer it, a trainee gets the neutral "keine passende Datei".
    // A request for the solution itself ("zeig mir die Lösung") has no file name
    // and stays with the solution protection of the pipeline.
    const onlySolutionWord = /loesung/.test(blocker[0]);
    const explicitFile = /.[a-z0-9]{2,5}|_/i.test(message);
    if (!(onlySolutionWord && explicitFile && firstDocKind(text))) return null;
  }
  if (
    !hasCue(text) &&
    !(READ_CUE.test(text) && firstDocKind(text)) &&
    !FOLLOW_DOCUMENT.test(text)
  ) {
    return null;
  }

  // documents first: "das Szenario zu Enabler 3" is a document of the enabler
  const document = detectDocumentIntent(text, message);
  if (document) return document;

  if (new RegExp(`\\b(?:${ENABLER_WORDS})\\b`).test(text)) {
    const ref = referenceAfter(text, ENABLER_WORDS);
    if (!ref) {
      // "Öffne den Enabler" without a name: the platform asks, no model call
      return UNMATCHED_CUE.test(text) && isBareKeyword(text, ENABLER_WORDS)
        ? { kind: 'unmatched', query: text }
        : null;
    }
    return /\bquiz\w*\b/.test(text)
      ? { kind: 'enabler_quiz', ref }
      : { kind: 'enabler', ref };
  }

  if (new RegExp(`\\b(?:${USE_CASE_WORDS})\\b`).test(text)) {
    const ref = referenceAfter(text, USE_CASE_WORDS);
    if (ref) return { kind: 'use_case', ref };
    return UNMATCHED_CUE.test(text) && isBareKeyword(text, USE_CASE_WORDS)
      ? { kind: 'unmatched', query: text }
      : null;
  }

  // a course by number or name ("den Kurs Datenbanken", "zum Modul 2"); the
  // plural ("meine Kurse") and a course without a name are the page "Lernen"
  if (new RegExp(`\\b(?:${COURSE_WORDS})\\b`).test(text)) {
    return { kind: 'course', ref: referenceAfter(text, COURSE_WORDS) ?? {} };
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

  // Any other clear command to open something ("Öffne den Kalender der
  // Kantine"): the platform answers with the nearest pages as cards. A
  // recognized request never goes to the model without an answer of the platform.
  if (
    text.length <= UNKNOWN_PAGE_MAX_LENGTH &&
    UNMATCHED_CUE.test(text) &&
    namesSomething(text)
  ) {
    return { kind: 'unmatched', query: text };
  }
  return null;
}
