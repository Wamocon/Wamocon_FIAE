/**
 * @jest-environment node
 */
// The helper reads paragraphs, bold marks and image counts from a .docx. The
// test builds small invented documents with JSZip, no original file is used.
import { afterEach, jest } from '@jest/globals';
import JSZip from 'jszip';
import {
  extractDocxParagraphs,
  extractDocxStats,
  hiddenStyleIds,
  parseDocumentXml,
  readZipDirectory,
} from '@/lib/content-import/docx-paragraphs';

const run = (text: string, bold = false) =>
  `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (...runs: string[]) =>
  `<w:p><w:pPr></w:pPr>${runs.join('')}</w:p>`;

async function docx(
  body: string,
  extra: Record<string, string> = {},
  compression: 'STORE' | 'DEFLATE' = 'STORE'
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`
  );
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer', compression });
}

describe('extractDocxParagraphs', () => {
  it('joins runs, marks all-bold paragraphs and decodes entities', async () => {
    const buffer = await docx(
      [
        para(run('Quiz, Schwierigkeitsgrad: leicht', true)),
        para(run('Das System '), run('macOS')),
        para(run('Richtige ', true), run('Antwort: B', true)),
        para(run('Gemischt ', true), run('nicht fett')),
        para(run('Tom &amp; Jerry &lt;3 &#252;&#x00E4;')),
        para(),
      ].join('')
    );
    const paragraphs = await extractDocxParagraphs(buffer);
    expect(paragraphs).toEqual([
      { text: 'Quiz, Schwierigkeitsgrad: leicht', bold: true },
      { text: 'Das System macOS', bold: false },
      { text: 'Richtige Antwort: B', bold: true },
      { text: 'Gemischt nicht fett', bold: false },
      { text: 'Tom & Jerry <3 üä', bold: false },
      { text: '', bold: false },
    ]);
  });

  it('treats a bold run that is switched off as not bold, and reads tabs and breaks', async () => {
    const buffer = await docx(
      para(
        '<w:r><w:rPr><w:b w:val="0"/></w:rPr><w:t>aus</w:t></w:r>',
        '<w:r><w:tab/><w:t>x</w:t><w:br/><w:t>y</w:t></w:r>'
      )
    );
    expect(await extractDocxParagraphs(buffer)).toEqual([
      { text: 'aus\tx\ny', bold: false },
    ]);
  });

  it('marks the paragraphs of table cells with a row and a cell number', async () => {
    const cell = (...paragraphs: string[]) =>
      `<w:tc><w:tcPr><w:tcW w:w="1"/></w:tcPr>${paragraphs.join('')}</w:tc>`;
    const row = (...cells: string[]) => `<w:tr>${cells.join('')}</w:tr>`;
    const table = (...rows: string[]) =>
      `<w:tbl><w:tblPr></w:tblPr>${rows.join('')}</w:tbl>`;
    const buffer = await docx(
      [
        para(run('vor der Tabelle')),
        table(
          row(
            cell(para(run('A1', true))),
            cell(para(run('B1')), para(run('B1 zweite Zeile')))
          ),
          row(cell(para(run('A2'))), cell(para(run('B2'))))
        ),
        para(run('nach der Tabelle')),
        table(row(cell(para(run('C1'))))),
      ].join('')
    );
    const paragraphs = await extractDocxParagraphs(buffer);
    expect(paragraphs.map(p => [p.text, p.row, p.cell])).toEqual([
      ['vor der Tabelle', undefined, undefined],
      ['A1', 1, 1],
      ['B1', 1, 2],
      ['B1 zweite Zeile', 1, 2],
      ['A2', 2, 3],
      ['B2', 2, 4],
      ['nach der Tabelle', undefined, undefined],
      ['C1', 3, 5],
    ]);
    // A paragraph outside a table has no row key at all.
    expect('row' in paragraphs[0]).toBe(false);
  });

  it('gives a nested table its own rows and returns to the outer row', async () => {
    const inner =
      '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>innen</w:t></w:r></w:p></w:tc></w:tr></w:tbl>';
    const buffer = await docx(
      `<w:tbl><w:tr><w:tc><w:p><w:r><w:t>außen eins</w:t></w:r></w:p>${inner}<w:p><w:r><w:t>außen zwei</w:t></w:r></w:p></w:tc></w:tr></w:tbl>`
    );
    const paragraphs = await extractDocxParagraphs(buffer);
    expect(paragraphs.map(p => [p.text, p.row, p.cell])).toEqual([
      ['außen eins', 1, 1],
      ['innen', 2, 2],
      ['außen zwei', 1, 1],
    ]);
  });

  it('ignores a damaged table (cell or row closed twice)', async () => {
    const buffer = await docx(
      '</w:tc></w:tr><w:p><w:r><w:t>text</w:t></w:r></w:p>'
    );
    expect(await extractDocxParagraphs(buffer)).toEqual([
      { text: 'text', bold: false },
    ]);
  });

  it('does not take paragraph properties for text', async () => {
    const buffer = await docx(
      '<w:p><w:pPr><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>nur Text</w:t></w:r></w:p>'
    );
    expect(await extractDocxParagraphs(buffer)).toEqual([
      { text: 'nur Text', bold: false },
    ]);
  });

  it('fails with a clear message for a file that is not a docx', async () => {
    await expect(
      extractDocxParagraphs(Buffer.from('kein zip'))
    ).rejects.toThrow();
    const zip = new JSZip();
    zip.file('anderes.txt', 'x');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(extractDocxParagraphs(buffer)).rejects.toThrow(
      /word\/document\.xml/
    );
  });
});

