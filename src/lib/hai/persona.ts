/**
 * HAI.ai persona: the texts and rules of the assistant for one occupation.
 *
 * resolveHaiPersona builds the persona on the SERVER from the catalogs of the
 * user (training_catalogs.settings.hai, see src/lib/catalog/hai-settings.ts),
 * the role and the training phase. Nothing of it comes from client text.
 *
 *  - FIAE keeps today's texts byte for byte (the settings key is ignored for
 *    FIAE, like the branding), so the persona of FIAE is the old prompt.
 *  - Another occupation takes its texts from settings.hai. A missing key falls
 *    back to a generic text without IT words and without fixed numbers.
 *  - Without a catalog scope the persona is neutral: no knowledge context, no
 *    live data, only a refusal.
 *  - Questions about another occupation (named by code, title or the names in
 *    its settings) are refused neutrally.
 *  - The occupation chosen in the app (header x-catalog) limits the HAI to that
 *    one occupation: the persona is the single persona of it. A question about
 *    ANOTHER occupation of the same user gets the answer "you have chosen X,
 *    switch to the tab Y" (category AUSWAHL, see denial.ts). Without a choice
 *    the persona speaks about all occupations of the user (merged persona).
 *
 * Pure functions, no database access (see personaAccess.ts for the loader).
 *
 * @module lib/hai/persona
 */

import {
  isBrandingApplied,
  resolveCatalogBranding,
} from '@/lib/catalog/branding';
import {
  isValidHaiText,
  resolveHaiSettings,
  type HaiSettings,
} from '@/lib/catalog/hai-settings';
import { escapeRegExp } from '@/lib/regex-escape';

export type HaiPersonaRole = 'TRAINER' | 'TRAINEE';
export type HaiPersonaPhase = 1 | 2;
export type HaiPersonaSource =
  | 'fiae-default'
  | 'catalog-settings'
  | 'generic'
  | 'neutral';

export interface HaiGlossaryEntry {
  term: string;
  definition: string;
}

export interface HaiPersona {
  source: HaiPersonaSource;
  /** True without a catalog scope: no knowledge, only a refusal. */
  neutral: boolean;
  /** Code of the primary catalog, null for the neutral persona. */
  catalogCode: string | null;
  occupationName: string;
  /**
   * The names of the occupations of the user, only set when there are several
   * (mergePersonas). The topic check of the prompt names them, so a question that
   * joins the content of two of them is not taken for a question of another
   * occupation. Absent for one occupation (the prompt of one occupation stays
   * byte for byte as it was).
   */
  occupationNames?: readonly string[];
  /** Text after "der digitale Lernbegleiter " in the first line. */
  intro: string;
  glossary: readonly HaiGlossaryEntry[];
  traineeTopics: readonly string[];
  trainerTopics: readonly string[];
  showTrainerTopics: boolean;
  /** The complete line that starts with "**VERBOTEN:**". */
  forbiddenLine: string;
  /** Refusal as written into the system prompt. */
  refusalPrompt: string;
  /** Refusal as sent to the user. */
  refusalText: string;
  /** Extra rule about sources, null for none. */
  sourceRule: string | null;
  /** Topic for "Beantworte Fragen allgemein zum Thema ..." */
  generalTopic: string;
  noContextTopicLabel: string;
  expertiseLabel: string;
  examModeTitle: string;
  examSentence: string;
  examLevelLabel: string;
  quizDefaultTopic: string;
  greeting: string;
  /** Whether messages about code are classified as code help. */
  codeHelp: boolean;
  /** Words that keep a message out of the off-topic filter. */
  offTopicContextWords: readonly string[];
  /** Lower case names of other occupations (not of this user). */
  foreignMarkers: readonly string[];
  /**
   * Other occupations of this user that are NOT chosen in the app (only with a
   * choice, else empty). A question that names one of them is answered with
   * "switch the tab", not with content.
   */
  unselectedOwn: readonly UnselectedOccupation[];
  /** Name of the chosen occupation as the tab shows it, null without a choice. */
  chosenLabel: string | null;
}

/** An own occupation outside the choice: its name for the text, its markers. */
export interface UnselectedOccupation {
  /** Short name as the tab shows it (branding short name or code). */
  name: string;
  /** Lower case names that identify it in a message (like foreignMarkers). */
  markers: readonly string[];
}

