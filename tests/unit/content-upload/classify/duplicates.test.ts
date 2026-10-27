/**
 * @jest-environment node
 */
// Duplicate groups: exact copies by hash, versions of one content key with a
// suggestion (newest, no pre selection within 24 hours), archives left out,
// similar files with different keys, PDF originals bound to their Word file.
import { describe, expect, it } from '@jest/globals';

import {
  analyzeDuplicates,
  versionOfPath,
  type DuplicateFile,
} from '@/lib/content-upload/classify/duplicates';

const HOUR = 3600 * 1000;
const BASE = Date.UTC(2026, 9, 1, 8, 0, 0);

const sha = (n: number) => n.toString(16).padStart(64, '0');
/** A different default hash for every id. */
const shaOfId = (id: string) =>
  sha([...id].reduce((a, c) => (a * 131 + c.charCodeAt(0)) % 1_000_000_007, 7));

const quiz = (
  id: string,
  extra: Partial<DuplicateFile> = {}
): DuplicateFile => ({
  id,
  sha256: shaOfId(id),
  relPath: `K1/Quiz/${id}.docx`,
  mtimeMs: BASE,
  assignment: {
    docType: 'quiz',
    componentCode: 'K1',
    enablerCode: 'K1-a',
    quizLevel: 'low',
    originalType: null,
  },
  ...extra,
});

/** The time of now for the checks: after every time of change in these tests. */
const NOW = BASE + 1000 * HOUR;
const analyze = (
  files: Parameters<typeof analyzeDuplicates>[0],
  options: Parameters<typeof analyzeDuplicates>[1] = {}
) => analyzeDuplicates(files, { now: NOW, ...options });

const keyGroup = (files: DuplicateFile[], options = {}) =>
  analyze(files, options).keyGroups[0];

describe('versionOfPath', () => {
  it('reads a version of the file name like the import script', () => {
    expect(versionOfPath('a/b/1a_Quiz_Low_v2.docx')).toBe(2);
    expect(versionOfPath('a/b/1a_Quiz_Low_V10.docx')).toBe(10);
  });

  it('reads a version of a folder when the name has none', () => {
    expect(versionOfPath('Quiz v3/1a_Quiz_Low.docx')).toBe(3);
    expect(versionOfPath('Quiz_v4/Neu/1a_Quiz_Low.docx')).toBe(4);
    expect(versionOfPath('a/Fassung (v5)/x.docx')).toBe(5);
  });

  it('prefers the file name over a folder and the nearest folder over a far one', () => {
    expect(versionOfPath('v1/Quiz_v3/x_v7.docx')).toBe(7);
    expect(versionOfPath('v1/Quiz_v3/x.docx')).toBe(3);
  });

  it('does not take a word for a version', () => {
    expect(versionOfPath('a/Review/Servo/x.docx')).toBeNull();
    expect(versionOfPath('a/v/x.docx')).toBeNull();
    expect(versionOfPath('a/Provider/x_v2x.docx')).toBeNull();
    expect(versionOfPath('a/b/x.docx')).toBeNull();
    expect(versionOfPath('')).toBeNull();
  });

  it('ignores absurd numbers', () => {
    expect(versionOfPath('x_v99999999.docx')).toBeNull();
  });
});

