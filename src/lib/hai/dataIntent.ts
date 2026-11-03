/**
 * Data intent of a message of the HAI: which live data of the platform a
 * question asks for (progress, calendar, trainees of a trainer and so on).
 *
 * Pure module without database access, so the pipeline can classify a turn
 * before it loads anything (a question about the own trainees needs no
 * knowledge search and no source cards). Moved here from dataContext.ts, which
 * re-exports everything, so every existing import keeps working.
 *
 * @module lib/hai/dataIntent
 */

import { isLearningTechniqueQuestion } from './learningTechniques/detect';
import { foldUmlauts, isDayBriefingMessage } from './dayQuestion';
import { isDocumentQuestion } from './documentQuery';
import { foldText } from './navigation/fold';

export type UserRole = 'TRAINER' | 'TRAINEE';

export type DataIntent =
  | 'progress_query' // "Wie ist mein Fortschritt?"
  | 'calendar_query' // "Wann habe ich Berufsschule?"
  | 'exam_query' // "Wann ist meine naechste Pruefung?"
  | 'exam_results_query' // "Welche Note habe ich?" / "Habe ich bestanden?"
  | 'report_query' // "Wie ist der Stand meiner Nachweise?"
  | 'submission_query' // "Was habe ich abgegeben?" / "Welche Abgaben sind offen?"
  | 'use_case_query' // "Welche Use Cases habe ich erledigt?"
  | 'notification_query' // "Habe ich neue Benachrichtigungen?"
  | 'review_query' // Trainer: "Was muss ich bewerten?"
  | 'trainee_overview' // Trainer: "Wie stehen meine Azubis?"
  | 'trainee_detail_query' // Trainer: "Wie steht [Name]?" / "Noten von [Name]"
  | 'learning_query' // Trainee: tips on learning (quiz scores, next exams)
  | 'day_briefing' // "Was steht heute an?" / "Guten Morgen" (day companion)
  | 'document_query' // "Welche Dateien hat dieser Enabler?" / "Wie heisst die Datei?"
  | 'none'; // No data intent detected

// ============================================================================
// DATA INTENT CLASSIFIER
// ============================================================================

// Broadened keyword sets for intent classification (natural German phrasing)
const KW_PROGRESS = [
  'fortschritt',
  'wie weit',
  'status',
  'abgeschlossen',
  'erledigt',
  'progress',
  'geschafft',
  'wie viel',
  'noch offen',
  'wie stehe ich',
  'mein stand',
  'schaffe ich',
  'bin ich fertig',
  'komme ich voran',
  'was fehlt noch',
];
const KW_CALENDAR = [
  'kalender',
  'woche',
  'berufsschule',
  'schulblock',
  'betrieb',
  'urlaub',
  'ferien',
  'wann habe ich',
  'naechste woche',
  'diese woche',
  'block',
  'zeitplan',
  'stundenplan',
  'schultag',
  'frei',
  'wann bin ich',
];
const KW_EXAM_RESULTS = [
  'note',
  'noten',
  'bestanden',
  'durchgefallen',
  'ergebnis',
  'punkte',
  'prozent',
  'wie habe ich abgeschnitten',
  'klausurergebnis',
  'pruefungsergebnis',
  'zeugnis',
  'welche note',
  'meine noten',
  'notenspiegel',
  'notenuebersicht',
  'schnitt',
];
const KW_EXAM = [
  'pruefung',
  'klausur',
  'ihk',
  'abschlusspruefung',
  'examen',
  'naechste pruefung',
  'wann schreibe ich',
  'ap1',
  'ap2',
  'teil 1',
  'teil 2',
  'zwischenpruefung',
  'pruefungstermin',
];
const KW_SUBMISSION = [
  'abgabe',
  'abgaben',
  'eingereicht',
  'einreichung',
  'submission',
  'abgegeben',
  'was habe ich abgegeben',
  'feedback',
  'bewertung meiner',
  'rueckmeldung',
  'rückmeldung',
  'meine loesung',
  'meine abgabe',
  'korrektur',
  'bewertet',
];
const KW_USE_CASE = [
  'use case',
  'use-case',
  'usecase',
  'fallstudie',
  'praktische aufgabe',
  'praxisaufgabe',
];
const KW_REPORT = [
  'nachweis',
  'taetigkeitsnachweis',
  'bericht',
  'berichtsheft',
  'wochenbericht',
  'activity report',
  'nachweise',
  'ausbildungsnachweis',
  'wie viele berichte',
  'taetigkeit',
];
const KW_NOTIFICATION = [
  'benachrichtigung',
  'neuigkeiten',
  'notification',
  'neue nachrichten',
  'was gibt es neues',
  'updates',
  'ungelesen',
  'inbox',
];
const KW_REVIEW = [
  'bewerten',
  'ausstehend',
  'korrigieren',
  'review',
  'eingereicht',
  'submissions',
  'pruefe',
  'zu bewerten',
  'offene abgaben',
  'pending',
  'was muss ich',
];
// The day at a glance (day companion, voice or chat) is recognized by dayQuestion.ts:
// fixed phrases and natural questions about the own tasks, with folded umlauts. It is
// checked first: "was muss ich heute" would otherwise land in the review list of the
// trainers.

