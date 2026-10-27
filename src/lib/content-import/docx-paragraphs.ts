// Thin helper: reads the paragraphs of a .docx (text and whether the whole
// paragraph is bold) and a few statistics. It uses JSZip, which is already a
// dependency of the project, and reads only word/document.xml and the file
// list. It does not touch the file system: the caller passes the bytes.
//
// The XML is read by one linear scan (no nested lazy regexes), so a damaged or
// hostile file cannot make the scan quadratic. Limits protect against zip
// bombs: size of the input, number of entries and size of the unpacked
// word/document.xml. The number of entries and the declared size of
// word/document.xml are read from the zip directory (the end of the file)
// BEFORE JSZip opens the file, because JSZip builds an object for every entry
// when it opens a file. The unpacking itself is capped again while reading.
//
// Hidden text (the run property w:vanish, also through a character style, a
// paragraph style or a style they are based on) is not read: Word does not show
// it, so it is no part of what a person sees.

import type JSZip from 'jszip';

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

/** An error with a stable code (no class, the scripts load this file as is). */
function limitError(code: string, message: string): Error {
  return Object.assign(new Error(message), { code });
}

export interface ZipEntryInfo {
  name: string;
  /** Declared size of the unpacked entry (the file may lie, see readCapped). */
  size: number;
  compressedSize: number;
  /** General purpose flag 0: the entry is encrypted. */
  encrypted: boolean;
  dir: boolean;
  method: number;
}

export interface ZipDirectory {
  count: number;
  entries: ZipEntryInfo[];
}

const SIG_END = 0x06054b50;
const SIG_ZIP64_END = 0x06064b50;
const SIG_ZIP64_LOCATOR = 0x07064b50;
const SIG_ENTRY = 0x02014b50;
const END_RECORD = 22;
const MAX_COMMENT = 0xffff;

const damaged = () =>
  limitError('ZIP_DAMAGED', 'The zip directory is damaged.');

/** A 64 bit value as a number, or -1 when it does not fit safely. */
function readUint64(view: DataView, at: number): number {
  const low = view.getUint32(at, true);
  const high = view.getUint32(at + 4, true);
  return high > 0x1fffff ? -1 : high * 0x100000000 + low;
}

/**
 * Reads the directory of a zip from its end, without opening the file. Gives
 * the number of entries and, when the number is within maxEntries, the name,
 * the declared sizes and the flags of every entry. Throws an error with the
 * code TOO_MANY_ENTRIES, NOT_A_ZIP or ZIP_DAMAGED.
 */
