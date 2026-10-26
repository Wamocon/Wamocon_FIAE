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
  getChatProvider,
  getEmbeddingProvider,
} from './providers';
import type {
  ChatMessage as ProviderChatMessage,
  ChatGenerateOptions,
} from './providers';
import { searchWithContext, SearchResult } from './vectorSearch';
import { fetchPageIndexContext } from './pageIndexService';
import { resolveRetrievalAccess } from './retrievalAccess';
import { citationUrl } from './citationUrl';
import type { RetrievalAccess } from './retrievalAccess';
import {
  FIAE_PERSONA,
  FOREIGN_OCCUPATION_TEXT,
  isForeignOccupationQuestion,
  type HaiPersona,
} from './persona';
import { loadHaiPersona } from './personaAccess';
import {
  buildSystemPrompt,
  buildRetrievedContext,
  PromptMode,
  getGreetingPrompt,
  getOffTopicResponse,
} from './prompts';
import { fetchDataContext } from './dataContext';
import type { UserRole } from './dataContext';
import { detectActionIntent, executeAction, ActionIntent } from './actions';
import type { HaiTrainingScope } from './trainingScope';

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
  | 'action';

export interface PipelineContext {
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
  error?: string;
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
// RETRIEVAL (shared by processMessage and processMessageStream)
// ============================================================================

export interface RetrievedContext {
  /** Vector hits plus one entry per PageIndex citation */
  searchResults: SearchResult[];
  /** Text block for the system prompt */
  retrievedContext: string;
}

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
  resolvedAccess?: RetrievalAccess | null
): Promise<RetrievedContext> {
  // The pipelines resolve the access once per turn and pass it on
  const access =
    resolvedAccess === undefined
      ? await resolveRetrievalAccess(context.userId)
      : resolvedAccess;
  if (!access) {
    console.warn(
      'HAI.ai: no retrieval scope for the user (fail closed), no index content is used'
    );
    return { searchResults: [], retrievedContext: '' };
  }

  // Step 3: Vector search — may return empty if embedding provider differs from indexing provider
  let searchResults: SearchResult[] = [];
  try {
    const searchContext = await searchWithContext(
      userMessage,
      {
        currentEnablerId: context.currentEnablerId,
        currentCourseId: context.currentCourseId,
      },
      {
        topK: 5,
        minSimilarity: 0.45,
        catalogIds: access.catalogIds,
        audience: access.audience,
        organizationId: access.organizationId,
        userId: access.userId,
        trainingScope: context.trainingScope,
      }
    );
    searchResults = searchContext.results;
  } catch (vectorError) {
    console.warn(
      'HAI.ai: Vector search failed (non-fatal, falling back to PageIndex):',
      vectorError
    );
    searchResults = [];
  }

  let retrievedContext = buildRetrievedContext(
    searchResults.map(r => ({
      content: r.content,
      similarity: r.similarity,
      metadata: r.metadata,
    }))
  );

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

  return { searchResults, retrievedContext };
}

// ============================================================================
// PERSONA (shared by processMessage and processMessageStream)
// ============================================================================

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
  const access = await resolveRetrievalAccess(context.userId);
  const persona = await loadHaiPersona(access, context.trainingScope);
  return { access, persona };
}

/**
 * Reply that ends the turn before retrieval and before any model call, or
 * null: a neutral refusal without a scope, a neutral refusal for a question
 * that names another occupation. Nothing of the other occupation is revealed.
 */
