/**
 * HAI.ai Gemini Client
 * 
 * Centralized client for interacting with Google's Gemini API.
 * Handles both text generation (chat) and embedding generation.
 * 
 * @module lib/hai/client
 */

import { GoogleGenerativeAI, GenerativeModel, EmbedContentResponse } from '@google/generative-ai';

// ============================================================================
// CONFIGURATION
// ============================================================================

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.warn('⚠️ HAI.ai: GEMINI_API_KEY not found in environment variables');
}

// Initialize the Gemini client
const genAI = GEMINI_API_KEY ? new GoogleGenerativeAI(GEMINI_API_KEY) : null;

// Model configurations - Using latest stable Gemini 2.5 (GA June 2025)
const MODELS = {
    // For chat/text generation - Gemini 2.5 Flash (fast, high quality)
    FLASH: 'gemini-2.5-flash',
    // For embeddings - text-embedding-004 (768 dimensions)
    EMBEDDING: 'text-embedding-004',
} as const;

// ============================================================================
// TYPES
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
    enableWebSearch?: boolean; // New option
}

export interface EmbeddingResult {
    embedding: number[];
    tokenCount?: number;
}

export interface ChatResponse {
    text: string;
    tokenCount?: number;
    finishReason?: string;
    groundingMetadata?: any; // New field for citations
}

// ============================================================================
// CLIENT CLASS
// ============================================================================

class HaiGeminiClient {
    private chatModel: GenerativeModel | null = null;
    private embeddingModel: GenerativeModel | null = null;

    constructor() {
        if (genAI) {
            this.chatModel = genAI.getGenerativeModel({
                model: MODELS.FLASH,
                generationConfig: {
                    maxOutputTokens: 2048,
                    temperature: 0.7,
                    topP: 0.9,
                },
            });

            this.embeddingModel = genAI.getGenerativeModel({
                model: MODELS.EMBEDDING
            });
        }
    }

    /**
     * Check if the client is properly initialized
     */
    isInitialized(): boolean {
        return this.chatModel !== null && this.embeddingModel !== null;
    }

    /**
     * Generate a chat response from the model
     * 
     * @param systemPrompt - The system prompt defining HAI's personality
     * @param messages - Conversation history
     * @param userMessage - The current user message
     * @param options - Generation options
     */
    async generateChatResponse(
        systemPrompt: string,
        messages: ChatMessage[],
        userMessage: string,
        options: GenerateOptions = {}
    ): Promise<ChatResponse> {
        if (!this.chatModel) {
            throw new Error('HAI.ai: Gemini client not initialized. Check GEMINI_API_KEY.');
        }

        try {
            // Configure tools if web search is enabled
            // standard GoogleGenerativeAI Tool type requires strict structure, using any for flexibility with experimental features
            const tools = options.enableWebSearch ? [{ googleSearch: {} } as any] : undefined;

            // Start a chat with history
            const chat = this.chatModel.startChat({
                history: [
                    // System prompt as first message
                    { role: 'user', parts: [{ text: `[SYSTEM]: ${systemPrompt}` }] },
                    { role: 'model', parts: [{ text: 'Verstanden. Ich bin HAI.ai 🦈, dein digitaler Lernbegleiter.' }] },
                    // Previous messages
                    ...messages,
                ],
                generationConfig: {
                    maxOutputTokens: options.maxOutputTokens ?? 2048,
                    temperature: options.temperature ?? 0.7,
                    topP: options.topP ?? 0.9,
                    topK: options.topK ?? 40,
                    stopSequences: options.stopSequences,
                },
                tools,
            });

            // Send the current message with retry logic
            const result = await this.callWithRetry(() => chat.sendMessage(userMessage));
            const response = result.response;
            const candidate = response.candidates?.[0];

            return {
                text: response.text(),
                finishReason: candidate?.finishReason,
                // explicit cast for groundingMetadata as it might not be in the strict types yet
                groundingMetadata: (candidate as any)?.groundingMetadata,
            };
        } catch (error) {
            console.error('HAI.ai: Error generating chat response:', error);
            throw error;
        }
    }

