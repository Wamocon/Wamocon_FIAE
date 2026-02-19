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

export type ChatProviderType = 'gemini' | 'openrouter' | 'claude';
export type EmbeddingProviderType = 'gemini' | 'ollama';

export interface ProviderConfig {
  /** Which provider to use for chat — set via HAI_CHAT_PROVIDER env var */
  chatProvider: ChatProviderType;

  /** Which provider to use for embeddings ('ollama' or 'gemini') */
  embeddingProvider: EmbeddingProviderType;

  /** Gemini-specific config (chat + embeddings — production standard) */
  gemini: {
    apiKey: string | undefined;
    chatModel: string;
    embeddingModel: string;
    embeddingDimensions: number;
  };

  /** Ollama-specific config (embeddings — local, no rate limits) */
  ollama: {
    baseUrl: string;
    embeddingModel: string;
    embeddingDimensions: number;
  };

  /** OpenRouter-specific config (chat — QA/testing) */
  openrouter: {
    apiKey: string | undefined;
    model: string;
  };

  /** Claude/Anthropic-specific config (chat — production) */
  claude: {
    apiKey: string | undefined;
    model: string;
  };
}

/**
 * Load provider configuration from environment variables.
 *
 * HAI_CHAT_PROVIDER controls which chat backend is used:
 *   - 'gemini' (default) → Google Gemini Flash, fast & affordable (production)
 *   - 'openrouter' → Free models, for QA/testing
 *   - 'claude' → Anthropic Claude, premium quality
 *
 * HAI_EMBEDDING_PROVIDER controls which embedding backend is used:
 *   - 'gemini' (default) → Google Gemini API (production standard)
 *   - 'ollama' → Local Ollama, for local dev only (768 dims — incompatible with production)
 */
export function loadProviderConfig(): ProviderConfig {
  const rawChatProvider = (process.env.HAI_CHAT_PROVIDER || 'gemini') as string;

  // Validate chat provider
  const validChatProviders: ChatProviderType[] = ['gemini', 'openrouter', 'claude'];
  const chatProvider: ChatProviderType = validChatProviders.includes(rawChatProvider as ChatProviderType)
    ? (rawChatProvider as ChatProviderType)
    : 'gemini';

  if (!validChatProviders.includes(rawChatProvider as ChatProviderType)) {
    console.warn(
      `HAI.ai: Unknown HAI_CHAT_PROVIDER "${rawChatProvider}". Falling back to "gemini".`
    );
  }

  // Determine embedding provider — defaults to Gemini (production standard)
  const embeddingProvider = (process.env.HAI_EMBEDDING_PROVIDER ||
    'gemini') as EmbeddingProviderType;

  const ollamaBaseUrl = process.env.OLLAMA_BASE_URL || 'http://localhost:11434';

  // Detect if we're in a serverless environment (Vercel) with localhost Ollama
  const isVercel = process.env.VERCEL === '1';
  const isLocalhostOllama =
    ollamaBaseUrl.includes('localhost') || ollamaBaseUrl.includes('127.0.0.1');

  if (isVercel && embeddingProvider === 'ollama' && isLocalhostOllama) {
    console.error(
      '⚠️  HAI.ai Configuration Error: Ollama is set to localhost but running on Vercel!'
    );
    console.error('   Localhost is not accessible from Vercel servers.');
    console.error(
      '   → Set HAI_EMBEDDING_PROVIDER=gemini in Vercel environment variables'
    );
    console.error(
      '   → Or update OLLAMA_BASE_URL to a publicly accessible URL'
    );
  }

  return {
    chatProvider,
    embeddingProvider: embeddingProvider === 'ollama' ? 'ollama' : 'gemini',

    gemini: {
      apiKey: process.env.GEMINI_API_KEY,
      chatModel: process.env.HAI_GEMINI_CHAT_MODEL || 'gemini-2.5-flash',
      embeddingModel:
        process.env.HAI_GEMINI_EMBEDDING_MODEL || 'gemini-embedding-001',
      embeddingDimensions: parseInt(
        process.env.HAI_EMBEDDING_DIMENSIONS || '3072',
        10
      ),
    },

    ollama: {
      baseUrl: ollamaBaseUrl,
      embeddingModel:
        process.env.HAI_OLLAMA_EMBEDDING_MODEL || 'nomic-embed-text',
      embeddingDimensions: parseInt(
        process.env.HAI_EMBEDDING_DIMENSIONS || '3072',
        10
      ),
    },

    openrouter: {
      apiKey: process.env.OPENROUTER_API_KEY,
      model:
        process.env.HAI_OPENROUTER_MODEL ||
        'meta-llama/llama-3.3-70b-instruct:free',
    },

    claude: {
      apiKey: process.env.ANTHROPIC_API_KEY,
      model: process.env.HAI_CLAUDE_MODEL || 'claude-haiku-4-5-20251001',
    },
  };
}
