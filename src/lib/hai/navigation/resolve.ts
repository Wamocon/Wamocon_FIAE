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

import type { ContentReference, NavigationIntent } from './intent';
import { matchContent, type ContentCandidate, type MatchResult } from './match';
import { pickNextStep, type NextStepPlan } from './nextStep';
import { plainText } from './text';
import {
  pathOfEnabler,
  isAllowedNavigationPath,
  staticTargetFor,
  targetsForLevel,
  pathOfUseCase,
  STATIC_TARGETS,
  type NavigationLevel,
  type StaticTargetId,
} from './targets';
import type { NavigationOffer } from './offer';
import {
  DENIAL_ALL_LOCKED_TEXT,
  DENIAL_NO_COURSE_TEXT,
  DENIAL_RECORD_NOT_FOUND_TEXT,
  DENIAL_TECHNICAL_TEXT,
  denialAreaText,
  denialContinueText,
  denialLockedText,
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
}

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
  const area = STATIC_TARGETS[id]?.TRAINER ? 'TRAINER' : 'ADMIN';
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

function offerOutcome(
  path: string | null,
  label: string,
  reason: string,
  intro: string
): NavigationOutcome {
  // Defence in depth: a path that is not on the allow list is never offered
  if (!path || !isAllowedNavigationPath(path)) {
    return { kind: 'unavailable', text: NAVIGATION_UNAVAILABLE_TEXT };
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
  intro?: string
): NavigationOutcome {
  const target = staticTargetFor(id, level);
  if (!target) return denied(id, level);
  return offerOutcome(
    target.path,
    target.label,
    target.reason,
    intro ?? `Ich habe die Seite ${target.label} für dich.`
  );
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
    case 'static':
      return staticOffer(intent.target, scope.level);

    case 'unknown_page':
      return unknownPage(scope.level);

    case 'continue':
      return resolveContinue(scope);

    case 'enabler':
    case 'enabler_quiz':
    case 'use_case':
      return resolveContent(intent.kind, intent.ref, scope);
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
        `Weiter geht es mit dem Enabler ${title}.`
      );
    }
    case 'all_done':
      return staticOffer(
        'dashboard',
        'TRAINEE',
        'Du hast alle freigeschalteten Enabler abgeschlossen.'
      );
    case 'all_locked':
      // GESPERRT: the order of work or a lock of the trainer
      return { kind: 'nothing', text: DENIAL_ALL_LOCKED_TEXT };
    case 'none':
      // FREIGABE: no course released for the person
      return { kind: 'nothing', text: DENIAL_NO_COURSE_TEXT };
  }
}

async function resolveContent(
  kind: 'enabler' | 'enabler_quiz' | 'use_case',
  ref: ContentReference,
  scope: NavigationScope
): Promise<NavigationOutcome> {
  // Trainer level edits enablers and use cases in the content management
  if (scope.level !== 'TRAINEE') {
    return staticOffer(
      'content_management',
      scope.level,
      'Enabler und Use Cases bearbeitest du in der Inhaltsverwaltung.'
    );
  }

  if (kind === 'use_case') {
    const found = await matchChosenFirst(ref, scope, ids =>
      loadTraineeUseCases(scope.userId, ids)
    );
    if (found.status === 'none') {
      return { kind: 'not_found', text: NOT_FOUND_TEXT };
    }
    if (found.status === 'many')
      return ambiguous(found.items.map(i => i.title));
    const title = plainText(found.item.title);
    return offerOutcome(
      pathOfUseCase(found.item.id),
      title,
      `Das ist der Use Case im Kurs ${plainText(found.item.courseTitle)}.`,
      `Ich habe den Use Case ${title} für dich.`
    );
  }

  const found = await matchChosenFirst(ref, scope, ids =>
    loadTraineeEnablers(scope.userId, ids)
  );
  if (found.status === 'none') {
    return { kind: 'not_found', text: NOT_FOUND_TEXT };
  }
  if (found.status === 'many') return ambiguous(found.items.map(i => i.title));

  const enabler = found.item;
  const title = plainText(enabler.title);
  const lock = await loadEnablerLock(scope.userId, {
    id: enabler.id,
    courseId: enabler.courseId,
  });
  if (!lock) return { kind: 'not_found', text: NOT_FOUND_TEXT };

  // Order of work (GESPERRT): title, reason and a way forward, no link to the
  // content (like the page)
  if (lock.locked) {
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
      pathOfEnabler(enabler.id),
      `Quiz zu ${title}`,
      'Die Quizze findest du auf der Seite des Enablers.',
      `Ich habe den Enabler ${title} mit seinen Quizzen für dich.`
    );
  }

  return offerOutcome(
    pathOfEnabler(enabler.id),
    title,
    `Das ist der Enabler im Kurs ${plainText(enabler.courseTitle)}.`,
    `Ich habe den Enabler ${title} für dich.`
  );
}

function ambiguous(titles: string[]): NavigationOutcome {
  return {
    kind: 'ambiguous',
    text: `Dazu passen mehrere Einträge, zum Beispiel ${listTitles(titles)}. Nenne mir bitte den genauen Namen.`,
  };
}
