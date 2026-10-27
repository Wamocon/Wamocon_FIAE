/**
 * @jest-environment node
 */
// The protection of the solution parts. The excerpt is the only thing that
// leaves the platform. These tests build invented documents with canary words in
// every solution part and in every hiding place a Word file offers (hidden
// text, tables, headers, footers, comments, text boxes, notes, metadata,
// alternative content), run them through the real reader and the real excerpt
// and look for a canary in the result. A canary in an excerpt is a leak.
import { describe, expect, it } from '@jest/globals';

import {
  toTraineeQuiz,
  toTraineeScenario,
  parseQuizText,
  parseScenarioText,
} from '@/lib/content-import/source-parsers';
import {
  parseUseCaseText,
  toTraineeUseCase,
} from '@/lib/content-import/use-cases/parser';
import { buildExcerpt } from '@/lib/content-upload/excerpt';
import { readDocx } from '@/lib/content-upload/read-docx';

import {
  b,
  blocksToParagraphs,
  CANARY,
  CANARY_WORDS,
  docxBytes,
  docxFromBlocks,
  enablerBlocks,
  esc,
  globalQuizBlocks,
  para,
  quizBlocks,
  scenarioBlocks,
  t,
  tableXml,
  useCaseBlocks,
  type Block,
} from '../../helpers/uploadFixtures';

const ALL_SOLUTIONS = Object.values(CANARY);

function leaks(text: string): string[] {
  return CANARY_WORDS.filter(word => text.includes(word));
}

async function excerptOfDocx(bytes: Buffer, extra: object = {}) {
  const read = await readDocx(bytes);
  expect(read.status).toBe('ok');
  return buildExcerpt({ paragraphs: read.paragraphs, ...extra });
}

const hiding = {
  'hidden text': (canary: string) =>
    para(canary, { hidden: true }) + para('Nach dem versteckten Absatz.'),
  'a text box': (canary: string) =>
    `<w:p><w:r><w:txbxContent><w:p><w:r><w:t>${esc(canary)}</w:t></w:r></w:p></w:txbxContent></w:r></w:p>`,
  'alternative content': (canary: string) =>
    `<mc:AlternateContent><mc:Fallback><w:p><w:r><w:t>${esc(canary)}</w:t></w:r></w:p></mc:Fallback></mc:AlternateContent>`,
  'deleted text': (canary: string) =>
    `<w:p><w:del w:id="1"><w:r><w:delText>${esc(canary)}</w:delText></w:r></w:del></w:p>`,
  'moved text': (canary: string) =>
    `<w:p><w:moveFrom w:id="1"><w:r><w:t>${esc(canary)}</w:t></w:r></w:moveFrom></w:p>`,
  'a description of a picture': (canary: string) =>
    `<w:p><w:r><w:drawing><wp:docPr id="1" name="Bild" descr="${esc(canary)}"/></w:drawing></w:r></w:p>`,
};

const parts = (canary: string): Record<string, string> => ({
  'word/header1.xml': `<w:hdr>${para(canary)}</w:hdr>`,
  'word/footer1.xml': `<w:ftr>${para(canary)}</w:ftr>`,
  'word/comments.xml': `<w:comments>${para(canary)}</w:comments>`,
  'word/footnotes.xml': `<w:footnotes>${para(canary)}</w:footnotes>`,
  'word/endnotes.xml': `<w:endnotes>${para(canary)}</w:endnotes>`,
  'docProps/core.xml': `<cp:coreProperties xmlns:dc="x"><dc:title>${esc(canary)}</dc:title><dc:description>${esc(canary)}</dc:description></cp:coreProperties>`,
  'docProps/custom.xml': `<Properties><property name="x"><vt:lpwstr>${esc(canary)}</vt:lpwstr></property></Properties>`,
  'customXml/item1.xml': `<root>${esc(canary)}</root>`,
});

const documents: Array<[name: string, blocks: Block[]]> = [
  ['a quiz', quizBlocks()],
  ['a global quiz', globalQuizBlocks()],
  ['a scenario', scenarioBlocks()],
  ['a use case', useCaseBlocks()],
  ['an enabler text', enablerBlocks({ paragraphs: 12 })],
];

