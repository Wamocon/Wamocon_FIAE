// PDFs from the Word files of the KfBM source (mode --from-word of scripts/import/kfbm-documents.mjs).
// Pure functions on bytes and text: no file access, no process, no network. The script reads the
// Word file, calls prepareWordDocument, hands the returned docx to the converter and checks the text
// of the PDF it gets back with the `check` of the variant.
//
// What becomes which PDF (the same four kinds and the same rows as the PDF import, engine.ts):
//
//   enabler Word        -> enabler PDF         the whole text (public bucket)
//   scenario Word       -> scenario PDF        the WHOLE document (public bucket). The Word holds the
//                                              starting situation, an optional task, the solution and the
//                                              text "how the knowledge helps". The trainees may see all of
//                                              it (decision of the owner, 29.10.2026): there is no cut and
//                                              no private copy for a scenario. Only the use cases are split.
//   use case Word       -> task PDF            the part before "Musterlösung" (public bucket)
//                       -> solution PDF        the whole document (private bucket, trainer only)
//
// Solution protection of the use cases works in three layers, none of them is optional (a scenario is
// whole and public, it is not part of this protection):
//   1. the parsers of the import read the Word text, a marker word or a solution text in a visible
//      section stops the file (SOLUTION_MARKER, the same checks as the content import)
//   2. the docx of the task is cut BEFORE the conversion: the body elements from the heading of the
//      model solution on are removed, so the solution never reaches the converter
//   3. the text of the finished task PDF is checked again (markers, solution texts) and a PDF that
//      fails is dropped (the `check` of the variant)
//
// The docx that goes to the converter is also cleaned: external references (linked pictures, remote
// templates) and macro projects are removed, so the converter has nothing to fetch and nothing to run.

import { leakOf, leakOfEnablerText } from '../apply/guard';
import { splitEnablerHeading } from '../apply/plan';
import {
  extractDocxParagraphs,
  loadDocx,
  readZipDirectory,
} from '../docx-paragraphs';
import { enablerKeysMatch } from '../path-info';
import { parseScenarioText } from '../source-parsers';
import { parseUseCaseText, toTraineeUseCase } from '../use-cases/parser';
import type { PdfKind } from './types';

/** Why a Word file gives no PDF (fixed codes, never a text of a file). */
export type WordSkipCode =
  | 'NOT_A_DOCX'
  | 'PARSE_ERROR'
  | 'CODE_MISMATCH'
  | 'SOLUTION_MARKER'
  | 'CUT_NOT_FOUND'
  | 'CONVERSION_FAILED'
  | 'PDF_UNREADABLE'
  | 'PDF_SOLUTION'
  | 'PLACEHOLDER'
  | 'READ_ERROR'
  | 'TOO_LARGE';

export interface WordVariant {
  kind: PdfKind;
  /** The docx to convert (cut and cleaned). */
  docx: Uint8Array;
  /** Title of the PDF (the document property, never the author). */
  title: string;
  /** Number of external references and macro parts that were removed from the docx. */
  removed: number;
  /**
   * Check of the text of the finished PDF. Returns a problem code or null. A PDF that fails must not
   * be used.
   */
  check: (pdfText: string) => WordSkipCode | null;
}

export type WordResult =
  | {
      ok: true;
      variants: WordVariant[];
      /** Solution texts of this file (scenarios only), for the check of the enabler texts. */
      solutions: string[];
    }
  | { ok: false; code: WordSkipCode };

export type WordSource = 'enabler' | 'scenario' | 'usecase';

export interface WordContext {
  /** 6.2d, as pathInfo gives it. */
  enablerKey: string;
  /** K6.2-d */
  enablerCode: string;
  /** The solution texts of all scenarios of the run (for the enabler texts). */
  strongSolutions: readonly string[];
  /** The bare line "Lösung" of this enabler text was checked by the owner. */
  reviewedBareSolutionLine: boolean;
}

// File names --------------------------------------------------------------------------------

