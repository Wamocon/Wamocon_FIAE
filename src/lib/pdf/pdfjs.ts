/**
 * The pdf.js library for the viewer of a trainee (SecurePdfViewer).
 *
 * Loaded on first use only (a dynamic import), so no other page carries it.
 * The legacy build is used because it runs in older browsers as well. The
 * worker is the file of the installed package, served by the app itself: no
 * CDN and no request to another host.
 *
 * Kept in its own file because `import.meta.url` is not understood by the test
 * environment: the tests replace this module.
 */

import type * as PdfJs from 'pdfjs-dist/legacy/build/pdf.mjs';

export type PdfJsModule = typeof PdfJs;

let loading: Promise<PdfJsModule> | null = null;

export function loadPdfjs(): Promise<PdfJsModule> {
  if (!loading) {
    loading = import('pdfjs-dist/legacy/build/pdf.mjs')
      .then(pdfjs => {
        pdfjs.GlobalWorkerOptions.workerSrc = new URL(
          'pdfjs-dist/legacy/build/pdf.worker.min.mjs',
          import.meta.url
        ).toString();
        return pdfjs;
      })
      .catch(error => {
        // a failed load may be tried again (the next click)
        loading = null;
        throw error;
      });
  }
  return loading;
}
