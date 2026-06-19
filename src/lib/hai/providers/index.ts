/**
 * HAI.ai Provider Factory
 *
 * Central entry point for all AI providers.
 * Creates and manages singleton instances of chat and embedding providers.
 *
 * Architecture:
 *   - CHAT: Environment-based routing via HAI_CHAT_PROVIDER
 *     - 'gemini' (default) → Google Gemini Flash, fast & affordable (production)
 *     - 'openrouter' → Free Llama models for QA/testing
 *     - 'claude' → Anthropic Claude, premium quality
 *   - EMBEDDINGS: Environment-based routing via HAI_EMBEDDING_PROVIDER
 *     - 'gemini' (default) → Google Gemini API (production standard, 3072 dims)
 *     - 'ollama' → Local Ollama (local dev only, 768 dims — incompatible with production)
 *
 * @module lib/hai/providers
 */

import { ClaudeChatProvider } from './claude';
import { GeminiChatProvider, GeminiEmbeddingProvider } from './gemini';
import { OllamaEmbeddingProvider } from './ollama';
import { OpenRouterChatProvider } from './openrouter';
import { OpenAICompatibleChatProvider } from './openai-compatible';
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
  if (config.chatProvider === 'gemini') {
    _chatProvider = new GeminiChatProvider(
      config.gemini.apiKey,
      config.gemini.chatModel
    );
  } else if (config.chatProvider === 'claude') {
    _chatProvider = new ClaudeChatProvider(
      config.claude.apiKey,
      config.claude.model
    );
  } else if (config.chatProvider === 'openai-compatible') {
    _chatProvider = new OpenAICompatibleChatProvider(
      config.openaiCompatible.baseUrl,
      config.openaiCompatible.apiKey,
      config.openaiCompatible.model
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
    const keyHints: Record<string, string> = {
      gemini: 'GEMINI_API_KEY',
      claude: 'ANTHROPIC_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY',
    };
    const keyHint = keyHints[config.chatProvider] || 'API key';
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
 * Build all chat providers that have credentials, ordered by preference.
 * The configured provider is always first; remaining providers act as fallbacks.
 */
function getAvailableChatProviders(): ChatProvider[] {
  ensureInitialized();
  const config = loadProviderConfig();

  const providers = new Map<ChatProviderType, ChatProvider>();

  if (_chatProvider && _chatProvider.isInitialized()) {
    providers.set(config.chatProvider, _chatProvider);
  }

  const allProviders: { type: ChatProviderType; instance: ChatProvider }[] = [
    {
      type: 'openai-compatible',
      instance: new OpenAICompatibleChatProvider(
        config.openaiCompatible.baseUrl,
        config.openaiCompatible.apiKey,
        config.openaiCompatible.model
      ),
    },
    {
      type: 'gemini',
      instance: new GeminiChatProvider(
        config.gemini.apiKey,
        config.gemini.chatModel
      ),
    },
    {
      type: 'claude',
      instance: new ClaudeChatProvider(
        config.claude.apiKey,
        config.claude.model
      ),
    },
    {
      type: 'openrouter',
      instance: new OpenRouterChatProvider(
        config.openrouter.apiKey,
        config.openrouter.model
      ),
    },
  ];

  for (const { type, instance } of allProviders) {
    if (!providers.has(type) && instance.isInitialized()) {
      providers.set(type, instance);
    }
  }

  return Array.from(providers.values());
}

/**
 * Execute a chat request via the configured provider, falling back to other
 * initialized providers if the primary one fails.
 */
export async function chatWithFallback(
  systemPrompt: string,
  messages: import('./types').ChatMessage[],
  userMessage: string,
  onChunk?: (text: string) => void,
  options?: import('./types').ChatGenerateOptions
): Promise<import('./types').ChatResponse> {
  const providers = getAvailableChatProviders();

  if (providers.length === 0) {
    throw new Error(
      'HAI.ai: No chat providers are initialized. Check your AI provider API keys.'
    );
  }

  const errors: string[] = [];

  for (const provider of providers) {
    try {
      if (onChunk) {
        return await provider.generateResponseStream(
          systemPrompt,
          messages,
          userMessage,
          onChunk,
          options
        );
      }
      return await provider.generateResponse(
        systemPrompt,
        messages,
        userMessage,
        options
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.warn(
        `HAI.ai [chatWithFallback]: provider "${provider.name}" failed: ${message}`
      );
      errors.push(`${provider.name}: ${message}`);
    }
  }

  throw new Error(`HAI.ai: All chat providers failed. ${errors.join(' | ')}`);
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
      dimensions:
        (_embeddingProvider as EmbeddingProvider | null)?.dimensions ?? 0,
    },
  };
}
