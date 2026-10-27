import { z } from 'zod';

/**
 * Content targets ("Soll") of a training catalog and the comparison with the
 * actual numbers ("Ist"). Pure and free of server imports, so the settings
 * schema, the API and the admin screen share it.
 *
 * Targets live in training_catalogs.settings under the key `content_targets`
 * (snake_case like the other settings keys), for example
 *   { "components": 27, "enablers": 226, "use_cases": 226 }
 * A key that is missing means "no target" (shown as "kein Soll"). There is no
 * default, a target never comes from a guess.
 *
 * Counting rules of the actual numbers: docs/content-stats.md and
 * src/lib/catalog/content-stats.ts.
 */

/** The counted kinds of content, in the order the screen shows them. */
export const CONTENT_METRICS = [
  'components',
  'enablers',
  'scenarios',
  'useCases',
  'lessonQuizzes',
  'globalQuizzes',
  'learningFields',
] as const;

export type ContentMetricId = (typeof CONTENT_METRICS)[number];

/** Key of a metric inside settings.content_targets as stored. */
export const STORED_TARGET_KEY: Record<ContentMetricId, string> = {
  components: 'components',
  enablers: 'enablers',
  scenarios: 'scenarios',
  useCases: 'use_cases',
  lessonQuizzes: 'lesson_quizzes',
  globalQuizzes: 'global_quizzes',
  learningFields: 'learning_fields',
};

/** Largest target that is accepted (a whole number from 0 to this value). */
export const CONTENT_TARGET_MAX = 100000;

const targetNumber = z.number().int().min(0).max(CONTENT_TARGET_MAX);

/** The stored form: strict, so a misspelled key is refused and not dropped. */
export const storedContentTargetsSchema = z
  .object({
    components: targetNumber,
    enablers: targetNumber,
    scenarios: targetNumber,
    use_cases: targetNumber,
    lesson_quizzes: targetNumber,
    global_quizzes: targetNumber,
    learning_fields: targetNumber,
  })
  .partial()
  .strict();

/**
 * The form the API takes (camelCase). A value of null or a missing key means
 * "no target": a save replaces the whole set of targets of the catalog.
 */
export const contentTargetsInputSchema = z
  .object({
    components: targetNumber.nullable(),
    enablers: targetNumber.nullable(),
    scenarios: targetNumber.nullable(),
    useCases: targetNumber.nullable(),
    lessonQuizzes: targetNumber.nullable(),
    globalQuizzes: targetNumber.nullable(),
    learningFields: targetNumber.nullable(),
  })
  .partial()
  .strict();

/** The body of the save request. */
export const contentTargetsBodySchema = z
  .object({ targets: contentTargetsInputSchema })
  .strict();

/** The targets that are set (a metric without an entry has no target). */
export type ContentTargets = Partial<Record<ContentMetricId, number>>;

/**
 * The targets of a stored settings object. Tolerant like resolveCatalogSettings:
 * every key is checked on its own, a bad value or an unknown key counts as "no
 * target" and nothing throws, so a bad row cannot break the screen.
 */
export function readContentTargets(settings: unknown): ContentTargets {
  const result: ContentTargets = {};
  if (settings === null || typeof settings !== 'object') return result;
  const raw = (settings as Record<string, unknown>).content_targets;
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    return result;
  }
  for (const id of CONTENT_METRICS) {
    const parsed = targetNumber.safeParse(
      (raw as Record<string, unknown>)[STORED_TARGET_KEY[id]]
    );
    if (parsed.success) result[id] = parsed.data;
  }
  return result;
}

/** The validated API input as the stored object (only the targets that are set). */
export function toStoredContentTargets(
  input: Partial<Record<ContentMetricId, number | null>>
): Record<string, number> {
  const stored: Record<string, number> = {};
  for (const id of CONTENT_METRICS) {
    const value = input[id];
    if (typeof value === 'number') stored[STORED_TARGET_KEY[id]] = value;
  }
  return stored;
}

// ---------------------------------------------------------------------------
// Comparison of actual and target
// ---------------------------------------------------------------------------

/**
 * met        actual equals the target
 * missing    actual is below the target
 * exceeds    actual is above the target
 * no_target  no target is set (or the viewer may not see it)
 */
export type MetricStatus = 'met' | 'missing' | 'exceeds' | 'no_target';

export type TargetComparison = {
  /** actual minus target (negative: something is missing), null without target. */
  difference: number | null;
  status: MetricStatus;
  /** Progress 0 to 100, rounded down so 225 of 226 never shows as 100. */
  percent: number | null;
};

export function compareToTarget(
  actual: number,
  target: number | null | undefined
): TargetComparison {
  if (target === null || target === undefined) {
    return { difference: null, status: 'no_target', percent: null };
  }
  const difference = actual - target;
  const status: MetricStatus =
    difference === 0 ? 'met' : difference < 0 ? 'missing' : 'exceeds';
  const percent =
    target === 0 ? 100 : Math.min(100, Math.floor((actual / target) * 100));
  return { difference, status, percent };
}

// ---------------------------------------------------------------------------
// Shape of the API answer (GET /api/admin/content-stats)
// ---------------------------------------------------------------------------

export type ContentMetric = {
  id: ContentMetricId;
  actual: number;
  /** Active items of the metric, null where the content has no activation. */
  active: number | null;
  target: number | null;
  difference: number | null;
  status: MetricStatus;
  percent: number | null;
};

export type CatalogContentStats = {
  catalogId: string;
  code: string;
  title: string;
  isActive: boolean;
  metrics: ContentMetric[];
  /** All questions of the quizzes of the catalog. */
  questions: number;
  /** Assignments of enablers and use cases to learning fields. */
  mappings: number;
};

export type ContentStatsResponse = {
  /** Whether targets, differences and status are part of the answer. */
  targetsVisible: boolean;
  /** Whether the viewer may change the targets (the route checks it again). */
  canEditTargets: boolean;
  catalogs: CatalogContentStats[];
};
