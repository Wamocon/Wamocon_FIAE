/**
 * Resolving a navigation request on the server: the recognized request (what
 * the person wants, intent.ts) against the allow list (targets.ts), the level
 * of the person and the records the person may see (data.ts).
 *
 * Rules:
 *  - The path of an offer always comes from the allow list or is built from a
 *    uuid of a record that passed the checks of data.ts. The model and the text
 *    of the message never supply a path.
 *  - A page of another area is refused in a friendly way with the reason ROLLE
 *    (denial.ts): the answer names the area roughly (trainer area or
 *    administration), never a name or a content of it, and offers pages of the
 *    own level. A page that is not known at all gets its own answer ("kenne ich
 *    nicht"), which says plainly that it is no question of rights.
 *  - A record of another occupation or another course is not found, with the
 *    same answer as for a record that does not exist (reason UMFANG: nothing
 *    found in the released content, which is true for both and leaks no
 *    existence).
 *  - A locked enabler (order of work) gets no link: title and reason GESPERRT,
 *    like the page itself shows it.
 *  - A failed lookup is said as a technical failure, never as a missing right.
 *  - Nothing here writes. A navigation never leads to a write, writes stay with
 *    the confirmation card of the actions.
 *
 * @module lib/hai/navigation/resolve
 */

import type {
  ContentParent,
  ContentReference,
  NavigationIntent,
} from './intent';
import { matchContent, type ContentCandidate, type MatchResult } from './match';
import { pickNextStep, type NextStepPlan } from './nextStep';
import { plainText } from './text';
import {
  pathOfCourse,
  pathOfEnabler,
  isAllowedNavigationPath,
  staticTargetFor,
  targetsForLevel,
  pathOfUseCase,
  trainerPathOfCourse,
  trainerPathOfEnabler,
  trainerPathOfUseCase,
  STATIC_TARGET_IDS,
  STATIC_TARGETS,
  type NavigationLevel,
  type StaticTargetId,
} from './targets';
import {
  enablerHasScenarioPdf,
  findDocumentsByName,
  findDocumentsOf,
  loadCourses,
  loadTrainerEnablers,
  loadTrainerUseCases,
  type DocumentLookup,
  type OpenableDocument,
} from './contentData';
import { nearestPages, rankByName } from './suggest';
import type { HaiTrainingScope } from '../trainingScope';
import type { NavigationOffer } from './offer';
import {
  DENIAL_ALL_LOCKED_TEXT,
  DENIAL_NO_COURSE_TEXT,
  DENIAL_RECORD_NOT_FOUND_TEXT,
  DENIAL_TECHNICAL_TEXT,
  denialAreaText,
  denialContinueText,
  denialLockedText,
  denialTraineePageText,
  denialUnknownPageText,
} from '../denial';
import {
  loadEnablerLock,
  loadNextStepEntries,
  loadTraineeEnablers,
  loadTraineeUseCases,
} from './data';

/** Who is asking and what the person may see, all from the server. */
export interface NavigationScope {
  userId: string;
  level: NavigationLevel;
  /** All catalogs of the person (the targets follow all occupations of the person). */
  catalogIds: readonly string[];
  /**
   * The occupation chosen in the app, when the person has several: "Weiter
   * lernen" and the search of an enabler or use case by number or name look
   * there first and only then in the others. Never narrows what can be found.
   */
  preferredCatalogIds?: readonly string[];
  /** The phases whose content is due now (trainees), for "Weiter lernen". */
  plan?: NextStepPlan | null;
  /**
   * The person gave a clear command ("Öffne ...", "Bring mich zu ..."): an
   * offer carries `auto` and the text says "Ich öffne ...", so the interface
   * opens the page right away. A question for the way or a substitute page
   * stays an offer for the person to confirm.
   */
  direct?: boolean;
  /** The organization of the person (documents: own organization and platform only). */
  organizationId?: string | null;
  /** The training plan of the person, applied to the documents like in the file questions. */
  trainingScope?: HaiTrainingScope;
  /**
   * The enabler or use case of the page the person is on (page context, ids
   * already checked against the occupations) or of the last turns, for "diese
   * Datei" and "das PDF dazu". Data to pick a record, never a right.
   */
  contextParent?: { type: 'enabler' | 'use_case'; id: string } | null;
  /** The record the last turns named by number or title ("das PDF dazu"). */
  historyParent?: ContentParent | null;
}

