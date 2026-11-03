/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  MAX_PLAN_FINDINGS,
  computePlanFindings,
  fold,
  loadPlanActuals,
  matchComponents,
  missingSeverity,
  planFindings,
  similarity,
  type ActualComponent,
  type PlanActuals,
} from '@/lib/catalog/content-plan/plan-check';
import type { StatsRow } from '@/lib/catalog/content-stats';
import type { ContentPlan } from '@/lib/catalog/content-plan/types';
import type { Finding } from '@/lib/catalog/content-check/types';

const source = {
  fileName: 'plan.xlsx',
  savedAt: '2026-11-03T10:00:00.000Z',
  fieldCount: 3,
  method: 'script' as const,
};

const statsRow = (
  settings: unknown,
  over: Partial<StatsRow> = {}
): StatsRow => ({
  id: 'cat-1',
  code: 'KFBM',
  title: 'Beruf',
  is_active: true,
  settings,
  components: 3,
  enablers: 200,
  enablers_active: 200,
  scenarios: 225,
  use_cases: 225,
  use_cases_active: 0,
  lesson_quizzes: 600,
  lesson_quizzes_active: 0,
  global_quizzes: 3,
  global_quizzes_active: 0,
  learning_fields: 2,
  questions: 0,
  mappings: 0,
  ...over,
});

const comp = (
  over: Partial<ActualComponent> & { code: string }
): ActualComponent => ({
  id: `id-${over.code}`,
  title: over.code,
  phaseCode: null,
  phaseTitle: null,
  hours: null,
  lernfelder: [],
  enablers: 0,
  scenarios: 0,
  useCases: 0,
  lessonQuizzes: 0,
  globalQuiz: false,
  ...over,
});

const actuals = (over: Partial<PlanActuals> = {}): PlanActuals => ({
  components: [],
  learningFields: [],
  mappings: [],
  enablers: [],
  useCaseLinks: [],
  phaseHours: null,
  ...over,
});

const withPlan = (plan: ContentPlan, extra: Record<string, unknown> = {}) => ({
  ...extra,
  content_plan: { plan, source },
});

const check = (
  settings: unknown,
  a: PlanActuals,
  row: Partial<StatsRow> = {}
) =>
  computePlanFindings({
    catalog: { id: 'cat-1', code: 'KFBM', settings },
    statsRow: statsRow(settings, row),
    actuals: a,
  });
const rules = (findings: Finding[]) => findings.map(f => f.rule);
const find = (findings: Finding[], rule: string) =>
  findings.find(f => f.rule === rule);

describe('severity', () => {
  it('a missing unit is a warning, an error above ten percent', () => {
    expect(missingSeverity(1, 226)).toBe('warning');
    expect(missingSeverity(10, 100)).toBe('warning');
    expect(missingSeverity(11, 100)).toBe('error');
    expect(missingSeverity(1, 5)).toBe('error');
    expect(missingSeverity(1, 0)).toBe('warning');
  });
});

describe('without plan and without targets', () => {
  it('only says so, as an info', () => {
    const findings = check({}, actuals());
    expect(findings).toHaveLength(1);
    expect(findings[0]).toMatchObject({
      rule: 'plan.none',
      severity: 'info',
      source: 'plan',
      refs: [{ type: 'catalog', id: 'cat-1', label: 'KFBM' }],
    });
  });
});

describe('Ist against the effective target', () => {
  it('missing, warning or error by share, and a surplus as an info', () => {
    const findings = check(
      { content_targets: { enablers: 226, scenarios: 226, components: 2 } },
      actuals()
    );
    expect(find(findings, 'plan.target.enablers.missing')).toMatchObject({
      severity: 'error',
      source: 'plan',
      details: 'Herkunft: manuelles Soll.',
    });
    expect(find(findings, 'plan.target.scenarios.missing')).toMatchObject({
      severity: 'warning',
    });
    expect(find(findings, 'plan.target.components.exceeds')).toMatchObject({
      severity: 'info',
    });
    expect(find(findings, 'plan.target.enablers.missing')?.summary).toContain(
      '200 von 226'
    );
  });

  it('a target that is met has no finding', () => {
    expect(check({ content_targets: { enablers: 200 } }, actuals())).toEqual(
      []
    );
  });

  it('names the plan as the origin and points out a difference to the manual number', () => {
    const findings = check(
      withPlan(
        { totals: { enablers: 199, scenarios: 230 } },
        { content_targets: { enablers: 200 } }
      ),
      actuals()
    );
    expect(find(findings, 'plan.target.enablers.differs')).toMatchObject({
      severity: 'info',
    });
    expect(find(findings, 'plan.target.scenarios.missing')?.details).toBe(
      'Herkunft: Soll aus dem Plan-Dokument.'
    );
    // the manual number counts: 200 of 200 is met
    expect(rules(findings)).not.toContain('plan.target.enablers.missing');
  });
});

