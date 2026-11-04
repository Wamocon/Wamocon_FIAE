/**
 * HAI.ai RAG Pipeline
 *
 * Orchestrates the full Retrieval-Augmented Generation flow:
 * 1. Classify intent
 * 2. Retrieve relevant context
 * 3. Build prompt
 * 4. Generate response (via provider abstraction)
 * 5. Add citations (local RAG + web grounding)
 *
 * CHANGES (Phase 0E — Provider Migration):
 *   - Uses chatWithFallback() directly instead of haiClient legacy layer
 *   - Native ChatCitation support (no more groundingMetadata workaround)
 *   - Uses getEmbeddingProvider() for health checks
 *   - Preserves ChatMessage type from client.ts for backward compat with chat route
 *
 * @module lib/hai/ragPipeline
 */

import { ChatMessage } from './client';
import {
  chatWithFallback,
  chatWithSokratesOnly,
  getChatProvider,
  getEmbeddingProvider,
} from './providers';
import type {
  ChatMessage as ProviderChatMessage,
  ChatGenerateOptions,
} from './providers';
import {
  CHAT_UNAVAILABLE_I18N_KEY,
  MODEL_BUSY_I18N_KEY,
  isChatUnavailableError,
  modelBusyPayload,
  type ChatUnavailableError,
} from './providers/errors';
import {
  SEARCH_UNAVAILABLE_NOTE,
  searchDeadlineMs,
  withDeadline,
} from './searchDeadline';
import { searchWithContext, SearchResult } from './vectorSearch';
import { fetchPageIndexContext } from './pageIndexService';
import { resolveRetrievalAccess } from './retrievalAccess';
import { citationUrl } from './citationUrl';
import {
  isTrainerSolutionChunk,
  searchMayUseTrainerSolutions,
  trainerSolutionsChatSokratesOnly,
} from './trainerSolutions';
import type { RetrievalAccess } from './retrievalAccess';
import {
  FIAE_PERSONA,
  isForeignOccupationQuestion,
  unselectedOccupationNamed,
  type HaiPersona,
} from './persona';
import {
  DENIAL_BERUF_TEXT,
  DENIAL_NEUTRAL_TEXT,
  denialSelectionText,
} from './denial';
import { detectAccessReasons } from './accessReasons';
import { loadHaiPersona } from './personaAccess';
import { solutionRequestRefusal } from './solutionRequest';
import { quizModeStartFor, type QuizModeStartSignal } from './quizMode/start';
import {
  buildSystemPrompt,
  buildRetrievedContext,
  PromptMode,
  getGreetingPrompt,
  getOffTopicResponse,
} from './prompts';
import { fetchDataContext } from './dataContext';
import { documentOptionsFor, isDocumentQuestion } from './documentQuery';
import { buildPageContextSection } from './pageContext/prompt';
import {
  isPageContextEnabled,
  type ResolvedPageContext,
} from './pageContext/server';
import { isDayQuestion } from './dayQuestion';
import type { UserRole } from './dataContext';
import { handleActionMessage } from './actionFlow';
import type { UiActionEvent } from './uiActions/event';
import {
  applyUiTools,
  uiStreamSink,
  uiToolsPromptFor,
  withUiNote,
  type UiToolsTurn,
} from './uiActions/flow';
import type { PendingAction } from './actionPolicy';
import {
  handleNavigationMessage,
  traineeListOfferFor,
} from './navigation/flow';
import { isLiveDataOnlyTurn } from './dataIntent';

/** Head line of the detail of an own trainee in the live data (dataContext.ts). */
const TRAINEE_DETAIL_MARKER = '**Azubi-Detail:';
import type { NavigationOffer } from './navigation/offer';
import type { HaiTrainingScope } from './trainingScope';
import {
  isLearningTechniqueQuestion,
  usesLearningTechniques,
} from './learningTechniques/detect';
import {
  loadMemoryForPrompt,
  memoryScopeFor,
  proposeMemoryForTurn,
  type MemoryProposalPayload,
} from './memory/turn';

// ============================================================================
// TYPES
// ============================================================================

export type IntentType =
  | 'greeting'
  | 'question'
  | 'quiz_request'
  | 'quiz_answer'
  | 'explanation'
  | 'scenario_help'
  | 'code_help'
  | 'web_search'
  | 'off_topic'
  | 'action'
  | 'navigation';

export interface PipelineContext {
  /**
   * Code of the occupation the user has chosen in the app (header x-catalog).
   * Only the order of the occupations of the persona, never an access right.
   */
  preferredCatalogCode?: string | null;
  userId: string;
  sessionId?: string;
  currentEnablerId?: string;
  currentCourseId?: string;
  enablerTitle?: string;
  courseTitle?: string;
  /**
   * Scenario text for the system prompt. Server source only: the chat route
   * must never copy text of the request into it (it would be an instruction
   * on system level).
   */
  scenarioText?: string;
  previousMessages?: ChatMessage[];
  quizState?: QuizState;
  /** User role for data context and role-aware prompts */
  userRole?: 'TRAINER' | 'TRAINEE';
  /** Summary of older messages for long sessions (Phase 2B) */
  conversationSummary?: string;
  /** Cross-session memory: key facts + summaries from other chats */
  crossSessionMemory?: string;
  /** Duration-aware content scope for trainee-facing answers */
  trainingScope?: HaiTrainingScope;
  /**
   * Server source only: the history or summary handed to this turn comes from a
   * session that holds trainer knowledge. With HAI_TRAINER_SOLUTIONS_CHAT=sokrates
   * such a turn is answered by Sokrates only.
   */
  holdsTrainerKnowledge?: boolean;
  /**
   * The question was spoken and the answer is read aloud (voice assistant). Set by
   * the chat route after it checked that the organization allows it, never taken
   * from the text of a message. Same pipeline, same retrieval, same guards.
   */
  voice?: boolean;
  /**
   * Filled by the pipeline with the time (ms) of its stages, only read by the chat
   * route for the timing of the voice assistant (numbers, no content).
   */
  timings?: Record<string, number>;
  /**
   * The person holds an admin level (SUPER_ADMIN, ADMIN, TEMP_ADMIN). Set by the
   * chat route from the session, only used to pick the admin pages for the
   * navigation, never taken from a message.
   */
  isAdmin?: boolean;
  /**
   * An enabler or course id of the request was dropped because it lies outside
   * the occupations of the person. Set by the chat route, only used for the
   * reason hint to the model (UMFANG), never an access right.
   */
  contextDropped?: boolean;
  /**
   * The page the person is on (page context): cleaned, its ids checked against
   * the access rules. Set by the chat route, only data for "this page" and "this
   * file", never a right. Only used in the chat and voice path, and only while
   * the switch HAI_PAGE_CONTEXT is on.
   */
  page?: ResolvedPageContext;
}

