// Reviewed false alarms of the bare word "Lösung" (content.
// reviewedSolutionWordFalsePositives of the decisions file). All texts are
// invented. A teaching text may label a table cell with the single word
// "Lösung", which the plain marker blocks. The owner can release exactly that
// pattern for named enablers, nothing else.

import { executePlan } from '@/lib/content-import/apply/engine';
import type { RunOptions } from '@/lib/content-import/apply/engine';
import {
  findRowLeaks,
  findSolutionLeaks,
  leakOf,
  leakOfEnablerText,
  SOLUTION_MARKERS,
} from '@/lib/content-import/apply/guard';
import {
  buildImportPlan,
  planCounts,
  validatePlan,
} from '@/lib/content-import/apply/plan';
import type { ImportPlan } from '@/lib/content-import/apply/types';
import { parseQuizText } from '@/lib/content-import/source-parsers';

import {
  CREATOR_ID,
  MemoryImportDb,
} from '../../../helpers/memoryImportDb';
import {
  DIR,
  enablerContent,
  file,
  loadDecisions,
  quizLines,
  sampleTree,
} from './fixtures';

const NOW = new Date('2026-10-26T12:00:00Z');
const REASON = 'Table cell label in the teaching text, checked by the owner';
const ENABLER_B = `${DIR.k1}/Enablers/1b_Thema/1b.docx`;
const TABLE = ['Erfundener Lehrtext.', 'Fehlerprotokoll', 'Lösung', 'Ende.'];

const reviewed = (...codes: string[]) =>
  loadDecisions(raw => {
    raw.content.reviewedSolutionWordFalsePositives = codes.map(enabler => ({
      enabler,
      reason: REASON,
    }));
  });
const withBody = (body: string[], heading = '1b) Zweites Thema') =>
  sampleTree().map(f =>
    f.rel === ENABLER_B ? file(ENABLER_B, enablerContent(heading, body)) : f
  );
const build = (files = withBody(TABLE), codes: string[] = ['K1-b']) =>
  buildImportPlan(files, reviewed(...codes), { now: NOW });
const lessonCodes = (p: ImportPlan, enabler: string) =>
  p.quizzes.filter(q => q.enablerCode === enabler).map(q => q.code);
const skippedCode = (p: ImportPlan, key: string) =>
  p.skipped.find(s => s.key === key)?.code;
const clone = (p: ImportPlan) => JSON.parse(JSON.stringify(p));
// The description of a plan is the short form of the text (the bare line never
// reaches it), so the tests of the guard on a plan put the table text in.
const withTableText = (p: ImportPlan, code = 'K1-b') => {
  const copy = clone(p) as ImportPlan;
  copy.enablers.find(e => e.code === code)!.descriptionText =
    TABLE.join('\n\n');
  return copy;
};

describe('leakOf with the review option', () => {
  it('lets only the bare line of the word pass', () => {
    expect(leakOf('Text\nLösung\nEnde', [])).toBe(
      'contains a solution marker'
    );
    expect(
      leakOf('Text\nLösung\nEnde', [], { allowBareSolutionLine: true })
    ).toBeNull();
    expect(
      leakOf('Text\n  Loesung:  \nEnde', [], { allowBareSolutionLine: true })
    ).toBeNull();
  });

  it('keeps every other marker and the solution texts sharp', () => {
    for (const text of [
      'Lösungsszenario',
      'Text\nMusterlösung\nMehr',
      'Musterloesung: folgt',
      'Richtige Antwort: B',
      'Kurzbegründung: folgt',
      'Bewertungskriterien',
      'Korrekte Antwort: B',
      'Text\nAntwortschlüssel\nMehr',
      'Lösungsvorschlag: folgt',
      'Fachwissen zur Lösung',
      // one bare line does not hide another marker in the same text
      'Lösung\nMusterlösung',
    ]) {
      expect(leakOf(text, [], { allowBareSolutionLine: true })).toBe(
        'contains a solution marker'
      );
    }
    expect(
      leakOf('Hier steht: eine erfundene lange Lösung ALPHA genau so.', [
        'Eine erfundene lange Lösung ALPHA genau so.',
      ], { allowBareSolutionLine: true })
    ).toBe('contains a solution text');
  });

  it('uses the shared, frozen list as before', () => {
    expect(Object.isFrozen(SOLUTION_MARKERS)).toBe(true);
    expect(leakOf('Lösung', [])).toBe('contains a solution marker');
  });
});

