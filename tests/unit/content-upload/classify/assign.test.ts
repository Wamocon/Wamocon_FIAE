/**
 * @jest-environment node
 */
// The rule stage of the assignment: path rule and content rule together, the
// check against the positive list, confidence and band, the reasons and the
// row for content_upload_proposals (concept 6.2, migration 20261030000100).
import { describe, expect, it } from '@jest/globals';

import type { Paragraph } from '@/lib/content-import/types';
import {
  assignFile,
  toProposalRow,
  type AssignInput,
  type RuleProposal,
} from '@/lib/content-upload/classify/assign';
import { buildPositiveList } from '@/lib/content-upload/classify/positive-list';
import { paragraphsFromText } from '@/lib/content-upload/excerpt';

import {
  DIR,
  GLOBAL,
  T1,
  enablerDoc,
  globalQuizDoc,
  listOfPaths,
  loadDecisions,
  paths,
  quizDoc,
  scenarioDoc,
  smallList,
  unknownDoc,
  useCaseDoc,
  withPdfHeader,
} from '../../../helpers/classifyFixtures';

const decisions = loadDecisions();
const list = smallList();

const run = (
  relPath: string,
  paragraphs: Paragraph[] | null | undefined,
  extra: Partial<AssignInput> = {}
): RuleProposal =>
  assignFile({
    relPath,
    paragraphs,
    positiveList: list,
    decisions,
    ...extra,
  });

const codes = (proposal: RuleProposal) => proposal.reasons.map(r => r.code);

describe('assignFile: path and content agree', () => {
  it('gives band high with 0.99 and the source path_content', () => {
    const p = run(paths.quiz(DIR.k1, '1a', 'Low'), quizDoc('1a', 'leicht'));
    expect(p).toMatchObject({
      docType: 'quiz',
      componentCode: 'K1',
      enablerCode: 'K1-a',
      quizLevel: 'low',
      source: 'path_content',
      band: 'high',
      confidence: 0.99,
      recognized: true,
      accepted: true,
      isNew: false,
      fileStatus: 'proposed_rules',
      statusCode: null,
      dupKey: 'quiz:1a:low',
      group: 'teil1',
      alternatives: [],
    });
    expect(p.facts).toMatchObject({ kind: 'pflicht', phase: 1 });
    expect(p.visibility?.originalMayBePublic).toBe(false);
    expect(codes(p)).toEqual(
      expect.arrayContaining([
        'PATH_RULE',
        'CONTENT_RULE',
        'AGREE',
        'IN_POSITIVE_LIST',
      ])
    );
    expect(p.rules).toEqual(
      expect.arrayContaining([
        'path-rule',
        'content-rule',
        'positive-list',
        'confidence-agree',
      ])
    );
  });

  it('gives high for every type', () => {
    const cases: Array<[string, Paragraph[], string]> = [
      [paths.enabler(DIR.k1, '1b'), enablerDoc('1b'), 'enabler'],
      [paths.scenario(DIR.k1, '1b'), scenarioDoc('1b'), 'scenario'],
      [paths.useCase(DIR.k1, '1', '1b'), useCaseDoc('1b'), 'use_case'],
      [
        paths.globalQuiz(DIR.k6_1, '06.1'),
        globalQuizDoc('06.1'),
        'global_quiz',
      ],
    ];
    for (const [path, doc, type] of cases) {
      expect(run(path, doc)).toMatchObject({
        docType: type,
        band: 'high',
        confidence: 0.99,
      });
    }
  });

  it('lets a heading without a split agree with a folder with a split where the heading is unique', () => {
    // 6e exists only in K6.2: the content alone names it, the sources agree
    const p = run(paths.enabler(DIR.k6_2, '6e'), enablerDoc('6e'));
    expect(p).toMatchObject({
      componentCode: 'K6.2',
      enablerCode: 'K6.2-e',
      band: 'high',
      confidence: 0.99,
      source: 'path_content',
    });
  });

  it('does not count a heading that fits two components as a second source', () => {
    // 6d exists in K6.1 and K6.2: the content does not contradict the path,
    // but the path decides alone
    const p = run(paths.enabler(DIR.k6_2, '6d'), enablerDoc('6d'));
    expect(p).toMatchObject({
      componentCode: 'K6.2',
      enablerCode: 'K6.2-d',
      band: 'high',
      confidence: 0.9,
      source: 'path',
    });
  });

  it('tolerates a warning of the parser when two sources agree, and names it', () => {
    const p = run(
      paths.quiz(DIR.k1, '1a', 'Low'),
      quizDoc('1a', 'leicht', { heading: 'Quiz 1a: Netz' })
    );
    expect(p).toMatchObject({ band: 'high', confidence: 0.99 });
    expect(codes(p)).toContain('HEADING_VARIANT');
  });

  it('does not let the errors of the parser count for a PDF', () => {
    const lines = withPdfHeader(globalQuizDoc('06.1')).map(x => x.text);
    // a page footer between the lines, as a real PDF has it
    lines.splice(
      lines.findIndex(line => line.startsWith('Richtige Antwort')) + 1,
      0,
      'Seite 2 von 6'
    );
    const p = run(
      `${GLOBAL}/PDF/06.1_Global_Quiz_Thema.pdf`,
      paragraphsFromText(lines.join('\n')),
      { format: 'pdf' }
    );
    expect(p).toMatchObject({ band: 'high', docType: 'pdf_original' });
    expect(p.parser.errors.length).toBeGreaterThan(0);
  });

  it('reads a PDF original of a global quiz and binds it to its content key', () => {
    const text = withPdfHeader(globalQuizDoc('06.1'))
      .map(x => x.text)
      .join('\n');
    const p = run(
      `${GLOBAL}/PDF/06.1_Global_Quiz_Thema.pdf`,
      paragraphsFromText(text),
      {
        format: 'pdf',
      }
    );
    expect(p).toMatchObject({
      docType: 'pdf_original',
      originalType: 'global_quiz',
      componentCode: 'K6.1',
      source: 'path_content',
      band: 'high',
      dupKey: 'pdf:global-quiz:06.1',
    });
    expect(p.visibility?.originalMayBePublic).toBe(false);
  });
});