/**
 * The chat function of a turn: normally the provider chain (Gemini, with
 * Sokrates as the only fallback). A turn that holds trainer knowledge goes to
 * Sokrates only when the owner chose that (HAI_TRAINER_SOLUTIONS_CHAT=sokrates).
 */
function chatProviderFor(holdsTrainerKnowledge: boolean) {
  return holdsTrainerKnowledge && trainerSolutionsChatSokratesOnly()
    ? chatWithSokratesOnly
    : chatWithFallback;
}

export interface QuizState {
  active: boolean;
  topic?: string;
  currentQuestion?: number;
  totalQuestions?: number;
  score?: number;
  answers?: boolean[];
}

export interface PipelineResult {
  response: string;
  intent: IntentType;
  citations: Citation[];
  quizState?: QuizState;
  actionResult?: {
    success: boolean;
    actionType: string;
    data?: unknown;
  };
  /** A proposed write for the confirmation card, never executed here */
  pendingAction?: PendingAction;
  /** A page the interface can offer with a card "Öffnen", never a write */
  navigationOffer?: NavigationOffer;
  /** The nearest targets as cards for a question back (at most three, never auto) */
  navigationChoices?: NavigationOffer[];
  /** How the navigation answered (one token, for the measuring point of the client) */
  navigationOutcome?: string;
  /**
   * A checked form action for the browser (fill, focus, scroll), only with the
   * switch HAI_UI_ACTIONS on. It writes nothing: the browser only sets values in
   * the form of the current page, the person saves (docs/hai-ui-aktionen.md).
   */
  uiAction?: UiActionEvent;
  /**
   * A question of the memory (yes, no, change): the browser shows the card. The
   * entry is stored as `proposed` and has no effect before the person says yes
   * (src/lib/hai/memory/turn.ts). Only with the switch HAI_MEMORY on.
   */
  memoryProposal?: MemoryProposalPayload;
  /** The person asked to be quizzed: the browser opens the quiz card */
  quizMode?: QuizModeStartSignal;
  error?: string;
  /**
   * Set (true) only when the answer was built with text of a model solution of
   * the private bucket (trainer solutions). The chat route stores it with the
   * message and the session so that no other role gets it back as context or
   * history.
   */
  usedTrainerSolutions?: boolean;
  /**
   * i18n key of a message for the user, set when no chat provider could answer
   * (hai.error.chatUnavailable). Then `response` is empty: the caller shows the
   * message and does not store it as an answer of the assistant.
   */
  errorKey?: string;
  /**
   * Stable code next to the key: `MODEL_BUSY` when the model did not answer in
   * time or is overloaded (a retry may work). Absent for every other failure.
   */
  errorCode?: string;
  /** With MODEL_BUSY: when to try again, in seconds (a hint). */
  retryAfterSec?: number;
}

/**
 * No chat provider could answer: the primary failed and there is no Sokrates
 * fallback (or it failed too). The user gets a clear message, never a text that
 * looks like an answer, and nothing was sent to any other provider. When the
 * failure was a time limit or an overloaded model (timeout, 429, 502, 503, 504,
 * 524) the message says that (MODEL_BUSY) instead of "not reachable".
 */
function chatUnavailableResult(error?: unknown): PipelineResult {
  const busy =
    typeof error === 'object' &&
    error !== null &&
    (error as Partial<ChatUnavailableError>).modelBusy === true;
  if (busy) {
    const { code, retryAfterSec } = modelBusyPayload();
    return {
      response: '',
      intent: 'question',
      citations: [],
      error: 'model_busy',
      errorKey: MODEL_BUSY_I18N_KEY,
      errorCode: code,
      retryAfterSec,
    };
  }
  return {
    response: '',
    intent: 'question',
    citations: [],
    error: 'chat_unavailable',
    errorKey: CHAT_UNAVAILABLE_I18N_KEY,
  };
}

export interface Citation {
  sourceType: string;
  sourceId: string;
  title: string;
  similarity: number;
  url?: string;
}

// ============================================================================
// INTENT CLASSIFICATION
// ============================================================================

/**
 * Classify the user's intent based on their message
 */
