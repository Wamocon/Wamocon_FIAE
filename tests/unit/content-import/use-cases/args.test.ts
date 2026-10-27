import { parseUseCaseArgs } from '@/lib/content-import/use-cases/args';

const UUID = '99999999-0000-4000-8000-000000000001';
const base = ['run', 'C:/source', '--created-by', UUID];

const ok = (argv: string[]) => {
  const parsed = parseUseCaseArgs(argv);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.args;
};
const errors = (argv: string[]) => {
  const parsed = parseUseCaseArgs(argv);
  if (parsed.ok) throw new Error('expected errors');
  return parsed.errors;
};

describe('parseUseCaseArgs: the arguments of the apply script', () => {
  it('plan takes a source folder and no database option', () => {
    const args = ok(['plan', 'C:/source', '--out', 'plan.json']);
    expect(args).toMatchObject({
      command: 'plan',
      source: 'C:/source',
      out: 'plan.json',
      useCaseSolutions: false,
    });
    expect(errors(['plan'])).toContain('plan needs the source folder');
    expect(errors(['plan', 'x', '--target', 'local'])).toContain(
      '--target belongs to check and run'
    );
  });

  it('a run is a dry run unless --apply is given', () => {
    const dry = ok([...base, '--target', 'local']);
    expect(dry.apply).toBe(false);
    expect(dry.target).toBe('local');
    expect(ok([...base, '--target', 'local', '--apply']).apply).toBe(true);
  });

  it('needs a target and a profile', () => {
    expect(errors(base)).toContain('--target local|preview is required');
    expect(errors(['run', 'x', '--target', 'local'])).toContain(
      '--created-by <profile uuid> is required'
    );
  });

  it('refuses production in every spelling', () => {
    for (const argv of [
      [...base, '--target', 'production'],
      [...base, '--target=production'],
      [...base, '--production'],
      ['plan', 'x', '--production'],
    ]) {
      expect(errors(argv).join(' ')).toContain('Production is not supported');
    }
  });

  it('a real run in the Preview needs the confirmed host', () => {
    expect(
      errors([...base, '--target', 'preview', '--apply']).join(' ')
    ).toContain('needs --confirm-host');
    expect(
      ok([
        ...base,
        '--target',
        'preview',
        '--apply',
        '--confirm-host',
        'db.example.test',
      ]).confirmHost
    ).toBe('db.example.test');
  });
});

describe('parseUseCaseArgs: the files that are written', () => {
  it('the plan goes to a .json file and the report to a .md file', () => {
    expect(errors(['plan', 'x', '--out', 'quelle.docx'])).toContain(
      '--out must be a .json file (the summary is written next to it)'
    );
    expect(
      errors([...base, '--target', 'local', '--report-out', 'bericht.json'])
    ).toContain('--report-out must be a .md file');
    expect(ok(['plan', 'x', '--out', 'plan.JSON']).out).toBe('plan.JSON');
    expect(
      ok([...base, '--target', 'local', '--report-out', 'bericht.md']).reportOut
    ).toBe('bericht.md');
  });
});

describe('parseUseCaseArgs: the switch for the solutions', () => {
  it('is off by default and on for a local check or run', () => {
    expect(ok([...base, '--target', 'local']).useCaseSolutions).toBe(false);
    expect(
      ok([...base, '--target', 'local', '--use-case-solutions'])
        .useCaseSolutions
    ).toBe(true);
    expect(
      ok([
        'check',
        'x',
        '--target',
        'local',
        '--created-by',
        UUID,
        '--use-case-solutions',
      ]).useCaseSolutions
    ).toBe(true);
  });

  it('is refused for the Preview, with every spelling of the target', () => {
    for (const target of [['--target', 'preview'], ['--target=preview']]) {
      expect(
        errors([...base, ...target, '--use-case-solutions']).join(' ')
      ).toContain('not allowed for the Preview');
    }
    // also when other errors exist, the Preview refusal is not lost
    expect(
      errors(['run', 'x', '--target', 'preview', '--use-case-solutions']).join(
        ' '
      )
    ).toContain('not allowed for the Preview');
  });

  it('is refused for plan', () => {
    expect(errors(['plan', 'x', '--use-case-solutions'])).toContain(
      '--use-case-solutions belongs to check and run'
    );
  });

  it('knows no switch of the scenarios and no spelling with a value', () => {
    expect(
      errors([...base, '--target', 'local', '--scenario-solutions'])
    ).toEqual(['Unknown argument: --scenario-solutions']);
    expect(
      errors([...base, '--target', 'local', '--use-case-solutions=1'])
    ).toContain('Unknown argument: --use-case-solutions=1');
  });
});
