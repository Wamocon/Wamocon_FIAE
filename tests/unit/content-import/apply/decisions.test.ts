import fs from 'fs';
import path from 'path';

import {
  kindOfComponent,
  parseDecisions,
} from '@/lib/content-import/apply/decisions';

const decisionsFile = path.join(
  process.cwd(),
  'scripts',
  'import',
  'kfbm-decisions.json'
);
const fromFile = () => JSON.parse(fs.readFileSync(decisionsFile, 'utf8'));

function parsed() {
  const result = parseDecisions(fromFile());
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.decisions;
}

describe('kfbm-decisions.json', () => {
  it('is valid and carries the presets of the plan', () => {
    const d = parsed();
    expect(d.catalog).toBe('KFBM');
    expect(d.duplicates.policy).toBe('newest');
    expect(d.components.excludedNumbers).toEqual([18]);
    expect(d.components.electiveNumbers).toEqual([
      10, 11, 12, 13, 14, 15, 16, 17, 19,
    ]);
    expect(d.components.integrativeNumbers).toEqual([20, 21, 22, 23]);
    expect(d.components.mandatoryNumbers).toEqual(
      expect.arrayContaining([24, 25])
    );
    expect(d.content.activate).toBe(false);
    expect(d.content.globalQuizQuestions).toBe(20);
  });

  it('leaves weeks and hours empty (provisional) and keeps the open questions', () => {
    const d = parsed();
    expect(d.components.totalWeeks).toEqual({});
    expect(d.components.totalHours).toEqual({});
    expect(d.open.length).toBeGreaterThan(0);
  });

  it('gives every component number exactly one kind', () => {
    const d = parsed();
    expect(kindOfComponent(d, 1)).toBe('pflicht');
    expect(kindOfComponent(d, 24)).toBe('pflicht');
    expect(kindOfComponent(d, 25)).toBe('pflicht');
    expect(kindOfComponent(d, 10)).toBe('wahl');
    expect(kindOfComponent(d, 19)).toBe('wahl');
    expect(kindOfComponent(d, 20)).toBe('integrativ');
    expect(kindOfComponent(d, 23)).toBe('integrativ');
    // K18 is excluded and a number nobody decided on has no kind
    expect(kindOfComponent(d, 18)).toBeNull();
    expect(kindOfComponent(d, 26)).toBeNull();
  });
});

describe('parseDecisions', () => {
  it('rejects anything that is not an object', () => {
    for (const bad of [null, 5, 'x', []]) {
      const result = parseDecisions(bad);
      expect(result.ok).toBe(false);
    }
  });

  it('rejects a catalog other than KFBM (never FIAE)', () => {
    const raw = fromFile();
    raw.catalog = 'FIAE';
    const result = parseDecisions(raw);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.join(' ')).toMatch(/KFBM/);
  });

  it('rejects a number in two kinds or in the excluded list as well', () => {
    const raw = fromFile();
    raw.components.electiveNumbers = [...raw.components.electiveNumbers, 20];
    const overlap = parseDecisions(raw);
    expect(overlap.ok).toBe(false);

    const raw2 = fromFile();
    raw2.components.mandatoryNumbers = [
      ...raw2.components.mandatoryNumbers,
      18,
    ];
    expect(parseDecisions(raw2).ok).toBe(false);
  });

  it('rejects a phase other than 1, 2 or null and a negative duration', () => {
    const raw = fromFile();
    raw.components.phaseByGroup.teil1 = 3;
    expect(parseDecisions(raw).ok).toBe(false);

    const raw2 = fromFile();
    raw2.components.totalWeeks = { K1: -1 };
    expect(parseDecisions(raw2).ok).toBe(false);

    const raw3 = fromFile();
    raw3.duplicates.ambiguousWithinHours = -2;
    expect(parseDecisions(raw3).ok).toBe(false);
  });

  it('rejects an unknown policy and missing sections', () => {
    const raw = fromFile();
    raw.duplicates.policy = 'oldest';
    expect(parseDecisions(raw).ok).toBe(false);

    const raw2 = fromFile();
    delete raw2.components;
    expect(parseDecisions(raw2).ok).toBe(false);
  });
});

describe('content.reviewedSolutionWordFalsePositives', () => {
  const REASON = 'Table cell label in the teaching text, checked by the owner';
  const withList = (list: unknown) => {
    const raw = fromFile();
    raw.content.reviewedSolutionWordFalsePositives = list;
    return parseDecisions(raw);
  };
  const errorsOf = (list: unknown) => {
    const result = withList(list);
    return result.ok ? [] : result.errors.join(' ');
  };

  it('names exactly the two reviewed enablers of the shipped file, each with a reason', () => {
    const list = parsed().content.reviewedSolutionWordFalsePositives;
    expect(list.map(e => e.enabler)).toEqual(['K24.2-e', 'K25.2-d']);
    for (const entry of list) expect(entry.reason.length).toBeGreaterThan(20);
  });

  it('is optional and empty by default', () => {
    const raw = fromFile();
    delete raw.content.reviewedSolutionWordFalsePositives;
    const result = parseDecisions(raw);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decisions.content.reviewedSolutionWordFalsePositives).toEqual(
        []
      );
    }
  });

  it('accepts well-formed entries and trims the reason', () => {
    const result = withList([
      { enabler: 'K6.2-d', reason: `  ${REASON}  ` },
      { enabler: 'K9-a', reason: REASON },
    ]);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.decisions.content.reviewedSolutionWordFalsePositives).toEqual(
        [
          { enabler: 'K6.2-d', reason: REASON },
          { enabler: 'K9-a', reason: REASON },
        ]
      );
    }
  });

  it('rejects anything that is not a list of entries', () => {
    for (const bad of [null, 'K24.2-e', { 'K24.2-e': REASON }, 5, ['K24.2-e']]) {
      expect(errorsOf(bad)).toMatch(/reviewedSolutionWordFalsePositives/);
    }
  });

  it('rejects an unknown key, also a wildcard or a component', () => {
    for (const enabler of [
      'K24.2',
      'K24.2-',
      'K24.2-E',
      'k24.2-e',
      '24_2e',
      '*',
      'K24.2-e K25.2-d',
      'K24.2-ee',
      'K1-a\n',
      '',
      7,
      null,
    ]) {
      expect(errorsOf([{ enabler, reason: REASON }])).toMatch(
        /enabler key/
      );
    }
  });

  it('rejects a missing, empty or too short reason', () => {
    for (const reason of [undefined, '', '   ', 'ok', 'short one', 5, null]) {
      expect(errorsOf([{ enabler: 'K24.2-e', reason }])).toMatch(/reason/);
    }
    expect(errorsOf([{ enabler: 'K24.2-e', reason: `${REASON}\nmore` }])).toMatch(
      /reason/
    );
    expect(
      errorsOf([{ enabler: 'K24.2-e', reason: 'x'.repeat(401) }])
    ).toMatch(/reason/);
  });

  it('rejects a duplicate entry and an unknown field of an entry', () => {
    expect(
      errorsOf([
        { enabler: 'K24.2-e', reason: REASON },
        { enabler: 'K24.2-e', reason: `${REASON} again` },
      ])
    ).toMatch(/twice/);
    expect(
      errorsOf([{ enabler: 'K24.2-e', reason: REASON, pattern: 'any' }])
    ).toMatch(/unknown field/);
  });
});
