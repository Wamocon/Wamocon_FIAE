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

import {
  isLiveDataOnlyTurn,
  resolveDataIntent,
  type HistoryTurnMessage,
} from '../dataIntent';
import type { RetrievalAccess } from '../retrievalAccess';
import type { HaiTrainingScope } from '../trainingScope';
import {
  askWhereToText,
  contentParentFromHistory,
  detectNavigationFollowUp,
  lastAnswerOfferedPage,
  targetsFromHistory,
} from './followUp';
import { foldText } from './fold';
import {
  detectNavigationIntent,
  isDirectCommand,
  isWayQuestion,
  type NavigationIntent,
} from './intent';
import { recordNavigationOutcome, type NavigationMetric } from './metrics';
import { toNavigationOffer, type NavigationOffer } from './offer';
import {
  isPageContextEnabled,
  type ResolvedPageContext,
} from '../pageContext/server';
import {
  NAVIGATION_UNAVAILABLE_TEXT,
  resolveNavigation,
  type NavigationOutcome,
} from './resolve';
import { staticTargetFor, type NavigationLevel } from './targets';

export interface NavigationFlowContext {
  /** The question was spoken (set by the chat route after the check of the organization). */
  voice?: boolean;
  /** An admin level, set by the chat route from the session, never from the message. */
  isAdmin?: boolean;
  trainingScope?: HaiTrainingScope;
  /**
   * The earlier messages of the session (server side). A request without a new
   * target ("bring mich dahin", "ja") is resolved against them.
   */
  previousMessages?: readonly HistoryTurnMessage[];
  /** A quiz round is running: a short "ja" is an answer there, not a request. */
  quizState?: { active?: boolean };
  /** The role of the turn from the server (data intent of a follow-up question). */
  userRole?: 'TRAINER' | 'TRAINEE';
  /**
   * The page the person is on (page context, ids checked against the
   * occupations). Only used to pick the enabler or use case for "diese Datei",
   * never a right.
   */
  page?: ResolvedPageContext;
}

/** Fits PipelineResult: an answer with an optional offer, nothing was changed. */
export interface NavigationFlowResult {
  response: string;
  intent: 'navigation';
  citations: [];
  navigationOffer?: NavigationOffer;
  /** A question back with the nearest targets as cards (at most three, never auto). */
  navigationChoices?: NavigationOffer[];
  /** How the platform answered, one token (for the measuring point, never text). */
  navigationOutcome?: string;
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
  // a command that is carried out needs no closing: the text says "Ich öffne ..."
  if (outcome.offer?.auto) return outcome.text;
  return `${outcome.text} ${voice ? NAVIGATION_VOICE_QUESTION : NAVIGATION_TEXT_HINT}`;
}

/**
 * The card "Auszubildende" for the answer to a question for the own trainees
 * ("Welche Azubis habe ich?", also the short follow-up "Welche mit Namen?"):
 * the live data answer stays, the person gets the direct way to the page. The
 * server builds it from the allow list for the level (never the model), it is
 * no command (no `auto`) and only trainer levels get it. Undefined for every
 * other turn.
 */
export function traineeListOfferFor(
  userMessage: string,
  context: Pick<
    NavigationFlowContext,
    'previousMessages' | 'userRole' | 'isAdmin'
  >,
  access: Pick<RetrievalAccess, 'audience'> | null
): NavigationOffer | undefined {
  if (!access || context.userRole !== 'TRAINER') return undefined;
  // only a plain question for the list (or its short follow-up), not every
  // sentence that holds the word "Azubi" ("Welche Aufgaben gebe ich meinen Azubis?")
  if (
    !isLiveDataOnlyTurn(userMessage, 'TRAINER', context.previousMessages) ||
    resolveDataIntent(userMessage, 'TRAINER', context.previousMessages) !==
      'trainee_overview'
  ) {
    return undefined;
  }
  const target = staticTargetFor(
    'trainees',
    navigationLevel(access, context.isAdmin)
  );
  if (!target) return undefined;
  return toNavigationOffer({
    path: target.path,
    label: target.label,
    reason: target.reason,
  });
}

