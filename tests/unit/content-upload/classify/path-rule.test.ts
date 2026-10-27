/**
 * @jest-environment node
 */
// The path rule: type, component, enabler, level and group from the relative
// path of an uploaded file. A path that does not follow the structure of the
// source tree gives nothing, the rule never guesses.
import { describe, expect, it } from '@jest/globals';

import { classifyByPath } from '@/lib/content-upload/classify/path-rule';

import {
  ALL,
  DIR,
  GLOBAL,
  T1,
  T2,
  paths,
} from '../../../helpers/classifyFixtures';

const match = (path: string) => {
  const result = classifyByPath(path);
  if (result.kind !== 'match') {
    throw new Error(`expected a match for ${path}, got ${result.kind}`);
  }
  return result;
};

describe('classifyByPath: the files of the source tree', () => {
  it('reads an enabler quiz', () => {
    expect(match(paths.quiz(DIR.k1, '1a', 'Medium'))).toMatchObject({
      docType: 'quiz',
      originalType: null,
      componentCode: 'K1',
      componentKey: '01',
      componentTitle: 'Erfundenes Thema Eins',
      componentParagraph: '§ 4 Abs. 2 Nr. 1',
      enablerCode: 'K1-a',
      enablerKey: '1a',
      quizLevel: 'medium',
      group: 'teil1',
      contentKey: 'quiz:1a:medium',
      version: null,
      issues: [],
      rebased: false,
    });
  });

  it('reads the three levels of a quiz', () => {
    expect(match(paths.quiz(DIR.k1, '1a', 'Low')).quizLevel).toBe('low');
    expect(match(paths.quiz(DIR.k1, '1a', 'High')).quizLevel).toBe('high');
  });

  it('reads an enabler text, a scenario and a use case', () => {
    expect(match(paths.enabler(DIR.k1, '1b'))).toMatchObject({
      docType: 'enabler',
      enablerCode: 'K1-b',
      quizLevel: null,
      contentKey: 'enabler:1b',
      issues: [],
    });
    expect(match(paths.scenario(DIR.k1, '1b'))).toMatchObject({
      docType: 'scenario',
      enablerCode: 'K1-b',
      contentKey: 'scenario:1b',
    });
    expect(match(paths.useCase(DIR.k1, '1', '1b'))).toMatchObject({
      docType: 'use_case',
      enablerCode: 'K1-b',
      contentKey: 'use-case:1b',
    });
  });

  it('reads a global quiz of the component folder and of the global folder', () => {
    expect(match(paths.globalQuiz(DIR.k6_1, '06.1'))).toMatchObject({
      docType: 'global_quiz',
      componentCode: 'K6.1',
      enablerCode: null,
      contentKey: 'global-quiz:06.1',
    });
    expect(match(`${GLOBAL}/Word/06.1_Global_Quiz_Thema.docx`)).toMatchObject({
      docType: 'global_quiz',
      componentCode: 'K6.1',
      group: 'global',
      contentKey: 'global-quiz:06.1',
    });
  });

  it('reads the PDF of a global quiz as an original of a global quiz', () => {
    expect(match(`${GLOBAL}/PDF/06.1_Global_Quiz_Thema.pdf`)).toMatchObject({
      docType: 'pdf_original',
      originalType: 'global_quiz',
      componentCode: 'K6.1',
      contentKey: 'pdf:global-quiz:06.1',
      issues: [],
    });
  });

  it('reads a PDF in a quiz folder as an original of that quiz, not as a format error', () => {
    const result = match(`${DIR.k1}/Enablers/1a_Thema/Quiz/1a_Quiz_Low.pdf`);
    expect(result).toMatchObject({
      docType: 'pdf_original',
      originalType: 'quiz',
      enablerCode: 'K1-a',
      quizLevel: 'low',
      contentKey: 'pdf:quiz:1a:low',
    });
    expect(result.issues).toEqual([]);
    expect(result.flags).toContain('pdf-original');
  });

  it('names the elective group for K10 to K19 in the folder of part two', () => {
    expect(match(paths.enabler(DIR.k12, '12a'))).toMatchObject({
      group: 'wahl',
      folderGroup: 'teil2',
      componentCode: 'K12',
    });
    expect(match(paths.enabler(DIR.k20, '20a'))).toMatchObject({
      group: 'ganze',
      componentCode: 'K20',
    });
  });

  it('derives the enabler code of a split component from the component folder', () => {
    expect(match(paths.enabler(DIR.k6_2, '6d'))).toMatchObject({
      componentCode: 'K6.2',
      enablerCode: 'K6.2-d',
      enablerKey: '6.2d',
      contentKey: 'enabler:6.2d',
    });
  });

  it('reads a version suffix and the flags of the path', () => {
    const result = match(
      `${DIR.k1}/Enablers/1a_Thema/Quiz/1a_Quiz_Low_v2.docx`
    );
    expect(result.version).toBe(2);
    expect(result.flags).toContain('version');
    expect(
      match(`${DIR.k1}/K1_Use-Cases/Ohne Musterlösung/UC_1a_Titel.docx`).flags
    ).toContain('without-solution');
  });

  it('keeps the issues of a path that is only partly right', () => {
    const result = match(`${DIR.k1}/Enablers/1a_Thema/Quiz/1b_Quiz_Low.docx`);
    expect(result.issues).toContain('letter-mismatch');
    expect(result.docType).toBe('quiz');
  });
});

