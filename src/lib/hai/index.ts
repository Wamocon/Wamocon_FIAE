/**
 * HAI.ai - AI Learning Coach
 *
 * Barrel export for all HAI.ai modules.
 * Import from '@/lib/hai' for all AI coach functionality.
 *
 * ARCHITECTURE (2026):
 *   Chat:       Claude Haiku 4.5 (primary) → Gemini 2.5 Flash (fallback)
 *   Embeddings: Gemini gemini-embedding-001 (768-dim, MRL)
 *   Vector DB:  pgvector with IVFFlat index
 *
 * @module lib/hai
 */

// --- NEW: Provider abstraction layer ---
export {
  getChatProvider,
  getEmbeddingProvider,
  chatWithFallback,
  getProviderStatus,
} from './providers';
export type {
  ChatProvider,
  EmbeddingProvider,
  ChatMessage as ProviderChatMessage,
  ChatGenerateOptions,
  ChatResponse as ProviderChatResponse,
  EmbeddingResult as ProviderEmbeddingResult,
  ChatCitation,
} from './providers';

// --- Legacy client (backward compatibility) ---
export { haiClient } from './client';
export type {
  ChatMessage,
  GenerateOptions,
  EmbeddingResult,
  ChatResponse,
} from './client';

// Text chunking
export { chunkText, chunkDocument } from './chunker';
export type { ChunkOptions, TextChunk } from './chunker';

// Embedding generation and storage
export {
  indexContent,
  indexContentBatch,
  removeEmbeddings,
  getEmbeddingCount,
  getIndexedSources,
} from './embeddings';
export type {
  IndexContentOptions,
  IndexResult,
  SourceType,
} from './embeddings';

// Vector similarity search
export {
  searchSimilar,
  searchWithContext,
  findRelatedContent,
  checkIndexHealth,
} from './vectorSearch';
export type {
  SearchResult,
  SearchOptions,
  SearchContext,
} from './vectorSearch';

// PDF text extraction
export {
  extractTextFromPDF,
  extractFromMultiplePDFs,
  isPDFUrl,
  estimateTokenCount,
} from './pdfExtractor';
export type { PDFExtractionResult, ContentDocument } from './pdfExtractor';

// System prompts
export {
  buildSystemPrompt,
  buildRetrievedContext,
  getQuizGenerationPrompt,
  getCodeExplanationPrompt,
  getGreetingPrompt,
  getOffTopicResponse,
  getTechnicalErrorMessage,
} from './prompts';
export type { PromptMode, PromptContext } from './prompts';

// Live Data Context (Phase 1)
export {
  classifyDataIntent,
  fetchDataContext,
  fetchUserSnapshot,
} from './dataContext';
export type {
  UserRole,
  DataIntent,
  LiveDataContext,
  UserSnapshot,
} from './dataContext';

// RAG Pipeline (main orchestration)
export {
  processMessage,
  processMessageStream,
  checkPipelineHealth,
} from './ragPipeline';
export type {
  IntentType,
  PipelineContext,
  PipelineResult,
  QuizState,
  Citation,
} from './ragPipeline';

// Action Execution System (Phase 3 — Write Operations)
export { detectActionIntent, executeAction } from './actions';
export type {
  ActionType,
  ActionIntent,
  ActionResult,
  ActionDetectionContext,
} from './actions';

// Action Streaming & Progress (Phase 3B — Enhanced UX)
export {
  executeActionWithProgress,
  formatActionResult,
  createActionProgressStream,
} from './actionStreaming';
export type { ActionProgress, ProgressCallback } from './actionStreaming';

// Proactive Reminder System (Phase 4 — Proactive Features)
export {
  runProactiveChecks,
  createNotificationFromInsight,
  sendProactiveNotifications,
} from './proactive';
export type { ProactiveInsight, ProactiveCheck } from './proactive';
