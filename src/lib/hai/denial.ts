/**
 * Reasons of the HAI when it cannot do something because of access.
 *
 * Every refusal that hangs on a permission, a role, an occupation, a release,
 * the order of work, a plan or a switch names the REASON in one friendly German
 * sentence: what does not work, why (one coarse and true category), and what is
 * possible instead. A technical failure is never given out as a permission and
 * the other way round.
 *
 * Safety line: a reason says THAT something is not available and WHY in a
 * coarse category. It never carries a name, an id, a title, a content or a
 * number of another occupation, of a trainer area or of another person. The
 * only titles that may appear are those the pages show the person anyway (the
 * locked enabler and the one to finish first, like the enabler page).
 *
 * Pure module without server imports: the pipeline (fixed texts before search
 * and model), the prompt (hints for the model), the routes (stable codes), the
 * browser (key of the interface text) and the tests share it. Texts that the
 * interface shows live in the locale files (hai.denial.*), the texts the
 * pipeline sends itself are the constants here.
 *
 * @module lib/hai/denial
 */

export const DENIAL_CATEGORIES = [
  'ROLLE',
  'BERUF',
  'GESPERRT',
  'LOESUNGSSCHUTZ',
  'FREIGABE',
  'ORGANISATION_PLAN',
  'SCHALTER_AUS',
  'ZUSTAENDIGKEIT',
  'UMFANG',
  'AUSWAHL',
] as const;

export type DenialCategory = (typeof DENIAL_CATEGORIES)[number];

export function isDenialCategory(value: unknown): value is DenialCategory {
  return (
    typeof value === 'string' &&
    (DENIAL_CATEGORIES as readonly string[]).includes(value)
  );
}

/** What each category means, in plain words (also the list for the model). */
export const DENIAL_MEANING: Readonly<Record<DenialCategory, string>> =
  Object.freeze({
    ROLLE: 'nicht für deine Rolle vorgesehen',
    BERUF: 'gehört nicht zu deiner Ausbildung',
    GESPERRT: 'gesperrt wegen der Reihenfolge der Arbeit',
    LOESUNGSSCHUTZ:
      'Lösungsschutz: Musterlösungen nur für Trainer, Quizantworten erst nach dem bestandenen Quiz',
    FREIGABE: 'noch nicht freigeschaltet oder das Konto wartet auf Freigabe',
    ORGANISATION_PLAN:
      'in deiner Organisation oder deinem Plan nicht enthalten',
    SCHALTER_AUS: 'für deine Organisation ausgeschaltet',
    ZUSTAENDIGKEIT: 'nur für die eigenen Auszubildenden',
    UMFANG: 'in deinen freigeschalteten Inhalten nichts gefunden',
    AUSWAHL:
      'nur zum ausgewählten Beruf beantwortet, der andere eigene Beruf steht auf dem anderen Reiter',
  });

/**
 * A word or phrase that a text uses when it names the category. The tests and
 * the golden set check a fixed text (and the later measurement checks an
 * answer of the model) against it.
 */
export const DENIAL_KEYWORDS: Readonly<Record<DenialCategory, RegExp>> =
  Object.freeze({
    ROLLE: /\bRolle\b/i,
    BERUF: /Ausbildungsberuf|zu deiner Ausbildung|deinem (?:eigenen )?Beruf/i,
    GESPERRT: /Reihenfolge der Arbeit|gesperrt/i,
    LOESUNGSSCHUTZ: /Lösungsschutz|Lösung/i,
    FREIGABE: /freigeschaltet|Freigabe|Freischaltung/i,
    ORGANISATION_PLAN: /Organisation|\bPlan\b|Paket/i,
    SCHALTER_AUS: /ausgeschaltet|abgeschaltet/i,
    ZUSTAENDIGKEIT: /zuständig/i,
    UMFANG: /freigeschalteten (?:Inhalten|Enablern)/i,
    AUSWAHL: /ausgewählt.*Reiter|selected.*tab/i,
  });

/** Whether a text names the reason of the category in plain words. */
export function namesDenialReason(
  text: string,
  category: DenialCategory
): boolean {
  return DENIAL_KEYWORDS[category].test(text);
}

// ============================================================================
// FIXED TEXTS OF THE PIPELINE (German, sent before search and model)
// ============================================================================

/** BERUF: a question about the content of another occupation. Names nothing of it. */
export const DENIAL_BERUF_TEXT =
  'Dazu kann ich dir hier nichts sagen, denn das gehört nicht zu deiner Ausbildung, sondern zu einem anderen Ausbildungsberuf. 🦈 Bei Fragen zu deinem eigenen Beruf helfe ich dir gern, zum Beispiel mit Lernfeldern, Aufgaben oder der Prüfungsvorbereitung.';