describe('analyzeDuplicates: exact copies', () => {
  it('merges files with the same hash into the first by path', () => {
    const result = analyze([
      quiz('f2', { sha256: sha(9), relPath: 'b/copy.docx' }),
      quiz('f1', { sha256: sha(9), relPath: 'a/original.docx' }),
      quiz('f3', { sha256: sha(9), relPath: 'c/third.docx' }),
    ]);
    expect(result.exactGroups).toEqual([
      { sha256: sha(9), primaryId: 'f1', memberIds: ['f1', 'f2', 'f3'] },
    ]);
    expect(result.mergedInto).toEqual({ f2: 'f1', f3: 'f1' });
    // the copies take no part in the version groups
    expect(result.keyGroups).toEqual([]);
  });

  it('writes the hash in upper case like in lower case', () => {
    const result = analyze([
      quiz('f1', { sha256: sha(9).toUpperCase() }),
      quiz('f2', { sha256: sha(9) }),
    ]);
    expect(result.exactGroups).toHaveLength(1);
  });

  it('does not merge on a hash that is no SHA-256', () => {
    const result = analyze([
      quiz('f1', { sha256: 'abc' }),
      quiz('f2', { sha256: 'abc' }),
      quiz('f3', { sha256: null }),
      quiz('f4', { sha256: undefined }),
    ]);
    expect(result.exactGroups).toEqual([]);
  });

  it('notes when copies were assigned differently', () => {
    const result = analyze([
      quiz('f1', { sha256: sha(9) }),
      quiz('f2', {
        sha256: sha(9),
        assignment: {
          docType: 'quiz',
          componentCode: 'K1',
          enablerCode: 'K1-b',
          quizLevel: 'low',
          originalType: null,
        },
      }),
    ]);
    expect(result.exactGroups[0].assignmentsDiffer).toBe(true);
  });
});