describe('leakOfEnablerText', () => {
  it('reports whether the review was needed', () => {
    expect(leakOfEnablerText('Text\nLösung', [], true)).toEqual({
      reason: null,
      reviewUsed: true,
    });
    expect(leakOfEnablerText('Text\nLösung', [], false)).toEqual({
      reason: 'contains a solution marker',
      reviewUsed: false,
    });
    expect(leakOfEnablerText('Nur Text', [], true)).toEqual({
      reason: null,
      reviewUsed: false,
    });
    expect(leakOfEnablerText('Lösung\nMusterlösung', [], true)).toEqual({
      reason: 'contains a solution marker',
      reviewUsed: false,
    });
  });
});

describe('buildImportPlan with a reviewed enabler', () => {
  it('blocks the enabler and everything that hangs on it without a review', () => {
    const p = build(withBody(TABLE), []);
    expect(p.enablers.map(e => e.code)).not.toContain('K1-b');
    expect(skippedCode(p, 'enabler:K1-b')).toBe('SOLUTION_MARKER');
    expect(skippedCode(p, 'scenario:K1-b')).toBe('ENABLER_MISSING');
    expect(lessonCodes(p, 'K1-b')).toEqual([]);
    expect(p.reviewedMarkers).toBeUndefined();
  });

  it('lets a reviewed enabler pass with its quizzes and scenario and says so', () => {
    const p = build();
    expect(p.enablers.map(e => e.code)).toContain('K1-b');
    expect(lessonCodes(p, 'K1-b')).toHaveLength(3);
    expect(p.scenarios.map(s => s.enablerCode)).toContain('K1-b');
    expect(p.skipped.map(s => s.key)).not.toContain('enabler:K1-b');
    expect(p.reviewedMarkers).toEqual([
      { enablerCode: 'K1-b', pattern: 'bare-solution-line', reason: REASON },
    ]);
    expect(p.warnings.join(' ')).toMatch(/K1-b: REVIEWED_MARKER/);
    expect(validatePlan(clone(p))).toEqual([]);
  });

  it('counts exactly one enabler, one scenario and three quizzes more', () => {
    const before = planCounts(build(withBody(TABLE), []));
    const after = planCounts(build());
    expect(after.enablers - before.enablers).toBe(1);
    expect(after.scenarios - before.scenarios).toBe(1);
    expect(after.quizzes - before.quizzes).toBe(3);
    expect(after.lessonQuizzes - before.lessonQuizzes).toBe(3);
    expect(after.globalQuizzes).toBe(before.globalQuizzes);
    expect(after.questions - before.questions).toBe(30);
    expect(before.skipped - after.skipped).toBe(5);
    expect(after.components).toBe(before.components);
  });

  it('gives no note when the reviewed enabler has no such line', () => {
    const p = build(sampleTree(), ['K1-b']);
    expect(p.enablers.map(e => e.code)).toContain('K1-b');
    expect(p.reviewedMarkers).toBeUndefined();
    expect(p.warnings.join(' ')).not.toMatch(/REVIEWED_MARKER/);
  });

  it('keeps blocking the same text at an enabler that is not on the list', () => {
    const p = build(withBody(TABLE), ['K1-a']);
    expect(p.enablers.map(e => e.code)).not.toContain('K1-b');
    expect(skippedCode(p, 'enabler:K1-b')).toBe('SOLUTION_MARKER');
    expect(p.reviewedMarkers).toBeUndefined();
  });

  it('keeps every other marker sharp in a reviewed enabler', () => {
    for (const marker of [
      'Lösungsszenario',
      'Loesungszenario',
      'Musterlösung',
      'Richtige Antwort: B',
      'Kurzbegründung: folgt',
      'Lösungsvorschlag',
      'Korrekte Antwort: B',
      'Antwortschlüssel',
      'Bewertungskriterien',
      'Fachwissen zur Lösung',
    ]) {
      const p = build(withBody(['Text.', 'Lösung', marker, 'Ende.']));
      expect(p.enablers.map(e => e.code)).not.toContain('K1-b');
      expect(skippedCode(p, 'enabler:K1-b')).toBe('SOLUTION_MARKER');
      expect(p.reviewedMarkers).toBeUndefined();
    }
  });

  it('still blocks the solution text of the scenario inside a reviewed enabler', () => {
    const p = build(withBody([...TABLE, 'Eine erfundene Lösung OMEGA.']));
    expect(skippedCode(p, 'enabler:K1-b')).toBe('SOLUTION_MARKER');
  });

  it('does not extend to the title of the enabler', () => {
    const p = build(withBody(['Text.'], '1b) Lösung'));
    expect(p.enablers.map(e => e.code)).not.toContain('K1-b');
    expect(skippedCode(p, 'enabler:K1-b')).toBe('SOLUTION_MARKER');
  });

  it('never applies to a quiz of a reviewed enabler', () => {
    const quizFile = `${DIR.k1}/Enablers/1b_Thema/Quiz/1b_Quiz_Low.docx`;
    const lines = quizLines({
      heading: '1b) Zweites Thema',
      level: 'leicht',
      tag: 'x',
    }).map(line => (line.startsWith('1. ') ? '1. Lösung' : line));
    const files = withBody(TABLE).map(f =>
      f.rel === quizFile
        ? file(quizFile, { type: 'quiz', result: parseQuizText(lines) })
        : f
    );
    const p = build(files);
    expect(p.enablers.map(e => e.code)).toContain('K1-b');
    expect(skippedCode(p, 'quiz:K1-b-low')).toBe('SOLUTION_MARKER');
    expect(lessonCodes(p, 'K1-b')).toEqual(['K1-b-medium', 'K1-b-high']);
  });

  it('covers only the enablers that are named', () => {
    const p = build(
      withBody(TABLE).map(f =>
        f.rel === `${DIR.k1}/Enablers/1a_Thema/1a.docx`
          ? file(f.rel, enablerContent('1a) Thema', TABLE))
          : f
      )
    );
    expect(p.enablers.map(e => e.code)).toContain('K1-b');
    expect(p.enablers.map(e => e.code)).not.toContain('K1-a');
  });
});

