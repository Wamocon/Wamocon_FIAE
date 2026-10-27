import {
  buildUseCasePlan,
  renderUseCaseSummary,
  selectUseCaseFiles,
  countUseCasePlan,
  validateUseCasePlan,
} from '@/lib/content-import/use-cases/plan';
import type { UseCasePlan } from '@/lib/content-import/use-cases/types';

import {
  BASE_TIME,
  DIR,
  HOUR,
  file,
  loadDecisions,
  plain,
  sampleTree,
  ucPath,
  useCaseContent,
} from './fixtures';

const NOW = new Date('2026-10-27T10:00:00Z');
const build = (files = sampleTree(), limitedTo: string[] = []) =>
  buildUseCasePlan(files, loadDecisions(), { now: NOW, limitedTo });
const codesOf = (plan: UseCasePlan) => plan.skipped.map(s => s.code);

describe('buildUseCasePlan: the sample tree', () => {
  const plan = build();

  it('plans one use case per file, in the order of the components and letters', () => {
    expect(plan.useCases.map(u => u.code)).toEqual([
      'K1-a',
      'K1-b',
      'K6.1-a',
      'K6.2-d',
      'K10-a',
      'K20-a',
    ]);
    expect(plan.skipped).toEqual([]);
    expect(plan.catalog).toBe('KFBM');
    expect(plan.kind).toBe('use-cases');
    expect(plan.generatedAt).toBe(NOW.toISOString());
    expect(validateUseCasePlan(plan)).toEqual([]);
  });

  it('keys a use case by component code, enabler code and letter', () => {
    const uc = plan.useCases.find(u => u.code === 'K6.2-d');
    expect(uc).toMatchObject({
      componentCode: 'K6.2',
      enablerCode: 'K6.2-d',
      letter: 'd',
      orderIndex: 4,
      title: 'Erfundener Titel 6.2d',
    });
    expect(uc?.source).toContain('UC_6d_Titel.docx');
  });

  it('keeps the solution out of the visible description and the topics', () => {
    for (const uc of plan.useCases) {
      expect(uc.description).toContain('Ausgangssituation');
      expect(uc.description).toContain('Weg zum Ziel');
      expect(uc.description).not.toContain('OMEGA');
      expect(uc.description).not.toContain('ZETA');
      expect(uc.topics).not.toContain('OMEGA');
      expect(uc.solution).toContain('OMEGA');
      expect(uc.criteria).toBeNull();
    }
  });

  it('counts and summarizes without any content', () => {
    expect(countUseCasePlan(plan)).toEqual({
      useCases: 6,
      withTopics: 6,
      withCriteria: 0,
      components: 5,
      skipped: 0,
      superseded: 0,
    });
    const summary = renderUseCaseSummary(plan);
    expect(summary).toContain('| Use Cases | 6 |');
    expect(summary).toContain('| K1 | 2 | a b |');
    expect(summary).not.toContain('OMEGA');
    expect(summary).not.toContain('Schrauben');
    expect(summary).not.toContain('Erfundene Firma');
  });

  it('is limited to the named components', () => {
    const limited = build(sampleTree(), ['K1', 'K20']);
    expect(limited.useCases.map(u => u.code)).toEqual([
      'K1-a',
      'K1-b',
      'K20-a',
    ]);
    expect(limited.limitedTo).toEqual(['K1', 'K20']);
    expect(renderUseCaseSummary(limited)).toContain(
      'Begrenzt auf die Komponenten: K1, K20.'
    );
  });
});

