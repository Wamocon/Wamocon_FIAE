import { describe, it, expect } from '@jest/globals';
import {
  PLAN_LIMITS,
  contentPlanSchema,
  countPlanFields,
  fieldSchema,
  isPlanEmpty,
  planComponentSchema,
  readStoredContentPlan,
  safeFileName,
  savePlanBodySchema,
  storedContentPlanSchema,
  type ContentPlan,
} from '@/lib/catalog/content-plan/types';
import {
  resolveCatalogSettings,
  validateCatalogSettings,
} from '@/lib/catalog/settings';
import { EXAMPLE_PLAN } from '@/lib/catalog/content-plan/template';

const source = {
  fileName: 'plan.xlsx',
  savedAt: '2026-11-03T10:00:00.000Z',
  fieldCount: 3,
  method: 'script' as const,
};

describe('plan model: valid plans', () => {
  it('accepts the empty plan: every part is optional', () => {
    expect(contentPlanSchema.safeParse({}).success).toBe(true);
    expect(isPlanEmpty({})).toBe(true);
  });

  it('accepts a plan with only one part', () => {
    expect(
      contentPlanSchema.safeParse({ totals: { enablers: 226 } }).success
    ).toBe(true);
    expect(
      contentPlanSchema.safeParse({ notes: ['Hinweis zur Ausbildung'] }).success
    ).toBe(true);
  });

  it('accepts the example of the template', () => {
    expect(contentPlanSchema.safeParse(EXAMPLE_PLAN).success).toBe(true);
  });

  it('accepts a component with only a title or only a code', () => {
    expect(planComponentSchema.safeParse({ title: 'Grundlagen' }).success).toBe(
      true
    );
    expect(planComponentSchema.safeParse({ code: 'K1' }).success).toBe(true);
  });
});

describe('plan model: refuses what is not valid', () => {
  it.each([
    ['null instead of "not stated"', { totals: { enablers: null } }],
    ['negative count', { totals: { enablers: -1 } }],
    [
      'count above the limit',
      { totals: { enablers: PLAN_LIMITS.maxCount + 1 } },
    ],
    ['fraction in a count', { totals: { scenarios: 1.5 } }],
    ['text instead of a number', { totals: { useCases: '5' } }],
    ['NaN', { totals: { hours: Number.NaN } }],
    ['Infinity', { totals: { hours: Number.POSITIVE_INFINITY } }],
    ['hours above the limit', { totals: { hours: PLAN_LIMITS.maxHours + 1 } }],
    ['zero questions per quiz', { totals: { questionsPerQuiz: 0 } }],
    ['unknown total', { totals: { quizzes: 3 } }],
    ['unknown top level key', { components: [], extra: 1 }],
    ['component without code and title', { components: [{ hours: 4 }] }],
    ['component with phase 3', { components: [{ code: 'K1', phase: 3 }] }],
    [
      'component with unknown kind',
      { components: [{ code: 'K1', kind: 'x' }] },
    ],
    ['component with unknown key', { components: [{ code: 'K1', foo: 1 }] }],
    [
      'component with an empty list of learning fields',
      { components: [{ code: 'K1', learningFields: [] }] },
    ],
    [
      'relation with unknown type',
      { relations: [{ type: 'x', from: 'a', to: 'b' }] },
    ],
    [
      'relation without target',
      { relations: [{ type: 'use_case_enabler', from: 'a' }] },
    ],
    ['empty code', { components: [{ code: '   ' }] }],
    ['code with a control character', { components: [{ code: 'K\u0001' }] }],
    ['code above 64 characters', { components: [{ code: 'K'.repeat(65) }] }],
    ['note above 500 characters', { notes: ['x'.repeat(501)] }],
  ])('%s', (_name, plan) => {
    expect(contentPlanSchema.safeParse(plan).success).toBe(false);
  });

  it('bounds the lists', () => {
    const many = (n: number) =>
      Array.from({ length: n }, (_, i) => ({ code: `K${i}` }));
    expect(
      contentPlanSchema.safeParse({
        components: many(PLAN_LIMITS.maxComponents),
      }).success
    ).toBe(true);
    expect(
      contentPlanSchema.safeParse({
        components: many(PLAN_LIMITS.maxComponents + 1),
      }).success
    ).toBe(false);
    expect(
      contentPlanSchema.safeParse({
        notes: Array.from({ length: PLAN_LIMITS.maxNotes + 1 }, () => 'x'),
      }).success
    ).toBe(false);
  });

  it('knows the schema of a single field and refuses an unknown one', () => {
    expect(fieldSchema('totals', 'hours')?.safeParse(5).success).toBe(true);
    expect(fieldSchema('totals', 'hours')?.safeParse(-5).success).toBe(false);
    expect(fieldSchema('component', 'nope')).toBeNull();
    expect(fieldSchema('component', 'constructor')).toBeNull();
  });
});

