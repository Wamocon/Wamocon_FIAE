/**
 * @jest-environment node
 */
// buildExcerpt: what may leave the platform. At most 2500 characters, only
// headings and the allowed parts of a document, never a solution part. These
// tests cover the form of the excerpt per document type, the limits and the
// reasons why a file is not sent.
import { describe, expect, it } from '@jest/globals';

import {
  buildExcerpt,
  paragraphsFromText,
  protectExcerptLines,
} from '@/lib/content-upload/excerpt';

import {
  b,
  blocksToParagraphs,
  CANARY_WORDS,
  enablerBlocks,
  globalQuizBlocks,
  quizBlocks,
  scenarioBlocks,
  t,
  unknownBlocks,
  useCaseBlocks,
  type Block,
} from '../../helpers/uploadFixtures';

const build = (
  blocks: Block[],
  extra: Partial<Parameters<typeof buildExcerpt>[0]> = {}
) => buildExcerpt({ paragraphs: blocksToParagraphs(blocks), ...extra });

const lines = (excerpt: string) =>
  excerpt.split('\n').filter(line => line.trim().length > 0);

describe('buildExcerpt: the parts of a document that may be sent', () => {
  it('takes of a quiz the heading, the difficulty and the first three questions, no options', () => {
    const result = build(quizBlocks());
    expect(result).toMatchObject({
      docType: 'quiz',
      sendable: true,
      reason: 'OK',
    });
    expect(lines(result.excerpt)).toEqual([
      '1b) Netzwerkgrundlagen',
      'Quiz, Schwierigkeitsgrad: leicht',
      'Frage 1: Welche Aussage zu Thema 1 trifft zu?',
      'Frage 2: Welche Aussage zu Thema 2 trifft zu?',
      'Frage 3: Welche Aussage zu Thema 3 trifft zu?',
    ]);
  });

  it('takes of a global quiz the heading, the mark and the first three questions', () => {
    const result = build(globalQuizBlocks());
    expect(result).toMatchObject({
      docType: 'global_quiz',
      sendable: true,
      reason: 'OK',
    });
    expect(lines(result.excerpt)).toEqual([
      '06.1) Betriebliche Abläufe (§ 4 Abs. 2 Nr. 6)',
      'Global Quiz',
      'Frage 1: Welche Aussage zu Thema 1 trifft zu?',
      'Frage 2: Welche Aussage zu Thema 2 trifft zu?',
      'Frage 3: Welche Aussage zu Thema 3 trifft zu?',
    ]);
  });

  it('takes of a scenario the heading and the starting situation only', () => {
    const result = build(scenarioBlocks());
    expect(result).toMatchObject({
      docType: 'scenario',
      sendable: true,
      reason: 'OK',
    });
    expect(lines(result.excerpt)).toEqual([
      'Szenario 1b) Der ausgefallene Router',
      'Ausgangssituation',
      'Die erfundene Firma Beispiel Technik betreibt ein kleines Netz mit einem Router und zwei Switches. Am Montag fällt die Verbindung ins Internet aus.',
      'Die Auszubildende soll die Ursache finden und den Betrieb sichern.',
    ]);
  });

  it('takes of a use case the heading, the topics and the objective only', () => {
    const result = build(useCaseBlocks());
    expect(result).toMatchObject({
      docType: 'use_case',
      sendable: true,
      reason: 'OK',
    });
    expect(lines(result.excerpt)).toEqual([
      '4a) Rechnungen prüfen',
      'Behandelte Themen',
      'Dieses Beispiel wiederholt die Grundlagen der Rechnungsprüfung, die Umsatzsteuer und den Zahlungsweg.',
      'Zielsetzung',
      'Die Rechnungen sind zu prüfen, zu kontieren und für die Zahlung freizugeben.',
    ]);
    expect(result.excerpt).not.toMatch(
      /Ausgangssituation|Weg zum Ziel|Eckdaten/
    );
  });

  it('takes of an enabler text the heading, the bold sub headings and the first 1200 characters', () => {
    const result = build(enablerBlocks({ paragraphs: 40 }));
    expect(result).toMatchObject({
      docType: 'enabler',
      sendable: true,
      reason: 'OK',
    });
    const all = lines(result.excerpt);
    expect(all[0]).toBe('4a) Netzwerkgeräte');
    expect(all.slice(1, 4)).toEqual([
      'Abschnitt 1',
      'Abschnitt 2',
      'Abschnitt 3',
    ]);
    const body = all.filter(
      line => !line.startsWith('Abschnitt') && line !== all[0]
    );
    expect(body.join('\n').length).toBeLessThanOrEqual(1200);
    expect(body.join('\n').length).toBeGreaterThan(1000);
    expect(result.excerpt.length).toBeLessThanOrEqual(2500);
  });

  it('takes of a document of unknown structure only the title and short bold headings', () => {
    const result = build(unknownBlocks());
    expect(result).toMatchObject({
      docType: 'unknown',
      sendable: false,
      reason: 'STRUCTURE_UNKNOWN',
    });
    expect(lines(result.excerpt)).toEqual([
      'Einführung in die Datensicherung',
      'Warum Sicherungen wichtig sind',
      'Wie oft sichern',
    ]);
    expect(result.findings.map(f => f.code)).toContain('STRUCTURE_UNKNOWN');
  });

  it('sends a document of unknown structure only after an explicit opt in', () => {
    const result = build(unknownBlocks(), { optIn: true });
    expect(result).toMatchObject({
      docType: 'unknown',
      sendable: true,
      reason: 'OK',
    });
    expect(lines(result.excerpt)).toHaveLength(3);
  });

  it('cuts a document of unknown structure before the first line that starts a solution', () => {
    for (const marker of [
      'Lösung',
      'Musterlösung',
      'Bewertungskriterien',
      'Antwortschlüssel',
      'Korrekte Antwort: B',
      'Lösungsvorschlag',
    ]) {
      const result = build(
        [
          t('Übung zur Datensicherung'),
          b('Aufgabe 1'),
          t('Beschreibe den Ablauf.'),
          t(marker),
          b('Geheimer Abschnitt'),
        ],
        { optIn: true }
      );
      expect(result.excerpt).toContain('Aufgabe 1');
      expect(result.excerpt).not.toContain('Geheimer Abschnitt');
    }
  });

  it('never sends a document in the format of a question with options', () => {
    const result = build(
      [
        t('Fragen zur Datensicherung'),
        t('A) erste Möglichkeit'),
        t('B) zweite Möglichkeit'),
        t('C) dritte Möglichkeit'),
        t('D) vierte Möglichkeit'),
      ],
      { optIn: true }
    );
    expect(result).toMatchObject({
      sendable: false,
      reason: 'QUESTION_FORMAT',
      excerpt: '',
    });
  });

  it('reports a document without text', () => {
    for (const paragraphs of [
      [],
      [{ text: '', bold: false }],
      [{ text: '  \t', bold: true }],
    ]) {
      expect(buildExcerpt({ paragraphs })).toMatchObject({
        excerpt: '',
        sendable: false,
        reason: 'NO_TEXT',
        docType: 'unknown',
      });
    }
  });

  it('takes a text of lines (a PDF) the same way', () => {
    const text = [
      '4a) Netzwerkgeräte',
      ...enablerBlocks({ paragraphs: 8 })
        .slice(1)
        .map(block => block.text),
    ].join('\n');
    const result = buildExcerpt({ paragraphs: paragraphsFromText(text) });
    expect(result).toMatchObject({ docType: 'enabler', sendable: true });
    expect(result.excerpt.startsWith('4a) Netzwerkgeräte')).toBe(true);
  });
});