/** LOESUNGSSCHUTZ: a request for a solution, a key or a trainer answer. Names no part of it. */
export const DENIAL_LOESUNGSSCHUTZ_TEXT =
  'Die Lösung gebe ich nicht heraus (Lösungsschutz): Musterlösungen und Bewertungsschlüssel sind Trainern vorbehalten, richtige Quizantworten gibt es erst nach dem bestandenen Quiz. 🦈 Ich helfe dir gern mit Leitfragen und Hinweisen, woran hängst du gerade?';

/**
 * FREIGABE: no occupation could be assigned to the account. The lookup cannot
 * tell "no occupation released" from a short failure of the database, so the
 * text names both and does not claim either.
 */
export const DENIAL_NEUTRAL_TEXT =
  'Ich kann dir im Moment keine fachlichen Auskünfte geben, weil deinem Konto noch kein Ausbildungsberuf freigeschaltet oder zugeordnet werden konnte (oder weil die Prüfung gerade gestört ist). 🦈 Bitte versuche es später noch einmal oder wende dich an deinen Trainer, er kann den Beruf für dich einrichten.';

/** ROLLE: a trainer asks for an action of the trainees. */
export const DENIAL_ACTION_TRAINEE_ONLY_TEXT =
  'Diese Aktion ist nur für Auszubildende vorgesehen, deshalb kann ich sie für deine Rolle als Trainer nicht ausführen. Ich kann dir stattdessen zeigen, wo du den Stand deiner Auszubildenden findest.';

/** ROLLE: a trainee asks for an action of the trainers. */
export const DENIAL_ACTION_TRAINER_ONLY_TEXT =
  'Diese Aktion ist nur für Trainer vorgesehen, deshalb kann ich sie für deine Rolle als Azubi nicht ausführen. Dein Trainer kann sie übernehmen, und ich kann dir stattdessen zeigen, wo du den Stand deiner Abgaben und Nachweise findest.';

/** BERUF: the record of an action lies outside the occupations of the person. */
export const DENIAL_ACTION_OCCUPATION_TEXT =
  'Diese Aktion kann ich nicht ausführen, weil der Eintrag zu einem Ausbildungsberuf gehört, der für dich nicht freigeschaltet ist. Für Einträge deiner eigenen Ausbildungsberufe geht sie.';

/**
 * UMFANG (and ZUSTAENDIGKEIT): a record of an action that is missing, foreign
 * or outside the responsibility answers the same, so nothing is revealed.
 */
export const DENIAL_ACTION_NOT_FOUND_TEXT =
  'Diesen Eintrag finde ich in deinen freigeschalteten Inhalten und in deinem Zuständigkeitsbereich nicht, das heißt aber nicht, dass es ihn nicht gibt. Bitte prüfe die Angabe oder öffne den Eintrag direkt in der Plattform.';

/** A name for a text: letters, digits, space, hyphen and underscore only. */
function plainName(value: string, fallback: string): string {
  const name = value.replace(/[^\p{L}\p{N} _-]/gu, '').trim();
  return name || fallback;
}

/**
 * AUSWAHL: the person has chosen one occupation in the app and asks about
 * ANOTHER occupation that she has too. The answer is fixed, before search and
 * model, and names only the two occupations of the person as the tabs show them
 * (never a content, a title of a record or an id). `lang` is 'de' (the chat) or
 * 'en'.
 */
export function denialSelectionText(
  chosen: string,
  other: string,
  lang: 'de' | 'en' = 'de'
): string {
  const a = plainName(
    chosen,
    lang === 'en' ? 'your occupation' : 'deinen Beruf'
  );
  const b = plainName(
    other,
    lang === 'en' ? 'the other occupation' : 'den anderen Beruf'
  );
  return lang === 'en'
    ? `You have selected ${a} right now, so I only answer about that here. Switch to the tab ${b} at the top, and I will help you with that too.`
    : `Du hast gerade ${a} ausgewählt, deshalb antworte ich hier nur dazu. Wechsle oben auf den Reiter ${b}, dann helfe ich dir auch dazu.`;
}

/** A failed check is a technical failure, said as such (never as a missing right). */
export const DENIAL_TECHNICAL_TEXT =
  'Das kann ich gerade nicht prüfen, weil eine technische Störung vorliegt und nicht, weil dir etwas fehlt. Bitte versuche es später noch einmal.';

