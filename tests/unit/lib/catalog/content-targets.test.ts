import { describe, it, expect } from '@jest/globals';
import {
  CONTENT_METRICS,
  CONTENT_TARGET_MAX,
  STORED_TARGET_KEY,
  compareToTarget,
  contentTargetsBodySchema,
  contentTargetsInputSchema,
  readContentTargets,
  storedContentTargetsSchema,
  toStoredContentTargets,
} from '@/lib/catalog/content-targets';
import {
  resolveCatalogSettings,
  validateCatalogSettings,
} from '@/lib/catalog/settings';

describe('content targets: input schema', () => {
  it('accepts whole numbers from 0 to 100000, null and missing keys', () => {
    expect(
      contentTargetsInputSchema.safeParse({
        components: 27,
        enablers: 0,
        scenarios: CONTENT_TARGET_MAX,
        useCases: null,
      }).success
    ).toBe(true);
    expect(contentTargetsInputSchema.safeParse({}).success).toBe(true);
  });

  it.each([
    ['negative', { components: -1 }],
    ['above the maximum', { components: CONTENT_TARGET_MAX + 1 }],
    ['fraction', { enablers: 1.5 }],
    ['text', { scenarios: '5' }],
    ['NaN', { useCases: Number.NaN }],
    ['Infinity', { lessonQuizzes: Number.POSITIVE_INFINITY }],
    ['boolean', { globalQuizzes: true }],
    ['unknown key', { components: 1, quizzes: 3 }],
    ['snake case key in the API form', { use_cases: 3 }],
    ['prototype pollution key', JSON.parse('{"__proto__": {"x": 1}}')],
  ])('refuses %s', (_name, input) => {
    expect(contentTargetsInputSchema.safeParse(input).success).toBe(false);
  });

  it('the body needs an object under targets and nothing else', () => {
    expect(contentTargetsBodySchema.safeParse({ targets: {} }).success).toBe(
      true
    );
    for (const body of [
      null,
      {},
      { targets: null },
      { targets: [] },
      { targets: {}, extra: 1 },
    ]) {
      expect(contentTargetsBodySchema.safeParse(body).success).toBe(false);
    }
  });
});

describe('content targets: stored form', () => {
  it('maps every metric to its own snake_case key', () => {
    expect(CONTENT_METRICS).toHaveLength(7);
    expect(new Set(Object.values(STORED_TARGET_KEY)).size).toBe(7);
    expect(STORED_TARGET_KEY.useCases).toBe('use_cases');
    expect(STORED_TARGET_KEY.lessonQuizzes).toBe('lesson_quizzes');
  });

  it('writes only the targets that are set', () => {
    expect(
      toStoredContentTargets({
        components: 27,
        useCases: 226,
        scenarios: null,
        enablers: 0,
      })
    ).toEqual({ components: 27, use_cases: 226, enablers: 0 });
    expect(toStoredContentTargets({})).toEqual({});
  });

  it('reads what it writes', () => {
    const stored = toStoredContentTargets({
      components: 27,
      enablers: 226,
      scenarios: 226,
      useCases: 226,
      lessonQuizzes: 678,
      globalQuizzes: 27,
      learningFields: 13,
    });
    expect(readContentTargets({ content_targets: stored })).toEqual({
      components: 27,
      enablers: 226,
      scenarios: 226,
      useCases: 226,
      lessonQuizzes: 678,
      globalQuizzes: 27,
      learningFields: 13,
    });
  });

  it('reads tolerantly: a bad key is "no target", nothing throws', () => {
    expect(
      readContentTargets({ content_targets: { components: 'x' } })
    ).toEqual({});
    expect(
      readContentTargets({
        content_targets: {
          components: 5,
          enablers: -3,
          bogus: 9,
          use_cases: 7,
        },
      })
    ).toEqual({ components: 5, useCases: 7 });
    for (const raw of [
      null,
      undefined,
      'text',
      7,
      [],
      {},
      { content_targets: null },
      { content_targets: [] },
      { content_targets: 'x' },
    ]) {
      expect(readContentTargets(raw)).toEqual({});
    }
  });

  it('the strict stored schema refuses unknown keys and bad values', () => {
    expect(storedContentTargetsSchema.safeParse({ use_cases: 1 }).success).toBe(
      true
    );
    expect(storedContentTargetsSchema.safeParse({ useCases: 1 }).success).toBe(
      false
    );
    expect(
      storedContentTargetsSchema.safeParse({ enablers: 1e6 }).success
    ).toBe(false);
  });
});

describe('content targets in the catalog settings', () => {
  it('validateCatalogSettings accepts the key and refuses bad content', () => {
    expect(
      validateCatalogSettings({ content_targets: { enablers: 226 } }).success
    ).toBe(true);
    const bad = validateCatalogSettings({
      content_targets: { enablers: 100001, rooms: 3 },
    });
    expect(bad.success).toBe(false);
    if (!bad.success) {
      expect(bad.errors.join(' ')).toMatch(/content_targets/);
    }
  });

  it('the other settings are read as before', () => {
    expect(
      resolveCatalogSettings({
        content_targets: { enablers: 226 },
        phase_months: [15, 21],
      }).phaseMonths
    ).toEqual([15, 21]);
  });
});

describe('compareToTarget', () => {
  it('has no status without a target', () => {
    for (const target of [null, undefined]) {
      expect(compareToTarget(5, target)).toEqual({
        difference: null,
        status: 'no_target',
        percent: null,
      });
    }
  });

  it('met, missing and exceeds with the difference actual minus target', () => {
    expect(compareToTarget(226, 226)).toEqual({
      difference: 0,
      status: 'met',
      percent: 100,
    });
    expect(compareToTarget(225, 226)).toEqual({
      difference: -1,
      status: 'missing',
      // rounded down: one missing item never shows as 100 percent
      percent: 99,
    });
    expect(compareToTarget(230, 226)).toEqual({
      difference: 4,
      status: 'exceeds',
      percent: 100,
    });
  });

  it('handles a target of zero', () => {
    expect(compareToTarget(0, 0)).toEqual({
      difference: 0,
      status: 'met',
      percent: 100,
    });
    expect(compareToTarget(3, 0)).toEqual({
      difference: 3,
      status: 'exceeds',
      percent: 100,
    });
  });

  it('starts at zero percent', () => {
    expect(compareToTarget(0, 27)).toEqual({
      difference: -27,
      status: 'missing',
      percent: 0,
    });
  });
});