describe('buildExcerpt: the page header of an own PDF', () => {
  const HEADER = 'WAMOCON GmbH, Mergenthalerallee 79-81, 65760 Eschborn';

  it('leaves the header out so it does not hide the heading', () => {
    const quiz = quizBlocks().map(block => block.text);
    const withHeader = [
      HEADER,
      ...quiz.slice(0, 20),
      HEADER,
      ...quiz.slice(20),
    ];
    const result = buildExcerpt({
      paragraphs: paragraphsFromText(withHeader.join('\n')),
    });
    expect(result).toMatchObject({ docType: 'quiz', sendable: true });
    expect(result.excerpt).not.toContain('Mergenthalerallee');
    expect(lines(result.excerpt)[0]).toBe('1b) Netzwerkgrundlagen');
  });

  it('does not make a customer document of a text with the own header', () => {
    const text = [HEADER, ...enablerBlocks().map(block => block.text)].join(
      '\n'
    );
    const result = buildExcerpt({ paragraphs: paragraphsFromText(text) });
    expect(result).toMatchObject({ docType: 'enabler', reason: 'OK' });
  });
});

describe('buildExcerpt: limits', () => {
  it('cuts long parts: 300 characters of a question, 1000 of a situation', () => {
    const long = 'wort '.repeat(200).trim();
    const quiz = quizBlocks();
    quiz[2] = b(`1. ${long}`);
    const q = build(quiz);
    const first =
      lines(q.excerpt).find(line => line.startsWith('Frage 1:')) ?? '';
    expect(first.length).toBeLessThanOrEqual('Frage 1: '.length + 300);
    expect(first.length).toBeGreaterThan(250);

    const scenario = scenarioBlocks();
    scenario[2] = t(long.repeat(5));
    const s = build(scenario);
    const situation = lines(s.excerpt).slice(2).join('\n');
    expect(situation.length).toBeLessThanOrEqual(1000 + 80);
  });

  it('stays within 2500 characters, whatever the document', () => {
    const huge = 'x'.repeat(5000);
    for (const blocks of [
      enablerBlocks({ paragraphs: 200 }),
      [
        t('4a) Titel ' + huge),
        ...Array.from({ length: 60 }, (_, i) =>
          b(`Überschrift ${i} ${'y'.repeat(100)}`)
        ),
        t(huge),
      ],
      useCaseBlocks().map(block => ({ ...block, text: block.text.repeat(50) })),
    ]) {
      expect(build(blocks).excerpt.length).toBeLessThanOrEqual(2500);
    }
  });

  it('takes the limit of the caller, but never more than 2500', () => {
    const blocks = enablerBlocks({ paragraphs: 80 });
    expect(build(blocks, { maxChars: 100 }).excerpt.length).toBeLessThanOrEqual(
      100
    );
    expect(
      build(blocks, { maxChars: 100000 }).excerpt.length
    ).toBeLessThanOrEqual(2500);
    expect(build(blocks, { maxChars: 0 }).excerpt).toBe('');
  });

  it('never cuts inside a surrogate pair', () => {
    const blocks = [t('4a) Titel'), t('😀'.repeat(3000))];
    for (const maxChars of [101, 100, 1201, 1200]) {
      const { excerpt } = build(blocks, { maxChars });
      expect(Buffer.from(excerpt, 'utf8').toString('utf8')).toBe(excerpt);
    }
  });

  it('limits the work for a document with very many paragraphs', () => {
    const many: Block[] = [t('4a) Titel')];
    for (let i = 0; i < 30000; i += 1)
      many.push(t(`Absatz ${i} mit etwas Text.`));
    const started = Date.now();
    const result = build(many);
    expect(Date.now() - started).toBeLessThan(5000);
    expect(result.findings.map(f => f.code)).toContain('INPUT_TRUNCATED');
  });
});

