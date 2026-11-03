import { z } from 'zod';

/**
 * Plan model of an occupation (Plan-Dokument): the hierarchy of the training as
 * a document describes it. Pure and free of server imports, so the settings
 * schema, the readers, the API, the plan check and the admin screen share it.
 *
 * The plan is OPTIONAL in every part. A part that is missing means "not
 * stated", never zero and never null: every schema below refuses null, and a
 * number that is not in the document is not in the plan. It is stored under
 * training_catalogs.settings.content_plan (jsonb, no migration) together with
 * the SOURCE (file name, time, number of fields, read by script or by AI), never
 * the file itself. The manual targets (settings.content_targets) always win
 * over the plan, see effective.ts.
 */

/** Hard bounds of every number and list, so a document cannot blow up the row. */
export const PLAN_LIMITS = Object.freeze({
  maxCount: 100_000,
  maxHours: 20_000,
  maxComponentHours: 5_000,
  maxWeeks: 520,
  maxQuestionsPerQuiz: 200,
  maxOrder: 1_000,
  maxComponents: 100,
  maxLearningFields: 100,
  maxRelations: 2_000,
  maxNotes: 20,
  maxCodeChars: 64,
  maxTitleChars: 200,
  maxNoteChars: 500,
  maxFileNameChars: 120,
  maxLearningFieldsPerComponent: 50,
  /** The stored value (plan and source) as JSON, in characters. */
  maxStoredChars: 200_000,
  /** Longest quote ("Fundstelle") of a field, in characters. */
  maxQuoteChars: 160,
  /** Most fields of one proposal. */
  maxRows: 3_000,
});

// eslint-disable-next-line no-control-regex
const NO_CONTROL = /^[^\u0000-\u001f\u007f]*$/;

const text = (max: number) =>
  z
    .string()
    .trim()
    .min(1)
    .max(max)
    .refine(v => NO_CONTROL.test(v), 'control characters');
const code = text(PLAN_LIMITS.maxCodeChars);
const count = z.number().int().min(0).max(PLAN_LIMITS.maxCount);

// ---------------------------------------------------------------------------
// The parts of the plan. The shapes are kept apart so the single field schemas
// (used to check one cell or one answer of the model) and the whole schema
// cannot drift.
// ---------------------------------------------------------------------------

export const TOTAL_FIELDS = [
  'components',
  'enablers',
  'scenarios',
  'useCases',
  'lessonQuizzes',
  'globalQuizzes',
  'learningFields',
  'questionsPerQuiz',
  'hours',
] as const;
export type TotalField = (typeof TOTAL_FIELDS)[number];

const totalsShape = {
  components: count,
  enablers: count,
  scenarios: count,
  useCases: count,
  lessonQuizzes: count,
  globalQuizzes: count,
  learningFields: count,
  questionsPerQuiz: z
    .number()
    .int()
    .min(1)
    .max(PLAN_LIMITS.maxQuestionsPerQuiz),
  hours: z.number().min(0).max(PLAN_LIMITS.maxHours),
} satisfies Record<TotalField, z.ZodTypeAny>;

export const COMPONENT_KINDS = ['pflicht', 'wahl', 'integrativ'] as const;
export type ComponentKind = (typeof COMPONENT_KINDS)[number];

export const COMPONENT_FIELDS = [
  'code',
  'title',
  'phase',
  'kind',
  'hours',
  'weeks',
  'enablers',
  'scenarios',
  'useCases',
  'quizzes',
  'globalQuiz',
  'order',
  'learningFields',
] as const;
export type ComponentField = (typeof COMPONENT_FIELDS)[number];

