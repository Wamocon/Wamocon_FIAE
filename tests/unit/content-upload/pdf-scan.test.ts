/**
 * @jest-environment node
 */
// scanPdf looks at the raw bytes of a PDF before any parser sees them. It finds
// the marks of active content (JavaScript, launch, address and file actions,
// embedded files, forms) and of encryption. It runs no parser and executes
// nothing, so it cannot be tricked into doing anything either.
import { describe, expect, it } from '@jest/globals';

import { scanPdf } from '@/lib/content-upload/pdf-scan';

import { pdfBytes } from '../../helpers/uploadFixtures';

const codes = (bytes: Uint8Array) => scanPdf(bytes).findings.map(f => f.code);

describe('scanPdf', () => {
  it('finds nothing in a plain PDF and counts its pages', () => {
    const result = scanPdf(pdfBytes({ pages: [['eins'], ['zwei'], ['drei']] }));
    expect(result.findings).toEqual([]);
    expect(result.estimatedPages).toBe(3);
  });

  it('rejects what is not a PDF and an empty input', () => {
    expect(codes(Buffer.from('<html>nein</html>'))).toEqual(['NOT_A_PDF']);
    expect(codes(Buffer.alloc(0))).toEqual(['NOT_A_PDF']);
    // The header may stand a little after the start (up to 1024 bytes).
    const late = Buffer.concat([Buffer.alloc(900, 0x20), pdfBytes()]);
    expect(codes(late)).toEqual([]);
    const tooLate = Buffer.concat([Buffer.alloc(1100, 0x20), pdfBytes()]);
    expect(codes(tooLate)).toEqual(['NOT_A_PDF']);
  });

  it('rejects an input above the size limit', () => {
    const result = scanPdf(pdfBytes(), { maxInputBytes: 100 });
    expect(result.findings.map(f => f.code)).toEqual(['TOO_LARGE']);
    expect(result.findings[0].severity).toBe('blocking');
  });

  it('rejects an encrypted PDF', () => {
    const result = scanPdf(
      pdfBytes({ trailer: '/Encrypt << /Filter /Standard /V 1 /R 2 >>' })
    );
    expect(result.findings).toEqual([
      expect.objectContaining({ code: 'ENCRYPTED', severity: 'blocking' }),
    ]);
  });

  it('reports JavaScript, launch, address and open actions as a warning', () => {
    const bytes = pdfBytes({
      catalog:
        '/OpenAction << /S /JavaScript /JS (app.alert\\(1\\)) >> /AA << /WC << /S /Launch /F (cmd.exe) >> >>',
      extraObjects: [
        '%ID% 0 obj\n<< /S /URI /URI (https://example.invalid/) >>\nendobj\n',
        '%ID% 0 obj\n<< /Type /Filespec /EF << /F 99 0 R >> /Subtype /EmbeddedFile >>\nendobj\n',
        '%ID% 0 obj\n<< /S /SubmitForm /F (https://example.invalid/) >>\nendobj\n',
        '%ID% 0 obj\n<< /S /GoToR /F (other.pdf) >>\nendobj\n',
        '%ID% 0 obj\n<< /Subtype /RichMedia >>\nendobj\n',
      ],
    });
    const result = scanPdf(bytes);
    expect(result.findings.map(f => f.code).sort()).toEqual(
      [
        'EMBEDDED_FILE',
        'JAVASCRIPT',
        'LAUNCH',
        'OPEN_ACTION',
        'REMOTE_GOTO',
        'RICH_MEDIA',
        'SUBMIT_FORM',
        'URI_ACTION',
      ].sort()
    );
    expect(result.findings.every(f => f.severity === 'warning')).toBe(true);
  });

  it('sees through hex escapes in names', () => {
    const bytes = pdfBytes({
      catalog: '/OpenAction << /S /J#61va#53cript /#4AS (x) >>',
      trailer: '/#45ncrypt 1 0 R',
    });
    const found = codes(bytes);
    expect(found).toEqual(expect.arrayContaining(['JAVASCRIPT', 'ENCRYPTED']));
    expect(found).toContain('OPEN_ACTION');
  });

  it('counts how often a mark occurs and keeps the message free of content', () => {
    const bytes = pdfBytes({
      extraObjects: [
        '%ID% 0 obj\n<< /S /JavaScript /JS (a) >>\nendobj\n',
        '%ID% 0 obj\n<< /S /JavaScript /JS (b) >>\nendobj\n',
      ],
    });
    const hit = scanPdf(bytes).findings.find(f => f.code === 'JAVASCRIPT');
    expect(hit?.count).toBe(4);
    expect(hit?.message).not.toMatch(/app\.|alert/);
  });

  it('notes forms, XFA and object streams as information or warning', () => {
    const result = scanPdf(
      pdfBytes({
        catalog: '/AcroForm << /XFA 5 0 R /Fields [] >>',
        extraObjects: ['%ID% 0 obj\n<< /Type /ObjStm /N 1 >>\nendobj\n'],
      })
    );
    const by = Object.fromEntries(
      result.findings.map(f => [f.code, f.severity])
    );
    expect(by).toEqual({
      ACRO_FORM: 'info',
      XFA: 'warning',
      OBJECT_STREAMS: 'info',
    });
  });

  it('does not take text in a page for a mark, only names', () => {
    const result = scanPdf(
      pdfBytes({ pages: [['Das Wort JavaScript und Launch im Text.']] })
    );
    expect(result.findings).toEqual([]);
  });

  it('works in linear time on a large input full of slashes', () => {
    const big = Buffer.concat([
      Buffer.from('%PDF-1.4\n'),
      Buffer.from('/'.repeat(8 * 1024 * 1024)),
      Buffer.from('/Aa'.repeat(1024 * 1024)),
    ]);
    const started = Date.now();
    scanPdf(big);
    expect(Date.now() - started).toBeLessThan(3000);
  });
});