export type NavigationOutcomeKind =
  | 'offer'
  | 'denied'
  | 'unknown_page'
  | 'not_found'
  | 'ambiguous'
  | 'locked'
  | 'nothing'
  | 'unavailable';

export interface NavigationOutcome {
  kind: NavigationOutcomeKind;
  /** The answer in the chat (German), without the closing hint or question. */
  text: string;
  /** Set for kind 'offer' only. */
  offer?: NavigationOffer;
  /**
   * A question back with the nearest targets as cards (at most three), for an
   * ambiguous or an unmatched request. Never auto, every card waits for a tap.
   */
  choices?: NavigationOffer[];
}

/** At most this many cards in a question back. */
export const MAX_CHOICES = 3;

// ============================================================================
// ANSWERS
// ============================================================================

// UMFANG: the same text for a record of another occupation and one that does
// not exist, so nothing about other occupations is revealed
const NOT_FOUND_TEXT = DENIAL_RECORD_NOT_FOUND_TEXT;

// A technical failure, said as such (never as a missing right)
export const NAVIGATION_UNAVAILABLE_TEXT = DENIAL_TECHNICAL_TEXT;

/** Pages of the own level as examples, "A, B oder C". */
function ownPageExamples(level: NavigationLevel): string {
  const examples = targetsForLevel(level)
    .slice(0, 3)
    .map(target => target.label);
  return examples.length > 1
    ? `${examples.slice(0, -1).join(', ')} oder ${examples[examples.length - 1]}`
    : (examples[0] ?? 'dein Dashboard');
}

/**
 * ROLLE: a page that exists for another level. Names the area roughly. A page
 * with a trainer entry belongs to the trainer area, one with an admin entry
 * only to the administration. Nothing else about the page is said.
 */
function denied(id: StaticTargetId, level: NavigationLevel): NavigationOutcome {
  const definition = STATIC_TARGETS[id];
  // a page of the trainees only (no entry of the trainer area or the admins)
  if (definition && !definition.TRAINER && !definition.ADMIN) {
    return {
      kind: 'denied',
      text: denialTraineePageText(ownPageExamples(level)),
    };
  }
  const area = definition?.TRAINER ? 'TRAINER' : 'ADMIN';
  return {
    kind: 'denied',
    text: denialAreaText(area, ownPageExamples(level)),
  };
}

/** The page is not known at all: no reason of rights, and it says so. */
function unknownPage(level: NavigationLevel): NavigationOutcome {
  return {
    kind: 'unknown_page',
    text: denialUnknownPageText(ownPageExamples(level)),
  };
}

/**
 * An offer. With `opening` (a clear command of the person) the offer carries
 * `auto` and the text is that short report ("Ich öffne ..."), otherwise the text
 * introduces the card and the person confirms.
 */
function offerOutcome(
  path: string | null,
  label: string,
  reason: string,
  intro: string,
  opening?: string
): NavigationOutcome {
  // Defence in depth: a path that is not on the allow list is never offered
  if (!path || !isAllowedNavigationPath(path)) {
    return { kind: 'unavailable', text: NAVIGATION_UNAVAILABLE_TEXT };
  }
  if (opening) {
    return {
      kind: 'offer',
      text: opening,
      offer: { path, label, reason, auto: true },
    };
  }
  return {
    kind: 'offer',
    text: `${intro} ${reason}`,
    offer: { path, label, reason },
  };
}

function staticOffer(
  id: StaticTargetId,
  level: NavigationLevel,
  intro?: string,
  opening?: string
): NavigationOutcome {
  const target = staticTargetFor(id, level);
  if (!target) return denied(id, level);
  return offerOutcome(
    target.path,
    target.label,
    target.reason,
    intro ?? `Ich habe die Seite ${target.label} für dich.`,
    opening
  );
}

