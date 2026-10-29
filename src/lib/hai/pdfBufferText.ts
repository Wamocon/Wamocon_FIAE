/**
 * Text of a PDF that is already in memory. Shared by the PDF extractor (which
 * fetches a public file) and the reader of the private model solutions (which
 * gets the bytes from the storage with the server key). No network, no
 * alias imports, so the reindex script can load it directly.
 *
 * @module lib/hai/pdfBufferText
 */

/**
 * Clean extracted PDF text
 * Removes excessive whitespace, page breaks, headers/footers
 */
export function cleanPDFText(text: string): string {
  return (
    text
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
      .trim()
  );
}

/** A file that does not start with this is no PDF, whatever its name says. */
const PDF_MAGIC = '%PDF-';

/** Whether the bytes start like a PDF file. */
export function looksLikePdf(buffer: Uint8Array): boolean {
  if (buffer.length < PDF_MAGIC.length) return false;
  for (let i = 0; i < PDF_MAGIC.length; i++) {
    if (buffer[i] !== PDF_MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

export type PdfBufferText =
  | { ok: true; text: string; pageCount: number }
  | { ok: false; error: string };

/**
 * The cleaned text and the page count of a PDF in memory. The error never
 * repeats a piece of the file.
 */
export async function extractTextFromPdfBuffer(
  buffer: Buffer
): Promise<PdfBufferText> {
  if (!looksLikePdf(buffer)) return { ok: false, error: 'The file is no PDF.' };
  try {
    // pdf-parse v1.x - import from lib/ to bypass index.js test file loading
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    const pdfParse = require('pdf-parse/lib/pdf-parse');
    const data = await pdfParse(buffer);
    return {
      ok: true,
      text: cleanPDFText(data.text || ''),
      pageCount: data.numpages || 0,
    };
  } catch {
    return { ok: false, error: 'The PDF could not be read.' };
  }
}
