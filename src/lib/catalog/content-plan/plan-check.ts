import { sql } from 'drizzle-orm';
import db from '@/db';
import { withDbRetry } from '@/lib/db-retry';
import {
  buildCatalogStats,
  enablerHasScenarioSql,
  loadStatsRows,
  type StatsRow,
} from '@/lib/catalog/content-stats';
import {
  effectiveTargets,
  type EffectiveTargets,
} from '@/lib/catalog/content-plan/effective';
import {
  readStoredContentPlan,
  type ContentPlan,
  type PlanComponent,
  type RelationType,
} from '@/lib/catalog/content-plan/types';
import {
  CONTENT_METRICS,
  type ContentMetricId,
} from '@/lib/catalog/content-targets';
import type {
  Finding,
  FindingRef,
  FindingSeverity,
} from '@/lib/catalog/content-check/types';

/**
 * The plan check ("Plan-Prüfung", findings of the source `plan`): compares what
 * the catalog holds (Ist, counted by content-stats.ts, never counted a second
 * time here) with the effective target (manual first, else the plan document)
 * and with the plan per component, learning field and relation.
 *
 * Severity: a missing unit is a warning, an error when more than 10 percent of
 * the planned amount is missing. A surplus is an info. Without a plan and
 * without targets the check only says so.
 *
 * Entry point for the content check (page Inhaltsstatistik):
 *   planFindings(catalogId): Promise<Finding[]>
 */

// ---------------------------------------------------------------------------
// What the database holds, per component
// ---------------------------------------------------------------------------

export interface ActualComponent {
  id: string;
  code: string | null;
  title: string;
  /** Code and title of the row of the phase plan (training_components), if any. */
  phaseCode: string | null;
  phaseTitle: string | null;
  /** Zeitrichtwert of the phase plan, null without a row. */
  hours: number | null;
  /** Learning field codes written on the course (courses.lernfelder). */
  lernfelder: string[];
  enablers: number;
  scenarios: number;
  useCases: number;
  lessonQuizzes: number;
  globalQuiz: boolean;
}

export interface ActualLearningField {
  id: string;
  code: string;
  title: string;
  hours: number | null;
}

export interface ActualMapping {
  lfCode: string;
  enablerCode: string | null;
  enablerCourseId: string | null;
  useCaseCourseId: string | null;
}

export interface PlanActuals {
  components: ActualComponent[];
  learningFields: ActualLearningField[];
  mappings: ActualMapping[];
  enablers: { code: string | null; courseId: string }[];
  useCaseLinks: { useCaseCode: string | null; enablerCode: string | null }[];
  /** Sum of the hours of the phase plan of the catalog, null without rows. */
  phaseHours: number | null;
}

type Executor = Pick<typeof db, 'execute'>;

const num = (value: unknown): number => {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
};
const numOrNull = (value: unknown): number | null =>
  value === null || value === undefined ? null : num(value);
const str = (value: unknown): string | null =>
  value === null || value === undefined ? null : String(value);