describe('stored plan and source', () => {
  it('accepts plan and source, refuses unknown keys and a bad source', () => {
    expect(
      storedContentPlanSchema.safeParse({ plan: EXAMPLE_PLAN, source }).success
    ).toBe(true);
    expect(
      storedContentPlanSchema.safeParse({
        plan: EXAMPLE_PLAN,
        source,
        file: 'content',
      }).success
    ).toBe(false);
    expect(
      storedContentPlanSchema.safeParse({
        plan: EXAMPLE_PLAN,
        source: { ...source, method: 'manual' },
      }).success
    ).toBe(false);
    expect(
      storedContentPlanSchema.safeParse({
        plan: EXAMPLE_PLAN,
        source: { ...source, savedAt: 'yesterday' },
      }).success
    ).toBe(false);
  });

  it('refuses a stored value above 200 KB as JSON', () => {
    const relations = Array.from(
      { length: PLAN_LIMITS.maxRelations },
      (_, i) => ({
        type: 'enabler_learning_field' as const,
        from: `K${i}-${'a'.repeat(50)}`,
        to: `LF-${i}-${'b'.repeat(50)}`,
      })
    );
    const plan: ContentPlan = {
      relations,
      components: Array.from({ length: PLAN_LIMITS.maxComponents }, (_, i) => ({
        code: `K${i}`,
        title: 'T'.repeat(PLAN_LIMITS.maxTitleChars),
      })),
      notes: Array.from({ length: PLAN_LIMITS.maxNotes }, () =>
        'n'.repeat(PLAN_LIMITS.maxNoteChars)
      ),
    };
    expect(contentPlanSchema.safeParse(plan).success).toBe(true);
    expect(JSON.stringify({ plan, source }).length).toBeGreaterThan(
      PLAN_LIMITS.maxStoredChars
    );
    expect(storedContentPlanSchema.safeParse({ plan, source }).success).toBe(
      false
    );
  });

  it('reads the stored plan tolerantly: a bad value is no plan', () => {
    expect(readStoredContentPlan(null)).toBeNull();
    expect(readStoredContentPlan({})).toBeNull();
    expect(readStoredContentPlan({ content_plan: 'x' })).toBeNull();
    expect(
      readStoredContentPlan({
        content_plan: { plan: { totals: { a: 1 } }, source },
      })
    ).toBeNull();
    expect(
      readStoredContentPlan({ content_plan: { plan: EXAMPLE_PLAN, source } })
        ?.source.fileName
    ).toBe('plan.xlsx');
  });

  it('save body: plan, a file name and a method, nothing else', () => {
    expect(
      savePlanBodySchema.safeParse({
        plan: { totals: { enablers: 1 } },
        fileName: 'a.xlsx',
        method: 'ki',
      }).success
    ).toBe(true);
    for (const bad of [
      { plan: {}, fileName: 'a', method: 'x' },
      { plan: {}, fileName: '', method: 'ki' },
      { plan: {}, fileName: 'a', method: 'ki', extra: 1 },
      { fileName: 'a', method: 'ki' },
    ]) {
      expect(savePlanBodySchema.safeParse(bad).success).toBe(false);
    }
  });

  it('cuts a file name to a plain name', () => {
    expect(safeFileName('C:\\Users\\x\\plan.xlsx')).toBe('plan.xlsx');
    expect(safeFileName('/tmp/../plan.docx')).toBe('plan.docx');
    expect(safeFileName('a\u0000b.pdf')).toBe('a b.pdf');
    expect(safeFileName('')).toBe('plan');
    expect(safeFileName('x'.repeat(500)).length).toBe(
      PLAN_LIMITS.maxFileNameChars
    );
  });

  it('counts the fields', () => {
    expect(countPlanFields({})).toBe(0);
    expect(
      countPlanFields({
        totals: { enablers: 1, hours: 2 },
        components: [{ code: 'K1', hours: 3 }],
        relations: [{ type: 'use_case_enabler', from: 'a', to: 'b' }],
        notes: ['x'],
      })
    ).toBe(6);
  });
});

describe('settings schema knows the plan', () => {
  it('accepts content_plan next to the other keys and still refuses unknown ones', () => {
    expect(
      validateCatalogSettings({
        phase_months: [15, 21],
        content_targets: { enablers: 226 },
        content_plan: { plan: EXAMPLE_PLAN, source },
      }).success
    ).toBe(true);
    expect(
      validateCatalogSettings({ content_plan: { plan: {} } }).success
    ).toBe(false);
    expect(validateCatalogSettings({ content_plans: {} }).success).toBe(false);
  });

  it('resolveCatalogSettings ignores the plan (it is no behaviour setting)', () => {
    expect(
      resolveCatalogSettings({
        phase_months: [15, 21],
        content_plan: { plan: EXAMPLE_PLAN, source },
      }).phaseMonths
    ).toEqual([15, 21]);
  });
});