describe('validatePlan and the guards with reviewed markers', () => {
  const bad = () => withTableText(build());
  const enabler = (p: ImportPlan, code: string) =>
    p.enablers.find(e => e.code === code)!;

  it('accepts the plan with the marker and rejects the text without it', () => {
    expect(validatePlan(bad())).toEqual([]);
    const a = bad();
    delete a.reviewedMarkers;
    expect(validatePlan(a).join(' ')).toMatch(
      /enabler K1-b text contains a solution marker/
    );
    const b = bad();
    b.reviewedMarkers = [];
    expect(validatePlan(b).join(' ')).toMatch(/enabler K1-b text/);
  });

  it('does not let the marker of one enabler cover another', () => {
    const a = bad();
    enabler(a, 'K1-a').descriptionText = TABLE.join('\n\n');
    const problems = validatePlan(a).join(' ');
    expect(problems).toMatch(/enabler K1-a text/);
    expect(problems).not.toMatch(/enabler K1-b text/);
  });

  it('does not extend to other markers, titles, scenarios and quizzes', () => {
    const a = bad();
    enabler(a, 'K1-b').descriptionText += '\nMusterlösung';
    expect(validatePlan(a).join(' ')).toMatch(/enabler K1-b text/);
    const b = bad();
    enabler(b, 'K1-b').title = 'Lösung';
    expect(validatePlan(b).join(' ')).toMatch(/enabler K1-b title/);
    const c = bad();
    c.scenarios.find((s: any) => s.enablerCode === 'K1-b').situation =
      'Text\nLösung\nEnde';
    expect(validatePlan(c).join(' ')).toMatch(/scenario K1-b situation/);
    const d = bad();
    d.quizzes.find((q: any) => q.enablerCode === 'K1-b').questions[0].text =
      'Lösung';
    expect(validatePlan(d).join(' ')).toMatch(/quiz K1-b-low question 1/);
  });

  it('rejects malformed markers (fail closed)', () => {
    const entry = () => ({
      enablerCode: 'K1-b',
      pattern: 'bare-solution-line',
      reason: REASON,
    });
    const cases: Array<[string, unknown]> = [
      ['not a list', 'K1-b'],
      ['not an object', ['K1-b']],
      ['unknown enabler', [{ ...entry(), enablerCode: 'K9-z' }]],
      ['twice', [entry(), entry()]],
      ['no reason', [{ ...entry(), reason: '  ' }]],
      ['another pattern', [{ ...entry(), pattern: 'any' }]],
      ['unknown field', [{ ...entry(), all: true }]],
      ['reason too long', [{ ...entry(), reason: 'x'.repeat(401) }]],
      ['reason with a line break', [{ ...entry(), reason: 'a\nb' }]],
    ];
    for (const [name, value] of cases) {
      const a = bad();
      a.reviewedMarkers = value;
      expect([name, validatePlan(a).length > 0]).toEqual([name, true]);
    }
  });

  it('findSolutionLeaks follows the list of the plan, not a guess', () => {
    const p = withTableText(build());
    expect(findSolutionLeaks(p)).toEqual([]);
    const q = { ...p, reviewedMarkers: undefined };
    expect(findSolutionLeaks(q).join(' ')).toMatch(/enabler K1-b text/);
  });

  it('findRowLeaks lets the bare line pass only for the named enabler rows', () => {
    const rows = (code: string) => ({
      enablers: [{ code, title: 'Thema', description_text: TABLE.join('\n') }],
    });
    expect(findRowLeaks(rows('K1-b'), [], [], new Set(['K1-b']))).toEqual([]);
    expect(findRowLeaks(rows('K1-a'), [], [], new Set(['K1-b']))).toEqual([
      'enablers.description_text contains a solution marker',
    ]);
    expect(findRowLeaks(rows('K1-b'), [], [])).toEqual([
      'enablers.description_text contains a solution marker',
    ]);
    // other tables and the title of a named enabler stay strict
    expect(
      findRowLeaks(
        {
          enablers: [{ code: 'K1-b', title: 'Lösung', description_text: null }],
          quizzes: [{ title: 'Lösung' }],
        },
        [],
        [],
        new Set(['K1-b'])
      )
    ).toEqual([
      'enablers.title contains a solution marker',
      'quizzes.title contains a solution marker',
    ]);
  });
});

