/**
 * @jest-environment node
 */
// Tests of the PDF-from-Word step (src/lib/content-import/documents/word.ts and pdf-clean.ts). Every
// Word file here is invented (tests/helpers/uploadFixtures.ts), the canary words mark the solution
// parts: a test fails when one of them reaches a document that goes to the trainees.
import JSZip from 'jszip';
import { PDFDocument, PDFName } from 'pdf-lib';
import { describe, expect, it } from '@jest/globals';

import { extractDocxParagraphs } from '@/lib/content-import/docx-paragraphs';
import { classifyPdfPath } from '@/lib/content-import/documents/classify';
import { cleanPdfMetadata } from '@/lib/content-import/documents/pdf-clean';
import {
  bodyBlocks,
  cutBodyXml,
  isScenarioSolutionHeading,
  isUseCaseSolutionHeading,
  prepareDocx,
  prepareWordDocument,
  stripExternalFields,
  stripExternalRelationships,
  traineePdfProblem,
  wordPdfName,
  wordPdfPath,
  type WordContext,
} from '@/lib/content-import/documents/word';
import {
  CANARY,
  CANARY_WORDS,
  b,
  docxBytes,
  docxFromBlocks,
  enablerBlocks,
  para,
  scenarioBlocks,
  t,
  tableXml,
  useCaseBlocks,
} from '../../../helpers/uploadFixtures';

const context = (over: Partial<WordContext> = {}): WordContext => ({
  enablerKey: '1b',
  enablerCode: 'K1-b',
  strongSolutions: [],
  reviewedBareSolutionLine: false,
  ...over,
});

const textOf = async (bytes: Uint8Array) =>
  (await extractDocxParagraphs(bytes)).map(p => p.text).join('\n');
const rawXml = async (bytes: Uint8Array) =>
  (await JSZip.loadAsync(bytes)).file('word/document.xml')!.async('string');

describe('file names and paths', () => {
  it('names the PDFs in the pattern of the delivered ones, without the title', () => {
    expect(wordPdfName('enabler', '6d')).toBe('6d.pdf');
    expect(wordPdfName('scenario', '6.2d')).toBe('Szenario_6_2d.pdf');
    expect(wordPdfName('usecase_task', '24.1a')).toBe('UC_24_1a.pdf');
    expect(wordPdfName('usecase_solution', '25.2d')).toBe(
      'UC_25_2d_Musterlösung.pdf'
    );
    expect(wordPdfName('enabler', 'nonsense')).toBeNull();
    expect(wordPdfName('enabler', '6.2dd')).toBeNull();
  });

  it('builds a path that the PDF import classifies like a delivered PDF', () => {
    const cases = [
      ['enabler', '6.2d', '06.2', 'K6.2-d'],
      ['scenario', '6.2d', '06.2', 'K6.2-d'],
      ['usecase_task', '24.1a', '24.1', 'K24.1-a'],
      ['usecase_solution', '4a', '04', 'K4-a'],
    ] as const;
    for (const [kind, key, component, code] of cases) {
      const name = wordPdfName(kind, key) as string;
      const path = wordPdfPath(component, 'Erfundener Titel', kind, name);
      expect(classifyPdfPath(path)).toMatchObject({
        kind,
        enablerCode: code,
        status: 'ok',
      });
    }
  });

  it('cleans the component title and has a fallback', () => {
    expect(wordPdfPath('01', 'A/B: C?', 'enabler', '1a.pdf')).toBe(
      '01 - A B C/Enabler/1a.pdf'
    );
    expect(wordPdfPath('01', null, 'scenario', 'Szenario_1a.pdf')).toBe(
      '01 - Komponente/Szenarien/Szenario_1a.pdf'
    );
  });
});

