/**
 * @jest-environment node
 */
import {
  classifyQuizJson,
  kindHintOfName,
  type QuizJsonSummary,
} from '@/lib/content-upload/classify/json-rule';
import {
  classifyMappingSheet,
  summarizeMappingSheet,
} from '@/lib/content-upload/classify/mapping-rule';
import { parseMappingSheet } from '@/lib/content-import/learning-fields/mapping-sheet';
import { REASON_TEXT_MAX } from '@/lib/content-upload/classify/types';

import { sampleRows } from '../../content-import/learning-fields/fixtures';

const summary = (over: Partial<QuizJsonSummary> = {}): QuizJsonSummary => ({
  kind: 'lesson',
  quizzes: 5,
  sets: 15,
  questions: 150,
  setsWithErrors: 0,
  warnings: 0,
  unmapped: 0,
  errorCodes: [],
  ...over,
});

describe('classifyQuizJson', () => {
  it('gives the type of the kind and the band high for a clean file', () => {
    expect(
      classifyQuizJson({ relPath: 'a.json', summary: summary() })
    ).toMatchObject({
      docType: 'quiz',
      band: 'high',
      confidence: 0.95,
      source: 'content',
    });
    expect(
      classifyQuizJson({
        relPath: 'a.json',
        summary: summary({ kind: 'global' }),
      })
    ).toMatchObject({ docType: 'global_quiz', band: 'high' });
  });

  it('does not let the file name make the kind, only contradict it', () => {
    const named = (relPath: string, kind: 'lesson' | 'global') =>
      classifyQuizJson({ relPath, summary: summary({ kind }) });
    // a name without a hint, or with the right one
    expect(named('quizze.json', 'global').band).toBe('high');
    expect(named('x/Global_Quizze.json', 'global').band).toBe('high');
    expect(named('x/Enabler_Quizze.json', 'lesson').band).toBe('high');
    // a name with the wrong one: the type stays the one of the content
    const wrong = named('x/Global_Quizze.json', 'lesson');
    expect(wrong).toMatchObject({
      docType: 'quiz',
      band: 'conflict',
      confidence: 0.3,
    });
    expect(wrong.reasons.map(r => r.code)).toContain('CONFLICT_TYPE');
    expect(named('Enabler.json', 'global')).toMatchObject({
      docType: 'global_quiz',
      band: 'conflict',
    });
    // both words: no hint
    expect(named('enabler-global.json', 'lesson').band).toBe('high');
    // a folder name does not count, only the name of the file
    expect(named('Global/quizze.json', 'lesson').band).toBe('high');
  });

  it('takes errors as medium with the reason of the parser errors, notes as no change', () => {
    const errors = classifyQuizJson({
      relPath: 'a.json',
      summary: summary({
        setsWithErrors: 2,
        errorCodes: ['ANSWER_INVALID', 'weird code!'],
      }),
    });
    expect(errors).toMatchObject({ band: 'medium', confidence: 0.7 });
    const text = errors.reasons.find(r => r.code === 'PARSER_ERRORS')!.text;
    expect(text).toContain('ANSWER_INVALID');
    expect(text).not.toContain('weird code');
    expect(
      classifyQuizJson({ relPath: 'a.json', summary: summary({ unmapped: 1 }) })
        .band
    ).toBe('medium');
    const notes = classifyQuizJson({
      relPath: 'a.json',
      summary: summary({ warnings: 4 }),
    });
    expect(notes.band).toBe('high');
    expect(notes.reasons.map(r => r.code)).toEqual([
      'JSON_HEAD',
      'PARSER_NOTES',
    ]);
  });

  it('writes reasons of a fixed short text and quotes nothing', () => {
    const result = classifyQuizJson({
      relPath: 'a.json',
      summary: summary({
        setsWithErrors: 1,
        warnings: 1,
        errorCodes: ['A'.repeat(300)],
      }),
    });
    for (const r of result.reasons) {
      expect(r.text.length).toBeLessThanOrEqual(REASON_TEXT_MAX);
      expect(r.text).toMatch(/[Dd]ie|[Dd]er|[Dd]ateiname/);
    }
  });

  it('reads the hint of a name with the words of the sources', () => {
    expect(kindHintOfName('a/Global-Quiz.json')).toBe('global');
    expect(kindHintOfName('a/lektion-quizze.json')).toBe('lesson');
    expect(kindHintOfName('a/Lesson.json')).toBe('lesson');
    expect(kindHintOfName('a/quizze.json')).toBeNull();
    expect(kindHintOfName('')).toBeNull();
  });
});

describe('classifyMappingSheet', () => {
  const parsed = () => {
    const result = parseMappingSheet(sampleRows());
    if (!result.ok) throw new Error(result.error);
    return result.sheet;
  };

  it('is high for a table of the form, with the counts of the sheet and no cell text', () => {
    const counts = summarizeMappingSheet(parsed());
    expect(counts).toMatchObject({
      positions: 7,
      blocks: 4,
      blocksWithIssues: 0,
      orphanRows: 0,
      issueCodes: [],
    });
    const result = classifyMappingSheet(counts);
    expect(result).toMatchObject({
      docType: 'other',
      band: 'high',
      confidence: 0.95,
      source: 'content',
    });
    expect(result.reasons.map(r => r.code)).toEqual(['XLSX_MAPPING']);
    expect(JSON.stringify(result)).not.toMatch(/Erfunden|Position [a-z]\b/);
  });

  it('is medium when blocks cannot be assigned, with a reason no click overrides', () => {
    const sheet = parsed();
    sheet.blocks[0].issues.push('BLOCK_UNKNOWN');
    sheet.orphanRows.push(40);
    const counts = summarizeMappingSheet(sheet);
    expect(counts).toMatchObject({
      blocksWithIssues: 1,
      orphanRows: 1,
      issueCodes: ['BLOCK_UNKNOWN'],
    });
    const result = classifyMappingSheet(counts);
    expect(result).toMatchObject({ band: 'medium', confidence: 0.7 });
    expect(result.reasons.map(r => r.code)).toEqual([
      'XLSX_MAPPING',
      'PARSER_ERRORS',
    ]);
  });
});