export function readZipDirectory(
  data: DocxData,
  maxEntries: number
): ZipDirectory {
  const bytes = ArrayBuffer.isView(data)
    ? new Uint8Array(data.buffer, data.byteOffset, data.byteLength)
    : new Uint8Array(data);
  const length = bytes.length;
  if (length < END_RECORD) throw limitError('NOT_A_ZIP', 'Not a zip file.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, length);

  // The end record is the LAST signature of the file, exactly the one that JSZip
  // takes (a different choice would let the two readers see different
  // directories). Its comment must reach the end of the file, otherwise the file
  // is damaged or built to confuse a reader.
  let end = -1;
  const lowest = Math.max(0, length - END_RECORD - MAX_COMMENT);
  for (let at = length - END_RECORD; at >= lowest; at -= 1) {
    if (view.getUint32(at, true) === SIG_END) {
      end = at;
      break;
    }
  }
  if (end < 0) throw limitError('NOT_A_ZIP', 'Not a zip file.');
  if (end + END_RECORD + view.getUint16(end + 20, true) !== length) {
    throw damaged();
  }
  let directoryEnd = end;

  let count = view.getUint16(end + 10, true);
  let size = view.getUint32(end + 12, true);
  let offset = view.getUint32(end + 16, true);
  if (count === 0xffff || size === 0xffffffff || offset === 0xffffffff) {
    const locator = end - 20;
    if (locator < 0 || view.getUint32(locator, true) !== SIG_ZIP64_LOCATOR) {
      throw damaged();
    }
    const record = readUint64(view, locator + 8);
    if (
      record < 0 ||
      record + 56 > length ||
      view.getUint32(record, true) !== SIG_ZIP64_END
    ) {
      throw damaged();
    }
    count = readUint64(view, record + 32);
    size = readUint64(view, record + 40);
    offset = readUint64(view, record + 48);
    if (count < 0 || size < 0 || offset < 0) throw damaged();
    directoryEnd = record;
  }
  if (count > maxEntries) {
    throw limitError(
      'TOO_MANY_ENTRIES',
      `The document has more than ${maxEntries} entries.`
    );
  }
  // The directory ends where the end record (or its zip64 record) begins. JSZip
  // reads every record up to there and ignores the count of the end record.
  if (offset + size !== directoryEnd) throw damaged();

  const entries: ZipEntryInfo[] = [];
  const decoder = new TextDecoder('utf-8');
  let at = offset;
  const stop = offset + size;
  for (let i = 0; i < count; i += 1) {
    if (at + 46 > stop || view.getUint32(at, true) !== SIG_ENTRY) {
      throw damaged();
    }
    const flags = view.getUint16(at + 8, true);
    const method = view.getUint16(at + 10, true);
    let compressedSize = view.getUint32(at + 20, true);
    let unpackedSize = view.getUint32(at + 24, true);
    const nameLength = view.getUint16(at + 28, true);
    const extraLength = view.getUint16(at + 30, true);
    const commentLength = view.getUint16(at + 32, true);
    const next = at + 46 + nameLength + extraLength + commentLength;
    if (next > stop) throw damaged();
    const nameStart = at + 46;
    const nameBytes = bytes.subarray(nameStart, nameStart + nameLength);
    const name = decoder.decode(nameBytes);
    let localOffset = view.getUint32(at + 42, true);
    if (
      unpackedSize === 0xffffffff ||
      compressedSize === 0xffffffff ||
      localOffset === 0xffffffff
    ) {
      // zip64 extra field (id 1): the values that did not fit, in this order
      let extra = nameStart + nameLength;
      const extraEnd = extra + extraLength;
      while (extra + 4 <= extraEnd) {
        const id = view.getUint16(extra, true);
        const fieldLength = view.getUint16(extra + 2, true);
        if (id === 1) {
          let value = extra + 4;
          if (unpackedSize === 0xffffffff && value + 8 <= extraEnd) {
            unpackedSize = readUint64(view, value);
            value += 8;
          }
          if (compressedSize === 0xffffffff && value + 8 <= extraEnd) {
            compressedSize = readUint64(view, value);
            value += 8;
          }
          if (localOffset === 0xffffffff && value + 8 <= extraEnd) {
            localOffset = readUint64(view, value);
          }
          break;
        }
        extra += 4 + fieldLength;
      }
      // a size that does not fit is treated as the largest possible one
      if (unpackedSize < 0 || unpackedSize === 0xffffffff) {
        unpackedSize = Number.MAX_SAFE_INTEGER;
      }
      if (compressedSize < 0 || compressedSize === 0xffffffff) {
        compressedSize = Number.MAX_SAFE_INTEGER;
      }
    }
    // Name of the local header: the same bytes as in the directory.
    if (localOffset >= 0 && localOffset !== 0xffffffff) {
      if (
        localOffset + 30 > length ||
        view.getUint32(localOffset, true) !== 0x04034b50
      ) {
        throw damaged();
      }
      const localName = view.getUint16(localOffset + 26, true);
      const localStart = localOffset + 30;
      if (localName !== nameLength || localStart + localName > length) {
        throw damaged();
      }
      for (let k = 0; k < nameLength; k += 1) {
        if (bytes[localStart + k] !== nameBytes[k]) throw damaged();
      }
    }
    entries.push({
      name,
      size: unpackedSize,
      compressedSize,
      encrypted: (flags & 1) !== 0,
      dir: name.endsWith('/'),
      method,
    });
    at = next;
  }
  if (at !== stop) throw damaged();
  return { count, entries };
}

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

/** Most styles that are read, and the deepest chain of "based on". */
const MAX_STYLES = 5000;
const MAX_STYLE_DEPTH = 50;

/** The value of w:val: false for "0", "false" and "off", otherwise true. */
function switchedOn(tag: string): boolean {
  const value = /w:val=["']([^"']*)["']/.exec(tag);
  return !value || !['0', 'false', 'off'].includes(value[1].toLowerCase());
}

/**
 * The ids of the styles whose text is hidden (the run property w:vanish), also
 * through a style they are based on. A style that switches hiding off again
 * (w:val="0") is not hidden, a cycle of styles is not hidden. Never throws, a
 * damaged style sheet gives what could be read.
 */
export function hiddenStyleIds(xml: string): Set<string> {
  const styles = new Map<
    string,
    { vanish: boolean | null; basedOn: string | null }
  >();
  let pos = 0;
  while (pos < xml.length && styles.size < MAX_STYLES) {
    const start = xml.indexOf('<w:style ', pos);
    if (start < 0) break;
    const tagEnd = xml.indexOf('>', start);
    if (tagEnd < 0) break;
    const head = xml.slice(start, tagEnd);
    const id = /w:styleId=["']([^"']*)["']/.exec(head)?.[1];
    pos = tagEnd + 1;
    if (head.endsWith('/')) {
      if (id) styles.set(id, { vanish: null, basedOn: null });
      continue;
    }
    const close = xml.indexOf('</w:style>', pos);
    const body = xml.slice(pos, close < 0 ? xml.length : close);
    pos = close < 0 ? xml.length : close + '</w:style>'.length;
    if (!id) continue;
    // The run properties of the style, without the ones of the paragraph mark.
    const markStart = body.indexOf('<w:pPr>');
    const markEnd = markStart < 0 ? -1 : body.indexOf('</w:pPr>', markStart);
    const properties =
      markStart < 0
        ? body
        : body.slice(0, markStart) +
          (markEnd < 0 ? '' : body.slice(markEnd + '</w:pPr>'.length));
    const vanish = /<w:vanish(?:[\s/][^>]*)?>/.exec(properties);
    styles.set(id, {
      vanish: vanish ? switchedOn(vanish[0]) : null,
      basedOn: /<w:basedOn\s+w:val=["']([^"']*)["']/.exec(body)?.[1] ?? null,
    });
  }
  // The answer of every style is worked out once: a long chain of styles must
  // not cost a walk per style. A chain deeper than MAX_STYLE_DEPTH, and a
  // cycle, count as not hidden.
  const answer = new Map<string, boolean>();
  const resolve = (id: string): boolean => {
    const chain: string[] = [];
    let current: string | null = id;
    let result = false;
    while (current !== null && chain.length <= MAX_STYLE_DEPTH) {
      const known = answer.get(current);
      if (known !== undefined) {
        result = known;
        break;
      }
      if (chain.includes(current)) break;
      chain.push(current);
      const style = styles.get(current);
      if (!style) break;
      if (style.vanish !== null) {
        result = style.vanish;
        break;
      }
      current = style.basedOn;
    }
    for (const visited of chain) answer.set(visited, result);
    return result;
  };
  const hidden = new Set<string>();
  for (const id of styles.keys()) if (resolve(id)) hidden.add(id);
  return hidden;
}

interface OpenParagraph {
  text: string;
  textRuns: number;
  boldRuns: number;
  row: number | undefined;
  cell: number | undefined;
  /** The paragraph style hides the text of the paragraph. */
  hidden: boolean;
}

export interface ParseOptions {
  /** Styles whose text is hidden, see hiddenStyleIds. */
  hiddenStyles?: ReadonlySet<string>;
  /** Gives up (code TOO_MANY_PARAGRAPHS) above this number of paragraphs. */
  maxParagraphs?: number;
  /** Gives up (code TEXT_TOO_LARGE) above this number of characters. */
  maxChars?: number;
}

/**
 * Paragraphs of a word/document.xml. Skipped on purpose: paragraph properties,
 * text boxes (txbxContent, the Fallback copy of an AlternateContent), deleted
 * and moved text (delText, moveFrom), the history of formatting changes and
 * hidden text (w:vanish, directly or through a style).
 */
export function parseDocumentXml(
  xml: string,
  options: ParseOptions = {}
): Paragraph[] {
  const hiddenStyles = options.hiddenStyles ?? new Set<string>();
  const paragraphs: Paragraph[] = [];
  const length = xml.length;
  let para: OpenParagraph | null = null;
  let inRun = false;
  let inRunProps = false;
  let runText = '';
  let runBold = false;
  // null: the run says nothing about hiding, then its style and the paragraph
  // style decide. A direct w:vanish always wins over a style.
  let runVanish: boolean | null = null;
  let runStyleHidden = false;
  let pos = 0;
  // Tables: a running number for every row and cell, so a reader can put the
  // cells of one row back together. The stacks follow nested tables.
  let rowCount = 0;
  let cellCount = 0;
  const rowStack: number[] = [];
  const cellStack: number[] = [];

  const skipPast = (closeTag: string) => {
    const at = xml.indexOf(closeTag, pos);
    pos = at < 0 ? length : at + closeTag.length;
  };
  const endRun = () => {
    if (inRun && para) {
      const hidden = runVanish ?? (runStyleHidden || para.hidden);
      if (!hidden) {
        para.text += runText;
        if (runText.trim().length > 0) {
          para.textRuns += 1;
          if (runBold) para.boldRuns += 1;
        }
      }
    }
    inRun = false;
    inRunProps = false;
    runText = '';
    runBold = false;
    runVanish = null;
    runStyleHidden = false;
  };
  let characters = 0;
  const maxParagraphs = options.maxParagraphs ?? Infinity;
  const maxChars = options.maxChars ?? Infinity;
  const endParagraph = () => {
    endRun();
    if (para) {
      characters += para.text.length;
      if (paragraphs.length >= maxParagraphs) {
        throw limitError(
          'TOO_MANY_PARAGRAPHS',
          `The document has more than ${maxParagraphs} paragraphs.`
        );
      }
      if (characters > maxChars) {
        throw limitError(
          'TEXT_TOO_LARGE',
          `The text is longer than ${maxChars} characters.`
        );
      }
      paragraphs.push({
        text: para.text,
        bold: para.textRuns > 0 && para.boldRuns === para.textRuns,
        ...(para.row !== undefined ? { row: para.row } : {}),
        ...(para.cell !== undefined ? { cell: para.cell } : {}),
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
      case 'w:pPr':
        if (!closing && !selfClosing) {
          // Only the style of the paragraph is read from the properties.
          const from = pos;
          skipPast('</w:pPr>');
          if (para && hiddenStyles.size > 0) {
            const style = /<w:pStyle\s+w:val=["']([^"']*)["']/.exec(
              xml.slice(from, pos)
            );
            if (style && hiddenStyles.has(style[1])) para.hidden = true;
          }
        }
        break;
      case 'mc:Fallback':
      case 'w:txbxContent':
      case 'w:rPrChange':
      case 'w:moveFrom':
        if (!closing && !selfClosing) skipPast(`</${name}>`);
        break;
      case 'w:p':
        endParagraph();
        if (!closing) {
          para = {
            text: '',
            textRuns: 0,
            boldRuns: 0,
            row: rowStack[rowStack.length - 1],
            cell: cellStack[cellStack.length - 1],
            hidden: false,
          };
          if (selfClosing) endParagraph();
        }
        break;
      case 'w:tr':
        if (closing) rowStack.pop();
        else if (!selfClosing) rowStack.push(++rowCount);
        break;
      case 'w:tc':
        if (closing) cellStack.pop();
        else if (!selfClosing) cellStack.push(++cellCount);
        break;
      case 'w:r':
        endRun();
        if (!closing && !selfClosing && para) inRun = true;
        break;
      case 'w:rPr':
        inRunProps = inRun && !closing && !selfClosing;
        break;
      case 'w:b':
        if (inRunProps && !closing && switchedOn(raw)) runBold = true;
        break;
      case 'w:vanish':
        if (inRunProps && !closing) runVanish = switchedOn(raw);
        break;
      case 'w:rStyle':
        if (inRunProps && !closing) {
          const style = /w:val=["']([^"']*)["']/.exec(raw);
          if (style && hiddenStyles.has(style[1])) runStyleHidden = true;
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

/**
 * Reads a zip entry as text and gives up above the byte limit. The limit
 * counts the bytes that really come out of the unpacking, not the size the
 * file declares.
 */
export function readCapped(
  file: JSZip.JSZipObject,
  maxBytes: number,
  name = 'word/document.xml'
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
          limitError(
            name === 'word/document.xml' ? 'XML_TOO_LARGE' : 'PART_TOO_LARGE',
            `${name} is larger than ${maxBytes} bytes.`
          )
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

/** The limit of word/styles.xml, which only lists the styles. */
const MAX_STYLES_BYTES = 4 * 1024 * 1024;

/**
 * Opens a .docx within the limits and reads word/document.xml and the hidden
 * styles. The number of entries and the declared size of word/document.xml are
 * checked from the zip directory before JSZip opens the file.
 */
export async function loadDocx(data: DocxData, limits: DocxLimits = {}) {
  // per key, so an explicit undefined does not switch a limit off
  const maxInputBytes = limits.maxInputBytes ?? DEFAULT_LIMITS.maxInputBytes;
  const maxXmlBytes = limits.maxXmlBytes ?? DEFAULT_LIMITS.maxXmlBytes;
  const maxEntries = limits.maxEntries ?? DEFAULT_LIMITS.maxEntries;
  if (data.byteLength > maxInputBytes) {
    throw limitError(
      'INPUT_TOO_LARGE',
      `The document is larger than ${maxInputBytes} bytes.`
    );
  }
  const directory = readZipDirectory(data, maxEntries);
  const declared = directory.entries.find(e => e.name === 'word/document.xml');
  if (!declared) {
    throw limitError(
      'NOT_A_DOCX',
      'Not a Word document: word/document.xml is missing.'
    );
  }
  if (declared.size > maxXmlBytes) {
    throw limitError(
      'XML_TOO_LARGE',
      `word/document.xml is larger than ${maxXmlBytes} bytes.`
    );
  }
  // JSZip is loaded on first use, so the scripts that only need the path
  // derivation or the parsers start without the dependency installed.
  const { default: Zip } = await import('jszip');
  const zip = await Zip.loadAsync(data);
  const opened = Object.keys(zip.files);
  if (opened.length > maxEntries) {
    throw limitError(
      'TOO_MANY_ENTRIES',
      `The document has more than ${maxEntries} entries.`
    );
  }
  // JSZip and the directory read above must name the same entries, otherwise
  // the checks on the directory were made on another file. (Names with other
  // characters than ASCII may be decoded differently, they are not compared.)
  const listed = new Set(directory.entries.map(e => e.name));
  if (
    opened.length !== directory.entries.length ||
    opened.some(name => /^[ -~]*$/.test(name) && !listed.has(name))
  ) {
    throw limitError('ZIP_DAMAGED', 'The zip directory is damaged.');
  }
  const file = zip.file('word/document.xml');
  if (!file) {
    throw limitError(
      'NOT_A_DOCX',
      'Not a Word document: word/document.xml is missing.'
    );
  }
  const xml = await readCapped(file, maxXmlBytes);
  const styles = zip.file('word/styles.xml');
  const hiddenStyles = styles
    ? hiddenStyleIds(
        await readCapped(styles, MAX_STYLES_BYTES, 'word/styles.xml')
      )
    : new Set<string>();
  return { zip, xml, hiddenStyles };
}

/** Paragraphs of a .docx with text and a bold mark per paragraph. */
export async function extractDocxParagraphs(
  data: DocxData,
  limits?: DocxLimits
): Promise<Paragraph[]> {
  const { xml, hiddenStyles } = await loadDocx(data, limits);
  return parseDocumentXml(xml, { hiddenStyles });
}

/** Heading, size and image count of a .docx, for the long enabler texts. */
export async function extractDocxStats(
  data: DocxData,
  limits?: DocxLimits
): Promise<DocxStats> {
  const { zip, xml, hiddenStyles } = await loadDocx(data, limits);
  const paragraphs = parseDocumentXml(xml, { hiddenStyles });
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