describe('buildExcerpt: the result', () => {
  it('has exactly the documented fields and no content in the findings', () => {
    const result = build(quizBlocks());
    expect(Object.keys(result).sort()).toEqual(
      [
        'docType',
        'excerpt',
        'findings',
        'reason',
        'redactions',
        'sendable',
      ].sort()
    );
    for (const f of result.findings) {
      expect(Object.keys(f).sort()).toEqual(
        expect.arrayContaining(['code', 'message', 'severity'])
      );
      for (const word of CANARY_WORDS) expect(f.message).not.toContain(word);
    }
  });

  it('is deterministic and does not change its input', () => {
    const paragraphs = blocksToParagraphs(scenarioBlocks());
    const copy = JSON.parse(JSON.stringify(paragraphs));
    const first = buildExcerpt({ paragraphs });
    const second = buildExcerpt({ paragraphs });
    expect(second).toEqual(first);
    expect(paragraphs).toEqual(copy);
  });

  it('holds nothing but cleaned text: no invisible character, no heading marker', () => {
    const result = build([
      t('4a) Titel'),
      t('# Eine Zeile mit\u200bversteckten\u00adZeichen'),
      t(
        'Ein zweiter Absatz mit genug Text, damit es ein Lehrtext ist. '.repeat(
          10
        )
      ),
    ]);
    expect(result.excerpt).toContain(
      'Eine Zeile mit' + 'versteckten' + 'Zeichen'
    );
    expect(result.excerpt).not.toMatch(/[\u200b\u00ad]/);
    expect(result.excerpt).not.toMatch(/^\s*#/m);
  });

  it('protects every line of an excerpt once and not again', () => {
    const result = build(enablerBlocks());
    const first = protectExcerptLines(lines(result.excerpt), { solutions: [] });
    expect(first.lines).toEqual(lines(result.excerpt));
    expect(first).toMatchObject({
      markerHits: 0,
      leakHits: 0,
      personal: 0,
      other: 0,
      instruction: [],
    });
  });
});