describe('analyzeDuplicates: versions of one content key', () => {
  it('suggests the highest version', () => {
    const group = keyGroup([
      quiz('f1', { relPath: 'K1/Quiz/1a_Quiz_Low.docx' }),
      quiz('f2', { relPath: 'K1/Quiz/1a_Quiz_Low_v2.docx' }),
    ]);
    expect(group).toMatchObject({
      key: 'quiz:1a:low',
      memberIds: ['f2', 'f1'],
      suggestedId: 'f2',
      ambiguous: false,
    });
    expect(group.reasons.map(r => r.code)).toContain('NEWEST_VERSION');
  });

  it('suggests the latest change when the versions are equal and far apart', () => {
    const group = keyGroup([
      quiz('f1', { mtimeMs: BASE }),
      quiz('f2', { mtimeMs: BASE + 25 * HOUR }),
    ]);
    expect(group).toMatchObject({ suggestedId: 'f2', ambiguous: false });
    expect(group.reasons.map(r => r.code)).toContain('NEWEST_CHANGE');
  });

  it('makes no suggestion within 24 hours', () => {
    const group = keyGroup([
      quiz('f1', { mtimeMs: BASE }),
      quiz('f2', { mtimeMs: BASE + 5 * HOUR }),
    ]);
    expect(group).toMatchObject({ suggestedId: null, ambiguous: true });
    expect(group.reasons.map(r => r.code)).toContain('AMBIGUOUS_WITHIN_WINDOW');
  });

  it('treats exactly 24 hours as ambiguous, like the import script', () => {
    expect(
      keyGroup([
        quiz('f1', { mtimeMs: BASE }),
        quiz('f2', { mtimeMs: BASE + 24 * HOUR }),
      ]).ambiguous
    ).toBe(true);
    expect(
      keyGroup([
        quiz('f1', { mtimeMs: BASE }),
        quiz('f2', { mtimeMs: BASE + 24 * HOUR + 1 }),
      ]).ambiguous
    ).toBe(false);
  });

  it('uses the window of the options', () => {
    const files = [
      quiz('f1', { mtimeMs: BASE }),
      quiz('f2', { mtimeMs: BASE + 30 * HOUR }),
    ];
    expect(keyGroup(files, { ambiguousWithinHours: 48 }).ambiguous).toBe(true);
    expect(keyGroup(files, { ambiguousWithinHours: 0 }).ambiguous).toBe(false);
  });

  it('is not ambiguous when the versions differ, however close the times are', () => {
    const group = keyGroup([
      quiz('f1', { relPath: 'a/x_v2.docx', mtimeMs: BASE }),
      quiz('f2', { relPath: 'a/x.docx', mtimeMs: BASE + HOUR }),
    ]);
    expect(group).toMatchObject({ suggestedId: 'f1', ambiguous: false });
  });

  it('makes no suggestion when a time is unknown and the versions are equal', () => {
    const group = keyGroup([
      quiz('f1', { mtimeMs: null }),
      quiz('f2', { mtimeMs: BASE }),
    ]);
    expect(group).toMatchObject({ suggestedId: null, ambiguous: true });
    expect(group.reasons.map(r => r.code)).toContain('MTIME_UNKNOWN');
  });

  it('does not trust a time in the future when it knows the time of now', () => {
    const files = [
      quiz('f1', { mtimeMs: BASE }),
      quiz('f2', { mtimeMs: BASE + 400 * 24 * HOUR }),
    ];
    const withNow = keyGroup(files, { now: BASE + 2 * HOUR });
    expect(withNow).toMatchObject({ suggestedId: null, ambiguous: true });
    expect(withNow.reasons.map(r => r.code)).toContain('MTIME_IN_FUTURE');
    // the module reads no clock itself
    expect(keyGroup(files).suggestedId).toBeNull();
  });

  it('makes no suggestion for equal versions when the time of now is not given', () => {
    const files = [
      quiz('f1', { mtimeMs: BASE }),
      quiz('f2', { mtimeMs: BASE + 90 * HOUR }),
    ];
    const group = analyzeDuplicates(files).keyGroups[0];
    expect(group).toMatchObject({ suggestedId: null, ambiguous: true });
    expect(group.reasons.map(r => r.code)).toContain('MTIME_UNVERIFIED');
    // a version still decides without a clock
    const versioned = analyzeDuplicates([
      quiz('f1', { relPath: 'a/x.docx' }),
      quiz('f2', { relPath: 'a/x_v2.docx' }),
    ]).keyGroups[0];
    expect(versioned.suggestedId).toBe('f2');
  });

  it('takes a time of zero or below for unknown', () => {
    const group = keyGroup([
      quiz('f1', { mtimeMs: 0 }),
      quiz('f2', { mtimeMs: BASE }),
    ]);
    expect(group.reasons.map(r => r.code)).toContain('MTIME_UNKNOWN');
  });

  it('takes only a whole version from 0 to 999, from the path and from the override', () => {
    const huge = keyGroup([
      quiz('f1', { relPath: 'a/x_v99999999999999999999.docx', mtimeMs: BASE }),
      quiz('f2', { relPath: 'a/x.docx', mtimeMs: BASE + 90 * HOUR }),
    ]);
    // no version in the huge name: the dates decide
    expect(huge.suggestedId).toBe('f2');
    const override = keyGroup([
      quiz('f1', { version: 1e20, mtimeMs: BASE }),
      quiz('f2', { version: -3, mtimeMs: BASE + 90 * HOUR }),
      quiz('f3', { version: 1.5, mtimeMs: BASE + 40 * HOUR }),
    ]);
    expect(override.memberIds[0]).toBe('f2');
    expect(override.suggestedId).toBe('f2');
  });

  it('notes when the versions of a key are very different texts', () => {
    const words = (seed: string) =>
      Array.from(
        { length: 80 },
        (_, i) => `${seed}${i} wort${i % 7} satz${i}`
      ).join(' ');
    const group = keyGroup([
      quiz('f1', { text: words('alt'), mtimeMs: BASE }),
      quiz('f2', { text: words('neu'), mtimeMs: BASE + 90 * HOUR }),
    ]);
    expect(group.suggestedId).toBe('f2');
    expect(group.reasons.map(r => r.code)).toEqual(
      expect.arrayContaining(['NEWEST_CHANGE', 'TEXT_DIFFERS'])
    );
  });

  it('never picks a side between a use case and its variant without a solution', () => {
    const useCase = (id: string, extra: Partial<DuplicateFile> = {}) =>
      quiz(id, {
        assignment: {
          docType: 'use_case',
          componentCode: 'K5',
          enablerCode: 'K5-b',
          quizLevel: null,
          originalType: null,
        },
        ...extra,
      });
    const group = keyGroup([
      useCase('f1', { mtimeMs: BASE }),
      useCase('f2', { mtimeMs: BASE + 100 * HOUR, withoutSolution: true }),
    ]);
    expect(group).toMatchObject({ suggestedId: null, ambiguous: true });
    expect(group.reasons.map(r => r.code)).toContain('SOLUTION_VARIANT');
  });

  it('breaks a complete tie by path and then by id, the same way every time', () => {
    const tie = [
      quiz('f2', { relPath: 'b.docx', mtimeMs: BASE }),
      quiz('f1', { relPath: 'a.docx', mtimeMs: BASE }),
    ];
    const group = keyGroup(tie);
    expect(group.memberIds).toEqual(['f1', 'f2']);
    expect(group.suggestedId).toBeNull();
  });

  it('lists three versions in order and judges the first two', () => {
    const group = keyGroup([
      quiz('f1', { relPath: 'a/x.docx' }),
      quiz('f2', { relPath: 'a/x_v2.docx' }),
      quiz('f3', { relPath: 'a/x_v3.docx' }),
    ]);
    expect(group.memberIds).toEqual(['f3', 'f2', 'f1']);
    expect(group.suggestedId).toBe('f3');
  });

  it('gives no group for one file or for different keys', () => {
    expect(analyze([quiz('f1')]).keyGroups).toEqual([]);
    const other = quiz('f2', {
      assignment: {
        docType: 'quiz',
        componentCode: 'K1',
        enablerCode: 'K1-a',
        quizLevel: 'medium',
        originalType: null,
      },
    });
    expect(analyze([quiz('f1'), other]).keyGroups).toEqual([]);
  });

  it('builds the key like the keys of the import', () => {
    const make = (assignment: DuplicateFile['assignment']) =>
      analyze([
        { id: 'a', relPath: 'a', assignment },
        { id: 'b', relPath: 'b', assignment },
      ]).keyGroups[0]?.key;
    const base = {
      componentCode: 'K6.2',
      quizLevel: null,
      originalType: null,
    } as const;
    expect(make({ ...base, docType: 'enabler', enablerCode: 'K6.2-d' })).toBe(
      'enabler:6.2d'
    );
    expect(make({ ...base, docType: 'scenario', enablerCode: 'K6.2-d' })).toBe(
      'scenario:6.2d'
    );
    expect(make({ ...base, docType: 'use_case', enablerCode: 'K6.2-d' })).toBe(
      'use-case:6.2d'
    );
    expect(make({ ...base, docType: 'global_quiz', enablerCode: null })).toBe(
      'global-quiz:06.2'
    );
    expect(
      make({
        ...base,
        docType: 'quiz',
        enablerCode: 'K6.2-d',
        quizLevel: 'high',
      })
    ).toBe('quiz:6.2d:high');
    expect(
      make({
        ...base,
        docType: 'pdf_original',
        originalType: 'global_quiz',
        enablerCode: null,
      })
    ).toBe('pdf:global-quiz:06.2');
  });

  it('forms no group for an incomplete assignment', () => {
    const incomplete = (id: string) =>
      quiz(id, {
        assignment: {
          docType: 'quiz',
          componentCode: 'K1',
          enablerCode: 'K1-a',
          quizLevel: null,
          originalType: null,
        },
      });
    expect(analyze([incomplete('f1'), incomplete('f2')]).keyGroups).toEqual([]);
    expect(
      analyze([
        { id: 'a', relPath: 'a', assignment: null },
        { id: 'b', relPath: 'b', assignment: null },
      ]).keyGroups
    ).toEqual([]);
  });
});

