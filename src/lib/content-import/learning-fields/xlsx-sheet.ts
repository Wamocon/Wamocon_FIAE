// Reads the cells of a sheet of an .xlsx file (phase 4.5): row number, column
// letters and text. It uses JSZip, which is already a dependency of the project
// (the docx reader uses it too), and reads only xl/workbook.xml, its
// relationships, the shared strings and one sheet. No spreadsheet library with
// its parsing surface is added. It does not touch the file system: the caller
// passes the bytes.
//
// The XML is read by one linear scan (no nested lazy regexes), so a damaged or
// hostile file cannot make the scan quadratic. Limits protect against zip bombs:
// size of the input, number of entries, size of each unpacked XML part and number
// of cells.

import type JSZip from 'jszip';

export interface SheetRow {
  /** Row number as stored in the file (the number Excel shows). */
  row: number;
  /** Cell text by column letters (A, B, ... AA). Empty cells are left out. */
  cells: Record<string, string>;
}

export interface XlsxLimits {
  /** Largest accepted input in bytes (default 50 MB). */
  maxInputBytes?: number;
  /** Largest accepted unpacked XML part in bytes (default 64 MB). */
  maxXmlBytes?: number;
  /** Largest accepted number of entries in the zip (default 2000). */
  maxEntries?: number;
  /** Largest accepted number of cells in the sheet (default 500000). */
  maxCells?: number;
}

export interface XlsxReadOptions extends XlsxLimits {
  /** Name of the sheet. Default: the first sheet of the workbook. */
  sheet?: string;
}

type XlsxData = Buffer | Uint8Array | ArrayBuffer;

const DEFAULT_LIMITS = {
  maxInputBytes: 50 * 1024 * 1024,
  maxXmlBytes: 64 * 1024 * 1024,
  maxEntries: 2000,
  maxCells: 500000,
};

const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g;
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};
// A spreadsheet writes a control character as _x0002_ and a literal underscore
// that starts such a sequence as _x005F_.
const CONTROL_ESCAPE = /_x([0-9a-fA-F]{4})_/g;

function decodeText(text: string): string {
  return text
    .replace(ENTITY, (_all, hex, dec, named) => {
      if (named) return NAMED[named];
      const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
      return Number.isFinite(code) && code > 0 && code <= 0x10ffff
        ? String.fromCodePoint(code)
        : '';
    })
    .replace(CONTROL_ESCAPE, (_all, hex) =>
      String.fromCharCode(parseInt(hex, 16))
    );
}

/** Position of a column name: A is 1, Z is 26, AA is 27. */
export function columnIndex(letters: string): number {
  let n = 0;
  for (const ch of letters.toUpperCase()) {
    n = n * 26 + (ch.charCodeAt(0) - 64);
  }
  return n;
}

const attribute = (raw: string, name: string): string | null => {
  const match = new RegExp(`\\s${name}="([^"]*)"`).exec(raw);
  return match ? match[1] : null;
};

interface Tag {
  name: string;
  closing: boolean;
  selfClosing: boolean;
  raw: string;
}

/** Walks the tags of an XML text; `visit` may move the position with `skip`. */
function walk(
  xml: string,
  visit: (
    tag: Tag,
    api: { text(): string; skipPast(closeTag: string): void }
  ) => void
) {
  const length = xml.length;
  let pos = 0;
  const api = {
    text(): string {
      const end = xml.indexOf('<', pos);
      const stop = end < 0 ? length : end;
      const value = xml.slice(pos, stop);
      pos = stop;
      return value;
    },
    skipPast(closeTag: string) {
      const at = xml.indexOf(closeTag, pos);
      pos = at < 0 ? length : at + closeTag.length;
    },
  };
  while (pos < length) {
    const lt = xml.indexOf('<', pos);
    if (lt < 0) break;
    const gt = xml.indexOf('>', lt + 1);
    if (gt < 0) break;
    pos = gt + 1;
    const raw = xml.slice(lt + 1, gt);
    const name = /^\/?([^\s/>]+)/.exec(raw)?.[1];
    if (!name || raw.charCodeAt(0) === 63 || raw.charCodeAt(0) === 33) continue;
    visit(
      {
        name,
        closing: raw.charCodeAt(0) === 47,
        selfClosing: raw.charCodeAt(raw.length - 1) === 47,
        raw,
      },
      api
    );
  }
}