describe('assignFile: one source only', () => {
  it('gives high with 0.90 for the path alone', () => {
    const p = run(paths.quiz(DIR.k1, '1a', 'Low'), undefined);
    expect(p).toMatchObject({
      source: 'path',
      band: 'high',
      confidence: 0.9,
      enablerCode: 'K1-a',
      quizLevel: 'low',
    });
    expect(codes(p)).toContain('CONTENT_NOT_READ');
  });

  it('gives high with 0.95 for the content alone', () => {
    const p = run('lose-datei.docx', quizDoc('1b', 'mittel'));
    expect(p).toMatchObject({
      docType: 'quiz',
      componentCode: 'K1',
      enablerCode: 'K1-b',
      quizLevel: 'medium',
      source: 'content',
      band: 'high',
      confidence: 0.95,
      accepted: true,
      group: 'teil1',
      dupKey: 'quiz:1b:medium',
    });
    expect(codes(p)).toContain('PATH_NONE');
  });

  it('takes the group of the component from the positive list when there is no path', () => {
    const p = run('x.docx', enablerDoc('6e'));
    expect(p.facts).toMatchObject({
      kind: 'pflicht',
      phase: 2,
      group: 'teil2',
    });
  });

  it('gives medium with 0.70 for the content alone with a heading variant', () => {
    const p = run(
      'x.docx',
      quizDoc('1b', 'leicht', { heading: 'Quiz 1b: Netz' })
    );
    expect(p).toMatchObject({
      band: 'medium',
      confidence: 0.7,
      source: 'content',
    });
    expect(codes(p)).toContain('HEADING_VARIANT');
    expect(p.fileStatus).toBe('proposed_rules');
  });

  it('gives low when a code without a split fits two components', () => {
    const p = run('x.docx', enablerDoc('6d'));
    expect(p).toMatchObject({
      docType: 'enabler',
      componentCode: null,
      enablerCode: null,
      band: 'low',
      confidence: 0.5,
      accepted: false,
      fileStatus: 'unclear',
    });
    expect(codes(p)).toContain('AMBIGUOUS_CODE');
    expect(p.reasons.find(r => r.code === 'AMBIGUOUS_CODE')?.text).toContain(
      'K6.1-d'
    );
  });

  it('gives low with 0.50 for a path with issues alone', () => {
    const p = run(
      `${DIR.k1}/Enablers/1a_Thema/Quiz/1b_Quiz_Low.docx`,
      undefined
    );
    expect(p).toMatchObject({
      band: 'low',
      confidence: 0.5,
      fileStatus: 'unclear',
    });
    expect(codes(p)).toContain('PATH_ISSUES');
  });

  it('gives medium for a path that the content does not confirm', () => {
    const p = run(paths.enabler(DIR.k1, '1a'), unknownDoc());
    expect(p).toMatchObject({
      source: 'path',
      band: 'medium',
      confidence: 0.7,
      docType: 'enabler',
    });
    expect(codes(p)).toContain('CONTENT_UNCONFIRMED');
  });

  it('gives medium at most when the path has issues and the content agrees', () => {
    const p = run(
      `${DIR.k1}/Enablers/1a_Thema/Quiz/Quiz_final.docx`,
      quizDoc('1a', 'leicht')
    );
    expect(p).toMatchObject({ band: 'medium', source: 'content' });
    expect(codes(p)).toEqual(expect.arrayContaining(['PATH_ISSUES']));
  });

  it('gives nothing and says why when nothing is recognized', () => {
    const p = run('x.docx', unknownDoc());
    expect(p).toMatchObject({
      recognized: false,
      docType: null,
      componentCode: null,
      enablerCode: null,
      quizLevel: null,
      band: 'low',
      confidence: 0,
      accepted: false,
      fileStatus: 'unclear',
      statusCode: 'NO_STRUCTURE',
      dupKey: null,
    });
    expect(codes(p)).toEqual(
      expect.arrayContaining(['PATH_NONE', 'CONTENT_NONE'])
    );
  });

  it('gives nothing for no path and no content at all', () => {
    const p = run('', undefined);
    expect(p).toMatchObject({ recognized: false, band: 'low', confidence: 0 });
  });
});