/** Lower case with ae, oe, ue, ss: a spoken or typed "für" meets the keyword "fuer". */
export { foldUmlauts };

const KW_OVERVIEW = [
  'ueberblick',
  'meine azubis',
  'wie stehen',
  'fortschritt meiner',
  'alle azubis',
  'azubi-uebersicht',
  'meine auszubildenden',
];

// ============================================================================
// NAME EXTRACTION (for trainer → trainee queries)
// ============================================================================

/**
 * Words that are no names (folded: lower case, ae oe ue ss): question and
 * command words, pronouns, small words and the generic nouns of a trainer's
 * question ("Azubis", "Dateien", "Woche"). Matched as a whole word.
 */
const NOT_NAMES = new Set([
  // question and command words, greetings
  'wie',
  'was',
  'wer',
  'wem',
  'wen',
  'wessen',
  'wo',
  'wann',
  'warum',
  'wieso',
  'weshalb',
  'wohin',
  'welche',
  'welcher',
  'welchen',
  'welchem',
  'welches',
  'zeig',
  'zeige',
  'zeigst',
  'liste',
  'gib',
  'gibt',
  'gebe',
  'nenne',
  'nenn',
  'sag',
  'sage',
  'sagst',
  'kannst',
  'koennte',
  'koenntest',
  'kann',
  'bitte',
  'hallo',
  'hi',
  'hey',
  'danke',
  'guten',
  'morgen',
  'tag',
  'abend',
  'moin',
  'ok',
  'okay',
  'dann',
  'also',
  'und',
  'oder',
  'aber',
  'nicht',
  'auch',
  'noch',
  'schon',
  'mal',
  'nur',
  'ja',
  'nein',
  'wenn',
  'dass',
  'weil',
  'ob',
  // small words, pronouns, verbs
  'hat',
  'von',
  'der',
  'die',
  'das',
  'ist',
  'bei',
  'mit',
  'nach',
  'sich',
  'den',
  'dem',
  'des',
  'ein',
  'eine',
  'einem',
  'einen',
  'einer',
  'eines',
  'habe',
  'haben',
  'hast',
  'wird',
  'sind',
  'sein',
  'seine',
  'war',
  'waren',
  'ich',
  'mir',
  'mich',
  'mein',
  'meine',
  'meinen',
  'meinem',
  'meiner',
  'meines',
  'du',
  'dir',
  'dich',
  'wir',
  'uns',
  'sie',
  'ihr',
  'ihm',
  'ihn',
  'es',
  'man',
  'alle',
  'allen',
  'aller',
  'alles',
  'jede',
  'jeder',
  'jeden',
  'viele',
  'wieviele',
  'stand',
  'status',
  'liste',
  'listen',
  'uebersicht',
  'ueberblick',
  'name',
  'namen',
  'person',
  'personen',
  'leute',
  'frage',
  'fragen',
  'trainer',
  'admin',
  'chef',
  'herr',
  'frau',
  // nouns of the platform and of the training
  'note',
  'noten',
  'use',
  'case',
  'cases',
  'progress',
  'enabler',
  'enablern',
  'quiz',
  'quizze',
  'klausur',
  'klausuren',
  'schulblock',
  'block',
  'bloecke',
  'blocks',
  'woche',
  'wochen',
  'jahr',
  'jahre',
  'jahren',
  'monat',
  'monate',
  'phase',
  'phasen',
  'kurs',
  'kurse',
  'kursen',
  'schule',
  'betrieb',
  'datei',
  'dateien',
  'pdf',
  'pdfs',
  'anhang',
  'anhaenge',
  'unterlage',
  'unterlagen',
  'fortschritt',
  'abgaben',
  'abgabe',
  'berichte',
  'bericht',
  'ergebnis',
  'ergebnisse',
  'pruefung',
  'pruefungen',
  'kalender',
  'termin',
  'termine',
  'beruf',
  'berufe',
  'fiae',
  'kfbm',
  'fachinformatiker',
]);

