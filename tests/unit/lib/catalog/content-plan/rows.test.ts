import { describe, it, expect } from '@jest/globals';
import {
  RowCollector,
  acceptRows,
  coerceValue,
  parseNumber,
  planToRows,
  rowsToPlan,
  valueToText,
} from '@/lib/catalog/content-plan/rows';
import { EXAMPLE_PLAN } from '@/lib/catalog/content-plan/template';
import {
  PLAN_LIMITS,
  contentPlanSchema,
} from '@/lib/catalog/content-plan/types';

describe('plan and rows', () => {
  it('round trip: plan to rows to plan gives the same plan', () => {
    const rows = planToRows(EXAMPLE_PLAN, 'x');
    expect(rowsToPlan(rows)).toEqual(EXAMPLE_PLAN);
    expect(contentPlanSchema.safeParse(rowsToPlan(rows)).success).toBe(true);
  });

  it('gives every row a distinct id and a quote', () => {
    const rows = planToRows(EXAMPLE_PLAN, 'Blatt Gesamt, Zeile 2');
    expect(new Set(rows.map(r => r.id)).size).toBe(rows.length);
    expect(rows.every(r => r.quote === 'Blatt Gesamt, Zeile 2')).toBe(true);
  });

  it('the last row of an id wins', () => {
    const rows = planToRows({ totals: { enablers: 5 } });
    const edited = { ...rows[0], value: 7 };
    expect(rowsToPlan([...rows, edited])).toEqual({ totals: { enablers: 7 } });
  });

  it('keeps the owner of a component whose code and title rows were switched off', () => {
    const rows = planToRows({ components: [{ code: 'K1', hours: 8 }] }).filter(
      r => r.field !== 'code'
    );
    expect(rowsToPlan(rows)).toEqual({
      components: [{ hours: 8, code: 'K1' }],
    });
  });

  it('empty rows make an empty plan', () => {
    expect(rowsToPlan([])).toEqual({});
  });
});

describe('numbers and values of a cell', () => {
  it('reads plain numbers, a decimal comma and units', () => {
    expect(parseNumber('27')).toBe(27);
    expect(parseNumber(' 2,5 ')).toBe(2.5);
    expect(parseNumber('80 Std')).toBe(80);
    expect(parseNumber('3 Wochen')).toBe(3);
    expect(parseNumber('1.5')).toBe(1.5);
  });

  it('reads a German thousand separator only when told to', () => {
    expect(parseNumber('1.200')).toBe(1.2);
    expect(parseNumber('1.200', true)).toBe(1200);
    expect(parseNumber('1.200,5', true)).toBe(1200.5);
  });

  it.each(['', 'abc', '1e3', '-4', '1,2,3', '0x10', 'NaN'])(
    'refuses %p',
    text => {
      expect(parseNumber(text)).toBeNull();
    }
  );

  it('coerces booleans, phases, kinds and lists', () => {
    expect(coerceValue('boolean', 'Ja')).toBe(true);
    expect(coerceValue('boolean', 'nein')).toBe(false);
    expect(coerceValue('boolean', 'vielleicht')).toBeUndefined();
    expect(coerceValue('phase', 'Phase 2')).toBe(2);
    expect(coerceValue('phase', '3')).toBeUndefined();
    expect(coerceValue('kind', 'Wahlpflicht')).toBe('wahl');
    expect(coerceValue('kind', 'Pflicht')).toBe('pflicht');
    expect(coerceValue('kind', 'egal')).toBeUndefined();
    expect(coerceValue('list', 'LF1, LF2;LF3')).toEqual(['LF1', 'LF2', 'LF3']);
    expect(valueToText(['a', 'b'])).toBe('a, b');
    expect(valueToText(true)).toBe('ja');
    expect(valueToText(12)).toBe('12');
  });
});