/** The short report of a command that is carried out: "Ich öffne die Seite X." */
function openingOf(scope: NavigationScope, text: string): string | undefined {
  return scope.direct ? text : undefined;
}

function listTitles(titles: string[]): string {
  const clean = titles.slice(0, 3).map(plainText);
  return clean.length > 1
    ? `${clean.slice(0, -1).join(', ')} oder ${clean[clean.length - 1]}`
    : clean[0];
}

// ============================================================================
// RESOLVING
// ============================================================================

/**
 * Resolve a recognized navigation request. Throws when a database lookup
 * fails: the caller answers "cannot check now" and offers nothing.
 */
export async function resolveNavigation(
  intent: NavigationIntent,
  scope: NavigationScope
): Promise<NavigationOutcome> {
  switch (intent.kind) {
    case 'static': {
      // a trainer who asks for the courses is taken to the content management,
      // that is a substitute and not the page asked for: an offer, no command
      if (intent.target === 'courses' && scope.level !== 'TRAINEE') {
        return staticOffer(
          'courses',
          scope.level,
          'Kurse verwaltest du in der Inhaltsverwaltung.'
        );
      }
      const target = staticTargetFor(intent.target, scope.level);
      return staticOffer(
        intent.target,
        scope.level,
        undefined,
        target
          ? openingOf(scope, `Ich öffne die Seite ${target.label}.`)
          : undefined
      );
    }

    case 'unknown_page':
      return unknownPage(scope.level);

    case 'unmatched':
      return unmatchedOutcome(intent.query, scope);

    case 'continue':
      return resolveContinue(scope);

    case 'enabler':
    case 'enabler_quiz':
    case 'use_case':
      return resolveContent(intent.kind, intent.ref, scope);

    case 'course':
      return resolveCourse(intent.ref, scope);

    case 'document':
      return resolveDocument(intent, scope);
  }
}

/** The chosen occupation is a part of the occupations of the person. */
function isNarrower(scope: NavigationScope): boolean {
  const chosen = scope.preferredCatalogIds;
  return (
    !!chosen && chosen.length > 0 && chosen.length < scope.catalogIds.length
  );
}

/**
 * Look for the record in the chosen occupation first and only then in all of the
 * person: a number like "3" exists in every occupation, the chosen one is meant.
 * Nothing that the person may see is hidden by this.
 */
async function matchChosenFirst(
  ref: ContentReference,
  scope: NavigationScope,
  load: (catalogIds: readonly string[]) => Promise<ContentCandidate[]>
): Promise<MatchResult> {
  if (isNarrower(scope)) {
    const first = matchContent(ref, await load(scope.preferredCatalogIds!));
    if (first.status !== 'none') return first;
  }
  return matchContent(ref, await load(scope.catalogIds));
}

async function resolveContinue(
  scope: NavigationScope
): Promise<NavigationOutcome> {
  // "Weiter lernen" is the order of work of a trainee
  if (scope.level !== 'TRAINEE') {
    return {
      kind: 'denied',
      text: denialContinueText(ownPageExamples(scope.level)),
    };
  }

  // The chosen occupation first: an open step there wins, otherwise all
  let step = isNarrower(scope)
    ? pickNextStep(
        await loadNextStepEntries(scope.userId, scope.preferredCatalogIds!),
        scope.plan
      )
    : null;
  if (step?.kind !== 'next') {
    step = pickNextStep(
      await loadNextStepEntries(scope.userId, scope.catalogIds),
      scope.plan
    );
  }

  switch (step.kind) {
    case 'next': {
      const title = plainText(step.entry.title);
      return offerOutcome(
        pathOfEnabler(step.entry.enablerId),
        title,
        step.reason,
        `Weiter geht es mit dem Enabler ${title}.`,
        openingOf(scope, `Ich öffne den Enabler ${title}. ${step.reason}`)
      );
    }
    case 'all_done':
      return staticOffer(
        'dashboard',
        'TRAINEE',
        'Du hast alle freigeschalteten Enabler abgeschlossen.',
        openingOf(
          scope,
          'Du hast alle freigeschalteten Enabler abgeschlossen. Ich öffne dein Dashboard.'
        )
      );
    case 'all_locked':
      // GESPERRT: the order of work or a lock of the trainer
      return { kind: 'nothing', text: DENIAL_ALL_LOCKED_TEXT };
    case 'none':
      // FREIGABE: no course released for the person
      return { kind: 'nothing', text: DENIAL_NO_COURSE_TEXT };
  }
}
// ============================================================================
// CARDS AND QUESTIONS BACK
// ============================================================================

