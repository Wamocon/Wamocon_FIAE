// The description of an enabler in the plan is the short form (like FIAE), the
// whole Word text stays in the PDF document. All texts are invented.
import {
  buildImportPlan,
  renderPlanSummary,
  validatePlan,
} from '@/lib/content-import/apply/plan';
import type { ImportPlan } from '@/lib/content-import/apply/types';
import { enablerSummaryIntro } from '@/lib/content-import/enabler-summary';

import {
  DIR,
  enablerContent,
  file,
  loadDecisions,
  sampleTree,
} from './fixtures';

const NOW = new Date('2026-10-28T12:00:00Z');
const ENABLER_A = `${DIR.k1}/Enablers/1a_Thema/1a.docx`;
const DEEP = 'Erfundener Satz tief im Lehrtext, nur im PDF zu lesen.';

const body = (extra: string[] = []) => [
  'Inhaltsverzeichnis',
  'Überblick\t2',
  'Termine planen\t2',
  'Fristen überwachen\t3',
  'Überblick',
  'Erfundene Büros brauchen verlässliche Abläufe, damit Termine eingehalten werden und nichts liegen bleibt.',
  ...Array.from({ length: 60 }, (_, i) => `Absatz ${i + 1}: ${DEEP}`),
  ...extra,
];
const tree = (extra: string[] = []) =>
  sampleTree().map(f =>
    f.rel === ENABLER_A
      ? file(ENABLER_A, enablerContent('1a) Erstes Thema', body(extra)))
      : f
  );
const build = (files = tree(), patch?: (raw: any) => void) =>
  buildImportPlan(files, loadDecisions(patch), { now: NOW });
const enabler = (p: ImportPlan, code: string) =>
  p.enablers.find(e => e.code === code)!;

describe('buildImportPlan: the description of an enabler', () => {
  const plan = build();

  it('is the intro line and the list of the topics, not the whole text', () => {
    const text = enabler(plan, 'K1-a').descriptionText as string;
    // the most frequent FIAE form: intro with the title, a blank line, the topics
    expect(text).toBe(
      `${enablerSummaryIntro('Erstes Thema')}\n\n- Termine planen\n- Fristen überwachen`
    );
    expect(text.length).toBeLessThan(600);
    expect(text).not.toContain(DEEP);
  });

  it('keeps the whole text out of the plan file', () => {
    expect(JSON.stringify(plan)).not.toContain(DEEP);
  });

  it('gives a short text to every enabler of the tree', () => {
    for (const e of plan.enablers) {
      expect((e.descriptionText ?? '').length).toBeLessThanOrEqual(600);
    }
  });

  it('is left out when the presets say so', () => {
    const p = build(tree(), raw => {
      raw.content.enablerText = false;
    });
    expect(p.enablers.every(e => e.descriptionText === null)).toBe(true);
  });

  it('is built the same way every time', () => {
    expect(build().enablers).toEqual(plan.enablers);
  });
});

describe('buildImportPlan: the guard still reads the whole text', () => {
  it('blocks an enabler whose text names a solution far behind the short description', () => {
    const p = build(tree(['Musterlösung: etwas Erfundenes']));
    expect(p.enablers.map(e => e.code)).not.toContain('K1-a');
    expect(p.skipped.find(s => s.key === 'enabler:K1-a')?.code).toBe(
      'SOLUTION_MARKER'
    );
  });
});

describe('validatePlan: the length of a description', () => {
  const clone = (p: ImportPlan) => JSON.parse(JSON.stringify(p));

  it('accepts the short form', () => {
    expect(validatePlan(clone(build()))).toEqual([]);
  });

  it('refuses a plan with the whole text (built before the short form)', () => {
    const p = clone(build());
    p.enablers[0].descriptionText = 'Lehrtext. '.repeat(500);
    expect(validatePlan(p).join(' ')).toMatch(
      /enabler K1-a has a description of 5000 characters.*build it again/
    );
  });
});

describe('renderPlanSummary: the lengths', () => {
  it('names the distribution of the description lengths, numbers only', () => {
    const text = renderPlanSummary(build());
    expect(text).toMatch(
      /Länge der Enabler-Beschreibung \(Zeichen\) \| kleinste \d+, Median \d+, Mittel \d+, größte \d+/
    );
    expect(text).not.toContain(DEEP);
  });
});