describe('matching of components', () => {
  const actual = [
    comp({ code: 'K6.1', title: 'Beschaffung und Logistik' }),
    comp({ code: 'K6.2', title: 'Marketing im Betrieb', phaseCode: '§4.2' }),
    comp({ code: 'K7', title: 'Rechnungswesen' }),
  ];

  it('by code, also with other spelling and by the code of the phase plan', () => {
    const m = matchComponents(
      [{ code: 'k6-1' }, { code: '§4.2' }, { code: 'K7' }],
      actual
    );
    expect(m.matches.map(x => [x.plan, x.actual, x.how])).toEqual([
      [0, 0, 'code'],
      [1, 1, 'code'],
      [2, 2, 'code'],
    ]);
    expect(m.planOnly).toEqual([]);
    expect(m.actualOnly).toEqual([]);
  });

  it('by identical title when the code is missing', () => {
    const m = matchComponents([{ title: 'rechnungswesen' }], actual);
    expect(m.matches).toEqual([{ plan: 0, actual: 2, how: 'title' }]);
  });

  it('by similar title only when the hit is clear', () => {
    const m = matchComponents(
      [{ title: 'Beschaffung und Logistik im Betrieb' }],
      actual
    );
    expect(m.matches).toEqual([{ plan: 0, actual: 0, how: 'fuzzy' }]);
  });

  it('does not guess when two candidates are alike', () => {
    const twins = [
      comp({ code: 'A', title: 'Projektmanagement Grundlagen 1' }),
      comp({ code: 'B', title: 'Projektmanagement Grundlagen 2' }),
    ];
    const m = matchComponents(
      [{ title: 'Projektmanagement Grundlagen' }],
      twins
    );
    expect(m.matches).toEqual([]);
    expect(m.planOnly).toEqual([0]);
    expect(m.actualOnly).toEqual([0, 1]);
  });

  it('does not take a candidate that two plan entries want', () => {
    const one = [comp({ code: 'A', title: 'Netzwerktechnik Aufbau' })];
    const m = matchComponents(
      [
        { title: 'Netzwerktechnik Aufbau 1' },
        { title: 'Netzwerktechnik Aufbau 2' },
      ],
      one
    );
    expect(m.matches).toEqual([]);
  });

  it('does not match titles that are merely somewhat alike', () => {
    const m = matchComponents([{ title: 'Qualitätsmanagement' }], actual);
    expect(m.matches).toEqual([]);
    expect(m.planOnly).toEqual([0]);
  });

  it('a code that is not there is not matched by its title text either', () => {
    const m = matchComponents([{ code: 'K99', title: 'Zusatz' }], actual);
    expect(m.matches).toEqual([]);
  });

  it('similarity and fold', () => {
    expect(fold('K 6-1')).toBe('k61');
    expect(similarity('Marketing', 'marketing')).toBe(1);
    expect(similarity('abc', 'xyz')).toBe(0);
    expect(similarity('', 'x')).toBe(0);
  });
});