describe('analyzeDuplicates: archives and exclusions', () => {
  it('leaves archive files out of every group', () => {
    const result = analyze([
      quiz('f1', { sha256: sha(1) }),
      quiz('f2', { archived: true, mtimeMs: BASE + 100 * HOUR }),
      quiz('f3', { archived: true, sha256: sha(1) }),
    ]);
    expect(result.keyGroups).toEqual([]);
    expect(result.exactGroups).toEqual([]);
    expect(result.excluded).toEqual([
      { id: 'f2', reason: 'ARCHIVE' },
      { id: 'f3', reason: 'ARCHIVE' },
    ]);
  });

  it('leaves out files that the caller marks as excluded', () => {
    const result = analyze([quiz('f1'), quiz('f2', { excluded: true })]);
    expect(result.keyGroups).toEqual([]);
    expect(result.excluded).toEqual([{ id: 'f2', reason: 'EXCLUDED' }]);
  });
});

describe('analyzeDuplicates: PDF originals', () => {
  const word = (id: string, extra: Partial<DuplicateFile> = {}) =>
    quiz(id, {
      assignment: {
        docType: 'global_quiz',
        componentCode: 'K6.1',
        enablerCode: null,
        quizLevel: null,
        originalType: null,
      },
      ...extra,
    });
  const pdf = (id: string, extra: Partial<DuplicateFile> = {}) =>
    quiz(id, {
      relPath: `${id}.pdf`,
      assignment: {
        docType: 'pdf_original',
        componentCode: 'K6.1',
        enablerCode: null,
        quizLevel: null,
        originalType: 'global_quiz',
      },
      ...extra,
    });

  it('binds a PDF to the Word file of the same content', () => {
    const result = analyze([word('w1'), pdf('p1')]);
    expect(result.originals).toEqual([
      { pdfId: 'p1', wordId: 'w1', candidateIds: ['w1'], reason: null },
    ]);
  });

  it('binds to the suggested version when there are several', () => {
    const result = analyze([
      word('w1', { mtimeMs: BASE }),
      word('w2', { mtimeMs: BASE + 50 * HOUR }),
      pdf('p1'),
    ]);
    expect(result.originals[0]).toMatchObject({
      wordId: 'w2',
      candidateIds: ['w2', 'w1'],
    });
  });

  it('binds to none when the Word files cannot be told apart, and says so', () => {
    const result = analyze([
      word('w1', { mtimeMs: BASE }),
      word('w2', { mtimeMs: BASE + HOUR }),
      pdf('p1'),
    ]);
    expect(result.originals[0]).toEqual({
      pdfId: 'p1',
      wordId: null,
      candidateIds: ['w2', 'w1'],
      reason: 'AMBIGUOUS_WORD',
    });
  });

  it('says so when there is no Word file', () => {
    expect(analyze([pdf('p1')]).originals).toEqual([
      { pdfId: 'p1', wordId: null, candidateIds: [], reason: 'NO_WORD_FILE' },
    ]);
  });

  it('does not bind to an archive file or to a Word file of another content', () => {
    const other = word('w2', {
      assignment: {
        docType: 'global_quiz',
        componentCode: 'K1',
        enablerCode: null,
        quizLevel: null,
        originalType: null,
      },
    });
    const result = analyze([word('w1', { archived: true }), other, pdf('p1')]);
    expect(result.originals[0]).toMatchObject({
      wordId: null,
      reason: 'NO_WORD_FILE',
    });
  });

  it('groups two PDFs of one content as versions among themselves, apart from the Word files', () => {
    const result = analyze([
      word('w1'),
      pdf('p1', { mtimeMs: BASE }),
      pdf('p2', { mtimeMs: BASE + 60 * HOUR }),
    ]);
    expect(result.keyGroups).toHaveLength(1);
    expect(result.keyGroups[0]).toMatchObject({
      key: 'pdf:global-quiz:06.1',
      suggestedId: 'p2',
    });
  });
});