/** A training catalog as the persona needs it (id, code, title, settings). */
export interface CatalogPersonaSource {
  id: string;
  code: string;
  title: string;
  settings: unknown;
}

export interface ResolveHaiPersonaInput {
  /** Catalogs of the user, the primary one first. Empty or null: no scope. */
  catalogs: CatalogPersonaSource[] | null | undefined;
  /** Catalogs outside the scope of the user, only used for the markers. */
  otherCatalogs?: CatalogPersonaSource[] | null;
  /**
   * Own occupations of the user outside the choice. Only set when the app chose
   * one occupation (then `catalogs` holds that one): they get their own markers,
   * so a question about them is answered with "switch the tab".
   */
  unselectedCatalogs?: CatalogPersonaSource[] | null;
  role?: HaiPersonaRole | null;
  /** Training phase of the trainee (1 or 2), from the server. */
  phase?: HaiPersonaPhase | null;
}

// ============================================================================
// FIAE: today's texts, do not change (tests/unit/hai/fiae-baseline.json)
// ============================================================================

/** Freezes an array and its entries, so a caller cannot change a persona. */
function deepFreeze<T>(items: T[]): readonly T[] {
  items.forEach(item => {
    if (typeof item === 'object' && item !== null) Object.freeze(item);
  });
  return Object.freeze(items);
}

const FIAE_CODE = 'FIAE';

const FIAE_GLOSSARY: readonly HaiGlossaryEntry[] = deepFreeze([
  {
    term: 'Kurs',
    definition:
      'Uebergeordneter Ausbildungsbereich mit mehreren Enablern (~26 Components pro Kurs)',
  },
  {
    term: 'Enabler',
    definition:
      'Lerneinheit (~150 gesamt) mit Components, Use Cases, Szenarien, Quizzes. KEINE Personen!',
  },
  { term: 'Component', definition: 'Unterabschnitt mit Theorie/Beispielen' },
  {
    term: 'Use Case',
    definition:
      'Praktische Aufgabe/Fallstudie (~90 gesamt) mit PDF + Trainerloesung',
  },
  {
    term: 'Szenario',
    definition: 'Praxisuebung im Enabler, eigenstaendig zu loesen',
  },
  {
    term: 'Lernfeld (LF)',
    definition:
      'Berufsschul-Lernfeld nach IHK (LF1-LF12), N:M mit Enablern und Use Cases',
  },
  {
    term: 'Quiz',
    definition:
      'Pro Enabler bis zu 3 (BEGINNER/INTERMEDIATE/ADVANCED). Global Quiz auf Component-Ebene',
  },
  {
    term: 'Berichtsheft',
    definition:
      'Woechentlicher Taetigkeitsnachweis (DRAFT → SUBMITTED → APPROVED/REVISION_NEEDED)',
  },
  {
    term: 'Wochenbewertung',
    definition:
      'Leistungsbewertung mit Kompetenzgraden (Fach/Methoden/Sozial/Personal)',
  },
  {
    term: 'Ausbildungsblock',
    definition: 'Kalender (SCHOOL, COMPANY, EXAM, VACATION etc.)',
  },
  {
    term: 'Schulklausur',
    definition: 'Klausur mit Fach, Note, Punkte, Prozent',
  },
]);

const FIAE_TRAINEE_TOPICS = deepFreeze([
  'Enabler/LF-Inhalte, Szenarien, Use Cases',
  'Stundenplan/Kalender',
  'Pruefungsvorbereitung/IHK',
  'Quiz/Wissenstest',
  'Code erklaeren/debuggen/PseudoCode/EVA',
  'Fachbegriffe/Themen vereinfachen/Notizen',
  'Projektarbeit/Gantt/ERM/Struktogramme',
  'Berichtsheft/Taetigkeitsnachweis',
  'Professionelle Emails/Prompts',
  'Motivation/"Hai Five"',
  'Klausurerinnerungen',
  'Tool-Empfehlungen',
  'Enabler↔LF Zuordnung',
  'Gespraechszusammenfassung',
  'Testfaelle',
]);

/** The trainer topics are the same for every occupation. */
const TRAINER_TOPICS = deepFreeze([
  'Notenuebersicht aller Azubis',
  'Lernfortschritt je Azubi',
  'Woechentliche Berichte/Stunden',
  'Nachweis-Status',
  'Fehlzeiten',
  'Pruefungstermine',
  'Verkuerzungs-Qualifikation',
  'Anwesenheit',
  'Berufsschul-Info/Lehrer',
  'QuickWins',
  'Besprechungen',
  'Plattform-Nutzung',
  'System-Status',
  'Azubi-Kommunikation',
]);