describe('plan per component', () => {
  const plan: ContentPlan = {
    totals: { hours: 160 },
    components: [
      {
        code: 'K1',
        enablers: 5,
        scenarios: 5,
        useCases: 3,
        quizzes: 15,
        globalQuiz: true,
        hours: 80,
      },
      { code: 'K2', enablers: 4, hours: 60, globalQuiz: false },
      { code: 'K9', title: 'Gibt es nicht' },
    ],
  };
  const a = actuals({
    components: [
      comp({
        code: 'K1',
        enablers: 4,
        scenarios: 5,
        useCases: 4,
        lessonQuizzes: 12,
        globalQuiz: false,
        hours: 80,
      }),
      comp({ code: 'K2', enablers: 6, globalQuiz: true, hours: 70 }),
      comp({ code: 'K3', title: 'Zusatz' }),
    ],
    phaseHours: 150,
  });
  const findings = check(withPlan(plan), a);

  it('missing units per component: warning, error above ten percent', () => {
    expect(find(findings, 'plan.component.enablers.missing')).toMatchObject({
      severity: 'error',
      refs: [{ type: 'course', id: 'id-K1', label: 'K1' }],
    });
    expect(find(findings, 'plan.component.quizzes.missing')?.summary).toContain(
      '12 von 15 Quizze'
    );
    expect(rules(findings)).not.toContain('plan.component.scenarios.missing');
  });

  it('a surplus is an info', () => {
    expect(find(findings, 'plan.component.enablers.exceeds')).toMatchObject({
      severity: 'info',
    });
    expect(find(findings, 'plan.component.useCases.exceeds')).toMatchObject({
      severity: 'info',
    });
  });

  it('global quiz in the plan and not there is a warning, the other way an info', () => {
    expect(find(findings, 'plan.component.globalQuiz.missing')).toMatchObject({
      severity: 'warning',
    });
    expect(find(findings, 'plan.component.globalQuiz.exceeds')).toMatchObject({
      severity: 'info',
    });
  });

  it('missing and extra components', () => {
    expect(find(findings, 'plan.component.missing')).toMatchObject({
      severity: 'error',
    });
    expect(find(findings, 'plan.component.missing')?.summary).toContain('K9');
    expect(find(findings, 'plan.component.extra')).toMatchObject({
      severity: 'info',
      refs: [{ type: 'course', id: 'id-K3' }],
    });
  });

  it('hours of a component and in total against the phase plan', () => {
    const hours = findings.filter(f => f.rule === 'plan.component.hours');
    expect(hours).toHaveLength(1);
    expect(hours[0].summary).toContain('K2');
    expect(find(findings, 'plan.hours.total')).toMatchObject({
      severity: 'warning',
    });
    expect(find(findings, 'plan.hours.total')?.summary).toContain('150');
  });

  it('a plan without numbers for a part says nothing about it', () => {
    const lean = check(
      withPlan({ components: [{ code: 'K1' }, { code: 'K2' }] }),
      a
    );
    // the plan lists two components, so two is its target for the count
    expect(rules(lean)).toEqual([
      'plan.target.components.exceeds',
      'plan.component.extra',
    ]);
  });

  it('hours without a row of the phase plan are one info, not a finding each', () => {
    const none = check(
      withPlan({
        components: [
          { code: 'K1', hours: 80 },
          { code: 'K2', hours: 60 },
        ],
      }),
      actuals({ components: [comp({ code: 'K1' }), comp({ code: 'K2' })] })
    );
    expect(find(none, 'plan.component.hours.unknown')).toMatchObject({
      severity: 'info',
    });
    expect(rules(none)).not.toContain('plan.component.hours');
  });

  it('says when the plan contradicts itself', () => {
    const f = check(
      withPlan({
        totals: { enablers: 10 },
        components: [
          { code: 'K1', enablers: 5 },
          { code: 'K2', enablers: 4 },
        ],
      }),
      actuals({
        components: [
          comp({ code: 'K1', enablers: 5 }),
          comp({ code: 'K2', enablers: 4 }),
        ],
      }),
      { enablers: 9 }
    );
    expect(find(f, 'plan.internal.enablers')).toMatchObject({
      severity: 'info',
    });
  });

  it('a fuzzy match is reported as such', () => {
    const f = check(
      withPlan({
        components: [{ title: 'Beschaffung und Logistik im Betrieb' }],
      }),
      actuals({
        components: [comp({ code: 'K6.1', title: 'Beschaffung und Logistik' })],
      }),
      { components: 1 }
    );
    expect(find(f, 'plan.component.fuzzy')).toMatchObject({ severity: 'info' });
  });
});

describe('learning fields and relations', () => {
  const a = actuals({
    components: [
      comp({ code: 'K1', lernfelder: ['LF-1'] }),
      comp({ code: 'K2' }),
    ],
    learningFields: [
      { id: 'lf1', code: 'LF-1', title: 'Netze', hours: 40 },
      { id: 'lf2', code: 'LF-2', title: 'Daten', hours: 80 },
      { id: 'lf3', code: 'LF-3', title: 'Extra', hours: null },
    ],
    mappings: [
      {
        lfCode: 'LF-2',
        enablerCode: 'K2-a',
        enablerCourseId: 'id-K2',
        useCaseCourseId: null,
      },
    ],
    useCaseLinks: [{ useCaseCode: 'UC-1', enablerCode: 'K1-a' }],
  });
  const plan: ContentPlan = {
    learningFields: [
      { code: 'LF1', title: 'Netze', hours: 60 },
      { code: 'LF-2', hours: 80 },
      { code: 'LF-9', title: 'Fehlt' },
    ],
    components: [
      { code: 'K1', learningFields: ['LF-1', 'LF-2'] },
      { code: 'K2', learningFields: ['LF-2'] },
    ],
    relations: [
      { type: 'enabler_learning_field', from: 'K2-a', to: 'LF-2' },
      { type: 'enabler_learning_field', from: 'K2-b', to: 'LF-2' },
      { type: 'use_case_enabler', from: 'UC-1', to: 'K1-a' },
      { type: 'use_case_enabler', from: 'UC-2', to: 'K1-a' },
    ],
  };
  const findings = check(withPlan(plan), a);

  it('learning fields: missing, extra, hours', () => {
    expect(find(findings, 'plan.learningField.missing')?.summary).toContain(
      'LF-9'
    );
    expect(find(findings, 'plan.learningField.extra')?.summary).toContain(
      'LF-3'
    );
    expect(find(findings, 'plan.learningField.hours')?.summary).toContain('60');
    // LF1 and LF-1 are the same learning field
    expect(
      findings.filter(f => f.rule === 'plan.learningField.missing')
    ).toHaveLength(1);
  });

  it('component to learning field: the course lists it or one of its enablers is assigned', () => {
    const f = find(findings, 'plan.relation.component_learning_field.missing');
    expect(f?.summary).toContain('1 von 3');
    expect(f?.details).toBe('K1 → LF-2');
    expect(f?.severity).toBe('error');
  });

  it('enabler to learning field and use case to enabler', () => {
    expect(
      find(findings, 'plan.relation.enabler_learning_field.missing')
    ).toMatchObject({
      details: 'K2-b → LF-2',
    });
    expect(
      find(findings, 'plan.relation.use_case_enabler.missing')
    ).toMatchObject({
      details: 'UC-2 → K1-a',
    });
  });

  it('relations that are all there make no finding', () => {
    const f = check(
      withPlan({
        relations: [
          { type: 'enabler_learning_field', from: 'K2-a', to: 'LF-2' },
        ],
      }),
      a
    );
    expect(rules(f)).not.toContain(
      'plan.relation.enabler_learning_field.missing'
    );
  });
});

