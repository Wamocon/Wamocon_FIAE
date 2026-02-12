/**
 * HAI.ai Client (Legacy Compatibility Layer)
 *
 * This file now delegates to the new provider abstraction.
 * It preserves the old API surface so existing code (embeddings.ts,
 * vectorSearch.ts, ragPipeline.ts) continues to work without changes
 * until they are individually migrated.
 *
 * CHANGES FROM ORIGINAL:
 * - Embedding model: text-embedding-004 → gemini-embedding-001
 * - Embedding now has retry logic for 429 errors
 * - Chat delegated to provider factory (Claude primary, Gemini fallback)
 * - This file will be gradually replaced as pipeline migrates to providers
 *
 * @module lib/hai/client
 */

import { getEmbeddingProvider, getChatProvider, chatWithFallback } from './providers';
import type { ChatMessage as ProviderChatMessage, ChatGenerateOptions } from './providers';

// ============================================================================
// TYPES (preserved for backward compatibility)
// ============================================================================

export interface ChatMessage {
    role: 'user' | 'model';
    parts: { text: string }[];
}

export interface GenerateOptions {
    maxOutputTokens?: number;
    temperature?: number;
    topP?: number;
    topK?: number;
    stopSequences?: string[];
    enableWebSearch?: boolean;
}

export interface EmbeddingResult {
    embedding: number[];
    tokenCount?: number;
}

export interface ChatResponse {
    text: string;
    tokenCount?: number;
    finishReason?: string;
    groundingMetadata?: any;
}

// ============================================================================
// CLIENT CLASS (delegates to providers)
// ============================================================================

class HaiGeminiClient {
    /**
     * Check if the client is properly initialized.
     * Now checks if at least one chat provider + embedding provider are ready.
     */
    isInitialized(): boolean {
        try {
            const embedding = getEmbeddingProvider();
            const chat = getChatProvider();
            return embedding.isInitialized() && chat.isInitialized();
        } catch {
            return false;
        }
    }

    /**
     * Generate a chat response.
     * Now delegates to provider factory with automatic fallback.
     */
    async generateChatResponse(
        systemPrompt: string,
        messages: ChatMessage[],
        userMessage: string,
        options: GenerateOptions = {}
    ): Promise<ChatResponse> {
        // Convert legacy message format to provider format
        const providerMessages: ProviderChatMessage[] = messages.map(m => ({
            role: m.role === 'user' ? 'user' as const : 'assistant' as const,
            content: m.parts.map(p => p.text).join(''),
        }));

        const providerOptions: ChatGenerateOptions = {
            maxOutputTokens: options.maxOutputTokens,
            temperature: options.temperature,
            topP: options.topP,
            topK: options.topK,
            stopSequences: options.stopSequences,
            enableWebSearch: options.enableWebSearch,
        };

        const result = await chatWithFallback(
            systemPrompt,
            providerMessages,
            userMessage,
            undefined, // no streaming
            providerOptions
        );

        return {
            text: result.text,
            tokenCount: result.tokenCount,
            finishReason: result.finishReason,
            // Convert provider citations to groundingMetadata for backward compatibility
            groundingMetadata: result.citations.length > 0
                ? {
                    groundingChunks: result.citations
                        .filter(c => c.sourceType === 'web')
                        .map(c => ({
                            web: { title: c.title, uri: c.url },
                        })),
                }
                : undefined,
        };
    }

    /**
     * Generate a streaming chat response.
     * Now delegates to provider factory with automatic fallback.
     */
    async generateChatResponseStream(
        systemPrompt: string,
        messages: ChatMessage[],
        userMessage: string,
        onChunk: (text: string) => void,
        options: GenerateOptions = {}
    ): Promise<ChatResponse> {
        const providerMessages: ProviderChatMessage[] = messages.map(m => ({
            role: m.role === 'user' ? 'user' as const : 'assistant' as const,
            content: m.parts.map(p => p.text).join(''),
        }));

        const providerOptions: ChatGenerateOptions = {
            maxOutputTokens: options.maxOutputTokens,
            temperature: options.temperature,
            topP: options.topP,
            topK: options.topK,
            stopSequences: options.stopSequences,
            enableWebSearch: options.enableWebSearch,
        };

        const result = await chatWithFallback(
            systemPrompt,
            providerMessages,
            userMessage,
            onChunk,
            providerOptions
        );

        return {
            text: result.text,
            tokenCount: result.tokenCount,
            finishReason: result.finishReason,
            groundingMetadata: result.citations.length > 0
                ? {
                    groundingChunks: result.citations
                        .filter(c => c.sourceType === 'web')
                        .map(c => ({
                            web: { title: c.title, uri: c.url },
                        })),
                }
                : undefined,
        };
    }

    /**
     * Generate embeddings for a text.
     * Now uses gemini-embedding-001 via the provider layer.
     * UPGRADED: Has retry logic for 429 rate limit errors.
     */
    async generateEmbedding(text: string): Promise<EmbeddingResult> {
        const provider = getEmbeddingProvider();
        return provider.generateEmbedding(text);
    }

    /**
     * Generate embeddings for multiple texts in batch.
     */
    async generateEmbeddingsBatch(texts: string[]): Promise<EmbeddingResult[]> {
        const provider = getEmbeddingProvider();
        return provider.generateEmbeddingsBatch(texts);
    }
}

// Export singleton instance (preserves existing import pattern)
export const haiClient = new HaiGeminiClient();
