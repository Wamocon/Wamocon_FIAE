/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  TRAINER_KNOWLEDGE_KEY,
  TRAINER_SOLUTION_CHUNK_KEY,
  TRAINER_SOLUTIONS_ENV,
  hasTrainerKnowledge,
  isTrainerSolutionChunk,
  isTrainerSolutionsEnabled,
  parsePrivateSolutionObject,
  privateSolutionPrefix,
  searchMayUseTrainerSolutions,
} from '@/lib/hai/trainerSolutions';

// Trainer solutions in the index (off by default): the switch, the marker of a
// chunk and the check of the private reference of a model solution. Pure
// functions, no network, no database.

describe('the switch HAI_TRAINER_SOLUTIONS', () => {
  it('is named HAI_TRAINER_SOLUTIONS', () => {
    expect(TRAINER_SOLUTIONS_ENV).toBe('HAI_TRAINER_SOLUTIONS');
  });

  it('is off without a value, on only for "on"', () => {
    expect(isTrainerSolutionsEnabled({})).toBe(false);
    expect(isTrainerSolutionsEnabled({ HAI_TRAINER_SOLUTIONS: 'on' })).toBe(
      true
    );
    expect(isTrainerSolutionsEnabled({ HAI_TRAINER_SOLUTIONS: ' ON ' })).toBe(
      true
    );
  });

  it.each(['', 'off', 'true', '1', 'yes', 'enabled', 'on!', 'o n'])(
    'stays off for the value %p (a bare yes or true is no decision)',
    value => {
      expect(isTrainerSolutionsEnabled({ HAI_TRAINER_SOLUTIONS: value })).toBe(
        false
      );
    }
  );
});

describe('markers in metadata', () => {
  it('knows a chunk of a trainer solution only by the boolean marker', () => {
    expect(TRAINER_SOLUTION_CHUNK_KEY).toBe('trainerSolution');
    expect(isTrainerSolutionChunk({ trainerSolution: true })).toBe(true);
    expect(isTrainerSolutionChunk({ trainerSolution: 'true' })).toBe(true);
    for (const metadata of [
      null,
      undefined,
      {},
      { trainerSolution: false },
      { trainerSolution: 'no' },
      { documentType: 'TRAINER_SOLUTION' },
    ]) {
      expect(isTrainerSolutionChunk(metadata as never)).toBe(false);
    }
  });

  it('knows a session or message that holds trainer knowledge', () => {
    expect(TRAINER_KNOWLEDGE_KEY).toBe('trainerKnowledge');
    expect(hasTrainerKnowledge({ trainerKnowledge: true })).toBe(true);
    expect(hasTrainerKnowledge({ trainerKnowledge: 'true' })).toBe(true);
    for (const metadata of [null, undefined, {}, [], 'x', 5]) {
      expect(hasTrainerKnowledge(metadata as never)).toBe(false);
    }
  });
});

describe('searchMayUseTrainerSolutions', () => {
  it('needs the trainer audience and the explicit permission', () => {
    expect(
      searchMayUseTrainerSolutions({
        audience: 'trainer',
        includeTrainerSolutions: true,
      })
    ).toBe(true);
    for (const scope of [
      { audience: 'trainer' as const },
      { audience: 'trainer' as const, includeTrainerSolutions: false },
      { audience: 'trainee' as const, includeTrainerSolutions: true },
      { audience: 'TRAINER' as never, includeTrainerSolutions: true },
      { includeTrainerSolutions: true } as never,
    ]) {
      expect(searchMayUseTrainerSolutions(scope)).toBe(false);
    }
  });
});

describe('privateSolutionPrefix', () => {
  it('keeps Preview and Production apart (the buckets are shared)', () => {
    expect(privateSolutionPrefix('preview')).toBe('preview/kfbm/');
    expect(privateSolutionPrefix('production')).toBe('kfbm/');
    expect(privateSolutionPrefix('local')).toBe('kfbm/');
  });
});

