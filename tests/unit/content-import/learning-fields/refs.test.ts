import {
  learningFieldCode,
  learningFieldNumber,
  learningFieldYear,
  learningFieldsOfYear,
} from '@/lib/content-import/learning-fields/model';
import {
  cleanCell,
  parseLearningFieldRefs,
} from '@/lib/content-import/learning-fields/refs';

describe('learning field model', () => {
  it('assigns the school years 1 to 4, 5 to 8 and 9 to 13', () => {
    expect([1, 4, 5, 8, 9, 13].map(learningFieldYear)).toEqual([
      1, 1, 2, 2, 3, 3,
    ]);
    expect(learningFieldYear(0)).toBeNull();
    expect(learningFieldYear(14)).toBeNull();
    expect(learningFieldYear(2.5)).toBeNull();
  });

  it('writes and reads the codes LF1 to LF13', () => {
    expect(learningFieldCode(7)).toBe('LF7');
    expect(learningFieldNumber('LF13')).toBe(13);
    expect(learningFieldNumber('LF14')).toBeNull();
    expect(learningFieldNumber('LF-1')).toBeNull();
    expect(learningFieldNumber('lf1')).toBeNull();
  });

  it('lists the learning fields of a school year', () => {
    expect(learningFieldsOfYear(1)).toEqual([1, 2, 3, 4]);
    expect(learningFieldsOfYear(3)).toEqual([9, 10, 11, 12, 13]);
    expect(learningFieldsOfYear(4 as never)).toEqual([]);
  });
});

describe('cleanCell', () => {
  it('removes control characters and their escaped form', () => {
    expect(cleanCell('LF\u0002 2')).toBe('LF 2');
    expect(cleanCell('LF_x0002_ 2')).toBe('LF 2');
    expect(cleanCell('a  b﻿')).toBe('a b');
    expect(cleanCell(null)).toBe('');
    expect(cleanCell(undefined)).toBe('');
  });

  it('joins words that are split by a line break (syllable break)', () => {
    expect(cleanCell('Daten\r\npflege')).toBe('Datenpflege');
    expect(cleanCell('Onlineanwen-\r\ndungen')).toBe('Onlineanwendungen');
    expect(cleanCell('Erster Satz\r\nZweiter Satz')).toBe(
      'Erster Satz Zweiter Satz'
    );
    expect(cleanCell('Titel \r\n(§ 4 Absatz 2 Nummer 1)')).toBe(
      'Titel (§ 4 Absatz 2 Nummer 1)'
    );
  });

  it('keeps a hyphen inside a compound word', () => {
    expect(cleanCell('Test-Manager')).toBe('Test-Manager');
  });
});

describe('parseLearningFieldRefs', () => {
  it('reads the forms of the source', () => {
    expect(parseLearningFieldRefs('LF2,3')).toEqual({
      kind: 'numbers',
      numbers: [2, 3],
      invalid: [],
    });
    expect(parseLearningFieldRefs('LF 2')).toEqual({
      kind: 'numbers',
      numbers: [2],
      invalid: [],
    });
    expect(parseLearningFieldRefs('LF 2,3,4')).toEqual({
      kind: 'numbers',
      numbers: [2, 3, 4],
      invalid: [],
    });
    expect(parseLearningFieldRefs('LF 12')).toEqual({
      kind: 'numbers',
      numbers: [12],
      invalid: [],
    });
  });

  it('is tolerant about spaces, case, separators and a repeated prefix', () => {
    const cases: Array<[string, number[]]> = [
      ['lf2', [2]],
      ['Lf 2 , 3', [2, 3]],
      ['LF  5 ;  7', [5, 7]],
      ['LF 5, LF 7', [5, 7]],
      ['LF 5 und 7', [5, 7]],
      ['LF 5 / 7', [5, 7]],
      ['LF 5 & 7', [5, 7]],
      ['Lernfeld 3', [3]],
      ['Lernfelder 3, 4', [3, 4]],
      ['LF: 8', [8]],
      ['LF 02', [2]],
      ['LF 2,3,', [2, 3]],
      ['LF 2,2,3', [2, 3]],
      ['  LF 9. ', [9]],
      ['LF_x0002_ 6', [6]],
    ];
    for (const [text, numbers] of cases) {
      expect(parseLearningFieldRefs(text)).toEqual({
        kind: 'numbers',
        numbers,
        invalid: [],
      });
    }
  });

  it('reports numbers outside 1 to 13 as invalid and keeps the valid ones', () => {
    expect(parseLearningFieldRefs('LF 14')).toEqual({
      kind: 'numbers',
      numbers: [],
      invalid: [14],
    });
    expect(parseLearningFieldRefs('LF 0, 4, 99')).toEqual({
      kind: 'numbers',
      numbers: [4],
      invalid: [0, 99],
    });
  });

  it('reads an empty cell, all learning fields and company only', () => {
    expect(parseLearningFieldRefs('')).toEqual({ kind: 'empty' });
    expect(parseLearningFieldRefs('   ')).toEqual({ kind: 'empty' });
    expect(parseLearningFieldRefs(undefined)).toEqual({ kind: 'empty' });
    expect(parseLearningFieldRefs('alle Lernfelder')).toEqual({ kind: 'all' });
    expect(parseLearningFieldRefs('Alle  Lernfelder.')).toEqual({
      kind: 'all',
    });
    expect(parseLearningFieldRefs('nur betr./beh.')).toEqual({
      kind: 'company-only',
    });
    expect(parseLearningFieldRefs('nur betrieblich')).toEqual({
      kind: 'company-only',
    });
  });

  it('cuts very long cells and does not choke on many dots', () => {
    const started = Date.now();
    expect(parseLearningFieldRefs('.'.repeat(200000) + 'a')).toEqual({
      kind: 'unparseable',
    });
    expect(parseLearningFieldRefs('LF 2' + ' '.repeat(100000) + '.')).toEqual({
      kind: 'numbers',
      numbers: [2],
      invalid: [],
    });
    expect(Date.now() - started).toBeLessThan(1000);
  });

  it('does not guess when a cell cannot be read', () => {
    for (const text of [
      'LF',
      'LF zwei',
      'LF 2-4',
      'LF 2.3',
      'LF 2 bis 4',
      'siehe oben',
      'LF 2, alle Lernfelder',
      '2,3',
      'LF 1234',
    ]) {
      expect(parseLearningFieldRefs(text)).toEqual({ kind: 'unparseable' });
    }
  });
});