describe('assignFile: the two sources contradict each other', () => {
  it('reports a scenario of enabler 23c in the folder of 23b as a conflict', () => {
    const p = run(paths.scenario(DIR.k23, '23b'), scenarioDoc('23c'));
    expect(p).toMatchObject({
      band: 'conflict',
      confidence: 0.3,
      docType: 'scenario',
      enablerCode: null,
      accepted: false,
      fileStatus: 'proposed_rules',
      dupKey: null,
    });
    expect(codes(p)).toContain('CONFLICT_ENABLER');
    expect(p.alternatives).toEqual([
      expect.objectContaining({ source: 'path', enablerCode: 'K23-b' }),
      expect.objectContaining({ source: 'content', enablerCode: 'K23-c' }),
    ]);
  });

  it('reports a different type as a conflict', () => {
    const p = run(paths.quiz(DIR.k1, '1a', 'Low'), scenarioDoc('1a'));
    expect(p).toMatchObject({ band: 'conflict', docType: null });
    expect(codes(p)).toContain('CONFLICT_TYPE');
  });

  it('reports a different level as a conflict', () => {
    const p = run(paths.quiz(DIR.k1, '1a', 'Low'), quizDoc('1a', 'mittel'));
    expect(p).toMatchObject({
      band: 'conflict',
      docType: 'quiz',
      enablerCode: 'K1-a',
      quizLevel: null,
    });
    expect(codes(p)).toContain('CONFLICT_LEVEL');
  });

  it('reports a different component of a global quiz as a conflict', () => {
    const p = run(paths.globalQuiz(DIR.k1, '01'), globalQuizDoc('06.1'));
    expect(p).toMatchObject({ band: 'conflict', docType: 'global_quiz' });
    expect(codes(p)).toContain('CONFLICT_COMPONENT');
  });

  it('keeps the conflict even when the content has parser errors', () => {
    const broken = scenarioDoc('23c').filter(x => x.text !== 'Lösungsszenario');
    expect(run(paths.scenario(DIR.k23, '23b'), broken).band).toBe('conflict');
  });

  it('lets a body text never win against the path', () => {
    const doc = enablerDoc('1b');
    doc.splice(2, 0, { text: '1a) Ich bin ein anderer Enabler', bold: false });
    const p = run(paths.enabler(DIR.k1, '1b'), doc);
    expect(p).toMatchObject({ band: 'high', enablerCode: 'K1-b' });
  });
});