describe('extractDocxStats', () => {
  it('counts characters, paragraphs, images and the first heading', async () => {
    const buffer = await docx(
      [
        para(run('Titel des Enablers', true)),
        para(run('Ein Text.')),
        para(),
      ].join(''),
      { 'word/media/image1.png': 'x', 'word/media/image2.jpeg': 'y' }
    );
    expect(await extractDocxStats(buffer)).toEqual({
      heading: 'Titel des Enablers',
      characters: 'Titel des Enablers'.length + 'Ein Text.'.length,
      paragraphs: 3,
      images: 2,
    });
  });

  it('returns a null heading for an empty document', async () => {
    const stats = await extractDocxStats(await docx(''));
    expect(stats).toEqual({
      heading: null,
      characters: 0,
      paragraphs: 0,
      images: 0,
    });
  });
});

describe('extractDocxParagraphs: hardening', () => {
  it('keeps non breaking hyphens and drops soft hyphens', async () => {
    const buffer = await docx(
      para(
        '<w:r><w:t>IT</w:t><w:noBreakHyphen/><w:t>Sicherheit</w:t></w:r>',
        '<w:r><w:t>Be</w:t><w:softHyphen/><w:t>trieb</w:t></w:r>'
      )
    );
    expect(await extractDocxParagraphs(buffer)).toEqual([
      { text: 'IT-SicherheitBetrieb', bold: false },
    ]);
  });

  it('reads the choice of an AlternateContent once and keeps the text after it', async () => {
    const box = (text: string) =>
      `<w:txbxContent>${para(run(text))}</w:txbxContent>`;
    const body =
      `<w:p><w:r><w:t>Davor</w:t></w:r>` +
      `<mc:AlternateContent><mc:Choice>${box('Kasten')}</mc:Choice>` +
      `<mc:Fallback>${box('Kasten')}</mc:Fallback></mc:AlternateContent>` +
      `<w:r><w:t>Danach</w:t></w:r></w:p>` +
      para(run('Naechster Absatz'));
    expect(await extractDocxParagraphs(await docx(body))).toEqual([
      { text: 'DavorDanach', bold: false },
      { text: 'Naechster Absatz', bold: false },
    ]);
  });

  it('ignores deleted and moved text and revision history of the formatting', async () => {
    const body = para(
      '<w:r><w:t>bleibt</w:t></w:r>',
      '<w:del><w:r><w:delText>weg</w:delText></w:r></w:del>',
      '<w:moveFrom><w:r><w:t>verschoben</w:t></w:r></w:moveFrom>',
      '<w:r><w:rPr><w:rPrChange><w:rPr><w:b/></w:rPr></w:rPrChange></w:rPr><w:t> fett?</w:t></w:r>'
    );
    expect(await extractDocxParagraphs(await docx(body))).toEqual([
      { text: 'bleibt fett?', bold: false },
    ]);
  });

  it('works in linear time on hostile xml with unclosed tags', async () => {
    const hostile = '<w:p><w:r><w:t>'.repeat(60000);
    const started = Date.now();
    await extractDocxParagraphs(await docx(hostile));
    expect(Date.now() - started).toBeLessThan(3000);
    const noClose = '<'.repeat(500000);
    const started2 = Date.now();
    await extractDocxParagraphs(await docx(noClose));
    expect(Date.now() - started2).toBeLessThan(3000);
  });

  it('refuses a document.xml that is larger than the limit (zip bomb)', async () => {
    const buffer = await docx(para(run('x'.repeat(5000))));
    await expect(
      extractDocxParagraphs(buffer, { maxXmlBytes: 1000 })
    ).rejects.toThrow(/larger than/);
    await expect(
      extractDocxStats(buffer, { maxXmlBytes: 1000 })
    ).rejects.toThrow(/larger than/);
    const ok = await extractDocxParagraphs(buffer, { maxXmlBytes: 100000 });
    expect(ok[0].text).toHaveLength(5000);
  });

  it('refuses a zip with too many entries and an input that is too large', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document/>');
    for (let i = 0; i < 30; i += 1) zip.file(`word/media/i${i}.png`, 'x');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    await expect(
      extractDocxParagraphs(buffer, { maxEntries: 10 })
    ).rejects.toThrow(/entries/);
    await expect(
      extractDocxParagraphs(buffer, { maxInputBytes: 10 })
    ).rejects.toThrow(/larger than/);
  });
});