describe('selectUseCaseFiles', () => {
  const select = (files: ReturnType<typeof sampleTree>) =>
    selectUseCaseFiles(files, loadDecisions());

  it('counts what is not a use case instead of planning it', () => {
    const files = [
      ...sampleTree(),
      file(ucPath(DIR.k18, '18', '18a')),
      file(`${DIR.k1}/Enablers/1a_Thema/1a.docx`),
      file(`${DIR.k1}/K1_Use-Cases/Enabler/1a_Thema.docx`),
      file(`${DIR.k1}/Enablers/1a_Thema/Enabler_Archiv_to_delete/1z.docx`),
      file(`${DIR.k1}/K1_Use-Cases/UC_1c_Titel.pdf`),
    ];
    const selection = select(files);
    expect(selection.chosen).toHaveLength(6);
    expect(selection.notPlanned).toEqual({
      excluded: 1,
      enabler: 2,
      archive: 1,
      'use-case-pdf': 1,
    });
    expect(selection.skipped).toEqual([]);
  });

  it('skips a name that fits no scheme and a component without a decision', () => {
    const selection = select([
      file(`${DIR.k1}/K1_Use-Cases/Aufgabe_ohne_Schema.docx`),
      file(ucPath(DIR.k26, '26', '26a')),
    ]);
    expect(selection.chosen).toEqual([]);
    expect(selection.skipped.map(s => s.code).sort()).toEqual([
      'NO_DECISION',
      'PATH_ISSUE',
    ]);
  });

  it('takes the newest of two copies and names the older one', () => {
    const older = `${DIR.k1}/K1_Use-Cases/Alt/UC_1a_Titel.docx`;
    const selection = select([
      file(ucPath(DIR.k1, '1', '1a'), undefined, {
        mtimeMs: BASE_TIME + 48 * HOUR,
      }),
      file(older),
    ]);
    expect(selection.chosen).toEqual([ucPath(DIR.k1, '1', '1a')]);
    expect(selection.superseded).toEqual([
      { file: older, key: 'use-case:1a', keptFile: ucPath(DIR.k1, '1', '1a') },
    ]);
  });

  it('a higher version wins whatever the dates say', () => {
    const v2 = `${DIR.k1}/K1_Use-Cases/UC_1a_Titel_v2.docx`;
    const selection = select([
      file(ucPath(DIR.k1, '1', '1a'), undefined, {
        mtimeMs: BASE_TIME + 90 * HOUR,
      }),
      file(v2),
    ]);
    expect(selection.chosen).toEqual([v2]);
  });

  it('skips both copies when they are less than 24 hours apart', () => {
    const selection = select([
      file(ucPath(DIR.k1, '1', '1a')),
      file(`${DIR.k1}/K1_Use-Cases/Alt/UC_1a_Titel.docx`, undefined, {
        mtimeMs: BASE_TIME + 23 * HOUR,
      }),
    ]);
    expect(selection.chosen).toEqual([]);
    expect(selection.skipped.map(s => s.code)).toEqual([
      'DUPLICATE_AMBIGUOUS',
      'DUPLICATE_AMBIGUOUS',
    ]);
  });

  it('a copy from "Ohne Musterlösung" is a conflict: both are skipped, even when one is much newer', () => {
    const selection = select([
      file(ucPath(DIR.k5, '5', '5b'), undefined, {
        mtimeMs: BASE_TIME + 90 * 24 * HOUR,
      }),
      file(ucPath(DIR.k5, '5', '5b', 'Ohne Musterlösung')),
    ]);
    expect(selection.chosen).toEqual([]);
    expect(selection.superseded).toEqual([]);
    expect(selection.skipped.map(s => s.code)).toEqual([
      'DUPLICATE_SOLUTION_VARIANT',
      'DUPLICATE_SOLUTION_VARIANT',
    ]);
  });

  it('a lone copy from "Ohne Musterlösung" is chosen (the parser then reports the missing solution)', () => {
    const selection = select([
      file(ucPath(DIR.k5, '5', '5b', 'Ohne Musterlösung')),
    ]);
    expect(selection.chosen).toHaveLength(1);
  });
});

