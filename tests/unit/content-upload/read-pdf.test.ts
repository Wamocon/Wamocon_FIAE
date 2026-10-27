/**
 * @jest-environment node
 */
// readPdf reads the text of a PDF from its bytes. The pdf.js of pdf-parse is old
// (version 1.10.100 from 2018), so the text is read in a thread of its own
// that can be ended: without environment variables, without fetch, with a
// limit of time and memory. A file that hangs, uses too much memory or crashes
// the thread ends as failed and the process goes on.
import { afterEach, describe, expect, it, jest } from '@jest/globals';

import { runPdfWorker } from '@/lib/content-upload/pdf-worker';
import { readPdf } from '@/lib/content-upload/read-pdf';

import { pdfBytes } from '../../helpers/uploadFixtures';

const LINES = [
  'Ein erfundener Lehrtext über Netzwerke und Router im Betrieb.',
  'Die zweite Zeile erklärt, wie ein Switch Adressen lernt.',
];

afterEach(() => {
  jest.restoreAllMocks();
});

describe('readPdf: reading', () => {
  it('returns the text of the pages and the page count', async () => {
    const result = await readPdf(
      pdfBytes({ pages: [LINES, ['Seite zwei mit genug Text für den Test.']] })
    );
    expect(result.status).toBe('ok');
    expect(result.code).toBeNull();
    expect(result.pageCount).toBe(2);
    expect(result.pages).toHaveLength(2);
    expect(result.text).toContain('Ein erfundener Lehrtext');
    expect(result.text).toContain('Seite zwei');
    expect(result.findings.filter(f => f.severity === 'blocking')).toEqual([]);
  }, 30000);

  it('does not change the bytes of the caller', async () => {
    const bytes = pdfBytes({ pages: [LINES] });
    const copy = Buffer.from(bytes);
    await readPdf(bytes);
    expect(bytes.equals(copy)).toBe(true);
  }, 30000);

  it('still reads the text of a PDF with actions, reports them and runs nothing', async () => {
    const fetchSpy = jest.fn();
    const saved = global.fetch;
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const result = await readPdf(
        pdfBytes({
          pages: [LINES],
          catalog:
            '/OpenAction << /S /JavaScript /JS (throw 1) >> /AA << /WC << /S /URI /URI (https://example.invalid/) >> >>',
        })
      );
      expect(result.status).toBe('ok');
      expect(result.text).toContain('Ein erfundener Lehrtext');
      expect(result.findings.map(f => f.code)).toEqual(
        expect.arrayContaining(['JAVASCRIPT', 'OPEN_ACTION', 'URI_ACTION'])
      );
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = saved;
    }
  }, 30000);

  it('fails with NO_TEXT for a PDF without enough text (a scan)', async () => {
    const result = await readPdf(pdfBytes({ pages: [['kurz']] }));
    expect(result).toMatchObject({ status: 'failed', code: 'NO_TEXT' });
    expect(result.findings.map(f => f.code)).toContain('NO_TEXT');
  }, 30000);
});

describe('readPdf: refusals before the thread starts', () => {
  it('rejects what is not a PDF, an encrypted PDF and a file that is too large', async () => {
    expect(await readPdf(Buffer.from('kein pdf'))).toMatchObject({
      status: 'rejected',
      code: 'NOT_A_PDF',
      text: '',
    });
    expect(
      await readPdf(pdfBytes({ trailer: '/Encrypt << /Filter /Standard >>' }))
    ).toMatchObject({ status: 'rejected', code: 'ENCRYPTED', text: '' });
    expect(await readPdf(pdfBytes(), { maxInputBytes: 50 })).toMatchObject({
      status: 'rejected',
      code: 'TOO_LARGE',
    });
  });

  it('does not start a thread for a rejected file', async () => {
    const worker = jest.requireActual<typeof import('node:worker_threads')>(
      'node:worker_threads'
    );
    const spy = jest.spyOn(worker, 'Worker');
    // positive control: a call that does start a thread is seen by the spy
    await runPdfWorker(Buffer.from('%PDF-'), {
      workerSource:
        'parentPort.postMessage({ ok: true, numPages: 0, pages: [] });',
    });
    expect(spy).toHaveBeenCalledTimes(1);
    spy.mockClear();
    await readPdf(Buffer.from('kein pdf'));
    expect(spy).not.toHaveBeenCalled();
  }, 20000);
});