const FIAE_OFF_TOPIC_CONTEXT_WORDS = deepFreeze([
  'enabler',
  'lernfeld',
  'lf',
  'klausur',
  'azubi',
  'ausbildung',
  'berufsschule',
  'code',
  'programmier',
  'projekt',
  'ihk',
  'prüfung',
  'datenbank',
  'netzwerk',
  'server',
]);

function buildFiaePersona(): HaiPersona {
  return {
    source: 'fiae-default',
    neutral: false,
    catalogCode: FIAE_CODE,
    occupationName: 'Fachinformatik',
    intro: 'im Lernzentrum für Auszubildende (LFA)',
    glossary: FIAE_GLOSSARY,
    traineeTopics: FIAE_TRAINEE_TOPICS,
    trainerTopics: TRAINER_TOPICS,
    showTrainerTopics: true,
    forbiddenLine:
      '**VERBOTEN:** Allgemeinwissen, Unterhaltung, Persoenliches, Politik, Religion, Wetter, Shopping, Kreatives Schreiben, Mathematik — alles ohne LFA/IT-Bezug.',
    refusalPrompt:
      'Das liegt leider ausserhalb meines Fachgebiets. 🦈 Ich bin spezialisiert auf deine LFA-Ausbildung — Lernfelder, Enabler, Code-Hilfe, Pruefungsvorbereitung und alles rund um deine IT-Ausbildung. Wie kann ich dir dabei helfen?',
    refusalText:
      'Das liegt leider außerhalb meines Fachgebiets. 🦈 Ich bin spezialisiert auf deine LFA-Ausbildung — Lernfelder, Enabler, Code-Hilfe, Prüfungsvorbereitung und alles rund um deine IT-Ausbildung. Wie kann ich dir dabei helfen?',
    sourceRule: null,
    generalTopic: 'Fachinformatik',
    noContextTopicLabel:
      'Allgemeine LFA-Themen (z.B. "Was ist eine Datenbank?")',
    expertiseLabel: 'IT-Fachwissen',
    examModeTitle: 'IHK-Prüfungsvorbereitung',
    examSentence: 'Der Nutzer bereitet sich auf die IHK-Prüfung vor.',
    examLevelLabel: 'IHK-Prüfungsniveau',
    quizDefaultTopic: 'Allgemeine IT-Kenntnisse',
    greeting: `Ahoi! 🦈 Ich bin **HAI.ai**, dein Lernbegleiter für Fachinformatik.

Wie kann ich dir helfen?`,
    codeHelp: true,
    offTopicContextWords: FIAE_OFF_TOPIC_CONTEXT_WORDS,
    foreignMarkers: [],
    unselectedOwn: [],
    chosenLabel: null,
  };
}

/** The persona of FIAE without a role; the default of the prompt builders. */
export const FIAE_PERSONA: Readonly<HaiPersona> =
  Object.freeze(buildFiaePersona());

// ============================================================================
// Neutral persona (no catalog scope)
// ============================================================================

const NEUTRAL_REFUSAL =
  'Ich kann dir im Moment keine fachlichen Auskünfte geben, weil deinem Konto kein Ausbildungsberuf zugeordnet werden konnte. 🦈 Bitte versuche es später noch einmal oder wende dich an deinen Trainer.';

/** Neutral persona: no knowledge, no live data, only a refusal. */
export const NEUTRAL_PERSONA: Readonly<HaiPersona> = Object.freeze({
  source: 'neutral',
  neutral: true,
  catalogCode: null,
  occupationName: '',
  intro: 'für Auszubildende',
  glossary: [],
  traineeTopics: [],
  trainerTopics: [],
  showTrainerTopics: false,
  forbiddenLine: '',
  refusalPrompt: NEUTRAL_REFUSAL,
  refusalText: NEUTRAL_REFUSAL,
  sourceRule: null,
  generalTopic: '',
  noContextTopicLabel: '',
  expertiseLabel: '',
  examModeTitle: 'Prüfungsvorbereitung',
  examSentence: 'Der Nutzer bereitet sich auf eine Prüfung vor.',
  examLevelLabel: 'Prüfungsniveau',
  quizDefaultTopic: 'Allgemeine Kenntnisse',
  greeting: NEUTRAL_REFUSAL,
  codeHelp: false,
  offTopicContextWords: [],
  foreignMarkers: [],
  unselectedOwn: [],
  chosenLabel: null,
} satisfies HaiPersona);