describe('extractDocxParagraphs: limits before the zip is opened', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('counts the entries from the zip directory before JSZip opens the file', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document/>');
    for (let i = 0; i < 40; i += 1) zip.file(`word/media/i${i}.png`, 'x');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const load = jest.spyOn(JSZip, 'loadAsync');
    await expect(
      extractDocxParagraphs(buffer, { maxEntries: 10 })
    ).rejects.toMatchObject({ code: 'TOO_MANY_ENTRIES' });
    expect(load).not.toHaveBeenCalled();
    // Within the limit the file is opened as before.
    await extractDocxParagraphs(buffer, { maxEntries: 100 });
    expect(load).toHaveBeenCalledTimes(1);
  });

  it('refuses a declared unpacked size above the limit before JSZip opens the file', async () => {
    const buffer = await docx(para(run('x'.repeat(200000))), {}, 'DEFLATE');
    expect(buffer.length).toBeLessThan(5000);
    const load = jest.spyOn(JSZip, 'loadAsync');
    await expect(
      extractDocxParagraphs(buffer, { maxXmlBytes: 50000 })
    ).rejects.toMatchObject({ code: 'XML_TOO_LARGE' });
    expect(load).not.toHaveBeenCalled();
  });

  it('stops a zip bomb that lies about its size while reading', async () => {
    const buffer = await docx(para(run('x'.repeat(200000))));
    // Lie in the central directory: the declared size becomes small. JSZip
    // then fails on the mismatch or the cap stops the unpacking, either way
    // the text is never returned.
    const directory = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    const lying = Buffer.from(buffer);
    lying.writeUInt32LE(10, directory + 24);
    await expect(
      extractDocxParagraphs(lying, { maxXmlBytes: 50000 })
    ).rejects.toThrow();
  });

  it('reads the entries of a zip with a long comment and refuses damaged directories', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document/>');
    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      comment: 'c'.repeat(60000),
    });
    expect(
      readZipDirectory(buffer, 10)
        .entries.filter(e => !e.dir)
        .map(e => e.name)
    ).toEqual(['word/document.xml']);
    expect(() => readZipDirectory(Buffer.from('kein zip'), 10)).toThrow(/zip/i);
    expect(() => readZipDirectory(Buffer.alloc(0), 10)).toThrow(/zip/i);
    // The end record claims a directory that lies outside of the file.
    const broken = Buffer.from(buffer);
    const end = broken.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    broken.writeUInt32LE(0x7fffffff, end + 16);
    expect(() => readZipDirectory(broken, 10)).toThrow(/damaged/);
    // A directory entry cut short.
    const cut = Buffer.from(buffer);
    const first = cut.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    cut.writeUInt16LE(60000, first + 28);
    expect(() => readZipDirectory(cut, 10)).toThrow(/damaged/);
  });

  it('reports encrypted entries, directories and the sizes of the entries', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', 'abc');
    zip.folder('word/media');
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });
    const entries = readZipDirectory(buffer, 10).entries;
    expect(entries.find(e => e.name === 'word/document.xml')).toMatchObject({
      size: 3,
      dir: false,
      encrypted: false,
    });
    expect(entries.find(e => e.name === 'word/media/')?.dir).toBe(true);
    const flagged = Buffer.from(buffer);
    const at = flagged.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    flagged.writeUInt16LE(flagged.readUInt16LE(at + 8) | 1, at + 8);
    expect(readZipDirectory(flagged, 10).entries.some(e => e.encrypted)).toBe(
      true
    );
  });

  it('reads zip64 end records and zip64 sizes', () => {
    const name = Buffer.from('word/document.xml');
    const localHeader = Buffer.alloc(30);
    localHeader.writeUInt32LE(0x04034b50, 0);
    localHeader.writeUInt16LE(name.length, 26);
    const local = Buffer.concat([localHeader, name]);
    const extra = Buffer.alloc(20);
    extra.writeUInt16LE(1, 0);
    extra.writeUInt16LE(16, 2);
    extra.writeBigUInt64LE(BigInt(5000), 4);
    extra.writeBigUInt64LE(BigInt(7), 12);
    const central = Buffer.alloc(46);
    central.writeUInt32LE(0x02014b50, 0);
    central.writeUInt32LE(0xffffffff, 20);
    central.writeUInt32LE(0xffffffff, 24);
    central.writeUInt16LE(name.length, 28);
    central.writeUInt16LE(extra.length, 30);
    const directory = Buffer.concat([central, name, extra]);
    const offset = local.length;
    const zip64End = Buffer.alloc(56);
    zip64End.writeUInt32LE(0x06064b50, 0);
    zip64End.writeBigUInt64LE(BigInt(1), 32);
    zip64End.writeBigUInt64LE(BigInt(directory.length), 40);
    zip64End.writeBigUInt64LE(BigInt(offset), 48);
    const locator = Buffer.alloc(20);
    locator.writeUInt32LE(0x07064b50, 0);
    locator.writeBigUInt64LE(BigInt(offset + directory.length), 8);
    const end = Buffer.alloc(22);
    end.writeUInt32LE(0x06054b50, 0);
    end.writeUInt16LE(0xffff, 10);
    end.writeUInt32LE(0xffffffff, 16);
    const buffer = Buffer.concat([local, directory, zip64End, locator, end]);
    const { entries } = readZipDirectory(buffer, 10);
    expect(entries).toEqual([
      expect.objectContaining({
        name: 'word/document.xml',
        size: 5000,
        compressedSize: 7,
      }),
    ]);
    expect(() => readZipDirectory(buffer, 0)).toThrow(/entries/);
    // A zip64 locator that points nowhere.
    const lost = Buffer.from(buffer);
    lost.writeBigUInt64LE(BigInt(999999), lost.length - 22 - 12);
    expect(() => readZipDirectory(lost, 10)).toThrow(/damaged/);
  });
});

