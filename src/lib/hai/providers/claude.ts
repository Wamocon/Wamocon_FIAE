/**
 * HAI.ai Claude Provider
 *
 * Wraps Anthropic Claude API for chat generation.
 * Uses Claude Haiku 4.5 as the primary chat model — fast, affordable, excellent tool calling.
 *
 * NOTE: Claude does NOT have an embedding model.
 *       Embeddings are always handled by the Gemini provider.
 *
 * @module lib/hai/providers/claude
 */

import Anthropic from '@anthropic-ai/sdk';
import type {
    ChatProvider,
    ChatMessage,
    ChatGenerateOptions,
    ChatResponse,
} from './types';

// ============================================================================
// CLAUDE CHAT PROVIDER
// ============================================================================

export class ClaudeChatProvider implements ChatProvider {
    readonly name = 'claude';
    private client: Anthropic | null = null;
    private modelName: string;

    constructor(apiKey: string | undefined, modelName: string = 'claude-haiku-4-5-20250929') {
        this.modelName = modelName;

        if (apiKey) {
            this.client = new Anthropic({ apiKey });
        } else {
            console.warn('HAI.ai [Claude]: No API key provided (ANTHROPIC_API_KEY)');
        }
    }

    isInitialized(): boolean {
        return this.client !== null;
    }

    async generateResponse(
        systemPrompt: string,
        messages: ChatMessage[],
        userMessage: string,
        options: ChatGenerateOptions = {}
    ): Promise<ChatResponse> {
        if (!this.client) {
            throw new Error('HAI.ai [Claude]: Not initialized. Check ANTHROPIC_API_KEY.');
        }

        // Build Claude message history
        const claudeMessages: Anthropic.MessageParam[] = [
            ...this.convertMessages(messages),
            { role: 'user', content: userMessage },
        ];

        const response = await this.callWithRetry(async () => {
            return this.client!.messages.create({
                model: this.modelName,
                max_tokens: options.maxOutputTokens ?? 2048,
                temperature: options.temperature ?? 0.7,
                top_p: options.topP ?? 0.9,
                system: systemPrompt,
                messages: claudeMessages,
            });
        });

        // Extract text from response
        const text = response.content
            .filter(block => block.type === 'text')
            .map(block => (block as Anthropic.TextBlock).text)
            .join('');

        return {
            text,
            citations: [], // RAG citations are added by the pipeline, not the provider
            tokenCount: (response.usage?.input_tokens ?? 0) + (response.usage?.output_tokens ?? 0),
            finishReason: response.stop_reason ?? undefined,
            provider: this.name,
        };
    }

    async generateResponseStream(
        systemPrompt: string,
        messages: ChatMessage[],
        userMessage: string,
        onChunk: (text: string) => void,
        options: ChatGenerateOptions = {}
    ): Promise<ChatResponse> {
        if (!this.client) {
            throw new Error('HAI.ai [Claude]: Not initialized. Check ANTHROPIC_API_KEY.');
        }

        // Build Claude message history
        const claudeMessages: Anthropic.MessageParam[] = [
            ...this.convertMessages(messages),
            { role: 'user', content: userMessage },
        ];

        let fullText = '';
        let finishReason: string | undefined;
        let tokenCount = 0;

        const stream = this.client.messages.stream({
            model: this.modelName,
            max_tokens: options.maxOutputTokens ?? 2048,
            temperature: options.temperature ?? 0.7,
            top_p: options.topP ?? 0.9,
            system: systemPrompt,
            messages: claudeMessages,
        });

        for await (const event of stream) {
            if (
                event.type === 'content_block_delta' &&
                event.delta.type === 'text_delta'
            ) {
                const chunkText = event.delta.text;
                fullText += chunkText;
                onChunk(chunkText);
            }
        }

        // Get final message for metadata
        const finalMessage = await stream.finalMessage();
        finishReason = finalMessage.stop_reason ?? undefined;
        tokenCount = (finalMessage.usage?.input_tokens ?? 0) + (finalMessage.usage?.output_tokens ?? 0);

        return {
            text: fullText,
            citations: [],
            tokenCount,
            finishReason,
            provider: this.name,
        };
    }

    /**
     * Convert our generic ChatMessage format to Claude's MessageParam format.
     * Claude requires strict alternation: user → assistant → user → assistant.
     * If we get consecutive messages of the same role, we merge them.
     */
    private convertMessages(messages: ChatMessage[]): Anthropic.MessageParam[] {
        if (messages.length === 0) return [];

        const result: Anthropic.MessageParam[] = [];
        let lastRole: string | null = null;

        for (const msg of messages) {
            const role = msg.role === 'user' ? 'user' : 'assistant';

            if (role === lastRole && result.length > 0) {
                // Merge consecutive same-role messages (Claude requires strict alternation).
                // Always convert to string before merging to avoid type issues.
                const lastMsg = result[result.length - 1];
                const existingContent = typeof lastMsg.content === 'string'
                    ? lastMsg.content
                    : '(previous context)';
                lastMsg.content = existingContent + '\n\n' + msg.content;
            } else {
                result.push({
                    role: role as 'user' | 'assistant',
                    content: msg.content,
                });
                lastRole = role;
            }
        }

        // Claude requires first message to be 'user'. If not, prepend a user message.
        if (result.length > 0 && result[0].role !== 'user') {
            result.unshift({ role: 'user', content: '(Vorheriger Kontext)' });
        }

        return result;
    }

    /**
     * Retry on rate limit (429) and overloaded (529) errors
     */
    private async callWithRetry<T>(fn: () => Promise<T>, retries = 3, delay = 2000): Promise<T> {
        try {
            return await fn();
        } catch (error: any) {
            const status = error.status || error.code;
            const message = error.message || '';

            const isRetryable =
                status === 429 ||
                status === 529 ||
                status === 503 ||
                message.includes('rate_limit') ||
                message.includes('overloaded');

            if (retries > 0 && isRetryable) {
                // Check for Retry-After header
                const retryAfter = error.headers?.['retry-after'];
                const waitTime = retryAfter ? parseInt(retryAfter, 10) * 1000 : delay;

                console.warn(
                    `HAI.ai [Claude]: ${status || 'Error'}. Retrying in ${waitTime}ms... (${retries} left)`
                );
                await new Promise(resolve => setTimeout(resolve, waitTime));
                return this.callWithRetry(fn, retries - 1, delay * 2);
            }
            throw error;
        }
    }
}