/**
 * Stems of generic nouns, also as the start of a compound ("Azubiliste",
 * "Berufsschulblock"): a capitalized word that starts with one is no name. No
 * short stems here, a surname like "Block" stays possible.
 */
const NOT_NAME_STEMS = [
  'azubi',
  'auszubildend',
  'trainee',
  'lehrling',
  'ausbildung',
  'dokument',
  'abgabe',
  'bericht',
  'pruefung',
  'beruf',
  'enabler',
  'fortschritt',
  'datei',
  'unterlage',
  'kalender',
  'nachweis',
  'taetigkeit',
  'ergebnis',
  'uebersicht',
  'ueberblick',
  'berufsschul',
  'anwendungsentwicklung',
];

const NAME_WORD = '[A-ZÄÖÜ][a-zäöüß]{2,}(?:-[A-ZÄÖÜ][a-zäöüß]{2,})?';
const NAME_WORD_RE = new RegExp(`^${NAME_WORD}$`);
const PREP_NAME_RE = new RegExp(
  `\\b(?:von|fuer|für|zu|ueber|über)\\s+(${NAME_WORD}(?:\\s+${NAME_WORD})?)`
);

/** True for a word that is a generic noun, a question word or a small word. */
function isNotAName(word: string): boolean {
  const folded = foldUmlauts(word.replace(/[?!.,;:]+$/, ''));
  if (folded.length === 0) return true;
  // "Azubi-Liste" and the like: one generic part is enough
  const parts = folded.split('-');
  return parts.some(
    part =>
      NOT_NAMES.has(part) || NOT_NAME_STEMS.some(stem => part.startsWith(stem))
  );
}

export interface TraineeNameCandidate {
  name: string;
  /**
   * True when the message names a person clearly: first and last name. A
   * single capitalized word, in the middle of a sentence or after "von",
   * "für", "zu", "über", is a weak signal only (every German noun is
   * capitalized, "für Datenbanken" is a topic): it counts as a person only
   * together with a cue like "wie steht" or "Fortschritt" (hasPersonQueryCue).
   */
  strong: boolean;
}

/**
 * Extract a potential trainee name from a trainer's message.
 * Matches patterns like "von Max", "fuer Max Mustermann", "Wie steht Max?".
 * Generic nouns ("Azubis", "Dateien"), question words and the start of a
 * sentence are no names. The result is a candidate only: whether the person
 * exists is decided against the list of the own trainees (findTraineeByName).
 */
