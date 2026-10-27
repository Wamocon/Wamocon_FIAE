/**
 * @jest-environment node
 */
// readDocx reads a Word file from its bytes and answers with a list of findings
// instead of stopping. The test builds invented files, among them the files of
// an attacker: zip bomb, many entries, macros, encryption, external links,
// entity tricks, deep nesting. No original file is used.
import { afterEach, describe, expect, it, jest } from '@jest/globals';
import JSZip from 'jszip';

import { extractDocxParagraphs } from '@/lib/content-import/docx-paragraphs';
import { readDocx } from '@/lib/content-upload/read-docx';

import {
  b,
  blocksToParagraphs,
  CANARY,
  CANARY_WORDS,
  CONTENT_TYPES,
  docxBytes,
  docxFromBlocks,
  enablerBlocks,
  para,
  quizBlocks,
  run,
  scenarioBlocks,
  t,
} from '../../helpers/uploadFixtures';

const codes = (result: { findings: Array<{ code: string }> }) =>
  result.findings.map(f => f.code);

afterEach(() => {
  jest.restoreAllMocks();
});

describe('readDocx: a normal file', () => {
  it('returns the paragraphs of a quiz and no finding that blocks', async () => {
    const blocks = quizBlocks();
    const result = await readDocx(await docxFromBlocks(blocks));
    expect(result.status).toBe('ok');
    expect(result.code).toBeNull();
    expect(result.paragraphs).toEqual(blocksToParagraphs(blocks));
    expect(result.findings.filter(f => f.severity === 'blocking')).toEqual([]);
    expect(result.stats).toMatchObject({
      paragraphs: blocks.length,
      images: 0,
    });
    expect(result.stats.characters).toBeGreaterThan(100);
  });

  it('counts the images and takes an ArrayBuffer as well', async () => {
    const bytes = await docxFromBlocks(enablerBlocks(), {
      parts: { 'word/media/image1.png': 'x', 'word/media/image2.png': 'y' },
    });
    const copy = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength
    );
    const result = await readDocx(copy as ArrayBuffer);
    expect(result.status).toBe('ok');
    expect(result.stats.images).toBe(2);
  });

  it('keeps findings free of the text of the document', async () => {
    const result = await readDocx(
      await docxFromBlocks(scenarioBlocks(), {
        parts: {
          'word/comments.xml': `<w:comments>${CANARY.knowledge}</w:comments>`,
        },
      })
    );
    expect(JSON.stringify(result.findings)).not.toMatch(
      new RegExp(CANARY_WORDS.join('|'))
    );
  });
});

