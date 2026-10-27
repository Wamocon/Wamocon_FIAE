/**
 * @jest-environment node
 */
import { randomBytes } from 'node:crypto';

import JSZip from 'jszip';

import { readXlsx } from '@/lib/content-upload/read-xlsx';
import { parseMappingSheet } from '@/lib/content-import/learning-fields/mapping-sheet';

import { makeXlsx } from '../../helpers/xlsxFixture';
import { sampleRows } from '../content-import/learning-fields/fixtures';
import {
  changed,
  editText,
  lieAboutSize,
  markEncrypted,
  sheetPart,
  validMapping,
  withEntry,
  zeroBomb,
} from '../../helpers/xlsxHostile';

// building a 100 MB bomb takes a while on a busy machine
jest.setTimeout(60_000);

const codes = (r: Awaited<ReturnType<typeof readXlsx>>) =>
  r.findings.filter(f => f.severity === 'blocking').map(f => f.code);

async function rejects(bytes: Uint8Array, code: string, options = {}) {
  const result = await readXlsx(bytes, options);
  expect(result.status).not.toBe('ok');
  expect(result.code).toBe(code);
  expect(result.rows).toEqual([]);
  return result;
}

describe('readXlsx: a valid mapping table', () => {
  it('reads the rows of the sheet as text', async () => {
    const result = await readXlsx(await validMapping());
    expect(result.status).toBe('ok');
    expect(result.code).toBeNull();
    expect(result.sheetName).toBe('Zuordnung');
    expect(result.stats.sheets).toBe(1);
    expect(result.rows.length).toBeGreaterThan(8);
    expect(parseMappingSheet(result.rows).ok).toBe(true);
  });

  it('takes the sheet that the picker names, not only the first one', async () => {
    const two = await makeXlsx([
      {
        name: 'Deckblatt',
        rows: [{ row: 1, cells: { A: 'Erfundenes Deckblatt' } }],
      },
      {
        name: 'Tabelle',
        rows: sampleRows().map(r => ({ row: r.row, cells: r.cells })),
      },
    ]);
    const result = await readXlsx(two, {
      pick: rows => parseMappingSheet(rows).ok,
    });
    expect(result.status).toBe('ok');
    expect(result.sheetName).toBe('Tabelle');
    expect(result.picked).toBe(true);
    const none = await readXlsx(two, { pick: () => false });
    expect(none.status).toBe('ok');
    expect(none.picked).toBe(false);
    expect(none.sheetName).toBe('Deckblatt');
  });

  it('does not read a hidden sheet', async () => {
    const hidden = await editText(
      await validMapping(),
      'xl/workbook.xml',
      text => text.replace('<sheet name=', '<sheet state="hidden" name=')
    );
    const result = await readXlsx(hidden);
    expect(result.status).toBe('failed');
    expect(result.code).toBe('NO_SHEET');
    expect(result.findings.map(f => f.code)).toContain('HIDDEN_SHEET');
  });

  it('reads a sheet that the file calls visible (other writers write state="visible") and not one that is hidden', async () => {
    const visible = await editText(
      await validMapping(),
      'xl/workbook.xml',
      text => text.replace('<sheet name=', '<sheet state="visible" name=')
    );
    const result = await readXlsx(visible);
    expect(result.status).toBe('ok');
    expect(result.sheetName).toBe('Zuordnung');
    const veryHidden = await editText(
      await validMapping(),
      'xl/workbook.xml',
      text => text.replace('<sheet name=', '<sheet state="veryHidden" name=')
    );
    expect((await readXlsx(veryHidden)).code).toBe('NO_SHEET');
  });

  it('never evaluates a formula: the stored value is read, nothing is fetched', async () => {
    const fetchSpy = jest.fn();
    const original = globalThis.fetch;
    globalThis.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const formula = await editText(await validMapping(), sheetPart, text =>
        text.replace(
          '</sheetData>',
          '<row r="40"><c r="C40" t="str"><f>HYPERLINK("http://evil.invalid/x","y")</f><v>LF 2</v></c><c r="D40"><f>WEBSERVICE("http://evil.invalid")</f></c></row></sheetData>'
        )
      );
      const result = await readXlsx(formula);
      expect(result.status).toBe('ok');
      expect(result.findings.map(f => f.code)).toContain('FORMULAS');
      const row = result.rows.find(r => r.row === 40);
      expect(row?.cells).toEqual({ C: 'LF 2' });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      globalThis.fetch = original;
    }
  });
});