/** The enabler or use case of the page the person is on (data of the browser, ids checked). */
function contextParentOf(
  context: NavigationFlowContext
): { type: 'enabler' | 'use_case'; id: string } | null {
  if (!context.page || !isPageContextEnabled()) return null;
  for (const entity of context.page.entities) {
    if (entity.type === 'enabler' || entity.type === 'use_case') {
      return { type: entity.type, id: entity.id };
    }
  }
  return null;
}

/** Resolve a recognized intent for the person (rights, occupation, records). */
async function resolveFor(
  intent: NavigationIntent,
  direct: boolean,
  context: NavigationFlowContext,
  access: RetrievalAccess
): Promise<NavigationOutcome> {
  const scope = context.trainingScope;
  try {
    return await resolveNavigation(intent, {
      userId: access.userId,
      level: navigationLevel(access, context.isAdmin),
      // a clear command is carried out, a question for the way is an offer
      direct,
      // the targets follow all occupations of the person, the chosen one (if
      // the access was narrowed to it) is looked at first
      catalogIds: access.allowedCatalogIds ?? access.catalogIds,
      preferredCatalogIds: access.allowedCatalogIds
        ? access.catalogIds
        : undefined,
      organizationId: access.organizationId,
      trainingScope: scope,
      // "diese Datei": the page of the person, then the last turns
      contextParent: contextParentOf(context),
      historyParent: contentParentFromHistory(context.previousMessages),
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
    return { kind: 'unavailable', text: NAVIGATION_UNAVAILABLE_TEXT };
  }
}

/** What the measuring point learns about a request: tokens only, never text. */
interface ResultMeta {
  intent: NavigationMetric['intent'];
  level: NavigationLevel;
  voice: boolean;
}

function resultOf(
  outcome: NavigationOutcome,
  voice: boolean,
  meta?: ResultMeta
): NavigationFlowResult {
  if (meta) {
    recordNavigationOutcome({
      intent: meta.intent,
      outcome: outcome.kind,
      level: meta.level,
      voice: meta.voice,
      choices: !!outcome.choices?.length,
    });
  }
  return {
    response: withClosing(outcome, voice),
    intent: 'navigation',
    citations: [],
    navigationOutcome: outcome.kind,
    ...(outcome.offer ? { navigationOffer: outcome.offer } : {}),
    ...(outcome.choices?.length ? { navigationChoices: outcome.choices } : {}),
  };
}

/**
 * A request without a new target ("dann bring mich dahin", "du navigierst",
 * "ja"): the page comes from the history of the session, on the server. Exactly
 * one page is opened (a command) or offered (a question for the way), no page
 * or several are asked back with examples of the level. A bare agreement only
 * counts right after an answer that offered a page, otherwise the message goes
 * to the pipeline as usual (null).
 */
async function handleFollowUp(
  userMessage: string,
  context: NavigationFlowContext,
  access: RetrievalAccess
): Promise<NavigationFlowResult | null> {
  const kind = detectNavigationFollowUp(userMessage);
  if (!kind) return null;
  // a short "ja" in a quiz round answers the question of the quiz
  if (kind === 'confirm') {
    if (context.quizState?.active === true) return null;
    if (!lastAnswerOfferedPage(context.previousMessages)) return null;
  }

  const level = navigationLevel(access, context.isAdmin);
  const candidates = targetsFromHistory(context.previousMessages, level);
  const voice = context.voice === true;

  if (candidates.length === 1) {
    // "wie komme ich dahin" stays an offer, the rest is a command
    const direct = !isWayQuestion(foldText(userMessage));
    const outcome = await resolveFor(
      { kind: 'static', target: candidates[0] },
      direct,
      context,
      access
    );
    return resultOf(outcome, voice, {
      intent: 'follow_up',
      level,
      voice,
    });
  }

  // none or several: ask back, no page, no card
  if (candidates.length === 0 && kind === 'confirm') return null;
  recordNavigationOutcome({
    intent: 'follow_up',
    outcome: 'follow_up_ask',
    level,
    voice,
    choices: false,
  });
  return {
    response: askWhereToText(candidates, level),
    intent: 'navigation',
    citations: [],
  };
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
  if (!intent) return handleFollowUp(userMessage, context, access);

  // A command that names nothing known may be a follow-up ("du navigierst",
  // "öffne sie"): the history decides before the platform says "no such page"
  if (intent.kind === 'unmatched') {
    const followUp = await handleFollowUp(userMessage, context, access);
    if (followUp) return followUp;
  }

  // "Zeig mir meine Azubis" asks for the list, not for the page: the pipeline
  // answers it from the live data and puts the card under the answer (an
  // "Öffne ..." and a question for the way stay navigation)
  if (
    intent.kind === 'static' &&
    intent.target === 'trainees' &&
    context.userRole === 'TRAINER' &&
    !isDirectCommand(userMessage) &&
    !isWayQuestion(foldText(userMessage)) &&
    isLiveDataOnlyTurn(userMessage, 'TRAINER', context.previousMessages)
  ) {
    return null;
  }

  // A request for a document ("Zeig mir das PDF zu ...", "Lies das Dokument")
  // is a command to open it, unless it asks for the way ("Wo finde ich ...")
  const direct =
    isDirectCommand(userMessage) ||
    (intent.kind === 'document' && !isWayQuestion(foldText(userMessage)));
  const outcome = await resolveFor(intent, direct, context, access);
  const voice = context.voice === true;
  return resultOf(outcome, voice, {
    intent: intent.kind,
    level: navigationLevel(access, context.isAdmin),
    voice,
  });
}

/** The longest name of a page a model proposal may carry. */
export const PROPOSED_PAGE_NAME_MAX = 60;

export type ProposedPage =
  | { ok: true; offer: NavigationOffer; text: string }
  | { ok: false; text: string };

/**
 * A page the MODEL proposes by name (tool `open_page` of the UI tools, see
 * uiActions/tools.ts). The name goes through the same recognition and the same
 * resolution as a request of the person (allow list, level, occupation,
 * release), so the model never chooses a path. It is always an offer for the
 * card with the button "Öffnen" (`direct` false, `auto` never set): a clear
 * command of the person is handled before the model by handleNavigationMessage.
 * Returns the answer text of the resolution when nothing can be offered, so the
 * person hears the real reason (role, unknown page, release).
 */
export async function proposePageByName(
  name: unknown,
  context: NavigationFlowContext,
  access: RetrievalAccess | null
): Promise<ProposedPage> {
  const unknown: ProposedPage = {
    ok: false,
    text: 'Diese Seite kenne ich nicht. Nenne mir bitte den Namen des Menüpunkts.',
  };
  if (!access || typeof name !== 'string') return unknown;
  const clean = name.replace(/\s+/g, ' ').trim();
  if (
    clean.length < 2 ||
    clean.length > PROPOSED_PAGE_NAME_MAX ||
    !/^[\p{L}\p{N} \-]+$/u.test(clean)
  ) {
    return unknown;
  }
  // "zeig mir" is a soft request: an offer, never an automatic change
  const intent = detectNavigationIntent(`zeig mir ${clean}`);
  if (!intent || intent.kind === 'unknown_page') return unknown;
  const outcome = await resolveFor(intent, false, context, access);
  if (outcome.kind !== 'offer' || !outcome.offer) {
    return { ok: false, text: outcome.text };
  }
  // the server decides `auto` from the command of the person, never here
  const { auto: _auto, ...offer } = outcome.offer;
  void _auto;
  return { ok: true, offer, text: outcome.text };
}
