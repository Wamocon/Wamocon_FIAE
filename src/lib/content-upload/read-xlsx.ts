// Reader of an Excel file (.xlsx) from its bytes, for the learning field mapping of the
// content upload (package UP2 of docs/ki-upload-konzept.md).
//
// Pure: no file system, no database, no network. The answer is the rows of one sheet as
// text and a list of findings, never an exception. A file that must not be processed
// (macro, encryption, external links, a zip bomb, ...) ends as rejected with a code, a
// file that cannot be read ends as failed.
//
// Why a reader of its own and not readXlsxRows of the import script: that function
// opens the zip with JSZip first and counts the entries afterwards, and it accepts
// 50 MB and 500000 cells. The script reads files of the owner, the upload reads files
// that anyone with the right to upload may choose. So this reader runs the same safe
// order as the Word reader (read-docx.ts), with the limits of limits.ts XLSX_LIMITS, and
// only then uses the cell parser of the import (xlsx-sheet.ts), which reads one sheet by
// a linear scan.
//
// The checks, the cheap and safe ones first:
//   1. size of the input and the first bytes (zip, old Office, anything else)
//   2. the zip directory at the end of the file, read without opening the file: number
//      of entries, names, encryption flag, declared sizes (every entry, the sum, and the
//      ratio of unpacked to packed size), the compression method
//   3. the names of the entries: a macro project, ActiveX, external workbook links, data
//      connections, a name that leaves the package
//   4. only then JSZip opens the file, and every part is read with a cap on the bytes
//      that really come out of the unpacking
//   5. content types and relationships (a macro enabled type, a reference that points
//      outside of the file), the workbook (external references), and markers in every
//      XML part that is read (a DOCTYPE, a comment or a CDATA section hides text from the
//      scan in a way Excel does not show)
//   6. the rows of the sheets: number of cells, rows and the last column
//
// What is never done: a formula is not evaluated (only the value that the file stored
// with the formula is read), a link, a template, a connection or an object is never
// opened or fetched, nothing is written anywhere. Hidden sheets are not read.

import {
  readCapped,
  readZipDirectory,
  type ZipEntryInfo,
} from '../content-import/docx-paragraphs';
import {
  columnIndex,
  parseRelationshipTargets,
  parseSharedStrings,
  parseSheetXml,
  openZip,
  parseWorkbookSheets,
  partPath,
  type SheetRow,
} from '../content-import/learning-fields/xlsx-sheet';

import {
  finding,
  firstBlocking,
  type Finding,
  type ReadStatus,
} from './findings';
import { XLSX_LIMITS } from './limits';
import { scanRelationships } from './read-docx';

type XlsxLimits = Record<keyof typeof XLSX_LIMITS, number>;

export interface ReadXlsxOptions {
  limits?: Partial<XlsxLimits>;
  /**
   * Whether a sheet is the one that is wanted (the table has the form of a mapping
   * table). The first sheet that says yes is returned, otherwise the first visible sheet.
   */
  pick?: (rows: SheetRow[], sheetName: string) => boolean;
}

export interface ReadXlsxResult {
  status: ReadStatus;
  /** Code of the first blocking finding, null when the file was read. */
  code: string | null;
  /** Rows of the chosen sheet. Cell texts: server side only, never stored or shown. */
  rows: SheetRow[];
  sheetName: string | null;
  /** The sheet was chosen by `pick` (false: nothing matched, the first sheet is returned). */
  picked: boolean;
  findings: Finding[];
  stats: {
    entries: number;
    sheets: number;
    cells: number;
    rows: number;
    formulas: number;
  };
}

const OLE_MAGIC = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
/** "EncryptedPackage" in UTF-16 little endian: the stream of an encrypted file. */
const ENCRYPTED_PACKAGE = Buffer.from(
  [...'EncryptedPackage'].flatMap(letter => [letter.charCodeAt(0), 0])
);
/** Size limit of the small parts that are read besides the sheets. */
const MAX_PART_BYTES = 1024 * 1024;
const MAX_RELATIONSHIP_FILES = 50;
const MEGABYTE = 1024 * 1024;

const SUSPICIOUS_NAME =
  /\.(?:exe|dll|bat|cmd|ps1|vbs|js|jar|msi|scr|lnk|hta)$/i;