describe('limits', () => {
  it('cuts the list and says so', () => {
    const many: ContentPlan = {
      components: Array.from({ length: 100 }, (_, i) => ({ code: `X${i}` })),
      learningFields: Array.from({ length: 100 }, (_, i) => ({
        code: `L${i}`,
      })),
    };
    const f = check(withPlan(many), actuals());
    expect(f).toHaveLength(MAX_PLAN_FINDINGS + 1);
    expect(f[f.length - 1].rule).toBe('plan.truncated');
  });

  it('every finding has the source plan and refs', () => {
    const f = check(
      withPlan({ totals: { enablers: 500 }, components: [{ code: 'K9' }] }),
      actuals()
    );
    expect(f.length).toBeGreaterThan(0);
    for (const finding of f) {
      expect(finding.source).toBe('plan');
      expect(finding.refs.length).toBeGreaterThan(0);
      expect(finding.summary).toMatch(/\S/);
    }
  });
});

describe('planFindings(catalogId)', () => {
  it('an unknown catalog has no findings', async () => {
    expect(
      await planFindings('x', {
        loadStatsRow: async () => null,
        loadActuals: async () => {
          throw new Error('not called');
        },
      })
    ).toEqual([]);
  });

  it('loads Ist and plan and returns the findings', async () => {
    const settings = withPlan({ totals: { enablers: 226 } });
    const f = await planFindings('cat-1', {
      loadStatsRow: async () => statsRow(settings),
      loadActuals: async () => actuals(),
    });
    expect(rules(f)).toEqual(['plan.target.enablers.missing']);
  });
});

describe('loadPlanActuals reads, never writes', () => {
  it('runs reads only and maps the rows', async () => {
    const statements: string[] = [];
    const rowsFor = (text: string) => {
      if (text.includes('from courses co')) {
        return [
          {
            id: 'c1',
            code: 'K1',
            title: 'T',
            phase_code: null,
            phase_title: null,
            hours: '80',
            lernfelder: ['LF-1'],
            enablers: 5,
            scenarios: 4,
            use_cases: 5,
            lesson_quizzes: 15,
            global_quiz: true,
          },
        ];
      }
      if (text.includes('content_mappings')) return [];
      if (text.includes('training_catalog_learning_fields')) {
        return [{ id: 'l1', code: 'LF-1', title: 'Netze', hours_budget: 40 }];
      }
      if (text.includes('sum(total_hours)')) return [{ hours: '160', rows: 2 }];
      return [];
    };
    const q = {
      execute: async (query: any) => {
        const text = query.queryChunks
          .map((c: any) => (typeof c === 'string' ? c : (c?.value ?? [])))
          .flat(5)
          .join(' ');
        statements.push(text);
        return rowsFor(JSON.stringify(query.queryChunks).replace(/\\n/g, ' '));
      },
    };
    const result = await loadPlanActuals(
      q as never,
      '00000000-0000-4000-8000-000000000002'
    );
    expect(statements).toHaveLength(6);
    expect(statements.join(' ')).not.toMatch(/\b(insert|update|delete)\b/i);
    expect(result.components[0]).toMatchObject({
      code: 'K1',
      hours: 80,
      enablers: 5,
      scenarios: 4,
      globalQuiz: true,
      lernfelder: ['LF-1'],
    });
    expect(result.learningFields).toEqual([
      { id: 'l1', code: 'LF-1', title: 'Netze', hours: 40 },
    ]);
    expect(result.phaseHours).toBe(160);
  });
});