describe('analyzeDuplicates: similar files', () => {
  const text = (seed: string) =>
    Array.from(
      { length: 50 },
      (_, i) =>
        `Absatz ${i} aus ${seed} nennt das erfundene Thema ${seed}${i} und Beispiel ${i * 3} im Betrieb ${seed}.`
    ).join(' ');

  it('marks files with different keys and almost the same text as possible duplicates', () => {
    const result = analyze([
      quiz('f1', { text: text('alpha') }),
      quiz('f2', {
        text: text('alpha').replace('Absatz 20 aus alpha', 'Ein Zusatz'),
        assignment: {
          docType: 'quiz',
          componentCode: 'K1',
          enablerCode: 'K1-b',
          quizLevel: 'low',
          originalType: null,
        },
      }),
      quiz('f3', { text: text('omega'), sha256: sha(3) }),
    ]);
    expect(result.similarGroups).toEqual([
      { id: 'sim:f1', memberIds: ['f1', 'f2'], maxJaccard: expect.any(Number) },
    ]);
    expect(result.similarGroups[0].maxJaccard).toBeGreaterThan(0.9);
  });

  it('marks an unclassified file that resembles a classified one', () => {
    const result = analyze([
      quiz('f1', { text: text('alpha') }),
      { id: 'f2', relPath: 'x.docx', assignment: null, text: text('alpha') },
    ]);
    expect(result.similarGroups).toHaveLength(1);
  });

  it('does not repeat as similar what is already a group of one key', () => {
    const result = analyze([
      quiz('f1', { text: text('alpha'), mtimeMs: BASE }),
      quiz('f2', {
        text: text('alpha').replace('Absatz 20 aus alpha', 'Zusatz'),
        mtimeMs: BASE + 90 * HOUR,
      }),
    ]);
    expect(result.keyGroups).toHaveLength(1);
    expect(result.similarGroups).toEqual([]);
    // but the group of the key tells how alike each text is to the first one
    expect(result.keyGroups[0].memberIds).toEqual(['f2', 'f1']);
    expect(result.keyGroups[0].similarity.f2).toBe(1);
    expect(result.keyGroups[0].similarity.f1).toBeGreaterThan(0.9);
  });

  it('does not list a PDF next to the Word file it is the original of', () => {
    const doc = text('alpha');
    const result = analyze([
      quiz('w1', {
        text: doc,
        assignment: {
          docType: 'global_quiz',
          componentCode: 'K6.1',
          enablerCode: null,
          quizLevel: null,
          originalType: null,
        },
      }),
      quiz('p1', {
        text: doc.replace('Absatz 20 aus alpha', 'Seitenzahl'),
        assignment: {
          docType: 'pdf_original',
          componentCode: 'K6.1',
          enablerCode: null,
          quizLevel: null,
          originalType: 'global_quiz',
        },
      }),
    ]);
    expect(result.originals[0]).toMatchObject({ pdfId: 'p1', wordId: 'w1' });
    expect(result.similarGroups).toEqual([]);
  });

  it('does not compare exact copies and archive files', () => {
    const result = analyze([
      quiz('f1', { text: text('alpha'), sha256: sha(5) }),
      quiz('f2', { text: text('alpha'), sha256: sha(5), assignment: null }),
      quiz('f3', {
        text: text('alpha'),
        sha256: sha(6),
        archived: true,
        assignment: null,
      }),
    ]);
    expect(result.similarGroups).toEqual([]);
  });

  it('works without any text', () => {
    expect(analyze([quiz('f1'), quiz('f2')]).similarGroups).toEqual([]);
  });
});