export function extractTraineeNameCandidate(
  message: string
): TraineeNameCandidate | null {
  // Pattern 1: "von [Name]" / "fuer [Name]" / "zu [Name]" / "ueber [Name]"
  const prepMatch = message.match(PREP_NAME_RE);
  if (prepMatch) {
    const parts = prepMatch[1].trim().split(/\s+/);
    if (!isNotAName(parts[0])) {
      const second = parts[1];
      if (second && !isNotAName(second)) {
        return { name: `${parts[0]} ${second}`, strong: true };
      }
      // "für Datenbanken" is as likely a topic as a person
      return { name: parts[0], strong: false };
    }
  }

  // Pattern 2: capitalized words that are neither at the start of a sentence
  // nor generic words
  const words = message.split(/\s+/).filter(Boolean);
  for (let i = 1; i < words.length; i++) {
    // the first word after . ! ? is a sentence start, too
    if (/[.!?]$/.test(words[i - 1])) continue;
    const w = words[i].replace(/[?!.,;:]+$/, '');
    if (NAME_WORD_RE.test(w) && !isNotAName(w)) {
      // Check if next word is also capitalized (full name)
      const next = words[i + 1]?.replace(/[?!.,;:]+$/, '');
      if (
        next &&
        !/[.!?,;:]$/.test(words[i]) &&
        NAME_WORD_RE.test(next) &&
        !isNotAName(next)
      ) {
        return { name: `${w} ${next}`, strong: true };
      }
      return { name: w, strong: false };
    }
  }

  return null;
}

/** Kept for the callers that only need the name. */
export function extractPotentialTraineeName(message: string): string | null {
  return extractTraineeNameCandidate(message)?.name ?? null;
}

// ----------------------------------------------------------------------------
// "Which trainees do I have": generic question about the own trainees
// ----------------------------------------------------------------------------

/** Nouns for trainees (folded). "Trainer" is no trainee. */
const TRAINEE_NOUN_RE =
  /\b(azubis?|auszubildende[rnms]?|azubiliste|trainees?|lehrlinge?|schuetzlinge?)\b/;
/** Phrases that ask for the own trainees (folded). */
const TRAINEE_LIST_PHRASES = [
  'zugeordnet',
  'zugewiesen',
  'betreue ich',
  'betreuen ich',
  'wen betreue',
  'wer sind meine',
  'wer ist mir',
  'wie viele azubis',
  'wie viele auszubildende',
  'ausbildungsjahr',
  'welchen beruf',
  'welche berufe',
];

/**
 * Cues that a question is about how a person is doing (folded). A single
 * capitalized word is taken for a name only together with such a cue, so that
 * a technical question of a trainer ("Was ist ein Primärschlüssel?") is no
 * search for a person called "Primärschlüssel".
 */
const PERSON_QUERY_CUES = [
  'wie steht',
  'wie stehen',
  'wie laeuft',
  'wie lief',
  'wie macht',
  'wie geht',
  'wie schlaegt',
  'wie weit',
  'wie gut',
  'wer ist',
  'was macht',
  'fortschritt',
  'stand',
  'status',
  'note',
  'noten',
  'ergebnis',
  'abgabe',
  'abgaben',
  'bericht',
  'berichte',
  'leistung',
  'zeugnis',
  'bewertung',
  'fehlzeiten',
  'urlaub',
  'krank',
  'anwesenheit',
  'info',
  'infos',
  'informationen',
  'details',
  'daten von',
];

/** True when the message reads like a question about a person's progress. */
export function hasPersonQueryCue(message: string): boolean {
  const folded = foldUmlauts(message);
  return PERSON_QUERY_CUES.some(cue =>
    new RegExp(`(^|[^a-z])${cue}([^a-z]|$)`).test(folded)
  );
}

/**
 * A question about the own trainees as a group ("Welche Azubis sind mir
 * zugeordnet?", "Wer sind meine Azubis?", "Wie viele Azubis habe ich?"). Reads
 * the folded text, so spoken text without capitals, umlauts or punctuation
 * counts as well.
 */