describe('readPdf: hostile text', () => {
  it('cleans a text that is mostly white space in linear time', async () => {
    const lines = Array.from({ length: 6000 }, () => ' ');
    lines.push(
      'Ein erfundener Satz, der lang genug ist, damit der Text zählt.'
    );
    const started = Date.now();
    const result = await readPdf(pdfBytes({ pages: [lines] }));
    expect(result.status).toBe('ok');
    expect(result.text).toContain('Ein erfundener Satz');
    expect(Date.now() - started).toBeLessThan(10000);
  }, 30000);

  it('does not start a thread for a PDF that counts more pages than allowed', async () => {
    const result = await readPdf(
      pdfBytes({ pages: [['a'], ['b'], ['c'], ['d']] }),
      { maxPages: 2, workerSource: 'throw new Error("must not run")' }
    );
    expect(result).toMatchObject({ status: 'failed', code: 'TOO_MANY_PAGES' });
  });
});

describe('readPdf: limits while reading', () => {
  it('fails with TOO_MANY_PAGES above the page limit', async () => {
    const result = await readPdf(
      pdfBytes({ pages: [['a'], ['b'], ['c'], ['d'], ['e']] }),
      { maxPages: 3 }
    );
    expect(result).toMatchObject({
      status: 'failed',
      code: 'TOO_MANY_PAGES',
      text: '',
    });
  }, 30000);

  it('fails with TEXT_TOO_LARGE above the limit of characters', async () => {
    const result = await readPdf(pdfBytes({ pages: [LINES] }), {
      maxTextChars: 40,
    });
    expect(result).toMatchObject({ status: 'failed', code: 'TEXT_TOO_LARGE' });
  }, 30000);

  it('fails with PDF_PARSE_ERROR for a damaged PDF and does not leak its text', async () => {
    const result = await readPdf(
      Buffer.from('%PDF-1.4\n1 0 obj\n<< /Geheim (ZEBRAKANAL) \n')
    );
    expect(result).toMatchObject({ status: 'failed', code: 'PDF_PARSE_ERROR' });
    expect(JSON.stringify(result.findings)).not.toContain('ZEBRAKANAL');
  }, 30000);
});