describe('the solution parts of the documents', () => {
  it.each(documents)('are not in the excerpt of %s', async (_name, blocks) => {
    const result = await excerptOfDocx(await docxFromBlocks(blocks));
    expect(result.sendable).toBe(true);
    expect(leaks(result.excerpt)).toEqual([]);
  });

  it('are exactly what the trainee views of the parsers name as solution', () => {
    // The parsers keep the solution apart. The excerpt must hold none of the
    // texts that they mark: this is the cross check of the concept.
    const quiz = parseQuizText(blocksToParagraphs(quizBlocks()));
    const scenario = parseScenarioText(blocksToParagraphs(scenarioBlocks()));
    const useCase = parseUseCaseText(blocksToParagraphs(useCaseBlocks()));
    expect(toTraineeQuiz(quiz)).not.toBeNull();
    expect(toTraineeScenario(scenario)).not.toBeNull();
    expect(toTraineeUseCase(useCase)).not.toBeNull();
    const marked = [
      ...quiz.value.questions.flatMap(q => [q.rationale ?? '']),
      scenario.value.solution,
      scenario.value.knowledgeContribution,
      useCase.value.solution,
      useCase.value.criteria,
    ].filter(Boolean);
    expect(marked.length).toBeGreaterThan(5);
    for (const blocks of [quizBlocks(), scenarioBlocks(), useCaseBlocks()]) {
      const { excerpt } = buildExcerpt({
        paragraphs: blocksToParagraphs(blocks),
      });
      for (const solution of marked) expect(excerpt).not.toContain(solution);
    }
  });
});

describe('the hiding places of a Word file', () => {
  const placed = (blocks: Block[], extra: string) => {
    // the hiding place goes right after the heading, into the visible part
    const [first, ...rest] = blocks;
    return para(first.text) + extra + rest.map(r => para(r.text, r)).join('');
  };

  for (const [docName, blocks] of documents) {
    for (const [hidingName, make] of Object.entries(hiding)) {
      it(`${hidingName} in ${docName} stays out of the excerpt`, async () => {
        const canary = `${CANARY.scenarioSolution} ${CANARY.correct}`;
        const bytes = await docxBytes(placed(blocks, make(canary)));
        const result = await excerptOfDocx(bytes, { knownSolutions: [] });
        expect(leaks(result.excerpt)).toEqual([]);
      });
    }

    it(`headers, footers, comments, notes and metadata of ${docName} stay out of the excerpt`, async () => {
      const canary = `${CANARY.scenarioSolution} ${CANARY.knowledge}`;
      const bytes = await docxFromBlocks(blocks, { parts: parts(canary) });
      const result = await excerptOfDocx(bytes);
      expect(leaks(result.excerpt)).toEqual([]);
    });
  }

  it('text hidden through a style stays out of the excerpt', async () => {
    const styles =
      '<w:styles xmlns:w="x"><w:style w:type="character" w:styleId="Weg"><w:rPr><w:vanish/></w:rPr></w:style><w:style w:type="paragraph" w:styleId="WegAbsatz"><w:rPr><w:vanish/></w:rPr></w:style></w:styles>';
    const body =
      para('Szenario 1b) Der ausgefallene Router') +
      para('Ausgangssituation', { bold: true }) +
      para('Eine sichtbare Lage.') +
      `<w:p><w:r><w:rPr><w:rStyle w:val="Weg"/></w:rPr><w:t>${CANARY.scenarioSolution}</w:t></w:r></w:p>` +
      `<w:p><w:pPr><w:pStyle w:val="WegAbsatz"/></w:pPr><w:r><w:t>${CANARY.knowledge}</w:t></w:r></w:p>` +
      para('Lösungsszenario', { bold: true }) +
      para(CANARY.useCaseSolution) +
      para('Wie das Fachwissen zur Lösung beiträgt', { bold: true }) +
      para(CANARY.criteria);
    const result = await excerptOfDocx(
      await docxBytes(body, { parts: { 'word/styles.xml': styles } })
    );
    expect(result.sendable).toBe(true);
    expect(result.excerpt).toContain('Eine sichtbare Lage.');
    expect(leaks(result.excerpt)).toEqual([]);
  });

  it('a solution in the cells of a table stays out of the excerpt', async () => {
    const body =
      para('Szenario 1b) Der ausgefallene Router') +
      para('Ausgangssituation', { bold: true }) +
      tableXml([['Lage', 'Ein Router fällt aus.']]) +
      tableXml([
        ['Lösungsszenario', CANARY.scenarioSolution],
        ['Wie das Fachwissen zur Lösung beiträgt', CANARY.knowledge],
      ]);
    const result = await excerptOfDocx(await docxBytes(body));
    expect(leaks(result.excerpt)).toEqual([]);
  });

  it('a use case whose solution heading stands in a table is not sent at all', async () => {
    const body =
      para('4a) Rechnungen prüfen') +
      para('Behandelte Themen', { bold: true }) +
      para('Die Grundlagen.') +
      para('Ausgangssituation', { bold: true }) +
      para('Eine Firma.') +
      para('Eckdaten', { bold: true }) +
      para('Zielsetzung', { bold: true }) +
      para('Prüfen.') +
      para('Weg zum Ziel', { bold: true }) +
      para('Schritte.') +
      tableXml([['Musterlösung', CANARY.useCaseSolution]]);
    const result = await excerptOfDocx(await docxBytes(body));
    expect(result).toMatchObject({
      sendable: false,
      reason: 'PARSER_REFUSED',
      excerpt: '',
    });
  });
});