const FOLDER: Record<PdfKind, string> = {
  enabler: 'Enabler',
  scenario: 'Szenarien',
  usecase_task: 'Use-Cases',
  usecase_solution: 'Use-Cases_Musterlösung',
};

const KEY = /^(\d{1,2})(?:\.(\d))?([a-z])$/i;

/**
 * File name of a generated PDF, in the pattern of the delivered PDFs (the prefix of the folder and
 * the id of the enabler): 6d.pdf, Szenario_6_2d.pdf, UC_24_1a.pdf, UC_6_2d_Musterlösung.pdf. The name
 * does not carry the title, so it does not change when a title is corrected and a new run finds the
 * same path again. Returns null when the key is no enabler key.
 */
export function wordPdfName(kind: PdfKind, enablerKey: string): string | null {
  const match = KEY.exec(enablerKey);
  if (!match) return null;
  const id = `${Number(match[1])}${match[2] ? `_${match[2]}` : ''}${match[3].toLowerCase()}`;
  switch (kind) {
    case 'enabler':
      return `${id}.pdf`;
    case 'scenario':
      return `Szenario_${id}.pdf`;
    case 'usecase_task':
      return `UC_${id}.pdf`;
    case 'usecase_solution':
      return `UC_${id}_Musterlösung.pdf`;
  }
}

/**
 * The path a generated PDF has in the plan: the layout of the delivered folder Komponenten_PDF
 * (component folder, document folder, file), so the PDF import classifies it like a delivered PDF.
 */
