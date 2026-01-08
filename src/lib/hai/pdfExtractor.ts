/**
 * HAI.ai PDF Extractor
 * 
 * Extracts text content from PDF files stored in Supabase.
 * Uses pdf-parse for server-side text extraction.
 * 
 * @module lib/hai/pdfExtractor
 */

// Note: pdf-parse is a server-side only library
// This file should only be used in API routes, not client components

// ============================================================================
// TYPES
// ============================================================================

export interface PDFExtractionResult {
    success: boolean;
    text: string;
    pageCount: number;
    error?: string;
    metadata?: {
        title?: string;
        author?: string;
        creationDate?: Date;
    };
}

export interface ContentDocument {
    id: string;
    title: string;
    storageUrl: string;
    enablerId?: string;
    courseId?: string;
}

// ============================================================================
// MAIN FUNCTIONS
// ============================================================================

/**
 * Extract text from a PDF URL
 * 
 * @param url - Public URL of the PDF in Supabase storage
 * @returns Extracted text content
 */
export async function extractTextFromPDF(url: string): Promise<PDFExtractionResult> {
    try {
        // pdf-parse v1.x - simple function-based API
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pdfParse = require('pdf-parse');

        let buffer: Buffer;

        // Check if it's a remote URL or local file path
        if (url.startsWith('http')) {
            // Fetch remote PDF
            const response = await fetch(url);

            if (!response.ok) {
                return {
                    success: false,
                    text: '',
                    pageCount: 0,
                    error: `Failed to fetch PDF: ${response.status} ${response.statusText}`,
                };
            }

            const arrayBuffer = await response.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
        } else {
            // Read local file
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const fs = require('fs');

            // Robustly handle file paths
            let filePath = url;
            if (filePath.startsWith('file://')) {
                // handle file:/// and file:// prefixes
                filePath = filePath.replace(/^file:\/\/\/?/, '');
                // Decode URI encoding (e.g. %20 -> space)
                filePath = decodeURIComponent(filePath);
            }

            if (!fs.existsSync(filePath)) {
                console.warn(`[PDF Warning] File not found, skipping: ${filePath}`);
                return {
                    success: false,
                    text: '',
                    pageCount: 0,
                    error: `File not found: ${filePath}`,
                };
            }

            try {
                buffer = fs.readFileSync(filePath);
            } catch (fsError: any) {
                console.warn(`[PDF Warning] Could not read file: ${filePath}`, fsError.message);
                return {
                    success: false,
                    text: '',
                    pageCount: 0,
                    error: `Read error: ${fsError.message}`,
                };
            }
        }

        // Parse the PDF
        // Returns: { text, numpages, info, metadata, version }
        const data = await pdfParse(buffer);

        // Clean the extracted text
        const cleanedText = cleanPDFText(data.text || '');

        return {
            success: true,
            text: cleanedText,
            pageCount: data.numpages || 0,
            metadata: {
                title: data.info?.Title,
                author: data.info?.Author,
                creationDate: data.info?.CreationDate ? new Date(data.info.CreationDate) : undefined,
            },
        };
    } catch (error) {
        console.error('HAI.ai: Error extracting PDF text:', error);
        return {
            success: false,
            text: '',
            pageCount: 0,
            error: error instanceof Error ? error.message : 'Unknown error extracting PDF',
        };
    }
}

/**
 * Clean extracted PDF text
 * Removes excessive whitespace, page breaks, headers/footers
 */
function cleanPDFText(text: string): string {
    return text
        // Normalize line endings
        .replace(/\r\n/g, '\n')
        // Remove page numbers (common formats)
        .replace(/^[\s]*\d+[\s]*$/gm, '')
        .replace(/Seite \d+ von \d+/gi, '')
        .replace(/Page \d+ of \d+/gi, '')
        // Remove excessive whitespace
        .replace(/\n{3,}/g, '\n\n')
        .replace(/[ \t]+/g, ' ')
        // Remove common header/footer patterns
        .replace(/^\s*©.*$/gm, '')
        .replace(/^\s*www\..*$/gm, '')
        // Trim
        .trim();
}

/**
 * Extract and combine text from multiple PDFs
 */
export async function extractFromMultiplePDFs(
    urls: string[]
): Promise<{ combinedText: string; results: PDFExtractionResult[] }> {
    const results: PDFExtractionResult[] = [];
    const texts: string[] = [];

    for (const url of urls) {
        const result = await extractTextFromPDF(url);
        results.push(result);

        if (result.success && result.text) {
            texts.push(result.text);
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
        combinedText: texts.join('\n\n---\n\n'),
        results,
    };
}

/**
 * Get text preview (first N characters)
 */
export function getTextPreview(text: string, maxLength: number = 500): string {
    if (text.length <= maxLength) {
        return text;
    }

    // Try to cut at a word boundary
    const truncated = text.slice(0, maxLength);
    const lastSpace = truncated.lastIndexOf(' ');

    if (lastSpace > maxLength * 0.8) {
        return truncated.slice(0, lastSpace) + '...';
    }

    return truncated + '...';
}

/**
 * Check if a URL points to a PDF
 */
export function isPDFUrl(url: string): boolean {
    const lowerUrl = url.toLowerCase();
    return lowerUrl.endsWith('.pdf') || lowerUrl.includes('application/pdf');
}

/**
 * Estimate token count for extracted text
 */
export function estimateTokenCount(text: string): number {
    // Rough estimate: ~4 characters per token for German text
    return Math.ceil(text.length / 4);
}
