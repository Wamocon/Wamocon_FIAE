/**
 * Navigation step of the HAI pipeline, shared by the blocking and the
 * streaming path (like actionFlow.ts for the actions).
 *
 * A navigation request is recognized deterministically (intent.ts) and answered
 * by the server without a model call: a short text and, where a page can be
 * offered, a navigation offer for the card with the button "Öffnen". The page
 * is never changed by the text chat itself. In a spoken conversation the text
 * ends with the question "Soll ich sie öffnen?", and the answer "ja" or
 * "öffnen" is handled by the chat provider of the interface.
 *
 * It sits behind the persona gate of the pipeline (a request that names another
 * occupation, or a person without a scope, never gets here) and behind the
 * action step (a write wins). It never writes anything.
 *
 * @module lib/hai/navigation/flow
 */

import type { RetrievalAccess } from '../retrievalAccess';
import type { HaiTrainingScope } from '../trainingScope';
import { detectNavigationIntent } from './intent';
import type { NavigationOffer } from './offer';
import {
  NAVIGATION_UNAVAILABLE_TEXT,
  resolveNavigation,
  type NavigationOutcome,
} from './resolve';
import type { NavigationLevel } from './targets';

export interface NavigationFlowContext {
  /** The question was spoken (set by the chat route after the check of the organization). */
  voice?: boolean;
  /** An admin level, set by the chat route from the session, never from the message. */
  isAdmin?: boolean;
  trainingScope?: HaiTrainingScope;
}

/** Fits PipelineResult: an answer with an optional offer, nothing was changed. */
export interface NavigationFlowResult {
  response: string;
  intent: 'navigation';
  citations: [];
  navigationOffer?: NavigationOffer;
}

/** Spoken: the question that asks for the confirmation of the person. */
export const NAVIGATION_VOICE_QUESTION = 'Soll ich sie öffnen?';
/** Typed: the hint at the button, no automatic change of the page. */
export const NAVIGATION_TEXT_HINT = 'Mit Öffnen gelangst du direkt dorthin.';

/** The level of the person: the audience comes from the database through the access. */
export function navigationLevel(
  access: Pick<RetrievalAccess, 'audience'>,
  isAdmin?: boolean
): NavigationLevel {
  if (access.audience !== 'trainer') return 'TRAINEE';
  return isAdmin === true ? 'ADMIN' : 'TRAINER';
}

function withClosing(outcome: NavigationOutcome, voice: boolean): string {
  if (outcome.kind !== 'offer') return outcome.text;
  return `${outcome.text} ${voice ? NAVIGATION_VOICE_QUESTION : NAVIGATION_TEXT_HINT}`;
}

/**
 * Turn a navigation request in the message into an answer with an offer.
 * Returns null when the message holds none, so the pipeline answers it as
 * usual.
 */
export async function handleNavigationMessage(
  userMessage: string,
  context: NavigationFlowContext,
  access: RetrievalAccess | null
): Promise<NavigationFlowResult | null> {
  // Without a scope there is no navigation (the persona gate answers before)
  if (!access) return null;

  const intent = detectNavigationIntent(userMessage);
  if (!intent) return null;

  const level = navigationLevel(access, context.isAdmin);
  const scope = context.trainingScope;

  let outcome: NavigationOutcome;
  try {
    outcome = await resolveNavigation(intent, {
      userId: access.userId,
      level,
      // the targets follow all occupations of the person, the chosen one (if
      // the access was narrowed to it) is looked at first
      catalogIds: access.allowedCatalogIds ?? access.catalogIds,
      preferredCatalogIds: access.allowedCatalogIds
        ? access.catalogIds
        : undefined,
      plan: scope
        ? {
            currentPhase: scope.currentPhase,
            allowedStages: scope.allowedComponentPhases,
          }
        : null,
    });
  } catch (error) {
    // Fail closed: nothing is offered when the rights cannot be checked
    console.error('HAI.ai: navigation could not be resolved:', error);
    outcome = { kind: 'unavailable', text: NAVIGATION_UNAVAILABLE_TEXT };
  }

  return {
    response: withClosing(outcome, context.voice === true),
    intent: 'navigation',
    citations: [],
    ...(outcome.offer ? { navigationOffer: outcome.offer } : {}),
  };
}