describe('assignFile: what the reviews found', () => {
  it('reports a component that differs although the path names no enabler', () => {
    const p = run(`${DIR.k1}/Enablers/Thema/foo.docx`, enablerDoc('6.1a'));
    expect(p.band).toBe('conflict');
    expect(codes(p)).toContain('CONFLICT_COMPONENT');
  });

  it('takes a path without an enabler for no conflict when the component agrees', () => {
    const p = run(`${DIR.k1}/Enablers/Thema/foo.docx`, enablerDoc('1a'));
    expect(p.band).not.toBe('conflict');
  });

  it('lets other warnings of the parser lower a content-only proposal to medium', () => {
    const doc = quizDoc('1a', 'leicht').map(x =>
      x.text.startsWith('Richtige Antwort')
        ? { ...x, text: 'Richtige Antwort: b' }
        : x
    );
    const p = run('x.docx', doc);
    expect(p.parser.warnings).toContain('ANSWER_LOWERCASE');
    expect(p).toMatchObject({ band: 'medium', source: 'content' });
    expect(codes(p)).toContain('PARSER_WARNINGS');
    // two sources that agree are not lowered by it
    expect(run(paths.quiz(DIR.k1, '1a', 'Low'), doc).band).toBe('high');
  });

  it('does not let a hint of the path make an ambiguous code unique', () => {
    const p = run(paths.enabler(DIR.k6_2, '6d'), enablerDoc('6d'));
    expect(p).toMatchObject({
      source: 'path',
      band: 'high',
      confidence: 0.9,
      enablerCode: 'K6.2-d',
    });
    expect(codes(p)).toContain('CONTENT_AMBIGUOUS_COMPATIBLE');
    // the same content alone stays open
    expect(run('x.docx', enablerDoc('6d')).band).toBe('low');
  });

  it('lowers an enabler text with a marker word of a solution', () => {
    const doc = enablerDoc('1a');
    doc.splice(3, 0, { text: 'Kurzbegründung: das steht hier', bold: false });
    const p = run('x.docx', doc);
    expect(p.band).toBe('medium');
    expect(codes(p)).toContain('SOLUTION_MARKER');
    // also when the marker is spelled with an invisible character
    const hidden = enablerDoc('1a');
    hidden.splice(3, 0, {
      text: 'Kurz͏begründung: das steht hier',
      bold: false,
    });
    expect(run('x.docx', hidden).band).toBe('medium');
    expect(run('x.docx', enablerDoc('1a')).band).toBe('high');
  });

  it('lowers a file that was read only in part', () => {
    const doc = enablerDoc('1a');
    for (let i = 0; i < 120; i += 1) {
      doc.push({ text: 'x'.repeat(4000), bold: false });
    }
    const p = run('x.docx', doc);
    expect(p.band).toBe('medium');
    expect(p.contentRead).toBe(true);
    const huge = enablerDoc('1a');
    for (let i = 0; i < 6000; i += 1)
      huge.push({ text: `Absatz ${i}`, bold: false });
    expect(run(paths.enabler(DIR.k1, '1a'), huge).band).toBe('medium');
  });

  it('knows a PDF by its content alone only as medium', () => {
    const text = withPdfHeader(globalQuizDoc('06.1'))
      .map(x => x.text)
      .join('\n');
    const p = run('x.pdf', paragraphsFromText(text), { format: 'pdf' });
    expect(p).toMatchObject({
      docType: 'pdf_original',
      band: 'medium',
      source: 'content',
    });
    expect(codes(p)).toContain('PDF_CONTENT_ONLY');
    expect(codes(p)).toContain('PDF_HEADER_SKIPPED');
  });

  it('notes an archive folder above the tree and lowers the band', () => {
    const p = run(
      `Archiv/Komponente/${paths.enabler(DIR.k1, '1a')}`,
      enablerDoc('1a')
    );
    expect(p.band).toBe('medium');
    expect(codes(p)).toContain('ARCHIVE_ABOVE_TREE');
    // a folder called Archiv inside the tree is an archive file
    expect(
      run(`${DIR.k1}/Enablers/1a_Thema/Archiv/1a.docx`, enablerDoc('1a'))
    ).toMatchObject({
      fileStatus: 'skipped',
      statusCode: 'ARCHIVE_PATH',
    });
  });

  it('does not let a path that is too long raise a content only proposal', () => {
    const p = run(`${'a/'.repeat(600)}x.docx`, enablerDoc('1a'));
    expect(p.band).toBe('low');
    expect(p.fileStatus).toBe('unclear');
    expect(codes(p)).toContain('PATH_TOO_LONG');
  });

  it('does not let a file that failed to read look like one that was not tried', () => {
    const untried = run(paths.quiz(DIR.k1, '1a', 'Low'), undefined, {
      contentStatus: 'skipped',
    });
    expect(untried).toMatchObject({ band: 'high', confidence: 0.9 });
    const failed = run(
      paths.quiz(DIR.k1, '1a', 'Low'),
      quizDoc('1a', 'leicht'),
      {
        contentStatus: 'failed',
      }
    );
    expect(failed).toMatchObject({
      band: 'medium',
      source: 'path',
      contentRead: false,
    });
    expect(codes(failed)).toContain('CONTENT_UNREADABLE');
  });

  it('lets the group of the database decide the phase and notes a differing folder', () => {
    const wrongPhase = buildPositiveList({
      components: [
        { code: 'K1', group: 'teil2', enablers: [{ code: 'K1-a' }] },
      ],
    });
    const p = run(paths.enabler(DIR.k1, '1a'), enablerDoc('1a'), {
      positiveList: wrongPhase,
    });
    expect(p.band).toBe('medium');
    expect(codes(p)).toContain('GROUP_FOLDER_MISMATCH');
    expect(p.facts).toMatchObject({
      kind: 'pflicht',
      phase: 2,
      group: 'teil2',
    });
  });

  it('lowers a file whose group is unknown for a mandatory component', () => {
    const noGroup = buildPositiveList({
      components: [{ code: 'K1', enablers: [{ code: 'K1-a' }] }],
    });
    const p = run('x.docx', enablerDoc('1a'), { positiveList: noGroup });
    expect(p.band).toBe('medium');
    expect(codes(p)).toContain('NO_GROUP');
  });

  it('names the reason of the path as status code when nothing is read', () => {
    expect(run('a.doc', undefined).statusCode).toBe('NO_STRUCTURE');
    expect(
      run(`${DIR.k1}/Enablers/1a_Thema/Quiz/1a_Quiz_Low.doc`, undefined)
        .statusCode
    ).toBe('UNSUPPORTED_FORMAT');
    expect(run('', undefined).statusCode).toBe('EMPTY_PATH');
  });
});