describe('the elements of the body', () => {
  const xml = (inner: string) =>
    `<w:document xmlns:w="x"><w:body>${inner}</w:body></w:document>`;

  it('finds paragraphs, tables, content controls and empty paragraphs at the top level only', () => {
    const doc = xml(
      [
        '<w:p><w:r><w:t>Titel</w:t></w:r></w:p>',
        '<w:p/>',
        '<w:tbl><w:tr><w:tc><w:p><w:r><w:t>Lösung</w:t></w:r></w:p></w:tc></w:tr></w:tbl>',
        '<w:sdt><w:sdtPr/><w:sdtContent><w:p><w:r><w:t>Im Steuerelement</w:t></w:r></w:p></w:sdtContent></w:sdt>',
        '<w:p><w:r><w:t>A &amp; B</w:t></w:r><w:r><w:tab/></w:r><w:r><w:t>C</w:t></w:r></w:p>',
        '<w:p><w:pPr><w:sectPr><w:pgSz/></w:sectPr></w:pPr><w:r><w:t>Abschnitt</w:t></w:r></w:p>',
        '<w:sectPr><w:pgSz/></w:sectPr>',
      ].join('')
    );
    const { blocks, tail } = bodyBlocks(doc);
    expect(blocks.map(block => block.text)).toEqual([
      'Titel',
      '',
      'Lösung',
      'Im Steuerelement',
      'A & B C',
      'Abschnitt',
    ]);
    expect(doc.slice(tail).startsWith('<w:sectPr>')).toBe(true);
  });

  it('does not take a paragraph in a text box for a top level element', () => {
    const doc = xml(
      '<w:p><w:r><w:t>Außen</w:t></w:r><w:r><w:txbxContent><w:p><w:r><w:t>Innen</w:t></w:r></w:p></w:txbxContent></w:r></w:p>'
    );
    const { blocks } = bodyBlocks(doc);
    expect(blocks).toHaveLength(1);
    expect(blocks[0].text).toBe('AußenInnen');
  });

  it('has no blocks without a body', () => {
    expect(bodyBlocks('<x/>')).toEqual({ blocks: [], tail: -1 });
  });

  it('cuts from the first heading that is accepted, keeps the section properties, never cuts the title', () => {
    const doc = xml(
      [
        '<w:p><w:r><w:t>Lösung der Aufgabe</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>Eins</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>Lösung</w:t></w:r></w:p>',
        '<w:p><w:r><w:t>Geheim</w:t></w:r></w:p>',
        '<w:sectPr><w:pgSz/></w:sectPr>',
      ].join('')
    );
    const cut = cutBodyXml(doc, isScenarioSolutionHeading) as string;
    expect(cut).toContain('Lösung der Aufgabe');
    expect(cut).toContain('Eins');
    expect(cut).not.toContain('Geheim');
    expect(cut).toContain('<w:sectPr>');
    expect(cut.endsWith('</w:body></w:document>')).toBe(true);
    expect(
      cutBodyXml(xml('<w:p><w:r><w:t>Titel</w:t></w:r></w:p>'), () => true)
    ).toBeNull();
    expect(cutBodyXml('<x/>', () => true)).toBeNull();
  });

  it('knows the headings of a solution part', () => {
    for (const text of [
      'Lösungsszenario',
      'Lösung:',
      'Lösungsszenario (nur Trainer)',
      'Wie das Fachwissen zur Lösung beiträgt',
      'Musterlösung',
      'Bewertungskriterien',
    ]) {
      expect(isScenarioSolutionHeading(text)).toBe(true);
    }
    // a long sentence or a sentence with an end is no heading
    expect(
      isScenarioSolutionHeading(
        'Lösungen sind vorzubereiten und mit dem Team abzustimmen, bevor der Termin stattfindet.'
      )
    ).toBe(false);
    expect(isScenarioSolutionHeading('Lösung folgt hier.')).toBe(false);
    expect(isUseCaseSolutionHeading('Musterlösung:')).toBe(true);
    expect(isUseCaseSolutionHeading('Bewertungskriterien')).toBe(true);
    expect(isUseCaseSolutionHeading('Musterlösung der Firma')).toBe(false);
  });
});