describe('readXlsx: files that must not be processed', () => {
  it('refuses a macro project, ActiveX, linked workbooks and data connections', async () => {
    const base = await validMapping();
    await rejects(
      await withEntry(base, 'xl/vbaProject.bin', 'x'),
      'MACRO_ENABLED'
    );
    await rejects(
      await withEntry(base, 'xl/activeX/activeX1.xml', '<a/>'),
      'ACTIVE_X'
    );
    await rejects(
      await withEntry(base, 'xl/externalLinks/externalLink1.xml', '<a/>'),
      'EXTERNAL_LINKS'
    );
    await rejects(
      await withEntry(base, 'xl/macrosheets/sheet1.xml', '<a/>'),
      'MACRO_ENABLED'
    );
    await rejects(
      await withEntry(base, 'xl/dialogsheets/sheet1.xml', '<a/>'),
      'MACRO_ENABLED'
    );
    await rejects(
      await withEntry(base, 'xl/connections.xml', '<a/>'),
      'DATA_CONNECTIONS'
    );
    await rejects(
      await withEntry(base, 'xl/queryTables/queryTable1.xml', '<a/>'),
      'DATA_CONNECTIONS'
    );
  });

  it('refuses a macro enabled type and external references of the workbook', async () => {
    const base = await validMapping();
    const macroSheetType = await withEntry(
      base,
      '[Content_Types].xml',
      '<Types><Override PartName="/xl/macrosheets/sheet1.xml" ContentType="application/vnd.ms-excel.macrosheet+xml"/></Types>'
    );
    await rejects(macroSheetType, 'MACRO_ENABLED');
    const macroType = await withEntry(
      base,
      '[Content_Types].xml',
      '<Types><Override PartName="/xl/workbook.xml" ContentType="application/vnd.ms-excel.sheet.macroEnabled.main+xml"/></Types>'
    );
    await rejects(macroType, 'MACRO_ENABLED');
    const linked = await editText(base, 'xl/workbook.xml', text =>
      text.replace('</sheets>', '</sheets><externalReferences/>')
    );
    await rejects(linked, 'EXTERNAL_LINKS');
  });

  it('refuses a reference that points outside of the file, but only notes a link', async () => {
    const base = await validMapping();
    const template = await withEntry(
      base,
      'xl/worksheets/_rels/sheet1.xml.rels',
      '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/oleObject" Target="file:///c:/x.xls" TargetMode="External"/></Relationships>'
    );
    await rejects(template, 'EXTERNAL_REFERENCE');
    const link = await withEntry(
      base,
      'xl/worksheets/_rels/sheet1.xml.rels',
      '<Relationships><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/hyperlink" Target="http://example.invalid/" TargetMode="External"/></Relationships>'
    );
    const result = await readXlsx(link);
    expect(result.status).toBe('ok');
    expect(result.findings.map(f => f.code)).toContain('EXTERNAL_LINK');
  });

  it('refuses names that leave the package', async () => {
    const base = await validMapping();
    await rejects(
      await withEntry(base, '../evil.xml', '<a/>'),
      'UNSAFE_ENTRY_NAME'
    );
    await rejects(
      await withEntry(base, 'xl/..\\evil.xml', '<a/>'),
      'UNSAFE_ENTRY_NAME'
    );
  });

  it('refuses an encrypted entry, an old Excel file and a file that is no zip', async () => {
    await rejects(markEncrypted(await validMapping()), 'ENCRYPTED');
    const ole = Buffer.concat([
      Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]),
      Buffer.alloc(600),
    ]);
    await rejects(ole, 'LEGACY_XLS');
    const encryptedOle = Buffer.concat([
      ole,
      Buffer.from('EncryptedPackage', 'utf16le'),
    ]);
    await rejects(encryptedOle, 'ENCRYPTED');
    await rejects(Buffer.from('kein Excel'), 'NOT_AN_XLSX');
    await rejects(Buffer.alloc(0), 'NOT_AN_XLSX');
    const html = Buffer.from('<html>nein</html>'.repeat(40));
    await rejects(html, 'NOT_AN_XLSX');
  });

  it('refuses a damaged or cut zip and a zip that is a docx', async () => {
    const good = await validMapping();
    await rejects(good.subarray(0, good.length - 30), 'NOT_AN_XLSX');
    const damaged = Buffer.from(good);
    damaged.writeUInt32LE(0xffff0000, damaged.length - 6);
    const result = await readXlsx(damaged);
    expect(result.status).toBe('rejected');
    const docx = new JSZip();
    docx.file('word/document.xml', '<w:document/>');
    await rejects(
      await docx.generateAsync({ type: 'nodebuffer' }),
      'NOT_AN_XLSX'
    );
  });

  it('refuses a markup that hides text: DOCTYPE, comment, CDATA', async () => {
    const base = await validMapping();
    for (const trick of [
      '<!DOCTYPE x [<!ENTITY a "b">]>',
      '<!-- <c r="A1"><v>0</v></c> -->',
      '<![CDATA[x]]>',
    ]) {
      await rejects(
        await editText(base, sheetPart, text =>
          text.replace('<sheetData>', `${trick}<sheetData>`)
        ),
        'XML_FEATURES'
      );
    }
    await rejects(
      await editText(base, 'xl/sharedStrings.xml', text =>
        text.replace('<sst', '<!DOCTYPE s><sst')
      ),
      'XML_FEATURES'
    );
  });

  it('keeps a bad shape of a workbook out: no sheet, too many sheets', async () => {
    const base = await validMapping();
    await rejects(
      await editText(base, 'xl/workbook.xml', text =>
        text.replace(/<sheets>.*<\/sheets>/, '<sheets></sheets>')
      ),
      'NO_SHEET'
    );
    const many = await makeXlsx(
      Array.from({ length: 25 }, (_, i) => ({
        name: `S${i}`,
        rows: [{ row: 1, cells: { A: 'x' } }],
      }))
    );
    await rejects(many, 'TOO_MANY_SHEETS');
    await rejects(await withEntry(base, 'xl/workbook.xml', ''), 'NO_SHEET');
  });
});