describe('assignFile: the positive list and the plan', () => {
  it('does not accept a code that is not on the list', () => {
    const p = run(`${DIR.k1}/Enablers/1z_Thema/1z.docx`, enablerDoc('1z'));
    expect(p).toMatchObject({
      band: 'low',
      confidence: 0.5,
      accepted: false,
      fileStatus: 'unclear',
      docType: 'enabler',
    });
    expect(codes(p)).toContain('NOT_IN_POSITIVE_LIST');
  });

  it('does not accept a component that is not on the list', () => {
    const p = run(paths.enabler(DIR.k10, '10a'), enablerDoc('10a'));
    expect(p).toMatchObject({ band: 'low', accepted: false });
    expect(codes(p)).toContain('NOT_IN_POSITIVE_LIST');
  });

  it('accepts a code that only the plan of the folder tree would add, as medium and new', () => {
    const planned = listOfPaths([paths.enabler(DIR.k10, '10a')], 'plan');
    const p = run(paths.enabler(DIR.k10, '10a'), enablerDoc('10a'), {
      positiveList: planned,
    });
    expect(p).toMatchObject({
      band: 'medium',
      confidence: 0.7,
      accepted: true,
      isNew: true,
      fileStatus: 'proposed_rules',
    });
    expect(codes(p)).toContain('NEW_IN_PLAN');
  });

  it('works with an empty list: nothing is accepted', () => {
    const p = run(paths.enabler(DIR.k1, '1a'), enablerDoc('1a'), {
      positiveList: listOfPaths([]),
    });
    expect(p).toMatchObject({ accepted: false, band: 'low' });
  });
});