describe('parsePrivateSolutionObject', () => {
  const ref = (path: string, bucket = 'content-solutions') =>
    `private://${bucket}/${path}`;

  it('takes a reference into the bucket and the prefix of the target', () => {
    expect(
      parsePrivateSolutionObject(
        ref('preview/kfbm/UC-01/musterloesung/Loesung_1.pdf'),
        'preview/kfbm/'
      )
    ).toEqual({
      ok: true,
      object: {
        bucket: 'content-solutions',
        path: 'preview/kfbm/UC-01/musterloesung/Loesung_1.pdf',
      },
    });
    expect(
      parsePrivateSolutionObject(ref('kfbm/UC-01/a.PDF'), 'kfbm/')
    ).toMatchObject({ ok: true });
  });

  it('refuses the prefix of the other target', () => {
    expect(
      parsePrivateSolutionObject(ref('kfbm/a.pdf'), 'preview/kfbm/')
    ).toMatchObject({ ok: false });
    expect(
      parsePrivateSolutionObject(ref('preview/kfbm/a.pdf'), 'kfbm/')
    ).toMatchObject({ ok: false });
    expect(
      parsePrivateSolutionObject(ref('other/a.pdf'), 'kfbm/')
    ).toMatchObject({ ok: false });
  });

  it('refuses an empty prefix or one that is no folder (the folder is the check)', () => {
    for (const prefix of ['', 'kfbm', '/', 'kfbm/..', undefined]) {
      expect(
        parsePrivateSolutionObject(ref('kfbm/a.pdf'), prefix as never)
      ).toMatchObject({ ok: false });
    }
  });

  it('refuses every other bucket', () => {
    for (const bucket of [
      'content',
      'content-solutions-x',
      'Content-Solutions',
      'content-solution',
      '',
    ]) {
      expect(
        parsePrivateSolutionObject(ref('kfbm/a.pdf', bucket), 'kfbm/')
      ).toMatchObject({ ok: false });
    }
  });

  it('refuses what is no private reference', () => {
    for (const value of [
      null,
      undefined,
      42,
      '',
      'https://project.supabase.co/storage/v1/object/public/content/a.pdf',
      'http://localhost/kfbm/a.pdf',
      'file:///kfbm/a.pdf',
      'kfbm/a.pdf',
      'PRIVATE://content-solutions/kfbm/a.pdf',
      '  private://content-solutions/kfbm/a.pdf',
      'private://content-solutions/kfbm/a.pdf ',
      'private://content-solutions/',
      'private://content-solutions',
      'private://',
    ]) {
      expect(parsePrivateSolutionObject(value, 'kfbm/')).toMatchObject({
        ok: false,
      });
    }
  });

  it('refuses a path that could leave the prefix or the bucket', () => {
    for (const path of [
      'kfbm/../other/a.pdf',
      'kfbm/./a.pdf',
      'kfbm//a.pdf',
      'kfbm/a/../../b.pdf',
      'kfbm/%2e%2e/a.pdf',
      'kfbm/a%2Fb.pdf',
      'kfbm\\a.pdf',
      'kfbm/a b.pdf',
      'kfbm/ä.pdf',
      'kfbm/a.pdf?token=abc',
      'kfbm/a.pdf#x',
      'kfbm/a.pdf\n',
      '/kfbm/a.pdf',
      'kfbm/a.pdf/',
      'kfbm/@evil.example/a.pdf',
      'kfbm/a:b.pdf',
    ]) {
      expect(parsePrivateSolutionObject(ref(path), 'kfbm/')).toMatchObject({
        ok: false,
      });
    }
  });

  it('refuses a file that is no PDF and a path that is too long', () => {
    for (const path of [
      'kfbm/a.docx',
      'kfbm/a',
      'kfbm/a.pdf.exe',
      'kfbm/pdf',
    ]) {
      expect(parsePrivateSolutionObject(ref(path), 'kfbm/')).toMatchObject({
        ok: false,
      });
    }
    expect(
      parsePrivateSolutionObject(ref(`kfbm/${'a'.repeat(400)}.pdf`), 'kfbm/')
    ).toMatchObject({ ok: false });
  });

  it('never repeats the value in the reason', () => {
    const result = parsePrivateSolutionObject(
      ref('kfbm/../secret-name.pdf'),
      'kfbm/'
    );
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).not.toContain('secret-name');
  });
});
