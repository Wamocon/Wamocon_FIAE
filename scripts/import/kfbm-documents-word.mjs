// Mode --from-word of scripts/import/kfbm-documents.mjs: the PDFs are made from the Word files of the
// source tree (the folder Komponente of the content import) instead of being read from the folder
// Komponenten_PDF. The result has the form of a scanned PDF folder (a list of files with name, size,
// hash, page count and the text of the first page, and the temp file of each), so the plan, the rows,
// the storage, the buckets and the rules of the PDF import are the same code for both ways.
//
// Which Word file becomes which PDF is decided by the same code as the content import (selectFiles
// and selectUseCaseFiles with the decisions file, newest copy wins, ambiguous copies are left out),
// the code of the enabler comes from the path and is checked against the heading of the Word file.
// What is in the PDF and the three layers of the solution protection are in
// src/lib/content-import/documents/word.ts.
//
// Read only on the source: a Word file is read into memory (an OneDrive placeholder is downloaded by
// the read with --hydrate, with a time limit per file), written as a copy with a short name into the
// temp folder of the run and converted there. The temp folder is removed at the end.

import { createHash } from 'node:crypto';
import { readFileSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';

import {
  cleanPdfMetadata,
  prepareWordDocument,
  selectFiles,
  selectUseCaseFiles,
  wordPdfName,
  wordPdfPath,
} from './kfbm-documents-modules.mjs';
import { pathInfo, readAttributes, walkSource } from './kfbm-source.mjs';

const require = createRequire(import.meta.url);

/** A source document above this size is not read (the reader refuses 200 MB anyway). */
const MAX_DOCX_BYTES = 100 * 1024 * 1024;
const SOURCE_TYPES = new Set(['enabler', 'scenario']);

class TimeoutError extends Error {}

function withTimeout(promise, ms) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(
      () =>
        reject(
          new TimeoutError(
            `Timeout after ${ms} ms while reading the file (download from OneDrive stuck?).`
          )
        ),
      ms
    );
    promise.then(
      value => {
        clearTimeout(timer);
        resolve(value);
      },
      error => {
        clearTimeout(timer);
        reject(error);
      }
    );
  });
}

/** Text and number of pages of a PDF (all pages), or null when the PDF cannot be read. */
export async function pdfInfo(bytes) {
  try {
    // the file of the library itself: its index.js runs a test file when it is the main module
    const pdfParse = require('pdf-parse/lib/pdf-parse.js');
    const result = await pdfParse(Buffer.from(bytes));
    if (typeof result.text !== 'string' || !(result.numpages > 0)) return null;
    return { text: result.text, pageCount: result.numpages };
  } catch {
    return null;
  }
}

/** Codes of the Word files that give no PDF, with the names of the files (never a content). */
export function summarizeSkips(skips) {
  const byCode = {};
  for (const skip of skips) {
    byCode[skip.code] = (byCode[skip.code] ?? 0) + 1;
  }
  return byCode;
}

/** Markdown of the Word step: counts and the files that give no PDF (names and codes only). */
export function renderWordSummary(scan) {
  const lines = [
    '## PDF from Word (--from-word)',
    '',
    `Word files chosen: enablers ${scan.counts.chosen.enabler}, scenarios ${scan.counts.chosen.scenario}, use cases ${scan.counts.chosen.usecase}`,
    `PDFs planned: ${Object.entries(scan.counts.variants)
      .map(([kind, n]) => `${kind} ${n}`)
      .join(', ')}`,
    scan.converted
      ? `PDFs made and checked: ${scan.counts.made}`
      : 'PDFs made: none (not converted in this mode)',
    `External references or macro parts removed from the Word copies: ${scan.counts.removed}`,
    `Word files without a PDF: ${scan.skips.length}${
      scan.skips.length > 0
        ? ` (${Object.entries(summarizeSkips(scan.skips))
            .sort(([a], [b]) => (a < b ? -1 : 1))
            .map(([code, n]) => `${code} ${n}`)
            .join(', ')})`
        : ''
    }`,
    '',
  ];
  if (scan.skips.length > 0) {
    lines.push('Files without a PDF (name and code only):', '');
    for (const skip of scan.skips) {
      lines.push(
        `- ${skip.code}${skip.detail ? ` (${skip.detail})` : ''}: ${skip.rel}${skip.kind ? ` [${skip.kind}]` : ''}`
      );
    }
    lines.push('');
  }
  return lines.join('\n');
}