describe('buildUseCasePlan: skips with a reason, nothing is guessed', () => {
  it('skips a file that was not read, a placeholder and a read error', () => {
    const plan = build([
      file(ucPath(DIR.k1, '1', '1a')),
      file(ucPath(DIR.k1, '1', '1b'), undefined, { placeholder: true }),
      file(ucPath(DIR.k6_1, '6.1', '6a'), undefined, {
        readError: 'Timeout\nafter 60000 ms',
      }),
    ]);
    expect(plan.useCases).toEqual([]);
    expect(codesOf(plan).sort()).toEqual([
      'NOT_READ',
      'PLACEHOLDER',
      'READ_ERROR',
    ]);
    expect(
      plan.skipped.find(s => s.code === 'READ_ERROR')?.reason
    ).not.toContain('\n');
  });

  it('skips a file with a format error and names only the codes', () => {
    const plan = build([
      file(
        ucPath(DIR.k1, '1', '1a'),
        useCaseContent('1a', { omit: ['solution', 'objective'] })
      ),
    ]);
    expect(plan.useCases).toEqual([]);
    expect(plan.skipped).toHaveLength(1);
    expect(plan.skipped[0]).toMatchObject({
      code: 'PARSE_ERROR',
      key: 'use-case:1a',
    });
    expect(plan.skipped[0].reason).toBe('Format errors: SECTION_MISSING');
  });

  it('skips a file whose heading names another use case than the path', () => {
    const plan = build([file(ucPath(DIR.k1, '1', '1a'), useCaseContent('1b'))]);
    expect(codesOf(plan)).toEqual(['CODE_MISMATCH']);
  });

  it('accepts a heading without the split of the component (6a for 6.1a)', () => {
    const plan = build([
      file(ucPath(DIR.k6_1, '6.1', '6a'), useCaseContent('6a')),
    ]);
    expect(plan.useCases.map(u => u.code)).toEqual(['K6.1-a']);
  });

  it('skips a use case whose visible text names the model solution', () => {
    const plan = build([
      file(
        ucPath(DIR.k1, '1', '1a'),
        useCaseContent('1a', {
          extraSteps: [plain('Vergleichen Sie mit der Musterlösung.')],
        })
      ),
    ]);
    expect(plan.useCases).toEqual([]);
    expect(plan.skipped[0].code).toBe('SOLUTION_MARKER');
  });

  it('skips a use case whose visible text holds the solution of another one', () => {
    const stolen =
      'Die gesuchte Antwort KAPPA lautet zwölf Schrauben und drei Muttern.';
    const plan = build([
      file(
        ucPath(DIR.k1, '1', '1a'),
        useCaseContent('1a', { bareSolution: stolen })
      ),
      file(
        ucPath(DIR.k1, '1', '1b'),
        useCaseContent('1b', { extraSteps: [plain(stolen)] })
      ),
    ]);
    expect(plan.useCases.map(u => u.code)).toEqual(['K1-a']);
    expect(plan.skipped.map(s => [s.key, s.code])).toEqual([
      ['use-case:K1-b', 'SOLUTION_MARKER'],
    ]);
  });

  it('names a solution paragraph that stands in the visible text of another use case, but keeps both', () => {
    const shared =
      'Ein langer erfundener Absatz, der in der Lösung von eins a steht und bei eins b gefragt wird.';
    const plan = build([
      file(
        ucPath(DIR.k1, '1', '1a'),
        useCaseContent('1a', {
          bareSolution: `Eine kurze erste Zeile.\n${shared}`,
        })
      ),
      file(
        ucPath(DIR.k1, '1', '1b'),
        useCaseContent('1b', { extraSteps: [plain(shared)] })
      ),
    ]);
    expect(plan.useCases.map(u => u.code)).toEqual(['K1-a', 'K1-b']);
    expect(plan.skipped).toEqual([]);
    expect(plan.warnings).toEqual([
      'use-case:K1-b: SOLUTION_TEXT_OF_K1-a_IN_VISIBLE_TEXT',
    ]);
  });

  it('skips two use cases of one component with the same title', () => {
    const same = (code: string) => ({
      heading: `${code}) Gleicher Titel`,
    });
    const plan = build([
      file(ucPath(DIR.k1, '1', '1a'), useCaseContent('1a', same('1a'))),
      file(ucPath(DIR.k1, '1', '1b'), useCaseContent('1b', same('1b'))),
      file(ucPath(DIR.k10, '10', '10a'), useCaseContent('10a', same('10a'))),
    ]);
    expect(plan.useCases.map(u => u.code)).toEqual(['K10-a']);
    expect(codesOf(plan)).toEqual(['TITLE_DUPLICATE', 'TITLE_DUPLICATE']);
  });

  it('carries the warnings of the parser and the open questions', () => {
    const plan = build([
      file(
        ucPath(DIR.k1, '1', '1a'),
        useCaseContent('1a', { omit: ['topics', 'data'] })
      ),
      file(ucPath(DIR.k5, '5', '5b')),
      file(ucPath(DIR.k5, '5', '5b', 'Ohne Musterlösung')),
    ]);
    expect(plan.warnings).toEqual([
      'use-case:1a: DATA_HEADING_MISSING',
      'use-case:1a: SECTION_MISSING',
    ]);
    expect(plan.useCases[0].topics).toBeNull();
    expect(plan.open.join(' ')).toContain('use-case:5b');
    expect(plan.open.join(' ')).toContain('--use-case-solutions');
  });

  it('writes the criteria of a document that has them', () => {
    const plan = build([
      file(
        ucPath(DIR.k1, '1', '1a'),
        useCaseContent('1a', { criteria: 'Erfundenes Kriterium KAPPA.' })
      ),
    ]);
    expect(plan.useCases[0].criteria).toBe('Erfundenes Kriterium KAPPA.');
    expect(countUseCasePlan(plan).withCriteria).toBe(1);
  });
});