/** A card that waits for a tap (never `auto`), or null when its path is not on the allow list. */
function cardFor(
  path: string | null,
  label: string,
  reason: string
): NavigationOffer | null {
  if (!path || !isAllowedNavigationPath(path)) return null;
  return { path, label, reason };
}

/** The cards of a question back: at most three, only valid ones. */
function cardsOf(
  cards: ReadonlyArray<NavigationOffer | null>
): NavigationOffer[] {
  return cards
    .filter((card): card is NavigationOffer => card !== null)
    .slice(0, MAX_CHOICES);
}

function withChoices(
  kind: NavigationOutcomeKind,
  text: string,
  cards: ReadonlyArray<NavigationOffer | null>
): NavigationOutcome {
  const choices = cardsOf(cards);
  return { kind, text, ...(choices.length > 0 ? { choices } : {}) };
}

/** The label of a content type for a sentence. */
const TYPE_WORD: Readonly<Record<'enabler' | 'use_case' | 'course', string>> = {
  enabler: 'Enabler',
  use_case: 'Use Case',
  course: 'Kurs',
};

function ambiguous(
  titles: string[],
  cards: ReadonlyArray<NavigationOffer | null> = []
): NavigationOutcome {
  const choices = cardsOf(cards);
  const hint =
    choices.length > 0
      ? 'Tippe auf eine Karte oder nenne mir bitte den genauen Namen.'
      : 'Nenne mir bitte den genauen Namen.';
  return withChoices(
    'ambiguous',
    `Dazu passen mehrere Einträge, zum Beispiel ${listTitles(titles)}. ${hint}`,
    cards
  );
}

/** Where a record opens for the level of the person. */
function recordPath(
  type: 'enabler' | 'use_case' | 'course',
  level: NavigationLevel,
  item: { id: string; courseId?: string | null },
  documentId?: string | null
): string | null {
  if (level === 'TRAINEE') {
    if (type === 'enabler') return pathOfEnabler(item.id, documentId);
    if (type === 'use_case') return pathOfUseCase(item.id, documentId);
    return pathOfCourse(item.id);
  }
  // the trainer levels: the editor of the course holds the enabler, the use
  // case and the course have their own pages
  if (type === 'enabler') {
    return item.courseId
      ? trainerPathOfEnabler(item.courseId, item.id, documentId)
      : null;
  }
  if (type === 'use_case') return trainerPathOfUseCase(item.id, documentId);
  return trainerPathOfCourse(item.id);
}

function recordReason(
  type: 'enabler' | 'use_case' | 'course',
  level: NavigationLevel,
  courseTitle: string
): string {
  const course = plainText(courseTitle);
  if (type === 'course') {
    return level === 'TRAINEE'
      ? 'Das ist der Kurs mit seinen Enablern und Use Cases.'
      : 'Dort bearbeitest du den Kurs mit seinen Enablern und Use Cases.';
  }
  if (level === 'TRAINEE') {
    return `Das ist der ${TYPE_WORD[type]} im Kurs ${course}.`;
  }
  return `Dort siehst du den ${TYPE_WORD[type]} im Kurs ${course}.`;
}

function cardOfRecord(
  type: 'enabler' | 'use_case' | 'course',
  level: NavigationLevel,
  item: ContentCandidate
): NavigationOffer | null {
  return cardFor(
    recordPath(type, level, item),
    plainText(item.title),
    recordReason(type, level, item.courseTitle)
  );
}

