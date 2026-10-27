// Reader of a Word file from its bytes (docs/ki-upload-konzept.md, 5.1).
//
// Pure: no file system, no database, no network. The answer is a list of
// paragraphs and a list of findings, never an exception. A file that must not
// be processed (macro, encryption, external template, zip bomb, ...) ends as
// rejected with a code; a file that cannot be read ends as failed.
//
// The checks run in this order, the cheap and safe ones first:
//   1. size of the input and the first bytes (zip, old Office, anything else)
//   2. the zip directory at the end of the file, read without opening the file:
//      number of entries, names, encryption flag, declared size of
//      word/document.xml
//   3. only then JSZip opens the file, and the text is read with a cap on the
//      bytes that really come out of the unpacking
//   4. content types, relationships and markers in word/document.xml
// Nothing that a file points to (templates, links, images) is ever opened. The
// XML is read by the linear scan of docx-paragraphs.ts, which knows no
// entities except the five named and the numeric ones, so an entity cannot grow.

import {
  loadDocx,
  parseDocumentXml,
  readCapped,
  readZipDirectory,
  type DocxLimits,
  type ZipEntryInfo,
} from '../content-import/docx-paragraphs';
import type { Paragraph } from '../content-import/types';

import {
  finding,
  firstBlocking,
  type Finding,
  type ReadStatus,
} from './findings';
import { READ_LIMITS } from './limits';

export interface ReadDocxOptions {
  limits?: DocxLimits;
  /** Characters of the text above which the file fails (default 2 MB). */
  maxTextChars?: number;
  /** Paragraphs above which the file fails (default 50000). */
  maxParagraphs?: number;
}

export interface ReadDocxResult {
  status: ReadStatus;
  /** Code of the first blocking finding, null when the file was read. */
  code: string | null;
  paragraphs: Paragraph[];
  findings: Finding[];
  stats: {
    entries: number;
    images: number;
    paragraphs: number;
    characters: number;
  };
}

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** "EncryptedPackage" in UTF-16 little endian: the stream of an encrypted file. */
const ENCRYPTED_PACKAGE = Buffer.from(
  [...'EncryptedPackage'].flatMap(letter => [letter.charCodeAt(0), 0])
);
/** Size limit of the small parts that are read besides the text. */
const MAX_PART_BYTES = 1024 * 1024;
/** Most relationship files that are read. */
const MAX_RELATIONSHIP_FILES = 50;

const SUSPICIOUS_NAME =
  /\.(?:exe|dll|bat|cmd|ps1|vbs|js|jar|msi|scr|lnk|hta)$/i;

function toBytes(input: Uint8Array | ArrayBuffer): Uint8Array {
  return ArrayBuffer.isView(input)
    ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
    : new Uint8Array(input);
}

function startsWith(bytes: Uint8Array, magic: readonly number[]): boolean {
  return magic.every((value, index) => bytes[index] === value);
}