describe('readDocx: preflight before the file is opened', () => {
  it('rejects a file with a macro project and never opens it', async () => {
    const load = jest.spyOn(JSZip, 'loadAsync');
    const result = await readDocx(
      await docxFromBlocks(quizBlocks(), {
        parts: { 'word/vbaProject.bin': 'binary' },
      })
    );
    expect(result).toMatchObject({
      status: 'rejected',
      code: 'MACRO_ENABLED',
      paragraphs: [],
    });
    expect(load).not.toHaveBeenCalled();
  });

  it('rejects other macro names in any case and the data part of a macro', async () => {
    for (const name of [
      'word/VBAPROJECT.BIN',
      'customUI/vbaData.xml',
      'x/y/vbaProject.bin',
    ]) {
      const result = await readDocx(
        await docxFromBlocks(quizBlocks(), { parts: { [name]: 'x' } })
      );
      expect(result.code).toBe('MACRO_ENABLED');
    }
  });

  it('rejects a macro enabled content type and a macro enabled template', async () => {
    for (const type of [
      'application/vnd.ms-word.document.macroEnabled.main+xml',
      'application/vnd.ms-word.template.macroEnabledTemplate.main+xml',
    ]) {
      const types = CONTENT_TYPES.replace(
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml',
        type
      );
      const result = await readDocx(
        await docxFromBlocks(quizBlocks(), {
          parts: { '[Content_Types].xml': types },
          noContentTypes: true,
        })
      );
      expect(result).toMatchObject({
        status: 'rejected',
        code: 'MACRO_ENABLED',
      });
    }
  });

  it('rejects ActiveX controls', async () => {
    const result = await readDocx(
      await docxFromBlocks(quizBlocks(), {
        parts: { 'word/activeX/activeX1.xml': '<ax/>' },
      })
    );
    expect(result).toMatchObject({ status: 'rejected', code: 'ACTIVE_X' });
  });

  it('rejects an encrypted Office file and a legacy Word file', async () => {
    const magic = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1]);
    const encrypted = Buffer.concat([
      magic,
      Buffer.alloc(600),
      Buffer.from('EncryptedPackage', 'utf16le'),
      Buffer.alloc(100),
    ]);
    expect(await readDocx(encrypted)).toMatchObject({
      status: 'rejected',
      code: 'ENCRYPTED',
    });
    const legacy = Buffer.concat([
      magic,
      Buffer.alloc(600),
      Buffer.from('WordDocument'),
    ]);
    expect(await readDocx(legacy)).toMatchObject({
      status: 'rejected',
      code: 'LEGACY_DOC',
    });
  });

  it('rejects a zip with an encrypted entry', async () => {
    const bytes = Buffer.from(await docxFromBlocks(quizBlocks()));
    const at = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt16LE(bytes.readUInt16LE(at + 8) | 1, at + 8);
    const result = await readDocx(bytes);
    expect(result).toMatchObject({ status: 'rejected', code: 'ENCRYPTED' });
  });

  it('rejects what is not a Word file', async () => {
    for (const bytes of [
      Buffer.from('kein zip'),
      Buffer.alloc(0),
      Buffer.from('%PDF-1.4\n'),
      Buffer.alloc(5000, 0x41),
    ]) {
      expect(await readDocx(bytes)).toMatchObject({
        status: 'rejected',
        code: 'NOT_A_DOCX',
        paragraphs: [],
      });
    }
    const zip = new JSZip();
    zip.file('anderes.txt', 'x');
    const noDocument = await zip.generateAsync({ type: 'nodebuffer' });
    expect(await readDocx(noDocument)).toMatchObject({
      status: 'rejected',
      code: 'NOT_A_DOCX',
    });
  });

  it('rejects a zip with a damaged directory', async () => {
    const bytes = Buffer.from(await docxFromBlocks(quizBlocks()));
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
    bytes.writeUInt32LE(0x7ffffff0, end + 16);
    expect(await readDocx(bytes)).toMatchObject({
      status: 'rejected',
      code: 'ZIP_DAMAGED',
    });
  });

  it('rejects an input above the size limit before anything is read', async () => {
    const load = jest.spyOn(JSZip, 'loadAsync');
    const bytes = await docxFromBlocks(quizBlocks());
    const result = await readDocx(bytes, { limits: { maxInputBytes: 100 } });
    expect(result).toMatchObject({ status: 'rejected', code: 'TOO_LARGE' });
    expect(load).not.toHaveBeenCalled();
  });

  it('rejects a zip with very many entries without opening it', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document/>');
    for (let i = 0; i < 2500; i += 1) zip.file(`word/media/i${i}.png`, '');
    const bytes = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
    const load = jest.spyOn(JSZip, 'loadAsync');
    expect(await readDocx(bytes)).toMatchObject({
      status: 'rejected',
      code: 'TOO_MANY_ENTRIES',
    });
    expect(load).not.toHaveBeenCalled();
  });

  it('rejects a zip bomb by the declared size of document.xml', async () => {
    const huge = para('a'.repeat(17 * 1024 * 1024));
    const bytes = await docxBytes(huge, { compression: 'DEFLATE' });
    expect(bytes.length).toBeLessThan(200 * 1024);
    const load = jest.spyOn(JSZip, 'loadAsync');
    expect(await readDocx(bytes)).toMatchObject({
      status: 'rejected',
      code: 'XML_TOO_LARGE',
      paragraphs: [],
    });
    expect(load).not.toHaveBeenCalled();
  });

  it('stops a zip bomb that declares a small size and returns no text', async () => {
    const bytes = Buffer.from(
      await docxBytes(para('x'.repeat(300000)), { compression: 'STORE' })
    );
    const directory = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    // the last entry of the directory is word/document.xml
    bytes.writeUInt32LE(10, directory + 24);
    const result = await readDocx(bytes, { limits: { maxXmlBytes: 100000 } });
    expect(result.status).toBe('failed');
    expect(result.code).toMatch(/XML_TOO_LARGE|PARSE_ERROR/);
    expect(result.paragraphs).toEqual([]);
  });

  it('stops a compressed zip bomb that declares a small size at the byte limit', async () => {
    const bytes = Buffer.from(
      await docxBytes(para('x'.repeat(2000000)), { compression: 'DEFLATE' })
    );
    const directory = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bytes.writeUInt32LE(10, directory + 24);
    const result = await readDocx(bytes, { limits: { maxXmlBytes: 100000 } });
    expect(result).toMatchObject({ status: 'failed', paragraphs: [] });
    expect(result.code).toMatch(/XML_TOO_LARGE|PARSE_ERROR/);
  });

  it('rejects two entries with the same name', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document><w:body/></w:document>');
    zip.file('word/documentXxml', '<w:document><w:body/></w:document>');
    const bytes = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    let from = bytes.indexOf('word/documentXxml');
    while (from >= 0) {
      bytes.write('word/document.xml', from, 'latin1');
      from = bytes.indexOf('word/documentXxml', from + 1);
    }
    expect(await readDocx(bytes)).toMatchObject({
      status: 'rejected',
      code: 'DUPLICATE_ENTRY',
    });
  });

  it('rejects entry names that climb out of the package', async () => {
    for (const name of ['../evil.xml', '/abs/evil.xml', 'word/../../x.xml']) {
      const zip = new JSZip();
      zip.file('word/document.xml', '<w:document><w:body/></w:document>');
      zip.file(name, 'x', { createFolders: false });
      const bytes = await zip.generateAsync({ type: 'nodebuffer' });
      expect((await readDocx(bytes)).code).toBe('UNSAFE_ENTRY_NAME');
    }
  });
});

