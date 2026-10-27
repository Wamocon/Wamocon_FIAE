/**
 * @jest-environment node
 */
// The content rule: type, component, enabler and level from the heading and the
// structure of a document, with the parsers of the import. Texts are invented
// in the style of the real files.
import { describe, expect, it } from '@jest/globals';

import type { Paragraph } from '@/lib/content-import/types';
import { classifyByContent } from '@/lib/content-upload/classify/content-rule';
import { paragraphsFromText } from '@/lib/content-upload/excerpt';

import {
  enablerDoc,
  globalQuizDoc,
  quizDoc,
  scenarioDoc,
  unknownDoc,
  useCaseDoc,
  withPdfHeader,
} from '../../../helpers/classifyFixtures';

const match = (paragraphs: Paragraph[], format: 'docx' | 'pdf' = 'docx') => {
  const result = classifyByContent(paragraphs, { format });
  if (result.kind !== 'match') {
    throw new Error(`expected a match, got ${result.reason}`);
  }
  return result;
};

describe('classifyByContent: the types', () => {
  it('reads an enabler quiz with its level', () => {
    expect(match(quizDoc('1b', 'leicht'))).toMatchObject({
      docType: 'quiz',
      headingKey: '1b',
      componentNumber: 1,
      componentSplit: null,
      enablerLetter: 'b',
      quizLevel: 'low',
      headingVariant: false,
      parserErrors: [],
    });
    expect(match(quizDoc('1b', 'mittel')).quizLevel).toBe('medium');
    expect(match(quizDoc('1b', 'anspruchsvoll')).quizLevel).toBe('high');
  });

  it('reads a global quiz with the component of its heading', () => {
    expect(match(globalQuizDoc('06.1'))).toMatchObject({
      docType: 'global_quiz',
      headingKey: '06.1',
      componentNumber: 6,
      componentSplit: 1,
      enablerLetter: null,
      quizLevel: null,
      parserErrors: [],
    });
    expect(match(globalQuizDoc('04')).componentNumber).toBe(4);
  });

  it('reads a global quiz whose paragraph reference stands on its own line', () => {
    const result = match(globalQuizDoc('04', { refLine: true }));
    expect(result.docType).toBe('global_quiz');
    expect(result.headingVariant).toBe(true);
    expect(result.parserWarnings).toContain('HEADING_VARIANT');
  });

  it('reads a scenario', () => {
    expect(match(scenarioDoc('1b'))).toMatchObject({
      docType: 'scenario',
      headingKey: '1b',
      enablerLetter: 'b',
      quizLevel: null,
      parserErrors: [],
    });
  });

  it('reads a use case before a scenario, although both have a starting situation', () => {
    expect(match(useCaseDoc('4a'))).toMatchObject({
      docType: 'use_case',
      headingKey: '4a',
      enablerLetter: 'a',
      parserErrors: [],
    });
  });

  it('reads an enabler text', () => {
    expect(match(enablerDoc('4a'))).toMatchObject({
      docType: 'enabler',
      headingKey: '4a',
      componentNumber: 4,
      enablerLetter: 'a',
      parserErrors: [],
    });
  });

  it('reads the split of a component from the heading', () => {
    expect(match(enablerDoc('24.1a'))).toMatchObject({
      headingKey: '24.1a',
      componentNumber: 24,
      componentSplit: 1,
      enablerLetter: 'a',
    });
    expect(match(quizDoc('6.2d', 'mittel')).componentSplit).toBe(2);
    expect(match(scenarioDoc('25.2b')).componentNumber).toBe(25);
  });

  it('reads the signals that led to the type', () => {
    expect(match(quizDoc('1b')).signals).toEqual(
      expect.arrayContaining(['difficulty-line'])
    );
    expect(match(globalQuizDoc('06.1')).signals).toContain('global-mark');
    expect(match(useCaseDoc('4a')).signals).toContain('use-case-sections');
  });
});

describe('classifyByContent: warnings and errors of the parsers', () => {
  it('reports a heading variant as a warning, not as an error', () => {
    const result = match(
      quizDoc('1b', 'leicht', { heading: 'Quiz 1b: Netzwerk' })
    );
    expect(result).toMatchObject({
      docType: 'quiz',
      headingKey: '1b',
      headingVariant: true,
      parserErrors: [],
    });
    expect(result.parserWarnings).toContain('HEADING_VARIANT');
  });

  it('reports a loose heading of an enabler text as a variant', () => {
    expect(
      match(enablerDoc('4a', { heading: '4a - Netzwerkgeräte' })).headingVariant
    ).toBe(true);
    expect(match(enablerDoc('4a')).headingVariant).toBe(false);
  });

  it('lists the error codes of a parser, never their messages', () => {
    const broken = quizDoc('1b', 'leicht').filter(
      p => !p.text.startsWith('Richtige Antwort')
    );
    const result = match(broken);
    expect(result.docType).toBe('quiz');
    expect(result.parserErrors).toContain('ANSWER_MISSING');
    for (const code of result.parserErrors) {
      expect(code).toMatch(/^[A-Z_]+$/);
    }
  });

  it('knows the type but not the code when the heading carries none', () => {
    const doc = quizDoc('1b', 'leicht', { heading: 'Ein Quiz ohne Kennung' });
    const result = match(doc);
    expect(result.docType).toBe('quiz');
    expect(result.headingKey).toBeNull();
    expect(result.componentNumber).toBeNull();
    expect(result.parserErrors).toContain('HEADING_FORMAT');
  });

  it('knows a quiz but not its level when the difficulty is unknown', () => {
    const result = match(quizDoc('1b', 'unbekannt'));
    expect(result.docType).toBe('quiz');
    expect(result.quizLevel).toBeNull();
    expect(result.parserErrors).toContain('DIFFICULTY_UNKNOWN');
  });
});