describe('readZipDirectory: one directory for every reader', () => {
  const SIG = (a: number, b: number) => Buffer.from([0x50, 0x4b, a, b]);

  async function zipOf(names: string[]) {
    const zip = new JSZip();
    for (const name of names) zip.file(name, 'x', { createFolders: false });
    return zip.generateAsync({ type: 'nodebuffer' });
  }

  it('refuses a file whose last end record does not reach the end (a zip inside the comment)', async () => {
    const outer = Buffer.from(await zipOf(['word/document.xml']));
    const inner = await zipOf(['word/document.xml', 'word/vbaProject.bin']);
    const end = outer.lastIndexOf(SIG(5, 6));
    outer.writeUInt16LE(inner.length + 1, end + 20);
    const confusing = Buffer.concat([outer, inner, Buffer.from([0])]);
    expect(() => readZipDirectory(confusing, 10)).toThrow(
      expect.objectContaining({ code: 'ZIP_DAMAGED' })
    );
    // JSZip would open the inner zip: that is what the check must prevent
    expect(Object.keys((await JSZip.loadAsync(confusing)).files)).toContain(
      'word/vbaProject.bin'
    );
  });

  it('refuses a directory that holds more records than the end record counts', async () => {
    const bytes = Buffer.from(
      await zipOf(['word/document.xml', 'a.xml', 'b.xml', 'c.xml', 'd.xml'])
    );
    const end = bytes.lastIndexOf(SIG(5, 6));
    bytes.writeUInt16LE(2, end + 10);
    expect(() => readZipDirectory(bytes, 10)).toThrow(
      expect.objectContaining({ code: 'ZIP_DAMAGED' })
    );
  });

  it('refuses an entry whose local header names another file than the directory', async () => {
    const bytes = Buffer.from(await zipOf(['word/document.xml', 'other.xml']));
    const central = bytes.indexOf(SIG(1, 2));
    bytes.write('word/documentXxml', central + 46, 'latin1');
    expect(() => readZipDirectory(bytes, 10)).toThrow(
      expect.objectContaining({ code: 'ZIP_DAMAGED' })
    );
  });

  it('refuses a document whose opened entries differ from the directory', async () => {
    const bytes = await docx(para(run('x')));
    const spy = jest
      .spyOn(JSZip, 'loadAsync')
      .mockResolvedValueOnce(
        (await JSZip.loadAsync(bytes)).file('extra.xml', 'x') as never
      );
    await expect(extractDocxParagraphs(bytes)).rejects.toMatchObject({
      code: 'ZIP_DAMAGED',
    });
    spy.mockRestore();
  });

  it('takes an explicit undefined limit for the default one', async () => {
    const bytes = await docx(para(run('x'.repeat(100))));
    await expect(
      extractDocxParagraphs(bytes, { maxXmlBytes: undefined })
    ).resolves.toHaveLength(1);
  });
});