describe('readDocx: links and objects', () => {
  const rel = (type: string, target: string, external = true) =>
    `<Relationships xmlns="x"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${target}"${
      external ? ' TargetMode="External"' : ''
    }/></Relationships>`;

  it('rejects an external template and never calls the address', async () => {
    const fetchSpy = jest.fn();
    const saved = global.fetch;
    global.fetch = fetchSpy as unknown as typeof fetch;
    try {
      const result = await readDocx(
        await docxFromBlocks(quizBlocks(), {
          parts: {
            'word/_rels/settings.xml.rels': rel(
              'attachedTemplate',
              'https://example.invalid/vorlage.dotm'
            ),
          },
        })
      );
      expect(result).toMatchObject({
        status: 'rejected',
        code: 'EXTERNAL_TEMPLATE',
      });
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      global.fetch = saved;
    }
  });

  it('reports other external targets without rejecting the file', async () => {
    const result = await readDocx(
      await docxFromBlocks(quizBlocks(), {
        parts: {
          'word/_rels/document.xml.rels':
            rel('hyperlink', 'https://example.invalid/a') +
            rel('oleObject', 'file:///c:/x.xls') +
            rel('image', 'media/a.png', false),
        },
      })
    );
    expect(result.status).toBe('ok');
    expect(codes(result)).toEqual(
      expect.arrayContaining(['EXTERNAL_LINK', 'EXTERNAL_REFERENCE'])
    );
    expect(
      result.findings.find(f => f.code === 'EXTERNAL_REFERENCE')?.severity
    ).toBe('warning');
    expect(JSON.stringify(result.findings)).not.toContain('example.invalid');
  });

  it('reports embedded objects, executables and documents as a warning', async () => {
    const result = await readDocx(
      await docxFromBlocks(quizBlocks(), {
        parts: {
          'word/embeddings/oleObject1.bin': 'x',
          'word/media/tool.exe': 'x',
        },
      })
    );
    expect(result.status).toBe('ok');
    expect(codes(result)).toEqual(
      expect.arrayContaining(['EMBEDDED_OBJECT', 'SUSPICIOUS_ENTRY'])
    );
  });

  it('flags comments, notes, headers, tracked changes, text boxes and hidden text', async () => {
    const body =
      para('Titel') +
      `<w:p><w:ins w:id="1"><w:r><w:t>neu</w:t></w:r></w:ins><w:del w:id="2"><w:r><w:delText>alt</w:delText></w:r></w:del></w:p>` +
      `<w:p><w:r><w:txbxContent><w:p><w:r><w:t>Kasten</w:t></w:r></w:p></w:txbxContent></w:r></w:p>` +
      para('weg', { hidden: true }) +
      '<w:p><w:altChunk r:id="rId9"/></w:p>';
    const result = await readDocx(
      await docxBytes(body, {
        parts: {
          'word/comments.xml': '<c/>',
          'word/footnotes.xml': '<c/>',
          'word/header1.xml': '<c/>',
          'word/footer2.xml': '<c/>',
        },
      })
    );
    expect(result.status).toBe('ok');
    expect(codes(result)).toEqual(
      expect.arrayContaining([
        'COMMENTS',
        'NOTES',
        'HEADER_FOOTER',
        'TRACKED_CHANGES',
        'TEXT_BOXES',
        'HIDDEN_TEXT',
        'EMBEDDED_DOCUMENT',
      ])
    );
  });
});

