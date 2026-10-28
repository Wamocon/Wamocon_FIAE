/**
 * @jest-environment node
 */
import { readFileSync } from 'fs';
import { join } from 'path';
import { isConfirmedCode, isReleaseMode } from '@/lib/catalog/content-release';

// The release and the assignment only switch visibility and membership rows.
// They must not reach the HAI index, the storage or any model: the HAI reads
// content through its own indexer (a separate, explicit run) and keeps the
// answers of a quiz in the trainer-only part of the index, so a release gives
// the HAI nothing beyond what the solution protection already allows.

const ROOT = process.cwd();
const FILES = [
  'src/lib/catalog/content-release.ts',
  'src/lib/catalog/trainee-content.ts',
  'src/app/api/admin/catalogs/[catalogId]/content-release/route.ts',
  'src/app/api/admin/catalogs/[catalogId]/trainee-content/route.ts',
];

describe('release and assignment stay away from HAI, storage and models', () => {
  it.each(FILES)('%s does not import them', file => {
    const source = readFileSync(join(ROOT, file), 'utf8');
    for (const forbidden of [
      '@/lib/hai',
      'indexContent',
      'embedding',
      'supabase',
      'storage',
      'openai',
      'sokrates',
    ]) {
      expect(source.toLowerCase()).not.toContain(forbidden.toLowerCase());
    }
  });

  it('the release writes visibility columns only (no text, question or answer column)', () => {
    const source = readFileSync(join(ROOT, FILES[0]), 'utf8');
    const sets = [...source.matchAll(/\.set\(([\s\S]*?)\)\s*\.where/g)].map(
      m => m[1]
    );
    expect(sets.length).toBe(4);
    const written = new Set(
      sets.flatMap(s => [...s.matchAll(/\b(\w+):/g)].map(m => m[1]))
    );
    expect([...written].sort()).toEqual(
      ['activatedAt', 'isActive', 'isPublished'].sort()
    );
  });

  it('the trainee tool inserts only and never deletes or updates', () => {
    const source = readFileSync(join(ROOT, FILES[1]), 'utf8');
    expect(source).not.toMatch(/\.delete\(/);
    expect(source).not.toMatch(/\.update\(/);
    expect(source.match(/onConflictDoNothing/g)?.length).toBe(2);
  });

  it('the HAI indexer keeps the quiz answers in the trainer-only part', () => {
    const source = readFileSync(
      join(ROOT, 'src/app/api/hai/embed/route.ts'),
      'utf8'
    );
    expect(source).toContain('QUIZ_ANSWERS_VISIBILITY');
    expect(source).toContain('QUIZ_QUESTIONS_VISIBILITY');
  });
});

describe('release input rules', () => {
  it('only release and lock are modes', () => {
    expect(isReleaseMode('release')).toBe(true);
    expect(isReleaseMode('lock')).toBe(true);
    for (const bad of ['', 'Release', 'delete', null, undefined, 1, {}]) {
      expect(isReleaseMode(bad)).toBe(false);
    }
  });

  it('the confirmation is the exact code, trimmed, case sensitive', () => {
    expect(isConfirmedCode('KFBM', 'KFBM')).toBe(true);
    expect(isConfirmedCode('  KFBM\n', 'KFBM')).toBe(true);
    for (const bad of ['kfbm', 'KFB', 'KFBM2', '', undefined, null, 1]) {
      expect(isConfirmedCode(bad, 'KFBM')).toBe(false);
    }
  });
});