describe('the docx for the converter', () => {
  it('removes every external relationship, also the target of a hyperlink, and keeps the internal ones', () => {
    const rels =
      '<Relationships>' +
      '<Relationship Id="r1" Type="http://x/image" Target="https://example.invalid/a.png" TargetMode="External"/>' +
      '<Relationship Id="r2" Type="http://x/hyperlink" Target="https://example.invalid/" TargetMode="External"/>' +
      '<Relationship Id="r3" Type="http://x/image" Target="media/a.png"/>' +
      '<Relationship Id="r4" Type="http://x/attachedTemplate" Target="file:///C:/n.dotm" TargetMode="External"/>' +
      '</Relationships>';
    const result = stripExternalRelationships(rels);
    expect(result.removed).toBe(3);
    expect(result.xml).toContain('r3');
    expect(result.xml).not.toContain('r1');
    expect(result.xml).not.toContain('r2');
    expect(result.xml).not.toContain('r4');
  });

  it('also removes the form with a closing tag and a quoted > in an attribute', () => {
    const rels =
      '<Relationships>' +
      '<Relationship Id="a" Type="http://x/image" Target="http://example.invalid/a" TargetMode="External"></Relationship>' +
      '<Relationship Id="b" Type="http://x/image" Target="http://example.invalid/b>c" TargetMode="External"/>' +
      '<Relationship Id="c" Type="http://x/image" Target="media/c.png"/>' +
      '</Relationships>';
    const result = stripExternalRelationships(rels);
    expect(result.removed).toBe(2);
    expect(result.xml).toBe(
      '<Relationships><Relationship Id="c" Type="http://x/image" Target="media/c.png"/></Relationships>'
    );
  });

  it('empties the instruction of a field that loads something, and only that', () => {
    const doc =
      '<w:body><w:p><w:r><w:instrText xml:space="preserve"> INCLUDEPICTURE "http://example.invalid/x.png" </w:instrText></w:r>' +
      '<w:r><w:instrText> PAGE </w:instrText></w:r>' +
      '<w:fldSimple w:instr=" INCLUDETEXT file:///C:/x.docx "><w:r><w:t>x</w:t></w:r></w:fldSimple>' +
      '<w:fldSimple w:instr=" NUMPAGES "><w:r><w:t>2</w:t></w:r></w:fldSimple></w:p></w:body>';
    const result = stripExternalFields(doc);
    expect(result.removed).toBe(2);
    expect(result.xml).not.toContain('INCLUDEPICTURE');
    expect(result.xml).not.toContain('INCLUDETEXT');
    expect(result.xml).not.toContain('example.invalid');
    expect(result.xml).toContain('PAGE');
    expect(result.xml).toContain('NUMPAGES');
    expect(result.xml).toContain('<w:t>2</w:t>');
  });

  it('scans a hostile file in linear time (thousands of unfinished tags)', () => {
    const hostile = (tag: string) =>
      `<w:document><w:body><w:p><w:r><w:t>Titel</w:t></w:r></w:p>${tag.repeat(60000)}`;
    const started = Date.now();
    bodyBlocks(hostile('<w:p '));
    stripExternalRelationships(
      `<Relationships>${'<Relationship '.repeat(60000)}`
    );
    stripExternalFields(hostile('<w:instrText '));
    expect(Date.now() - started).toBeLessThan(1500);
  });

  it('removes the references and macro parts from the package, in every rels file', async () => {
    const data = await docxFromBlocks(enablerBlocks({ code: '1b' }), {
      parts: {
        '_rels/.rels':
          '<Relationships><Relationship Id="a" Type="http://x/oleObject" Target="\\\\host\\share\\a" TargetMode="External"/></Relationships>',
        'word/_rels/document.xml.rels':
          '<Relationships><Relationship Id="b" Type="http://x/image" Target="http://example.invalid/b.png" TargetMode="External"/></Relationships>',
        'word/vbaProject.bin': 'binary',
      },
    });
    const result = await prepareDocx(data);
    expect(result).toMatchObject({ ok: true, removed: 3 });
    const zip = await JSZip.loadAsync((result as { bytes: Uint8Array }).bytes);
    expect(zip.file('word/vbaProject.bin')).toBeNull();
    expect(await zip.file('_rels/.rels')!.async('string')).not.toContain(
      'host'
    );
    expect(
      await zip.file('word/_rels/document.xml.rels')!.async('string')
    ).not.toContain('example.invalid');
  });

  it('refuses a file that is no docx and a file that cannot be cut', async () => {
    expect(await prepareDocx(new TextEncoder().encode('no zip'))).toEqual({
      ok: false,
      code: 'NOT_A_DOCX',
    });
    const data = await docxFromBlocks([t('Titel'), t('Text ohne Lösungsteil')]);
    expect(await prepareDocx(data, isScenarioSolutionHeading)).toEqual({
      ok: false,
      code: 'CUT_NOT_FOUND',
    });
  });

  it('refuses a package whose main document is not word/document.xml (the cut works on that part)', async () => {
    const rels = (target: string) =>
      `<Relationships><Relationship Id="rId1" Type="http://x/officeDocument" Target="${target}"/></Relationships>`;
    const other = await docxFromBlocks(enablerBlocks({ code: '1b' }), {
      parts: { '_rels/.rels': rels('word/other.xml') },
    });
    expect(await prepareDocx(other)).toEqual({ ok: false, code: 'NOT_A_DOCX' });
    for (const target of ['word/document.xml', '/word/document.xml']) {
      const standard = await docxFromBlocks(enablerBlocks({ code: '1b' }), {
        parts: { '_rels/.rels': rels(target) },
      });
      expect(await prepareDocx(standard)).toMatchObject({ ok: true });
    }
  });

  it('refuses a relationships part that is far larger than a real one', async () => {
    const big = await docxFromBlocks(enablerBlocks({ code: '1b' }), {
      compression: 'DEFLATE',
      parts: { 'word/_rels/document.xml.rels': ' '.repeat(5 * 1024 * 1024) },
    });
    expect(await prepareDocx(big)).toEqual({ ok: false, code: 'NOT_A_DOCX' });
  });

  it('removes a field that loads something from the text for the converter', async () => {
    const body =
      para('Titel') +
      '<w:p><w:r><w:instrText> INCLUDEPICTURE "http://example.invalid/x.png" </w:instrText></w:r></w:p>';
    const result = await prepareDocx(await docxBytes(body));
    expect(result).toMatchObject({ ok: true, removed: 1 });
    expect(await rawXml((result as { bytes: Uint8Array }).bytes)).not.toContain(
      'example.invalid'
    );
  });
});