describe('collector', () => {
  it('drops a bad value with its place, never turns it into zero', () => {
    const c = new RowCollector();
    expect(c.add('totals', '', 'enablers', 'viele', 'Zeile 2')).toBe(false);
    expect(c.add('totals', '', 'enablers', '-3', 'Zeile 3')).toBe(false);
    expect(c.add('totals', '', 'hours', '99999999', 'Zeile 4')).toBe(false);
    expect(c.rows).toEqual([]);
    expect(c.issues.map(i => i.where)).toEqual([
      'Zeile 2',
      'Zeile 3',
      'Zeile 4',
    ]);
    expect(c.issues.every(i => i.message === 'invalid_value')).toBe(true);
  });

  it('an empty cell is "not stated" and silent', () => {
    const c = new RowCollector();
    expect(c.add('totals', '', 'enablers', '  ', 'Zeile 2')).toBe(false);
    expect(c.add('totals', '', 'enablers', null, 'Zeile 2')).toBe(false);
    expect(c.issues).toEqual([]);
  });

  it('reports an unknown field and a duplicate', () => {
    const c = new RowCollector();
    expect(c.add('component', 'K1', 'nope', '1', 'a')).toBe(false);
    expect(c.add('component', 'K1', 'hours', '4', 'b')).toBe(true);
    expect(c.add('component', 'K1', 'hours', '5', 'c')).toBe(false);
    expect(c.issues.map(i => i.message)).toEqual([
      'unknown_field',
      'duplicate',
    ]);
  });

  it('bounds the number of components and of fields', () => {
    const c = new RowCollector();
    for (let i = 0; i < PLAN_LIMITS.maxComponents + 5; i += 1) {
      c.add('component', `K${i}`, 'hours', '1', 'x');
    }
    expect(c.rows.length).toBe(PLAN_LIMITS.maxComponents);
    expect(c.issues.some(i => i.message === 'too_many_entries')).toBe(true);
  });

  it('keeps a relation and a note, refuses empty ones', () => {
    const c = new RowCollector();
    expect(c.addRelation('use_case_enabler', 'UC1', 'K1-a', 'q')).toBe(true);
    expect(c.addRelation('use_case_enabler', '', 'K1-a', 'q')).toBe(false);
    expect(c.addNote('Ein Hinweis', 'q')).toBe(true);
    expect(c.addNote('   ', 'q')).toBe(false);
    expect(rowsToPlan(c.rows)).toEqual({
      relations: [{ type: 'use_case_enabler', from: 'UC1', to: 'K1-a' }],
      notes: ['Ein Hinweis'],
    });
  });

  it('cuts a quote to 160 characters', () => {
    const c = new RowCollector();
    c.add('totals', '', 'enablers', '5', 'q'.repeat(400));
    expect(c.rows[0].quote.length).toBe(PLAN_LIMITS.maxQuoteChars);
  });
});

describe('accepting a proposal', () => {
  const rows = planToRows(
    {
      totals: { enablers: 10, hours: 100 },
      components: [{ code: 'K1', hours: 8, globalQuiz: true }],
      relations: [{ type: 'use_case_enabler', from: 'UC1', to: 'K1-a' }],
    },
    'Zeile 1'
  );
  const all = new Set(rows.map(r => r.id));

  it('takes the selected fields, a switched off field stays out', () => {
    const selected = new Set(all);
    selected.delete('totals::hours');
    const { rows: accepted, invalid } = acceptRows(rows, selected);
    expect(invalid).toEqual([]);
    expect(rowsToPlan(accepted).totals).toEqual({ enablers: 10 });
  });

  it('takes an edited value and checks it again', () => {
    const edited = acceptRows(rows, all, { 'totals::enablers': '12' });
    expect(rowsToPlan(edited.rows).totals?.enablers).toBe(12);
    const bad = acceptRows(rows, all, { 'totals::enablers': '-1' });
    expect(bad.invalid).toEqual(['totals::enablers']);
    const text = acceptRows(rows, all, { 'component:K1:hours': 'viel' });
    expect(text.invalid).toEqual(['component:K1:hours']);
  });

  it('an emptied field means "not stated"', () => {
    const { rows: accepted, invalid } = acceptRows(rows, all, {
      'totals::hours': '  ',
    });
    expect(invalid).toEqual([]);
    expect(rowsToPlan(accepted).totals).toEqual({ enablers: 10 });
  });

  it('an edit of a boolean and of a relation target', () => {
    const { rows: accepted } = acceptRows(rows, all, {
      'component:K1:globalQuiz': 'nein',
      'relation:use_case_enabler:UC1:K1-a': 'K1-b',
    });
    const plan = rowsToPlan(accepted);
    expect(plan.components?.[0].globalQuiz).toBe(false);
    expect(plan.relations).toEqual([
      { type: 'use_case_enabler', from: 'UC1', to: 'K1-b' },
    ]);
  });
});