/** The checks of the names of the entries, before the file is opened. */
function inspectEntries(
  entries: readonly ZipEntryInfo[],
  maxXmlBytes: number,
  findings: Finding[]
): { images: number } {
  const seen = new Set<string>();
  let duplicate = false;
  let unsafe = false;
  let encrypted = false;
  let macro = false;
  let activeX = false;
  let hasDocument = false;
  let documentTooLarge = false;
  let comments = false;
  let notes = false;
  let headerFooter = false;
  let embedded = false;
  let suspicious = false;
  let images = 0;
  for (const entry of entries) {
    const name = entry.name;
    const lower = name.toLowerCase();
    if (seen.has(lower)) duplicate = true;
    seen.add(lower);
    if (
      name.includes('\0') ||
      name.includes('\\') ||
      name.startsWith('/') ||
      /^[A-Za-z]:/.test(name) ||
      name.split('/').includes('..')
    ) {
      unsafe = true;
    }
    if (entry.encrypted) encrypted = true;
    if (/(?:^|\/)vba(?:project\.bin|data\.xml)$/.test(lower)) macro = true;
    if (lower.startsWith('word/activex/')) activeX = true;
    if (lower === 'word/document.xml') {
      hasDocument = true;
      if (entry.size > maxXmlBytes) documentTooLarge = true;
    }
    if (/^word\/comments[^/]*\.xml$/.test(lower)) comments = true;
    if (/^word\/(?:footnotes|endnotes)\.xml$/.test(lower)) notes = true;
    if (/^word\/(?:header|footer)\d*\.xml$/.test(lower)) headerFooter = true;
    if (
      lower.startsWith('word/embeddings/') ||
      /(?:^|\/)oleobject\d*\.bin$/.test(lower)
    ) {
      embedded = true;
    }
    if (!entry.dir && lower.startsWith('word/media/')) images += 1;
    if (SUSPICIOUS_NAME.test(lower)) suspicious = true;
  }
  const add = (
    when: boolean,
    code: string,
    severity: Finding['severity'],
    message: string
  ) => {
    if (when) findings.push(finding(code, severity, message));
  };
  add(encrypted, 'ENCRYPTED', 'blocking', 'An entry of the zip is encrypted.');
  add(macro, 'MACRO_ENABLED', 'blocking', 'The file contains a macro project.');
  add(activeX, 'ACTIVE_X', 'blocking', 'The file contains ActiveX controls.');
  add(
    unsafe,
    'UNSAFE_ENTRY_NAME',
    'blocking',
    'An entry name leaves the package or holds a forbidden character.'
  );
  add(
    duplicate,
    'DUPLICATE_ENTRY',
    'blocking',
    'Two entries of the zip have the same name.'
  );
  add(
    !hasDocument,
    'NOT_A_DOCX',
    'blocking',
    'Not a Word document: word/document.xml is missing.'
  );
  add(
    documentTooLarge,
    'XML_TOO_LARGE',
    'blocking',
    'word/document.xml is larger than the limit when unpacked.'
  );
  add(comments, 'COMMENTS', 'info', 'The file has comments.');
  add(notes, 'NOTES', 'info', 'The file has footnotes or endnotes.');
  add(
    headerFooter,
    'HEADER_FOOTER',
    'info',
    'The file has headers or footers.'
  );
  add(
    embedded,
    'EMBEDDED_OBJECT',
    'warning',
    'The file contains embedded objects.'
  );
  add(
    suspicious,
    'SUSPICIOUS_ENTRY',
    'warning',
    'The file contains an entry that looks like a program or a script.'
  );
  return { images };
}

/**
 * Relationships that point outside of the package, by kind. The tag is read up
 * to the closing bracket that stands outside of a quoted value (a value may hold
 * a bracket), and white space of any kind may follow the element name.
 */
