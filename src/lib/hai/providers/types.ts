/**
 * HAI.ai Provider Types
 *
 * Shared interfaces for all AI providers (Gemini, Claude, etc.)
 * This abstraction allows HAI to switch between providers without
 * changing the pipeline logic.
 *
 * @module lib/hai/providers/types
 */

// ============================================================================
// CHAT PROVIDER INTERFACE
// ============================================================================

export interface ChatMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface ChatGenerateOptions {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    enableWebSearch?: boolean;
}

export interface ChatCitation {
    title: string;
    url?: string;
    sourceType: 'web' | 'document' | 'enabler' | 'course' | 'quiz';
}

export interface ChatResponse {
    text: string;
    citations: ChatCitation[];
    tokenCount?: number;
    finishReason?: string;
    provider: string;
}

/**
 * Common interface for all chat providers (Gemini, Claude, etc.)
 */
export interface ChatProvider {
    /** Provider identifier (e.g., 'gemini', 'claude') */
    readonly name: string;

    /** Check if the provider is properly initialized with API keys */
    isInitialized(): boolean;

    /** Generate a complete response */
    generateResponse(
        systemPrompt: string,
        messages: ChatMessage[],
        userMessage: string,
        options?: ChatGenerateOptions
    ): Promise<ChatResponse>;

    /** Generate a streaming response */
    generateResponseStream(
        systemPrompt: string,
        messages: ChatMessage[],
        userMessage: string,
        onChunk: (text: string) => void,
        options?: ChatGenerateOptions
    ): Promise<ChatResponse>;
}

// ============================================================================
// EMBEDDING PROVIDER INTERFACE
// ============================================================================

export interface EmbeddingResult {
    embedding: number[];
    tokenCount?: number;
}

/**
 * Common interface for all embedding providers
 * NOTE: Currently only Gemini provides embeddings.
 * Claude does not have an embedding model.
 */
export interface EmbeddingProvider {
    /** Provider identifier */
    readonly name: string;

    /** Vector dimensions this provider outputs */
    readonly dimensions: number;

    /** Check if initialized */
    isInitialized(): boolean;

    /** Generate embedding for a single text */
    generateEmbedding(text: string): Promise<EmbeddingResult>;

    /** Generate embeddings for multiple texts in batch */
    generateEmbeddingsBatch(texts: string[]): Promise<EmbeddingResult[]>;
}

// ============================================================================
// PROVIDER CONFIGURATION
// ============================================================================

export type ChatProviderType = 'claude' | 'gemini' | 'auto';
export type EmbeddingProviderType = 'gemini'; // Only Gemini — Claude has no embeddings

export interface ProviderConfig {
    /** Which provider to use for chat (default: 'claude') */
    chatProvider: ChatProviderType;

    /** Which provider to use for embeddings (always 'gemini') */
    embeddingProvider: EmbeddingProviderType;

    /** Claude-specific config */
    claude: {
        apiKey: string | undefined;
        model: string;
    };

    /** Gemini-specific config */
    gemini: {
        apiKey: string | undefined;
        chatModel: string;
        embeddingModel: string;
        embeddingDimensions: number;
    };
}

/**
 * Load provider configuration from environment variables
 */
export function loadProviderConfig(): ProviderConfig {
    return {
        chatProvider: (process.env.HAI_CHAT_PROVIDER as ChatProviderType) || 'claude',
        embeddingProvider: 'gemini', // Always Gemini — Claude has no embedding model

        claude: {
            apiKey: process.env.ANTHROPIC_API_KEY,
            model: process.env.HAI_CLAUDE_MODEL || 'claude-haiku-4-5-20250929',
        },

        gemini: {
            apiKey: process.env.GEMINI_API_KEY,
            chatModel: process.env.HAI_GEMINI_CHAT_MODEL || 'gemini-2.5-flash',
            embeddingModel: process.env.HAI_GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
            embeddingDimensions: parseInt(process.env.HAI_EMBEDDING_DIMENSIONS || '768', 10),
        },
    };
}