/** The check of the permission of an action failed technically. */
export const DENIAL_ACTION_UNAVAILABLE_TEXT =
  'Die Berechtigung kann gerade nicht geprüft werden, weil eine technische Störung vorliegt und nicht, weil dir etwas fehlt. Bitte versuche es später erneut.';

/** UMFANG: an enabler or use case that the person named is not among the released content. */
export const DENIAL_RECORD_NOT_FOUND_TEXT =
  'In deinen freigeschalteten Inhalten habe ich dazu keinen passenden Eintrag gefunden, das heißt aber nicht, dass es ihn nicht gibt. Nenne mir bitte die Nummer oder den genauen Namen eines Enablers, den du siehst.';

/** FREIGABE: nothing of the order of work is open for the person. */
export const DENIAL_NO_COURSE_TEXT =
  'Für dich ist noch kein Kurs mit Enablern freigeschaltet, deshalb kann ich dir keinen nächsten Schritt nennen. Sprich bitte mit deinem Trainer, er kann dich einem Kurs zuordnen.';

/**
 * ZUSTAENDIGKEIT: the line the data context writes when a trainer asks for a
 * person who is not among the own trainees. A person of another organization or
 * occupation answers like a person that does not exist, so nothing is revealed.
 * The marker is how the pipeline recognizes the line for the hint to the model.
 */
export const TRAINEE_SEARCH_NOT_FOUND_MARKER = '**Azubi-Suche:**';

export function traineeSearchNotFoundLine(name: string): string {
  return `${TRAINEE_SEARCH_NOT_FOUND_MARKER} Einen Azubi mit dem Namen "${name}" finde ich unter den dir zugewiesenen Auszubildenden nicht (Zuständigkeit: Auskunft gibt es nur zu den eigenen Auszubildenden), das heißt aber nicht, dass es ihn nicht gibt. Bitte den vollständigen Namen verwenden oder in der Plattform prüfen.`;
}

/** GESPERRT: every open enabler is locked. */
export const DENIAL_ALL_LOCKED_TEXT =
  'Im Moment sind alle deine offenen Enabler noch gesperrt (Reihenfolge der Arbeit oder eine Sperre deines Trainers), deshalb kann ich dir keinen nächsten Schritt nennen. Sprich bitte mit deinem Trainer, er sagt dir, was noch fehlt.';

/** ROLLE: "Weiter lernen" is the order of work of a trainee. */
export function denialContinueText(examples: string): string {
  return `Weiter lernen kann ich nur für Auszubildende anbieten, es ist für deine Rolle nicht vorgesehen. Ich bringe dich gern zu einer Seite, die für dich da ist, zum Beispiel ${examples}.`;
}

/**
 * ROLLE: a page of another area. Names the area roughly (trainer area or
 * administration), never a name or content of it. `examples` are pages of the
 * person's own level.
 */
export function denialAreaText(
  area: 'TRAINER' | 'ADMIN',
  examples: string
): string {
  const where =
    area === 'TRAINER'
      ? 'zum Trainerbereich'
      : 'zum Verwaltungsbereich der Administratoren';
  return `Diese Seite kann ich dir nicht öffnen, weil sie ${where} gehört und für deine Rolle nicht freigegeben ist. Ich bringe dich gern zu einer Seite, die für dich da ist, zum Beispiel ${examples}.`;
}

/**
 * Not a permission at all: the page is not known. Says so, so nobody takes it
 * for a missing right.
 */
export function denialUnknownPageText(examples: string): string {
  return `Diese Seite kenne ich nicht, deshalb kann ich sie nicht öffnen, das hat nichts mit deinen Rechten zu tun. Ich bringe dich gern zu einer Seite, die ich kenne, zum Beispiel ${examples}.`;
}

/**
 * GESPERRT: a locked enabler. The title of the enabler and of the one to finish
 * first are shown only because the enabler page shows them to the person too.
 */
export function denialLockedText(title: string, first?: string | null): string {
  if (first) {
    return `Der Enabler ${title} ist noch gesperrt, weil in der Reihenfolge der Arbeit zuerst ${first} abgeschlossen sein muss. Schließe ${first} ab, dann wird er frei, und bis dahin helfe ich dir gern bei ${first}.`;
  }
  return `Der Enabler ${title} ist für dich noch gesperrt (Reihenfolge der Arbeit). Sobald er freigeschaltet ist, helfe ich dir gern dabei, bis dahin beim Enabler davor.`;
}