describe('readDocx: text that must stay out', () => {
  it('does not return hidden text, text boxes, comments, headers or notes', async () => {
    const body =
      para('Vorn sichtbar') +
      para(CANARY.scenarioSolution, { hidden: true }) +
      `<w:p><w:r><w:txbxContent><w:p><w:r><w:t>${CANARY.knowledge}</w:t></w:r></w:p></w:txbxContent></w:r></w:p>` +
      `<mc:AlternateContent><mc:Fallback><w:p><w:r><w:t>${CANARY.useCaseSolution}</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>` +
      `<w:p><w:del><w:r><w:delText>${CANARY.criteria}</w:delText></w:r></w:del></w:p>`;
    const result = await readDocx(
      await docxBytes(body, {
        parts: {
          'word/comments.xml': `<w:comments><w:p><w:r><w:t>${CANARY.correct}</w:t></w:r></w:p></w:comments>`,
          'word/header1.xml': `<w:hdr><w:p><w:r><w:t>${CANARY.rationale}</w:t></w:r></w:p></w:hdr>`,
          'word/footer1.xml': `<w:ftr><w:p><w:r><w:t>${CANARY.correct}</w:t></w:r></w:p></w:ftr>`,
          'word/footnotes.xml': `<w:footnotes><w:p><w:r><w:t>${CANARY.rationale}</w:t></w:r></w:p></w:footnotes>`,
        },
      })
    );
    const all = JSON.stringify(result.paragraphs);
    for (const word of CANARY_WORDS) expect(all).not.toContain(word);
    expect(result.paragraphs.map(p => p.text)).toContain('Vorn sichtbar');
  });

  it('does not return text hidden through a style', async () => {
    const styles =
      '<w:styles xmlns:w="x"><w:style w:type="character" w:styleId="Weg"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>';
    const body =
      para('sichtbar') +
      `<w:p><w:r><w:rPr><w:rStyle w:val="Weg"/></w:rPr><w:t>${CANARY.correct}</w:t></w:r></w:p>`;
    const result = await readDocx(
      await docxBytes(body, { parts: { 'word/styles.xml': styles } })
    );
    expect(result.status).toBe('ok');
    expect(result.paragraphs.map(p => p.text)).toContain('sichtbar');
    expect(JSON.stringify(result.paragraphs)).not.toContain('QUOKKA');
  });
});