/** The records of the person for one content type (a trainee: own courses, a trainer: the catalogs). */
function loaderFor(
  type: 'enabler' | 'use_case' | 'course',
  scope: NavigationScope
): (catalogIds: readonly string[]) => Promise<ContentCandidate[]> {
  if (type === 'course') {
    return ids => loadCourses(scope.userId, scope.level, ids);
  }
  if (scope.level === 'TRAINEE') {
    return type === 'enabler'
      ? ids => loadTraineeEnablers(scope.userId, ids)
      : ids => loadTraineeUseCases(scope.userId, ids);
  }
  return type === 'enabler' ? loadTrainerEnablers : loadTrainerUseCases;
}

/**
 * The record is not among the released ones: the same text as for a record of
 * another occupation (UMFANG). The nearest records of the person (similar
 * names) come as cards, so the person is not left with "not found".
 */
async function notFound(
  type: 'enabler' | 'use_case' | 'course',
  ref: ContentReference,
  scope: NavigationScope
): Promise<NavigationOutcome> {
  const query = ref.name ?? ref.number ?? '';
  const candidates = query
    ? await loaderFor(type, scope)(scope.catalogIds)
    : [];
  const near = query
    ? rankByName(query, candidates, c => `${c.title} ${c.code ?? ''}`)
    : [];
  const text =
    type === 'course'
      ? 'In deinen freigeschalteten Kursen habe ich dazu keinen passenden Eintrag gefunden, das heißt aber nicht, dass es ihn nicht gibt. Nenne mir bitte den genauen Namen eines Kurses, den du siehst.'
      : NOT_FOUND_TEXT;
  if (near.length === 0) return { kind: 'not_found', text };
  return withChoices(
    'not_found',
    `${text} Meinst du ${listTitles(near.map(c => c.title))}? Tippe auf eine Karte, dann öffne ich es.`,
    near.map(c => cardOfRecord(type, scope.level, c))
  );
}

// ============================================================================
// UNMATCHED COMMANDS
// ============================================================================

/**
 * A command to open something that matches no page ("Öffne den Kalender der
 * Kantine"). The platform answers, never the model: the nearest pages of the
 * level as cards, or pages of the level as examples. No claim of missing rights,
 * the page is simply not one the platform knows.
 */
function unmatchedOutcome(
  query: string,
  scope: NavigationScope
): NavigationOutcome {
  const near = nearestPages(query, STATIC_TARGET_IDS, scope.level, MAX_CHOICES);
  if (near.length > 0) {
    return withChoices(
      'not_found',
      `Dafür habe ich keine eigene Seite gefunden. Meinst du ${listTitles(near.map(p => p.label))}? Tippe auf eine Karte oder nenne mir den Namen des Menüpunkts, dann öffne ich die Seite.`,
      near.map(p => cardFor(p.path, p.label, p.reason))
    );
  }
  const examples = targetsForLevel(scope.level).slice(0, MAX_CHOICES);
  return withChoices(
    'not_found',
    `Dafür habe ich keine eigene Seite gefunden. Ich führe dich gern zu einer Seite, die ich kenne, zum Beispiel ${ownPageExamples(scope.level)}. Nenne mir den Namen des Menüpunkts, dann öffne ich die Seite.`,
    examples.map(p => cardFor(p.path, p.label, p.reason))
  );
}

// ============================================================================
// COURSES
// ============================================================================

async function resolveCourse(
  ref: ContentReference,
  scope: NavigationScope
): Promise<NavigationOutcome> {
  // no name ("Öffne den Kurs"): the page with the courses
  if (!ref.number && !ref.name) {
    if (scope.level !== 'TRAINEE') {
      return staticOffer(
        'courses',
        scope.level,
        'Kurse verwaltest du in der Inhaltsverwaltung.'
      );
    }
    return staticOffer(
      'courses',
      scope.level,
      undefined,
      openingOf(scope, 'Ich öffne die Seite Lernen.')
    );
  }

  const found = await matchChosenFirst(ref, scope, loaderFor('course', scope));
  if (found.status === 'none') return notFound('course', ref, scope);
  if (found.status === 'many') {
    return ambiguous(
      found.items.map(i => i.title),
      found.items.map(i => cardOfRecord('course', scope.level, i))
    );
  }
  const title = plainText(found.item.title);
  return offerOutcome(
    recordPath('course', scope.level, found.item),
    title,
    recordReason('course', scope.level, found.item.courseTitle),
    `Ich habe den Kurs ${title} für dich.`,
    openingOf(scope, `Ich öffne den Kurs ${title}.`)
  );
}

