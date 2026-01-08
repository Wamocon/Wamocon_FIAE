/**
 * HAI.ai Text Chunker
 * 
 * Splits long documents into optimal chunks for embedding.
 * Uses semantic boundaries (paragraphs, sentences) for better context preservation.
 * 
 * @module lib/hai/chunker
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const DEFAULT_CHUNK_SIZE = 500; // Target tokens per chunk (Gemini has 2048 token limit for embeddings)
const DEFAULT_OVERLAP = 50; // Overlap tokens for context continuity
const CHARS_PER_TOKEN = 4; // Rough estimate: 1 token ≈ 4 characters

// ============================================================================
// TYPES
// ============================================================================

export interface ChunkOptions {
    maxChunkSize?: number; // Max tokens per chunk
    overlap?: number; // Overlap tokens between chunks
    preserveParagraphs?: boolean; // Try to keep paragraphs intact
    preserveSentences?: boolean; // Try to keep sentences intact
}

export interface TextChunk {
    index: number;
    content: string;
    charCount: number;
    estimatedTokens: number;
    metadata?: {
        startOffset: number;
        endOffset: number;
        paragraphIndex?: number;
    };
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Estimate token count from character count
 */
function estimateTokens(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
}

/**
 * Split text into paragraphs
 */
function splitIntoParagraphs(text: string): string[] {
    return text
        .split(/\n\s*\n/)
        .map(p => p.trim())
        .filter(p => p.length > 0);
}

/**
 * Split text into sentences (German-aware)
 */
function splitIntoSentences(text: string): string[] {
    // Handle German abbreviations to avoid false splits
    const protectedText = text
        .replace(/z\.\s*B\./gi, 'z·B·')
        .replace(/d\.\s*h\./gi, 'd·h·')
        .replace(/u\.\s*a\./gi, 'u·a·')
        .replace(/etc\./gi, 'etc·')
        .replace(/bzw\./gi, 'bzw·')
        .replace(/vgl\./gi, 'vgl·')
        .replace(/Nr\./gi, 'Nr·')
        .replace(/Abs\./gi, 'Abs·')
        .replace(/par\./gi, 'par·');

    // Split on sentence endings
    const sentences = protectedText
        .split(/(?<=[.!?])\s+/)
        .map(s => s.trim())
        .filter(s => s.length > 0)
        .map(s => s.replace(/·/g, '.')); // Restore abbreviations

    return sentences;
}

// ============================================================================
// MAIN CHUNKING FUNCTIONS
// ============================================================================

/**
 * Chunk text using smart semantic splitting
 * 
 * Strategy:
 * 1. Try to split by paragraphs
 * 2. If paragraph is too long, split by sentences
 * 3. If sentence is still too long, split by character count with word boundaries
 */
