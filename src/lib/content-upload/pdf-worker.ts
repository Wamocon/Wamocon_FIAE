// Reads the text of a PDF in a thread of its own (docs/ki-upload-konzept.md,
// 5.2 and threat T21).
//
// Why a thread: pdf-parse 1.1.1 bundles pdf.js 1.10.100 from 2018. A manipulated
// PDF can make that parser run for ever or use all memory, and a synchronous
// loop would keep a timer in the main thread from ever firing. A worker thread
// can be ended from outside (terminate) and has a memory limit of its own, so
// the route that called it goes on.
//
// What the thread is given: the bytes as a copy, no address and no path of the
// file, an empty process.env of its own, no global fetch. pdf.js is told not to
// compile glyph code (isEvalSupported = false, the code path of CVE-2024-4367),
// not to use font faces and not to load a worker of its own. It reads text only,
// it renders nothing, so no action of the PDF is run.
//
// Limits that are watched from the main thread: time (terminate), the heap of
// the thread (resourceLimits), and the memory of the whole process (rss),
// because the decoders of pdf.js allocate ArrayBuffers outside of the heap, and
// a small PDF can inflate to gigabytes. At most MAX_THREADS threads run at once.
//
// Honest limit: a thread is NOT a sandbox. It shares the process, so code that a
// pdf.js bug would run could still call require('fs') or read /proc/self/environ.
// The empty env and the missing fetch only stop a careless engine, not an
// attacker with code execution. The measures keep the common failures (hang,
// memory, crash) away from the route. The real answer to an old parser is a
// maintained one in a child process with the Node permission model (see the
// note "Stand U3" in docs/ki-upload-konzept.md).
//
// The thread only gets the engine from the code below. The `workerSource`
// option exists for tests, it replaces the engine and keeps the preamble.

import { READ_LIMITS } from './limits';

export type PdfWorkerFailure =
  | 'TIMEOUT'
  | 'WORKER_MEMORY'
  | 'WORKER_CRASH'
  | 'ENGINE_UNAVAILABLE'
  | 'TOO_MANY_PAGES'
  | 'TEXT_TOO_LARGE'
  | 'ENCRYPTED'
  | 'NOT_A_PDF'
  | 'PDF_PARSE_ERROR';

export type PdfWorkerResult =
  | { ok: true; numPages: number; pages: string[] }
  | { ok: false; code: PdfWorkerFailure; numPages?: number };

export interface PdfWorkerOptions {
  timeoutMs?: number;
  memoryMb?: number;
  maxPages?: number;
  maxTextChars?: number;
  /** Path of the pdf.js build (default: the one of pdf-parse). */
  pdfjsPath?: string;
  /** Replaces the engine, for tests. */
  workerSource?: string;
  /** Growth of the memory of the process (rss) in megabytes that ends the thread. */
  rssBudgetMb?: number;
}

/** At most this many threads at once (every one may use memoryMb and more). */
const MAX_THREADS = 2;
/** How often the memory of the process is looked at, milliseconds. */
const WATCH_INTERVAL_MS = 50;
const DEFAULT_RSS_BUDGET_MB = 600;

let running = 0;
const waiting: Array<() => void> = [];
async function acquire(): Promise<void> {
  if (running < MAX_THREADS) {
    running += 1;
    return;
  }
  await new Promise<void>(resolve => waiting.push(resolve));
}
function release(): void {
  const next = waiting.shift();
  if (next) next();
  else running -= 1;
}

const FAILURES: ReadonlySet<string> = new Set<PdfWorkerFailure>([
  'TIMEOUT',
  'WORKER_MEMORY',
  'WORKER_CRASH',
  'ENGINE_UNAVAILABLE',
  'TOO_MANY_PAGES',
  'TEXT_TOO_LARGE',
  'ENCRYPTED',
  'NOT_A_PDF',
  'PDF_PARSE_ERROR',
]);

/** Runs first in the thread. Defines parentPort and workerData, removes fetch. */
const PREAMBLE = `
'use strict';
const { parentPort, workerData } = require('worker_threads');
try { delete globalThis.fetch; } catch (ignored) {}
`;

/** The engine: pdf.js of pdf-parse, text only. Runs after the preamble. */
const ENGINE = `
function fail(code, extra) {
  parentPort.postMessage(Object.assign({ ok: false, code: code }, extra || {}));
}
(async function () {
  var PDFJS;
  try {
    PDFJS = require(workerData.pdfjsPath);
  } catch (ignored) {
    return fail('ENGINE_UNAVAILABLE');
  }
  try {
    PDFJS.disableWorker = true;
    PDFJS.isEvalSupported = false;
    PDFJS.disableFontFace = true;
    PDFJS.verbosity = 0;
    var task = PDFJS.getDocument({
      data: new Uint8Array(workerData.data),
      isEvalSupported: false,
      disableFontFace: true,
      nativeImageDecoderSupport: 'none',
      disableRange: true,
      disableStream: true,
      disableAutoFetch: true
    });
    var doc = await (task.promise || task);
    var numPages = doc.numPages;
    if (numPages > workerData.maxPages) return fail('TOO_MANY_PAGES', { numPages: numPages });
    var pages = [];
    var total = 0;
    for (var i = 1; i <= numPages; i += 1) {
      var page = await doc.getPage(i);
      var content = await page.getTextContent({ normalizeWhitespace: false, disableCombineTextItems: false });
      var lastY;
      var text = '';
      for (var j = 0; j < content.items.length; j += 1) {
        var item = content.items[j];
        text += (lastY === undefined || lastY === item.transform[5] ? '' : '\\n') + item.str;
        lastY = item.transform[5];
      }
      total += text.length;
      if (total > workerData.maxTextChars) return fail('TEXT_TOO_LARGE', { numPages: numPages });
      pages.push(text);
      if (page.cleanup) page.cleanup();
    }
    if (doc.destroy) doc.destroy();
    parentPort.postMessage({ ok: true, numPages: numPages, pages: pages });
  } catch (error) {
    fail(error && error.name === 'PasswordException' ? 'ENCRYPTED' : 'PDF_PARSE_ERROR');
  }
})();
`;