// ============================================================================
// ENABLERS AND USE CASES
// ============================================================================

async function resolveContent(
  kind: 'enabler' | 'enabler_quiz' | 'use_case',
  ref: ContentReference,
  scope: NavigationScope
): Promise<NavigationOutcome> {
  const trainee = scope.level === 'TRAINEE';
  const type = kind === 'use_case' ? 'use_case' : 'enabler';

  const found = await matchChosenFirst(ref, scope, loaderFor(type, scope));
  if (found.status === 'none') return notFound(type, ref, scope);
  if (found.status === 'many') {
    return ambiguous(
      found.items.map(i => i.title),
      found.items.map(i => cardOfRecord(type, scope.level, i))
    );
  }
  const item = found.item;
  const title = plainText(item.title);

  if (type === 'use_case') {
    return offerOutcome(
      recordPath('use_case', scope.level, item),
      title,
      recordReason('use_case', scope.level, item.courseTitle),
      `Ich habe den Use Case ${title} für dich.`,
      openingOf(scope, `Ich öffne den Use Case ${title}.`)
    );
  }

  // A trainer level opens the enabler in the editor of its course
  if (!trainee) {
    return offerOutcome(
      recordPath('enabler', scope.level, item),
      title,
      recordReason('enabler', scope.level, item.courseTitle),
      `Ich habe den Enabler ${title} für dich.`,
      openingOf(scope, `Ich öffne den Enabler ${title}.`)
    );
  }

  const lock = await loadEnablerLock(scope.userId, {
    id: item.id,
    courseId: item.courseId,
  });
  if (!lock) return { kind: 'not_found', text: NOT_FOUND_TEXT };

  // The quiz of a locked enabler is closed (order of work): title, reason and
  // a way forward, no link to the quiz (like the page)
  if (lock.locked && kind === 'enabler_quiz') {
    return {
      kind: 'locked',
      text: denialLockedText(
        title,
        lock.lockedByTitle ? plainText(lock.lockedByTitle) : null
      ),
    };
  }

  if (kind === 'enabler_quiz') {
    if (!lock.hasActiveQuiz) {
      return {
        kind: 'nothing',
        text: `Zum Enabler ${title} gibt es noch kein Quiz.`,
      };
    }
    return offerOutcome(
      pathOfEnabler(item.id),
      `Quiz zu ${title}`,
      'Die Quizze findest du auf der Seite des Enablers.',
      `Ich habe den Enabler ${title} mit seinen Quizzen für dich.`,
      openingOf(scope, `Ich öffne den Enabler ${title} mit seinen Quizzen.`)
    );
  }

  // A locked enabler opens like the page shows it: title and material can be
  // read, quizzes and submission are closed. The link goes to the page, never to
  // a quiz, and the answer says so.
  if (lock.locked) {
    const first = lock.lockedByTitle ? plainText(lock.lockedByTitle) : null;
    const note = first
      ? `Er ist noch gesperrt, weil in der Reihenfolge der Arbeit zuerst ${first} abgeschlossen sein muss. Titel und Material kannst du lesen, Quizze und Abgabe sind noch zu.`
      : 'Er ist noch gesperrt (Reihenfolge der Arbeit). Titel und Material kannst du lesen, Quizze und Abgabe sind noch zu.';
    return offerOutcome(
      pathOfEnabler(item.id),
      title,
      note,
      `Ich habe den Enabler ${title} für dich.`,
      openingOf(scope, `Ich öffne den Enabler ${title}. ${note}`)
    );
  }

  return offerOutcome(
    pathOfEnabler(item.id),
    title,
    recordReason('enabler', scope.level, item.courseTitle),
    `Ich habe den Enabler ${title} für dich.`,
    openingOf(scope, `Ich öffne den Enabler ${title}.`)
  );
}

// ============================================================================
// DOCUMENTS (the reader)
// ============================================================================