export function personaRefusal(
  userMessage: string,
  persona: HaiPersona
): string | null {
  if (persona.neutral) return persona.refusalText;
  if (isForeignOccupationQuestion(userMessage, persona)) {
    return FOREIGN_OCCUPATION_TEXT;
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
  } catch {
    return {
      response:
        'HAI.ai ist momentan nicht verfügbar. Bitte kontaktiere deinen Trainer.',
      intent: 'question',
      citations: [],
      error: 'Provider not initialized',
    };
  }

  try {
    // Step 0: Check for action intent first (Phase 3 — Write Operations)
    let actionIntent: ActionIntent | null = null;
    if (context.userRole) {
      actionIntent = detectActionIntent(userMessage, {
        userRole: context.userRole,
        currentEnablerId: context.currentEnablerId,
        currentCourseId: context.currentCourseId,
      });
    }

    // If action detected, execute it and return narrated result
    if (actionIntent && actionIntent.confidence >= 0.7) {
      const actionResult = await executeAction(
        actionIntent.type,
        actionIntent.parameters,
        context.userId
      );

      return {
        response: actionResult.message,
        intent: 'action',
        citations: [],
        actionResult: {
          success: actionResult.success,
          actionType: actionIntent.type,
          data: actionResult.data,
        },
      };
    }

    // Step 1a: Persona of the occupation (server side), refusal without a
    // scope or for a question about another occupation
    const { access, persona } = await resolveTurnPersona(context);
    const refusal = personaRefusal(userMessage, persona);
    if (refusal) {
      return { response: refusal, intent: 'off_topic', citations: [] };
    }

    // Step 1: Classify intent
    const intent = classifyIntent(userMessage, context.quizState, persona);

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

    if (intent !== 'quiz_answer' && !enableWebSearch) {
      // Vector search and PageIndex, limited to the occupation, audience and
      // organization of the user (one function for both pipelines)
      ({ searchResults, retrievedContext } = await retrieveContext(
        userMessage,
        context,
        access
      ));
    }

    // If web search is enabled, switch to general mode to allow external knowledge
    if (enableWebSearch) {
      mode = 'general';
    }

    // Step 3b: Fetch live data context (non-fatal)
    let liveDataContext: string | undefined;
    if (context.userRole) {
      try {
        const dataCtx = await fetchDataContext(
          context.userId,
          context.userRole as UserRole,
          userMessage
        );
        if (dataCtx) {
          liveDataContext = dataCtx.summary;
        }
      } catch (dataError) {
        console.warn(
          'HAI.ai: DataContext fetch failed (non-fatal):',
          dataError
        );
      }
    }

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
      userRole: context.userRole,
      conversationSummary: context.conversationSummary,
      crossSessionMemory: context.crossSessionMemory,
      trainingScope: context.trainingScope,
      persona,
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

    const responseData = await chatWithFallback(
      systemPrompt,
      providerMessages,
      userMessage,
      undefined, // no streaming
      options
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

    return {
      response: responseData.text,
      intent,
      citations,
      quizState: newQuizState,
    };
  } catch (error) {
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
  onChunk: (text: string) => void
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
    onChunk(result.response);
    return result;
  }

  try {
    // Step 0: Check for action intent first (Phase 3 — Write Operations)
    let actionIntent: ActionIntent | null = null;
    if (context.userRole) {
      actionIntent = detectActionIntent(userMessage, {
        userRole: context.userRole,
        currentEnablerId: context.currentEnablerId,
        currentCourseId: context.currentCourseId,
      });
    }

    // If action detected, execute it and return narrated result
    if (actionIntent && actionIntent.confidence >= 0.7) {
      const actionResult = await executeAction(
        actionIntent.type,
        actionIntent.parameters,
        context.userId
      );

      onChunk(actionResult.message);

      return {
        response: actionResult.message,
        intent: 'action',
        citations: [],
        actionResult: {
          success: actionResult.success,
          actionType: actionIntent.type,
          data: actionResult.data,
        },
      };
    }

    // Persona of the occupation (server side), same gate as processMessage
    const { access, persona } = await resolveTurnPersona(context);
    const refusal = personaRefusal(userMessage, persona);
    if (refusal) {
      onChunk(refusal);
      return { response: refusal, intent: 'off_topic', citations: [] };
    }

    const intent = classifyIntent(userMessage, context.quizState, persona);

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

    // Retrieve context
    let searchResults: SearchResult[] = [];
    let retrievedContext = '';

    if (intent !== 'quiz_answer' && !enableWebSearch) {
      // Same retrieval as processMessage: scoped to the user
      ({ searchResults, retrievedContext } = await retrieveContext(
        userMessage,
        context,
        access
      ));
    }

    let mode = determineMode(intent, context);
    if (enableWebSearch) {
      mode = 'general';
    }

    // Fetch live data context (non-fatal)
    let liveDataContext: string | undefined;
    if (context.userRole) {
      try {
        const dataCtx = await fetchDataContext(
          context.userId,
          context.userRole as UserRole,
          userMessage
        );
        if (dataCtx) {
          liveDataContext = dataCtx.summary;
        }
      } catch (dataError) {
        console.warn(
          'HAI.ai: DataContext fetch failed (non-fatal):',
          dataError
        );
      }
    }

    // Build prompt
    const systemPrompt = buildSystemPrompt({
      mode,
      enablerTitle: context.enablerTitle,
      courseTitle: context.courseTitle,
      scenarioText: context.scenarioText,
      retrievedContext: retrievedContext || undefined,
      liveDataContext,
      userRole: context.userRole,
      conversationSummary: context.conversationSummary,
      crossSessionMemory: context.crossSessionMemory,
      trainingScope: context.trainingScope,
      persona,
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

    const response = await chatWithFallback(
      systemPrompt,
      providerMessages,
      userMessage,
      onChunk, // streaming callback
      options
    );

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

    return {
      response: response.text,
      intent,
      citations,
    };
  } catch (error) {
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