    /**
     * Generate a streaming chat response
     */
    async generateChatResponseStream(
        systemPrompt: string,
        messages: ChatMessage[],
        userMessage: string,
        onChunk: (text: string) => void,
        options: GenerateOptions = {}
    ): Promise<ChatResponse> {
        if (!this.chatModel) {
            throw new Error('HAI.ai: Gemini client not initialized. Check GEMINI_API_KEY.');
        }

        try {
            // Configure tools if web search is enabled
            // standard GoogleGenerativeAI Tool type requires strict structure, using any for flexibility with experimental features
            const tools = options.enableWebSearch ? [{ googleSearch: {} } as any] : undefined;

            const chat = this.chatModel.startChat({
                history: [
                    { role: 'user', parts: [{ text: `[SYSTEM]: ${systemPrompt}` }] },
                    { role: 'model', parts: [{ text: 'Verstanden. Ich bin HAI.ai 🦈, dein digitaler Lernbegleiter.' }] },
                    ...messages,
                ],
                generationConfig: {
                    maxOutputTokens: options.maxOutputTokens ?? 2048,
                    temperature: options.temperature ?? 0.7,
                    topP: options.topP ?? 0.9,
                },
                tools,
            });

            const result = await chat.sendMessageStream(userMessage);
            let fullText = '';

            for await (const chunk of result.stream) {
                const chunkText = chunk.text();
                fullText += chunkText;
                onChunk(chunkText);
            }

            // Get full response for metadata
            const fullResponse = await result.response;
            const candidate = fullResponse.candidates?.[0];

            return {
                text: fullText,
                finishReason: candidate?.finishReason,
                // explicit cast for groundingMetadata as it might not be in the strict types yet
                groundingMetadata: (candidate as any)?.groundingMetadata
            };

        } catch (error) {
            console.error('HAI.ai: Error generating stream response:', error);
            throw error;
        }
    }

    /**
     * Generate embeddings for a text
     * 
     * @param text - The text to embed
     * @returns 768-dimensional embedding vector
     */
    async generateEmbedding(text: string): Promise<EmbeddingResult> {
        if (!this.embeddingModel) {
            throw new Error('HAI.ai: Embedding model not initialized. Check GEMINI_API_KEY.');
        }

        try {
            const result = await this.embeddingModel.embedContent(text);

            return {
                embedding: result.embedding.values,
            };
        } catch (error) {
            console.error('HAI.ai: Error generating embedding:', error);
            throw error;
        }
    }

    /**
     * Generate embeddings for multiple texts in batch
     * 
     * @param texts - Array of texts to embed
     * @returns Array of embedding results
     */
    async generateEmbeddingsBatch(texts: string[]): Promise<EmbeddingResult[]> {
        if (!this.embeddingModel) {
            throw new Error('HAI.ai: Embedding model not initialized.');
        }

        try {
            // Process in parallel with rate limiting
            const results: EmbeddingResult[] = [];
            const batchSize = 5; // Process 5 at a time to avoid rate limits

            for (let i = 0; i < texts.length; i += batchSize) {
                const batch = texts.slice(i, i + batchSize);
                const batchResults = await Promise.all(
                    batch.map(text => this.generateEmbedding(text))
                );
                results.push(...batchResults);

                // Small delay between batches to respect rate limits
                if (i + batchSize < texts.length) {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }

            return results;
        } catch (error) {
            console.error('HAI.ai: Error in batch embedding:', error);
            throw error;
        }
    }

    /**
     * Helper to retry calls on 503 Overloaded
     */
    private async callWithRetry<T>(fn: () => Promise<T>, retries = 3, delay = 1000): Promise<T> {
        try {
            return await fn();
        } catch (error: any) {
            if (retries > 0 && (error.status === 503 || error.message?.includes('503') || error.message?.includes('Overloaded'))) {
                console.warn(`HAI.ai: Gemini 503 Overloaded. Retrying in ${delay}ms... (${retries} left)`);
                await new Promise(resolve => setTimeout(resolve, delay));
                return this.callWithRetry(fn, retries - 1, delay * 2);
            }
            throw error;
        }
    }
}

// Export singleton instance
export const haiClient = new HaiGeminiClient();