export function isTraineeListQuestion(message: string): boolean {
  const folded = foldUmlauts(message);
  if (TRAINEE_NOUN_RE.test(folded)) return true;
  if (TRAINEE_LIST_PHRASES.some(p => folded.includes(p))) return true;
  // the old keyword list, read as before (no folding of umlauts)
  const lower = message.toLowerCase();
  return KW_OVERVIEW.some(k => lower.includes(k));
}

/**
 * Classify the data intent from a user message.
 * Uses German keyword matching to detect when the user asks about live data.
 *
 * @param message - The user's chat message
 * @param userRole - The user's role (TRAINER or TRAINEE)
 * @returns The detected DataIntent
 */
export function classifyDataIntent(
  message: string,
  userRole: UserRole
): DataIntent {
  const lower = message.toLowerCase();

  // The day at a glance, for both roles. Only this recognition reads the message
  // with folded umlauts (a spoken "für" must meet "fuer"); the older lists keep
  // their behavior, so a learning question with the word "Prüfung" stays a
  // learning one.
  if (isDayBriefingMessage(message)) return 'day_briefing';

  // A question about files (names, lists, PDF, extensions): answered from the
  // database with the access rules of the PageIndex (documentQuery.ts). Before
  // the name search of a trainer: "Dateien" is no person.
  if (isDocumentQuestion(message)) return 'document_query';

  // Trainer-only intents first (more specific)
  if (userRole === 'TRAINER') {
    if (KW_REVIEW.some(k => lower.includes(k))) return 'review_query';

    // Two steps. First the generic words are taken out of the candidates
    // ("Azubis", "Dateien", "Welche" are no names). A clear name ("von
    // Anna", "Max Mustermann") is a detail query even when the message
    // also says "Azubi". A single capitalized noun next to a trainee word
    // ("Welche Azubis sind in Datenbanken fit?") is a group question.
    // Whether a person of that name exists is decided against the own
    // trainees in fetchDataContext, a name that is not found there falls
    // back to the overview when the message asks for the group.
    const candidate = extractTraineeNameCandidate(message);
    const listQuestion = isTraineeListQuestion(message);
    // A single capitalized word needs a cue that the question is about how
    // a person is doing, otherwise every capitalized noun would be a search
    // for a person.
    if (
      candidate &&
      (candidate.strong || (!listQuestion && hasPersonQueryCue(message)))
    ) {
      return 'trainee_detail_query';
    }

    // Group question about the own trainees → overview
    if (listQuestion || lower.includes('azubi') || lower.includes('trainee')) {
      return 'trainee_overview';
    }
  }

  // Shared intents (both roles)
  if (KW_PROGRESS.some(k => lower.includes(k))) return 'progress_query';
  if (KW_CALENDAR.some(k => lower.includes(k))) return 'calendar_query';
  if (KW_EXAM_RESULTS.some(k => lower.includes(k))) return 'exam_results_query';
  if (KW_EXAM.some(k => lower.includes(k))) return 'exam_query';
  if (KW_SUBMISSION.some(k => lower.includes(k))) return 'submission_query';
  if (KW_USE_CASE.some(k => lower.includes(k))) return 'use_case_query';
  if (KW_REPORT.some(k => lower.includes(k))) return 'report_query';
  if (KW_NOTIFICATION.some(k => lower.includes(k))) return 'notification_query';

  // Tips on learning and memorizing (package B): the trainee's own quiz
  // scores and upcoming exams, nothing else. Only when no other intent matched.
  if (userRole === 'TRAINEE' && isLearningTechniqueQuestion(message))
    return 'learning_query';

  return 'none';
}

// ============================================================================
// FOLLOW-UP QUESTION ABOUT THE OWN TRAINEES (history of the session)
// ============================================================================

/** A message of the history as the pipeline holds it (role and text parts). */
export interface HistoryTurnMessage {
  role: string;
  parts: ReadonlyArray<{ text: string }>;
}