describe('readDocx: what the zip directory and the opened file must agree on', () => {
  it('rejects a file that hides a second zip behind the first end record', async () => {
    const outer = Buffer.from(await docxFromBlocks(quizBlocks()));
    const inner = await docxFromBlocks(quizBlocks(), {
      parts: { 'word/vbaProject.bin': 'binary' },
    });
    const end = outer.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
    outer.writeUInt16LE(inner.length + 1, end + 20);
    const confusing = Buffer.concat([outer, inner, Buffer.from([0])]);
    expect(await readDocx(confusing)).toMatchObject({
      status: 'rejected',
      code: 'ZIP_DAMAGED',
      paragraphs: [],
    });
  });

  it('rejects a directory with more records than the end record counts', async () => {
    const zip = new JSZip();
    zip.file('word/document.xml', '<w:document/>');
    for (let i = 0; i < 6; i += 1) zip.file(`word/media/i${i}.png`, 'x');
    const bytes = Buffer.from(await zip.generateAsync({ type: 'nodebuffer' }));
    const end = bytes.lastIndexOf(Buffer.from([0x50, 0x4b, 5, 6]));
    bytes.writeUInt16LE(2, end + 10);
    expect((await readDocx(bytes)).code).toBe('ZIP_DAMAGED');
  });

  it('reports a part that is too large when it is unpacked as failed', async () => {
    const styles = `<w:styles xmlns:w="x">${' '.repeat(5 * 1024 * 1024)}</w:styles>`;
    const result = await readDocx(
      await docxFromBlocks(quizBlocks(), {
        parts: { 'word/styles.xml': styles },
        compression: 'DEFLATE',
      })
    );
    expect(result).toMatchObject({ status: 'failed', code: 'PART_TOO_LARGE' });
  });
});

describe('readDocx: relationships in every spelling', () => {
  const relation = (type: string, target: string, spacing = ' ') =>
    `<Relationship${spacing}Id="rId1"${spacing}Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}"${spacing}Target='${target}'${spacing}TargetMode="External"/>`;

  it('finds an external template whatever the white space and the quotes', async () => {
    for (const rels of [
      `<Relationships xmlns="x">${relation('attachedTemplate', 'https://example.invalid/t.dotm', '\t')}</Relationships>`,
      `<Relationships xmlns="x">${relation('attachedTemplate', 'https://example.invalid/t.dotm', '\n')}</Relationships>`,
      // a bracket inside a quoted value, TargetMode behind it
      `<Relationships xmlns="x"><Relationship Id="a>b" Type="http://x/relationships/attachedTemplate" Target="https://example.invalid/t.dotm" TargetMode="External"/></Relationships>`,
    ]) {
      const result = await readDocx(
        await docxFromBlocks(quizBlocks(), {
          parts: { 'word/_rels/settings.xml.rels': rels },
        })
      );
      expect(result).toMatchObject({
        status: 'rejected',
        code: 'EXTERNAL_TEMPLATE',
      });
    }
  });

  it('rejects a file with more relationship parts than a Word file has', async () => {
    const parts: Record<string, string> = {};
    for (let i = 0; i < 60; i += 1) {
      parts[`word/_rels/part${i}.xml.rels`] = '<Relationships xmlns="x"/>';
    }
    const result = await readDocx(
      await docxFromBlocks(quizBlocks(), { parts })
    );
    expect(result).toMatchObject({
      status: 'rejected',
      code: 'TOO_MANY_RELATIONSHIP_FILES',
    });
  });
});