describe('hiddenStyleIds: cost and spelling', () => {
  it('works through a very long chain of styles in linear time', () => {
    const count = 30000;
    let xml = '<w:styles xmlns:w="x">';
    for (let i = 0; i < count; i += 1) {
      xml += `<w:style w:styleId="s${i}"><w:basedOn w:val="s${i + 1}"/></w:style>`;
    }
    xml += `<w:style w:styleId="s${count}"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>`;
    const started = Date.now();
    const hidden = hiddenStyleIds(xml);
    expect(Date.now() - started).toBeLessThan(2000);
    // the chain is longer than the depth that is followed: not hidden
    expect(hidden.has('s0')).toBe(false);
  });

  it('follows a chain of moderate depth and reads single quoted attributes', () => {
    const xml =
      "<w:styles xmlns:w='x'><w:style w:styleId='A'><w:rPr><w:vanish/></w:rPr></w:style>" +
      "<w:style w:styleId='B'><w:basedOn w:val='A'/></w:style>" +
      "<w:style w:styleId='C'><w:basedOn w:val='B'/><w:rPr><w:vanish w:val='0'/></w:rPr></w:style></w:styles>";
    expect([...hiddenStyleIds(xml)].sort()).toEqual(['A', 'B']);
  });

  it('reads at most a fixed number of styles', () => {
    let xml = '<w:styles xmlns:w="x">';
    for (let i = 0; i < 20000; i += 1) {
      xml += `<w:style w:styleId="s${i}"><w:rPr><w:vanish/></w:rPr></w:style>`;
    }
    expect(hiddenStyleIds(xml).size).toBe(5000);
  });
});