export function classifyIntent(
  message: string,
  quizState?: QuizState,
  persona: HaiPersona = FIAE_PERSONA
): IntentType {
  const lowerMessage = message.toLowerCase().trim();

  // Check for greetings (German + English)
  const greetings = [
    'hallo',
    'hi',
    'hey',
    'hello',
    'guten tag',
    'guten morgen',
    'guten abend',
    'good morning',
    'good evening',
    'moin',
    'servus',
    'ahoi',
    'grüß gott',
    'na',
    'yo',
    'sup',
    'whats up',
    'was geht',
  ];
  if (
    greetings.some(g => lowerMessage.startsWith(g)) &&
    lowerMessage.length < 30
  ) {
    return 'greeting';
  }

  // Check for quiz requests
  const quizKeywords = [
    '/quiz',
    'quiz starten',
    'teste mich',
    'prüfe mich',
    'frag mich',
    'quiz zum thema',
  ];
  if (quizKeywords.some(k => lowerMessage.includes(k))) {
    return 'quiz_request';
  }

  // Check if answering a quiz
  if (quizState?.active) {
    const answerPatterns = /^[abcd]$|^option [abcd]$|^antwort [abcd]$/i;
    if (answerPatterns.test(lowerMessage.trim())) {
      return 'quiz_answer';
    }
  }

  // Check for scenario help
  const scenarioKeywords = [
    'szenario',
    'aufgabe',
    'hilf mir bei',
    'wie löse ich',
    'hinweis',
  ];
  if (scenarioKeywords.some(k => lowerMessage.includes(k))) {
    return 'scenario_help';
  }

  // Check for code help
  const codePatterns =
    /```|<code>|funktion|methode|syntax|fehler im code|code.*erklär/i;
  if (persona.codeHelp && codePatterns.test(message)) {
    return 'code_help';
  }

  // Check for explanation requests
  const explainKeywords = [
    'erklär',
    'was ist',
    'was sind',
    'wie funktioniert',
    'unterschied zwischen',
    'definier',
  ];
  if (explainKeywords.some(k => lowerMessage.includes(k))) {
    return 'explanation';
  }

  // Check for explicit web search requests
  const searchKeywords = [
    'such im web',
    'google',
    'internet',
    'suche nach',
    'finde heraus',
    'deep dive',
    'recherchier',
  ];
  if (searchKeywords.some(k => lowerMessage.includes(k))) {
    return 'web_search';
  }

  // Check for off-topic — expanded list covers common irrelevant topics
  const offTopicKeywords = [
    // Entertainment
    'wetter',
    'rezept',
    'film',
    'musik',
    'sport',
    'politik',
    'beziehung',
    'kino',
    'serie',
    'netflix',
    'spotify',
    'fußball',
    'basketball',
    'bundesliga',
    'champions league',
    'olympia',
    'konzert',
    // Food & Cooking
    'kochen',
    'backen',
    'restaurant',
    'pizza',
    'kuchen',
    'essen gehen',
    // Personal & Health
    'arzt',
    'medizin',
    'krankheit',
    'diät',
    'abnehmen',
    'fitness',
    'yoga',
    'meditation',
    'therapie',
    // Travel & Shopping
    'urlaub buchen',
    'flug buchen',
    'hotel',
    'reiseziel',
    'shopping',
    'amazon',
    'ebay',
    'bestellen',
    // General knowledge (non-IT)
    'hauptstadt',
    'planet',
    'sonnensystem',
    'tierart',
    'pflanze',
    'religion',
    'glaube',
    'kirche',
    'moschee',
    // Entertainment media
    'anime',
    'manga',
    'comic',
    'videospiel',
    'playstation',
    'xbox',
    'nintendo',
    'fortnite',
    'minecraft',
    // Social media
    'tiktok',
    'instagram',
    'snapchat',
    'twitter',
    // Celebrity
    'promi',
    'celebrity',
    'influencer',
    'sänger',
    'schauspieler',
    // Misc off-topic
    'horoskop',
    'sternzeichen',
    'lotto',
    'witze erzähl',
    'erzähl mir einen witz',
    'gedicht schreiben',
  ];
  if (offTopicKeywords.some(k => lowerMessage.includes(k))) {
    // Exception: Don't flag IT-related terms that overlap (e.g., "film" in "Filmsequenz")
    // Also don't flag if the message clearly references LFA/Enabler/LF context
    // The words come from the persona of the occupation (FIAE: the IT words,
    // KfBM: for example procurement, travel costs, hospitality)
    const itContextIndicators = persona.offTopicContextWords;
    const hasItContext = itContextIndicators.some(k =>
      lowerMessage.includes(k)
    );
    if (!hasItContext) {
      return 'off_topic';
    }
  }

  // Default to question
  return 'question';
}

/**
 * Determine the prompt mode based on context and intent
 */
/**
 * The day companion: the message asks for the own tasks, appointments or state
 * ("Was steht für mich an?"). The answer comes from the live data of the
 * person, so the turn skips the greeting, the off-topic check and the
 * knowledge search, and no source cards of the knowledge base hang under it.
 */
function isDayBriefingTurn(
  userMessage: string,
  context: PipelineContext
): boolean {
  return !!context.userRole && isDayQuestion(userMessage);
}

/**
 * A trainer asks for the own trainees or the open reviews (also as a short
 * follow-up like "Welche mit Namen?"): the answer comes from the live data
 * alone, so the turn skips the knowledge search and no source cards of the
 * knowledge base (quizzes, orders) hang under it. A knowledge question keeps
 * its search and its sources.
 */
function isLiveDataOnlyTurnOf(
  userMessage: string,
  context: PipelineContext
): boolean {
  return isLiveDataOnlyTurn(
    userMessage,
    context.userRole,
    context.previousMessages
  );
}

function determineMode(
  intent: IntentType,
  context: PipelineContext
): PromptMode {
  if (
    intent === 'quiz_request' ||
    intent === 'quiz_answer' ||
    context.quizState?.active
  ) {
    return 'quiz';
  }

  if (intent === 'scenario_help' || context.scenarioText) {
    return 'scenario';
  }

  if (context.currentEnablerId) {
    return 'enabler';
  }

  return 'general';
}

// ============================================================================
// HELPER: Convert legacy messages to provider format
// ============================================================================

/**
 * Convert legacy ChatMessage format (role: 'user'|'model', parts: [{text}])
 * to provider format (role: 'user'|'assistant', content: string).
 */
function convertToProviderMessages(
  messages: ChatMessage[]
): ProviderChatMessage[] {
  return messages.map(msg => ({
    role: msg.role === 'user' ? ('user' as const) : ('assistant' as const),
    content: msg.parts.map(p => p.text).join(''),
  }));
}

// ============================================================================
// STAGES AND LIVE DATA (shared by processMessage and processMessageStream)
// ============================================================================

/**
 * The waiting stages of a turn the client may show ("Ich suche in den
 * Unterlagen"). Data only, never a content: the stream route sends them when
 * the client asked for them.
 */
export type PipelineStage = 'search' | 'answer';

/**
 * Runs `work` and adds its duration (ms) to `context.timings[name]`, also when
 * it fails. Numbers only, read by the chat route for its timing line.
 */
async function timed<T>(
  context: PipelineContext,
  name: string,
  work: () => Promise<T>
): Promise<T> {
  const startedAt = Date.now();
  try {
    return await work();
  } finally {
    if (context.timings) {
      context.timings[name] = Date.now() - startedAt;
    }
  }
}

/** What the live data of a turn hands to the retrieval (a file the question named). */
interface DocumentTurn {
  documentIds?: string[];
  /**
   * The live data answers the question (the detail of an own trainee was
   * found): the knowledge search of this turn is dropped, no source cards of
   * the knowledge base belong to such an answer.
   */
  liveAnswer?: boolean;
}

/** The prompt section for the page of the user, or undefined (switch off, no page). */
function pageSectionFor(context: PipelineContext): string | undefined {
  if (!context.page || !isPageContextEnabled()) return undefined;
  return buildPageContextSection(context.page) || undefined;
}

/**
 * The turn as the UI tools see it (docs/hai-ui-aktionen.md): the message of the
 * person, the audience from the database access and the path of the CHECKED page
 * context (the page context has to be on for a form tool).
 */
function uiTurnOf(
  userMessage: string,
  context: PipelineContext,
  access: RetrievalAccess | null
): UiToolsTurn {
  return {
    userId: context.userId,
    userMessage,
    access,
    pagePath: context.page && isPageContextEnabled() ? context.page.path : null,
    voice: context.voice === true,
  };
}

/**
 * The live data of the person for the system prompt (non-fatal): undefined
 * without a role or when the data could not be read. Never rejects, so it can
 * run next to the retrieval and be awaited later.
 */
async function loadLiveDataContext(
  userMessage: string,
  context: PipelineContext,
  access?: RetrievalAccess | null,
  turn?: DocumentTurn
): Promise<string | undefined> {
  if (!context.userRole) return undefined;
  try {
    const dataCtx = await fetchDataContext(
      context.userId,
      context.userRole as UserRole,
      userMessage,
      {
        preferredCatalogCode: context.preferredCatalogCode,
        trainingScope: context.trainingScope,
        // for the short follow-up of a trainer ("Welche mit Namen?")
        previousMessages: context.previousMessages,
        // a question about files: what the person may read and the records of
        // the page (the database decides, not the page). Other turns get the
        // options as before.
        ...(isDocumentQuestion(userMessage)
          ? documentOptionsFor(
              access,
              context.trainingScope,
              context.page && isPageContextEnabled()
                ? context.page.entities
                : []
            )
          : {}),
      }
    );
    if (turn && dataCtx?.documentIds) turn.documentIds = dataCtx.documentIds;
    if (
      turn &&
      dataCtx?.dataIntent === 'trainee_detail_query' &&
      dataCtx.summary.includes(TRAINEE_DETAIL_MARKER)
    ) {
      turn.liveAnswer = true;
    }
    return dataCtx ? dataCtx.summary : undefined;
  } catch (dataError) {
    console.warn('HAI.ai: DataContext fetch failed (non-fatal):', dataError);
    return undefined;
  }
}

// ============================================================================
// RETRIEVAL (shared by processMessage and processMessageStream)
// ============================================================================

export interface RetrievedContext {
  /** Vector hits plus one entry per PageIndex citation */
  searchResults: SearchResult[];
  /** Text block for the system prompt */
  retrievedContext: string;
  /**
   * Set (true) only when the context holds text of a model solution of the
   * private bucket. The chat route marks the answer and the session with it, so
   * that this text never comes back as context for a role that may not have it.
   */
  usedTrainerSolutions?: boolean;
}

/**
 * Characters of the chunks of the knowledge base that go into one prompt. The
 * model reads every token of the prompt before the first word of the answer
 * (about one second per 1,000 tokens on Sokrates, docs/hai-geschwindigkeit.md).
 * Five chunks of the index are 5,000 characters on average and stay whole; the
 * budget cuts only the rare case of five long chunks (up to 3,000 characters
 * each). The chunks are in the order of their relevance, the least relevant
 * ones go first, the two most relevant ones always stay.
 */
export const RETRIEVED_CONTEXT_MAX_CHARS = 9000;
/** The most relevant chunks that always stay, whatever their length. */
const RETRIEVED_CONTEXT_MIN_CHUNKS = 2;

/**
 * The chunks that fit into the budget, in the given order. A chunk that is not
 * in the prompt is not cited either, so the caller keeps only these.
 */
export function limitToContextBudget<T extends { content: string }>(
  results: T[],
  maxChars: number = RETRIEVED_CONTEXT_MAX_CHARS
): T[] {
  const kept: T[] = [];
  let used = 0;
  for (const result of results) {
    used += result.content.length;
    if (kept.length >= RETRIEVED_CONTEXT_MIN_CHUNKS && used > maxChars) break;
    kept.push(result);
  }
  return kept;
}

/** Heading note of a chunk that holds a model solution (trainer knowledge). */
const TRAINER_SOLUTION_NOTE =
  'Hinweis: Auszüge mit der Kennzeichnung Musterlösung sind Trainerwissen und nur für Trainer. Gib sie nur im Gespräch mit dieser Person weiter.';

/**
 * Retrieve the context for one message: vector search and PageIndex, limited
 * to what the user may see. The scope (catalogs of the occupation, trainee or
 * trainer level, organization) is derived from the user id and the database,
 * not from the client. Trainees never get solutions (trainer solution PDFs,
 * quiz answers), nobody gets content of another occupation or organization.
 *
 * Fail closed: without a determinable scope no index content is used. Both
 * pipelines call this one function, so a rule lands in both.
 */
export async function retrieveContext(
  userMessage: string,
  context: PipelineContext,
  resolvedAccess?: RetrievalAccess | null,
  retrieval: { documentIds?: string[] } = {}
): Promise<RetrievedContext> {
  // The pipelines resolve the access once per turn and pass it on
  const access =
    resolvedAccess === undefined
      ? await resolveRetrievalAccess(
          context.userId,
          context.preferredCatalogCode
        )
      : resolvedAccess;
  if (!access) {
    console.warn(
      'HAI.ai: no retrieval scope for the user (fail closed), no index content is used'
    );
    return { searchResults: [], retrievedContext: '' };
  }

  // Step 3: Vector search — may return empty if embedding provider differs from indexing provider.
  // A search that could not run (embedding at Sokrates timed out, database
  // failed, time limit of a question about the own data) is not "nothing found":
  // the turn goes on without it and the prompt says so.
  let searchResults: SearchResult[] = [];
  let searchUnavailable = false;
  try {
    const outcome = await withDeadline(
      searchWithContext(
        userMessage,
        {
          currentEnablerId: context.currentEnablerId,
          currentCourseId: context.currentCourseId,
          // A question about learning reserves places for learning cards
          ...(isLearningTechniqueQuestion(userMessage)
            ? { includeLearningTechniques: true }
            : {}),
        },
        {
          topK: 5,
          minSimilarity: 0.45,
          catalogIds: access.catalogIds,
          audience: access.audience,
          organizationId: access.organizationId,
          userId: access.userId,
          trainingScope: context.trainingScope,
          // model solutions of the private bucket: only with this permission,
          // which comes from the role in the database and the server switch
          includeTrainerSolutions: access.includeTrainerSolutions,
        }
      ),
      // a question about the own data does not wait long for the search
      context.userRole ? searchDeadlineMs(userMessage) : null
    );
    if (outcome.timedOut) {
      console.warn(
        'HAI.ai: knowledge search took too long for a question about the own data, going on without it'
      );
      searchUnavailable = true;
    } else {
      searchResults = outcome.value.results;
      if (outcome.value.unavailable) searchUnavailable = true;
    }
  } catch (vectorError) {
    console.warn(
      'HAI.ai: Vector search failed (non-fatal, falling back to PageIndex):',
      vectorError
    );
    searchResults = [];
    searchUnavailable = true;
  }

  // Second guard behind the SQL filter: a chunk of a model solution of the
  // private bucket stays out unless this access may have it
  const mayUseSolutions = searchMayUseTrainerSolutions(access);
  if (!mayUseSolutions) {
    searchResults = searchResults.filter(
      r => !isTrainerSolutionChunk(r.metadata)
    );
  }
  // the prompt gets as many chunks as fit the budget (relevance order)
  searchResults = limitToContextBudget(searchResults);
  const usedTrainerSolutions =
    mayUseSolutions &&
    searchResults.some(r => isTrainerSolutionChunk(r.metadata));

  let retrievedContext = buildRetrievedContext(
    searchResults.map(r => ({
      content: r.content,
      similarity: r.similarity,
      metadata: r.metadata,
    }))
  );
  if (usedTrainerSolutions) {
    retrievedContext = `${TRAINER_SOLUTION_NOTE}\n\n${retrievedContext}`;
  }
  // no search, no text: the model is told why instead of "nothing was found"
  if (searchUnavailable && !retrievedContext) {
    retrievedContext = SEARCH_UNAVAILABLE_NOTE;
  }

  // PageIndex — fetch relevant PDF pages at query time (non-fatal)
  try {
    const pageIndexResult = await fetchPageIndexContext(
      userMessage,
      searchResults,
      {
        currentEnablerId: context.currentEnablerId,
        currentCourseId: context.currentCourseId,
        trainingScope: context.trainingScope,
        catalogIds: access.catalogIds,
        audience: access.audience,
        organizationId: access.organizationId,
        documentIds: retrieval.documentIds,
      }
    );
    if (pageIndexResult.pdfContext) {
      retrievedContext = retrievedContext
        ? `${retrievedContext}\n\n${pageIndexResult.pdfContext}`
        : pageIndexResult.pdfContext;

      // Add PageIndex citations to search results for citation merging. The
      // URL is only there for documents that trainees may see.
      for (const pCit of pageIndexResult.citations) {
        searchResults.push({
          id: `pageindex-${pCit.documentId}-p${pCit.pageNumber}`,
          chunkIndex: pCit.pageNumber,
          content: `[PDF Page ${pCit.pageNumber}]`,
          similarity: pCit.relevanceScore,
          sourceType: 'document',
          sourceId: pCit.documentId,
          metadata: {
            title: pCit.documentTitle,
            fileName: pCit.fileName,
            storageUrl: pCit.storageUrl,
            page: pCit.pageNumber,
            sourceType: 'pageindex',
          },
        });
      }
    }
  } catch (pageIndexError) {
    console.warn('HAI.ai: PageIndex fetch failed (non-fatal):', pageIndexError);
  }

  return {
    searchResults,
    retrievedContext,
    ...(usedTrainerSolutions ? { usedTrainerSolutions: true } : {}),
  };
}

// ============================================================================
// PERSONA (shared by processMessage and processMessageStream)
// ============================================================================

/**
 * Role that the system prompt states. The audience of the server (account and
 * role in the database) wins over what the context carries, so a role claimed
 * in a message or a request never reaches the prompt. Without access the role
 * of the context is used (it comes from the route, which reads the account).
 */
export function promptRoleOf(
  access: RetrievalAccess | null | undefined,
  userRole: PipelineContext['userRole']
): PipelineContext['userRole'] {
  if (!access) return userRole;
  return access.audience === 'trainer' ? 'TRAINER' : 'TRAINEE';
}

export interface TurnPersona {
  /** What the user may read, null without a scope (fail closed). */
  access: RetrievalAccess | null;
  /** Persona of the occupation of the user, neutral without a scope. */
  persona: HaiPersona;
}

/**
 * Access and persona of one turn, both from the server: the access comes from
 * the user id and the database, the persona from the settings of the catalogs
 * of that access, the role and the training phase. Both pipelines call this
 * one function.
 */
export async function resolveTurnPersona(
  context: PipelineContext
): Promise<TurnPersona> {
  // The occupation chosen in the app limits the access (search and page index)
  // and the persona to that one occupation, a code outside the occupations of
  // the user is ignored (retrievalAccess.ts)
  const access = await resolveRetrievalAccess(
    context.userId,
    context.preferredCatalogCode
  );
  const persona = await loadHaiPersona(
    access,
    context.trainingScope,
    context.preferredCatalogCode
  );
  return { access, persona };
}

/**
 * Reply that ends the turn before retrieval and before any model call, or
 * null: a refusal without a scope (reason FREIGABE), a refusal for a question
 * that names another occupation (reason BERUF), the hint to switch the tab for
 * a question about another occupation that the user has too but did not choose
 * (reason AUSWAHL). All of them name the reason in plain words and offer what
 * is possible instead, nothing of another occupation is revealed, the AUSWAHL
 * text names only the two occupations of the user (src/lib/hai/denial.ts).
 */
export function personaRefusal(
  userMessage: string,
  persona: HaiPersona
): string | null {
  if (persona.neutral) return DENIAL_NEUTRAL_TEXT;
  // Another occupation that the user does not have comes first
  if (isForeignOccupationQuestion(userMessage, persona)) {
    return DENIAL_BERUF_TEXT;
  }
  const unselected = unselectedOccupationNamed(userMessage, persona);
  if (unselected && persona.chosenLabel) {
    return denialSelectionText(persona.chosenLabel, unselected.name);
  }
  return null;
}

// ============================================================================
// MAIN PIPELINE
// ============================================================================

/**
 * Process a user message through the full RAG pipeline
 *
 * @param userMessage - The user's message
 * @param context - Current context (enabler, course, previous messages)
 * @returns Generated response with citations
 */
export async function processMessage(
  userMessage: string,
  context: PipelineContext
): Promise<PipelineResult> {
  // Input validation
  if (!userMessage.trim()) {
    return {
      response: 'Bitte stelle eine Frage, ich bin bereit! 🦈',
      intent: 'greeting',
      citations: [],
    };
  }

  // Check if providers are ready
  try {
    const chatProvider = getChatProvider();
    if (!chatProvider.isInitialized()) {
      throw new Error('Chat provider not initialized');
    }
  } catch (gateError) {
    if (isChatUnavailableError(gateError)) {
      return chatUnavailableResult(gateError);
    }
    return {
      response:
        'HAI.ai ist momentan nicht verfügbar. Bitte kontaktiere deinen Trainer.',
      intent: 'question',
      citations: [],
      error: 'Provider not initialized',
    };
  }

  try {
    // Step 1a: Persona of the occupation (server side), refusal without a
    // scope or for a question about another occupation
    const { access, persona } = await resolveTurnPersona(context);
    const refusal = personaRefusal(userMessage, persona);
    if (refusal) {
      return { response: refusal, intent: 'off_topic', citations: [] };
    }

    // A request for a solution is refused before retrieval and the model, by
    // the audience of the server (never by what the message claims)
    const solutionRefusal = solutionRequestRefusal(
      userMessage,
      access?.audience
    );
    if (solutionRefusal) {
      return { response: solutionRefusal, intent: 'question', citations: [] };
    }

    // A request to be quizzed ("Frag mich zu SQL ab") ends here with a fixed
    // text and the start signal of the quiz card: no retrieval, no model, so
    // no question and no answer comes from the model (quiz mode)
    const quizStart = quizModeStartFor(userMessage, context);
    if (quizStart) {
      return {
        response: quizStart.response,
        intent: 'quiz_request',
        citations: [],
        quizMode: quizStart.quizMode,
      };
    }

    // Step 1b: An action in the message becomes a proposal, never a write.
    // Behind the persona gate: without a scope or for a message about another
    // occupation there is no proposal.
    const actionResponse = await handleActionMessage(userMessage, context);
    if (actionResponse) return actionResponse;

    // Step 1c: A request to go to a page is answered by the server with a
    // navigation offer (a card "Öffnen"), no model call, never a write
    const navigationResponse = await handleNavigationMessage(
      userMessage,
      context,
      access
    );
    if (navigationResponse) return navigationResponse;

    // Step 1: Classify intent
    const dayBriefing = isDayBriefingTurn(userMessage, context);
    const liveOnly = isLiveDataOnlyTurnOf(userMessage, context);
    const intent: IntentType =
      dayBriefing || liveOnly
        ? 'question'
        : classifyIntent(userMessage, context.quizState, persona);

    // Handle special intents
    if (intent === 'greeting') {
      return {
        response: getGreetingPrompt(persona),
        intent,
        citations: [],
      };
    }

    if (intent === 'off_topic') {
      return {
        response: getOffTopicResponse(persona),
        intent,
        citations: [],
      };
    }

    // Logic to determine if we should use web search
    let enableWebSearch = intent === 'web_search';

    // Step 2: Determine mode
    let mode = determineMode(intent, context);

    // Step 3: Retrieve relevant context (skip for quiz answers)
    let searchResults: SearchResult[] = [];
    let retrievedContext = '';
    let usedTrainerSolutions: boolean | undefined;

    // Step 3b: live data context (non-fatal). It runs next to the retrieval,
    // the two do not depend on each other.
    const documentTurn: DocumentTurn = {};
    const liveDataPromise = loadLiveDataContext(
      userMessage,
      context,
      access,
      documentTurn
    );
    // Step 3b2: the memory of the person in the occupation of this turn (never
    // rejects, empty without the switch HAI_MEMORY), runs next to the retrieval
    const memoryScope = memoryScopeFor(access, persona);
    const memoryPromise = loadMemoryForPrompt(memoryScope);

    if (
      intent !== 'quiz_answer' &&
      !enableWebSearch &&
      !dayBriefing &&
      !liveOnly
    ) {
      // A question about files: the file it names comes from the database (the
      // live data), so the retrieval waits for it and loads its pages
      if (isDocumentQuestion(userMessage)) await liveDataPromise;
      // Vector search and PageIndex, limited to the occupation, audience and
      // organization of the user (one function for both pipelines)
      ({ searchResults, retrievedContext, usedTrainerSolutions } =
        await retrieveContext(userMessage, context, access, documentTurn));
    }

    // If web search is enabled, switch to general mode to allow external knowledge
    if (enableWebSearch) {
      mode = 'general';
    }

    const liveDataContext = await liveDataPromise;
    const memory = await memoryPromise;
    // the live data answered (detail of an own trainee): no knowledge sources
    if (documentTurn.liveAnswer) {
      searchResults = [];
      retrievedContext = '';
      usedTrainerSolutions = undefined;
    }

    // Step 3c: what the pipeline knows about a limit of access (denial.ts)
    const accessReasons = detectAccessReasons({
      message: userMessage,
      audience: access?.audience ?? 'trainee',
      searchEmpty:
        intent !== 'quiz_answer' &&
        !enableWebSearch &&
        !dayBriefing &&
        !liveOnly &&
        !documentTurn.liveAnswer &&
        !retrievedContext,
      contextDropped: context.contextDropped === true,
      liveDataContext,
    });

    // Step 4: Build system prompt
    const systemPrompt = buildSystemPrompt({
      mode,
      enablerTitle: context.enablerTitle,
      courseTitle: context.courseTitle,
      scenarioText: context.scenarioText,
      retrievedContext: retrievedContext || undefined,
      quizTopic:
        intent === 'quiz_request'
          ? extractQuizTopic(userMessage, persona)
          : undefined,
      liveDataContext,
      userRole: promptRoleOf(access, context.userRole),
      conversationSummary: context.conversationSummary,
      crossSessionMemory: context.crossSessionMemory,
      trainingScope: context.trainingScope,
      persona,
      learningTechniques: usesLearningTechniques(userMessage, searchResults),
      voice: context.voice === true,
      navigation: true,
      accessReasons,
      dayBriefing,
      pageContext: pageSectionFor(context),
      uiTools: uiToolsPromptFor(uiTurnOf(userMessage, context, access)),
      ...(memory ? { memory } : {}),
    });

    // Step 5: Convert previous messages to provider format
    const providerMessages = convertToProviderMessages(
      context.previousMessages || []
    );

    // Step 6: Generate response via provider factory (with automatic fallback)
    // Token budget: quizzes/scenarios need longer output, simple Q&A can be shorter
    const getMaxTokens = () => {
      if (intent === 'quiz_request' || intent === 'scenario_help') return 3000;
      if (intent === 'explanation' || intent === 'code_help') return 2048;
      return 1024;
    };
    const options: ChatGenerateOptions = {
      maxOutputTokens: getMaxTokens(),
      temperature: intent === 'quiz_request' ? 0.8 : 0.7,
      enableWebSearch,
    };

    const responseData = await chatProviderFor(
      !!usedTrainerSolutions || !!context.holdsTrainerKnowledge
    )(
      systemPrompt,
      providerMessages,
      userMessage,
      undefined, // no streaming
      options
    );

    // UI tools (switch HAI_UI_ACTIONS): the block of the model is cut out of the
    // answer and checked on the server. Without the switch the text is as it was.
    const uiOutcome = await applyUiTools(
      responseData.text,
      uiTurnOf(userMessage, context, access),
      context,
      access
    );

    // Step 7: Build citations from search results (local RAG)
    const citations: Citation[] = searchResults
      .filter(r => r.similarity >= 0.5) // Only cite high-relevance sources
      .map(r => {
        const metaTitle = r.metadata.title as string;
        const fileName = r.metadata.fileName as string;

        const displayTitle =
          (!metaTitle || metaTitle === 'PDF Document') && fileName
            ? fileName
            : metaTitle || fileName || 'Unbekannte Quelle';

        return {
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          title: displayTitle,
          similarity: r.similarity,
          url: citationUrl(r),
        };
      });

    // Merge web citations (from provider's native citation support)
    if (responseData.citations && responseData.citations.length > 0) {
      for (const webCitation of responseData.citations) {
        if (webCitation.sourceType === 'web' && webCitation.url) {
          citations.push({
            sourceType: 'web',
            sourceId: 'google-search',
            title: webCitation.title,
            similarity: 1.0, // Trusted source
            url: webCitation.url,
          });
        }
      }
    }

    // Step 8: Update quiz state if applicable
    let newQuizState = context.quizState;
    if (intent === 'quiz_request') {
      newQuizState = {
        active: true,
        topic: extractQuizTopic(userMessage, persona),
        currentQuestion: 1,
        totalQuestions: 5,
        score: 0,
        answers: [],
      };
    } else if (intent === 'quiz_answer' && context.quizState?.active) {
      newQuizState = {
        ...context.quizState,
        currentQuestion: (context.quizState.currentQuestion || 0) + 1,
      };
    }

    // A question of the memory (yes, no, change), at most one per conversation,
    // never in a quiz round (null without the switch HAI_MEMORY)
    const memoryProposal = await proposeMemoryForTurn({
      scope: memoryScope,
      message: userMessage,
      sessionId: context.sessionId,
      voice: context.voice === true,
      quizActive: isQuizRound(intent, context.quizState),
    });

    // A question for the list of the own trainees also gets the card to the
    // page "Auszubildende" (the server builds it, never the model)
    const listOffer = traineeListOfferFor(userMessage, context, access);

    const offer = listOffer ?? uiOutcome.navigationOffer;
    return {
      response: withUiNote(uiOutcome),
      intent,
      citations,
      quizState: newQuizState,
      ...(usedTrainerSolutions ? { usedTrainerSolutions: true } : {}),
      ...(memoryProposal ? { memoryProposal } : {}),
      ...(offer ? { navigationOffer: offer } : {}),
      ...(uiOutcome.uiAction ? { uiAction: uiOutcome.uiAction } : {}),
    };
  } catch (error) {
    if (isChatUnavailableError(error)) return chatUnavailableResult(error);
    console.error('HAI.ai Pipeline Error:', error);
    return {
      response:
        'Ups, da ist etwas schiefgelaufen! 🦈💫 Bitte versuche es noch einmal.',
      intent: 'question',
      citations: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

/**
 * Process a message with streaming response.
 * Uses chatWithFallback() with onChunk callback for real-time streaming.
 */
export async function processMessageStream(
  userMessage: string,
  context: PipelineContext,
  onChunk: (text: string) => void,
  onStage?: (stage: PipelineStage) => void
): Promise<PipelineResult> {
  // Quick validation — fall back to non-streaming for empty/uninitialized
  if (!userMessage.trim()) {
    const result = await processMessage(userMessage, context);
    onChunk(result.response);
    return result;
  }

  try {
    getChatProvider(); // Throws if not initialized
  } catch {
    const result = await processMessage(userMessage, context);
    // a result with an errorKey has no text: the caller shows the message
    if (result.response) onChunk(result.response);
    return result;
  }

  try {
    // Persona of the occupation (server side), same gate as processMessage
    const { access, persona } = await resolveTurnPersona(context);
    const refusal = personaRefusal(userMessage, persona);
    if (refusal) {
      onChunk(refusal);
      return { response: refusal, intent: 'off_topic', citations: [] };
    }

    // A request for a solution is refused before retrieval and the model, like
    // in processMessage
    const solutionRefusal = solutionRequestRefusal(
      userMessage,
      access?.audience
    );
    if (solutionRefusal) {
      onChunk(solutionRefusal);
      return { response: solutionRefusal, intent: 'question', citations: [] };
    }

    // A request to be quizzed: fixed text and start signal, like in
    // processMessage (quiz mode)
    const quizStart = quizModeStartFor(userMessage, context);
    if (quizStart) {
      onChunk(quizStart.response);
      return {
        response: quizStart.response,
        intent: 'quiz_request',
        citations: [],
        quizMode: quizStart.quizMode,
      };
    }

    // An action in the message becomes a proposal, never a write (behind the
    // persona gate, like in processMessage)
    const actionResponse = await handleActionMessage(userMessage, context);
    if (actionResponse) {
      onChunk(actionResponse.response);
      return actionResponse;
    }

    // A navigation request is answered by the server, like in processMessage
    const navigationResponse = await handleNavigationMessage(
      userMessage,
      context,
      access
    );
    if (navigationResponse) {
      onChunk(navigationResponse.response);
      return navigationResponse;
    }

    const dayBriefing = isDayBriefingTurn(userMessage, context);
    const liveOnly = isLiveDataOnlyTurnOf(userMessage, context);
    const intent: IntentType =
      dayBriefing || liveOnly
        ? 'question'
        : classifyIntent(userMessage, context.quizState, persona);

    // Handle special intents immediately
    if (intent === 'greeting') {
      const greeting = getGreetingPrompt(persona);
      onChunk(greeting);
      return { response: greeting, intent, citations: [] };
    }

    if (intent === 'off_topic') {
      const offTopic = getOffTopicResponse(persona);
      onChunk(offTopic);
      return { response: offTopic, intent, citations: [] };
    }

    // Logic to determine if we should use web search
    let enableWebSearch = intent === 'web_search';

    // Retrieve context and fetch the live data at the same time: they do not
    // depend on each other, so the turn waits for the slower one, not for both
    let searchResults: SearchResult[] = [];
    let retrievedContext = '';
    let usedTrainerSolutions: boolean | undefined;

    const searchStartedAt = Date.now();
    const documentTurn: DocumentTurn = {};
    const liveDataPromise = timed(context, 'data', () =>
      loadLiveDataContext(userMessage, context, access, documentTurn)
    );
    // the memory of the person in the occupation of this turn (never rejects,
    // empty without the switch HAI_MEMORY)
    const memoryScope = memoryScopeFor(access, persona);
    const memoryPromise = loadMemoryForPrompt(memoryScope);
    if (
      intent !== 'quiz_answer' &&
      !enableWebSearch &&
      !dayBriefing &&
      !liveOnly
    ) {
      // Same retrieval as processMessage: scoped to the user
      onStage?.('search');
      const retrievalStartedAt = Date.now();
      // A question about files: the file it names comes from the database (the
      // live data), so the retrieval waits for it and loads its pages
      if (isDocumentQuestion(userMessage)) await liveDataPromise;
      ({ searchResults, retrievedContext, usedTrainerSolutions } =
        await retrieveContext(userMessage, context, access, documentTurn));
      if (context.timings) {
        context.timings.retrieval = Date.now() - retrievalStartedAt;
      }
    }

    let mode = determineMode(intent, context);
    if (enableWebSearch) {
      mode = 'general';
    }

    // Live data context (non-fatal, never rejects)
    const liveDataContext = await liveDataPromise;
    const memory = await memoryPromise;
    // the live data answered (detail of an own trainee): no knowledge sources
    if (documentTurn.liveAnswer) {
      searchResults = [];
      retrievedContext = '';
      usedTrainerSolutions = undefined;
    }

    // retrieval and live data are done: the model call is what is left to wait for
    if (context.timings) context.timings.search = Date.now() - searchStartedAt;
    onStage?.('answer');

    // What the pipeline knows about a limit of access (denial.ts)
    const accessReasons = detectAccessReasons({
      message: userMessage,
      audience: access?.audience ?? 'trainee',
      searchEmpty:
        intent !== 'quiz_answer' &&
        !enableWebSearch &&
        !dayBriefing &&
        !liveOnly &&
        !documentTurn.liveAnswer &&
        !retrievedContext,
      contextDropped: context.contextDropped === true,
      liveDataContext,
    });

    // Build prompt
    const systemPrompt = buildSystemPrompt({
      mode,
      enablerTitle: context.enablerTitle,
      courseTitle: context.courseTitle,
      scenarioText: context.scenarioText,
      retrievedContext: retrievedContext || undefined,
      liveDataContext,
      userRole: promptRoleOf(access, context.userRole),
      conversationSummary: context.conversationSummary,
      crossSessionMemory: context.crossSessionMemory,
      trainingScope: context.trainingScope,
      persona,
      learningTechniques: usesLearningTechniques(userMessage, searchResults),
      voice: context.voice === true,
      navigation: true,
      accessReasons,
      dayBriefing,
      pageContext: pageSectionFor(context),
      uiTools: uiToolsPromptFor(uiTurnOf(userMessage, context, access)),
      ...(memory ? { memory } : {}),
    });

    // Convert messages to provider format
    const providerMessages = convertToProviderMessages(
      context.previousMessages || []
    );

    // Stream response via provider factory (with automatic fallback + web search routing)
    // Token budget: quizzes/scenarios need longer output, simple Q&A can be shorter
    const getStreamMaxTokens = () => {
      if (intent === 'quiz_request' || intent === 'scenario_help') return 3000;
      if (intent === 'explanation' || intent === 'code_help') return 2048;
      return 1024;
    };
    const options: ChatGenerateOptions = {
      maxOutputTokens: getStreamMaxTokens(),
      temperature: 0.7,
      enableWebSearch,
    };

    // With the switch HAI_UI_ACTIONS on, a filter keeps the block of the UI
    // tools off the stream, without it the sink is onChunk itself
    const uiSink = uiStreamSink(onChunk);
    const response = await chatProviderFor(
      !!usedTrainerSolutions || !!context.holdsTrainerKnowledge
    )(
      systemPrompt,
      providerMessages,
      userMessage,
      uiSink.push, // streaming callback
      options
    );
    uiSink.flush();
    const uiOutcome = await applyUiTools(
      response.text,
      uiTurnOf(userMessage, context, access),
      context,
      access
    );
    // the fixed sentence of the server (what was filled, or why not) follows
    // the streamed text, so the stream and the stored answer are the same
    if (uiOutcome.note) {
      onChunk(withUiNote(uiOutcome).slice(uiOutcome.text.length));
    }

    // Process local RAG citations
    const citations: Citation[] = searchResults
      .filter(r => r.similarity >= 0.5)
      .map(r => {
        const metaTitle = r.metadata.title as string;
        const fileName = r.metadata.fileName as string;

        const displayTitle =
          (!metaTitle || metaTitle === 'PDF Document') && fileName
            ? fileName
            : metaTitle || fileName || 'Unbekannte Quelle';

        return {
          sourceType: r.sourceType,
          sourceId: r.sourceId,
          title: displayTitle,
          similarity: r.similarity,
          url: citationUrl(r),
        };
      });

    // Merge web citations from provider
    if (response.citations && response.citations.length > 0) {
      for (const webCitation of response.citations) {
        if (webCitation.sourceType === 'web' && webCitation.url) {
          citations.push({
            sourceType: 'web',
            sourceId: 'google-search',
            title: webCitation.title,
            similarity: 1.0,
            url: webCitation.url,
          });
        }
      }
    }

    // A question of the memory, like in processMessage (the card comes with the
    // end event, after the text)
    const memoryProposal = await proposeMemoryForTurn({
      scope: memoryScope,
      message: userMessage,
      sessionId: context.sessionId,
      voice: context.voice === true,
      quizActive: isQuizRound(intent, context.quizState),
    });

    // The card to the page "Auszubildende" for a question for the list of the
    // own trainees, like in processMessage
    const listOffer = traineeListOfferFor(userMessage, context, access);

    const offer = listOffer ?? uiOutcome.navigationOffer;
    return {
      response: withUiNote(uiOutcome),
      intent,
      citations,
      ...(usedTrainerSolutions ? { usedTrainerSolutions: true } : {}),
      ...(memoryProposal ? { memoryProposal } : {}),
      ...(offer ? { navigationOffer: offer } : {}),
      ...(uiOutcome.uiAction ? { uiAction: uiOutcome.uiAction } : {}),
    };
  } catch (error) {
    if (isChatUnavailableError(error)) return chatUnavailableResult(error);
    console.error('HAI.ai Stream Error:', error);
    const errorMsg =
      'Ups, da ist etwas schiefgelaufen! 🦈💫 Bitte versuche es noch einmal.';
    onChunk(errorMsg);
    return {
      response: errorMsg,
      intent: 'question',
      citations: [],
      error: error instanceof Error ? error.message : 'Unknown error',
    };
  }
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * A quiz round of the chat is running or starts with this message: the memory
 * never asks a question in the middle of it.
 */
function isQuizRound(intent: IntentType, quizState?: QuizState): boolean {
  return (
    quizState?.active === true ||
    intent === 'quiz_request' ||
    intent === 'quiz_answer'
  );
}

/**
 * Extract quiz topic from user message
 */
function extractQuizTopic(
  message: string,
  persona: HaiPersona = FIAE_PERSONA
): string {
  // Remove quiz command
  const topic = message
    .replace(/\/quiz\s*/i, '')
    .replace(/quiz (starten|zum thema)\s*/i, '')
    .replace(/teste mich (zu|über)\s*/i, '')
    .trim();

  return topic || persona.quizDefaultTopic;
}

/**
 * Quick health check for the pipeline.
 * Now checks providers directly instead of legacy client.
 */
export async function checkPipelineHealth(): Promise<{
  clientReady: boolean;
  canGenerateEmbeddings: boolean;
}> {
  try {
    const chatProvider = getChatProvider();
    const clientReady = chatProvider.isInitialized();
    let canGenerateEmbeddings = false;

    if (clientReady) {
      try {
        const embeddingProvider = getEmbeddingProvider();
        if (embeddingProvider.isInitialized()) {
          await embeddingProvider.generateEmbedding('test');
          canGenerateEmbeddings = true;
        }
      } catch (e) {
        console.warn('Health check embedding failed:', e);
      }
    }

    return { clientReady, canGenerateEmbeddings };
  } catch {
    return { clientReady: false, canGenerateEmbeddings: false };
  }
}