describe('executePlan with a reviewed enabler', () => {
  const options = (patch: Partial<RunOptions> = {}): RunOptions => ({
    createdBy: CREATOR_ID,
    updateExisting: false,
    write: true,
    activate: false,
    scenarioSolutions: true,
    ...patch,
  });

  it('writes the reviewed enabler text', async () => {
    const db = new MemoryImportDb();
    const report = await executePlan(db, build(), options());
    expect(report.wrote).toBe(true);
    expect(
      String(db.tables.enablers.find(e => e.code === 'K1-b')!.description_text)
    ).toMatch(/Fehlerprotokoll/);
  });

  it('refuses the same plan once the marker is removed', async () => {
    const db = new MemoryImportDb();
    const p = withTableText(build());
    delete p.reviewedMarkers;
    await expect(executePlan(db, p, options())).rejects.toMatchObject({
      code: 'PLAN_INVALID',
    });
    expect(db.totalRows()).toBe(0);
  });

  it('lets an update of the reviewed enabler text through and no other', async () => {
    const db = new MemoryImportDb();
    await executePlan(db, build(withBody(['Erfundener Lehrtext.'])), options());
    // the text is changed to one with the bare line
    const report = await executePlan(
      db,
      build(),
      options({ updateExisting: true })
    );
    expect(report.tables.enablers.update).toBe(1);
    expect(
      String(db.tables.enablers.find(e => e.code === 'K1-b')!.description_text)
    ).toMatch(/Fehlerprotokoll/);
  });
});