const componentShape = {
  code,
  title: text(PLAN_LIMITS.maxTitleChars),
  phase: z.union([z.literal(1), z.literal(2)]),
  kind: z.enum(COMPONENT_KINDS),
  hours: z.number().min(0).max(PLAN_LIMITS.maxComponentHours),
  weeks: z.number().min(0).max(PLAN_LIMITS.maxWeeks),
  enablers: count,
  scenarios: count,
  useCases: count,
  quizzes: count,
  globalQuiz: z.boolean(),
  order: z.number().int().min(0).max(PLAN_LIMITS.maxOrder),
  learningFields: z
    .array(code)
    .min(1)
    .max(PLAN_LIMITS.maxLearningFieldsPerComponent),
} satisfies Record<ComponentField, z.ZodTypeAny>;

export const LEARNING_FIELD_FIELDS = ['code', 'title', 'hours'] as const;
export type LearningFieldField = (typeof LEARNING_FIELD_FIELDS)[number];

const learningFieldShape = {
  code,
  title: text(PLAN_LIMITS.maxTitleChars),
  hours: z.number().min(0).max(PLAN_LIMITS.maxComponentHours),
} satisfies Record<LearningFieldField, z.ZodTypeAny>;

export const RELATION_TYPES = [
  'component_learning_field',
  'enabler_learning_field',
  'use_case_enabler',
] as const;
export type RelationType = (typeof RELATION_TYPES)[number];

const hasIdentity = (v: { code?: string; title?: string }) =>
  v.code !== undefined || v.title !== undefined;

export const planTotalsSchema = z.object(totalsShape).partial().strict();

export const planComponentSchema = z
  .object(componentShape)
  .partial()
  .strict()
  .refine(hasIdentity, 'a component needs a code or a title');

export const planLearningFieldSchema = z
  .object(learningFieldShape)
  .partial()
  .strict()
  .refine(hasIdentity, 'a learning field needs a code or a title');

export const planRelationSchema = z
  .object({ type: z.enum(RELATION_TYPES), from: code, to: code })
  .strict();

export const contentPlanSchema = z
  .object({
    totals: planTotalsSchema,
    components: z.array(planComponentSchema).max(PLAN_LIMITS.maxComponents),
    learningFields: z
      .array(planLearningFieldSchema)
      .max(PLAN_LIMITS.maxLearningFields),
    relations: z.array(planRelationSchema).max(PLAN_LIMITS.maxRelations),
    notes: z.array(text(PLAN_LIMITS.maxNoteChars)).max(PLAN_LIMITS.maxNotes),
  })
  .partial()
  .strict();

export type ContentPlan = z.infer<typeof contentPlanSchema>;
export type PlanComponent = z.infer<typeof planComponentSchema>;
export type PlanLearningField = z.infer<typeof planLearningFieldSchema>;
export type PlanRelation = z.infer<typeof planRelationSchema>;
export type PlanTotals = z.infer<typeof planTotalsSchema>;

// ---------------------------------------------------------------------------
// The source and the stored form
// ---------------------------------------------------------------------------

export const PLAN_METHODS = ['script', 'ki'] as const;
export type PlanMethod = (typeof PLAN_METHODS)[number];

/** Where the stored plan comes from. Metadata only, never the content of the file. */
export const planSourceSchema = z
  .object({
    fileName: text(PLAN_LIMITS.maxFileNameChars),
    savedAt: z.string().datetime(),
    fieldCount: z
      .number()
      .int()
      .min(0)
      .max(PLAN_LIMITS.maxRows * 4),
    method: z.enum(PLAN_METHODS),
  })
  .strict();
export type PlanSource = z.infer<typeof planSourceSchema>;

/** The value of settings.content_plan: strict, and at most 200 KB as JSON. */
export const storedContentPlanSchema = z
  .object({ plan: contentPlanSchema, source: planSourceSchema })
  .strict()
  .refine(
    v => JSON.stringify(v).length <= PLAN_LIMITS.maxStoredChars,
    'the stored plan is too large'
  );
export type StoredContentPlan = z.infer<typeof storedContentPlanSchema>;

