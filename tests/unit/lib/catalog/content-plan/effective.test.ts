import { describe, it, expect } from '@jest/globals';
import {
  effectiveTargets,
  planTargets,
} from '@/lib/catalog/content-plan/effective';
import { buildCatalogStats, type StatsRow } from '@/lib/catalog/content-stats';
import type { ContentPlan } from '@/lib/catalog/content-plan/types';

const source = {
  fileName: 'plan.xlsx',
  savedAt: '2026-11-03T10:00:00.000Z',
  fieldCount: 3,
  method: 'script' as const,
};
const withPlan = (plan: ContentPlan, extra: Record<string, unknown> = {}) => ({
  settings: { ...extra, content_plan: { plan, source } },
});

describe('effective targets: manual first, else plan, else none', () => {
  it('has no target without manual number and without plan', () => {
    expect(effectiveTargets({ settings: {} })).toEqual({});
    expect(effectiveTargets({ settings: null })).toEqual({});
  });

  it('takes the manual number alone', () => {
    expect(
      effectiveTargets({ settings: { content_targets: { enablers: 226 } } })
    ).toEqual({
      enablers: { value: 226, origin: 'manual', manual: 226, plan: null },
    });
  });

  it('takes the plan where no manual number is set', () => {
    expect(
      effectiveTargets(withPlan({ totals: { scenarios: 225, hours: 5000 } }))
    ).toEqual({
      scenarios: { value: 225, origin: 'plan', manual: null, plan: 225 },
    });
  });

  it('the manual number wins over the plan, both are kept', () => {
    const e = effectiveTargets(
      withPlan(
        { totals: { enablers: 225, scenarios: 224 } },
        { content_targets: { enablers: 226 } }
      )
    );
    expect(e.enablers).toEqual({
      value: 226,
      origin: 'manual',
      manual: 226,
      plan: 225,
    });
    // another kind of content has no manual number: the plan counts there
    expect(e.scenarios).toMatchObject({ value: 224, origin: 'plan' });
  });

  it('a manual zero is a number and wins', () => {
    expect(
      effectiveTargets(
        withPlan(
          { totals: { useCases: 9 } },
          { content_targets: { use_cases: 0 } }
        )
      ).useCases
    ).toMatchObject({ value: 0, origin: 'manual', plan: 9 });
  });

  it('ignores a damaged plan', () => {
    expect(
      effectiveTargets({
        settings: { content_plan: { plan: { totals: { x: 1 } } } },
      })
    ).toEqual({});
  });

  it('never changes the manual targets', () => {
    const settings = {
      content_targets: { enablers: 226 },
      content_plan: { plan: { totals: { enablers: 1 } }, source },
    };
    const before = JSON.stringify(settings);
    effectiveTargets({ settings });
    expect(JSON.stringify(settings)).toBe(before);
  });
});

describe('what the plan says per kind of content', () => {
  it('uses a stated total as it stands', () => {
    expect(
      planTargets({
        totals: { enablers: 12 },
        components: [{ code: 'K1', enablers: 5 }],
      }).enablers
    ).toBe(12);
  });

  it('counts components and learning fields from the lists', () => {
    expect(
      planTargets({
        components: [{ code: 'K1' }, { code: 'K2' }],
        learningFields: [{ code: 'LF1' }],
      })
    ).toMatchObject({ components: 2, learningFields: 1 });
  });

  it('sums over the components only when every component states its part', () => {
    expect(
      planTargets({
        components: [
          { code: 'K1', enablers: 5, quizzes: 15 },
          { code: 'K2', enablers: 4, quizzes: 12 },
        ],
      })
    ).toMatchObject({ enablers: 9, lessonQuizzes: 27 });
    expect(
      planTargets({
        components: [{ code: 'K1', enablers: 5 }, { code: 'K2' }],
      }).enablers
    ).toBeUndefined();
  });

  it('counts global quizzes only when every component says yes or no', () => {
    expect(
      planTargets({
        components: [
          { code: 'K1', globalQuiz: true },
          { code: 'K2', globalQuiz: false },
        ],
      }).globalQuizzes
    ).toBe(1);
    expect(
      planTargets({
        components: [{ code: 'K1', globalQuiz: true }, { code: 'K2' }],
      }).globalQuizzes
    ).toBeUndefined();
  });

  it('says nothing for no plan', () => {
    expect(planTargets(null)).toEqual({});
    expect(planTargets({})).toEqual({});
  });
});

describe('statistics use the effective target and say where it comes from', () => {
  const row = (settings: unknown): StatsRow => ({
    id: 'c1',
    code: 'KFBM',
    title: 'Beruf',
    is_active: true,
    settings,
    components: 27,
    enablers: 226,
    enablers_active: 200,
    scenarios: 225,
    use_cases: 225,
    use_cases_active: 0,
    lesson_quizzes: 678,
    lesson_quizzes_active: 600,
    global_quizzes: 27,
    global_quizzes_active: 27,
    learning_fields: 13,
    questions: 1,
    mappings: 1,
  });

  it('manual number, plan number and the difference', () => {
    const stats = buildCatalogStats(
      row({
        content_targets: { enablers: 226 },
        content_plan: {
          plan: { totals: { enablers: 225, scenarios: 226 } },
          source,
        },
      }),
      true
    );
    const byId = Object.fromEntries(stats.metrics.map(m => [m.id, m]));
    expect(byId.enablers).toMatchObject({ target: 226, status: 'met' });
    expect(byId.scenarios).toMatchObject({
      target: 226,
      difference: -1,
      status: 'missing',
    });
    expect(byId.components.target).toBeNull();
    expect(stats.targetSources).toEqual({
      enablers: { origin: 'manual', manual: 226, plan: 225 },
      scenarios: { origin: 'plan', manual: null, plan: 226 },
    });
  });

  it('nothing of targets or plan leaves for a viewer who may not see them', () => {
    const stats = buildCatalogStats(
      row({
        content_targets: { enablers: 226 },
        content_plan: { plan: { totals: { scenarios: 1 } }, source },
      }),
      false
    );
    expect(stats.targetSources).toBeUndefined();
    expect(stats.metrics.every(m => m.target === null)).toBe(true);
    expect(JSON.stringify(stats)).not.toContain('plan.xlsx');
  });
});