describe('assignFile: parser errors and the facts of the component', () => {
  it('gives medium when the parser found errors, the assignment is still sure', () => {
    const broken = quizDoc('1a', 'leicht').filter(
      x => !x.text.startsWith('Richtige Antwort')
    );
    const p = run(paths.quiz(DIR.k1, '1a', 'Low'), broken);
    expect(p).toMatchObject({
      band: 'medium',
      confidence: 0.7,
      docType: 'quiz',
      enablerCode: 'K1-a',
      fileStatus: 'proposed_rules',
    });
    expect(codes(p)).toContain('PARSER_ERRORS');
    expect(p.reasons.find(r => r.code === 'PARSER_ERRORS')?.text).toContain(
      'ANSWER_MISSING'
    );
  });

  it('gives low when the type is known but not the level', () => {
    const p = run('x.docx', quizDoc('1a', 'unbekannt'));
    expect(p).toMatchObject({
      docType: 'quiz',
      enablerCode: 'K1-a',
      quizLevel: null,
      band: 'low',
      fileStatus: 'unclear',
    });
    expect(codes(p)).toContain('INCOMPLETE');
  });

  it('skips a file of an excluded component', () => {
    const withK18 = listOfPaths([paths.enabler(DIR.k18, '18a')]);
    const p = run(paths.enabler(DIR.k18, '18a'), enablerDoc('18a'), {
      positiveList: withK18,
    });
    expect(p).toMatchObject({
      fileStatus: 'skipped',
      statusCode: 'COMPONENT_EXCLUDED',
      accepted: false,
      band: 'low',
    });
  });

  it('reports a kind that does not fit the folder group as a conflict', () => {
    const wrong = `${T1}/12 - Erfundenes Wahlthema Zwei (§ 4 Abs. 3 Nr. 3)`;
    const p = run(paths.enabler(wrong, '12a'), enablerDoc('12a'));
    expect(p).toMatchObject({ band: 'conflict', accepted: false });
    expect(codes(p)).toContain('KIND_GROUP_MISMATCH');
  });

  it('reports a component without a decision', () => {
    const withK26 = listOfPaths([paths.enabler(DIR.k26, '26a')]);
    const p = run(paths.enabler(DIR.k26, '26a'), enablerDoc('26a'), {
      positiveList: withK26,
    });
    expect(p).toMatchObject({ band: 'low', accepted: false });
    expect(codes(p)).toContain('NO_DECISION');
  });

  it('skips a file in an archive folder', () => {
    const p = run(
      `${DIR.k1}/Enablers/1a_Thema/Enabler_Archiv_to_delete/1a.docx`,
      enablerDoc('1a')
    );
    expect(p).toMatchObject({
      fileStatus: 'skipped',
      statusCode: 'ARCHIVE_PATH',
      accepted: false,
      recognized: false,
    });
  });
});