export function chunkText(text: string, options: ChunkOptions = {}): TextChunk[] {
    const maxChunkSize = options.maxChunkSize ?? DEFAULT_CHUNK_SIZE;
    const overlap = options.overlap ?? DEFAULT_OVERLAP;
    const preserveParagraphs = options.preserveParagraphs ?? true;
    const preserveSentences = options.preserveSentences ?? true;

    const maxChars = maxChunkSize * CHARS_PER_TOKEN;
    const overlapChars = overlap * CHARS_PER_TOKEN;

    // Clean and normalize text
    const cleanedText = text
        .replace(/\r\n/g, '\n')
        .replace(/\t/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();

    if (cleanedText.length === 0) {
        return [];
    }

    const chunks: TextChunk[] = [];
    let currentChunk = '';
    let chunkStartOffset = 0;
    let globalOffset = 0;

    // Split into paragraphs first
    const paragraphs = preserveParagraphs ? splitIntoParagraphs(cleanedText) : [cleanedText];

    for (let pIndex = 0; pIndex < paragraphs.length; pIndex++) {
        const paragraph = paragraphs[pIndex];

        // If adding this paragraph exceeds max, save current chunk first
        if (currentChunk.length > 0 && currentChunk.length + paragraph.length + 1 > maxChars) {
            chunks.push(createChunk(currentChunk, chunks.length, chunkStartOffset));

            // Start new chunk with overlap from previous
            const overlapText = getOverlapText(currentChunk, overlapChars);
            chunkStartOffset = globalOffset - overlapText.length;
            currentChunk = overlapText;
        }

        // If paragraph itself is too long, split it
        if (paragraph.length > maxChars) {
            // If we have content, save it first
            if (currentChunk.length > 0) {
                chunks.push(createChunk(currentChunk, chunks.length, chunkStartOffset));
                currentChunk = '';
                chunkStartOffset = globalOffset;
            }

            // Split paragraph by sentences
            const sentences = preserveSentences ? splitIntoSentences(paragraph) : [paragraph];

            for (const sentence of sentences) {
                if (currentChunk.length + sentence.length + 1 > maxChars && currentChunk.length > 0) {
                    chunks.push(createChunk(currentChunk, chunks.length, chunkStartOffset));
                    const overlapText = getOverlapText(currentChunk, overlapChars);
                    chunkStartOffset = globalOffset - overlapText.length;
                    currentChunk = overlapText;
                }

                // If single sentence is too long, force split
                if (sentence.length > maxChars) {
                    const forcedChunks = forceSplitText(sentence, maxChars, overlapChars);
                    for (const fc of forcedChunks) {
                        if (currentChunk.length > 0) {
                            chunks.push(createChunk(currentChunk + ' ' + fc, chunks.length, chunkStartOffset));
                            chunkStartOffset = globalOffset;
                            currentChunk = '';
                        } else {
                            chunks.push(createChunk(fc, chunks.length, chunkStartOffset));
                            chunkStartOffset = globalOffset;
                        }
                    }
                } else {
                    currentChunk = currentChunk ? currentChunk + ' ' + sentence : sentence;
                }
            }
        } else {
            // Paragraph fits, add it
            currentChunk = currentChunk ? currentChunk + '\n\n' + paragraph : paragraph;
        }

        globalOffset += paragraph.length + 2; // +2 for paragraph separator
    }

    // Don't forget the last chunk
    if (currentChunk.trim().length > 0) {
        chunks.push(createChunk(currentChunk, chunks.length, chunkStartOffset));
    }

    return chunks;
}

/**
 * Create a chunk object
 */
function createChunk(content: string, index: number, startOffset: number): TextChunk {
    const trimmedContent = content.trim();
    return {
        index,
        content: trimmedContent,
        charCount: trimmedContent.length,
        estimatedTokens: estimateTokens(trimmedContent),
        metadata: {
            startOffset,
            endOffset: startOffset + trimmedContent.length,
        },
    };
}

/**
 * Get overlap text from the end of a chunk
 */
function getOverlapText(text: string, overlapChars: number): string {
    if (text.length <= overlapChars) {
        return text;
    }

    // Try to break at a word boundary
    const tail = text.slice(-overlapChars);
    const firstSpace = tail.indexOf(' ');

    if (firstSpace > 0 && firstSpace < overlapChars / 2) {
        return tail.slice(firstSpace + 1);
    }

    return tail;
}

/**
 * Force split text that's too long (last resort)
 */
function forceSplitText(text: string, maxChars: number, overlapChars: number): string[] {
    const chunks: string[] = [];
    let remaining = text;

    while (remaining.length > 0) {
        if (remaining.length <= maxChars) {
            chunks.push(remaining);
            break;
        }

        // Find a good break point (word boundary)
        let breakPoint = maxChars;
        const searchStart = Math.max(0, maxChars - 100);

        for (let i = maxChars; i > searchStart; i--) {
            if (remaining[i] === ' ') {
                breakPoint = i;
                break;
            }
        }

        chunks.push(remaining.slice(0, breakPoint));

        // Move forward with overlap
        const nextStart = Math.max(0, breakPoint - overlapChars);
        remaining = remaining.slice(nextStart);
    }

    return chunks;
}

/**
 * Chunk a document with title/header awareness
 */
export function chunkDocument(
    content: string,
    title: string,
    options: ChunkOptions = {}
): TextChunk[] {
    // Prepend title to first chunk for context
    const chunks = chunkText(content, options);

    if (chunks.length > 0 && title) {
        chunks[0].content = `# ${title}\n\n${chunks[0].content}`;
        chunks[0].charCount = chunks[0].content.length;
        chunks[0].estimatedTokens = estimateTokens(chunks[0].content);
    }

    return chunks;
}

// Export for testing
export { estimateTokens, splitIntoParagraphs, splitIntoSentences };
