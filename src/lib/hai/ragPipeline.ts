/**
 * HAI.ai RAG Pipeline
 * 
 * Orchestrates the full Retrieval-Augmented Generation flow:
 * 1. Classify intent
 * 2. Retrieve relevant context
 * 3. Build prompt
 * 4. Generate response
 * 5. Add citations
 * 
 * @module lib/hai/ragPipeline
 */

import { haiClient, ChatMessage } from './client';
import { searchWithContext, SearchResult } from './vectorSearch';
import { buildSystemPrompt, buildRetrievedContext, PromptMode, getGreetingPrompt, getOffTopicResponse } from './prompts';

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
    | 'off_topic';

export interface PipelineContext {
    userId: string;
    sessionId?: string;
    currentEnablerId?: string;
    currentCourseId?: string;
    enablerTitle?: string;
    courseTitle?: string;
    scenarioText?: string;
    previousMessages?: ChatMessage[];
    quizState?: QuizState;
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
function classifyIntent(message: string, quizState?: QuizState): IntentType {
    const lowerMessage = message.toLowerCase().trim();

    // Check for greetings
    const greetings = ['hallo', 'hi', 'hey', 'guten tag', 'moin', 'servus', 'ahoi'];
    if (greetings.some(g => lowerMessage.startsWith(g)) && lowerMessage.length < 20) {
        return 'greeting';
    }

    // Check for quiz requests
    const quizKeywords = ['/quiz', 'quiz starten', 'teste mich', 'prüfe mich', 'frag mich', 'quiz zum thema'];
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
    const scenarioKeywords = ['szenario', 'aufgabe', 'hilf mir bei', 'wie löse ich', 'hinweis'];
    if (scenarioKeywords.some(k => lowerMessage.includes(k))) {
        return 'scenario_help';
    }

    // Check for code help
    const codePatterns = /```|<code>|funktion|methode|syntax|fehler im code|code.*erklär/i;
    if (codePatterns.test(message)) {
        return 'code_help';
    }

    // Check for explanation requests
    const explainKeywords = ['erklär', 'was ist', 'was sind', 'wie funktioniert', 'unterschied zwischen', 'definier'];
    if (explainKeywords.some(k => lowerMessage.includes(k))) {
        return 'explanation';
    }

    // Check for explicit web search requests
    const searchKeywords = ['such im web', 'google', 'internet', 'suche nach', 'finde heraus', 'deep dive', 'recherchier'];
    if (searchKeywords.some(k => lowerMessage.includes(k))) {
        return 'web_search';
    }

    // Check for off-topic
    const offTopicKeywords = ['wetter', 'rezept', 'film', 'musik', 'sport', 'politik', 'beziehung'];
    if (offTopicKeywords.some(k => lowerMessage.includes(k))) {
        return 'off_topic';
    }

    // Default to question
    return 'question';
}

/**
 * Determine the prompt mode based on context and intent
 */
function determineMode(intent: IntentType, context: PipelineContext): PromptMode {
    if (intent === 'quiz_request' || intent === 'quiz_answer' || context.quizState?.active) {
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

    // Check if client is initialized
    if (!haiClient.isInitialized()) {
        return {
            response: 'HAI.ai ist momentan nicht verfügbar. Bitte kontaktiere deinen Trainer.',
            intent: 'question',
            citations: [],
            error: 'Client not initialized',
        };
    }

    try {
        // Step 1: Classify intent
        const intent = classifyIntent(userMessage, context.quizState);

        // Handle special intents
        if (intent === 'greeting') {
            return {
                response: getGreetingPrompt(),
                intent,
                citations: [],
            };
        }

        if (intent === 'off_topic') {
            return {
                response: getOffTopicResponse(),
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
            const searchContext = await searchWithContext(
                userMessage,
                {
                    currentEnablerId: context.currentEnablerId,
                    currentCourseId: context.currentCourseId,
                },
                { topK: 5, minSimilarity: 0.3 }
            );

            searchResults = searchContext.results;

            // Fallback: If no relevant local context found for a question, enable web search
            if (searchResults.length === 0 && (intent === 'question' || intent === 'explanation')) {
                console.log('HAI.ai: No local context found. Enabling Web Search fallback.');
                enableWebSearch = true;
            }

            retrievedContext = buildRetrievedContext(
                searchResults.map(r => ({
                    content: r.content,
                    similarity: r.similarity,
                    metadata: r.metadata,
                }))
            );
        }

        // If web search is enabled, switch to general mode to allow external knowledge
        if (enableWebSearch) {
            mode = 'general';
        }

        // Step 4: Build system prompt
        const systemPrompt = buildSystemPrompt({
            mode,
            enablerTitle: context.enablerTitle,
            courseTitle: context.courseTitle,
            scenarioText: context.scenarioText,
            retrievedContext: retrievedContext || undefined,
            quizTopic: intent === 'quiz_request' ? extractQuizTopic(userMessage) : undefined,
        });

        // Step 5: Convert previous messages to chat format
        const chatHistory: ChatMessage[] = (context.previousMessages || []).map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: msg.parts,
        }));

        // Step 6: Generate response
        const responseData = await haiClient.generateChatResponse(
            systemPrompt,
            chatHistory,
            userMessage,
            {
                maxOutputTokens: 1024,
                temperature: intent === 'quiz_request' ? 0.8 : 0.7,
                enableWebSearch,
            }
        );

        // Step 7: Build citations from search results
        const citations: Citation[] = searchResults
            .filter(r => r.similarity >= 0.5) // Only cite high-relevance sources
            .map(r => {
                const metaTitle = r.metadata.title as string;
                const fileName = r.metadata.fileName as string;

                const displayTitle = (!metaTitle || metaTitle === 'PDF Document') && fileName
                    ? fileName
                    : metaTitle || fileName || 'Unbekannte Quelle';

                return {
                    sourceType: r.sourceType,
                    sourceId: r.sourceId,
                    title: displayTitle,
                    similarity: r.similarity,
                    url: (r.metadata.storageUrl as string) || (r.metadata.url as string) || undefined,
                };
            });

        // Merge Web Citations (from Grounding Metadata)
        if (responseData.groundingMetadata?.groundingChunks) {
            responseData.groundingMetadata.groundingChunks.forEach((chunk: any) => {
                if (chunk.web?.uri && chunk.web?.title) {
                    citations.push({
                        sourceType: 'web',
                        sourceId: 'google-search',
                        title: chunk.web.title,
                        similarity: 1.0, // Trusted source
                        url: chunk.web.uri
                    });
                }
            });
        }

        // Step 8: Update quiz state if applicable
        let newQuizState = context.quizState;
        if (intent === 'quiz_request') {
            newQuizState = {
                active: true,
                topic: extractQuizTopic(userMessage),
                currentQuestion: 1,
                totalQuestions: 5,
                score: 0,
                answers: [],
            };
        } else if (intent === 'quiz_answer' && context.quizState?.active) {
            // Quiz answer handling would be more complex in production
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
            response: 'Ups, da ist etwas schiefgelaufen! 🦈💫 Bitte versuche es noch einmal.',
            intent: 'question',
            citations: [],
            error: error instanceof Error ? error.message : 'Unknown error',
        };
    }
}

/**
 * Process a message with streaming response
 */
export async function processMessageStream(
    userMessage: string,
    context: PipelineContext,
    onChunk: (text: string) => void
): Promise<PipelineResult> {
    if (!userMessage.trim() || !haiClient.isInitialized()) {
        const result = await processMessage(userMessage, context);
        onChunk(result.response);
        return result;
    }

    try {
        const intent = classifyIntent(userMessage, context.quizState);

        // Handle special intents immediately
        if (intent === 'greeting') {
            const greeting = getGreetingPrompt();
            onChunk(greeting);
            return { response: greeting, intent, citations: [] };
        }

        if (intent === 'off_topic') {
            const offTopic = getOffTopicResponse();
            onChunk(offTopic);
            return { response: offTopic, intent, citations: [] };
        }

        // Logic to determine if we should use web search
        let enableWebSearch = intent === 'web_search';

        // Retrieve context
        let searchResults: SearchResult[] = [];
        let retrievedContext = '';

        if (intent !== 'quiz_answer' && !enableWebSearch) {
            const searchContext = await searchWithContext(
                userMessage,
                {
                    currentEnablerId: context.currentEnablerId,
                    currentCourseId: context.currentCourseId,
                },
                { topK: 5, minSimilarity: 0.3 }
            );
            searchResults = searchContext.results;

            // Fallback: If no relevant local context found for a question, enable web search
            if (searchResults.length === 0 && (intent === 'question' || intent === 'explanation')) {
                console.log('HAI.ai: No local context found. Enabling Web Search fallback.');
                enableWebSearch = true;
            }

            retrievedContext = buildRetrievedContext(
                searchResults.map(r => ({
                    content: r.content,
                    similarity: r.similarity,
                    metadata: r.metadata,
                }))
            );
        }

        let mode = determineMode(intent, context);
        // If web search is enabled, switch to general mode to allow external knowledge
        if (enableWebSearch) {
            mode = 'general';
        }

        // Build prompt
        const systemPrompt = buildSystemPrompt({
            mode,
            enablerTitle: context.enablerTitle,
            courseTitle: context.courseTitle,
            scenarioText: context.scenarioText,
            retrievedContext: retrievedContext || undefined,
        });

        const chatHistory: ChatMessage[] = (context.previousMessages || []).map(msg => ({
            role: msg.role === 'user' ? 'user' : 'model',
            parts: msg.parts,
        }));

        // Stream response with Web Search option
        const response = await haiClient.generateChatResponseStream(
            systemPrompt,
            chatHistory,
            userMessage,
            onChunk,
            {
                maxOutputTokens: 1024,
                temperature: 0.7,
                enableWebSearch
            }
        );

        // Process Local Citations
        const citations: Citation[] = searchResults
            .filter(r => r.similarity >= 0.5)
            .map(r => {
                const metaTitle = r.metadata.title as string;
                const fileName = r.metadata.fileName as string;

                const displayTitle = (!metaTitle || metaTitle === 'PDF Document') && fileName
                    ? fileName
                    : metaTitle || fileName || 'Unbekannte Quelle';

                return {
                    sourceType: r.sourceType,
                    sourceId: r.sourceId,
                    title: displayTitle,
                    similarity: r.similarity,
                    url: (r.metadata.storageUrl as string) || (r.metadata.url as string) || undefined,
                };
            });

        // Merge Web Citations (from Grounding Metadata)
        if (response.groundingMetadata?.groundingChunks) {
            response.groundingMetadata.groundingChunks.forEach((chunk: any) => {
                if (chunk.web?.uri && chunk.web?.title) {
                    citations.push({
                        sourceType: 'web',
                        sourceId: 'google-search',
                        title: chunk.web.title,
                        similarity: 1.0, // Trusted source
                        url: chunk.web.uri
                    });
                }
            });
        }

        return {
            response: response.text,
            intent,
            citations,
        };
    } catch (error) {
        console.error('HAI.ai Stream Error:', error);
        const errorMsg = 'Ups, da ist etwas schiefgelaufen! 🦈💫 Bitte versuche es noch einmal.';
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
function extractQuizTopic(message: string): string {
    // Remove quiz command
    let topic = message
        .replace(/\/quiz\s*/i, '')
        .replace(/quiz (starten|zum thema)\s*/i, '')
        .replace(/teste mich (zu|über)\s*/i, '')
        .trim();

    // If empty, default to general
    return topic || 'Allgemeine IT-Kenntnisse';
}

/**
 * Quick health check for the pipeline
 */
export async function checkPipelineHealth(): Promise<{
    clientReady: boolean;
    canGenerateEmbeddings: boolean;
}> {
    try {
        const clientReady = haiClient.isInitialized();
        let canGenerateEmbeddings = false;

        if (clientReady) {
            try {
                // Test embedding with a small string
                await haiClient.generateEmbedding('test');
                canGenerateEmbeddings = true;
            } catch (e) {
                console.warn('Health check embedding failed:', e);
            }
        }

        return { clientReady, canGenerateEmbeddings };
    } catch (error) {
        return { clientReady: false, canGenerateEmbeddings: false };
    }
}