describe('assignFile: reasons carry codes, never the text of a document', () => {
  const sample = (): RuleProposal[] => [
    run(
      paths.quiz(DIR.k1, '1a', 'Low'),
      quizDoc('1a', 'leicht', { tag: 'KANARIE' })
    ),
    run(
      'x.docx',
      quizDoc('1b', 'leicht', { heading: 'Quiz 1b: KANARIE Titel' })
    ),
    run('x.docx', enablerDoc('6d', { tag: 'KANARIE' })),
    run(paths.scenario(DIR.k23, '23b'), scenarioDoc('23c', { tag: 'KANARIE' })),
    run('x.docx', unknownDoc()),
    run(paths.quiz(DIR.k1, '1a', 'Low'), quizDoc('1a', 'leicht').slice(0, 20)),
  ];

  it('keeps every reason short and in the shape of the table', () => {
    for (const p of sample()) {
      expect(p.reasons.length).toBeGreaterThan(0);
      for (const reason of p.reasons) {
        expect(reason.code).toMatch(/^[A-Z][A-Z0-9_]+$/);
        expect(reason.text.length).toBeGreaterThan(0);
        expect(reason.text.length).toBeLessThanOrEqual(200);
      }
    }
  });

  it('never repeats a title, a question or a message of a parser', () => {
    for (const p of sample()) {
      const text = JSON.stringify(p);
      expect(text).not.toMatch(
        /KANARIE|Erfundene Frage|Erfundenes Thema|Netzwerk/
      );
    }
  });

  it('writes the reasons in German with real umlauts and without dashes', () => {
    for (const p of sample()) {
      for (const reason of p.reasons) {
        expect(reason.text).not.toMatch(/[–—]/);
        expect(reason.text).not.toMatch(/\b(?:ae|oe|ue)\b/i);
      }
    }
  });
});

describe('toProposalRow: the row for content_upload_proposals', () => {
  it('maps a proposal to the columns of the table', () => {
    const p = run(paths.quiz(DIR.k1, '1a', 'Low'), quizDoc('1a', 'leicht'));
    expect(toProposalRow(p)).toEqual({
      source: 'path_content',
      doc_type: 'quiz',
      component_code: 'K1',
      enabler_code: 'K1-a',
      quiz_level: 'low',
      confidence: 0.99,
      band: 'high',
      reasons: p.reasons,
      model: null,
      is_current: true,
    });
  });

  it('keeps every value inside the checks of the migration', () => {
    const proposals = [
      run(paths.quiz(DIR.k1, '1a', 'Low'), quizDoc('1a', 'leicht')),
      run(paths.quiz(DIR.k1, '1a', 'Low'), undefined),
      run('x.docx', quizDoc('1b', 'mittel')),
      run('x.docx', unknownDoc()),
      run('', undefined),
      run(paths.scenario(DIR.k23, '23b'), scenarioDoc('23c')),
      run(paths.enabler(DIR.k1, '1z'), enablerDoc('1z')),
      run(
        `${DIR.k1}/Enablers/1a_Thema/Enabler_Archiv_to_delete/1a.docx`,
        enablerDoc('1a')
      ),
    ];
    for (const p of proposals) {
      const row = toProposalRow(p);
      expect(['path', 'content', 'path_content']).toContain(row.source);
      expect(['high', 'medium', 'low', 'conflict']).toContain(row.band);
      expect(row.confidence).toBeGreaterThanOrEqual(0);
      expect(row.confidence).toBeLessThanOrEqual(1);
      expect(Math.round(row.confidence * 100) / 100).toBe(row.confidence);
      if (row.doc_type !== null) {
        expect([
          'enabler',
          'quiz',
          'global_quiz',
          'scenario',
          'use_case',
          'pdf_original',
          'other',
        ]).toContain(row.doc_type);
      }
      if (row.quiz_level !== null) {
        expect(['low', 'medium', 'high']).toContain(row.quiz_level);
      }
      expect((row.component_code ?? '').length).toBeLessThanOrEqual(32);
      expect((row.enabler_code ?? '').length).toBeLessThanOrEqual(32);
      expect(Array.isArray(row.reasons)).toBe(true);
      expect(row.model).toBeNull();
    }
  });

  it('never makes a rule proposal a model proposal', () => {
    const rows = [
      run(paths.quiz(DIR.k1, '1a', 'Low'), quizDoc('1a', 'leicht')),
      run('x.docx', unknownDoc()),
    ].map(toProposalRow);
    for (const row of rows) expect(row.source).not.toBe('ki');
  });

  it('gives the source path for a file that was not read and content for one that was', () => {
    expect(toProposalRow(run('', undefined)).source).toBe('path');
    expect(toProposalRow(run('x.docx', unknownDoc())).source).toBe('content');
  });
});