describe('a file that the parsers refuse is not sent', () => {
  it('a quiz with a format error', () => {
    const quiz = quizBlocks();
    const at = quiz.findIndex(block =>
      block.text.startsWith('Richtige Antwort')
    );
    quiz.splice(at, 1);
    expect(
      buildExcerpt({ paragraphs: blocksToParagraphs(quiz) })
    ).toMatchObject({
      docType: 'quiz',
      sendable: false,
      reason: 'PARSER_REFUSED',
      excerpt: '',
    });
  });

  it('a scenario with a solution heading that is none, a use case without a bold heading', () => {
    const scenario = scenarioBlocks();
    scenario[4] = b('Lösungsszenario (nur Trainer)');
    expect(
      buildExcerpt({ paragraphs: blocksToParagraphs(scenario) })
    ).toMatchObject({
      sendable: false,
      reason: 'PARSER_REFUSED',
      excerpt: '',
    });
    const useCase = useCaseBlocks().map(block =>
      block.text === 'Musterlösung' ? t('Musterlösung') : block
    );
    expect(
      buildExcerpt({ paragraphs: blocksToParagraphs(useCase) })
    ).toMatchObject({
      sendable: false,
      reason: 'PARSER_REFUSED',
      excerpt: '',
    });
  });

  it('a quiz with a marker of a solution in a question', () => {
    const quiz = quizBlocks();
    quiz[2] = b('1. Wie lautet die Kurzbegründung: ' + CANARY.rationale + '?');
    const result = buildExcerpt({ paragraphs: blocksToParagraphs(quiz) });
    expect(result).toMatchObject({ sendable: false, excerpt: '' });
    expect(leaks(JSON.stringify(result))).toEqual([]);
  });
});

