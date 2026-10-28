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
 *     - 'openai-compatible' → Sokrates, the own AI
 *   - CHAT FALLBACK (package CF1): HAI_CHAT_FALLBACK
 *     - 'sokrates' (default) → if the primary fails, ONLY the OpenAI compatible
 *       provider (Sokrates) is tried, and only if OPENAI_COMPATIBLE_API_KEY is set
 *       and its address is https on the positive list of hosts
 *     - 'none' → no fallback
 *     Without a usable fallback the caller gets a ChatUnavailableError. There is
 *     no value that opens Gemini, Claude, OpenRouter or Ollama as a fallback:
 *     chat content never goes to a third party by fallback.
 *   - EMBEDDINGS: Environment-based routing via HAI_EMBEDDING_PROVIDER
 *     - 'gemini' (default) → Google Gemini API (production standard, 3072 dims)
 *     - 'ollama' → Local Ollama (local dev only, 768 dims — incompatible with production)
 *
 * @module lib/hai/providers
 */

import {
  allowedHostsOf,
  parseTarget,
  type KiPolicy,
} from '@/lib/content-upload/ki/config';
import { ClaudeChatProvider } from './claude';
import {
  ChatUnavailableError,
  describeChatFailure,
  type FallbackState,
} from './errors';
import { GeminiChatProvider, GeminiEmbeddingProvider } from './gemini';
import { OllamaEmbeddingProvider } from './ollama';
import { OpenRouterChatProvider } from './openrouter';
import { OpenAICompatibleChatProvider } from './openai-compatible';
import {
  loadProviderConfig,
  type ChatProvider,
  type EmbeddingProvider,
  type ProviderConfig,
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
export {
  ChatProviderError,
  ChatUnavailableError,
  CHAT_UNAVAILABLE_CODE,
  CHAT_UNAVAILABLE_I18N_KEY,
  isChatUnavailableError,
  type FallbackState,
} from './errors';

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
      `  Chat fallback: ${resolveFallback(config).state}\n` +
      `  Embedding: ${embedStatus}`
  );

  _initialized = true;
}

// ============================================================================
// CHAIN: PRIMARY + SOKRATES FALLBACK
// ============================================================================

/** What a call may use, in this order. Built from the environment, never from a list of all providers. */
export interface ChatChain {
  /** The configured provider, or null if it is not ready (no key). */
  primary: ChatProvider | null;
  /** Sokrates, or null. The only fallback there is. */
  fallback: ChatProvider | null;
  /** Why there is no fallback (or `sokrates`). */
  fallbackState: FallbackState;
}

/**
 * The rules the address of the fallback is held to: https, no credentials, no
 * port, a host of the positive list (the one list of Sokrates hosts, replaced by
 * CONTENT_UPLOAD_KI_ALLOWED_HOSTS). Null if that list is invalid: fail closed.
 * A test with a stand-in on localhost passes its own policy.
 */
function defaultFallbackPolicy(): KiPolicy | null {
  const allowedHosts = allowedHostsOf(process.env);
  return allowedHosts ? { requireHttps: true, allowedHosts } : null;
}

function resolveFallback(
  config: ProviderConfig,
  policy?: KiPolicy | null
): { fallback: ChatProvider | null; state: FallbackState } {
  // Sokrates is already the primary: a second try would be the same call
  if (config.chatProvider === 'openai-compatible') {
    return { fallback: null, state: 'primary_is_sokrates' };
  }
  if (config.chatFallback === 'none') {
    return { fallback: null, state: 'disabled' };
  }

  const apiKey = (config.openaiCompatible.apiKey ?? '').trim();
  // a key with a space or a line break cannot be a bearer token (header injection)
  if (apiKey.length === 0 || /[\s\u0000-\u001f\u007f]/.test(apiKey)) {
    return { fallback: null, state: 'no_key' };
  }

  const effectivePolicy =
    policy === undefined ? defaultFallbackPolicy() : policy;
  const parsed = effectivePolicy
    ? parseTarget(config.openaiCompatible.baseUrl, effectivePolicy)
    : null;
  if (!parsed || !parsed.ok) {
    return { fallback: null, state: 'target_rejected' };
  }

  // the provider is built from the address that was checked, not from the raw text
  return {
    fallback: new OpenAICompatibleChatProvider(
      parsed.target.url.replace(/\/chat\/completions$/, ''),
      apiKey,
      config.openaiCompatible.model
    ),
    state: 'sokrates',
  };
}

/**
 * The chain of one call: the primary if it is ready, then Sokrates if it may be
 * used. Pure apart from the construction of the Sokrates provider.
 */
export function resolveChatChain(
  config: ProviderConfig,
  primary: ChatProvider | null,
  policy?: KiPolicy | null
): ChatChain {
  const { fallback, state } = resolveFallback(config, policy);
  return {
    primary: primary && primary.isInitialized() ? primary : null,
    fallback,
    fallbackState: state,
  };
}

