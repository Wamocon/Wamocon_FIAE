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
 *
 * Pure functions, no database access (see personaAccess.ts for the loader).
 *
 * @module lib/hai/persona
 */

import { resolveCatalogBranding } from '@/lib/catalog/branding';
import {
  resolveHaiSettings,
  type HaiSettings,
} from '@/lib/catalog/hai-settings';

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
  /** Text after "der digitale Lernbegleiter " in the first line. */
  intro: string;
  glossary: HaiGlossaryEntry[];
  traineeTopics: string[];
  trainerTopics: string[];
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
  offTopicContextWords: string[];
  /** Lower case names of other occupations (not of this user). */
  foreignMarkers: string[];
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
  role?: HaiPersonaRole | null;
  /** Training phase of the trainee (1 or 2), from the server. */
  phase?: HaiPersonaPhase | null;
}

// ============================================================================
// FIAE: today's texts, do not change (tests/unit/hai/fiae-baseline.json)
// ============================================================================

const FIAE_CODE = 'FIAE';

const FIAE_GLOSSARY: HaiGlossaryEntry[] = [
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
];

const FIAE_TRAINEE_TOPICS = [
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
];

/** The trainer topics are the same for every occupation. */
const TRAINER_TOPICS = [
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
];

const FIAE_OFF_TOPIC_CONTEXT_WORDS = [
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
];

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

function buildOccupationPersona(
  catalog: CatalogPersonaSource,
  role: HaiPersonaRole | null | undefined,
  phase: HaiPersonaPhase | null | undefined
): HaiPersona {
  const hai = haiSettingsOf(catalog);
  const occupationName = hai?.occupationName ?? catalog.title.trim();
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
    FIAE_GLOSSARY[6],
    FIAE_GLOSSARY[7],
    FIAE_GLOSSARY[8],
    FIAE_GLOSSARY[9],
    FIAE_GLOSSARY[10],
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
    catalog.title,
    resolveCatalogBranding(settings.branding).shortName ?? '',
    hai?.occupationName ?? '',
    hai?.fieldName ?? '',
    ...(isFiae(catalog) ? ['Fachinformatik'] : []),
  ];
  return unique(
    names
      .map(n => n.trim().toLowerCase())
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

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Whether the message names another occupation than the ones of the user. The
 * name must start a word, so "Fachinformatiker" matches "fachinformatik".
 */
export function isForeignOccupationQuestion(
  message: string,
  persona: Pick<HaiPersona, 'foreignMarkers'>
): boolean {
  if (persona.foreignMarkers.length === 0) return false;
  const lower = message.toLowerCase();
  return persona.foreignMarkers.some(marker =>
    new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRegExp(marker)}`, 'u').test(lower)
  );
}

// ============================================================================
// Resolve
// ============================================================================

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

  return {
    ...persona,
    offTopicContextWords: contextWords,
    foreignMarkers: foreignMarkersFor(catalogs, input.otherCatalogs ?? []),
  };
}