/**
 * The PDFs of the Word tree. `deps.converter` converts a docx to a PDF (`convert(in, out)`), without it
 * nothing is converted and only the Word files are counted (mode plan). `deps.workspace` is the temp
 * folder of the run (inDir, finalDir). Nothing is written outside of it.
 * @param {string} root
 * @param {any} args parsed arguments (components, hydrate, timeoutSeconds, noAttributes)
 * @param {{ decisions: any, workspace?: any, converter?: any, read?: (file: string) => Promise<Buffer>, clean?: Function, info?: Function, onProgress?: (done: number, total: number) => void }} deps
 */
export async function scanWordSource(root, args, deps) {
  const {
    decisions,
    workspace = null,
    converter = null,
    read = readFile,
    clean = cleanPdfMetadata,
    info: readPdf = pdfInfo,
    attributes: givenAttributes = null,
    onProgress,
  } = deps;
  const timeoutMs = args.timeoutSeconds ? args.timeoutSeconds * 1000 : 60000;
  const attributes =
    givenAttributes ?? (args.noAttributes ? null : readAttributes(root));
  if (!attributes && !args.noAttributes) {
    console.error(
      'File attributes are not available, placeholders cannot be told apart.'
    );
  }
  const entries = walkSource(root, { attributes }).map(entry => ({
    ...entry,
    info: pathInfo(entry.rel),
  }));
  const byRel = new Map(entries.map(e => [e.rel, e]));

  const skips = [];
  const skip = (rel, code, extra = {}) => skips.push({ rel, code, ...extra });
  const content = selectFiles(entries, decisions, {
    limitedTo: args.components,
  });
  const useCases = selectUseCaseFiles(entries, decisions, {
    limitedTo: args.components,
  });
  // what the selection left out: names and codes of the enabler and scenario files and the use cases
  for (const s of content.skipped) {
    if (s.file && SOURCE_TYPES.has(s.type)) {
      skip(s.file, 'SELECTION', { detail: s.code });
    }
  }
  for (const s of useCases.skipped) {
    if (s.file) skip(s.file, 'SELECTION', { detail: s.code });
  }
  const chosen = [
    ...content.chosen
      .filter(rel => SOURCE_TYPES.has(byRel.get(rel)?.info.type))
      .map(rel => ({ rel, source: byRel.get(rel).info.type })),
    ...useCases.chosen.map(rel => ({ rel, source: 'usecase' })),
  ].filter(item => {
    const entry = byRel.get(item.rel);
    if (entry && entry.info.format === 'docx') return true;
    skip(item.rel, 'NOT_A_DOCX', { detail: 'format' });
    return false;
  });
  const order = { scenario: 0, enabler: 1, usecase: 2 };
  chosen.sort(
    (a, b) =>
      order[a.source] - order[b.source] ||
      (a.rel < b.rel ? -1 : a.rel > b.rel ? 1 : 0)
  );

  const reviewed = new Set(
    (decisions.content?.reviewedSolutionWordFalsePositives ?? []).map(
      r => r.enabler
    )
  );
  const counts = {
    chosen: { enabler: 0, scenario: 0, usecase: 0 },
    variants: { enabler: 0, scenario: 0, usecase_task: 0, usecase_solution: 0 },
    removed: 0,
    made: 0,
  };
  for (const item of chosen) counts.chosen[item.source] += 1;

  const files = [];
  const paths = new Map();
  const strongSolutions = [];
  /** Scenario and use case files are read and prepared once (their solutions are needed first). */
  const prepared = new Map();
  let timeoutsInARow = 0;
  let done = 0;
  let sequence = 0;

  const readOne = async item => {
    const entry = byRel.get(item.rel);
    if (entry.placeholder && !args.hydrate) {
      skip(item.rel, 'PLACEHOLDER');
      return null;
    }
    if (timeoutsInARow >= 3) {
      skip(item.rel, 'READ_ERROR', { detail: 'stopped after three timeouts' });
      return null;
    }
    if (entry.size > MAX_DOCX_BYTES) {
      skip(item.rel, 'TOO_LARGE');
      return null;
    }
    try {
      const bytes = await withTimeout(
        read(path.join(root, ...item.rel.split('/'))),
        timeoutMs
      );
      timeoutsInARow = 0;
      return bytes;
    } catch (error) {
      timeoutsInARow = error instanceof TimeoutError ? timeoutsInARow + 1 : 0;
      skip(item.rel, 'READ_ERROR');
      return null;
    }
  };
  const contextOf = info => ({
    enablerKey: info.enablerKey,
    enablerCode: info.enablerCode,
    strongSolutions,
    reviewedBareSolutionLine: reviewed.has(info.enablerCode),
  });

  // The solutions of the scenarios and of the use cases come first: the enabler texts are
  // checked against them (a teaching text must not repeat them)
  for (const item of chosen.filter(
    i => i.source === 'scenario' || i.source === 'usecase'
  )) {
    const bytes = await readOne(item);
    if (!bytes) {
      prepared.set(item.rel, null);
      continue;
    }
    const info = byRel.get(item.rel).info;
    const result = await prepareWordDocument(
      item.source,
      bytes,
      contextOf(info)
    );
    prepared.set(item.rel, result);
    if (result.ok) strongSolutions.push(...result.solutions);
  }

  /** Converts, checks and cleans one variant. Never throws: a file that fails gives a code. */
  const makePdf = async (item, info, variant) => {
    const name = wordPdfName(variant.kind, info.enablerKey);
    if (!name) {
      skip(item.rel, 'CODE_MISMATCH', { kind: variant.kind });
      return;
    }
    sequence += 1;
    const input = path.join(workspace.inDir, `${sequence}.docx`);
    const output = path.join(workspace.finalDir, `${sequence}.raw.pdf`);
    try {
      writeFileSync(input, variant.docx);
      const converted = await converter.convert(input, output);
      rmSync(input, { force: true });
      if (!converted.ok) {
        skip(item.rel, 'CONVERSION_FAILED', {
          kind: variant.kind,
          detail: converted.code,
        });
        return;
      }
      const raw = readFileSync(output);
      rmSync(output, { force: true });
      const pdf =
        Buffer.from(raw.subarray(0, 5)).toString('latin1') === '%PDF-'
          ? await readPdf(raw)
          : null;
      if (!pdf) {
        skip(item.rel, 'PDF_UNREADABLE', { kind: variant.kind });
        return;
      }
      const problem = variant.check(pdf.text);
      if (problem) {
        skip(item.rel, problem, { kind: variant.kind });
        return;
      }
      let cleaned;
      try {
        cleaned = await clean(raw, variant.title);
      } catch {
        skip(item.rel, 'PDF_UNREADABLE', {
          kind: variant.kind,
          detail: 'metadata',
        });
        return;
      }
      const rel = wordPdfPath(
        info.component.key,
        info.component.title,
        variant.kind,
        name
      );
      const final = path.join(workspace.finalDir, `${sequence}.pdf`);
      writeFileSync(final, cleaned.bytes);
      paths.set(rel, final);
      files.push({
        rel,
        size: cleaned.bytes.length,
        magicOk: true,
        sha256: createHash('sha256').update(cleaned.bytes).digest('hex'),
        pageCount: cleaned.pageCount,
        // only the head is kept, the plan reads the first lines
        headText: pdf.text.slice(0, 4000),
      });
      counts.made += 1;
    } catch {
      // a file of the temp folder could not be written or read: this PDF is lost, the run goes on
      skip(item.rel, 'CONVERSION_FAILED', { kind: variant.kind, detail: 'IO' });
      rmSync(input, { force: true });
      rmSync(output, { force: true });
    }
  };

  for (const item of chosen) {
    done += 1;
    onProgress?.(done, chosen.length);
    const info = byRel.get(item.rel).info;
    let result;
    if (prepared.has(item.rel)) {
      // read before: its read error is already named
      result = prepared.get(item.rel);
      if (!result) continue;
    } else {
      const bytes = await readOne(item);
      if (!bytes) continue;
      result = await prepareWordDocument(item.source, bytes, contextOf(info));
    }
    if (!result.ok) {
      skip(item.rel, result.code, { kind: item.source });
      continue;
    }
    for (const variant of result.variants) {
      counts.variants[variant.kind] += 1;
      counts.removed += variant.removed;
      if (converter && workspace) await makePdf(item, info, variant);
    }
  }
  return {
    files,
    paths,
    skips,
    counts,
    converted: Boolean(converter && workspace),
  };
}
