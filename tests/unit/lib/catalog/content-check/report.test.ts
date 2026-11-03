/**
 * @jest-environment node
 */
import { renderCondition } from '../../../../helpers/mockDb';
import {
  NOT_CHECKED_NOTE,
  PLAN_FAILED_NOTE,
  buildContentCheckReport,
  countBySeverity,
  sortFindings,
} from '@/lib/catalog/content-check/report';
import {
  PLAN_CHECK_MODULE,
  loadPlanFindings,
} from '@/lib/catalog/content-check/plan-hook';
import type { Finding } from '@/lib/catalog/content-check/types';

const CATALOG = '00000000-0000-4000-8000-0000000000aa';

const f = (
  rule: string,
  severity: Finding['severity'],
  source: Finding['source'] = 'script'
): Finding => ({
  rule,
  severity,
  source,
  category: 'x',
  summary: rule,
  refs: [],
});

/** A database double with one catalog, one course without enablers and no stats row. */
function fakeDb(rows: Record<string, unknown[]> = {}) {
  const execute = jest.fn(async (statement: unknown) => {
    const { sql } = renderCondition(statement);
    const name = /\/\* cc:(\w+) \*\//.exec(sql)?.[1];
    if (!name) return rows.stats ?? [];
    return rows[name] ?? defaults[name] ?? [];
  });
  return { db: { execute } as never, execute };
}

const defaults: Record<string, unknown[]> = {
  catalog: [
    {
      id: CATALOG,
      code: 'TEST',
      title: 'Testberuf',
      is_active: true,
      duration_years: 3,
      settings: {},
    },
  ],
  courses: [
    {
      id: 'c1',
      code: 'K1',
      title: 'Komponente',
      description: null,
      training_component_id: null,
      is_active: true,
    },
  ],
};

const fixedNow = () => new Date('2026-11-03T10:00:00.000Z');

describe('buildContentCheckReport', () => {
  it('answers null for a catalog that does not exist', async () => {
    const { db } = fakeDb({ catalog: [] });
    expect(
      await buildContentCheckReport(db, CATALOG, { ki: false })
    ).toBeNull();
  });

  it('runs the script checks, counts them and sorts errors first', async () => {
    const { db } = fakeDb();
    const report = await buildContentCheckReport(db, CATALOG, {
      ki: false,
      now: fixedNow,
      planLoader: () => null,
    });
    expect(report).toMatchObject({
      catalogId: CATALOG,
      catalogCode: 'TEST',
      generatedAt: '2026-11-03T10:00:00.000Z',
      ran: { script: true, ki: false, plan: false },
    });
    expect(report?.findings.map(x => x.rule)).toEqual([
      'course.enabler.missing',
    ]);
    expect(report?.counts).toEqual({ error: 1, warning: 0, info: 0 });
    // The honest note on what is not covered is always there
    expect(report?.notes).toEqual([NOT_CHECKED_NOTE]);
  });

  it('the AI review only runs on request', async () => {
    const { db } = fakeDb();
    const runKi = jest.fn(async () => ({
      ran: true,
      findings: [f('ki.luecke', 'warning', 'ki')],
      notes: ['Die KI hat 1 von 1 Komponenten geprüft.'],
      usage: { units: 1, calls: 1, tokens: 10, reviewed: 1 },
    }));
    const without = await buildContentCheckReport(db, CATALOG, {
      ki: false,
      runKi,
      planLoader: () => null,
    });
    expect(runKi).not.toHaveBeenCalled();
    expect(without?.ran.ki).toBe(false);

    const withKi = await buildContentCheckReport(db, CATALOG, {
      ki: true,
      runKi,
      planLoader: () => null,
    });
    expect(runKi).toHaveBeenCalledTimes(1);
    expect(withKi?.ran.ki).toBe(true);
    expect(withKi?.findings.map(x => x.rule)).toEqual([
      'course.enabler.missing',
      'ki.luecke',
    ]);
    expect(withKi?.notes).toContain('Die KI hat 1 von 1 Komponenten geprüft.');
  });

  it('a review that did not run is said in the notes and does not count as run', async () => {
    const { db } = fakeDb();
    const runKi = jest.fn(async () => ({
      ran: false,
      findings: [],
      notes: [
        'KI-Prüfung nicht gelaufen: Sie ist in dieser Umgebung nicht eingeschaltet.',
      ],
      usage: { units: 0, calls: 0, tokens: 0, reviewed: 0 },
    }));
    const report = await buildContentCheckReport(db, CATALOG, {
      ki: true,
      runKi,
      planLoader: () => null,
    });
    expect(report?.ran.ki).toBe(false);
    expect(report?.notes.join(' ')).toContain('nicht eingeschaltet');
  });

  describe('the hook for the plan check', () => {
    it('takes the findings of a placeholder and forces the source plan', async () => {
      const { db } = fakeDb();
      const planFindings = jest.fn(async (id: string) => [
        f(`plan.demo.${id.slice(-2)}`, 'warning', 'script'),
        {
          ...f('plan.demo.b', 'info', 'plan'),
          refs: Array(30).fill({ type: 'catalog', id: 'x', label: 'x' }),
        },
        { nonsense: true } as never,
      ]);
      const report = await buildContentCheckReport(db, CATALOG, {
        ki: false,
        planLoader: () => planFindings,
      });
      expect(planFindings).toHaveBeenCalledWith(CATALOG);
      expect(report?.ran.plan).toBe(true);
      const plan = report?.findings.filter(x => x.rule.startsWith('plan.demo'));
      expect(plan?.map(x => x.source)).toEqual(['plan', 'plan']);
      expect(plan?.[1].refs).toHaveLength(20);
      // The nonsense entry is dropped
      expect(plan).toHaveLength(2);
    });

    it('without the module the report has no plan part and nothing fails', async () => {
      const { db } = fakeDb();
      const report = await buildContentCheckReport(db, CATALOG, {
        ki: false,
        planLoader: () => null,
      });
      expect(report?.ran.plan).toBe(false);
      expect(report?.notes).toEqual([NOT_CHECKED_NOTE]);
    });

    it('a plan check that fails is a note, the rest of the report stays', async () => {
      const { db } = fakeDb();
      const report = await buildContentCheckReport(db, CATALOG, {
        ki: false,
        planLoader: () => async () => {
          throw new Error('boom');
        },
      });
      expect(report?.ran.plan).toBe(false);
      expect(report?.notes).toContain(PLAN_FAILED_NOTE);
      expect(report?.findings).toHaveLength(1);
    });

    it('the default loader finds no module that does not exist yet', () => {
      expect(PLAN_CHECK_MODULE).toBe('@/lib/catalog/content-plan/plan-check');
      // Until the plan module is merged the hook answers "none"; afterwards it
      // answers the function. Both are valid, a thrown error is not.
      const loaded = loadPlanFindings();
      expect(loaded === null || typeof loaded === 'function').toBe(true);
    });
  });
});

describe('helpers', () => {
  it('counts by severity and sorts stably', () => {
    const list = [
      f('a', 'info'),
      f('b', 'error'),
      f('c', 'warning'),
      f('d', 'error'),
      f('e', 'info'),
    ];
    expect(countBySeverity(list)).toEqual({ error: 2, warning: 1, info: 2 });
    expect(sortFindings(list).map(x => x.rule)).toEqual([
      'b',
      'd',
      'c',
      'a',
      'e',
    ]);
    expect(countBySeverity([])).toEqual({ error: 0, warning: 0, info: 0 });
  });
});