describe('readDocx: hostile xml', () => {
  it('does not expand entities (billion laughs and external entities)', async () => {
    const doctype =
      '<!DOCTYPE lolz [<!ENTITY lol "lol"><!ENTITY lol1 "&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;&lol;"><!ENTITY lol2 "&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;&lol1;"><!ENTITY xxe SYSTEM "file:///etc/passwd">]>';
    const xml = `<?xml version="1.0"?>${doctype}<w:document xmlns:w="x"><w:body><w:p><w:r><w:t>&lol2;&xxe;&#0;&#x110000;&amp;ok</w:t></w:r></w:p></w:body></w:document>`;
    const zip = new JSZip();
    zip.file('[Content_Types].xml', CONTENT_TYPES);
    zip.file('word/document.xml', xml);
    const started = Date.now();
    const bytes = await zip.generateAsync({ type: 'nodebuffer' });
    const result = await readDocx(bytes);
    expect(Date.now() - started).toBeLessThan(2000);
    // a DOCTYPE is refused outright
    expect(result).toMatchObject({
      status: 'rejected',
      code: 'XML_FEATURES',
      paragraphs: [],
    });
    // and the scanner of the text would not expand an entity either
    expect(await extractDocxParagraphs(bytes)).toEqual([
      { text: '&lol2;&xxe;&ok', bold: false },
    ]);
  });

  it('refuses a comment or a CDATA section in the text part', async () => {
    for (const hidden of [
      '<!-- x> <w:p><w:r><w:t>SECRET</w:t></w:r></w:p> -->',
      '<![CDATA[ x> <w:p><w:r><w:t>SECRET</w:t></w:r></w:p> ]]>',
    ]) {
      const result = await readDocx(await docxBytes(para('sichtbar') + hidden));
      expect(result).toMatchObject({
        status: 'rejected',
        code: 'XML_FEATURES',
      });
    }
  });

  it('reads deeply nested tables without recursion', async () => {
    const depth = 100000;
    const body =
      '<w:tbl><w:tr><w:tc>'.repeat(depth) +
      para('tief innen') +
      '</w:tc></w:tr></w:tbl>'.repeat(depth);
    const started = Date.now();
    const result = await readDocx(
      await docxBytes(body, { compression: 'DEFLATE' })
    );
    expect(Date.now() - started).toBeLessThan(3000);
    expect(result.status).toBe('ok');
    expect(result.paragraphs.map(p => p.text)).toEqual(['tief innen']);
  });

  it('works in linear time on unclosed tags', async () => {
    const started = Date.now();
    const result = await readDocx(
      await docxBytes('<w:p><w:r><w:t>'.repeat(60000), {
        compression: 'DEFLATE',
      })
    );
    expect(Date.now() - started).toBeLessThan(3000);
    expect(['ok', 'failed']).toContain(result.status);
  });
});

describe('readDocx: limits of the text', () => {
  it('fails with NO_TEXT for a file without text', async () => {
    expect(await readDocx(await docxBytes(''))).toMatchObject({
      status: 'failed',
      code: 'NO_TEXT',
    });
    expect(await readDocx(await docxBytes(para('   ')))).toMatchObject({
      status: 'failed',
      code: 'NO_TEXT',
    });
  });

  it('fails with TEXT_TOO_LARGE above the limit of characters', async () => {
    const result = await readDocx(
      await docxFromBlocks([t('a'.repeat(500)), b('b'.repeat(500))]),
      { maxTextChars: 900 }
    );
    expect(result).toMatchObject({ status: 'failed', code: 'TEXT_TOO_LARGE' });
    expect(result.paragraphs).toEqual([]);
  });

  it('fails with TOO_MANY_PARAGRAPHS above the limit of paragraphs', async () => {
    const result = await readDocx(
      await docxBytes(para('x').repeat(60), { compression: 'DEFLATE' }),
      { maxParagraphs: 50 }
    );
    expect(result).toMatchObject({
      status: 'failed',
      code: 'TOO_MANY_PARAGRAPHS',
    });
  });

  it('never throws, whatever the bytes are', async () => {
    const samples: Uint8Array[] = [
      Buffer.from([0x50, 0x4b, 3, 4]),
      Buffer.concat([Buffer.from([0x50, 0x4b, 5, 6]), Buffer.alloc(18)]),
      Buffer.alloc(30, 0xff),
    ];
    for (const sample of samples) {
      const result = await readDocx(sample);
      expect(result.status).not.toBe('ok');
      expect(result.paragraphs).toEqual([]);
    }
  });

  it('maps an unexpected read error to PARSE_ERROR', async () => {
    jest
      .spyOn(JSZip, 'loadAsync')
      .mockRejectedValueOnce(new Error('kaputt') as never);
    const result = await readDocx(await docxFromBlocks(quizBlocks()));
    expect(result).toMatchObject({ status: 'failed', code: 'PARSE_ERROR' });
    expect(JSON.stringify(result.findings)).not.toContain('kaputt');
  });

  it('notes a missing content types part', async () => {
    const result = await readDocx(
      await docxFromBlocks(quizBlocks(), { noContentTypes: true })
    );
    expect(result.status).toBe('ok');
    expect(codes(result)).toContain('CONTENT_TYPES_MISSING');
  });

  it('decodes the entities of the text', async () => {
    const result = await readDocx(
      await docxBytes(`<w:p>${run('Tom & Jerry <3')}</w:p>`)
    );
    expect(result.paragraphs[0].text).toBe('Tom & Jerry <3');
  });
});