const startsWith = (bytes: Uint8Array, magic: readonly number[]) =>
  magic.every((value, index) => bytes[index] === value);

/** The checks of the names and declared sizes of the entries, before the file is opened. */
function inspectEntries(
  entries: readonly ZipEntryInfo[],
  limits: XlsxLimits,
  findings: Finding[]
): { hasWorkbook: boolean } {
  const seen = new Set<string>();
  let duplicate = false;
  let unsafe = false;
  let encrypted = false;
  let macro = false;
  let activeX = false;
  let external = false;
  let connections = false;
  let hasWorkbook = false;
  let partTooLarge = false;
  let ratioTooHigh = false;
  let method = false;
  let embedded = false;
  let suspicious = false;
  let total = 0;
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
    if (lower.startsWith('xl/activex/')) activeX = true;
    // Excel 4.0 macro sheets and dialog sheets are macros as well
    if (
      lower.startsWith('xl/macrosheets/') ||
      lower.startsWith('xl/dialogsheets/')
    ) {
      macro = true;
    }
    if (lower.startsWith('xl/externallinks/')) external = true;
    if (
      lower === 'xl/connections.xml' ||
      lower.startsWith('xl/querytables/') ||
      lower.startsWith('xl/connections/')
    ) {
      connections = true;
    }
    if (lower === 'xl/workbook.xml') hasWorkbook = true;
    if (
      lower.startsWith('xl/embeddings/') ||
      /oleobject\d*\.bin$/.test(lower)
    ) {
      embedded = true;
    }
    if (SUSPICIOUS_NAME.test(lower)) suspicious = true;
    if (!entry.dir) {
      if (entry.method !== 0 && entry.method !== 8) method = true;
      if (entry.size > limits.maxPartBytes) partTooLarge = true;
      // A bomb packs far tighter than a table does. Small entries cannot hurt.
      if (
        entry.size > MEGABYTE &&
        entry.size / Math.max(entry.compressedSize, 1) > limits.maxRatio
      ) {
        ratioTooHigh = true;
      }
      total += entry.size;
    }
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
    external,
    'EXTERNAL_LINKS',
    'blocking',
    'The file links to other workbooks.'
  );
  add(
    connections,
    'DATA_CONNECTIONS',
    'blocking',
    'The file holds data connections or queries.'
  );
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
    method,
    'UNSUPPORTED_COMPRESSION',
    'blocking',
    'An entry uses a compression that the reader does not accept.'
  );
  add(
    partTooLarge,
    'PART_TOO_LARGE',
    'blocking',
    'An entry is larger than the limit when unpacked.'
  );
  add(
    ratioTooHigh || total > limits.maxUnpackedBytes,
    'ZIP_BOMB',
    'blocking',
    'The entries unpack to far more than the file holds.'
  );
  add(
    !hasWorkbook,
    'NOT_AN_XLSX',
    'blocking',
    'Not an Excel workbook: xl/workbook.xml is missing.'
  );
  add(
    embedded,
    'EMBEDDED_OBJECT',
    'warning',
    'The file contains embedded objects. They are never opened.'
  );
  add(
    suspicious,
    'SUSPICIOUS_ENTRY',
    'warning',
    'The file contains an entry that looks like a program or a script.'
  );
  return { hasWorkbook };
}

/** A DOCTYPE, a comment or a CDATA section: Excel writes none of them into these parts. */
const hasXmlFeatures = (xml: string) =>
  xml.includes('<!--') || xml.includes('<![CDATA[') || /<!DOCTYPE/i.test(xml);

function empty(
  status: ReadStatus,
  findings: Finding[],
  entries = 0
): ReadXlsxResult {
  return {
    status,
    code: firstBlocking(findings),
    rows: [],
    sheetName: null,
    picked: false,
    findings,
    stats: { entries, sheets: 0, cells: 0, rows: 0, formulas: 0 },
  };
}

const countOf = (text: string, needle: string): number => {
  let count = 0;
  for (
    let at = text.indexOf(needle);
    at >= 0;
    at = text.indexOf(needle, at + 1)
  ) {
    count += 1;
  }
  return count;
};