describe('runPdfWorker: the thread', () => {
  // The body runs after the preamble of the thread, which defines parentPort
  // and workerData and takes fetch away.
  const source = (body: string) => body;

  it('ends a thread that never returns when the time is up', async () => {
    const started = Date.now();
    const result = await runPdfWorker(Buffer.from('%PDF-'), {
      timeoutMs: 300,
      workerSource: source('while (true) {}'),
    });
    expect(result).toEqual({ ok: false, code: 'TIMEOUT' });
    expect(Date.now() - started).toBeLessThan(5000);
  }, 20000);

  it('ends a thread that uses too much memory', async () => {
    const result = await runPdfWorker(Buffer.from('%PDF-'), {
      memoryMb: 16,
      timeoutMs: 15000,
      workerSource: source(
        'const keep = []; while (true) keep.push(new Array(100000).fill(1));'
      ),
    });
    expect(result).toEqual({ ok: false, code: 'WORKER_MEMORY' });
  }, 30000);

  it('ends a thread whose memory grows outside of the heap (ArrayBuffers)', async () => {
    const started = Date.now();
    const result = await runPdfWorker(Buffer.from('%PDF-'), {
      rssBudgetMb: 100,
      timeoutMs: 20000,
      workerSource: source(
        'const keep = []; while (true) { const b = Buffer.alloc(32 * 1024 * 1024); b.fill(1); keep.push(b); }'
      ),
    });
    expect(result).toEqual({ ok: false, code: 'WORKER_MEMORY' });
    expect(Date.now() - started).toBeLessThan(15000);
  }, 30000);

  it('runs only two threads at the same time', async () => {
    const answer =
      "setTimeout(() => parentPort.postMessage({ ok: true, numPages: 1, pages: ['x'] }), 400);";
    const started = Date.now();
    const results = await Promise.all(
      [1, 2, 3, 4].map(() =>
        runPdfWorker(Buffer.from('%PDF-'), { workerSource: source(answer) })
      )
    );
    expect(results.every(r => r.ok)).toBe(true);
    // two rounds of at least 400 ms, not one
    expect(Date.now() - started).toBeGreaterThanOrEqual(750);
  }, 30000);

  it('reports a thread that throws or exits without an answer as a crash', async () => {
    expect(
      await runPdfWorker(Buffer.from('%PDF-'), {
        workerSource: source("throw new Error('boom ZEBRAKANAL');"),
      })
    ).toEqual({ ok: false, code: 'WORKER_CRASH' });
    expect(
      await runPdfWorker(Buffer.from('%PDF-'), {
        workerSource: source('process.exit(0);'),
      })
    ).toEqual({ ok: false, code: 'WORKER_CRASH' });
  }, 20000);

  it('does not accept an answer of the wrong shape or beyond the limits', async () => {
    for (const answer of [
      '{ ok: true }',
      '{ ok: true, numPages: 1, pages: [1] }',
      '{ ok: true, numPages: 1, pages: "x" }',
      "{ ok: false, code: 'SOMETHING_ELSE' }",
      '"text"',
      '{ ok: true, numPages: 5, pages: ["a","b","c","d","e"] }',
      '{ ok: true, numPages: 1, pages: ["' + 'x'.repeat(200) + '"] }',
    ]) {
      expect(
        await runPdfWorker(Buffer.from('%PDF-'), {
          maxPages: 3,
          maxTextChars: 100,
          workerSource: source(`parentPort.postMessage(${answer});`),
        })
      ).toEqual({ ok: false, code: 'WORKER_CRASH' });
    }
  }, 30000);

  it('gives the thread no environment variables and no fetch', async () => {
    process.env.UPLOAD_TEST_SECRET = 'geheim';
    try {
      const result = await runPdfWorker(Buffer.from('%PDF-'), {
        workerSource: source(
          "parentPort.postMessage({ ok: true, numPages: 1, pages: [Object.keys(process.env).length + ':' + typeof fetch + ':' + (process.env.UPLOAD_TEST_SECRET || '-')] });"
        ),
      });
      expect(result).toEqual({
        ok: true,
        numPages: 1,
        pages: ['0:undefined:-'],
      });
    } finally {
      delete process.env.UPLOAD_TEST_SECRET;
    }
  }, 20000);

  it('hands the bytes to the thread as a copy', async () => {
    const bytes = Buffer.from('%PDF-1.4 abc');
    const result = await runPdfWorker(bytes, {
      workerSource: source(
        "parentPort.postMessage({ ok: true, numPages: 1, pages: [Buffer.from(workerData.data).toString('latin1')] });"
      ),
    });
    expect(result).toEqual({ ok: true, numPages: 1, pages: ['%PDF-1.4 abc'] });
    expect(bytes.toString('latin1')).toBe('%PDF-1.4 abc');
  }, 20000);

  it('reports an engine that cannot be found', async () => {
    const result = await runPdfWorker(Buffer.from('%PDF-'), {
      pdfjsPath: '/gibt/es/nicht/pdf.js',
    });
    expect(result).toEqual({ ok: false, code: 'ENGINE_UNAVAILABLE' });
  }, 20000);
});
