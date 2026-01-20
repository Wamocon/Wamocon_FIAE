/**
 * HAI.ai - AI Learning Coach
 * 
 * Barrel export for all HAI.ai modules.
 * Import from '@/lib/hai' for all AI coach functionality.
 * 
 * @module lib/hai
 */

// Core Gemini client
export { haiClient } from './client';
export type { ChatMessage, GenerateOptions, EmbeddingResult, ChatResponse } from './client';

// Text chunking
export { chunkText, chunkDocument } from './chunker';
export type { ChunkOptions, TextChunk } from './chunker';

// Embedding generation and storage
export {
    indexContent,
    indexContentBatch,
    removeEmbeddings,
    getEmbeddingCount,
    getIndexedSources
} from './embeddings';
export type { IndexContentOptions, IndexResult, SourceType } from './embeddings';

// Vector similarity search
export {
    searchSimilar,
    searchWithContext,
    findRelatedContent,
    checkIndexHealth
} from './vectorSearch';
export type { SearchResult, SearchOptions, SearchContext } from './vectorSearch';

// PDF text extraction
export {
    extractTextFromPDF,
    extractFromMultiplePDFs,
    isPDFUrl,
    estimateTokenCount
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
    getTechnicalErrorMessage
} from './prompts';
export type { PromptMode, PromptContext } from './prompts';

// RAG Pipeline (main orchestration)
export {
    processMessage,
    processMessageStream,
    checkPipelineHealth
} from './ragPipeline';
export type {
    IntentType,
    PipelineContext,
    PipelineResult,
    QuizState,
    Citation
} from './ragPipeline';