describe('readXlsx: zip bombs and limits', () => {
  it('refuses a zip bomb by its declared size and its ratio, before anything is unpacked', async () => {
    const base = await validMapping();
    const started = Date.now();
    // 3 MB of one byte packs to a few KB: ratio far above 100 (an entry above 1 MB)
    await rejects(await zeroBomb(base, 3), 'ZIP_BOMB');
    // above the limit of one part
    await rejects(await zeroBomb(base, 12), 'PART_TOO_LARGE');
    // 100 MB packs to about 100 KB
    const huge = await zeroBomb(base, 100);
    expect(huge.length).toBeLessThan(1024 * 1024);
    await rejects(huge, 'PART_TOO_LARGE');
    expect(Date.now() - started).toBeLessThan(15_000);
  });

  it('refuses many parts that are each fine but together unpack to far too much', async () => {
    const base = await validMapping();
    // every kilobyte holds ten random bytes and blanks: each part packs about 60:1, below
    // the limit of the ratio, so only the sum of the declared sizes gives it away
    const sparse = () => {
      const part = Buffer.alloc(6 * 1024 * 1024, 0x20);
      for (let at = 0; at < part.length; at += 1024) {
        randomBytes(10).copy(part, at);
      }
      return part;
    };
    const many = await changed(base, zip => {
      for (let i = 0; i < 7; i += 1)
        zip.file(`xl/media/part${i}.bin`, sparse());
    });
    expect(many.length).toBeLessThan(5 * 1024 * 1024);
    const result = await readXlsx(many);
    expect(result.status).toBe('rejected');
    expect(codes(result)).toContain('ZIP_BOMB');
    // with the ratio check switched off the sum still stops it
    const bySum = await readXlsx(many, { limits: { maxRatio: 1_000_000 } });
    expect(codes(bySum)).toContain('ZIP_BOMB');
  });

  it('is not fooled by a directory that lies about the size', async () => {
    const base = await validMapping();
    const big = await changed(base, zip => {
      zip.file(sheetPart, Buffer.alloc(20 * 1024 * 1024, 0x20));
    });
    const lying = lieAboutSize(big, 1000);
    const result = await readXlsx(lying);
    // the unpacking is capped or the size mismatch is caught: never a read of 20 MB as a sheet
    expect(result.status).not.toBe('ok');
    expect(result.rows).toEqual([]);
  });

  it('names the unpacking that exceeds a part limit although the directory looked small', async () => {
    const base = await validMapping();
    const big = await changed(base, zip => {
      zip.file(sheetPart, Buffer.alloc(4 * 1024 * 1024, 0x20));
    });
    // the directory says 1000 bytes, the sheet really unpacks to 4 MB: the cap of the part
    // (here 1 MB) stops the unpacking, whatever the directory declared
    const result = await readXlsx(lieAboutSize(big, 1000), {
      limits: { maxPartBytes: 1024 * 1024 },
    });
    expect(result.status).not.toBe('ok');
    expect(result.rows).toEqual([]);
    expect(['PART_TOO_LARGE', 'PARSE_ERROR']).toContain(result.code);
  });

  it('notes an embedded object as a warning and never opens it', async () => {
    const result = await readXlsx(
      await withEntry(await validMapping(), 'xl/embeddings/oleObject1.bin', 'x')
    );
    expect(result.status).toBe('ok');
    expect(result.findings.map(f => f.code)).toContain('EMBEDDED_OBJECT');
  });

  it('refuses too many relationship parts and a workbook part with a comment', async () => {
    const base = await validMapping();
    const many = await changed(base, zip => {
      for (let i = 0; i < 60; i += 1) {
        zip.file(`xl/worksheets/_rels/s${i}.xml.rels`, '<Relationships/>');
      }
    });
    await rejects(many, 'TOO_MANY_RELATIONSHIP_FILES');
    await rejects(
      await editText(base, 'xl/workbook.xml', text => `<!-- x -->${text}`),
      'XML_FEATURES'
    );
  });

  it('stops when JSZip and the zip directory name different entries', async () => {
    const sheetModule =
      await import('@/lib/content-import/learning-fields/xlsx-sheet');
    const spy = jest.spyOn(sheetModule, 'openZip').mockResolvedValue({
      files: { 'xl/workbook.xml': {}, 'evil/extra.xml': {} },
      file: () => null,
    } as never);
    try {
      await rejects(await validMapping(), 'ZIP_DAMAGED');
    } finally {
      spy.mockRestore();
    }
    const failing = jest
      .spyOn(sheetModule, 'openZip')
      .mockRejectedValue(new Error('zip.js: can not read'));
    try {
      await rejects(await validMapping(), 'ZIP_DAMAGED');
    } finally {
      failing.mockRestore();
    }
  });

  it('refuses too many entries before JSZip builds an object for each', async () => {
    const base = await validMapping();
    const many = await changed(base, zip => {
      for (let i = 0; i < 300; i += 1) zip.file(`xl/media/m${i}.txt`, 'x');
    });
    await rejects(many, 'TOO_MANY_ENTRIES');
    expect(many.length).toBeLessThan(1024 * 1024);
  });

  it('refuses a file above the size limit of the input', async () => {
    await rejects(Buffer.alloc(5 * 1024 * 1024 + 1), 'TOO_LARGE');
    await rejects(await validMapping(), 'TOO_LARGE', {
      limits: { maxInputBytes: 100 },
    });
  });

  it('refuses too many cells, rows and columns', async () => {
    const base = await validMapping();
    await rejects(base, 'TOO_MANY_CELLS', { limits: { maxCells: 5 } });
    await rejects(base, 'TOO_MANY_ROWS', { limits: { maxRows: 3 } });
    const wide = await editText(base, sheetPart, text =>
      text.replace(
        '</sheetData>',
        '<row r="50"><c r="ZZ50"><v>1</v></c></row></sheetData>'
      )
    );
    await rejects(wide, 'TOO_MANY_COLUMNS');
  });

  it('refuses a sheet of 150000 cells by the default limit', async () => {
    const base = await validMapping();
    const rows = Array.from({ length: 1500 }, (_, i) => {
      const cells = Array.from(
        { length: 100 },
        (_c, k) => `<c r="${'A'}${i + 100}"><v>${k}</v></c>`
      ).join('');
      return `<row r="${i + 100}">${cells}</row>`;
    }).join('');
    const bigSheet = await editText(base, sheetPart, text =>
      text.replace('</sheetData>', `${rows}</sheetData>`)
    );
    await rejects(bigSheet, 'TOO_MANY_CELLS');
  });

  it('gives up after the time limit as failed, not as an abort', async () => {
    const result = await readXlsx(await validMapping(), {
      limits: { timeoutMs: -1 },
    });
    expect(result.status).toBe('failed');
    expect(result.code).toBe('TIMEOUT');
  });

  it('never throws, whatever the bytes are', async () => {
    const good = await validMapping();
    for (let seed = 1; seed <= 60; seed += 1) {
      const data = Buffer.from(good);
      let x = seed;
      for (let i = 0; i < 12; i += 1) {
        x = (x * 1103515245 + 12345) & 0x7fffffff;
        data[x % data.length] = x & 0xff;
      }
      await expect(readXlsx(data)).resolves.toBeDefined();
    }
    await expect(readXlsx(new ArrayBuffer(10))).resolves.toBeDefined();
  });
});