describe('scenario: the PDF for the trainees stops before the solution', () => {
  it('cuts the docx before the heading of the solution, no canary word is left', async () => {
    const data = await docxFromBlocks(scenarioBlocks({ code: '1b' }));
    const result = await prepareWordDocument('scenario', data, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variants).toHaveLength(1);
    const [variant] = result.variants;
    expect(variant.kind).toBe('scenario');
    expect(variant.title).toBe('Szenario K1-b');
    const text = await textOf(variant.docx);
    expect(text).toContain('Ausgangssituation');
    expect(text).toContain('Beispiel Technik');
    for (const word of CANARY_WORDS) {
      expect(text).not.toContain(word);
      expect(await rawXml(variant.docx)).not.toContain(word);
    }
    expect(text).not.toMatch(/L(ö|oe)sungsszenario/);
    expect(text).not.toMatch(/Fachwissen zur L/);
    // the solution texts go to the check of the enabler texts
    expect(result.solutions.join(' ')).toContain('WOMBAT');
    expect(result.solutions.join(' ')).toContain('LAMA');
  });

  it('keeps a task that stands between the situation and the solution', async () => {
    const blocks = scenarioBlocks();
    blocks.splice(
      4,
      0,
      b('Aufgabe'),
      t('Finden Sie die Ursache und sichern Sie den Betrieb.')
    );
    const result = await prepareWordDocument(
      'scenario',
      await docxFromBlocks(blocks),
      context()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = await textOf(result.variants[0].docx);
    expect(text).toContain('Finden Sie die Ursache');
    expect(text).not.toContain('WOMBAT');
  });

  it('cuts at the task heading when the solution stands under it (the parser reads it as the solution)', async () => {
    const blocks = [
      t('Szenario 1b) Titel'),
      b('Ausgangssituation'),
      t('Eine erfundene Lage mit genug Text für den Test der Zerlegung.'),
      b('Aufgabe'),
      t(CANARY.scenarioSolution),
      b('Wie das Fachwissen zur Lösung beiträgt'),
      t(CANARY.knowledge),
    ];
    const result = await prepareWordDocument(
      'scenario',
      await docxFromBlocks(blocks),
      context()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    const text = await textOf(result.variants[0].docx);
    expect(text).toContain('erfundene Lage');
    for (const word of CANARY_WORDS) expect(text).not.toContain(word);
  });

  it('gives no PDF when the heading of the solution is not at the top level of the body', async () => {
    const blocks = scenarioBlocks();
    const body =
      blocks
        .slice(0, 4)
        .map(block => para(block.text, block))
        .join('') +
      tableXml([
        ['Lösungsszenario'],
        [CANARY.scenarioSolution],
        ['Wie das Fachwissen zur Lösung beiträgt'],
        [CANARY.knowledge],
      ]);
    // the parser sees the headings only outside of a table, so this file has no solution at all
    const result = await prepareWordDocument(
      'scenario',
      await docxBytes(body),
      context()
    );
    expect(result.ok).toBe(false);
  });

  it('gives no PDF for a heading in a content control', async () => {
    const blocks = scenarioBlocks();
    const body =
      blocks
        .slice(0, 4)
        .map(block => para(block.text, block))
        .join('') +
      `<w:sdt><w:sdtContent>${blocks
        .slice(4)
        .map(block => para(block.text, block))
        .join('')}</w:sdtContent></w:sdt>`;
    const result = await prepareWordDocument(
      'scenario',
      await docxBytes(body),
      context()
    );
    expect(result).toEqual({ ok: false, code: 'CUT_NOT_FOUND' });
  });

  it('refuses a file with a format error, another code and a marker in the visible part', async () => {
    expect(
      await prepareWordDocument(
        'scenario',
        await docxFromBlocks([t('Szenario 1b) Titel'), t('Nur Text')]),
        context()
      )
    ).toEqual({ ok: false, code: 'PARSE_ERROR' });
    expect(
      await prepareWordDocument(
        'scenario',
        await docxFromBlocks(scenarioBlocks({ code: '1c' })),
        context()
      )
    ).toEqual({ ok: false, code: 'CODE_MISMATCH' });
    const blocks = scenarioBlocks();
    blocks[2] = t(`Die Situation nennt ${CANARY.scenarioSolution} offen.`);
    expect(
      await prepareWordDocument(
        'scenario',
        await docxFromBlocks(blocks),
        context()
      )
    ).toEqual({ ok: false, code: 'SOLUTION_MARKER' });
    expect(
      await prepareWordDocument(
        'scenario',
        new TextEncoder().encode('no zip'),
        context()
      )
    ).toEqual({ ok: false, code: 'NOT_A_DOCX' });
  });

  it('the check of the finished PDF drops a text with a marker, a solution text or a heading of a solution', async () => {
    const result = await prepareWordDocument(
      'scenario',
      await docxFromBlocks(scenarioBlocks()),
      context()
    );
    if (!result.ok) throw new Error('expected a variant');
    const { check } = result.variants[0];
    expect(
      check('Szenario 1b) Titel\nAusgangssituation\nEine erfundene Lage.')
    ).toBeNull();
    expect(check('Szenario 1b) Titel\nLösungsszenario\nText')).toBe(
      'PDF_SOLUTION'
    );
    expect(check('Szenario 1b) Titel\nLösung\nText')).toBe('PDF_SOLUTION');
    expect(check(`Szenario 1b) Titel\n${CANARY.scenarioSolution}`)).toBe(
      'PDF_SOLUTION'
    );
    expect(
      check('Szenario 1b) Titel\nWie das Fachwissen zur Lösung beiträgt')
    ).toBe('PDF_SOLUTION');
    // the title may carry the word
    expect(
      check('Szenario 1b) Lösungen finden\nAusgangssituation\nText.')
    ).toBeNull();
  });
});

describe('traineePdfProblem', () => {
  it('leaves the title line out of the heading check, only for scenarios', () => {
    expect(traineePdfProblem('scenario', 'Lösungen\nText.', [])).toBeNull();
    expect(traineePdfProblem('scenario', 'Titel\nLösungen\nText.', [])).toBe(
      'PDF_SOLUTION'
    );
    expect(
      traineePdfProblem('usecase_task', 'Titel\nLösungen\nText.', [])
    ).toBeNull();
    expect(
      traineePdfProblem('usecase_task', 'Titel\n\n   \nText.', [])
    ).toBeNull();
    expect(traineePdfProblem('scenario', '', [])).toBeNull();
  });
});

describe('use case: task PDF stops before the model solution, the solution PDF is whole', () => {
  it('makes a task docx without the solution and a solution docx with it', async () => {
    const data = await docxFromBlocks(useCaseBlocks({ code: '1b' }));
    const result = await prepareWordDocument('usecase', data, context());
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variants.map(v => v.kind)).toEqual([
      'usecase_task',
      'usecase_solution',
    ]);
    const [task, solution] = result.variants;
    const taskText = await textOf(task.docx);
    expect(taskText).toContain('Weg zum Ziel');
    expect(taskText).not.toContain('Musterlösung');
    expect(taskText).not.toContain('OKAPI');
    expect(await rawXml(task.docx)).not.toContain('OKAPI');
    const solutionText = await textOf(solution.docx);
    expect(solutionText).toContain('OKAPI');
    expect(solutionText).toContain('Ausgangssituation');
    expect(task.title).toBe('Use Case K1-b: Aufgabe');
    expect(solution.title).toBe('Use Case K1-b: Musterlösung');
  });

  it('cuts everything from the solution on, also the criteria, and checks the PDF text of the task', async () => {
    const blocks = [
      ...useCaseBlocks({ code: '1b' }),
      b('Bewertungskriterien'),
      t(CANARY.criteria),
    ];
    const result = await prepareWordDocument(
      'usecase',
      await docxFromBlocks(blocks),
      context()
    );
    if (!result.ok) throw new Error('expected variants');
    const taskText = await textOf(result.variants[0].docx);
    expect(taskText).not.toContain('TAPIR');
    expect(taskText).not.toContain('OKAPI');
    const { check } = result.variants[0];
    expect(check('Aufgabe\nSchritt 1.')).toBeNull();
    expect(check('Aufgabe\nMusterlösung\nText')).toBe('PDF_SOLUTION');
    expect(check(`Aufgabe\n${CANARY.useCaseSolution}`)).toBe('PDF_SOLUTION');
    expect(result.variants[1].check('Musterlösung\nText')).toBeNull();
  });

  it('refuses a missing solution, another code, a marker in a visible section and a section in a table', async () => {
    const withoutSolution = useCaseBlocks({ code: '1b' }).slice(0, -2);
    expect(
      await prepareWordDocument(
        'usecase',
        await docxFromBlocks(withoutSolution),
        context()
      )
    ).toEqual({ ok: false, code: 'PARSE_ERROR' });
    expect(
      await prepareWordDocument(
        'usecase',
        await docxFromBlocks(useCaseBlocks({ code: '1c' })),
        context()
      )
    ).toEqual({ ok: false, code: 'CODE_MISMATCH' });
    const marked = useCaseBlocks({ code: '1b' });
    marked[4] = t(
      'Siehe die Musterlösung der Firma im Anhang zu dieser Aufgabe.'
    );
    expect(
      await prepareWordDocument(
        'usecase',
        await docxFromBlocks(marked),
        context()
      )
    ).toEqual({ ok: false, code: 'SOLUTION_MARKER' });
  });
});

describe('enabler: the whole text, with the checks of the content import', () => {
  it('makes one variant with the title of the enabler', async () => {
    const result = await prepareWordDocument(
      'enabler',
      await docxFromBlocks(enablerBlocks({ code: '1b' })),
      context()
    );
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.variants).toHaveLength(1);
    expect(result.variants[0]).toMatchObject({
      kind: 'enabler',
      title: 'Enabler K1-b',
    });
    expect(result.variants[0].check('Router verbindet Netze.')).toBeNull();
    expect(result.variants[0].check('Lösungsszenario\nText')).toBe(
      'PDF_SOLUTION'
    );
    expect(result.solutions).toEqual([]);
  });

  it('refuses a marker, a repeated scenario solution and another code', async () => {
    const withMarker = [...enablerBlocks({ code: '1b' }), t('Lösungsszenario')];
    expect(
      await prepareWordDocument(
        'enabler',
        await docxFromBlocks(withMarker),
        context()
      )
    ).toEqual({ ok: false, code: 'SOLUTION_MARKER' });
    const repeated = [
      ...enablerBlocks({ code: '1b' }),
      t(CANARY.scenarioSolution),
    ];
    expect(
      await prepareWordDocument(
        'enabler',
        await docxFromBlocks(repeated),
        context({ strongSolutions: [CANARY.scenarioSolution] })
      )
    ).toEqual({ ok: false, code: 'SOLUTION_MARKER' });
    expect(
      await prepareWordDocument(
        'enabler',
        await docxFromBlocks(enablerBlocks({ code: '1c' })),
        context()
      )
    ).toEqual({ ok: false, code: 'CODE_MISMATCH' });
  });

  it('lets the bare line Lösung pass only for an enabler that the owner checked', async () => {
    const blocks = [...enablerBlocks({ code: '1b' }), t('Lösung')];
    const data = await docxFromBlocks(blocks);
    expect(await prepareWordDocument('enabler', data, context())).toEqual({
      ok: false,
      code: 'SOLUTION_MARKER',
    });
    const reviewed = await prepareWordDocument(
      'enabler',
      data,
      context({ reviewedBareSolutionLine: true })
    );
    expect(reviewed.ok).toBe(true);
  });

  it('leaves a heading without an id to the check of the PDF', async () => {
    const blocks = enablerBlocks({ code: '1b' });
    blocks[0] = t('Netzwerkgeräte ohne Kennung');
    const result = await prepareWordDocument(
      'enabler',
      await docxFromBlocks(blocks),
      context()
    );
    expect(result.ok).toBe(true);
  });
});

