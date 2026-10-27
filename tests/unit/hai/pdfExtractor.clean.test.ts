/**
 * @jest-environment node
 */
// cleanPDFText is exported so that the upload reader can clean the text of a PDF
// the same way as the HAI does. The behaviour is the one it always had.
import { describe, expect, it } from '@jest/globals';

import { cleanPDFText } from '@/lib/hai/pdfExtractor';

describe('cleanPDFText', () => {
  it('removes page numbers, page marks, copyright and web address lines', () => {
    const text = [
      'Erste Zeile',
      '12',
      'Seite 3 von 9',
      'Page 4 of 9',
      '© 2026 Beispiel',
      'www.example.com/seite',
      'Letzte Zeile',
    ].join('\r\n');
    expect(cleanPDFText(text)).toBe('Erste Zeile\n\nLetzte Zeile');
  });

  it('collapses white space and trims', () => {
    expect(cleanPDFText('  a \t\t b  \n\n\n\n c  ')).toBe('a b \n\n c');
  });

  it('keeps ordinary text unchanged', () => {
    expect(cleanPDFText('Ein Router verbindet Netze.')).toBe(
      'Ein Router verbindet Netze.'
    );
    expect(cleanPDFText('')).toBe('');
  });
});