/** The neutral answer: a file that does not exist and one the person may not see read the same. */
export function documentNotFoundSentence(name?: string | null): string {
  const named = name
    ? ` zu "${name.replace(/["\n\r]/g, '').slice(0, 80)}"`
    : '';
  return `Ich finde${named} keine passende Datei in deinen freigegebenen Inhalten. Nenne mir bitte den Namen der Datei genauer oder den Enabler oder Use Case, zu dem sie gehört.`;
}

const DOC_KIND_WORD: Readonly<Record<string, string>> = {
  any: 'Dokument',
  theory: 'Lehrtext',
  scenario: 'Szenario',
  task: 'Aufgabe',
};

/** The documents a kind of word asks for (a scenario: the exercises of an enabler). */
export function filterByDocKind(
  docs: readonly OpenableDocument[],
  docKind: string,
  parentType: 'enabler' | 'use_case'
): OpenableDocument[] {
  switch (docKind) {
    case 'scenario':
      // the tasks of a use case are its scenario
      return parentType === 'enabler'
        ? docs.filter(doc => doc.documentType === 'EXERCISE')
        : docs.filter(doc => doc.documentType !== 'TRAINER_SOLUTION');
    case 'task':
      return docs.filter(
        doc =>
          doc.documentType === 'EXERCISE' ||
          doc.documentType === 'TRAINEE_QUESTION'
      );
    case 'theory':
      return docs.filter(
        doc =>
          doc.documentType !== 'EXERCISE' &&
          doc.documentType !== 'TRAINEE_QUESTION' &&
          doc.documentType !== 'TRAINER_SOLUTION'
      );
    default:
      return [...docs];
  }
}

function documentCard(
  doc: OpenableDocument,
  scope: NavigationScope
): NavigationOffer | null {
  const parentWord = TYPE_WORD[doc.parentType];
  return cardFor(
    recordPath(
      doc.parentType,
      scope.level,
      { id: doc.parentId, courseId: doc.courseId },
      doc.id
    ),
    plainText(doc.title),
    doc.parentTitle
      ? `Das Dokument gehört zum ${parentWord} ${plainText(doc.parentTitle)}.`
      : 'Das Dokument öffnet im Reader.'
  );
}

function lookupOf(scope: NavigationScope): DocumentLookup {
  return {
    userId: scope.userId,
    level: scope.level,
    catalogIds: scope.catalogIds,
    organizationId: scope.organizationId ?? null,
    trainingScope: scope.trainingScope,
  };
}

/** One, a few or many documents: open it, ask with cards, or point at the page of the record. */
function documentsOutcome(
  docs: readonly OpenableDocument[],
  scope: NavigationScope,
  docKind: string,
  parent: {
    type: 'enabler' | 'use_case';
    id: string;
    title: string;
    courseId?: string | null;
  } | null,
  requestedName: string | null
): NavigationOutcome {
  const word = DOC_KIND_WORD[docKind] ?? 'Dokument';
  if (docs.length === 0) {
    return {
      kind: 'nothing',
      text: parent
        ? `Zum ${TYPE_WORD[parent.type]} ${plainText(parent.title)} finde ich keine passende Datei in deinen freigegebenen Inhalten.`
        : documentNotFoundSentence(requestedName),
    };
  }
  if (docs.length === 1) {
    const doc = docs[0];
    const card = documentCard(doc, scope);
    if (!card)
      return { kind: 'unavailable', text: NAVIGATION_UNAVAILABLE_TEXT };
    const title = plainText(doc.title);
    return offerOutcome(
      card.path,
      card.label,
      card.reason,
      `Ich habe das ${word} ${title} für dich.`,
      openingOf(scope, `Ich öffne das ${word} ${title}.`)
    );
  }
  // several: the person picks one, at most three cards. A parent with many
  // files (more than three) opens its page, where the files are listed.
  if (parent && docs.length > MAX_CHOICES) {
    const page = cardFor(
      recordPath(parent.type, scope.level, parent),
      plainText(parent.title),
      `Dort findest du alle ${docs.length} Dateien.`
    );
    if (page) {
      return offerOutcome(
        page.path,
        page.label,
        page.reason,
        `Zum ${TYPE_WORD[parent.type]} ${plainText(parent.title)} gibt es ${docs.length} Dateien.`,
        openingOf(
          scope,
          `Zum ${TYPE_WORD[parent.type]} ${plainText(parent.title)} gibt es ${docs.length} Dateien, ich öffne die Seite mit allen.`
        )
      );
    }
  }
  return withChoices(
    'ambiguous',
    `Dazu passen mehrere Dateien, zum Beispiel ${listTitles(docs.map(d => d.title))}. Tippe auf eine Karte oder nenne mir bitte den genauen Namen.`,
    docs.map(doc => documentCard(doc, scope))
  );
}

