/**
 * @jest-environment node
 */
// The public face of the rule stage and a run over a small invented tree: the
// special cases of the real source must end in the review list, not in the
// transfer.
import { describe, expect, it } from '@jest/globals';

import * as classify from '@/lib/content-upload/classify';
import type { Paragraph } from '@/lib/content-import/types';

import {
  DIR,
  GLOBAL,
  enablerDoc,
  globalQuizDoc,
  listOfPaths,
  loadDecisions,
  paths,
  quizDoc,
  scenarioDoc,
  useCaseDoc,
} from '../../../helpers/classifyFixtures';

const decisions = loadDecisions();

describe('the exports', () => {
  it('names the functions that U2, U6 and U7 bind in', () => {
    expect(Object.keys(classify).sort()).toEqual(
      expect.arrayContaining([
        'analyzeDuplicates',
        'assignFile',
        'buildPositiveList',
        'classifyByContent',
        'classifyByPath',
        'deriveComponentFacts',
        'findSimilarDocuments',
        'fingerprintOf',
        'jaccardOf',
        'positiveListFromPaths',
        'toProposalRow',
        'versionOfPath',
        'visibilityOf',
      ])
    );
  });
});

describe('a run over an invented tree', () => {
  const HOUR = 3600 * 1000;
  const BASE = Date.UTC(2026, 9, 1, 8, 0, 0);

  interface Item {
    rel: string;
    doc: Paragraph[];
    mtimeMs: number;
    sha: string;
  }
  const items: Item[] = [
    {
      rel: paths.enabler(DIR.k1, '1a'),
      doc: enablerDoc('1a'),
      mtimeMs: BASE,
      sha: '1',
    },
    {
      rel: paths.quiz(DIR.k1, '1a', 'Low'),
      doc: quizDoc('1a', 'leicht'),
      mtimeMs: BASE,
      sha: '2',
    },
    {
      rel: paths.quiz(DIR.k1, '1a', 'Medium'),
      doc: quizDoc('1a', 'mittel'),
      mtimeMs: BASE,
      sha: '3',
    },
    // a scenario of 23c in the folder of 23b: a conflict
    {
      rel: paths.scenario(DIR.k23, '23b'),
      doc: scenarioDoc('23c'),
      mtimeMs: BASE,
      sha: '4',
    },
    {
      rel: paths.scenario(DIR.k23, '23c'),
      doc: scenarioDoc('23c', { tag: 'anders' }),
      mtimeMs: BASE,
      sha: '5',
    },
    // a global quiz that lies twice, a few hours apart
    {
      rel: `${GLOBAL}/Word/01_Global_Quiz_X.docx`,
      doc: globalQuizDoc('01', { tag: 'x' }),
      mtimeMs: BASE,
      sha: '6',
    },
    {
      rel: paths.globalQuiz(DIR.k1, '01'),
      doc: globalQuizDoc('01', { tag: 'y' }),
      mtimeMs: BASE + 3 * HOUR,
      sha: '7',
    },
    // a use case of 5b: the copy without a solution
    {
      rel: paths.useCase(DIR.k1, '1', '1b'),
      doc: useCaseDoc('1b'),
      mtimeMs: BASE,
      sha: '8',
    },
    {
      rel: `${DIR.k1}/K1_Use-Cases/Ohne Musterlösung/UC_1b_Titel.docx`,
      doc: useCaseDoc('1b', { tag: 'ohne' }),
      mtimeMs: BASE + 200 * HOUR,
      sha: '9',
    },
    // an archive file
    {
      rel: `${DIR.k1}/Enablers/1a_Thema/Enabler_Archiv_to_delete/1a.docx`,
      doc: enablerDoc('1a'),
      mtimeMs: BASE + 500 * HOUR,
      sha: 'a',
    },
  ];
  const list = listOfPaths(items.map(i => i.rel));

  const proposals = items.map(item =>
    classify.assignFile({
      relPath: item.rel,
      paragraphs: item.doc,
      positiveList: list,
      decisions,
    })
  );
  const byRel = new Map(items.map((item, i) => [item.rel, proposals[i]]));

  it('puts the clean files in the band high and the special cases elsewhere', () => {
    expect(byRel.get(paths.enabler(DIR.k1, '1a'))?.band).toBe('high');
    expect(byRel.get(paths.quiz(DIR.k1, '1a', 'Low'))?.band).toBe('high');
    expect(byRel.get(paths.scenario(DIR.k23, '23b'))?.band).toBe('conflict');
    expect(byRel.get(paths.scenario(DIR.k23, '23c'))?.band).toBe('high');
    expect(
      byRel.get(`${DIR.k1}/Enablers/1a_Thema/Enabler_Archiv_to_delete/1a.docx`)
        ?.fileStatus
    ).toBe('skipped');
  });

  it('finds the known duplicate cases and no false one', () => {
    const analysis = classify.analyzeDuplicates(
      items.map((item, i) => ({
        id: `f${i}`,
        sha256: item.sha
          .repeat(64)
          .slice(0, 64)
          .replace(/[^0-9a-f]/g, '0'),
        relPath: item.rel,
        mtimeMs: item.mtimeMs,
        archived:
          proposals[i].fileStatus === 'skipped' &&
          proposals[i].statusCode === 'ARCHIVE_PATH',
        withoutSolution: item.rel.includes('Ohne Musterl'),
        assignment: proposals[i].recognized
          ? {
              docType: proposals[i].docType,
              componentCode: proposals[i].componentCode,
              enablerCode: proposals[i].enablerCode,
              quizLevel: proposals[i].quizLevel,
              originalType: proposals[i].originalType,
            }
          : null,
      }))
    );
    const keys = analysis.keyGroups.map(g => g.key).sort();
    expect(keys).toEqual(['global-quiz:01', 'use-case:1b']);
    const global = analysis.keyGroups.find(g => g.key === 'global-quiz:01');
    expect(global).toMatchObject({ ambiguous: true, suggestedId: null });
    const useCase = analysis.keyGroups.find(g => g.key === 'use-case:1b');
    expect(useCase).toMatchObject({ ambiguous: true, suggestedId: null });
    expect(useCase?.reasons.map(r => r.code)).toContain('SOLUTION_VARIANT');
    expect(analysis.excluded).toEqual([{ id: 'f9', reason: 'ARCHIVE' }]);
  });
});