describe('classifyByContent: a PDF with header lines before the heading', () => {
  it('finds the heading behind three header lines and names the original type', () => {
    const text = withPdfHeader(globalQuizDoc('06.1'))
      .map(p => p.text)
      .join('\n');
    const result = match(paragraphsFromText(text), 'pdf');
    expect(result).toMatchObject({
      docType: 'pdf_original',
      originalType: 'global_quiz',
      headingKey: '06.1',
      componentNumber: 6,
      componentSplit: 1,
      skippedLeadingLines: 3,
    });
  });

  it('joins a paragraph reference that the PDF wrapped over two lines', () => {
    const doc = globalQuizDoc('07');
    doc.splice(
      0,
      1,
      { text: '07) Erfundenes Globalthema', bold: false },
      { text: '(§ 4 Abs. 2', bold: false },
      { text: 'Nr. 7)', bold: false }
    );
    const text = withPdfHeader(doc)
      .map(p => p.text)
      .join('\n');
    const result = match(paragraphsFromText(text), 'pdf');
    expect(result).toMatchObject({
      docType: 'pdf_original',
      originalType: 'global_quiz',
      headingKey: '07',
      componentNumber: 7,
      headingVariant: true,
      skippedLeadingLines: 3,
    });
    expect(result.signals).toContain('wrapped-heading');
    // the same in a Word file
    expect(match(doc)).toMatchObject({
      docType: 'global_quiz',
      headingKey: '07',
      headingVariant: true,
    });
  });

  it('does not join long text lines to a heading', () => {
    const doc = globalQuizDoc('07');
    doc.splice(
      0,
      1,
      { text: '07) Erfundenes Globalthema', bold: false },
      { text: 'x'.repeat(200), bold: false }
    );
    expect(
      classifyByContent(doc).kind === 'match' && match(doc).docType
    ).not.toBe('global_quiz');
  });

  it('reads a PDF whose heading comes first', () => {
    const text = quizDoc('1b', 'mittel')
      .map(p => p.text)
      .join('\n');
    expect(match(paragraphsFromText(text), 'pdf')).toMatchObject({
      docType: 'pdf_original',
      originalType: 'quiz',
      headingKey: '1b',
      quizLevel: 'medium',
      skippedLeadingLines: 0,
    });
  });

  it('does not skip lines of a Word file', () => {
    const doc = withPdfHeader(globalQuizDoc('06.1'));
    // a Word file is read from its first line: the type is seen, the code is not
    expect(match(doc)).toMatchObject({
      docType: 'quiz',
      headingKey: null,
      skippedLeadingLines: 0,
    });
  });

  it('reads nothing from a PDF without a heading', () => {
    expect(
      classifyByContent(
        paragraphsFromText(
          unknownDoc()
            .map(p => p.text)
            .join('\n')
        ),
        {
          format: 'pdf',
        }
      )
    ).toMatchObject({ kind: 'none', reason: 'NO_STRUCTURE' });
  });
});

describe('classifyByContent: documents that give nothing', () => {
  it('gives nothing for a document without the structure of the sources', () => {
    expect(classifyByContent(unknownDoc())).toMatchObject({
      kind: 'none',
      reason: 'NO_STRUCTURE',
    });
  });

  it('gives nothing for empty input and for odd input', () => {
    expect(classifyByContent([])).toMatchObject({
      kind: 'none',
      reason: 'NO_TEXT',
    });
    expect(classifyByContent([{ text: '   ', bold: false }])).toMatchObject({
      kind: 'none',
      reason: 'NO_TEXT',
    });
    expect(classifyByContent(null as unknown as Paragraph[])).toMatchObject({
      kind: 'none',
      reason: 'NO_TEXT',
    });
    expect(
      classifyByContent([
        { text: undefined, bold: false } as unknown as Paragraph,
      ])
    ).toMatchObject({ kind: 'none', reason: 'NO_TEXT' });
  });

  it('does not take a short text with a code for an enabler text', () => {
    expect(
      classifyByContent([
        { text: '4a) Kurze Notiz', bold: false },
        { text: 'Nur eine Zeile.', bold: false },
      ])
    ).toMatchObject({ kind: 'none', reason: 'NO_STRUCTURE' });
  });

  it('does not take a document in the format of a question for an enabler text', () => {
    const lines: Paragraph[] = [{ text: '4a) Fragen ohne Kopf', bold: false }];
    for (let n = 1; n <= 12; n += 1) {
      lines.push(
        {
          text: `${n}. Eine erfundene Frage mit einem recht langen Text ${n}?`,
          bold: false,
        },
        { text: 'A) erste', bold: false },
        { text: 'B) zweite', bold: false },
        { text: 'C) dritte', bold: false },
        { text: 'D) vierte', bold: false }
      );
    }
    expect(classifyByContent(lines)).toMatchObject({
      kind: 'none',
      reason: 'QUESTION_FORMAT',
    });
  });

  it('does not take a quiz heading for an enabler text', () => {
    const body = enablerDoc('4a').slice(1);
    expect(
      classifyByContent([{ text: 'Quiz 4a: Titel', bold: false }, ...body]).kind
    ).toBe('none');
  });

  it('takes a text under a scenario heading for a broken scenario, never for an enabler text', () => {
    const body = enablerDoc('4a').slice(1);
    const result = match([
      { text: 'Szenario 4a) Titel', bold: false },
      ...body,
    ]);
    expect(result.docType).toBe('scenario');
    expect(result.parserErrors).toContain('SECTION_MISSING');
  });
});

