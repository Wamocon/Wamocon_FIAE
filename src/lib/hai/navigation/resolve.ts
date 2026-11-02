/**
 * Resolving a navigation request on the server: the recognized request (what
 * the person wants, intent.ts) against the allow list (targets.ts), the level
 * of the person and the records the person may see (data.ts).
 *
 * Rules:
 *  - The path of an offer always comes from the allow list or is built from a
 *    uuid of a record that passed the checks of data.ts. The model and the text
 *    of the message never supply a path.
 *  - A page that is not for the level of the person is refused in a friendly
 *    way. The refusal is the same for a page that does not exist and one that
 *    exists for others, so nothing is revealed.
 *  - A record of another occupation or another course is not found, with the
 *    same answer as for a record that does not exist.
 *  - A locked enabler (order of work) gets no link: title and hint only, like
 *    the page itself shows it.
 *  - Nothing here writes. A navigation never leads to a write, writes stay with
 *    the confirmation card of the actions.
 *
 * @module lib/hai/navigation/resolve
 */

import type { ContentReference, NavigationIntent } from './intent';
import { matchContent } from './match';
import { pickNextStep, type NextStepPlan } from './nextStep';
import { plainText } from './text';
import {
  pathOfEnabler,
  isAllowedNavigationPath,
  staticTargetFor,
  targetsForLevel,
  pathOfUseCase,
  type NavigationLevel,
} from './targets';
import type { NavigationOffer } from './offer';
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
  /** Catalogs of the person (the occupation scope of the retrieval access). */
  catalogIds: readonly string[];
  /** The phases whose content is due now (trainees), for "Weiter lernen". */
  plan?: NextStepPlan | null;
}

export type NavigationOutcomeKind =
  | 'offer'
  | 'denied'
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

const NOT_FOUND_TEXT =
  'Dazu finde ich in deinem Lernstoff keinen passenden Eintrag. Nenne mir bitte die Nummer oder den genauen Namen.';

export const NAVIGATION_UNAVAILABLE_TEXT =
  'Das kann ich gerade nicht prüfen. Bitte versuche es später noch einmal.';

/** The same text for a page that does not exist and one that is not for the person. */
function denied(level: NavigationLevel): NavigationOutcome {
  const examples = targetsForLevel(level)
    .slice(0, 3)
    .map(target => target.label);
  const list =
    examples.length > 1
      ? `${examples.slice(0, -1).join(', ')} oder ${examples[examples.length - 1]}`
      : (examples[0] ?? 'dein Dashboard');
  return {
    kind: 'denied',
    text: `Diese Seite kann ich dir nicht öffnen. Ich bringe dich gern zu einer Seite, die für dich da ist, zum Beispiel ${list}.`,
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
  target: ReturnType<typeof staticTargetFor>,
  level: NavigationLevel,
  intro?: string
): NavigationOutcome {
  if (!target) return denied(level);
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
      return staticOffer(
        staticTargetFor(intent.target, scope.level),
        scope.level
      );

    case 'continue':
      return resolveContinue(scope);

    case 'enabler':
    case 'enabler_quiz':
    case 'use_case':
      return resolveContent(intent.kind, intent.ref, scope);
  }
}

async function resolveContinue(
  scope: NavigationScope
): Promise<NavigationOutcome> {
  // "Weiter lernen" is the order of work of a trainee
  if (scope.level !== 'TRAINEE') return denied(scope.level);

  const entries = await loadNextStepEntries(scope.userId, scope.catalogIds);
  const step = pickNextStep(entries, scope.plan);

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
        staticTargetFor('dashboard', 'TRAINEE'),
        'TRAINEE',
        'Du hast alle freigeschalteten Enabler abgeschlossen.'
      );
    case 'all_locked':
      return {
        kind: 'nothing',
        text: 'Im Moment ist für dich kein Enabler freigeschaltet. Sprich bitte mit deinem Trainer.',
      };
    case 'none':
      return {
        kind: 'nothing',
        text: 'Dir ist noch kein Kurs mit Enablern zugeordnet. Sprich bitte mit deinem Trainer.',
      };
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
      staticTargetFor('content_management', scope.level),
      scope.level,
      'Enabler und Use Cases bearbeitest du in der Inhaltsverwaltung.'
    );
  }

  if (kind === 'use_case') {
    const candidates = await loadTraineeUseCases(
      scope.userId,
      scope.catalogIds
    );
    const found = matchContent(ref, candidates);
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

  const candidates = await loadTraineeEnablers(scope.userId, scope.catalogIds);
  const found = matchContent(ref, candidates);
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

  // Order of work: title and hint, no link to the content (like the page)
  if (lock.locked) {
    return {
      kind: 'locked',
      text: lock.lockedByTitle
        ? `Der Enabler ${title} ist noch gesperrt. Schließe zuerst ${plainText(lock.lockedByTitle)} ab.`
        : `Der Enabler ${title} ist für dich gesperrt.`,
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
