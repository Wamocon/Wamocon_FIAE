/**
 * HAI.ai Provider Factory
 *
 * Central entry point for all AI providers.
 * Creates and manages singleton instances of chat and embedding providers.
 *
 * Architecture:
 *   - CHAT: Claude Haiku 4.5 (primary) → Gemini 2.5 Flash (fallback)
 *   - EMBEDDINGS: Gemini gemini-embedding-001 (always — Claude has no embeddings)
 *
 * @module lib/hai/providers
 */

import { GeminiChatProvider, GeminiEmbeddingProvider } from './gemini';
import { ClaudeChatProvider } from './claude';
import { loadProviderConfig, type ChatProvider, type EmbeddingProvider, type ChatProviderType } from './types';

// Re-export types so consumers can import from '@/lib/hai/providers'
export type { ChatProvider, EmbeddingProvider, ChatMessage, ChatGenerateOptions, ChatResponse, EmbeddingResult, ChatCitation, ProviderConfig } from './types';
export { loadProviderConfig } from './types';

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

let _chatProvider: ChatProvider | null = null;
let _fallbackChatProvider: ChatProvider | null = null;
let _embeddingProvider: EmbeddingProvider | null = null;
let _initialized = false;

/**
 * Initialize all providers based on environment configuration.
 * Safe to call multiple times — creates singletons on first call.
 */