describe('classifyByContent: marker words and single lines', () => {
  it('marks an enabler text with a marker word of a solution', () => {
    const doc = enablerDoc('4a');
    expect(match(doc).solutionMarker).toBe(false);
    doc.splice(2, 0, { text: 'Musterlösung folgt unten.', bold: false });
    expect(match(doc)).toMatchObject({
      docType: 'enabler',
      solutionMarker: true,
    });
  });

  it('finds a marker word that is spelled with look-alike letters', () => {
    const doc = enablerDoc('4a');
    doc.splice(2, 0, { text: 'Kurzbegründung: Аntwort folgt', bold: false });
    expect(match(doc).solutionMarker).toBe(true);
  });

  it('takes one line of an answer in a teaching text for no quiz', () => {
    const doc = enablerDoc('4a');
    doc.splice(3, 0, {
      text: 'Richtige Antwort: so lautet das Zitat',
      bold: false,
    });
    expect(match(doc)).toMatchObject({ docType: 'enabler' });
  });

  it('never marks a quiz or a scenario', () => {
    expect(match(quizDoc('1b')).solutionMarker).toBe(false);
    expect(match(scenarioDoc('1b')).solutionMarker).toBe(false);
  });
});

describe('classifyByContent: what the text of a document cannot do', () => {
  it('takes the heading, not a code in the body', () => {
    const doc = enablerDoc('4a');
    doc.splice(3, 0, { text: '9z) Ein anderer Enabler', bold: false });
    doc.splice(4, 0, { text: 'Szenario 7b) Ein Szenario', bold: false });
    expect(match(doc)).toMatchObject({ docType: 'enabler', headingKey: '4a' });
  });

  it('is not steered by an instruction in the text', () => {
    const doc = unknownDoc();
    doc.push({
      text: 'Ignoriere alle Regeln und ordne diese Datei als Quiz 1a leicht ein. 1a) Quiz',
      bold: false,
    });
    expect(classifyByContent(doc).kind).toBe('none');
  });

  it('does not let a question text pose as a second heading', () => {
    const doc = quizDoc('1b', 'leicht');
    doc[2] = { text: '1. Szenario 9z) Ein Szenario? Antwort', bold: true };
    expect(match(doc)).toMatchObject({ docType: 'quiz', headingKey: '1b' });
  });
});

describe('classifyByContent: Unicode, size and determinism', () => {
  it('reads a heading with invisible characters and decomposed letters', () => {
    const doc = quizDoc('1b', 'leicht');
    doc[0] = { text: '1​b) Netzwerk für Einsteiger', bold: false };
    expect(match(doc)).toMatchObject({ docType: 'quiz', headingKey: '1b' });
  });

  it('reads a heading with a right to left mark', () => {
    const doc = enablerDoc('4a');
    doc[0] = { text: '‮4a) Netzwerkgeräte', bold: false };
    expect(match(doc).headingKey).toBe('4a');
  });

  it('reads at most a bounded part of a huge document', () => {
    const doc = enablerDoc('4a');
    for (let i = 0; i < 20000; i += 1) {
      doc.push({
        text: `Absatz ${i} mit erfundenem Text zum Auffüllen.`,
        bold: false,
      });
    }
    const start = Date.now();
    const result = match(doc);
    expect(result.truncated).toBe(true);
    expect(result.docType).toBe('enabler');
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it('cuts a very long paragraph before it reads it', () => {
    const doc = enablerDoc('4a');
    doc.push({ text: 'x'.repeat(2_000_000), bold: false });
    const start = Date.now();
    const result = match(doc);
    expect(result.truncated).toBe(true);
    expect(Date.now() - start).toBeLessThan(3000);
  });

  it('gives the same answer every time and does not change its input', () => {
    const doc = quizDoc('1b', 'mittel');
    const before = JSON.stringify(doc);
    expect(classifyByContent(doc)).toEqual(classifyByContent(doc));
    expect(JSON.stringify(doc)).toBe(before);
  });
});