describe('marker words and solution texts inside the allowed parts', () => {
  const enabler = (extra: Block[]) => {
    const blocks = enablerBlocks({ paragraphs: 6 });
    return [...blocks.slice(0, 3), ...extra, ...blocks.slice(3)];
  };

  it('refuses a text without a known structure when a marker word stands in it', () => {
    // No parser names the solution parts of an enabler text. A marker may stand
    // in front of the solution, so cutting its line would leave the solution.
    for (const label of [
      'Kurzbegründung',
      'Lösungsszenario',
      'Fachwissen zur Lösung',
    ]) {
      const result = buildExcerpt({
        paragraphs: blocksToParagraphs(
          enabler([t(`${label}: ${CANARY.correct}`), t(CANARY.rationale)])
        ),
      });
      expect(result).toMatchObject({
        sendable: false,
        reason: 'GUARD_REFUSED',
        excerpt: '',
      });
      expect(leaks(JSON.stringify(result))).toEqual([]);
    }
  });

  it('cuts the text at a line that begins a solution part, so nothing behind it is sent', () => {
    const result = buildExcerpt({
      paragraphs: blocksToParagraphs(
        enabler([
          t('Musterlösung'),
          t(CANARY.useCaseSolution),
          t(CANARY.criteria),
        ])
      ),
    });
    expect(result.sendable).toBe(true);
    expect(leaks(result.excerpt)).toEqual([]);
    expect(result.findings.map(f => f.code)).toContain('SOLUTION_CUT');
  });

  it('refuses a text with a question, options and an answer without the usual labels', () => {
    for (const answer of [
      ['Antwort: B', 'Erklärung: ' + CANARY.rationale],
      ['Correct answer: UDP', 'Solution: ' + CANARY.rationale],
      ['Answer key: B', 'Rationale: ' + CANARY.rationale],
    ]) {
      const result = buildExcerpt({
        paragraphs: blocksToParagraphs(
          enabler([
            t('1. Welches Protokoll ist verbindungslos?'),
            t('A) TCP'),
            t('B) UDP'),
            t('C) FTP'),
            t('D) SMTP'),
            ...answer.map(text => t(text)),
          ])
        ),
      });
      expect(result).toMatchObject({ sendable: false, excerpt: '' });
      expect(leaks(JSON.stringify(result))).toEqual([]);
    }
  });

  it('refuses a file of unknown structure with options, also after an opt in', () => {
    const result = buildExcerpt({
      paragraphs: blocksToParagraphs([
        t('Übung zu Protokollen'),
        t('A) TCP'),
        t('B) UDP'),
        t('C) FTP'),
        t('Antwort: B'),
      ]),
      optIn: true,
    });
    expect(result).toMatchObject({ sendable: false, excerpt: '' });
  });

  it('does not take a bold label with a value for a heading', () => {
    const result = buildExcerpt({
      paragraphs: blocksToParagraphs([
        t('Übung zu Protokollen'),
        b('Teil 1'),
        b('Gelöst: UDP'),
        b('Ein sehr langer fetter Absatz '.repeat(10)),
      ]),
      optIn: true,
    });
    expect(result.excerpt).toBe('Übung zu Protokollen\nTeil 1');
  });

  it('cuts an enabler text at the first line that begins a solution part', () => {
    const result = buildExcerpt({
      paragraphs: blocksToParagraphs(
        enabler([
          t('Lösung zu Aufgabe 1'),
          b('Geheimer Abschnitt'),
          t(CANARY.correct),
        ])
      ),
    });
    expect(leaks(result.excerpt)).toEqual([]);
    expect(result.excerpt).not.toContain('Geheimer Abschnitt');
  });

  it('takes a text with the line of an answer for a quiz and does not send it', () => {
    // "Richtige Antwort" is the mark of a quiz: the parser refuses the file
    for (const spelling of [
      'Richtige Antwort',
      'RICHTIGE   ANTWORT',
      'Rich\u{200b}tige Antwort',
      'Ｒｉｃｈｔｉｇｅ Ａｎｔｗｏｒｔ',
    ]) {
      const result = buildExcerpt({
        paragraphs: blocksToParagraphs(
          enabler([t(`${spelling}: ${CANARY.correct}`)])
        ),
      });
      expect(result).toMatchObject({ sendable: false, excerpt: '' });
      expect(leaks(JSON.stringify(result))).toEqual([]);
    }
  });

  it('refuses a file with more than one hit of a marker or a solution text', () => {
    const result = buildExcerpt({
      paragraphs: blocksToParagraphs(
        enabler([
          t(`Kurzbegründung: ${CANARY.rationale}`),
          t(`Musterlösung folgt: ${CANARY.useCaseSolution}`),
        ])
      ),
    });
    expect(result).toMatchObject({
      sendable: false,
      reason: 'GUARD_REFUSED',
      excerpt: '',
    });
  });

  it('refuses a text when a marker is spelled with invisible, full width or look-alike characters', () => {
    const spellings = [
      'Kurz\u{ad}begründung: weil',
      'Kurz\u{200b}begründung: weil',
      'Ｋｕｒｚｂｅｇｒüｎｄｕｎｇ: weil',
      'Richtige Аntwort: B',
      'Musterlo\u{308}sung',
      'Lo\u{2060}esungsszenario',
      'MUSTERLÖSUNG',
      'Kurzbegr\u{fe0f}ündung',
      'Kurz\u{34f}begründung: weil',
      'Kurz\u{3164}begründung: weil',
      'Kurzbegr\u{301}ündung',
    ];
    for (const spelling of spellings) {
      const result = buildExcerpt({
        paragraphs: blocksToParagraphs(
          enabler([t(`${spelling} ${CANARY.correct}`)])
        ),
      });
      // either refused, or cut at the line that begins a solution part
      expect(leaks(result.excerpt)).toEqual([]);
      expect(result.excerpt).not.toContain('Kanarien');
      expect(
        !result.sendable ||
          result.findings.map(f => f.code).includes('SOLUTION_CUT')
      ).toBe(true);
    }
  });

  it('cuts a paragraph that repeats a solution text of another file, however it is spelled', () => {
    const known = [CANARY.scenarioSolution];
    const spellings = [
      CANARY.scenarioSolution,
      CANARY.scenarioSolution.toUpperCase(),
      CANARY.scenarioSolution.replace(/ /g, '  \u200b'),
      CANARY.scenarioSolution.replace('Kanarienantwort', 'Kanarienаntwort'),
      `Vorspann. ${CANARY.scenarioSolution} Nachspann.`,
    ];
    for (const spelling of spellings) {
      const result = buildExcerpt({
        paragraphs: blocksToParagraphs(enabler([t(spelling)])),
        knownSolutions: known,
      });
      expect(leaks(result.excerpt)).toEqual([]);
      expect(result.findings.map(f => f.code)).toContain('LEAK_REMOVED');
      expect(result.sendable).toBe(true);
    }
  });

  it('cuts the question that contains its own answer (a known case of the sources)', () => {
    const quiz = quizBlocks();
    // the text of the correct option 2 stands in the text of question 2
    quiz[9] = b(`2. Gilt: ${CANARY.correct.toLowerCase()} 2. wirklich?`);
    const result = buildExcerpt({ paragraphs: blocksToParagraphs(quiz) });
    expect(result.sendable).toBe(true);
    expect(leaks(result.excerpt)).toEqual([]);
    expect(result.excerpt).toContain('Frage 1:');
    expect(result.excerpt).not.toContain('Frage 2:');
    expect(result.findings.map(f => f.code)).toContain('LEAK_REMOVED');
  });

  it('cuts the rationale of a quiz that is repeated in the situation of a scenario', () => {
    const scenario = scenarioBlocks();
    scenario[2] = t(`Die Lage: ${CANARY.rationale} 1.`);
    const result = buildExcerpt({
      paragraphs: blocksToParagraphs(scenario),
      knownSolutions: [`${CANARY.rationale} 1.`],
    });
    expect(result.sendable).toBe(true);
    expect(leaks(result.excerpt)).toEqual([]);
    expect(result.excerpt).toContain('Die Auszubildende soll');
  });
});