function currentChain(): { chain: ChatChain; config: ProviderConfig } {
  ensureInitialized();
  const config = loadProviderConfig();
  return { chain: resolveChatChain(config, _chatProvider), config };
}

// ============================================================================
// PUBLIC API
// ============================================================================

/**
 * Get the chat provider that can answer now: the primary if it is ready,
 * otherwise Sokrates if the fallback is usable. Throws ChatUnavailableError if
 * nothing can answer (never returns another provider).
 */
export function getChatProvider(): ChatProvider {
  const { chain, config } = currentChain();
  const usable = chain.primary ?? chain.fallback;

  if (!usable) {
    const keyHints: Record<string, string> = {
      gemini: 'GEMINI_API_KEY',
      claude: 'ANTHROPIC_API_KEY',
      openrouter: 'OPENROUTER_API_KEY',
      'openai-compatible': 'OPENAI_COMPATIBLE_API_KEY',
    };
    const keyHint = keyHints[config.chatProvider] || 'API key';
    throw new ChatUnavailableError(
      'no_provider',
      chain.fallbackState,
      `Chat provider (${config.chatProvider}) not available. Check ${keyHint}.`
    );
  }

  return usable;
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
 * Run one request along a chain: the primary first, then Sokrates, and nothing
 * else. Streaming: if the provider that failed had already sent text to
 * `onChunk`, there is no second try (a second answer would be glued onto the
 * first); the caller gets ChatUnavailableError('interrupted'). The log carries
 * provider names and the kind of failure, never content.
 */
export async function runChatChain(
  chain: ChatChain,
  systemPrompt: string,
  messages: import('./types').ChatMessage[],
  userMessage: string,
  onChunk?: (text: string) => void,
  options?: import('./types').ChatGenerateOptions
): Promise<import('./types').ChatResponse> {
  const attempts: ChatProvider[] = [];
  if (chain.primary) attempts.push(chain.primary);
  if (chain.fallback) attempts.push(chain.fallback);

  if (attempts.length === 0) {
    console.warn(
      `HAI.ai [chatWithFallback]: no chat provider is ready (fallback: ${chain.fallbackState})`
    );
    throw new ChatUnavailableError('no_provider', chain.fallbackState);
  }

  const failures: string[] = [];

  for (let index = 0; index < attempts.length; index += 1) {
    const provider = attempts[index];
    let emitted = false;
    const guardedChunk = onChunk
      ? (text: string) => {
          if (text.trim()) emitted = true;
          onChunk(text);
        }
      : undefined;

    try {
      if (guardedChunk) {
        return await provider.generateResponseStream(
          systemPrompt,
          messages,
          userMessage,
          guardedChunk,
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
      const reason = describeChatFailure(error);
      failures.push(`${provider.name}: ${reason}`);

      if (emitted) {
        console.warn(
          `HAI.ai [chatWithFallback]: provider "${provider.name}" broke off after output (${reason}), no second try`
        );
        throw new ChatUnavailableError(
          'interrupted',
          chain.fallbackState,
          failures.join(' | ')
        );
      }

      const next = attempts[index + 1];
      console.warn(
        next
          ? `HAI.ai [chatWithFallback]: provider "${provider.name}" failed (${reason}), trying "${next.name}"`
          : `HAI.ai [chatWithFallback]: provider "${provider.name}" failed (${reason}), no further provider (fallback: ${chain.fallbackState})`
      );
    }
  }

  throw new ChatUnavailableError(
    chain.fallback && attempts.includes(chain.fallback)
      ? 'fallback_failed'
      : 'no_fallback',
    chain.fallbackState,
    failures.join(' | ')
  );
}

/**
 * Execute a chat request via the configured provider. If it fails, ONLY Sokrates
 * is tried (and only if OPENAI_COMPATIBLE_API_KEY is set, see HAI_CHAT_FALLBACK).
 * Throws ChatUnavailableError if nothing could answer.
 */
export async function chatWithFallback(
  systemPrompt: string,
  messages: import('./types').ChatMessage[],
  userMessage: string,
  onChunk?: (text: string) => void,
  options?: import('./types').ChatGenerateOptions
): Promise<import('./types').ChatResponse> {
  return runChatChain(
    currentChain().chain,
    systemPrompt,
    messages,
    userMessage,
    onChunk,
    options
  );
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
  fallbackState: FallbackState;
  embedding: { provider: string; initialized: boolean; dimensions: number };
} {
  const { chain } = currentChain();

  return {
    chat: {
      provider: _chatProvider?.name ?? 'none',
      initialized: _chatProvider?.isInitialized() ?? false,
    },
    fallback: chain.fallback
      ? {
          provider: chain.fallback.name,
          initialized: chain.fallback.isInitialized(),
        }
      : null,
    fallbackState: chain.fallbackState,
    embedding: {
      provider: _embeddingProvider?.name ?? 'none',
      initialized: _embeddingProvider?.isInitialized() ?? false,
      dimensions:
        (_embeddingProvider as EmbeddingProvider | null)?.dimensions ?? 0,
    },
  };
}
