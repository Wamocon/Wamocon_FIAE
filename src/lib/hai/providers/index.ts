/**
 * HAI.ai Provider Factory
 *
 * Central entry point for all AI providers.
 * Creates and manages singleton instances of chat and embedding providers.
 *
 * Architecture:
 *   - CHAT: Environment-based routing via HAI_CHAT_PROVIDER
 *     - 'openrouter' (default) → Free Llama models for QA/testing
 *     - 'claude' → Anthropic Claude for production
 *   - EMBEDDINGS: Environment-based routing via HAI_EMBEDDING_PROVIDER
 *     - 'gemini' (default) → Google Gemini API (production standard, 3072 dims)
 *     - 'ollama' → Local Ollama (local dev only, 768 dims — incompatible with production)
 *
 * @module lib/hai/providers
 */

import { ClaudeChatProvider } from './claude';
import { GeminiEmbeddingProvider } from './gemini';
import { OllamaEmbeddingProvider } from './ollama';
import { OpenRouterChatProvider } from './openrouter';
import {
  loadProviderConfig,
  type ChatProvider,
  type EmbeddingProvider,
  type ChatProviderType,
} from './types';

// Re-export types so consumers can import from '@/lib/hai/providers'
export type {
  ChatProvider,
  EmbeddingProvider,
  ChatMessage,
  ChatGenerateOptions,
  ChatResponse,
  EmbeddingResult,
  ChatCitation,
  ProviderConfig,
} from './types';
export { loadProviderConfig } from './types';

// ============================================================================
// SINGLETON INSTANCES
// ============================================================================

let _chatProvider: ChatProvider | null = null;
let _embeddingProvider: EmbeddingProvider | null = null;
let _initialized = false;

/**
 * Initialize all providers based on environment configuration.
 * Safe to call multiple times — creates singletons on first call.
 */
function ensureInitialized(): void {
  if (_initialized) return;

  const config = loadProviderConfig();

  // --- EMBEDDING PROVIDER (Ollama or Gemini) ---
  if (config.embeddingProvider === 'ollama') {
    _embeddingProvider = new OllamaEmbeddingProvider(
      config.ollama.baseUrl,
      config.ollama.embeddingModel,
      config.ollama.embeddingDimensions
    );
  } else {
    _embeddingProvider = new GeminiEmbeddingProvider(
      config.gemini.apiKey,
      config.gemini.embeddingModel,
      config.gemini.embeddingDimensions
    );
  }

  // --- CHAT PROVIDER (environment-based) ---
  if (config.chatProvider === 'claude') {
    _chatProvider = new ClaudeChatProvider(
      config.claude.apiKey,
      config.claude.model
    );
  } else {
    _chatProvider = new OpenRouterChatProvider(
      config.openrouter.apiKey,
      config.openrouter.model
    );
  }

  // Log initialization status
  const chatStatus = _chatProvider?.isInitialized()
    ? `${_chatProvider.name} (ready)`
    : 'none';
  const embedStatus = _embeddingProvider?.isInitialized()
    ? `${_embeddingProvider.name} (ready)`
    : 'none';

  console.log(
    `HAI.ai Providers initialized:\n` +
      `  Chat: ${chatStatus} [${config.chatProvider}]\n` +
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
    const config = loadProviderConfig();
    const keyHint =
      config.chatProvider === 'claude'
        ? 'ANTHROPIC_API_KEY'
        : 'OPENROUTER_API_KEY';
    throw new Error(
      `HAI.ai: Chat provider (${config.chatProvider}) not available. Check ${keyHint}.`
    );
  }

  return _chatProvider;
}

/**
 * Get the embedding provider (Ollama or Gemini).
 */
export function getEmbeddingProvider(): EmbeddingProvider {
  ensureInitialized();

  if (!_embeddingProvider || !_embeddingProvider.isInitialized()) {
    const config = loadProviderConfig();
    const hint =
      config.embeddingProvider === 'ollama'
        ? 'Ollama server (ollama serve)'
        : 'GEMINI_API_KEY';
    throw new Error(
      `HAI.ai: Embedding provider (${config.embeddingProvider}) not available. Check ${hint}.`
    );
  }

  return _embeddingProvider;
}

/**
 * Execute a chat request via the configured provider (OpenRouter or Claude).
 * Provider is determined by HAI_CHAT_PROVIDER environment variable.
 */
export async function chatWithFallback(
  systemPrompt: string,
  messages: import('./types').ChatMessage[],
  userMessage: string,
  onChunk?: (text: string) => void,
  options?: import('./types').ChatGenerateOptions
): Promise<import('./types').ChatResponse> {
  const provider = getChatProvider();

  if (onChunk) {
    return await provider.generateResponseStream(
      systemPrompt,
      messages,
      userMessage,
      onChunk,
      options
    );
  } else {
    return await provider.generateResponse(
      systemPrompt,
      messages,
      userMessage,
      options
    );
  }
}

/**
 * Reset all providers (for testing or hot-reload scenarios).
 * Forces re-initialization on next access.
 */
export function resetProviders(): void {
  _chatProvider = null;
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
    fallback: null,
    embedding: {
      provider: _embeddingProvider?.name ?? 'none',
      initialized: _embeddingProvider?.isInitialized() ?? false,
      dimensions: (_embeddingProvider as any)?.dimensions ?? 0,
    },
  };
}