/** The strings of xl/sharedStrings.xml in order (rich text joined, phonetic runs left out). */
export function parseSharedStrings(xml: string): string[] {
  const out: string[] = [];
  let current: string | null = null;
  let inPhonetic = false;
  walk(xml, (tag, api) => {
    switch (tag.name) {
      case 'si':
        if (tag.closing) {
          if (current !== null) out.push(current);
          current = null;
        } else {
          if (current !== null) out.push(current);
          current = '';
          if (tag.selfClosing) {
            out.push(current);
            current = null;
          }
        }
        break;
      case 'rPh':
        inPhonetic = !tag.closing && !tag.selfClosing;
        if (inPhonetic) api.skipPast('</rPh>');
        inPhonetic = false;
        break;
      case 't':
        if (current !== null && !tag.closing && !tag.selfClosing) {
          current += decodeText(api.text());
        }
        break;
      default:
        break;
    }
  });
  if (current !== null) out.push(current);
  return out;
}

/** Rows and cells of a worksheet XML, with the shared strings resolved. */
export function parseSheetXml(
  xml: string,
  shared: string[],
  limits: Pick<XlsxLimits, 'maxCells'> = {}
): SheetRow[] {
  const maxCells = limits.maxCells ?? DEFAULT_LIMITS.maxCells;
  const rows: SheetRow[] = [];
  let rowNumber = 0;
  let row: SheetRow | null = null;
  let cell: {
    column: string | null;
    type: string | null;
    value: string | null;
    inline: string;
  } | null = null;
  let inInline = false;
  let cells = 0;

  const endCell = () => {
    if (!cell) return;
    const { column, type, value, inline } = cell;
    cell = null;
    inInline = false;
    if (!column || !row) return;
    let text: string | null = null;
    if (type === 's') {
      const index = value !== null && /^\d+$/.test(value) ? Number(value) : -1;
      text = index >= 0 && index < shared.length ? shared[index] : null;
    } else if (type === 'inlineStr') {
      text = inline;
    } else if (type !== 'e') {
      text = value;
    }
    if (text !== null && text !== '') row.cells[column] = text;
  };
  const endRow = () => {
    endCell();
    if (row && Object.keys(row.cells).length > 0) rows.push(row);
    row = null;
  };

  walk(xml, (tag, api) => {
    switch (tag.name) {
      case 'row':
        endRow();
        if (!tag.closing) {
          const given = attribute(tag.raw, 'r');
          const parsed = given && /^\d{1,7}$/.test(given) ? Number(given) : 0;
          rowNumber = parsed >= 1 && parsed <= 1048576 ? parsed : rowNumber + 1;
          row = { row: rowNumber, cells: {} };
          if (tag.selfClosing) endRow();
        }
        break;
      case 'c':
        endCell();
        if (!tag.closing) {
          cells += 1;
          if (cells > maxCells) {
            throw new Error(`The sheet has more than ${maxCells} cells.`);
          }
          const ref = /^([A-Za-z]{1,3})\d+$/.exec(
            attribute(tag.raw, 'r') ?? ''
          );
          cell = {
            column: ref ? ref[1].toUpperCase() : null,
            type: attribute(tag.raw, 't'),
            value: null,
            inline: '',
          };
          if (tag.selfClosing) endCell();
        }
        break;
      case 'v':
        if (cell && !tag.closing && !tag.selfClosing) {
          cell.value = decodeText(api.text());
        }
        break;
      case 'is':
        inInline = !tag.closing && !tag.selfClosing;
        break;
      case 'rPh':
        if (inInline && !tag.closing && !tag.selfClosing) {
          api.skipPast('</rPh>');
        }
        break;
      case 't':
        if (cell && inInline && !tag.closing && !tag.selfClosing) {
          cell.inline += decodeText(api.text());
        }
        break;
      default:
        break;
    }
  });
  endRow();
  return rows;
}