/** Answer to a question about the content of another occupation. */
export const FOREIGN_OCCUPATION_TEXT =
  'Dazu kann ich dir hier leider nichts sagen, denn das gehört nicht zu deiner Ausbildung. 🦈 Bei Fragen zu deinem eigenen Ausbildungsberuf helfe ich dir gern.';

// ============================================================================
// Occupations from settings.hai
// ============================================================================

/** Context words every occupation keeps (no IT words). */
const BASE_OFF_TOPIC_CONTEXT_WORDS = [
  'enabler',
  'lernfeld',
  'lf',
  'klausur',
  'azubi',
  'ausbildung',
  'berufsschule',
  'projekt',
  'prüfung',
];

const DEFAULT_SOURCE_RULE =
  'Stütze fachliche Aussagen auf den Rahmenlehrplan der KMK und den Ausbildungsrahmenplan des Berufs und nenne die Quelle.';

const DEFAULT_EXAM_NAME = 'Abschlussprüfung';

function isFiae(catalog: CatalogPersonaSource): boolean {
  return catalog.code.trim().toUpperCase() === FIAE_CODE;
}

function haiSettingsOf(catalog: CatalogPersonaSource): HaiSettings | null {
  const raw = catalog.settings;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return null;
  }
  return resolveHaiSettings((raw as Record<string, unknown>).hai);
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function fiaeGlossaryEntry(term: string): HaiGlossaryEntry {
  const entry = FIAE_GLOSSARY.find(e => e.term === term);
  if (!entry) throw new Error(`Unknown glossary term ${term}`);
  return entry;
}