export function wordPdfPath(
  componentKey: string,
  componentTitle: string | null,
  kind: PdfKind,
  fileName: string
): string {
  const title = (componentTitle ?? '')
    .replace(/[\\/:*?"<>|]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  return `${componentKey} - ${title || 'Komponente'}/${FOLDER[kind]}/${fileName}`;
}

// The body of a docx ---------------------------------------------------------------------------

const ENTITY = /&(?:#x([0-9a-fA-F]+)|#(\d+)|(amp|lt|gt|quot|apos));/g;
const NAMED: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
};
const decode = (text: string) =>
  text.replace(ENTITY, (_all, hex, dec, named) => {
    if (named) return NAMED[named];
    const code = hex ? parseInt(hex, 16) : parseInt(dec, 10);
    return Number.isFinite(code) && code > 0 && code <= 0x10ffff
      ? String.fromCodePoint(code)
      : '';
  });

export interface Block {
  /** Offset of the opening tag in the xml. */
  start: number;
  /** Offset after the closing tag. */
  end: number;
  /** Text of the block, white space squashed. */
  text: string;
}

// The scan of the xml is linear: it jumps from tag to tag with indexOf and reads one tag with a loop
// that knows quotes. No regular expression runs over the whole text, so a hostile file (thousands of
// unfinished tags) cannot make the scan quadratic.

interface Tag {
  /** Offset of the `<`. */
  start: number;
  /** Offset after the `>`. */
  end: number;
  /** Name with prefix, for example w:p. */
  name: string;
  closing: boolean;
  selfClosing: boolean;
}

/** Reads the tag that starts at `at` (a `<`). Returns null when it never ends or has no name. */
function readTag(xml: string, at: number): Tag | null {
  let quote = '';
  let end = -1;
  for (let i = at + 1; i < xml.length; i += 1) {
    const c = xml[i];
    if (quote) {
      if (c === quote) quote = '';
    } else if (c === '"' || c === "'") {
      quote = c;
    } else if (c === '>') {
      end = i + 1;
      break;
    }
  }
  if (end < 0) return null;
  const closing = xml[at + 1] === '/';
  const nameStart = at + (closing ? 2 : 1);
  let nameEnd = nameStart;
  while (nameEnd < end - 1 && !/[\s/>]/.test(xml[nameEnd])) nameEnd += 1;
  if (nameEnd === nameStart) return null;
  return {
    start: at,
    end,
    name: xml.slice(nameStart, nameEnd),
    closing,
    selfClosing: xml[end - 2] === '/',
  };
}

/** The next tag at or after `from` that starts before `until`, or null. */
function nextTag(xml: string, from: number, until: number): Tag | null {
  let at = xml.indexOf('<', from);
  while (at >= 0 && at < until) {
    // a declaration, comment or processing instruction is no element
    if (xml[at + 1] !== '?' && xml[at + 1] !== '!') {
      const tag = readTag(xml, at);
      if (!tag) return null;
      return tag;
    }
    const close = xml.indexOf('>', at);
    if (close < 0) return null;
    at = xml.indexOf('<', close);
  }
  return null;
}

/**
 * The elements that stand directly in w:body (paragraphs, tables, content controls), with their
 * place in the xml and their text. `tail` is the offset where the closing part of the body starts
 * (the section properties of the last section, or the end of the body).
 */
export function bodyBlocks(xml: string): { blocks: Block[]; tail: number } {
  const bodyClose = xml.lastIndexOf('</w:body>');
  let from = -1;
  for (
    let tag = nextTag(xml, 0, xml.length);
    tag;
    tag = nextTag(xml, tag.end, xml.length)
  ) {
    if (tag.name === 'w:body' && !tag.closing) {
      from = tag.end;
      break;
    }
  }
  if (from < 0 || bodyClose < from) return { blocks: [], tail: -1 };
  const blocks: Block[] = [];
  let tail = bodyClose;
  let depth = 0;
  let open = -1;
  for (
    let tag = nextTag(xml, from, bodyClose);
    tag;
    tag = nextTag(xml, tag.end, bodyClose)
  ) {
    if (!BLOCK_TAGS.has(tag.name)) continue;
    if (tag.name === 'w:sectPr') {
      // the section properties of the body (a paragraph keeps its own inside w:pPr)
      if (depth === 0 && !tag.closing) {
        tail = tag.start;
        break;
      }
      continue;
    }
    if (tag.closing) {
      depth -= 1;
      if (depth === 0 && open >= 0) {
        blocks.push(makeBlock(xml, open, tag.end));
        open = -1;
      }
      if (depth < 0) depth = 0;
    } else if (tag.selfClosing) {
      if (depth === 0) {
        blocks.push({ start: tag.start, end: tag.end, text: '' });
      }
    } else {
      if (depth === 0) open = tag.start;
      depth += 1;
    }
  }
  return { blocks, tail };
}

const BLOCK_TAGS = new Set(['w:p', 'w:tbl', 'w:sdt', 'w:sectPr']);

function makeBlock(xml: string, start: number, end: number): Block {
  let text = '';
  for (
    let tag = nextTag(xml, start, end);
    tag;
    tag = nextTag(xml, tag.end, end)
  ) {
    if (tag.closing) continue;
    if (tag.name === 'w:tab') {
      text += ' ';
    } else if (tag.name === 'w:t' && !tag.selfClosing) {
      const stop = xml.indexOf('<', tag.end);
      text += decode(xml.slice(tag.end, stop < 0 ? end : Math.min(stop, end)));
    }
  }
  return { start, end, text: text.replace(/\s+/g, ' ').trim() };
}

/**
 * The xml of the body without the elements from the first one that `isCut` accepts until the
 * section properties. Returns null when no element is accepted (the caller must then give up, a
 * document that cannot be cut must not be converted for the trainees).
 */
export function cutBodyXml(
  xml: string,
  isCut: (text: string) => boolean
): string | null {
  const { blocks, tail } = bodyBlocks(xml);
  if (tail < 0) return null;
  // The first element with text is the title of the document, never a heading of a part.
  const title = blocks.findIndex(b => b.text.length > 0);
  const index = blocks.findIndex(
    (b, i) => i > title && b.text.length > 0 && isCut(b.text)
  );
  if (title < 0 || index < 0) return null;
  return xml.slice(0, blocks[index].start) + xml.slice(tail);
}

// Heading of the solution part of a use case ---------------------------------------------------

const USE_CASE_SOLUTION_HEADING =
  /^(?:Musterl(?:ö|oe)sung|Bewertungskriterien)\s*:?$/i;

/** The first heading of a solution part of a use case. */
export const isUseCaseSolutionHeading = (text: string): boolean =>
  USE_CASE_SOLUTION_HEADING.test(text);

// The docx for the converter -------------------------------------------------------------------

const RELS = /\.rels$/;
const MACRO_PART = /^word\/vbaProject|^word\/vbaData/i;
/** A relationships part above this size is not read (a real one has a few kilobytes). */
const MAX_RELS_BYTES = 4 * 1024 * 1024;
/** The sum of the declared sizes of all parts above which the file is not opened. */
const MAX_TOTAL_BYTES = 600 * 1024 * 1024;
/** Fields that load something from elsewhere (picture, text, linked data, DDE, macros). */
const EXTERNAL_FIELD =
  /^\s*(?:INCLUDEPICTURE|INCLUDETEXT|LINK|DDE|DDEAUTO|IMPORT|AUTOTEXT|DATABASE|MACROBUTTON)\b/i;

/**
 * Removes every external relationship (linked pictures, remote templates, linked objects, and the
 * target of a hyperlink: a link in the PDF is of no use and a target may be a local path of the
 * author). The text of a hyperlink stays. Linear, quote aware, also takes the form with a closing tag.
 */
export function stripExternalRelationships(xml: string): {
  xml: string;
  removed: number;
} {
  let removed = 0;
  let out = '';
  let copied = 0;
  for (
    let tag = nextTag(xml, 0, xml.length);
    tag;
    tag = nextTag(xml, tag.end, xml.length)
  ) {
    if (tag.name !== 'Relationship' || tag.closing) continue;
    const text = xml.slice(tag.start, tag.end);
    if (!/TargetMode\s*=\s*["']External["']/i.test(text)) continue;
    let end = tag.end;
    if (!tag.selfClosing) {
      const close = /^\s*<\/Relationship\s*>/.exec(xml.slice(end, end + 64));
      if (close) end += close[0].length;
    }
    out += xml.slice(copied, tag.start);
    copied = end;
    removed += 1;
  }
  return { xml: out + xml.slice(copied), removed };
}

/**
 * Empties the instruction of a field that loads something from elsewhere (INCLUDEPICTURE, INCLUDETEXT,
 * LINK, DDE and so on). A field whose instruction is split over several runs is not recognized, the
 * profile of the converter (no update of links, no macros) and the check of the PDF text stand behind.
 */
export function stripExternalFields(xml: string): {
  xml: string;
  removed: number;
} {
  let removed = 0;
  let out = '';
  let copied = 0;
  for (
    let tag = nextTag(xml, 0, xml.length);
    tag;
    tag = nextTag(xml, tag.end, xml.length)
  ) {
    if (tag.closing) continue;
    if (tag.name === 'w:instrText' && !tag.selfClosing) {
      const stop = xml.indexOf('<', tag.end);
      const end = stop < 0 ? xml.length : stop;
      if (EXTERNAL_FIELD.test(decode(xml.slice(tag.end, end)))) {
        out += xml.slice(copied, tag.end);
        copied = end;
        removed += 1;
      }
    } else if (tag.name === 'w:fldSimple') {
      const text = xml.slice(tag.start, tag.end);
      const attribute = /\sw:instr\s*=\s*("[^"]*"|'[^']*')/.exec(text);
      if (attribute && EXTERNAL_FIELD.test(decode(attribute[1].slice(1, -1)))) {
        out += `${xml.slice(copied, tag.start)}${text.replace(attribute[0], ' w:instr=""')}`;
        copied = tag.end;
        removed += 1;
      }
    }
  }
  return { xml: out + xml.slice(copied), removed };
}

export type PreparedDocx =
  | { ok: true; bytes: Uint8Array; removed: number }
  | { ok: false; code: 'NOT_A_DOCX' | 'CUT_NOT_FOUND' };

/** True when the package names word/document.xml as its main document (or names none). */
function mainDocumentIsStandard(relsXml: string): boolean {
  for (
    let tag = nextTag(relsXml, 0, relsXml.length);
    tag;
    tag = nextTag(relsXml, tag.end, relsXml.length)
  ) {
    if (tag.name !== 'Relationship' || tag.closing) continue;
    const text = relsXml.slice(tag.start, tag.end);
    if (!/Type\s*=\s*["'][^"']*\/officeDocument["']/i.test(text)) continue;
    const target = /Target\s*=\s*["']([^"']*)["']/i.exec(text)?.[1] ?? '';
    return target.replace(/^\//, '') === 'word/document.xml';
  }
  return true;
}

/**
 * The docx for the converter: cut at the first element that `isCut` accepts (when given), external
 * references (relationships and fields) and macro parts removed. Opens the file within the limits of
 * docx-paragraphs.ts and refuses a package whose parts are too large altogether, whose relationships
 * parts are large, or whose main document is not word/document.xml (the cut works on that part).
 */
export async function prepareDocx(
  data: Uint8Array,
  isCut?: (text: string) => boolean
): Promise<PreparedDocx> {
  let loaded;
  try {
    const directory = readZipDirectory(data, 20000);
    const total = directory.entries.reduce((sum, e) => sum + e.size, 0);
    if (
      total > MAX_TOTAL_BYTES ||
      directory.entries.some(e => RELS.test(e.name) && e.size > MAX_RELS_BYTES)
    ) {
      return { ok: false, code: 'NOT_A_DOCX' };
    }
    loaded = await loadDocx(data);
  } catch {
    return { ok: false, code: 'NOT_A_DOCX' };
  }
  const { zip } = loaded;
  const rootRels = zip.file('_rels/.rels');
  if (rootRels && !mainDocumentIsStandard(await rootRels.async('string'))) {
    return { ok: false, code: 'NOT_A_DOCX' };
  }
  let { xml } = loaded;
  if (isCut) {
    const cut = cutBodyXml(xml, isCut);
    if (cut === null) return { ok: false, code: 'CUT_NOT_FOUND' };
    xml = cut;
  }
  const fields = stripExternalFields(xml);
  let removed = fields.removed;
  zip.file('word/document.xml', fields.xml);
  for (const name of Object.keys(zip.files)) {
    const entry = zip.file(name);
    if (!entry) continue;
    if (MACRO_PART.test(name)) {
      zip.remove(name);
      removed += 1;
    } else if (RELS.test(name)) {
      const stripped = stripExternalRelationships(await entry.async('string'));
      removed += stripped.removed;
      zip.file(name, stripped.xml);
    }
  }
  const bytes = await zip.generateAsync({
    type: 'uint8array',
    compression: 'DEFLATE',
  });
  return { ok: true, bytes, removed };
}

// The check of a finished PDF -----------------------------------------------------------------

/**
 * The check of the PDF text of the task of a use case (the part for the trainees): no marker word and
 * no solution text. A scenario is not checked, it is whole and public.
 */
export function traineePdfProblem(
  pdfText: string,
  solutions: readonly string[]
): WordSkipCode | null {
  return leakOf(pdfText, [...solutions]) ? 'PDF_SOLUTION' : null;
}

// Preparing a Word file ---------------------------------------------------------------------------

/**
 * Reads a Word file, checks it like the content import does and returns the docx files to convert,
 * one per PDF. `kind` is what the path of the file says (pathInfo): enabler, scenario or use case.
 * Never throws on bad content, a file that cannot be used gives a fixed code.
 */
export async function prepareWordDocument(
  source: WordSource,
  data: Uint8Array,
  context: WordContext
): Promise<WordResult> {
  let paragraphs;
  try {
    paragraphs = await extractDocxParagraphs(data);
  } catch {
    return { ok: false, code: 'NOT_A_DOCX' };
  }
  if (source === 'enabler') return prepareEnabler(data, paragraphs, context);
  if (source === 'scenario') return prepareScenario(data, paragraphs, context);
  return prepareUseCase(data, paragraphs, context);
}

type Paragraphs = Awaited<ReturnType<typeof extractDocxParagraphs>>;

async function prepareEnabler(
  data: Uint8Array,
  paragraphs: Paragraphs,
  context: WordContext
): Promise<WordResult> {
  const lines = paragraphs.map(p => p.text);
  const heading = lines.find(line => line.trim().length > 0) ?? '';
  const code = splitEnablerHeading(heading).code;
  // A heading without an id is left to the check of the PDF (its first page must name the enabler)
  if (code !== null && !enablerKeysMatch(code, context.enablerKey)) {
    return { ok: false, code: 'CODE_MISMATCH' };
  }
  const strong = [...context.strongSolutions];
  // the whole text of an enabler is visible, only a marker or a scenario solution counts
  const reviewed = context.reviewedBareSolutionLine;
  if (leakOfEnablerText(lines.join('\n'), strong, reviewed).reason) {
    return { ok: false, code: 'SOLUTION_MARKER' };
  }
  const prepared = await prepareDocx(data);
  if (!prepared.ok) return { ok: false, code: prepared.code };
  return {
    ok: true,
    solutions: [],
    variants: [
      {
        kind: 'enabler',
        docx: prepared.bytes,
        title: `Enabler ${context.enablerCode}`,
        removed: prepared.removed,
        check: text =>
          leakOfEnablerText(text, strong, reviewed).reason
            ? 'PDF_SOLUTION'
            : null,
      },
    ],
  };
}

async function prepareScenario(
  data: Uint8Array,
  paragraphs: Paragraphs,
  context: WordContext
): Promise<WordResult> {
  const parsed = parseScenarioText(paragraphs);
  if (!parsed.ok) return { ok: false, code: 'PARSE_ERROR' };
  const s = parsed.value;
  if (!enablerKeysMatch(s.code, context.enablerKey)) {
    return { ok: false, code: 'CODE_MISMATCH' };
  }
  // The scenario goes out whole, with its solution and the text "how the knowledge helps". The parser
  // only has to find the code and the structure. The solution texts still go to the check of the
  // enabler texts (an enabler PDF is no copy of a scenario solution).
  const solutions = [s.solution, s.knowledgeContribution].filter(
    text => text.length > 0
  );
  const prepared = await prepareDocx(data);
  if (!prepared.ok) return { ok: false, code: prepared.code };
  return {
    ok: true,
    solutions,
    variants: [
      {
        kind: 'scenario',
        docx: prepared.bytes,
        title: `Szenario ${context.enablerCode}`,
        removed: prepared.removed,
        check: () => null,
      },
    ],
  };
}

async function prepareUseCase(
  data: Uint8Array,
  paragraphs: Paragraphs,
  context: WordContext
): Promise<WordResult> {
  const parsed = parseUseCaseText(paragraphs);
  if (!parsed.ok) return { ok: false, code: 'PARSE_ERROR' };
  if (!enablerKeysMatch(parsed.value.code, context.enablerKey)) {
    return { ok: false, code: 'CODE_MISMATCH' };
  }
  // the visible view refuses a marker word in a visible section
  if (!toTraineeUseCase(parsed)) return { ok: false, code: 'SOLUTION_MARKER' };
  const solutions = [parsed.value.solution, parsed.value.criteria].filter(
    text => text.length > 0
  );
  const task = await prepareDocx(data, isUseCaseSolutionHeading);
  if (!task.ok) return { ok: false, code: task.code };
  const full = await prepareDocx(data);
  if (!full.ok) return { ok: false, code: full.code };
  return {
    ok: true,
    solutions: [],
    variants: [
      {
        kind: 'usecase_task',
        docx: task.bytes,
        title: `Use Case ${context.enablerCode}: Aufgabe`,
        removed: task.removed,
        check: text => traineePdfProblem(text, solutions),
      },
      {
        kind: 'usecase_solution',
        docx: full.bytes,
        title: `Use Case ${context.enablerCode}: Musterlösung`,
        removed: full.removed,
        check: () => null,
      },
    ],
  };
}