/** Loads the per component numbers. Reads only, one statement per kind of data. */
export async function loadPlanActuals(
  q: Executor,
  catalogId: string
): Promise<PlanActuals> {
  const id = sql`${catalogId}::uuid`;
  const [components, learningFields, mappings, enablers, links, phase] =
    await Promise.all([
      q.execute(sql`
        select
          co.id, co.code, co.title,
          tc.code as phase_code, tc.title as phase_title, tc.total_hours as hours,
          coalesce(co.lernfelder, '{}') as lernfelder,
          (select count(*) from enablers x where x.course_id = co.id)::int as enablers,
          (select count(*) from enablers x where x.course_id = co.id
            and (${enablerHasScenarioSql(sql`x`)}))::int as scenarios,
          (select count(*) from use_cases u where u.course_id = co.id)::int as use_cases,
          (select count(distinct l.quiz_id)
            from (
              select quiz_id, enabler_id from enabler_quiz_links
              union
              select quiz_id, enabler_id from enabler_quizzes
            ) l join enablers x on x.id = l.enabler_id
            where x.course_id = co.id)::int as lesson_quizzes,
          (co.training_component_id is not null and exists (
            select 1 from quizzes z
            where z.quiz_type = 'GLOBAL'
              and z.training_component_id = co.training_component_id
          )) as global_quiz
        from courses co
        left join training_components tc on tc.id = co.training_component_id
        where co.training_catalog_id = ${id}
        order by tc.order_index nulls last, co.code nulls last, co.title
      `),
      q.execute(sql`
        select id, code, title, hours_budget
        from training_catalog_learning_fields
        where training_catalog_id = ${id}
        order by order_index
      `),
      q.execute(sql`
        select lf.code as lf_code, e.code as enabler_code,
          e.course_id as enabler_course, u.course_id as use_case_course
        from training_catalog_content_mappings m
        join training_catalog_learning_fields lf on lf.id = m.learning_field_id
        left join enablers e on e.id = m.enabler_id
        left join use_cases u on u.id = m.use_case_id
        where m.training_catalog_id = ${id}
      `),
      q.execute(sql`
        select code, course_id from enablers where training_catalog_id = ${id}
      `),
      q.execute(sql`
        select u.code as use_case_code, e.code as enabler_code
        from use_cases u left join enablers e on e.id = u.enabler_id
        where u.training_catalog_id = ${id}
      `),
      q.execute(sql`
        select sum(total_hours) as hours, count(*)::int as rows
        from training_components where training_catalog_id = ${id}
      `),
    ]);
  const rows = (result: unknown) =>
    result as unknown as Record<string, unknown>[];
  const phaseRow = rows(phase)[0] ?? {};
  return {
    components: rows(components).map(r => ({
      id: String(r.id),
      code: str(r.code),
      title: String(r.title ?? ''),
      phaseCode: str(r.phase_code),
      phaseTitle: str(r.phase_title),
      hours: numOrNull(r.hours),
      lernfelder: Array.isArray(r.lernfelder) ? r.lernfelder.map(String) : [],
      enablers: num(r.enablers),
      scenarios: num(r.scenarios),
      useCases: num(r.use_cases),
      lessonQuizzes: num(r.lesson_quizzes),
      globalQuiz: r.global_quiz === true,
    })),
    learningFields: rows(learningFields).map(r => ({
      id: String(r.id),
      code: String(r.code ?? ''),
      title: String(r.title ?? ''),
      hours: numOrNull(r.hours_budget),
    })),
    mappings: rows(mappings).map(r => ({
      lfCode: String(r.lf_code ?? ''),
      enablerCode: str(r.enabler_code),
      enablerCourseId: str(r.enabler_course),
      useCaseCourseId: str(r.use_case_course),
    })),
    enablers: rows(enablers).map(r => ({
      code: str(r.code),
      courseId: String(r.course_id),
    })),
    useCaseLinks: rows(links).map(r => ({
      useCaseCode: str(r.use_case_code),
      enablerCode: str(r.enabler_code),
    })),
    phaseHours: num(phaseRow.rows) > 0 ? num(phaseRow.hours) : null,
  };
}

// ---------------------------------------------------------------------------
// Matching: by code or title, fuzzy only when the hit is clear
// ---------------------------------------------------------------------------

/** Letters and digits only, lower case: "LF 3", "lf-3" and "LF3" are one. */
export function fold(text: string | null | undefined): string {
  return (text ?? '')
    .normalize('NFKC')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]/gu, '');
}

function bigrams(text: string): string[] {
  const out: string[] = [];
  for (let i = 0; i < text.length - 1; i += 1) out.push(text.slice(i, i + 2));
  return out;
}

/** Dice coefficient of two texts after folding, 0 to 1. */
export function similarity(a: string, b: string): number {
  const x = bigrams(fold(a));
  const y = bigrams(fold(b));
  if (x.length === 0 || y.length === 0) return 0;
  const pool = new Map<string, number>();
  for (const g of y) pool.set(g, (pool.get(g) ?? 0) + 1);
  let hits = 0;
  for (const g of x) {
    const left = pool.get(g) ?? 0;
    if (left > 0) {
      hits += 1;
      pool.set(g, left - 1);
    }
  }
  return (2 * hits) / (x.length + y.length);
}

/** A fuzzy hit counts from this similarity, and only when it stands out. */
export const FUZZY_MIN = 0.8;
export const FUZZY_MARGIN = 0.15;

export interface ComponentMatch {
  plan: number;
  actual: number;
  how: 'code' | 'title' | 'fuzzy';
}

