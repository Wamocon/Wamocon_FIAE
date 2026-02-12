/**
 * HAI.ai PDF Extractor
 * 
 * Extracts text content from PDF files stored in Supabase.
 * Supports both full-text extraction and per-page extraction for PageIndex.
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

/** Per-page extraction result for PageIndex support */
export interface PageExtractionResult {
    page: number;
    text: string;
    charCount: number;
}

/** Result from per-page extraction */
export interface PerPageExtractionResult {
    success: boolean;
    pages: PageExtractionResult[];
    totalPages: number;
    totalCharacters: number;
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
    useCaseId?: string;
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

// ============================================================================
// PAGE-BY-PAGE EXTRACTION (PageIndex Support)
// ============================================================================

/**
 * Extract text from a PDF URL page-by-page for PageIndex support.
 * This enables deterministic citations like "Page 3" in HAI responses.
 * 
 * Uses pdf-parse with custom page render callback to capture per-page text.
 * 
 * @param url - Public URL of the PDF in Supabase storage
 * @returns Per-page extraction result with page numbers and text
 */
export async function extractTextByPage(url: string): Promise<PerPageExtractionResult> {
    try {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const pdfParse = require('pdf-parse');

        let buffer: Buffer;

        // Check if it's a remote URL or local file path
        if (url.startsWith('http')) {
            const response = await fetch(url);

            if (!response.ok) {
                return {
                    success: false,
                    pages: [],
                    totalPages: 0,
                    totalCharacters: 0,
                    error: `Failed to fetch PDF: ${response.status} ${response.statusText}`,
                };
            }

            const arrayBuffer = await response.arrayBuffer();
            buffer = Buffer.from(arrayBuffer);
        } else {
            // eslint-disable-next-line @typescript-eslint/no-var-requires
            const fs = require('fs');

            let filePath = url;
            if (filePath.startsWith('file://')) {
                filePath = filePath.replace(/^file:\/\/\/?/, '');
                filePath = decodeURIComponent(filePath);
            }

            if (!fs.existsSync(filePath)) {
                return {
                    success: false,
                    pages: [],
                    totalPages: 0,
                    totalCharacters: 0,
                    error: `File not found: ${filePath}`,
                };
            }

            buffer = fs.readFileSync(filePath);
        }

        // Collect pages during parsing
        const pages: PageExtractionResult[] = [];
        let currentPage = 0;

        // Custom page render function to capture per-page text
        const pageRenderCallback = function (pageData: any) {
            currentPage++;
            
            // Get text content from the page
            let pageText = '';
            
            // pdf-parse provides text via pageData.getTextContent()
            return pageData.getTextContent().then(function (textContent: any) {
                // Combine all text items
                const textItems = textContent.items || [];
                pageText = textItems
                    .map((item: any) => item.str || '')
                    .join(' ');
                
                // Clean the page text
                const cleanedText = cleanPDFText(pageText);
                
                pages.push({
                    page: currentPage,
                    text: cleanedText,
                    charCount: cleanedText.length,
                });
                
                // Return empty string since we're collecting pages separately
                return '';
            });
        };

        // Parse with custom page render
        const options = {
            pagerender: pageRenderCallback,
        };

        const data = await pdfParse(buffer, options);

        // If custom render didn't capture pages, fall back to splitting by heuristics
        if (pages.length === 0 && data.text) {
            // Fallback: Split by common page break patterns
            const pageTexts = splitTextIntoPages(data.text, data.numpages || 1);
            pageTexts.forEach((text, index) => {
                const cleanedText = cleanPDFText(text);
                pages.push({
                    page: index + 1,
                    text: cleanedText,
                    charCount: cleanedText.length,
                });
            });
        }

        const totalCharacters = pages.reduce((sum, p) => sum + p.charCount, 0);

        return {
            success: true,
            pages,
            totalPages: pages.length || data.numpages || 0,
            totalCharacters,
            metadata: {
                title: data.info?.Title,
                author: data.info?.Author,
                creationDate: data.info?.CreationDate ? new Date(data.info.CreationDate) : undefined,
            },
        };
    } catch (error) {
        console.error('HAI.ai: Error extracting PDF by page:', error);
        return {
            success: false,
            pages: [],
            totalPages: 0,
            totalCharacters: 0,
            error: error instanceof Error ? error.message : 'Unknown error extracting PDF',
        };
    }
}

/**
 * Fallback: Split aggregated PDF text into estimated pages.
 * Uses common page break patterns and character count heuristics.
 */
function splitTextIntoPages(text: string, estimatedPages: number): string[] {
    // Try to split by form feed characters (common PDF page break)
    const formFeedSplit = text.split('\f');
    if (formFeedSplit.length > 1) {
        return formFeedSplit.filter(p => p.trim().length > 0);
    }

    // Try to split by common page number patterns
    const pagePatterns = [
        /\n\s*-\s*\d+\s*-\s*\n/g,  // - 1 -
        /\n\s*Seite\s+\d+\s*\n/gi, // Seite 1
        /\n\s*Page\s+\d+\s*\n/gi,  // Page 1
    ];

    for (const pattern of pagePatterns) {
        const splits = text.split(pattern);
        if (splits.length > 1) {
            return splits.filter(p => p.trim().length > 0);
        }
    }

    // Last resort: Split by estimated character count per page
    if (estimatedPages > 1) {
        const avgCharsPerPage = Math.ceil(text.length / estimatedPages);
        const pages: string[] = [];
        
        let remaining = text;
        while (remaining.length > 0 && pages.length < estimatedPages) {
            // Try to break at paragraph boundary near the estimated length
            let breakPoint = avgCharsPerPage;
            if (breakPoint < remaining.length) {
                // Look for paragraph break within 20% of target
                const searchStart = Math.floor(avgCharsPerPage * 0.8);
                const searchEnd = Math.min(Math.floor(avgCharsPerPage * 1.2), remaining.length);
                const searchArea = remaining.slice(searchStart, searchEnd);
                const paragraphBreak = searchArea.search(/\n\n/);
                
                if (paragraphBreak !== -1) {
                    breakPoint = searchStart + paragraphBreak + 2;
                }
            } else {
                breakPoint = remaining.length;
            }
            
            pages.push(remaining.slice(0, breakPoint).trim());
            remaining = remaining.slice(breakPoint).trim();
        }
        
        // Add any remaining text to last page
        if (remaining.length > 0 && pages.length > 0) {
            pages[pages.length - 1] += '\n\n' + remaining;
        } else if (remaining.length > 0) {
            pages.push(remaining);
        }
        
        return pages;
    }

    // Single page
    return [text];
}

/**
 * Extract text from multiple PDFs with per-page support.
 * Returns combined pages with source document tracking.
 */
export async function extractByPageFromMultiplePDFs(
    documents: Array<{ url: string; documentId: string; title: string }>
): Promise<{
    allPages: Array<PageExtractionResult & { documentId: string; documentTitle: string }>;
    results: PerPageExtractionResult[];
}> {
    const allPages: Array<PageExtractionResult & { documentId: string; documentTitle: string }> = [];
    const results: PerPageExtractionResult[] = [];

    for (const doc of documents) {
        const result = await extractTextByPage(doc.url);
        results.push(result);

        if (result.success) {
            for (const page of result.pages) {
                allPages.push({
                    ...page,
                    documentId: doc.documentId,
                    documentTitle: doc.title,
                });
            }
        }

        // Small delay between requests
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return { allPages, results };
}