function buildOccupationPersona(
  catalog: CatalogPersonaSource,
  role: HaiPersonaRole | null | undefined,
  phase: HaiPersonaPhase | null | undefined
): HaiPersona {
  const hai = haiSettingsOf(catalog);
  // The title is database text outside the settings alphabet: use it only if
  // it passes the same check, otherwise a neutral phrase
  const title = catalog.title.trim();
  const occupationName =
    hai?.occupationName ??
    (isValidHaiText(title, 80) ? title : 'deinem Ausbildungsberuf');
  const fieldName = hai?.fieldName ?? occupationName;
  const label = hai?.learningFieldLabel ?? 'LF';
  const max = hai?.learningFieldMax;
  const examName =
    (phase && hai?.examParts ? hai.examParts[phase - 1] : undefined) ??
    hai?.examName ??
    DEFAULT_EXAM_NAME;
  const codeHelp = hai?.codeHelp === true;

  const glossary: HaiGlossaryEntry[] = [
    {
      term: 'Kurs',
      definition: 'Uebergeordneter Ausbildungsbereich mit mehreren Enablern',
    },
    {
      term: 'Enabler',
      definition:
        'Lerneinheit mit Components, Use Cases, Szenarien, Quizzes. KEINE Personen!',
    },
    { term: 'Component', definition: 'Unterabschnitt mit Theorie/Beispielen' },
    {
      term: 'Use Case',
      definition: 'Praktische Aufgabe/Fallstudie mit PDF + Trainerloesung',
    },
    {
      term: 'Szenario',
      definition: 'Praxisuebung im Enabler, eigenstaendig zu loesen',
    },
    {
      term: `Lernfeld (${label})`,
      definition: `Berufsschul-Lernfeld laut Rahmenlehrplan${
        max ? ` (${label}1-${label}${max})` : ''
      }, N:M mit Enablern und Use Cases`,
    },
    {
      term: 'Quiz',
      definition:
        'Pro Enabler mehrere Quizzes (BEGINNER/INTERMEDIATE/ADVANCED). Global Quiz auf Component-Ebene',
    },
    ...[
      'Berichtsheft',
      'Wochenbewertung',
      'Ausbildungsblock',
      'Schulklausur',
    ].map(term => fiaeGlossaryEntry(term)),
    ...(hai?.glossary ?? []),
  ];

  const traineeTopics = [
    `Enabler/${label}-Inhalte, Szenarien, Use Cases`,
    'Stundenplan/Kalender',
    `Pruefungsvorbereitung/${examName}`,
    'Quiz/Wissenstest',
    ...(codeHelp ? ['Code erklaeren/debuggen/PseudoCode/EVA'] : []),
    'Fachbegriffe/Themen vereinfachen/Notizen',
    ...(hai?.allowedTopics ?? []),
    'Berichtsheft/Taetigkeitsnachweis',
    'Professionelle Emails/Prompts',
    'Motivation/"Hai Five"',
    'Klausurerinnerungen',
    'Tool-Empfehlungen',
    `Enabler↔${label} Zuordnung`,
    'Gespraechszusammenfassung',
  ];

  const refusal =
    hai?.refusalText ??
    `Das liegt leider außerhalb meines Fachgebiets. 🦈 Ich bin spezialisiert auf deine Ausbildung zum Beruf ${occupationName}: Lernfelder, Enabler, Prüfungsvorbereitung und alles rund um deine Ausbildung. Wie kann ich dir dabei helfen?`;

  return {
    source: hai ? 'catalog-settings' : 'generic',
    neutral: false,
    catalogCode: catalog.code,
    occupationName,
    intro: `für Auszubildende im Beruf ${occupationName}`,
    glossary,
    traineeTopics,
    trainerTopics: TRAINER_TOPICS,
    // A trainee prompt carries no trainer topics
    showTrainerTopics: role !== 'TRAINEE',
    forbiddenLine: `**VERBOTEN:** Allgemeinwissen, Unterhaltung, Persönliches, Politik, Religion, Wetter, private Einkäufe, Kreatives Schreiben, allgemeine Mathematik, also alles ohne Bezug zum Beruf ${occupationName}.`,
    refusalPrompt: refusal,
    refusalText: refusal,
    sourceRule: hai?.sourceRule ?? DEFAULT_SOURCE_RULE,
    generalTopic: fieldName,
    noContextTopicLabel: `Allgemeine Fachthemen zu ${fieldName}`,
    expertiseLabel: `Fachwissen zu ${fieldName}`,
    examModeTitle: `Prüfungsvorbereitung (${examName})`,
    examSentence: `Der Nutzer bereitet sich auf diese Prüfung vor: ${examName}.`,
    examLevelLabel: `Niveau der Prüfung (${examName})`,
    quizDefaultTopic: `Allgemeine Kenntnisse in ${fieldName}`,
    greeting:
      hai?.greeting ??
      `Ahoi! 🦈 Ich bin **HAI.ai**, dein Lernbegleiter für ${fieldName}.

Wie kann ich dir helfen?`,
    codeHelp,
    offTopicContextWords: unique([
      ...BASE_OFF_TOPIC_CONTEXT_WORDS,
      ...(hai?.offTopicExceptions ?? []),
    ]),
    foreignMarkers: [],
    unselectedOwn: [],
    chosenLabel: null,
  };
}

// ============================================================================
// Other occupations: markers
// ============================================================================

const MIN_MARKER_LENGTH = 4;

/** Lower case names that identify an occupation in a message. */
function markersOf(catalog: CatalogPersonaSource): string[] {
  const raw = catalog.settings;
  const settings =
    raw !== null && typeof raw === 'object' && !Array.isArray(raw)
      ? (raw as Record<string, unknown>)
      : {};
  const hai = resolveHaiSettings(settings.hai);
  const names = [
    catalog.code,
    resolveCatalogBranding(settings.branding).shortName ?? '',
    hai?.occupationName ?? '',
    hai?.fieldName ?? '',
    ...(isFiae(catalog) ? ['Fachinformatik'] : []),
  ];
  return unique(
    names
      .map(n => normalizeForMatch(n.trim()))
      .filter(n => n.length >= MIN_MARKER_LENGTH)
  );
}

function foreignMarkersFor(
  own: CatalogPersonaSource[],
  others: CatalogPersonaSource[]
): string[] {
  const ownMarkers = own.flatMap(markersOf);
  const ownIds = new Set(own.map(c => c.id));
  return unique(
    others
      .filter(c => !ownIds.has(c.id))
      .flatMap(markersOf)
      .filter(
        m => !ownMarkers.some(o => o === m || o.includes(m) || m.includes(o))
      )
  );
}

/**
 * Name of an occupation as the tab of the app shows it: the short name of the
 * branding (not for FIAE, whose branding is not applied) or the code. Only
 * letters, digits, space, hyphen and underscore, so the name is safe in a text.
 */