/**
 * Where pdf.js of pdf-parse lies, or null. In the bundle of a Next.js server the
 * namespace of `node:module` has only its default export (found in the browser
 * check of package U6: createRequire was missing and every PDF ended as
 * ENGINE_UNAVAILABLE), so the function is also taken from `default`.
 */
async function resolvePdfjsPath(): Promise<string | null> {
  try {
    const [nodeModule, path] = await Promise.all([
      import('node:module'),
      import('node:path'),
    ]);
    const createRequire =
      nodeModule.createRequire ??
      (nodeModule as unknown as { default?: typeof nodeModule }).default
        ?.createRequire;
    return createRequire(path.join(process.cwd(), 'noop.js')).resolve(
      'pdf-parse/lib/pdf.js/v1.10.100/build/pdf.js'
    );
  } catch {
    return null;
  }
}

const crash: PdfWorkerResult = { ok: false, code: 'WORKER_CRASH' };

/** The answer of the thread is data from a thread that read a hostile file. */
function validate(
  message: unknown,
  maxPages: number,
  maxTextChars: number
): PdfWorkerResult {
  if (typeof message !== 'object' || message === null) return crash;
  const m = message as Record<string, unknown>;
  const numPages = m.numPages;
  if (m.ok === true) {
    const pages = m.pages;
    if (
      typeof numPages !== 'number' ||
      !Number.isInteger(numPages) ||
      numPages < 0 ||
      numPages > maxPages ||
      !Array.isArray(pages) ||
      pages.length > maxPages ||
      !pages.every(page => typeof page === 'string')
    ) {
      return crash;
    }
    const total = (pages as string[]).reduce((sum, p) => sum + p.length, 0);
    if (total > maxTextChars) return crash;
    return { ok: true, numPages, pages: pages as string[] };
  }
  if (m.ok === false && typeof m.code === 'string' && FAILURES.has(m.code)) {
    return {
      ok: false,
      code: m.code as PdfWorkerFailure,
      ...(typeof numPages === 'number' && Number.isInteger(numPages)
        ? { numPages }
        : {}),
    };
  }
  return crash;
}

/** Reads the text of a PDF in a thread. Never throws, never leaves the thread running. */
export async function runPdfWorker(
  bytes: Uint8Array,
  options: PdfWorkerOptions = {}
): Promise<PdfWorkerResult> {
  await acquire();
  try {
    return await startThread(bytes, options);
  } finally {
    release();
  }
}

async function startThread(
  bytes: Uint8Array,
  options: PdfWorkerOptions
): Promise<PdfWorkerResult> {
  const timeoutMs = options.timeoutMs ?? READ_LIMITS.pdfTimeoutMs;
  const memoryMb = options.memoryMb ?? READ_LIMITS.pdfMemoryMb;
  const maxPages = options.maxPages ?? READ_LIMITS.maxPdfPages;
  const maxTextChars = options.maxTextChars ?? READ_LIMITS.maxTextChars;
  const rssBudget =
    (options.rssBudgetMb ?? DEFAULT_RSS_BUDGET_MB) * 1024 * 1024;
  const pdfjsPath =
    options.pdfjsPath ??
    (options.workerSource === undefined ? await resolvePdfjsPath() : '');
  if (pdfjsPath === null) return { ok: false, code: 'ENGINE_UNAVAILABLE' };

  try {
    const { Worker } = await import('node:worker_threads');
    return await new Promise<PdfWorkerResult>(resolve => {
      let settled = false;
      // The thread gets its own copy and the caller keeps its bytes.
      const copy = new Uint8Array(bytes);
      const worker = new Worker(PREAMBLE + (options.workerSource ?? ENGINE), {
        eval: true,
        env: {},
        stdout: true,
        stderr: true,
        workerData: { data: copy, pdfjsPath, maxPages, maxTextChars },
        transferList: [copy.buffer],
        resourceLimits: {
          maxOldGenerationSizeMb: memoryMb,
          maxYoungGenerationSizeMb: 16,
          stackSizeMb: 4,
        },
      });
      // Output of the thread is dropped: it may hold parts of the file.
      worker.stdout.resume();
      worker.stderr.resume();
      const done = (result: PdfWorkerResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        clearInterval(watch);
        worker.terminate().catch(() => undefined);
        resolve(result);
      };
      const timer = setTimeout(
        () => done({ ok: false, code: 'TIMEOUT' }),
        timeoutMs
      );
      // The decoders of pdf.js allocate outside of the heap that is limited above.
      const baseline = process.memoryUsage.rss();
      const watch = setInterval(() => {
        if (process.memoryUsage.rss() - baseline > rssBudget) {
          done({ ok: false, code: 'WORKER_MEMORY' });
        }
      }, WATCH_INTERVAL_MS);
      worker.on('message', message =>
        done(validate(message, maxPages, maxTextChars))
      );
      worker.on('error', error =>
        done({
          ok: false,
          code:
            (error as { code?: string } | null)?.code ===
            'ERR_WORKER_OUT_OF_MEMORY'
              ? 'WORKER_MEMORY'
              : 'WORKER_CRASH',
        })
      );
      worker.on('exit', () => done(crash));
    });
  } catch {
    return crash;
  }
}