interface ResolvedParent {
  type: 'enabler' | 'use_case';
  id: string;
  title: string;
  courseId: string | null;
}

/** The enabler or use case a document request is about, or the outcome that answers it. */
async function resolveParent(
  parent: ContentParent | null,
  scope: NavigationScope
): Promise<ResolvedParent | NavigationOutcome> {
  const toParent = (type: 'enabler' | 'use_case', c: ContentCandidate) => ({
    type,
    id: c.id,
    title: c.title,
    courseId: c.courseId,
  });

  const named = parent ?? scope.historyParent ?? null;
  // the page of the person first ("diese Datei"), then the earlier turns
  if (!parent && scope.contextParent) {
    const candidates = await loaderFor(
      scope.contextParent.type,
      scope
    )(scope.catalogIds);
    const own = candidates.find(c => c.id === scope.contextParent!.id);
    if (own) return toParent(scope.contextParent.type, own);
  }
  if (!named) {
    return {
      kind: 'ambiguous',
      text: 'Welche Datei meinst du? Nenne mir bitte den Namen der Datei oder den Enabler oder Use Case, zu dem sie gehört, dann öffne ich sie im Reader.',
    };
  }
  const found = await matchChosenFirst(
    named.ref,
    scope,
    loaderFor(named.type, scope)
  );
  if (found.status === 'none') return notFound(named.type, named.ref, scope);
  if (found.status === 'many') {
    return ambiguous(
      found.items.map(i => i.title),
      found.items.map(i => cardOfRecord(named.type, scope.level, i))
    );
  }
  return toParent(named.type, found.item);
}

function isOutcome(
  value: ResolvedParent | NavigationOutcome
): value is NavigationOutcome {
  return 'text' in value;
}

async function resolveDocument(
  intent: Extract<NavigationIntent, { kind: 'document' }>,
  scope: NavigationScope
): Promise<NavigationOutcome> {
  const lookup = lookupOf(scope);

  // by file name: "Öffne das Dokument Szenario_14i"
  if (!intent.parent && intent.fileKeys.length > 0) {
    const docs = await findDocumentsByName(lookup, intent.fileKeys);
    return documentsOutcome(
      docs,
      scope,
      intent.docKind,
      null,
      intent.fileKeys[0].key
    );
  }

  const parent = await resolveParent(intent.parent, scope);
  if (isOutcome(parent)) return parent;

  const all = await findDocumentsOf(lookup, parent);
  const docs = filterByDocKind(all, intent.docKind, parent.type);

  // The single scenario PDF of an enabler (a field, no row of its own)
  if (
    docs.length === 0 &&
    parent.type === 'enabler' &&
    intent.docKind === 'scenario' &&
    (await enablerHasScenarioPdf(parent.id))
  ) {
    const title = plainText(parent.title);
    const path =
      scope.level === 'TRAINEE'
        ? pathOfEnabler(parent.id, parent.id)
        : recordPath('enabler', scope.level, parent);
    return offerOutcome(
      path,
      `Szenario zu ${title}`,
      scope.level === 'TRAINEE'
        ? 'Das Szenario öffnet im Reader.'
        : 'Dort siehst du das Szenario-PDF des Enablers.',
      `Ich habe das Szenario zum Enabler ${title} für dich.`,
      openingOf(scope, `Ich öffne das Szenario zum Enabler ${title}.`)
    );
  }

  return documentsOutcome(docs, scope, intent.docKind, parent, null);
}