/**
 * Pairs the components of the plan with the components of the catalog. First by
 * code (the code of the course or of its phase plan row), then by identical
 * title, then by similar title, which is accepted only for a clear hit: the
 * best candidate reaches FUZZY_MIN, beats the second best by FUZZY_MARGIN and
 * is wanted by no other component of the plan.
 */
export function matchComponents(
  plan: readonly PlanComponent[],
  actual: readonly ActualComponent[]
): {
  matches: ComponentMatch[];
  planOnly: number[];
  actualOnly: number[];
} {
  const matches: ComponentMatch[] = [];
  const takenPlan = new Set<number>();
  const takenActual = new Set<number>();
  const take = (p: number, a: number, how: ComponentMatch['how']) => {
    matches.push({ plan: p, actual: a, how });
    takenPlan.add(p);
    takenActual.add(a);
  };

  plan.forEach((c, p) => {
    const code = fold(c.code);
    if (code === '') return;
    const a = actual.findIndex(
      (x, i) =>
        !takenActual.has(i) &&
        (fold(x.code) === code || fold(x.phaseCode) === code)
    );
    if (a >= 0) take(p, a, 'code');
  });
  plan.forEach((c, p) => {
    const title = fold(c.title);
    if (takenPlan.has(p) || title === '') return;
    const a = actual.findIndex(
      (x, i) =>
        !takenActual.has(i) &&
        (fold(x.title) === title || fold(x.phaseTitle) === title)
    );
    if (a >= 0) take(p, a, 'title');
  });

  // fuzzy: every free pair is scored, only a clear and mutual best is taken
  const free = (set: Set<number>, size: number) =>
    Array.from({ length: size }, (_, i) => i).filter(i => !set.has(i));
  const score = (p: number, a: number) =>
    Math.max(
      similarity(plan[p].title ?? '', actual[a].title),
      similarity(plan[p].title ?? '', actual[a].phaseTitle ?? '')
    );
  const freePlan = free(takenPlan, plan.length).filter(
    p => fold(plan[p].title) !== ''
  );
  const freeActual = free(takenActual, actual.length);
  const best = (p: number) => {
    const scored = freeActual
      .map(a => ({ a, s: score(p, a) }))
      .sort((x, y) => y.s - x.s);
    return scored.length === 0
      ? null
      : { ...scored[0], second: scored[1]?.s ?? 0 };
  };
  for (const p of freePlan) {
    const top = best(p);
    if (!top || top.s < FUZZY_MIN || top.s - top.second < FUZZY_MARGIN)
      continue;
    // the same candidate must not be wanted just as much by another plan entry
    const rival = freePlan.some(
      other => other !== p && score(other, top.a) >= top.s - FUZZY_MARGIN
    );
    if (!rival) take(p, top.a, 'fuzzy');
  }

  return {
    matches,
    planOnly: free(takenPlan, plan.length),
    actualOnly: free(takenActual, actual.length),
  };
}

// ---------------------------------------------------------------------------
// The findings
// ---------------------------------------------------------------------------

const METRIC_LABEL: Record<ContentMetricId, string> = {
  components: 'Komponenten',
  enablers: 'Enabler',
  scenarios: 'Szenarien',
  useCases: 'Use Cases',
  lessonQuizzes: 'Enabler-Quizze',
  globalQuizzes: 'Global-Quizze',
  learningFields: 'Lernfelder',
};

/**
 * Rule of the single info finding that says there is nothing to compare with
 * (no plan and no target). The caller that assembles the content check can use
 * it to report that the plan part did not run.
 */
export const PLAN_NONE_RULE = 'plan.none';

export const MAX_PLAN_FINDINGS = 200;
const MAX_REFS = 10;
/** More than this share of the planned amount missing makes a warning an error. */
export const ERROR_SHARE = 0.1;

/** Warning for missing units, error above ten percent of the planned amount. */
export function missingSeverity(
  missing: number,
  planned: number
): FindingSeverity {
  return planned > 0 && missing / planned > ERROR_SHARE ? 'error' : 'warning';
}

const originText = (origin: 'manual' | 'plan') =>
  origin === 'manual' ? 'manuelles Soll' : 'Soll aus dem Plan-Dokument';
const fmt = (n: number) => String(Math.round(n * 10) / 10).replace('.', ',');

export interface PlanCheckInput {
  catalog: { id: string; code: string; settings: unknown };
  /** The statistics row of the catalog (the one place that counts the Ist). */
  statsRow: StatsRow;
  actuals: PlanActuals;
}