/** Reads a zip entry as text and gives up above the byte limit. */
function readCapped(
  file: JSZip.JSZipObject,
  name: string,
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
        reject(new Error(`${name} is larger than ${maxBytes} bytes.`));
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

/** Path of a relationship target inside the package ("worksheets/sheet1.xml" is relative to xl/). */
export const partPath = (target: string) =>
  target.startsWith('/') ? target.slice(1) : `xl/${target}`;

/**
 * Opens a zip with JSZip (loaded on first use, so the scripts that do not read a workbook
 * start without the dependency installed). The caller has read the directory of the zip
 * (readZipDirectory) and checked it BEFORE this call: JSZip builds an object for every
 * entry when it opens a file.
 */
export async function openZip(data: XlsxData): Promise<JSZip> {
  const { default: Zip } = await import('jszip');
  return Zip.loadAsync(data);
}

export interface WorkbookSheet {
  name: string;
  /** The relationship id (r:id) that names the part of the sheet. */
  id: string | null;
  /** `hidden` or `veryHidden` for a sheet that Excel does not show, otherwise null. */
  state: string | null;
}

/** The sheets of xl/workbook.xml in order. */
export function parseWorkbookSheets(xml: string): WorkbookSheet[] {
  const sheets: WorkbookSheet[] = [];
  walk(xml, tag => {
    if (tag.name === 'sheet' && !tag.closing) {
      // Excel writes state only for a hidden sheet, other writers write state="visible"
      const state = attribute(tag.raw, 'state');
      sheets.push({
        name: decodeText(attribute(tag.raw, 'name') ?? ''),
        id: attribute(tag.raw, 'r:id'),
        state: state === 'hidden' || state === 'veryHidden' ? state : null,
      });
    }
  });
  return sheets;
}

/** Id to target of the relationships of a .rels part. */
export function parseRelationshipTargets(
  xml: string
): Array<{ id: string | null; target: string | null }> {
  const relationships: Array<{ id: string | null; target: string | null }> = [];
  walk(xml, tag => {
    if (tag.name === 'Relationship' && !tag.closing) {
      relationships.push({
        id: attribute(tag.raw, 'Id'),
        target: attribute(tag.raw, 'Target'),
      });
    }
  });
  return relationships;
}

/**
 * The rows of one sheet of an .xlsx file. The first sheet of the workbook is
 * read unless `options.sheet` names another one.
 */
export async function readXlsxRows(
  data: XlsxData,
  options: XlsxReadOptions = {}
): Promise<{ sheetName: string; rows: SheetRow[] }> {
  const limits = { ...DEFAULT_LIMITS, ...options };
  if (data.byteLength > limits.maxInputBytes) {
    throw new Error(
      `The workbook is larger than ${limits.maxInputBytes} bytes.`
    );
  }
  // JSZip is loaded on first use, so the scripts that do not read a workbook
  // start without the dependency installed.
  const { default: Zip } = await import('jszip');
  const zip = await Zip.loadAsync(data);
  if (Object.keys(zip.files).length > limits.maxEntries) {
    throw new Error(`The workbook has more than ${limits.maxEntries} entries.`);
  }
  const readPart = async (name: string, required: boolean) => {
    const file = zip.file(name);
    if (!file) {
      if (required) throw new Error(`${name} is missing.`);
      return null;
    }
    return readCapped(file, name, limits.maxXmlBytes);
  };

  const workbookFile = zip.file('xl/workbook.xml');
  if (!workbookFile) {
    throw new Error('Not a workbook: xl/workbook.xml is missing.');
  }
  const workbook = await readCapped(
    workbookFile,
    'xl/workbook.xml',
    limits.maxXmlBytes
  );
  const sheets = parseWorkbookSheets(workbook);
  if (sheets.length === 0) throw new Error('The workbook has no sheet.');
  const sheet = options.sheet
    ? sheets.find(s => s.name === options.sheet)
    : sheets[0];
  if (!sheet) {
    throw new Error(`The sheet "${options.sheet}" does not exist.`);
  }

  const rels = (await readPart('xl/_rels/workbook.xml.rels', false)) ?? '';
  const relationships = parseRelationshipTargets(rels);
  const target =
    sheet.id === null
      ? null
      : (relationships.find(r => r.id === sheet.id)?.target ?? null);
  if (!target) {
    throw new Error(
      `The relationship ${sheet.id ?? '(none)'} of the sheet "${sheet.name}" is missing.`
    );
  }

  const sharedXml = await readPart('xl/sharedStrings.xml', false);
  const shared = sharedXml ? parseSharedStrings(sharedXml) : [];
  const sheetXml = (await readPart(partPath(target), true)) as string;
  return {
    sheetName: sheet.name,
    rows: parseSheetXml(sheetXml, shared, { maxCells: limits.maxCells }),
  };
}