/** GESPERRT in an action: the same reason as on the page, with a way forward. */
export function denialActionLockedText(
  title: string,
  first?: string | null
): string {
  return first
    ? `Der Enabler "${title}" ist noch gesperrt, weil in der Reihenfolge der Arbeit zuerst "${first}" abgeschlossen sein muss. Schließe "${first}" ab, dann kannst du ihn abschließen.`
    : `Der Enabler "${title}" ist für dich gesperrt (Reihenfolge der Arbeit). Er kann erst abgeschlossen werden, wenn er freigeschaltet ist.`;
}

// ============================================================================
// HINTS FOR THE MODEL (structured, not user text)
// ============================================================================

/**
 * What the pipeline knows when it asks the model, one key per situation. The
 * prompt builder turns the keys into a short section (prompts.ts). The notes
 * are fixed here, so no text of the user or of a record can reach the prompt
 * through them.
 */
export const ACCESS_REASON_KEYS = [
  'UMFANG_SEARCH',
  'UMFANG_CONTEXT',
  'ROLLE_OTHERS_DATA',
  'LOESUNGSSCHUTZ_ANSWER',
  'ZUSTAENDIGKEIT_TRAINEE',
] as const;

export type AccessReasonKey = (typeof ACCESS_REASON_KEYS)[number];

export const ACCESS_REASONS: Readonly<
  Record<AccessReasonKey, { category: DenialCategory; note: string }>
> = Object.freeze({
  UMFANG_SEARCH: {
    category: 'UMFANG',
    note: 'Die Suche lief nur in den für diesen Nutzer freigeschalteten Inhalten und hat zu dieser Frage nichts gefunden.',
  },
  UMFANG_CONTEXT: {
    category: 'UMFANG',
    note: 'Der in der Plattform geöffnete Enabler oder Kurs gehört nicht zu den freigeschalteten Inhalten dieses Nutzers, sein Inhalt wurde nicht geladen.',
  },
  ROLLE_OTHERS_DATA: {
    category: 'ROLLE',
    note: 'Fragt der Nutzer nach Daten oder Auswertungen anderer Personen (zum Beispiel Bewertungen oder Stand anderer Azubis), sind sie für die Rolle Azubi nicht vorgesehen.',
  },
  LOESUNGSSCHUTZ_ANSWER: {
    category: 'LOESUNGSSCHUTZ',
    note: 'Fragt der Nutzer nach einer Lösung oder der richtigen Antwort einer Quizfrage: Für Azubis gibt es Musterlösungen und Bewertungsschlüssel nicht, richtige Quizantworten erst nach dem bestandenen Quiz.',
  },
  ZUSTAENDIGKEIT_TRAINEE: {
    category: 'ZUSTAENDIGKEIT',
    note: 'Der Nutzer ist Trainer und hat nach einer einzelnen Person gefragt, die unter seinen zugewiesenen Auszubildenden nicht gefunden wurde: Daten gibt es nur zu den eigenen Auszubildenden.',
  },
});

export function isAccessReasonKey(value: unknown): value is AccessReasonKey {
  return (
    typeof value === 'string' &&
    (ACCESS_REASON_KEYS as readonly string[]).includes(value)
  );
}

// ============================================================================
// ERRORS OF THE ROUTES IN THE BROWSER
// ============================================================================

/**
 * Stable codes the routes send with a 403 or 429 (additive, existing codes
 * stay): PRO_REQUIRED (the plan or organization has no HAI), VOICE_DISABLED (the
 * switch of the organization), AWAITING_ACTIVATION (the account waits for the
 * release), COURSE_NOT_ASSIGNED (the course is not assigned to the trainee),
 * ENABLER_LOCKED (order of work), QUESTION_ATTEMPTS_EXCEEDED, RATE_LIMITED.
 */
export const DENIAL_CODES = {
  PRO_REQUIRED: 'PRO_REQUIRED',
  COURSE_NOT_ASSIGNED: 'COURSE_NOT_ASSIGNED',
} as const;

/**
 * The key of the interface text for a failed call of the chat route. The
 * browser shows the reason in plain words instead of "error". An unknown
 * failure stays the general message, a failure of the server is never shown as
 * a missing right.
 */
export function chatFailureKey(status: number, code?: unknown): string {
  if (status === 403 && code === 'VOICE_DISABLED') {
    return 'hai.denial.voiceDisabled';
  }
  if (status === 403 && code === DENIAL_CODES.PRO_REQUIRED) {
    return 'hai.denial.planRequired';
  }
  if (status === 403 && code === 'AWAITING_ACTIVATION') {
    return 'hai.denial.awaitingActivation';
  }
  if (status === 403) return 'hai.denial.forbidden';
  if (status === 429) return 'hai.denial.rateLimited';
  if (status === 400) return 'hai.denial.inputInvalid';
  return 'hai.error.somethingWrong';
}