/** Reads an Excel file. Never throws. */
export async function readXlsx(
  input: Uint8Array | ArrayBuffer,
  options: ReadXlsxOptions = {}
): Promise<ReadXlsxResult> {
  const findings: Finding[] = [];
  // per key: an explicit undefined must not switch a limit off
  const limits: XlsxLimits = { ...XLSX_LIMITS };
  for (const key of Object.keys(XLSX_LIMITS) as Array<
    keyof typeof XLSX_LIMITS
  >) {
    const given = options.limits?.[key];
    if (typeof given === 'number') limits[key] = given;
  }
  const block = (code: string, message: string) =>
    findings.push(finding(code, 'blocking', message));
  const deadline = Date.now() + limits.timeoutMs;
  const late = () => Date.now() > deadline;
  const timedOut = (entries: number) => {
    block('TIMEOUT', 'The file took too long to read.');
    return empty('failed', findings, entries);
  };

  try {
    const bytes = ArrayBuffer.isView(input)
      ? new Uint8Array(input.buffer, input.byteOffset, input.byteLength)
      : new Uint8Array(input);
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
        block('LEGACY_XLS', 'The file is an old Excel file, not an .xlsx.');
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
        block('NOT_AN_XLSX', 'The file is not an Excel workbook.');
      }
      return empty('rejected', findings);
    }
    const entries = directory.entries.length;
    inspectEntries(directory.entries, limits, findings);
    if (firstBlocking(findings)) return empty('rejected', findings, entries);

    // JSZip opens the file only after the directory has passed
    let zip: Awaited<ReturnType<typeof openZip>>;
    try {
      zip = await openZip(bytes);
    } catch {
      block('ZIP_DAMAGED', 'The zip directory is damaged.');
      return empty('rejected', findings, entries);
    }
    // JSZip and the directory read above must name the same entries, otherwise the
    // checks on the directory were made on another file
    const opened = Object.keys(zip.files);
    const listed = new Set(directory.entries.map(e => e.name));
    if (
      opened.length !== entries ||
      opened.some(name => /^[ -~]*$/.test(name) && !listed.has(name))
    ) {
      block('ZIP_DAMAGED', 'The zip directory is damaged.');
      return empty('rejected', findings, entries);
    }
    if (late()) return timedOut(entries);

    const part = async (name: string, max: number): Promise<string | null> => {
      const file = zip.file(name);
      return file ? readCapped(file, max, name) : null;
    };

    // Content types: a macro enabled workbook type is refused.
    const types = await part('[Content_Types].xml', MAX_PART_BYTES);
    if (types === null) {
      findings.push(
        finding(
          'CONTENT_TYPES_MISSING',
          'warning',
          'The part [Content_Types].xml is missing.'
        )
      );
    } else if (/macroEnabled|macrosheet/i.test(types)) {
      block('MACRO_ENABLED', 'The workbook type allows macros.');
    }

    // Relationships that point outside of the file. They are only counted.
    const relationshipParts = directory.entries.filter(
      entry => !entry.dir && /\.rels$/i.test(entry.name)
    );
    if (relationshipParts.length > MAX_RELATIONSHIP_FILES) {
      block(
        'TOO_MANY_RELATIONSHIP_FILES',
        'The file has more relationship parts than a workbook has.'
      );
      return empty('rejected', findings, entries);
    }
    const outside = { template: 0, link: 0, other: 0 };
    for (const entry of relationshipParts) {
      const text = await part(entry.name, MAX_PART_BYTES);
      if (text === null) continue;
      const counts = scanRelationships(text);
      outside.template += counts.template;
      outside.link += counts.link;
      outside.other += counts.other;
    }
    if (outside.template > 0 || outside.other > 0) {
      // a template, a linked workbook, a linked object: nothing of that is ever opened
      block(
        'EXTERNAL_REFERENCE',
        'The file points to external templates, workbooks or objects.'
      );
    }
    if (outside.link > 0) {
      findings.push(
        finding(
          'EXTERNAL_LINK',
          'info',
          'The file has links to external addresses. They are never opened.',
          outside.link
        )
      );
    }
    if (firstBlocking(findings)) return empty('rejected', findings, entries);

    // The workbook, its relationships and the shared strings
    const workbookXml = (await part('xl/workbook.xml', MAX_PART_BYTES)) ?? '';
    if (hasXmlFeatures(workbookXml)) {
      block(
        'XML_FEATURES',
        'xl/workbook.xml holds a comment, CDATA or DOCTYPE.'
      );
      return empty('rejected', findings, entries);
    }
    if (workbookXml.includes('<externalReferences')) {
      block('EXTERNAL_LINKS', 'The workbook links to other workbooks.');
      return empty('rejected', findings, entries);
    }
    const sheets = parseWorkbookSheets(workbookXml);
    if (sheets.length === 0) {
      block('NO_SHEET', 'The workbook has no sheet.');
      return empty('rejected', findings, entries);
    }
    if (sheets.length > limits.maxSheets) {
      block('TOO_MANY_SHEETS', 'The workbook has more sheets than the limit.');
      return empty('rejected', findings, entries);
    }
    const relationships = parseRelationshipTargets(
      (await part('xl/_rels/workbook.xml.rels', MAX_PART_BYTES)) ?? ''
    );
    const sharedXml = await part('xl/sharedStrings.xml', limits.maxPartBytes);
    if (sharedXml !== null && hasXmlFeatures(sharedXml)) {
      block(
        'XML_FEATURES',
        'xl/sharedStrings.xml holds a comment, CDATA or DOCTYPE.'
      );
      return empty('rejected', findings, entries);
    }
    const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
    if (late()) return timedOut(entries);

    const visible = sheets.filter(s => s.state === null);
    if (visible.length < sheets.length) {
      findings.push(
        finding(
          'HIDDEN_SHEET',
          'info',
          'The workbook has hidden sheets. They are not read.'
        )
      );
    }
    let chosen: { name: string; rows: SheetRow[]; picked: boolean } | null =
      null;
    let cells = 0;
    let formulas = 0;
    for (const sheet of visible.slice(0, limits.maxSheetsRead)) {
      const target =
        sheet.id === null
          ? null
          : (relationships.find(r => r.id === sheet.id)?.target ?? null);
      if (!target) continue;
      const xml = await part(partPath(target), limits.maxPartBytes);
      if (xml === null) continue;
      if (hasXmlFeatures(xml)) {
        block('XML_FEATURES', 'A sheet holds a comment, CDATA or DOCTYPE.');
        return empty('rejected', findings, entries);
      }
      let rows: SheetRow[];
      try {
        rows = parseSheetXml(xml, shared, { maxCells: limits.maxCells });
      } catch {
        block('TOO_MANY_CELLS', 'A sheet has more cells than the limit.');
        return empty('rejected', findings, entries);
      }
      formulas += countOf(xml, '<f>') + countOf(xml, '<f ');
      if (rows.length > limits.maxRows) {
        block('TOO_MANY_ROWS', 'A sheet has more rows than the limit.');
        return empty('rejected', findings, entries);
      }
      for (const row of rows) {
        for (const column of Object.keys(row.cells)) {
          cells += 1;
          if (columnIndex(column) > limits.maxColumn) {
            block(
              'TOO_MANY_COLUMNS',
              'A sheet reaches beyond the column limit.'
            );
            return empty('rejected', findings, entries);
          }
        }
      }
      const wanted = options.pick ? options.pick(rows, sheet.name) : true;
      if (chosen === null || (wanted && !chosen.picked)) {
        chosen = { name: sheet.name, rows, picked: wanted };
      }
      if (wanted) break;
      if (late()) return timedOut(entries);
    }
    if (chosen === null) {
      block('NO_SHEET', 'The workbook has no sheet that could be read.');
      return empty('failed', findings, entries);
    }
    if (formulas > 0) {
      findings.push(
        finding(
          'FORMULAS',
          'info',
          'The file has formulas. They are not evaluated, only the stored values are read.',
          formulas
        )
      );
    }
    return {
      status: 'ok',
      code: null,
      rows: chosen.rows,
      sheetName: chosen.name,
      picked: chosen.picked,
      findings,
      stats: {
        entries,
        sheets: sheets.length,
        cells,
        rows: chosen.rows.length,
        formulas,
      },
    };
  } catch (error) {
    // Whatever went wrong, the caller gets a result and no detail of the file.
    const code = (error as { code?: string } | null)?.code;
    if (code === 'PART_TOO_LARGE' || code === 'XML_TOO_LARGE') {
      block('PART_TOO_LARGE', 'A part of the file is larger than the limit.');
      return empty('rejected', findings);
    }
    block('PARSE_ERROR', 'The Excel file could not be read.');
    return empty('failed', findings);
  }
}
