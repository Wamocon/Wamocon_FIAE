import JSZip from 'jszip';

import {
  columnIndex,
  parseSharedStrings,
  parseSheetXml,
  readXlsxRows,
} from '@/lib/content-import/learning-fields/xlsx-sheet';

import { makeXlsx } from '../../../helpers/xlsxFixture';

describe('columnIndex', () => {
  it('turns column letters into positions', () => {
    expect(columnIndex('A')).toBe(1);
    expect(columnIndex('H')).toBe(8);
    expect(columnIndex('Z')).toBe(26);
    expect(columnIndex('AA')).toBe(27);
    expect(columnIndex('a')).toBe(1);
  });
});

describe('parseSharedStrings', () => {
  it('reads plain and rich text and leaves out phonetic runs', () => {
    const xml =
      '<sst><si><t>eins</t></si>' +
      '<si><r><t>zw</t></r><r><t xml:space="preserve">ei </t></r><rPh sb="0" eb="1"><t>PH</t></rPh></si>' +
      '<si><t/></si><si><t>a &amp; b &lt;c&gt; &#65;&#x42;</t></si></sst>';
    expect(parseSharedStrings(xml)).toEqual([
      'eins',
      'zwei ',
      '',
      'a & b <c> AB',
    ]);
  });

  it('decodes the escaped control characters of a spreadsheet', () => {
    expect(
      parseSharedStrings('<sst><si><t>LF_x0002_ 2</t></si></sst>')
    ).toEqual(['LF\u0002 2']);
    // a literal underscore text is not an escape
    expect(
      parseSharedStrings('<sst><si><t>a_x005F_x0002_b</t></si></sst>')
    ).toEqual(['a_x0002_b']);
  });

  it('is empty for an empty or damaged document', () => {
    expect(parseSharedStrings('')).toEqual([]);
    expect(parseSharedStrings('<sst><si><t>offen')).toEqual(['offen']);
  });
});

describe('parseSheetXml', () => {
  const shared = ['Titel', 'LF 2'];

  it('reads shared, inline, formula and numeric cells with their rows', () => {
    const xml =
      '<worksheet><sheetData>' +
      '<row r="4"><c r="A4" t="s"><v>0</v></c><c r="B4" t="inlineStr"><is><t>roh</t></is></c>' +
      '<c r="C4" t="str"><f>x</f><v>Formel</v></c><c r="D4"><v>12</v></c>' +
      '<c r="E4" t="b"><v>1</v></c><c r="F4" t="e"><v>#DIV/0!</v></c><c r="G4"/></row>' +
      '<row r="7"><c r="AA7" t="s"><v>1</v></c></row>' +
      '</sheetData></worksheet>';
    expect(parseSheetXml(xml, shared)).toEqual([
      {
        row: 4,
        cells: { A: 'Titel', B: 'roh', C: 'Formel', D: '12', E: '1' },
      },
      { row: 7, cells: { AA: 'LF 2' } },
    ]);
  });

  it('skips cells without a readable reference and shared indexes out of range', () => {
    const xml =
      '<worksheet><sheetData><row r="1"><c t="s"><v>0</v></c>' +
      '<c r="B1" t="s"><v>9</v></c><c r="C1" t="s"><v>abc</v></c></row></sheetData></worksheet>';
    expect(parseSheetXml(xml, shared)).toEqual([]);
  });

  it('numbers rows without an r attribute one after the other', () => {
    const xml =
      '<worksheet><sheetData><row><c r="A1" t="s"><v>0</v></c></row><row><c t="s"><v>1</v></c></row></sheetData></worksheet>';
    expect(parseSheetXml(xml, shared)).toEqual([
      { row: 1, cells: { A: 'Titel' } },
    ]);
  });

  it('keeps row numbers within the sheet limits', () => {
    const xml =
      '<worksheet><sheetData>' +
      '<row r="9999999999"><c r="A1" t="s"><v>0</v></c></row>' +
      '<row r="2000000"><c r="A1" t="s"><v>1</v></c></row>' +
      '</sheetData></worksheet>';
    expect(parseSheetXml(xml, shared).map(r => r.row)).toEqual([1, 2]);
  });

  it('stops at the cell limit', () => {
    const cells = Array.from(
      { length: 50 },
      (_v, i) => `<c r="A${i + 1}" t="inlineStr"><is><t>x</t></is></c>`
    ).join('');
    const xml = `<worksheet><sheetData><row r="1">${cells}</row></sheetData></worksheet>`;
    expect(() => parseSheetXml(xml, [], { maxCells: 10 })).toThrow(
      /more than 10 cells/
    );
  });
});