export function computePlanFindings(input: PlanCheckInput): Finding[] {
  const { catalog, statsRow, actuals } = input;
  const stats = buildCatalogStats(statsRow, true);
  const targets: EffectiveTargets = effectiveTargets(catalog);
  const stored = readStoredContentPlan(catalog.settings);
  const plan: ContentPlan = stored?.plan ?? {};
  const catalogRef: FindingRef = {
    type: 'catalog',
    id: catalog.id,
    label: catalog.code,
  };

  if (Object.keys(targets).length === 0 && !stored) {
    return [
      {
        rule: PLAN_NONE_RULE,
        severity: 'info',
        source: 'plan',
        category: 'plan',
        summary:
          'Weder Soll-Zahlen noch ein Plan-Dokument hinterlegt, der Abgleich mit dem Plan entfällt.',
        refs: [catalogRef],
        hint: 'Soll-Zahlen eintragen oder ein Plan-Dokument hochladen.',
      },
    ];
  }

  const findings: Finding[] = [];
  const add = (
    f: Omit<Finding, 'source' | 'category'> & { category?: string }
  ) => findings.push({ source: 'plan', category: 'plan', ...f });

  // --- totals: Ist against the effective target -----------------------------
  for (const id of CONTENT_METRICS) {
    const target = targets[id];
    const metric = stats.metrics.find(m => m.id === id);
    if (!target || !metric) continue;
    const label = METRIC_LABEL[id];
    const difference = metric.actual - target.value;
    if (difference < 0) {
      add({
        rule: `plan.target.${id}.missing`,
        severity: missingSeverity(-difference, target.value),
        summary: `${label}: ${metric.actual} von ${target.value}, es fehlen ${-difference}.`,
        details: `Herkunft: ${originText(target.origin)}.`,
        refs: [catalogRef],
        hint: `Die fehlenden ${label} anlegen oder das Soll prüfen.`,
      });
    } else if (difference > 0) {
      add({
        rule: `plan.target.${id}.exceeds`,
        severity: 'info',
        summary: `${label}: ${metric.actual} vorhanden, ${difference} mehr als das Soll von ${target.value}.`,
        details: `Herkunft: ${originText(target.origin)}.`,
        refs: [catalogRef],
        hint: 'Prüfen, ob das Soll oder der Inhalt nicht mehr stimmt.',
      });
    }
    if (
      target.manual !== null &&
      target.plan !== null &&
      target.manual !== target.plan
    ) {
      add({
        rule: `plan.target.${id}.differs`,
        severity: 'info',
        summary: `${label}: Das manuelle Soll (${target.manual}) weicht vom Plan-Dokument (${target.plan}) ab.`,
        details: 'Das manuelle Soll gilt, der Plan ändert es nie.',
        refs: [catalogRef],
        hint: 'Klären, welche Zahl stimmt, und die andere anpassen.',
      });
    }
  }

  // --- the plan inside itself ------------------------------------------------
  const planComponents = plan.components ?? [];
  const totals = plan.totals ?? {};
  if (planComponents.length > 0) {
    const sums: [string, number | undefined, number | undefined, string][] = [
      [
        'Enabler',
        totals.enablers,
        sumOf(planComponents, 'enablers'),
        'enablers',
      ],
      [
        'Szenarien',
        totals.scenarios,
        sumOf(planComponents, 'scenarios'),
        'scenarios',
      ],
      [
        'Use Cases',
        totals.useCases,
        sumOf(planComponents, 'useCases'),
        'useCases',
      ],
      [
        'Quizze',
        totals.lessonQuizzes,
        sumOf(planComponents, 'quizzes'),
        'quizzes',
      ],
      ['Stunden', totals.hours, sumOf(planComponents, 'hours'), 'hours'],
    ];
    for (const [label, stated, summed, key] of sums) {
      if (stated !== undefined && summed !== undefined && stated !== summed) {
        add({
          rule: `plan.internal.${key}`,
          severity: 'info',
          summary: `Im Plan-Dokument passt die Gesamtzahl ${label} (${fmt(stated)}) nicht zur Summe der Komponenten (${fmt(summed)}).`,
          refs: [catalogRef],
          hint: 'Das Plan-Dokument prüfen.',
        });
      }
    }
  }

  // --- components -------------------------------------------------------------
  const { matches, planOnly, actualOnly } = matchComponents(
    planComponents,
    actuals.components
  );
  const planName = (c: PlanComponent) =>
    [c.code, c.title].filter(Boolean).join(' ');
  const courseRef = (a: ActualComponent): FindingRef => ({
    type: 'course',
    id: a.id,
    label: a.code ?? a.title,
  });

  if (planOnly.length > 0) {
    const severity = missingSeverity(planOnly.length, planComponents.length);
    for (const p of planOnly) {
      add({
        rule: 'plan.component.missing',
        severity,
        summary: `Komponente ${planName(planComponents[p])} steht im Plan, ist aber nicht angelegt.`,
        refs: [catalogRef],
        hint: 'Die Komponente anlegen oder den Plan prüfen.',
      });
    }
  }
  if (planComponents.length > 0) {
    for (const a of actualOnly) {
      add({
        rule: 'plan.component.extra',
        severity: 'info',
        summary: `Komponente ${actuals.components[a].code ?? actuals.components[a].title} ist angelegt, steht aber nicht im Plan.`,
        refs: [courseRef(actuals.components[a])],
        hint: 'Prüfen, ob die Komponente in den Plan gehört.',
      });
    }
  }

  let withoutPhaseHours = 0;
  for (const m of matches) {
    const p = planComponents[m.plan];
    const a = actuals.components[m.actual];
    const ref = courseRef(a);
    const name = planName(p);
    if (m.how === 'fuzzy') {
      add({
        rule: 'plan.component.fuzzy',
        severity: 'info',
        summary: `Komponente ${name} wurde nur über einen ähnlichen Titel (${a.title}) zugeordnet.`,
        refs: [ref],
        hint: 'Die Zuordnung bestätigen, am besten mit gleichem Code in Plan und Katalog.',
      });
    }
    const counts: [
      key: string,
      label: string,
      planned: number | undefined,
      found: number,
    ][] = [
      ['enablers', 'Enabler', p.enablers, a.enablers],
      ['scenarios', 'Szenarien', p.scenarios, a.scenarios],
      ['useCases', 'Use Cases', p.useCases, a.useCases],
      ['quizzes', 'Quizze', p.quizzes, a.lessonQuizzes],
    ];
    for (const [key, label, planned, found] of counts) {
      if (planned === undefined || planned === found) continue;
      if (found < planned) {
        add({
          rule: `plan.component.${key}.missing`,
          severity: missingSeverity(planned - found, planned),
          summary: `Komponente ${name}: ${found} von ${planned} ${label}, es fehlen ${planned - found}.`,
          refs: [ref],
          hint: `Die fehlenden ${label} anlegen.`,
        });
      } else {
        add({
          rule: `plan.component.${key}.exceeds`,
          severity: 'info',
          summary: `Komponente ${name}: ${found} ${label} vorhanden, ${found - planned} mehr als im Plan (${planned}).`,
          refs: [ref],
          hint: 'Den Plan oder den Inhalt prüfen.',
        });
      }
    }
    if (p.globalQuiz === true && !a.globalQuiz) {
      add({
        rule: 'plan.component.globalQuiz.missing',
        severity: 'warning',
        summary: `Komponente ${name}: Der Plan sieht ein Global-Quiz vor, es ist keines vorhanden.`,
        refs: [ref],
        hint: 'Das Global-Quiz anlegen.',
      });
    } else if (p.globalQuiz === false && a.globalQuiz) {
      add({
        rule: 'plan.component.globalQuiz.exceeds',
        severity: 'info',
        summary: `Komponente ${name}: Der Plan sieht kein Global-Quiz vor, es ist aber eines vorhanden.`,
        refs: [ref],
        hint: 'Den Plan oder den Inhalt prüfen.',
      });
    }
    if (p.hours !== undefined) {
      if (a.hours === null) withoutPhaseHours += 1;
      else if (Math.abs(a.hours - p.hours) > 1e-9) {
        add({
          rule: 'plan.component.hours',
          severity: 'warning',
          summary: `Komponente ${name}: Der Plan nennt ${fmt(p.hours)} Stunden, der Phasenplan ${fmt(a.hours)}.`,
          refs: [ref],
          hint: 'Den Zeitrichtwert im Phasenplan oder im Plan-Dokument prüfen.',
        });
      }
    }
  }
  if (withoutPhaseHours > 0) {
    add({
      rule: 'plan.component.hours.unknown',
      severity: 'info',
      summary: `Für ${withoutPhaseHours} Komponenten nennt der Plan Stunden, im Phasenplan gibt es keinen Eintrag zum Vergleich.`,
      refs: [catalogRef],
    });
  }

  // --- hours in total against the phase plan -----------------------------------
  if (totals.hours !== undefined && actuals.phaseHours !== null) {
    const gap = Math.abs(actuals.phaseHours - totals.hours);
    if (gap > 1e-9) {
      add({
        rule: 'plan.hours.total',
        severity: missingSeverity(gap, totals.hours),
        summary: `Stunden gesamt: Der Plan nennt ${fmt(totals.hours)}, der Phasenplan ergibt ${fmt(actuals.phaseHours)}.`,
        refs: [catalogRef],
        hint: 'Den Phasenplan oder das Plan-Dokument prüfen.',
      });
    }
  }

  // --- learning fields ------------------------------------------------------------
  const planFields = plan.learningFields ?? [];
  const matchedLf = new Set<number>();
  const lfOfPlan = planFields.map(f =>
    actuals.learningFields.findIndex(
      a =>
        (fold(f.code) !== '' && fold(a.code) === fold(f.code)) ||
        (fold(f.title) !== '' && fold(a.title) === fold(f.title))
    )
  );
  const missingLf = lfOfPlan.filter(i => i < 0).length;
  planFields.forEach((f, i) => {
    const at = lfOfPlan[i];
    const name = [f.code, f.title].filter(Boolean).join(' ');
    if (at < 0) {
      add({
        rule: 'plan.learningField.missing',
        severity: missingSeverity(missingLf, planFields.length),
        summary: `Lernfeld ${name} steht im Plan, ist aber nicht angelegt.`,
        refs: [catalogRef],
        hint: 'Das Lernfeld anlegen oder den Plan prüfen.',
      });
      return;
    }
    matchedLf.add(at);
    const a = actuals.learningFields[at];
    if (f.hours !== undefined && a.hours !== null && a.hours !== f.hours) {
      add({
        rule: 'plan.learningField.hours',
        severity: 'warning',
        summary: `Lernfeld ${name}: Der Plan nennt ${fmt(f.hours)} Stunden, im Katalog stehen ${fmt(a.hours)}.`,
        refs: [{ type: 'learningField', id: a.id, label: a.code }],
        hint: 'Den Zeitrichtwert prüfen.',
      });
    }
  });
  if (planFields.length > 0) {
    actuals.learningFields.forEach((a, i) => {
      if (matchedLf.has(i)) return;
      add({
        rule: 'plan.learningField.extra',
        severity: 'info',
        summary: `Lernfeld ${a.code} ${a.title} ist angelegt, steht aber nicht im Plan.`,
        refs: [{ type: 'learningField', id: a.id, label: a.code }],
        hint: 'Prüfen, ob das Lernfeld in den Plan gehört.',
      });
    });
  }

  // --- relations ----------------------------------------------------------------------
  const relations: Record<RelationType, [string, string][]> = {
    component_learning_field: [],
    enabler_learning_field: [],
    use_case_enabler: [],
  };
  for (const r of plan.relations ?? []) relations[r.type].push([r.from, r.to]);
  // the list of learning fields on a component is the same statement
  for (const c of planComponents) {
    const from = c.code ?? c.title;
    if (from === undefined) continue;
    for (const lf of c.learningFields ?? []) {
      relations.component_learning_field.push([from, lf]);
    }
  }

  const reportRelations = (
    type: RelationType,
    missing: [string, string][],
    label: string
  ) => {
    if (missing.length === 0) return;
    const total = relations[type].length;
    add({
      rule: `plan.relation.${type}.missing`,
      severity: missingSeverity(missing.length, total),
      category: 'plan',
      summary: `${label}: ${missing.length} von ${total} Beziehungen des Plans fehlen im Katalog.`,
      details: missing
        .slice(0, MAX_REFS)
        .map(([from, to]) => `${from} → ${to}`)
        .join('; '),
      refs: [catalogRef],
      hint: 'Die Zuordnungen anlegen oder den Plan prüfen.',
    });
  };

  // component -> learning field: the course lists it, or one of its enablers or
  // use cases is assigned to it
  const lfSetOfCourse = new Map<string, Set<string>>();
  const lfOf = (courseId: string) => {
    let set = lfSetOfCourse.get(courseId);
    if (!set) {
      set = new Set();
      lfSetOfCourse.set(courseId, set);
    }
    return set;
  };
  for (const c of actuals.components) {
    for (const lf of c.lernfelder) lfOf(c.id).add(fold(lf));
  }
  for (const m of actuals.mappings) {
    const course = m.enablerCourseId ?? m.useCaseCourseId;
    if (course) lfOf(course).add(fold(m.lfCode));
  }
  const lfByTitle = (ref: string) =>
    actuals.learningFields.find(a => fold(a.title) === fold(ref));
  const lfCodeOf = (ref: string) => fold(lfByTitle(ref)?.code) || fold(ref);
  const findCourse = (ref: string) => {
    for (const probe of [{ code: ref }, { title: ref }] as PlanComponent[]) {
      const m = matchComponents([probe], actuals.components).matches[0];
      if (m) return actuals.components[m.actual];
    }
    return undefined;
  };
  const missingCl = relations.component_learning_field.filter(([from, to]) => {
    const a = findCourse(from);
    return !a || !lfOf(a.id).has(lfCodeOf(to));
  });
  reportRelations(
    'component_learning_field',
    missingCl,
    'Komponente zu Lernfeld'
  );

  const mapped = new Set(
    actuals.mappings
      .filter(m => m.enablerCode !== null)
      .map(m => `${fold(m.enablerCode)}|${fold(m.lfCode)}`)
  );
  reportRelations(
    'enabler_learning_field',
    relations.enabler_learning_field.filter(
      ([from, to]) => !mapped.has(`${fold(from)}|${lfCodeOf(to)}`)
    ),
    'Enabler zu Lernfeld'
  );

  const linked = new Set(
    actuals.useCaseLinks
      .filter(l => l.useCaseCode !== null && l.enablerCode !== null)
      .map(l => `${fold(l.useCaseCode)}|${fold(l.enablerCode)}`)
  );
  reportRelations(
    'use_case_enabler',
    relations.use_case_enabler.filter(
      ([from, to]) => !linked.has(`${fold(from)}|${fold(to)}`)
    ),
    'Use Case zu Enabler'
  );

  if (findings.length > MAX_PLAN_FINDINGS) {
    const hidden = findings.length - MAX_PLAN_FINDINGS;
    findings.length = MAX_PLAN_FINDINGS;
    findings.push({
      rule: 'plan.truncated',
      severity: 'info',
      source: 'plan',
      category: 'plan',
      summary: `Weitere ${hidden} Befunde des Plan-Abgleichs werden nicht angezeigt.`,
      refs: [catalogRef],
    });
  }
  return findings;
}