function scanRelationships(xml: string) {
  const counts = { template: 0, link: 0, other: 0 };
  const name = '<Relationship';
  let pos = 0;
  while (pos < xml.length) {
    const start = xml.indexOf(name, pos);
    if (start < 0) break;
    let i = start + name.length;
    let quote = 0;
    while (i < xml.length) {
      const c = xml.charCodeAt(i);
      if (quote !== 0) {
        if (c === quote) quote = 0;
      } else if (c === 34 || c === 39) quote = c;
      else if (c === 62) break;
      i += 1;
    }
    pos = i + 1;
    // <Relationships> (the root) is no relationship
    if (!/[\s/]/.test(xml.charAt(start + name.length))) continue;
    const tag = xml.slice(start, i);
    if (!/\bTargetMode\s*=\s*["']External["']/i.test(tag)) continue;
    const kind = /\bType\s*=\s*["'][^"']*\/([A-Za-z0-9]+)["']/.exec(tag)?.[1];
    if (kind === 'attachedTemplate') counts.template += 1;
    else if (kind === 'hyperlink') counts.link += 1;
    else counts.other += 1;
  }
  return counts;
}

function empty(
  status: ReadStatus,
  findings: Finding[],
  entries = 0
): ReadDocxResult {
  return {
    status,
    code: firstBlocking(findings),
    paragraphs: [],
    findings,
    stats: { entries, images: 0, paragraphs: 0, characters: 0 },
  };
}

/** Reads a Word file. Never throws. */
export async function readDocx(
  input: Uint8Array | ArrayBuffer,
  options: ReadDocxOptions = {}
): Promise<ReadDocxResult> {
  const findings: Finding[] = [];
  // per key: an explicit undefined must not switch a limit off
  const limits = {
    maxInputBytes: options.limits?.maxInputBytes ?? READ_LIMITS.maxInputBytes,
    maxXmlBytes: options.limits?.maxXmlBytes ?? READ_LIMITS.maxXmlBytes,
    maxEntries: options.limits?.maxEntries ?? READ_LIMITS.maxEntries,
  };
  const maxTextChars = options.maxTextChars ?? READ_LIMITS.maxTextChars;
  const maxParagraphs = options.maxParagraphs ?? READ_LIMITS.maxParagraphs;
  const block = (code: string, message: string) =>
    findings.push(finding(code, 'blocking', message));

  try {
    const bytes = toBytes(input);
    if (bytes.length > limits.maxInputBytes) {
      block('TOO_LARGE', 'The file is larger than the limit.');
      return empty('rejected', findings);
    }

    // Old Office files and encrypted Office files are no zip.
    if (startsWith(bytes, OLE_MAGIC)) {
      if (
        Buffer.from(bytes.buffer, bytes.byteOffset, bytes.length).includes(
          ENCRYPTED_PACKAGE
        )
      ) {
        block('ENCRYPTED', 'The file is an encrypted Office file.');
      } else {
        block('LEGACY_DOC', 'The file is an old Word file, not a .docx.');
      }
      return empty('rejected', findings);
    }

    let directory: ReturnType<typeof readZipDirectory>;
    try {
      directory = readZipDirectory(bytes, limits.maxEntries);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'TOO_MANY_ENTRIES') {
        block('TOO_MANY_ENTRIES', 'The zip has more entries than the limit.');
      } else if (code === 'ZIP_DAMAGED') {
        block('ZIP_DAMAGED', 'The zip directory is damaged.');
      } else {
        block('NOT_A_DOCX', 'The file is not a Word document.');
      }
      return empty('rejected', findings);
    }
    const { images } = inspectEntries(
      directory.entries,
      limits.maxXmlBytes,
      findings
    );
    if (firstBlocking(findings)) {
      return empty('rejected', findings, directory.entries.length);
    }

    let loaded: Awaited<ReturnType<typeof loadDocx>>;
    try {
      loaded = await loadDocx(bytes, limits);
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'ZIP_DAMAGED') {
        block('ZIP_DAMAGED', 'The zip directory is damaged.');
        return empty('rejected', findings, directory.entries.length);
      }
      if (code === 'TOO_MANY_ENTRIES') {
        block('TOO_MANY_ENTRIES', 'The zip has more entries than the limit.');
        return empty('rejected', findings, directory.entries.length);
      }
      if (code === 'XML_TOO_LARGE') {
        block('XML_TOO_LARGE', 'word/document.xml is larger than the limit.');
      } else if (code === 'PART_TOO_LARGE') {
        block('PART_TOO_LARGE', 'A part of the file is larger than the limit.');
      } else {
        block('PARSE_ERROR', 'The Word file could not be read.');
      }
      return empty('failed', findings, directory.entries.length);
    }

    // Content types: a macro enabled document type is refused.
    const types = loaded.zip.file('[Content_Types].xml');
    if (!types) {
      findings.push(
        finding(
          'CONTENT_TYPES_MISSING',
          'warning',
          'The part [Content_Types].xml is missing.'
        )
      );
    } else {
      const text = await readCapped(
        types,
        MAX_PART_BYTES,
        '[Content_Types].xml'
      );
      if (/macroEnabled/i.test(text)) {
        block('MACRO_ENABLED', 'The document type allows macros.');
      }
    }

    // Relationships that point outside of the file. They are only counted.
    const relationships = directory.entries.filter(
      entry => !entry.dir && /\.rels$/i.test(entry.name)
    );
    if (relationships.length > MAX_RELATIONSHIP_FILES) {
      block(
        'TOO_MANY_RELATIONSHIP_FILES',
        'The file has more relationship parts than a Word file has.'
      );
      return empty('rejected', findings, directory.entries.length);
    }
    const external = { template: 0, link: 0, other: 0 };
    for (const entry of relationships) {
      const part = loaded.zip.file(entry.name);
      if (!part) continue;
      const counts = scanRelationships(
        await readCapped(part, MAX_PART_BYTES, 'relationships')
      );
      external.template += counts.template;
      external.link += counts.link;
      external.other += counts.other;
    }
    if (external.template > 0) {
      block('EXTERNAL_TEMPLATE', 'The file points to an external template.');
    }
    if (external.other > 0) {
      findings.push(
        finding(
          'EXTERNAL_REFERENCE',
          'warning',
          'The file points to external objects or files. They are never opened.',
          external.other
        )
      );
    }
    if (external.link > 0) {
      findings.push(
        finding(
          'EXTERNAL_LINK',
          'info',
          'The file has links to external addresses. They are never opened.',
          external.link
        )
      );
    }
    if (firstBlocking(findings)) {
      return empty('rejected', findings, directory.entries.length);
    }

    // Markers in the text part
    const xml = loaded.xml;
    // Word writes none of these in word/document.xml. A comment or a CDATA
    // section would hide text from the scan in a way that Word does not show, a
    // DOCTYPE is the start of an entity trick.
    if (
      xml.includes('<!--') ||
      xml.includes('<![CDATA[') ||
      /<!DOCTYPE/i.test(xml)
    ) {
      block(
        'XML_FEATURES',
        'word/document.xml holds a comment, a CDATA section or a DOCTYPE.'
      );
      return empty('rejected', findings, directory.entries.length);
    }
    const mark = (
      needle: string,
      code: string,
      severity: Finding['severity'],
      message: string
    ) => {
      if (xml.includes(needle)) findings.push(finding(code, severity, message));
    };
    mark('<w:ins ', 'TRACKED_CHANGES', 'info', 'The file has tracked changes.');
    if (!findings.some(f => f.code === 'TRACKED_CHANGES')) {
      mark(
        '<w:del ',
        'TRACKED_CHANGES',
        'info',
        'The file has tracked changes.'
      );
    }
    mark('txbxContent', 'TEXT_BOXES', 'info', 'The file has text boxes.');
    mark(
      'w:altChunk',
      'EMBEDDED_DOCUMENT',
      'warning',
      'The file embeds another document.'
    );
    if (xml.includes('<w:vanish') || loaded.hiddenStyles.size > 0) {
      findings.push(
        finding(
          'HIDDEN_TEXT',
          'info',
          'The file has hidden text. It is not read.'
        )
      );
    }

    let paragraphs: Paragraph[];
    try {
      paragraphs = parseDocumentXml(xml, {
        hiddenStyles: loaded.hiddenStyles,
        maxParagraphs,
        maxChars: maxTextChars,
      });
    } catch (error) {
      const code = (error as { code?: string }).code;
      if (code === 'TOO_MANY_PARAGRAPHS') {
        block(
          'TOO_MANY_PARAGRAPHS',
          'The file has more paragraphs than the limit.'
        );
      } else if (code === 'TEXT_TOO_LARGE') {
        block('TEXT_TOO_LARGE', 'The text is longer than the limit.');
      } else {
        block('PARSE_ERROR', 'The Word file could not be read.');
      }
      return empty('failed', findings, directory.entries.length);
    }
    const characters = paragraphs.reduce((sum, p) => sum + p.text.length, 0);
    if (!paragraphs.some(p => p.text.trim().length > 0)) {
      block('NO_TEXT', 'The file has no readable text.');
      return empty('failed', findings, directory.entries.length);
    }
    return {
      status: 'ok',
      code: null,
      paragraphs,
      findings,
      stats: {
        entries: directory.entries.length,
        images,
        paragraphs: paragraphs.length,
        characters,
      },
    };
  } catch {
    // Whatever went wrong, the caller gets a result and no detail of the file.
    block('PARSE_ERROR', 'The Word file could not be read.');
    return empty('failed', findings);
  }
}