describe('a spot check over many spellings and places', () => {
  // A small seeded generator, so a failure can be repeated.
  function random(seed: number) {
    let state = seed;
    return () => {
      state = (state * 1664525 + 1013904223) % 4294967296;
      return state / 4294967296;
    };
  }

  const obfuscate = (text: string, next: () => number) => {
    const marks = ['\u200b', '\u00ad', '\u2060', '\ufeff', '\u200c'];
    let out = '';
    for (const ch of text) {
      out += ch;
      if (next() < 0.15) out += marks[Math.floor(next() * marks.length)];
    }
    switch (Math.floor(next() * 4)) {
      case 0:
        return out.toUpperCase();
      case 1:
        return out.replace(/ /g, '   ');
      case 2:
        return out.normalize('NFD');
      default:
        return out;
    }
  };

  it('never lets a canary through, 300 documents', () => {
    const next = random(20261027);
    const solutions = ALL_SOLUTIONS as readonly string[];
    for (let run = 0; run < 300; run += 1) {
      const blocks = enablerBlocks({ paragraphs: 6 + Math.floor(next() * 10) });
      const inserts = 1 + Math.floor(next() * 3);
      for (let i = 0; i < inserts; i += 1) {
        const solution = solutions[Math.floor(next() * solutions.length)];
        const labelled = next() < 0.5;
        const line = labelled
          ? `${['Richtige Antwort', 'Kurzbegründung', 'Musterlösung', 'Lösungsszenario'][Math.floor(next() * 4)]}: ${solution}`
          : solution;
        const at = 1 + Math.floor(next() * (blocks.length - 1));
        blocks.splice(at, 0, t(obfuscate(line, next)));
      }
      const result = buildExcerpt({
        paragraphs: blocksToParagraphs(blocks),
        knownSolutions: solutions,
      });
      expect(leaks(result.excerpt)).toEqual([]);
      expect(leaks(JSON.stringify(result.findings))).toEqual([]);
    }
  });
});