describe('validateUseCasePlan', () => {
  const good = () => JSON.parse(JSON.stringify(build())) as UseCasePlan;
  const problems = (mutate: (plan: any) => void) => {
    const plan = good();
    mutate(plan);
    return validateUseCasePlan(plan);
  };

  it('accepts a plan that was written to JSON and read back', () => {
    expect(validateUseCasePlan(good())).toEqual([]);
  });

  it('refuses what is not a plan of this import', () => {
    expect(validateUseCasePlan(null)).toEqual(['The plan is not an object']);
    expect(validateUseCasePlan([])).toEqual(['The plan is not an object']);
    expect(problems(p => (p.version = 2))).toContain(
      'The plan version must be 1'
    );
    expect(problems(p => (p.kind = 'apply'))).toContain(
      'This is not a plan of the use case import'
    );
    expect(problems(p => (p.catalog = 'FIAE'))).toContain(
      'The plan catalog must be KFBM'
    );
    expect(problems(p => delete p.useCases)).toContain('useCases is missing');
    expect(problems(p => delete p.skipped)).toContain('skipped is missing');
  });

  it('refuses a code that does not fit, is used twice or does not follow component and letter', () => {
    expect(problems(p => (p.useCases[0].code = '../x')).join(' ')).toContain(
      'does not fit the code format'
    );
    expect(problems(p => (p.useCases[1].code = p.useCases[0].code))).toEqual(
      expect.arrayContaining(['use case code K1-a is used twice'])
    );
    expect(
      problems(p => (p.useCases[0].enablerCode = 'K1-b')).join(' ')
    ).toContain('must be the component code, a hyphen and the letter');
    expect(
      problems(p => (p.useCases[0].componentCode = 'x1')).join(' ')
    ).toContain('no valid component code');
    expect(problems(p => (p.useCases[0].letter = 'AB')).join(' ')).toContain(
      'no valid letter'
    );
  });

  it('refuses empty texts, a bad position, a bad source and a repeated title', () => {
    expect(problems(p => (p.useCases[0].title = '')).join(' ')).toContain(
      'has no title'
    );
    expect(problems(p => (p.useCases[0].description = '')).join(' ')).toContain(
      'has no description'
    );
    expect(problems(p => (p.useCases[0].solution = '')).join(' ')).toContain(
      'has no solution'
    );
    expect(problems(p => (p.useCases[0].topics = '')).join(' ')).toContain(
      'invalid topics'
    );
    expect(problems(p => (p.useCases[0].criteria = 7)).join(' ')).toContain(
      'invalid criteria'
    );
    expect(problems(p => (p.useCases[0].orderIndex = 0)).join(' ')).toContain(
      'no valid position'
    );
    for (const source of [
      'a\nb',
      'a\\b.docx',
      '../x.docx',
      'a/../../x.docx',
      '/etc/x.docx',
      'C:/x.docx',
      'a'.repeat(501),
    ]) {
      expect(
        problems(p => (p.useCases[0].source = source)).join(' ')
      ).toContain('no valid source path');
    }
    expect(
      problems(p => (p.useCases[1].title = p.useCases[0].title)).join(' ')
    ).toContain('has the title of another use case');
    expect(problems(p => (p.useCases[0] = 5)).join(' ')).toContain(
      'a use case is not an object'
    );
  });

  it('refuses a solution in a visible field', () => {
    expect(
      problems(
        p => (p.useCases[0].description += '\n\nMusterlösung: es sind zwölf')
      ).join(' ')
    ).toContain('solution marker');
    expect(
      problems(p => (p.useCases[0].topics = p.useCases[0].solution)).join(' ')
    ).toContain('use case K1-a topics');
  });
});