describe('readXlsxRows', () => {
  it('reads the first sheet of a workbook with its row numbers', async () => {
    const data = await makeXlsx([
      {
        name: 'Tabelle1',
        rows: [
          { row: 2, cells: { B: 'Überschrift' } },
          { row: 4, cells: { A: 'Komponente', C: 'Schuljahr 1' } },
          { row: 5, cells: { A: 'Zeile\r\nzwei', C: { inline: 'LF 2,3' } } },
        ],
      },
      { name: 'Zweites', rows: [{ row: 1, cells: { A: 'andere' } }] },
    ]);
    const result = await readXlsxRows(data);
    expect(result.sheetName).toBe('Tabelle1');
    expect(result.rows).toEqual([
      { row: 2, cells: { B: 'Überschrift' } },
      { row: 4, cells: { A: 'Komponente', C: 'Schuljahr 1' } },
      { row: 5, cells: { A: 'Zeile\r\nzwei', C: 'LF 2,3' } },
    ]);
  });

  it('picks a sheet by name and follows an absolute target', async () => {
    const data = await makeXlsx(
      [
        { name: 'Eins', rows: [{ row: 1, cells: { A: 'a' } }] },
        { name: 'Zwei', rows: [{ row: 1, cells: { A: 'b' } }] },
      ],
      { absoluteTargets: true }
    );
    expect((await readXlsxRows(data, { sheet: 'Zwei' })).rows[0].cells.A).toBe(
      'b'
    );
    await expect(readXlsxRows(data, { sheet: 'Drei' })).rejects.toThrow(
      /sheet "Drei" does not exist/
    );
  });

  it('keeps control characters of the cell text and reads rich text and inline strings only files', async () => {
    const data = await makeXlsx(
      [
        {
          name: 'T',
          rows: [
            { row: 1, cells: { A: 'LF\u0002 2', B: { inline: 'x\u0002y' } } },
          ],
        },
      ],
      { richText: true }
    );
    const { rows } = await readXlsxRows(data);
    expect(rows[0].cells).toEqual({ A: 'LF\u0002 2', B: 'x\u0002y' });

    const noShared = await makeXlsx(
      [
        {
          name: 'T',
          rows: [{ row: 1, cells: { A: { inline: 'nur inline' } } }],
        },
      ],
      { noSharedStrings: true }
    );
    expect((await readXlsxRows(noShared)).rows[0].cells.A).toBe('nur inline');
  });

  it('refuses data that is not a workbook', async () => {
    await expect(readXlsxRows(Buffer.from('kein zip'))).rejects.toThrow();
    const zip = new JSZip();
    zip.file('foo.txt', 'x');
    const plain = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(readXlsxRows(plain)).rejects.toThrow(/Not a workbook/);
  });

  it('refuses a workbook whose sheet file is missing', async () => {
    const zip = new JSZip();
    zip.file(
      'xl/workbook.xml',
      '<workbook xmlns:r="x"><sheets><sheet name="T" sheetId="1" r:id="rId1"/></sheets></workbook>'
    );
    zip.file(
      'xl/_rels/workbook.xml.rels',
      '<Relationships><Relationship Id="rId1" Target="worksheets/sheet1.xml"/></Relationships>'
    );
    const data = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(readXlsxRows(data)).rejects.toThrow(/sheet1\.xml is missing/);
  });

  it('refuses a workbook without sheets and a relationship that is missing', async () => {
    const noSheets = new JSZip();
    noSheets.file('xl/workbook.xml', '<workbook><sheets></sheets></workbook>');
    await expect(
      readXlsxRows(await noSheets.generateAsync({ type: 'nodebuffer' }))
    ).rejects.toThrow(/no sheet/);

    const noRel = new JSZip();
    noRel.file(
      'xl/workbook.xml',
      '<workbook xmlns:r="x"><sheets><sheet name="T" sheetId="1" r:id="rId9"/></sheets></workbook>'
    );
    noRel.file('xl/_rels/workbook.xml.rels', '<Relationships></Relationships>');
    await expect(
      readXlsxRows(await noRel.generateAsync({ type: 'nodebuffer' }))
    ).rejects.toThrow(/relationship rId9/);
  });

  it('enforces the limits of input, entries and unpacked size', async () => {
    const data = await makeXlsx([
      { name: 'T', rows: [{ row: 1, cells: { A: 'a' } }] },
    ]);
    await expect(readXlsxRows(data, { maxInputBytes: 10 })).rejects.toThrow(
      /larger than 10 bytes/
    );
    await expect(readXlsxRows(data, { maxEntries: 1 })).rejects.toThrow(
      /more than 1 entries/
    );
    await expect(readXlsxRows(data, { maxXmlBytes: 20 })).rejects.toThrow(
      /larger than 20 bytes/
    );
  });
});