export function tabNameOf(catalog: CatalogPersonaSource): string {
  const raw =
    catalog.settings !== null &&
    typeof catalog.settings === 'object' &&
    !Array.isArray(catalog.settings)
      ? (catalog.settings as Record<string, unknown>)
      : {};
  const shortName = isBrandingApplied(catalog.code)
    ? resolveCatalogBranding(raw.branding).shortName
    : null;
  const name = (shortName ?? catalog.code)
    .replace(/[^\p{L}\p{N} _-]/gu, '')
    .trim();
  return name || 'dem anderen Beruf';
}

/**
 * The own occupations outside the choice with their markers. A marker that the
 * chosen occupations share (or contain) is dropped, like for foreign
 * occupations, so a word of the chosen occupation never triggers "switch".
 */
function unselectedOwnFor(
  chosen: CatalogPersonaSource[],
  unselected: CatalogPersonaSource[]
): UnselectedOccupation[] {
  const chosenMarkers = chosen.flatMap(markersOf);
  const chosenIds = new Set(chosen.map(c => c.id));
  return unselected
    .filter(c => !chosenIds.has(c.id))
    .map(c => ({
      name: tabNameOf(c),
      markers: markersOf(c).filter(
        m => !chosenMarkers.some(o => o === m || o.includes(m) || m.includes(o))
      ),
    }))
    .filter(entry => entry.markers.length > 0);
}

/** Lower case, compatibility forms folded, no marks or invisible characters. */
function normalizeForMatch(value: string): string {
  return value
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[\p{M}\p{Cf}]/gu, '');
}

/**
 * Whether the message names another occupation than the ones of the user. The
 * name must start a word, so "Fachinformatiker" matches "fachinformatik".
 */
export function isForeignOccupationQuestion(
  message: string,
  persona: Pick<HaiPersona, 'foreignMarkers'>
): boolean {
  return namesMarker(message, persona.foreignMarkers);
}

/** Whether the message names one of the markers (start of a word, spelled out too). */
function namesMarker(message: string, markers: readonly string[]): boolean {
  if (markers.length === 0) return false;
  const lower = normalizeForMatch(message);
  // Also the text with spelled-out words put together ("K f B M" is "kfbm")
  const spelled = collapseSpelledLetters(lower);
  return markers.some(marker => {
    const pattern = new RegExp(
      `(^|[^\\p{L}\\p{N}])${escapeRegExp(marker)}`,
      'u'
    );
    return pattern.test(lower) || pattern.test(spelled);
  });
}

/**
 * The own occupation outside the choice that the message names, or null. The
 * same marker rules as for foreign occupations (start of a word, spellings,
 * spelled-out letters). Only for a persona with a choice.
 */
export function unselectedOccupationNamed(
  message: string,
  persona: Pick<HaiPersona, 'unselectedOwn'>
): UnselectedOccupation | null {
  return (
    persona.unselectedOwn.find(entry => namesMarker(message, entry.markers)) ??
    null
  );
}

/**
 * Puts a word that is spelled out letter by letter back together: "k f b m",
 * "k.f.b.m", "k-f-b-m" and "k_f_b_m" become "kfbm". Needs at least three single
 * letters in a row, so "teil a b" stays as it is.
 */
function collapseSpelledLetters(value: string): string {
  return value.replace(
    /(?<![\p{L}\p{N}])\p{L}(?:[\s.\-_]+\p{L}(?![\p{L}\p{N}])){2,}/gu,
    run => run.replace(/[\s.\-_]+/g, '')
  );
}

// ============================================================================
// Resolve
// ============================================================================

/** "A", "A und B", "A, B und C" (without duplicates and empty entries). */
function joinNames(values: string[]): string {
  const list = unique(values.map(v => v.trim()).filter(Boolean));
  if (list.length <= 1) return list[0] ?? '';
  return `${list.slice(0, -1).join(', ')} und ${list[list.length - 1]}`;
}

/**
 * One persona for a user with several occupations. The persona of the primary
 * occupation (the one first in the list) is the base. Everything that names the
 * occupation, the topics, the exams and the refusal speaks about ALL the
 * occupations of the user: the search reads the content of every training of
 * the user, so a persona that names only one would refuse the other one and
 * still show its content (found in the Preview on 02.11.2026).
 */