function ensureInitialized(): void {
    if (_initialized) return;

    const config = loadProviderConfig();

    // --- EMBEDDING PROVIDER (always Gemini) ---
    _embeddingProvider = new GeminiEmbeddingProvider(
        config.gemini.apiKey,
        config.gemini.embeddingModel,
        config.gemini.embeddingDimensions
    );

    // --- CHAT PROVIDERS ---
    const claudeProvider = new ClaudeChatProvider(config.claude.apiKey, config.claude.model);
    const geminiChatProvider = new GeminiChatProvider(config.gemini.apiKey, config.gemini.chatModel);

    // Primary chat provider based on config
    switch (config.chatProvider) {
        case 'claude':
            _chatProvider = claudeProvider.isInitialized() ? claudeProvider : geminiChatProvider;
            _fallbackChatProvider = geminiChatProvider;
            break;

        case 'gemini':
            _chatProvider = geminiChatProvider;
            _fallbackChatProvider = claudeProvider.isInitialized() ? claudeProvider : null;
            break;

        case 'auto':
            // Auto: prefer Claude (better reasoning), fall back to Gemini (free)
            if (claudeProvider.isInitialized()) {
                _chatProvider = claudeProvider;
                _fallbackChatProvider = geminiChatProvider;
            } else {
                _chatProvider = geminiChatProvider;
                _fallbackChatProvider = null;
            }
            break;

        default:
            _chatProvider = claudeProvider.isInitialized() ? claudeProvider : geminiChatProvider;
            _fallbackChatProvider = geminiChatProvider;
    }

    // Log initialization status
    const chatStatus = _chatProvider?.isInitialized() ? `${_chatProvider.name} (ready)` : 'none';
    const fallbackStatus = _fallbackChatProvider?.isInitialized()
        ? `${_fallbackChatProvider.name} (ready)`
        : 'none';
    const embedStatus = _embeddingProvider?.isInitialized() ? `${_embeddingProvider.name} (ready)` : 'none';

    console.log(
        `HAI.ai Providers initialized:\n` +
        `  Chat: ${chatStatus}\n` +
        `  Fallback: ${fallbackStatus}\n` +
        `  Embedding: ${embedStatus}`
    );

    _initialized = true;
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get the primary chat provider.
 * Falls back to secondary provider if primary fails.
 */
export function getChatProvider(): ChatProvider {
    ensureInitialized();

    if (!_chatProvider || !_chatProvider.isInitialized()) {
        if (_fallbackChatProvider?.isInitialized()) {
            console.warn(`HAI.ai: Primary chat provider unavailable. Using fallback: ${_fallbackChatProvider.name}`);
            return _fallbackChatProvider;
        }
        throw new Error('HAI.ai: No chat provider available. Check ANTHROPIC_API_KEY or GEMINI_API_KEY.');
    }

    return _chatProvider;
}

/**
 * Get the fallback chat provider (if available).
 * Returns null if no fallback is configured.
 */
export function getFallbackChatProvider(): ChatProvider | null {
    ensureInitialized();
    return _fallbackChatProvider?.isInitialized() ? _fallbackChatProvider : null;
}

/**
 * Get the embedding provider (always Gemini).
 */
export function getEmbeddingProvider(): EmbeddingProvider {
    ensureInitialized();

    if (!_embeddingProvider || !_embeddingProvider.isInitialized()) {
        throw new Error('HAI.ai: Embedding provider not available. Check GEMINI_API_KEY.');
    }

    return _embeddingProvider;
}

/**
 * Execute a chat request with automatic fallback.
 * If primary provider fails with a non-retryable error, tries the fallback.
 *
 * SPECIAL CASE: When enableWebSearch is true, we route to Gemini directly
 * because Claude does not support Google Search grounding. Gemini returns
 * web citations via groundingMetadata which the pipeline needs.
 */
export async function chatWithFallback(
    systemPrompt: string,
    messages: import('./types').ChatMessage[],
    userMessage: string,
    onChunk?: (text: string) => void,
    options?: import('./types').ChatGenerateOptions
): Promise<import('./types').ChatResponse> {
    let primary = getChatProvider();

    // BUG FIX: When web search is requested, always use Gemini
    // because Claude doesn't support Google Search grounding.
    // Gemini returns groundingMetadata with web citations.
    if (options?.enableWebSearch && primary.name === 'claude') {
        const gemini = getFallbackChatProvider();
        if (gemini?.isInitialized() && gemini.name === 'gemini') {
            primary = gemini;
        }
        // If Gemini fallback not available, Claude will answer without web search
        // (still functional, just no web citations)
    }

    try {
        if (onChunk) {
            return await primary.generateResponseStream(systemPrompt, messages, userMessage, onChunk, options);
        } else {
            return await primary.generateResponse(systemPrompt, messages, userMessage, options);
        }
    } catch (error: any) {
        const fallback = getFallbackChatProvider();

        if (!fallback || fallback === primary) {
            throw error; // No fallback available or already using fallback
        }

        // Only fallback on provider-level failures, not content/prompt issues
        const status = error.status || error.code;
        const isFallbackWorthy =
            status === 500 ||
            status === 502 ||
            status === 503 ||
            status === 529 ||
            error.message?.includes('not initialized') ||
            error.message?.includes('ECONNREFUSED');

        if (!isFallbackWorthy) {
            throw error; // Don't fallback on auth errors, validation errors, etc.
        }

        console.warn(
            `HAI.ai: Primary provider (${primary.name}) failed. Falling back to ${fallback.name}.`,
            error.message
        );

        if (onChunk) {
            return await fallback.generateResponseStream(systemPrompt, messages, userMessage, onChunk, options);
        } else {
            return await fallback.generateResponse(systemPrompt, messages, userMessage, options);
        }
    }
}

/**
 * Reset all providers (for testing or hot-reload scenarios).
 * Forces re-initialization on next access.
 */
export function resetProviders(): void {
    _chatProvider = null;
    _fallbackChatProvider = null;
    _embeddingProvider = null;
    _initialized = false;
}

/**
 * Get diagnostic information about provider status.
 */
export function getProviderStatus(): {
    chat: { provider: string; initialized: boolean };
    fallback: { provider: string; initialized: boolean } | null;
    embedding: { provider: string; initialized: boolean; dimensions: number };
} {
    ensureInitialized();

    return {
        chat: {
            provider: _chatProvider?.name ?? 'none',
            initialized: _chatProvider?.isInitialized() ?? false,
        },
        fallback: _fallbackChatProvider
            ? {
                provider: _fallbackChatProvider.name,
                initialized: _fallbackChatProvider.isInitialized(),
            }
            : null,
        embedding: {
            provider: _embeddingProvider?.name ?? 'none',
            initialized: _embeddingProvider?.isInitialized() ?? false,
            dimensions: (_embeddingProvider as GeminiEmbeddingProvider)?.dimensions ?? 0,
        },
    };
}