function sumOf(
  components: readonly PlanComponent[],
  key: 'enablers' | 'scenarios' | 'useCases' | 'quizzes' | 'hours'
): number | undefined {
  if (components.some(c => c[key] === undefined)) return undefined;
  return components.reduce((sum, c) => sum + (c[key] ?? 0), 0);
}

// ---------------------------------------------------------------------------
// The entry point
// ---------------------------------------------------------------------------

export interface PlanCheckDeps {
  loadStatsRow(catalogId: string): Promise<StatsRow | null>;
  loadActuals(catalogId: string): Promise<PlanActuals>;
}

const defaultDeps: PlanCheckDeps = {
  async loadStatsRow(catalogId) {
    const rows = await withDbRetry(() => loadStatsRows(db, [catalogId]));
    return rows[0] ?? null;
  },
  loadActuals: catalogId => withDbRetry(() => loadPlanActuals(db, catalogId)),
};

/**
 * The findings of the comparison with the plan for one catalog, source `plan`.
 * Reads only. Without a plan and without targets: one info finding. An unknown
 * catalog has no findings.
 */
export async function planFindings(
  catalogId: string,
  deps: PlanCheckDeps = defaultDeps
): Promise<Finding[]> {
  const statsRow = await deps.loadStatsRow(catalogId);
  if (!statsRow) return [];
  const actuals = await deps.loadActuals(catalogId);
  return computePlanFindings({
    catalog: {
      id: String(statsRow.id),
      code: statsRow.code,
      settings: statsRow.settings,
    },
    statsRow,
    actuals,
  });
}