function mergePersonas(personas: HaiPersona[]): HaiPersona {
  const [primary] = personas;
  const names = joinNames(personas.map(p => p.occupationName));
  const fields = joinNames(personas.map(p => p.generalTopic));
  const examTitles = unique(personas.map(p => p.examModeTitle));
  const refusal = `Das liegt leider außerhalb meines Fachgebiets. 🦈 Ich bin spezialisiert auf deine Ausbildungen (${names}): Lernfelder, Enabler, Prüfungsvorbereitung und alles rund um deine Ausbildung. Wie kann ich dir dabei helfen?`;
  const glossary: HaiGlossaryEntry[] = [];
  for (const entry of personas.flatMap(p => [...p.glossary])) {
    if (!glossary.some(g => g.term === entry.term)) glossary.push(entry);
  }
  const rules = unique(
    personas.map(p => p.sourceRule).filter((r): r is string => !!r)
  );
  return {
    ...primary,
    occupationName: names,
    occupationNames: unique(personas.map(p => p.occupationName)),
    intro: `für Auszubildende in den Berufen ${names}`,
    glossary,
    traineeTopics: unique(personas.flatMap(p => [...p.traineeTopics])),
    trainerTopics: unique(personas.flatMap(p => [...p.trainerTopics])),
    showTrainerTopics: personas.some(p => p.showTrainerTopics),
    forbiddenLine: `**VERBOTEN:** Allgemeinwissen, Unterhaltung, Persönliches, Politik, Religion, Wetter, private Einkäufe, Kreatives Schreiben, allgemeine Mathematik, also alles ohne Bezug zu den Berufen ${names}.`,
    refusalPrompt: refusal,
    refusalText: refusal,
    sourceRule: rules.length > 0 ? rules.join('\n') : null,
    generalTopic: fields,
    noContextTopicLabel: `Allgemeine Fachthemen zu ${fields}`,
    expertiseLabel: `Fachwissen zu ${fields}`,
    examModeTitle: examTitles.join(' / '),
    examSentence: `Der Nutzer bereitet sich auf eine Prüfung vor, die zu einem seiner Berufe gehört (${joinNames(examTitles)}).`,
    examLevelLabel: unique(personas.map(p => p.examLevelLabel)).join(' / '),
    quizDefaultTopic: `Allgemeine Kenntnisse in ${fields}`,
    greeting: `Ahoi! 🦈 Ich bin **HAI.ai**, dein Lernbegleiter für ${fields}.

Wie kann ich dir helfen?`,
    codeHelp: personas.some(p => p.codeHelp),
  };
}

/**
 * Persona for one turn of the chat. Server side only: the catalogs, the role
 * and the phase come from the database, never from the client.
 */
export function resolveHaiPersona(input: ResolveHaiPersonaInput): HaiPersona {
  const catalogs = input.catalogs ?? [];
  if (catalogs.length === 0) return NEUTRAL_PERSONA;

  const [primary] = catalogs;
  const persona = isFiae(primary)
    ? { ...FIAE_PERSONA }
    : buildOccupationPersona(primary, input.role, input.phase);

  // A user with several occupations may use the exception words of all
  const contextWords = unique(
    catalogs.flatMap(c =>
      c === primary
        ? persona.offTopicContextWords
        : isFiae(c)
          ? FIAE_OFF_TOPIC_CONTEXT_WORDS
          : buildOccupationPersona(c, input.role, input.phase)
              .offTopicContextWords
    )
  );

  // Several occupations: one persona that speaks about all of them
  const base =
    catalogs.length > 1
      ? mergePersonas([
          persona,
          ...catalogs
            .slice(1)
            .map(c =>
              isFiae(c)
                ? { ...FIAE_PERSONA }
                : buildOccupationPersona(c, input.role, input.phase)
            ),
        ])
      : persona;

  // With a choice (the caller passes the other own occupations): they are not
  // foreign (the user has them), they get the answer "switch the tab"
  const unselected = input.unselectedCatalogs ?? [];
  const unselectedIds = new Set(unselected.map(c => c.id));
  return {
    ...base,
    offTopicContextWords: contextWords,
    foreignMarkers: foreignMarkersFor(
      [...catalogs, ...unselected],
      (input.otherCatalogs ?? []).filter(c => !unselectedIds.has(c.id))
    ),
    unselectedOwn: unselectedOwnFor(catalogs, unselected),
    chosenLabel: unselected.length > 0 ? tabNameOf(primary) : null,
  };
}
