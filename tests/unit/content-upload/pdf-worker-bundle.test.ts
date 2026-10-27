/**
 * @jest-environment node
 */
import { pdfBytes } from '../../helpers/uploadFixtures';

// In the bundle of a Next.js server the namespace of `node:module` has only its
// default export. Package U6 found in the browser check that createRequire was
// missing then and that every PDF ended as ENGINE_UNAVAILABLE. The thread of the PDF
// reader has to find pdf.js in both shapes of the namespace.

const lines = Array.from(
  { length: 5 },
  (_, i) => `Eine erfundene Zeile Nummer ${i} mit genug Text für den Test.`
);

describe('the PDF reader finds its engine in the shape of a bundled server', () => {
  afterEach(() => {
    jest.resetModules();
    jest.dontMock('node:module');
  });

  it('reads a PDF when the namespace of node:module has only a default export', async () => {
    const actual = jest.requireActual('node:module');
    jest.doMock('node:module', () => ({ __esModule: true, default: actual }));
    const { readPdf } = await import('@/lib/content-upload/read-pdf');
    const result = await readPdf(pdfBytes({ pages: [lines] }));
    expect(result.findings.map(f => f.code)).not.toContain(
      'ENGINE_UNAVAILABLE'
    );
    expect(result.status).toBe('ok');
    expect(result.pageCount).toBe(1);
  });

  it('reads a PDF when createRequire is a named export (Node and the tests)', async () => {
    const { readPdf } = await import('@/lib/content-upload/read-pdf');
    const result = await readPdf(pdfBytes({ pages: [lines] }));
    expect(result.status).toBe('ok');
  });

  it('says ENGINE_UNAVAILABLE when node:module has no createRequire at all', async () => {
    jest.doMock('node:module', () => ({ __esModule: true, default: {} }));
    const { readPdf } = await import('@/lib/content-upload/read-pdf');
    const result = await readPdf(pdfBytes({ pages: [lines] }));
    expect(result.status).toBe('failed');
    expect(result.code).toBe('ENGINE_UNAVAILABLE');
  });
});