/** What the client sends to save a confirmed plan (the server adds time and count). */
export const savePlanBodySchema = z
  .object({
    plan: contentPlanSchema,
    fileName: z.string().min(1).max(400),
    method: z.enum(PLAN_METHODS),
  })
  .strict();

/** A file name without a path, without control characters, cut to the limit. */
export function safeFileName(raw: string): string {
  const base = raw.split(/[\\/]/).pop() ?? '';
  // eslint-disable-next-line no-control-regex
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, ' ').trim();
  return (clean || 'plan').slice(0, PLAN_LIMITS.maxFileNameChars).trim();
}

/** Number of single values a plan holds (the "Anzahl der Felder" of the source). */
export function countPlanFields(plan: ContentPlan): number {
  let n = Object.keys(plan.totals ?? {}).length;
  for (const c of plan.components ?? []) n += Object.keys(c).length;
  for (const l of plan.learningFields ?? []) n += Object.keys(l).length;
  n += (plan.relations ?? []).length + (plan.notes ?? []).length;
  return n;
}

/** The plan is empty when it states nothing at all. */
export function isPlanEmpty(plan: ContentPlan): boolean {
  return countPlanFields(plan) === 0;
}

/**
 * The stored plan of a settings object, tolerant like readContentTargets:
 * a bad or missing value is "no plan" and nothing throws.
 */
export function readStoredContentPlan(
  settings: unknown
): StoredContentPlan | null {
  if (settings === null || typeof settings !== 'object') return null;
  const raw = (settings as Record<string, unknown>).content_plan;
  const parsed = storedContentPlanSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

// ---------------------------------------------------------------------------
// The proposal: a plan as a flat list of single fields with a quote each, so a
// person can switch every field off or change it before it is saved. A proposal
// is never stored.
// ---------------------------------------------------------------------------

export type PlanRowScope =
  | 'totals'
  | 'component'
  | 'learningField'
  | 'relation'
  | 'note';

export type PlanRowValue = string | number | boolean | string[];

/**
 * One field of a proposal.
 *  totals         ref ''             field = TotalField
 *  component      ref = code or title of the component, field = ComponentField
 *  learningField  ref = code or title, field = LearningFieldField
 *  relation       ref = RelationType, field = code of "from", value = code of "to"
 *  note           ref '' field 'note', value = the text
 */
export interface PlanRow {
  /** Stable key of the field: scope, ref and field (a relation: both ends). */
  id: string;
  scope: PlanRowScope;
  ref: string;
  field: string;
  value: PlanRowValue;
  /** Where it stands: a short quote of the document (AI) or the cell (script). */
  quote: string;
}

export type PlanIssue = { where: string; message: string };

/** What reading a document returns. Never stored, never trusted blindly. */
export interface PlanDraft {
  method: PlanMethod;
  rows: PlanRow[];
  /** Cells or answers that could not be used, with the place (at most 30). */
  issues: PlanIssue[];
  /** Codes of general remarks, for example EXAMPLE_TEMPLATE, TRUNCATED. */
  warnings: string[];
}

export const rowId = (
  scope: PlanRowScope,
  ref: string,
  field: string,
  value?: PlanRowValue
): string =>
  scope === 'relation'
    ? `relation:${ref}:${field}:${String(value)}`
    : scope === 'note'
      ? `note:${String(value).slice(0, 60)}`
      : `${scope}:${ref}:${field}`;

/** The schema of one single field, or null for an unknown field. */
export function fieldSchema(
  scope: PlanRowScope,
  field: string
): z.ZodTypeAny | null {
  const pick = (shape: Record<string, z.ZodTypeAny>) =>
    Object.prototype.hasOwnProperty.call(shape, field) ? shape[field] : null;
  switch (scope) {
    case 'totals':
      return pick(totalsShape);
    case 'component':
      return pick(componentShape);
    case 'learningField':
      return pick(learningFieldShape);
    case 'relation':
      return code;
    case 'note':
      return text(PLAN_LIMITS.maxNoteChars);
  }
}