describe('analyzeDuplicates: limits and determinism', () => {
  it('gives the same answer for any order of the input', () => {
    const files = [
      quiz('f1', { relPath: 'a/x.docx' }),
      quiz('f2', { relPath: 'a/x_v2.docx' }),
      quiz('f3', { sha256: sha(2), relPath: 'copy/x_v2.docx' }),
      quiz('f4', { archived: true }),
    ];
    const forward = analyze(files);
    const backward = analyze([...files].reverse());
    expect(backward).toEqual(forward);
  });

  it('does not change its input', () => {
    const files = [quiz('f1'), quiz('f2', { mtimeMs: BASE + 90 * HOUR })];
    const before = JSON.stringify(files);
    analyze(files);
    expect(JSON.stringify(files)).toBe(before);
  });

  it('copes with a large run in good time', () => {
    const files: DuplicateFile[] = [];
    for (let i = 0; i < 3000; i += 1) {
      files.push(
        quiz(`f${String(i).padStart(4, '0')}`, {
          sha256: sha(i + 1),
          relPath: `K${i % 25}/${i}.docx`,
          assignment: {
            docType: 'quiz',
            componentCode: `K${i % 25}`,
            enablerCode: `K${i % 25}-${String.fromCharCode(97 + (i % 20))}`,
            quizLevel: (['low', 'medium', 'high'] as const)[i % 3],
            originalType: null,
          },
        })
      );
    }
    const start = Date.now();
    const result = analyze(files);
    expect(Date.now() - start).toBeLessThan(5000);
    expect(result.keyGroups.length).toBeGreaterThan(0);
  });

  it('survives odd input', () => {
    expect(analyze([]).keyGroups).toEqual([]);
    expect(() =>
      analyze([
        null as never,
        { id: 'a' } as never,
        { id: 'a', relPath: 'x', mtimeMs: NaN, assignment: undefined } as never,
      ])
    ).not.toThrow();
  });

  it('ignores a repeated id and keeps the first by path, whatever the order', () => {
    const a = analyze([
      quiz('f1', { relPath: 'b.docx', sha256: sha(1) }),
      quiz('f1', { relPath: 'a.docx', sha256: sha(2) }),
      quiz('f2', { relPath: 'c.docx', sha256: sha(2) }),
    ]);
    const b = analyze([
      quiz('f2', { relPath: 'c.docx', sha256: sha(2) }),
      quiz('f1', { relPath: 'a.docx', sha256: sha(2) }),
      quiz('f1', { relPath: 'b.docx', sha256: sha(1) }),
    ]);
    expect(a).toEqual(b);
    // f1 is the one at a.docx, it has the hash of f2
    expect(a.exactGroups).toHaveLength(1);
  });

  it('keeps an id like __proto__ as a key like any other', () => {
    const result = analyze([
      quiz('__proto__', { sha256: sha(9), relPath: 'a.docx' }),
      quiz('copy', { sha256: sha(9), relPath: 'b.docx' }),
    ]);
    expect(result.mergedInto.copy).toBe('__proto__');
    expect(Object.getPrototypeOf(result.mergedInto)).toBeNull();
  });

  it('says when a limit cut the work', () => {
    expect(analyze([quiz('f1'), quiz('f2')]).truncated).toBe(false);
    const huge = analyze([quiz('f1', { text: 'wort '.repeat(5000) })], {
      similarity: { maxChars: 1000 },
    });
    expect(huge.truncated).toBe(true);
    const many = analyze(
      Array.from({ length: 5001 }, (_, i) =>
        quiz(`f${String(i).padStart(5, '0')}`, { sha256: sha(i + 1) })
      )
    );
    expect(many.truncated).toBe(true);
  });

  it('judges two assignments without a key by their fields, not as equal', () => {
    const incomplete = (enabler: string) => ({
      docType: 'quiz' as const,
      componentCode: 'K1',
      enablerCode: enabler,
      quizLevel: null,
      originalType: null,
    });
    const result = analyze([
      quiz('f1', {
        sha256: sha(9),
        relPath: 'a',
        assignment: incomplete('K1-a'),
      }),
      quiz('f2', {
        sha256: sha(9),
        relPath: 'b',
        assignment: incomplete('K1-b'),
      }),
    ]);
    expect(result.exactGroups[0].assignmentsDiffer).toBe(true);
  });

  it('keeps a large cluster of similar files together', () => {
    const base = Array.from(
      { length: 60 },
      (_, i) =>
        `Absatz ${i} nennt das erfundene Thema Cluster${i} und Beispiel ${i * 5} im Betrieb`
    ).join(' ');
    const files = Array.from({ length: 70 }, (_, i) =>
      quiz(`c${String(i).padStart(2, '0')}`, {
        sha256: sha(i + 100),
        text: `${base} Ende ${i}`,
        assignment: {
          docType: 'quiz',
          componentCode: 'K1',
          enablerCode: `K1-${String.fromCharCode(97 + (i % 26))}`,
          quizLevel: (['low', 'medium', 'high'] as const)[i % 3],
          originalType: null,
        },
      })
    );
    const result = analyze(files);
    expect(result.similarGroups).toHaveLength(1);
    expect(result.similarGroups[0].memberIds).toHaveLength(70);
  });
});
