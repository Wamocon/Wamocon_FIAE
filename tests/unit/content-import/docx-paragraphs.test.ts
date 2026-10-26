/**
 * @jest-environment node
 */
// The helper reads paragraphs, bold marks and image counts from a .docx. The
// test builds small invented documents with JSZip, no original file is used.
import JSZip from 'jszip';
import {
  extractDocxParagraphs,
  extractDocxStats,
} from '@/lib/content-import/docx-paragraphs';

const run = (text: string, bold = false) =>
  `<w:r>${bold ? '<w:rPr><w:b/></w:rPr>' : ''}<w:t xml:space="preserve">${text}</w:t></w:r>`;
const para = (...runs: string[]) =>
  `<w:p><w:pPr></w:pPr>${runs.join('')}</w:p>`;

async function docx(
  body: string,
  extra: Record<string, string> = {}
): Promise<Buffer> {
  const zip = new JSZip();
  zip.file(
    'word/document.xml',
    `<?xml version="1.0" encoding="UTF-8"?><w:document xmlns:w="x"><w:body>${body}</w:body></w:document>`
  );
  for (const [name, content] of Object.entries(extra)) zip.file(name, content);
  return zip.generateAsync({ type: 'nodebuffer' });
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
