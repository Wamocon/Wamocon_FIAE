// Thin helper: reads the paragraphs of a .docx (text and whether the whole
// paragraph is bold) and a few statistics. It uses JSZip, which is already a
// dependency of the project, and reads only word/document.xml and the file
// list. It does not touch the file system: the caller passes the bytes.
//
// The XML is read by one linear scan (no nested lazy regexes), so a damaged or
// hostile file cannot make the scan quadratic. Limits protect against zip
// bombs: size of the input, number of entries and size of the unpacked
// word/document.xml.

import JSZip from 'jszip';

import type { Paragraph } from './types';

export interface DocxStats {
  /** First paragraph with text. */
  heading: string | null;
  /** Number of characters of all paragraphs. */
  characters: number;
  paragraphs: number;
  /** Number of files below word/media. */
  images: number;
}

export interface DocxLimits {
  /** Largest accepted input in bytes (default 200 MB). */
  maxInputBytes?: number;
  /** Largest accepted unpacked word/document.xml in bytes (default 64 MB). */
  maxXmlBytes?: number;
  /** Largest accepted number of entries in the zip (default 20000). */
  maxEntries?: number;
}

type DocxData = Buffer | Uint8Array | ArrayBuffer;

const DEFAULT_LIMITS = {
  maxInputBytes: 200 * 1024 * 1024,
  maxXmlBytes: 64 * 1024 * 1024,
  maxEntries: 20000,
};

const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g;
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};

function decodeEntities(text: string): string {
  return text.replace(ENTITY, (_all, hex, dec, named) => {
    if (named) return NAMED[named];
    const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : '';
  });
}

interface OpenParagraph {
  text: string;
  textRuns: number;
  boldRuns: number;
}

/**
 * Paragraphs of a word/document.xml. Skipped on purpose: paragraph properties,
 * text boxes (txbxContent, the Fallback copy of an AlternateContent), deleted
 * and moved text (delText, moveFrom) and the history of formatting changes.
 */
export function parseDocumentXml(xml: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];
  const length = xml.length;
  let para: OpenParagraph | null = null;
  let inRun = false;
  let inRunProps = false;
  let runText = '';
  let runBold = false;
  let pos = 0;

  const skipPast = (closeTag: string) => {
    const at = xml.indexOf(closeTag, pos);
    pos = at < 0 ? length : at + closeTag.length;
  };
  const endRun = () => {
    if (inRun && para) {
      para.text += runText;
      if (runText.trim().length > 0) {
        para.textRuns += 1;
        if (runBold) para.boldRuns += 1;
      }
    }
    inRun = false;
    inRunProps = false;
    runText = '';
    runBold = false;
  };
  const endParagraph = () => {
    endRun();
    if (para) {
      paragraphs.push({
        text: para.text,
        bold: para.textRuns > 0 && para.boldRuns === para.textRuns,
      });
    }
    para = null;
  };

  while (pos < length) {
    const lt = xml.indexOf('<', pos);
    if (lt < 0) break;
    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) break;
    pos = gt + 1;
    const raw = xml.slice(lt + 1, gt);
    const closing = raw.charCodeAt(0) === 47;
    const selfClosing = raw.charCodeAt(raw.length - 1) === 47;
    const name = /^\/?([^\s/>]+)/.exec(raw)?.[1];
    if (!name) continue;

    switch (name) {
      case 'mc:Fallback':
      case 'w:txbxContent':
      case 'w:pPr':
      case 'w:rPrChange':
      case 'w:moveFrom':
        if (!closing && !selfClosing) skipPast(`</${name}>`);
        break;
      case 'w:p':
        endParagraph();
        if (!closing) {
          para = { text: '', textRuns: 0, boldRuns: 0 };
          if (selfClosing) endParagraph();
        }
        break;
      case 'w:r':
        endRun();
        if (!closing && !selfClosing && para) inRun = true;
        break;
      case 'w:rPr':
        inRunProps = inRun && !closing && !selfClosing;
        break;
      case 'w:b':
        if (inRunProps && !closing) {
          const value = /w:val="([^"]*)"/.exec(raw);
          if (!value || !['0', 'false', 'off'].includes(value[1].toLowerCase()))
            runBold = true;
        }
        break;
      case 'w:t': {
        if (closing || selfClosing) break;
        const end = xml.indexOf('<', pos);
        const stop = end < 0 ? length : end;
        if (inRun) runText += decodeEntities(xml.slice(pos, stop));
        pos = stop;
        break;
      }
      case 'w:tab':
        if (inRun) runText += '\t';
        break;
      case 'w:br':
      case 'w:cr':
        if (inRun) runText += '\n';
        break;
      case 'w:noBreakHyphen':
        if (inRun) runText += '-';
        break;
      default:
        break;
    }
  }
  endParagraph();
  return paragraphs;
}

/** Reads a zip entry as text and gives up above the byte limit. */
function readCapped(
  file: JSZip.JSZipObject,
  maxBytes: number
): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let done = false;
    const stream = file.nodeStream('nodebuffer');
    stream.on('data', (chunk: Buffer) => {
      if (done) return;
      size += chunk.length;
      if (size > maxBytes) {
        done = true;
        // Not reading any more stops the unpacking (back pressure).
        stream.pause();
        reject(
          new Error(`word/document.xml is larger than ${maxBytes} bytes.`)
        );
        return;
      }
      chunks.push(chunk);
    });
    stream.on('error', error => {
      if (!done) {
        done = true;
        reject(error);
      }
    });
    stream.on('end', () => {
      if (!done) {
        done = true;
        resolve(Buffer.concat(chunks).toString('utf8'));
      }
    });
  });
}

async function load(data: DocxData, limits: DocxLimits = {}) {
  const { maxInputBytes, maxXmlBytes, maxEntries } = {
    ...DEFAULT_LIMITS,
    ...limits,
  };
  if (data.byteLength > maxInputBytes) {
    throw new Error(`The document is larger than ${maxInputBytes} bytes.`);
  }
  const zip = await JSZip.loadAsync(data);
  if (Object.keys(zip.files).length > maxEntries) {
    throw new Error(`The document has more than ${maxEntries} entries.`);
  }
  const file = zip.file('word/document.xml');
  if (!file) {
    throw new Error('Not a Word document: word/document.xml is missing.');
  }
  return { zip, xml: await readCapped(file, maxXmlBytes) };
}

/** Paragraphs of a .docx with text and a bold mark per paragraph. */
export async function extractDocxParagraphs(
  data: DocxData,
  limits?: DocxLimits
): Promise<Paragraph[]> {
  return parseDocumentXml((await load(data, limits)).xml);
}

/** Heading, size and image count of a .docx, for the long enabler texts. */
export async function extractDocxStats(
  data: DocxData,
  limits?: DocxLimits
): Promise<DocxStats> {
  const { zip, xml } = await load(data, limits);
  const paragraphs = parseDocumentXml(xml);
  const first = paragraphs.find(p => p.text.trim().length > 0);
  let images = 0;
  zip.forEach((path, entry) => {
    if (!entry.dir && path.startsWith('word/media/')) images += 1;
  });
  return {
    heading: first ? first.text.trim() : null,
    characters: paragraphs.reduce((sum, p) => sum + p.text.length, 0),
    paragraphs: paragraphs.length,
    images,
  };
}