/** The text of a message of the history. */
export function historyText(message: HistoryTurnMessage): string {
  return message.parts.map(part => part.text).join('');
}

/** A follow-up is short: a long text is a question of its own. */
const FOLLOW_UP_MAX_LENGTH = 70;

/**
 * Follow-up questions to a question about the own trainees that carry no noun
 * for trainees and no name ("Welche mit Namen?", "Wer genau?", "Und wie viele
 * davon sind in der Schule?", "Zeig sie mir", "Die Namen bitte"). Folded text.
 * On their own they mean nothing, only together with the history (see
 * isTraineeFollowUp).
 */
const TRAINEE_FOLLOW_UP_PATTERNS: readonly RegExp[] = [
  /\bmit\s+(?:den\s+)?namen\b/,
  /\b(?:die|deren|ihre|alle|alle\s+die)\s+namen\b/,
  /\bnamen\s+(?:bitte|nennen|auflisten|anzeigen|zeigen|dazu)\b/,
  /\bwer\s+(?:genau|davon|alles|noch|waren\s+das|ist\s+das|sind\s+(?:die|sie|das|es|diese))\b/,
  /\bwelche\s+(?:davon|genau|sind\s+(?:das|es|die|diese)|waren\s+das)\b/,
  /^(?:und\s+)?(?:welche|wer|wie\s+heissen\s+sie|wie\s+heissen\s+die)(?:\s+bitte)?$/,
  /\bwie\s+heissen\s+(?:sie|die|diese|das)\b/,
  /\b(?:nenn|nenne|nennst|liste|zeig|zeige|zeigst|gib|gibst|geb|sag|sage)\w*\s+(?:\w+\s+){0,2}(?:sie|alle|die\s+namen|die\s+liste)\b/,
  /\balle\s+(?:anzeigen|zeigen|auflisten|nennen)\b/,
  /\b(?:wie\s+viele|wie\s+viel|wer|welche)\s+(?:\w+\s+){0,3}davon\b/,
  /\bwie\s+(?:stehen|laeuft|geht)\s+(?:es\s+)?(?:sie|denen|ihnen|die|den\s+anderen)\b/,
  /\bund\s+die\s+(?:anderen|restlichen|uebrigen)\b/,
  /^(?:die\s+)?(?:liste|namen|uebersicht)(?:\s+bitte)?$/,
];

/** The message reads like a follow-up to a question about the own trainees. */
export function isTraineeFollowUpCue(message: string): boolean {
  if (typeof message !== 'string') return false;
  const text = foldText(message);
  if (!text || text.length > FOLLOW_UP_MAX_LENGTH) return false;
  return TRAINEE_FOLLOW_UP_PATTERNS.some(pattern => pattern.test(text));
}

/** How many earlier messages of the person are looked at. */
const FOLLOW_UP_LOOKBACK = 4;

/**
 * The last questions of the person were about the own trainees (a question
 * with a noun for trainees, or a follow-up of such a question). Newest first:
 * a follow-up is looked through, the first other question decides.
 */
export function historyIsAboutTrainees(
  history: readonly HistoryTurnMessage[] | undefined
): boolean {
  if (!history || history.length === 0) return false;
  const earlier = history
    .filter(message => message.role === 'user')
    .map(historyText)
    .slice(-FOLLOW_UP_LOOKBACK)
    .reverse();
  for (const text of earlier) {
    if (classifyDataIntent(text, 'TRAINER') === 'trainee_overview') {
      return true;
    }
    if (isTraineeFollowUpCue(text)) continue;
    return false;
  }
  return false;
}

/** Intents that already carry their own subject: a follow-up cue never changes them. */
const OWN_SUBJECT_INTENTS: ReadonlySet<DataIntent> = new Set([
  'trainee_overview',
  'trainee_detail_query',
  'review_query',
  'day_briefing',
  'document_query',
]);

