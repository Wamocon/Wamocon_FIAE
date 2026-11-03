import {
  CONTENT_METRICS,
  readContentTargets,
  type ContentMetricId,
  type ContentTargets,
} from '@/lib/catalog/content-targets';
import {
  readStoredContentPlan,
  type ContentPlan,
  type PlanComponent,
} from '@/lib/catalog/content-plan/types';

/**
 * The effective target ("wirksames Soll") of every kind of content: a manual
 * number wins, otherwise the number of the plan document, otherwise no target.
 * Pure. The plan never replaces or changes a manual number (it is only read),
 * and a kind of content with neither has no entry ("kein Soll", never zero).
 */

export type TargetOrigin = 'manual' | 'plan';

export interface EffectiveTarget {
  /** The number that counts: manual, else plan. */
  value: number;
  origin: TargetOrigin;
  /** The manual number, null when none was set. */
  manual: number | null;
  /** The number of the plan, null when the plan does not state it. */
  plan: number | null;
}

export type EffectiveTargets = Partial<
  Record<ContentMetricId, EffectiveTarget>
>;

/** The key of a kind of content in the totals of the plan. */
const TOTAL_OF: Record<
  ContentMetricId,
  keyof NonNullable<ContentPlan['totals']>
> = {
  components: 'components',
  enablers: 'enablers',
  scenarios: 'scenarios',
  useCases: 'useCases',
  lessonQuizzes: 'lessonQuizzes',
  globalQuizzes: 'globalQuizzes',
  learningFields: 'learningFields',
};

/** The per component field that sums up to a kind of content. */
const SUM_OF: Partial<Record<ContentMetricId, keyof PlanComponent>> = {
  enablers: 'enablers',
  scenarios: 'scenarios',
  useCases: 'useCases',
  lessonQuizzes: 'quizzes',
};

/**
 * What the plan says per kind of content. A stated total is used as it stands.
 * Without one, a number is derived only where the plan lists the parts: the
 * count of components or learning fields, and a sum over the components only
 * when EVERY component states its part (one gap would make the sum a guess).
 */
export function planTargets(
  plan: ContentPlan | null | undefined
): ContentTargets {
  const result: ContentTargets = {};
  if (!plan) return result;
  const components = plan.components ?? [];
  for (const id of CONTENT_METRICS) {
    const stated = plan.totals?.[TOTAL_OF[id]];
    if (stated !== undefined) {
      result[id] = stated;
      continue;
    }
    if (id === 'components' && components.length > 0) {
      result[id] = components.length;
    } else if (
      id === 'learningFields' &&
      (plan.learningFields ?? []).length > 0
    ) {
      result[id] = (plan.learningFields ?? []).length;
    } else if (id === 'globalQuizzes' && components.length > 0) {
      if (components.every(c => c.globalQuiz !== undefined)) {
        result[id] = components.filter(c => c.globalQuiz === true).length;
      }
    } else if (SUM_OF[id] && components.length > 0) {
      const key = SUM_OF[id] as
        | 'enablers'
        | 'scenarios'
        | 'useCases'
        | 'quizzes';
      if (components.every(c => c[key] !== undefined)) {
        result[id] = components.reduce((sum, c) => sum + (c[key] ?? 0), 0);
      }
    }
  }
  return result;
}

/**
 * The effective targets of a catalog (a row with its `settings`): manual, else
 * plan, else no entry. Tolerant: a bad stored value counts as "not set".
 */
export function effectiveTargets(catalog: {
  settings: unknown;
}): EffectiveTargets {
  const manual = readContentTargets(catalog.settings);
  const plan = planTargets(readStoredContentPlan(catalog.settings)?.plan);
  const result: EffectiveTargets = {};
  for (const id of CONTENT_METRICS) {
    const m = manual[id];
    const p = plan[id];
    if (m === undefined && p === undefined) continue;
    result[id] =
      m !== undefined
        ? { value: m, origin: 'manual', manual: m, plan: p ?? null }
        : { value: p as number, origin: 'plan', manual: null, plan: p ?? null };
  }
  return result;
}