describe('cleanPdfMetadata', () => {
  async function pdfWithMetadata() {
    const doc = await PDFDocument.create();
    doc.addPage().drawText('Erfundener Inhalt');
    doc.addPage();
    doc.setTitle('Titel aus Word');
    doc.setAuthor('Erika Mustermann');
    doc.setSubject('Betreff Geheim');
    doc.setKeywords(['Stichwort Geheim']);
    doc.setProducer('LibreOffice 24');
    doc.setCreator('Writer');
    const xmp = doc.context.stream(
      '<x:xmpmeta>Erika Mustermann Stichwort Geheim</x:xmpmeta>',
      { Type: 'Metadata', Subtype: 'XML' }
    );
    doc.catalog.set(PDFName.of('Metadata'), doc.context.register(xmp));
    return doc.save({ useObjectStreams: false });
  }

  it('sets the title, empties the author and the rest, drops the XMP packet and keeps the pages', async () => {
    const original = await pdfWithMetadata();
    expect(Buffer.from(original).toString('latin1')).toContain('Mustermann');
    const date = new Date('2026-10-28T10:00:00Z');
    const cleaned = await cleanPdfMetadata(original, 'Szenario K1-b', date);
    expect(cleaned.pageCount).toBe(2);
    const text = Buffer.from(cleaned.bytes).toString('latin1');
    expect(text).not.toContain('Mustermann');
    expect(text).not.toContain('Geheim');
    expect(text).not.toContain('LibreOffice');
    expect(text).not.toContain('xmpmeta');
    const reread = await PDFDocument.load(cleaned.bytes, {
      updateMetadata: false,
    });
    expect(reread.getTitle()).toBe('Szenario K1-b');
    expect(reread.getAuthor()).toBe('');
    expect(reread.getSubject()).toBe('');
    expect(reread.getKeywords()).toBe('');
    expect(reread.getProducer()).toBe('');
    expect(reread.getCreator()).toBe('');
    expect(reread.catalog.has(PDFName.of('Metadata'))).toBe(false);
    expect(reread.getCreationDate()?.toISOString()).toBe(date.toISOString());
  });

  it('rejects a file that is no PDF', async () => {
    await expect(
      cleanPdfMetadata(new TextEncoder().encode('no pdf'), 'x')
    ).rejects.toThrow();
  });
});