/**
 * The data intent of a turn including the history: a trainer who asked for the
 * own trainees and then says "Welche mit Namen?" (no noun, no name) asks for
 * the same list again. Deterministic, on the server, from the history of the
 * session (never from the model). Only for trainers, other roles get the plain
 * classification.
 */
export function resolveDataIntent(
  message: string,
  userRole: UserRole,
  history?: readonly HistoryTurnMessage[]
): DataIntent {
  const base = classifyDataIntent(message, userRole);
  if (userRole !== 'TRAINER' || OWN_SUBJECT_INTENTS.has(base)) return base;
  if (isTraineeFollowUpCue(message) && historyIsAboutTrainees(history)) {
    return 'trainee_overview';
  }
  return base;
}

/**
 * Questions that are answered from the live data alone: the list of the own
 * trainees and the open reviews of a trainer. No knowledge search and no source
 * cards of the knowledge base belong to them (a list of trainees with the
 * cards of a quiz about the training contract below it is noise).
 *
 * Narrow on purpose: the keyword lists of the data intents are generous ("pruefe"
 * is a review, every capitalized noun is a possible name), so a knowledge
 * question of a trainer ("Prüfe diesen SQL-Befehl", "Welche Aufgaben gebe ich
 * meinen Azubis?") must keep its search and its sources. A turn counts only
 * with a plain phrase for the list, or as the short follow-up of such a list.
 */
const WANTS_KNOWLEDGE =
  /\b(?:erklaer\w*|was\s+ist|was\s+sind|wie\s+funktioniert|beispiel\w*|schreib\w*|programmier\w*|zusammenfass\w*|uebersetz\w*|loesung\w*|aufgabe[n]?|frage[n]?|uebung\w*|thema|themen|lernen|beibring\w*|quiz\w*|enabler\w*|szenario\w*|use\s?-?\s?case\w*|lernfeld\w*|sql|code)\b/;

/** The plural group noun for trainees ("Azubis", "Auszubildende"), not a single "Azubi". */
const TRAINEE_GROUP_NOUN =
  /\b(?:azubis|auszubildende[nr]?|trainees|azubiliste)\b/;
/** Words of a question for the list or the state of the group. */
const LIST_WORDS =
  /\b(?:welche|wer|wie\s?viele|wieviele|zeig\w*|anzeig\w*|auflist\w*|liste\w*|nenn\w*|gib|gibst|uebersicht|ueberblick|alle|meine|meinen|habe|betreue|zugeordnet|zugewiesen|wie\s+stehen|wie\s+laeuft)\b/;
/** Open reviews in plain words. */
const REVIEW_PHRASE =
  /\b(?:(?:offene|ausstehende|zu\s+bewertende)[nrms]?\s+(?:abgaben|bewertungen|reviews?|einreichungen)|was\s+(?:muss|soll|kann)\s+ich\s+(?:noch\s+)?(?:bewerten|korrigieren|pruefen)|welche\s+abgaben)\b/;

const LIVE_ONLY_MAX_LENGTH = 90;

export function isLiveDataOnlyTurn(
  message: string,
  userRole: UserRole | undefined,
  history?: readonly HistoryTurnMessage[]
): boolean {
  if (userRole !== 'TRAINER' || typeof message !== 'string') return false;
  const text = foldText(message);
  if (!text || text.length > LIVE_ONLY_MAX_LENGTH) return false;
  if (WANTS_KNOWLEDGE.test(text)) return false;
  const intent = resolveDataIntent(message, userRole, history);
  if (intent === 'review_query') return REVIEW_PHRASE.test(text);
  if (intent !== 'trainee_overview') return false;
  if (TRAINEE_GROUP_NOUN.test(text) && LIST_WORDS.test(text)) return true;
  // the short follow-up of a list ("Welche mit Namen?"): no noun, the history decides
  return isTraineeFollowUpCue(message) && historyIsAboutTrainees(history);
}