describe('assignFile: invariants', () => {
  const docs: Array<[string, () => Paragraph[]]> = [
    ['quiz', () => quizDoc('1a', 'leicht')],
    ['quiz6d', () => quizDoc('6d', 'mittel')],
    ['scenario', () => scenarioDoc('1a')],
    ['useCase', () => useCaseDoc('1a')],
    ['enabler', () => enablerDoc('1a')],
    ['enabler1z', () => enablerDoc('1z')],
    ['global', () => globalQuizDoc('01')],
    ['unknown', () => unknownDoc()],
  ];
  const pathsToTry = [
    '',
    'x.docx',
    paths.quiz(DIR.k1, '1a', 'Low'),
    paths.scenario(DIR.k1, '1a'),
    paths.enabler(DIR.k1, '1a'),
    paths.enabler(DIR.k6_2, '6d'),
    `${DIR.k1}/Enablers/1a_Thema/Quiz/1b_Quiz_Low.docx`,
    paths.enabler(DIR.k10, '10a'),
  ];

  it('gives band high only for a complete, accepted and error free assignment', () => {
    for (const path of pathsToTry) {
      for (const [, make] of docs) {
        for (const paragraphs of [make(), undefined]) {
          const p = run(path, paragraphs);
          if (p.band !== 'high') continue;
          expect(p.recognized).toBe(true);
          expect(p.accepted).toBe(true);
          expect(p.fileStatus).toBe('proposed_rules');
          expect(p.docType).not.toBeNull();
          expect(p.componentCode).not.toBeNull();
          expect(p.facts?.kind).not.toBeNull();
          expect(p.facts?.issues).toEqual([]);
          expect(p.isNew).toBe(false);
          if (p.docType !== 'global_quiz') expect(p.enablerCode).not.toBeNull();
          if (p.docType === 'quiz') expect(p.quizLevel).not.toBeNull();
          expect(['path', 'content', 'path_content']).toContain(p.source);
        }
      }
    }
  });

  it('gives no band high with a conflict, and no conflict with a status unclear', () => {
    for (const path of pathsToTry) {
      for (const [, make] of docs) {
        const p = run(path, make());
        if (p.band === 'conflict') expect(p.fileStatus).toBe('proposed_rules');
        if (p.fileStatus === 'unclear') expect(p.band).toBe('low');
        if (p.band === 'conflict') expect(p.confidence).toBe(0.3);
      }
    }
  });

  it('is deterministic and does not change its input', () => {
    const doc = quizDoc('1a', 'leicht');
    const before = JSON.stringify(doc);
    const a = run(paths.quiz(DIR.k1, '1a', 'Low'), doc);
    const b = run(paths.quiz(DIR.k1, '1a', 'Low'), doc);
    expect(a).toEqual(b);
    expect(JSON.stringify(doc)).toBe(before);
  });

  it('survives odd input', () => {
    expect(() =>
      assignFile({
        relPath: undefined as unknown as string,
        paragraphs: 'x' as unknown as Paragraph[],
        positiveList: list,
        decisions,
      })
    ).not.toThrow();
    expect(() =>
      assignFile({
        relPath: '\0'.repeat(10),
        paragraphs: [null as unknown as Paragraph],
        positiveList: list,
        decisions,
      })
    ).not.toThrow();
  });

  it('is not slowed down by a long path', () => {
    const start = Date.now();
    run(`${T1}/${'a'.repeat(5000)}.docx`, enablerDoc('1a'));
    expect(Date.now() - start).toBeLessThan(1000);
  });
});