describe('extractDocxParagraphs: hidden text', () => {
  const hidden = '<w:rPr><w:vanish/></w:rPr>';
  const styles = (body: string) => `<w:styles xmlns:w="x">${body}</w:styles>`;
  const style = (id: string, props: string, basedOn?: string) =>
    `<w:style w:type="character" w:styleId="${id}">${
      basedOn ? `<w:basedOn w:val="${basedOn}"/>` : ''
    }<w:rPr>${props}</w:rPr></w:style>`;

  it('skips runs that are hidden and keeps runs where hiding is switched off', async () => {
    const buffer = await docx(
      para(
        run('sichtbar '),
        `<w:r>${hidden}<w:t>GEHEIM</w:t><w:tab/><w:br/></w:r>`,
        '<w:r><w:rPr><w:vanish w:val="0"/></w:rPr><w:t>an</w:t></w:r>',
        '<w:r><w:rPr><w:vanish w:val="false"/></w:rPr><w:t>aus</w:t></w:r>',
        '<w:r><w:rPr><w:vanish w:val="1"/></w:rPr><w:t>EINS</w:t></w:r>',
        '<w:r><w:rPr><w:vanish w:val="true"/></w:rPr><w:t>WAHR</w:t></w:r>'
      )
    );
    expect(await extractDocxParagraphs(buffer)).toEqual([
      { text: 'sichtbar anaus', bold: false },
    ]);
  });

  it('does not count a hidden run for the bold mark of the paragraph', async () => {
    const buffer = await docx(
      para(
        run('Fett', true),
        '<w:r><w:rPr><w:vanish/></w:rPr><w:t>unfett</w:t></w:r>'
      )
    );
    expect(await extractDocxParagraphs(buffer)).toEqual([
      { text: 'Fett', bold: true },
    ]);
  });

  it('skips text that is hidden by a character style, a paragraph style or a style it is based on', async () => {
    const buffer = await docx(
      [
        para(
          '<w:r><w:rPr><w:rStyle w:val="Weg"/></w:rPr><w:t>ZEICHENFORMAT</w:t></w:r>',
          '<w:r><w:rPr><w:rStyle w:val="WegErbe"/></w:rPr><w:t>GEERBT</w:t></w:r>',
          '<w:r><w:rPr><w:rStyle w:val="Normal2"/></w:rPr><w:t>bleibt</w:t></w:r>',
          '<w:r><w:rPr><w:rStyle w:val="Weg"/><w:vanish w:val="0"/></w:rPr><w:t>doch</w:t></w:r>'
        ),
        '<w:p><w:pPr><w:pStyle w:val="Weg"/></w:pPr><w:r><w:t>ABSATZFORMAT</w:t></w:r></w:p>',
        '<w:p><w:pPr><w:pStyle w:val="Normal2"/></w:pPr><w:r><w:t>Absatz bleibt</w:t></w:r></w:p>',
      ].join(''),
      {
        'word/styles.xml': styles(
          style('Weg', '<w:vanish/>') +
            style('WegErbe', '', 'Weg') +
            style('Normal2', '<w:b/>') +
            '<w:style w:styleId="Leer"/>' +
            // A style that turns hiding off again, and a cycle.
            style('Zurueck', '<w:vanish w:val="0"/>', 'Weg') +
            style('A', '', 'B') +
            style('B', '', 'A')
        ),
      }
    );
    expect(await extractDocxParagraphs(buffer)).toEqual([
      { text: 'bleibtdoch', bold: false },
      { text: '', bold: false },
      { text: 'Absatz bleibt', bold: false },
    ]);
  });

  it('survives a damaged style sheet', async () => {
    const buffer = await docx(para(run('Text')), {
      'word/styles.xml': '<w:style w:styleId="x"><w:rPr><w:vanish/>',
    });
    expect(await extractDocxParagraphs(buffer)).toEqual([
      { text: 'Text', bold: false },
    ]);
  });

  it('finds the hidden styles of a style sheet', () => {
    expect(
      [
        ...hiddenStyleIds(
          styles(
            style('A', '<w:vanish/>') +
              style('B', '', 'A') +
              style('C', '<w:vanish w:val="off"/>', 'A') +
              '<w:style w:styleId="D"/>' +
              '<w:style w:styleId="E"><w:rPr><w:vanish/></w:rPr></w:style>'
          )
        ),
      ].sort()
    ).toEqual(['A', 'B', 'E']);
    expect(hiddenStyleIds('')).toEqual(new Set());
  });

  it('gives up above the number of paragraphs and above the number of characters', () => {
    const xml = para(run('abcde')).repeat(6);
    expect(parseDocumentXml(xml, { maxParagraphs: 6 })).toHaveLength(6);
    expect(() => parseDocumentXml(xml, { maxParagraphs: 5 })).toThrow(
      expect.objectContaining({ code: 'TOO_MANY_PARAGRAPHS' })
    );
    expect(parseDocumentXml(xml, { maxChars: 30 })).toHaveLength(6);
    expect(() => parseDocumentXml(xml, { maxChars: 29 })).toThrow(
      expect.objectContaining({ code: 'TEXT_TOO_LARGE' })
    );
  });

  it('leaves hidden text out of the stats too', async () => {
    const buffer = await docx(
      para(
        run('Titel', true),
        `<w:r>${hidden}<w:t>versteckter Zusatz</w:t></w:r>`
      )
    );
    expect(await extractDocxStats(buffer)).toMatchObject({
      heading: 'Titel',
      characters: 5,
    });
  });
});