describe('classifyByPath: spellings of the path', () => {
  const reference = match(paths.quiz(DIR.k1, '1a', 'Low'));

  it('accepts backslashes, mixed separators and double separators', () => {
    const win = paths.quiz(DIR.k1, '1a', 'Low').replace(/\//g, '\\');
    expect(classifyByPath(win)).toEqual(reference);
    expect(classifyByPath(win.replace('Enablers\\', 'Enablers/'))).toEqual(
      reference
    );
    expect(classifyByPath(win.replace(/\\/g, '\\\\'))).toEqual(reference);
  });

  it('drops a drive letter and everything up to the folder Komponente', () => {
    const abs = `C:\\Users\\x\\OneDrive - Firma\\Projekt\\Komponente\\${paths
      .quiz(DIR.k1, '1a', 'Low')
      .replace(/\//g, '\\')}`;
    expect(classifyByPath(abs)).toEqual(reference);
  });

  it('finds the group folder below parent folders of the upload', () => {
    const result = match(
      `Upload Oktober/Material/${paths.quiz(DIR.k1, '1a', 'Low')}`
    );
    expect(result).toMatchObject({
      docType: 'quiz',
      enablerCode: 'K1-a',
      rebased: true,
    });
  });

  it('treats the Unicode forms of a folder name alike', () => {
    const decomposed = paths
      .enabler(DIR.k20, '20a')
      .replace('während', 'wa\u0308hrend');
    expect(classifyByPath(decomposed)).toEqual(
      classifyByPath(paths.enabler(DIR.k20, '20a'))
    );
    expect(match(decomposed).group).toBe('ganze');
  });

  it('is not case sensitive for the folders Enablers, Quiz and Szenario', () => {
    expect(
      match(`${DIR.k1}/enablers/1a_Thema/quiz/1a_Quiz_Low.docx`).docType
    ).toBe('quiz');
  });
});

describe('classifyByPath: paths that give nothing', () => {
  it.each([
    ['a loose file name', '1a_Quiz_Low.docx'],
    ['a file in a folder of its own kind only', 'Quiz/1a_Quiz_Low.docx'],
    ['a foreign folder', 'Meine Sachen/Neu/Datei.docx'],
    [
      'a component folder without a group folder',
      '01 - Thema (§ 4)/Enablers/1a_X/1a.docx',
    ],
  ])('gives nothing for %s', (_name, path) => {
    expect(classifyByPath(path)).toMatchObject({
      kind: 'none',
      reason: 'NO_STRUCTURE',
    });
  });

  it('gives nothing for an empty path and for non-text input', () => {
    expect(classifyByPath('')).toMatchObject({
      kind: 'none',
      reason: 'EMPTY_PATH',
    });
    expect(classifyByPath('   ')).toMatchObject({
      kind: 'none',
      reason: 'EMPTY_PATH',
    });
    expect(classifyByPath(undefined as unknown as string)).toMatchObject({
      kind: 'none',
      reason: 'EMPTY_PATH',
    });
    expect(classifyByPath(null as unknown as string)).toMatchObject({
      kind: 'none',
      reason: 'EMPTY_PATH',
    });
    expect(classifyByPath(42 as unknown as string)).toMatchObject({
      kind: 'none',
      reason: 'EMPTY_PATH',
    });
  });

  it('gives nothing for a folder that is no part of the scheme', () => {
    expect(
      classifyByPath(`${DIR.k1}/Enablers/1a_Thema/Bilder/bild.docx`)
    ).toMatchObject({ kind: 'none', reason: 'UNKNOWN_TYPE' });
    expect(classifyByPath(`${DIR.k1}/Sonstiges/x.docx`)).toMatchObject({
      kind: 'none',
      reason: 'UNKNOWN_TYPE',
    });
  });

  it('gives nothing for a format other than Word and PDF', () => {
    expect(
      classifyByPath(`${DIR.k1}/Enablers/1a_Thema/Quiz/1a_Quiz_Low.doc`)
    ).toMatchObject({ kind: 'none', reason: 'UNSUPPORTED_FORMAT' });
    expect(
      classifyByPath(paths.enabler(DIR.k1, '1a').replace('.docx', ''))
    ).toMatchObject({
      kind: 'none',
      reason: 'UNSUPPORTED_FORMAT',
    });
  });

  it('never throws on odd paths', () => {
    const odd = [
      '\0',
      '..',
      '../..//',
      '%2e%2e/%2e%2e/x.docx',
      'C:',
      'C:\\',
      '/',
      `${T1}/`,
      `${T1}/01 - /`,
      `${T1}/${'x'.repeat(400)}/${'y'.repeat(400)}.docx`,
      `${T2}/\u202e/\u200b/.docx`,
      '\ud800',
    ];
    for (const path of odd) {
      expect(() => classifyByPath(path)).not.toThrow();
    }
  });

  it('does not treat dot segments as a way out of the tree', () => {
    const result = classifyByPath(`../../${paths.quiz(DIR.k1, '1a', 'Low')}`);
    // the segments are only text, the rule reads the folders it finds
    expect(result.kind).toBe('match');
    const sibling = classifyByPath(
      `${T1}/../${T2}/${DIR.k6_2.split('/')[1]}/Enablers/6d_X/6d.docx`
    );
    expect(sibling.kind === 'match' || sibling.kind === 'none').toBe(true);
  });
});

describe('classifyByPath: archive', () => {
  it('recognizes an archive folder and an archive name', () => {
    expect(
      classifyByPath(
        `${DIR.k1}/Enablers/1a_Thema/Enabler_Archiv_to_delete/1a.docx`
      ).kind
    ).toBe('archive');
    expect(
      classifyByPath(`${DIR.k1}/Enablers/1a_Thema/6f_Old_To_Delete.docx`).kind
    ).toBe('archive');
    expect(
      classifyByPath(`${DIR.k1}/Enablers/1a_Thema/Quiz/Archiv/1a_Quiz_Low.docx`)
        .kind
    ).toBe('archive');
  });

  it('does not skip a file for a folder above the folder Komponente, but tells', () => {
    const result = match(
      `C:\\Archiv\\Alt\\Komponente\\${paths.quiz(DIR.k1, '1a', 'Low').replace(/\//g, '\\')}`
    );
    expect(result.archiveAbove).toBe(true);
    expect(match(paths.quiz(DIR.k1, '1a', 'Low')).archiveAbove).toBe(false);
    expect(
      match(`Archiv/Upload/${paths.quiz(DIR.k1, '1a', 'Low')}`).archiveAbove
    ).toBe(true);
  });

  it('does not take a topic like Archivierung for an archive', () => {
    expect(
      classifyByPath(`${DIR.k1}/Enablers/1a_Archivierung/1a.docx`).kind
    ).toBe('match');
  });
});

describe('classifyByPath: limits and determinism', () => {
  it('refuses a very long path without reading it', () => {
    const long = `${T1}/${'a'.repeat(1200)}.docx`;
    expect(classifyByPath(long)).toMatchObject({
      kind: 'none',
      reason: 'PATH_TOO_LONG',
    });
  });

  it('stays fast on a path made to slow down a pattern', () => {
    const hostile = `${T1}/01 - ${'(§ '.repeat(300)}/Enablers/1a_X/1a.docx`;
    const start = Date.now();
    classifyByPath(hostile.slice(0, 990));
    classifyByPath(`${T2}/${'1 - '.repeat(240)}/x.docx`);
    expect(Date.now() - start).toBeLessThan(1000);
  });

  it('gives the same answer every time', () => {
    const inputs = [
      paths.quiz(DIR.k1, '1a', 'Low'),
      '1a_Quiz_Low.docx',
      `${GLOBAL}/PDF/06.1_Global_Quiz_Thema.pdf`,
    ];
    for (const input of inputs) {
      expect(classifyByPath(input)).toEqual(classifyByPath(input));
    }
  });

  it('does not change what pathInfo of the import says', () => {
    const result = match(paths.scenario(DIR.k6_2, '6d'));
    expect(result.contentKey).toBe('scenario:6.2d');
  });
});

describe('classifyByPath: more than one group folder', () => {
  it('does not read nested group folders as a structure', () => {
    expect(
      classifyByPath(
        `${T1}/${T2}/${DIR.k6_2.split('/')[1]}/Enablers/6d_X/6d.docx`
      )
    ).toMatchObject({ kind: 'none', reason: 'NO_STRUCTURE' });
  });

  it('keeps a global quiz of the global folder apart from the component folders', () => {
    const result = match(`${GLOBAL}/Word/01_Global_Quiz_X.docx`);
    expect(result.group).toBe('global');
    expect(result.folderGroup).toBe('global');
  });
});
