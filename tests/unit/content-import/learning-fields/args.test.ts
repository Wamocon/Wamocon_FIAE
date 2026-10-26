import { parseLearningFieldArgs } from '@/lib/content-import/learning-fields/args';

const ok = (argv: string[]) => {
  const result = parseLearningFieldArgs(argv);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.args;
};
const errors = (argv: string[]) => {
  const result = parseLearningFieldArgs(argv);
  return result.ok ? [] : result.errors;
};

describe('parseLearningFieldArgs: plan', () => {
  it('needs the table and one source of the import codes', () => {
    expect(
      ok(['plan', 'mapping.xlsx', '--import-plan', 'kfbm-plan.json'])
    ).toMatchObject({
      command: 'plan',
      excel: 'mapping.xlsx',
      importPlan: 'kfbm-plan.json',
      importSource: null,
      titles: null,
      out: null,
      target: null,
      apply: false,
    });
    expect(
      ok([
        'plan',
        'mapping.xlsx',
        '--import-source',
        'Komponente',
        '--titles',
        'titel.json',
        '--decisions',
        'd.json',
        '--out',
        'plan.json',
      ])
    ).toMatchObject({
      importSource: 'Komponente',
      titles: 'titel.json',
      decisions: 'd.json',
      out: 'plan.json',
    });
    expect(errors(['plan'])).toEqual([
      'plan needs the mapping table (an .xlsx file)',
      'plan needs --import-plan <apply plan> or --import-source <source folder>',
    ]);
    expect(
      errors(['plan', 'a.xlsx', '--import-plan', 'p', '--import-source', 'f'])
    ).toEqual(['Give either --import-plan or --import-source, not both']);
    expect(errors(['plan', 'a.xlsx', 'b.xlsx', '--import-plan', 'p'])).toEqual([
      'Only one mapping table may be given',
    ]);
  });

  it('needs a .json file for --out', () => {
    expect(
      errors(['plan', 'a.xlsx', '--import-plan', 'p', '--out', 'plan.md'])
    ).toEqual([
      '--out must be a .json file (the summary is written next to it)',
    ]);
  });

  it('keeps the options of the database commands out of plan', () => {
    const e = errors([
      'plan',
      'a.xlsx',
      '--import-plan',
      'p',
      '--plan',
      'x',
      '--target',
      'local',
      '--confirm-host',
      'h',
      '--report-out',
      'r',
      '--apply',
      '--update-existing',
    ]);
    expect(e).toEqual([
      '--plan belongs to check and run',
      '--target belongs to check and run',
      '--confirm-host belongs to check and run',
      '--report-out belongs to check and run',
      '--apply belongs to run',
      '--update-existing belongs to run',
    ]);
  });
});

describe('parseLearningFieldArgs: check and run', () => {
  it('default to no apply, need a plan and a target', () => {
    expect(ok(['run', '--plan', 'lf.json', '--target', 'local'])).toMatchObject(
      {
        command: 'run',
        plan: 'lf.json',
        target: 'local',
        apply: false,
        updateExisting: false,
      }
    );
    expect(ok(['check', '--plan=lf.json', '--target=local'])).toMatchObject({
      command: 'check',
      plan: 'lf.json',
    });
    expect(errors(['run', '--target', 'local'])).toEqual([
      'check and run need --plan <learning field plan>',
    ]);
    expect(errors(['run', '--plan', 'p'])).toEqual([
      '--target local|preview is required',
    ]);
    expect(
      errors(['run', 'a.xlsx', '--plan', 'p', '--target', 'local'])
    ).toEqual([
      'check and run take the plan file, not the table (run plan first)',
    ]);
  });

  it('accepts --apply and --update-existing only for run', () => {
    expect(
      ok([
        'run',
        '--plan',
        'p',
        '--target',
        'local',
        '--apply',
        '--update-existing',
      ])
    ).toMatchObject({ apply: true, updateExisting: true });
    expect(
      errors(['check', '--plan', 'p', '--target', 'local', '--apply'])
    ).toEqual(['--apply belongs to run']);
    expect(
      errors(['check', '--plan', 'p', '--target', 'local', '--update-existing'])
    ).toEqual(['--update-existing belongs to run']);
  });

  it('keeps the options of plan out of check and run', () => {
    expect(
      errors([
        'run',
        '--plan',
        'p',
        '--target',
        'local',
        '--out',
        'o',
        '--import-plan',
        'i',
        '--import-source',
        's',
        '--titles',
        't',
        '--decisions',
        'd',
      ])
    ).toEqual([
      '--out belongs to plan',
      '--import-plan belongs to plan',
      '--import-source belongs to plan',
      '--titles belongs to plan',
      '--decisions belongs to plan',
    ]);
  });

  it('needs --confirm-host for a real run in the Preview and nowhere else', () => {
    expect(
      errors(['run', '--plan', 'p', '--target', 'preview', '--apply'])
    ).toEqual([
      'A real run against the Preview needs --confirm-host <host of the connection>',
    ]);
    expect(
      ok([
        'run',
        '--plan',
        'p',
        '--target',
        'preview',
        '--apply',
        '--confirm-host',
        'DB.Example.COM',
      ])
    ).toMatchObject({ confirmHost: 'db.example.com', target: 'preview' });
    expect(
      errors([
        'run',
        '--plan',
        'p',
        '--target',
        'preview',
        '--confirm-host',
        'h',
      ])
    ).toEqual([
      '--confirm-host only belongs to run --apply with --target preview',
    ]);
    expect(
      errors([
        'run',
        '--plan',
        'p',
        '--target',
        'local',
        '--apply',
        '--confirm-host',
        'h',
      ])
    ).toEqual([
      '--confirm-host only belongs to run --apply with --target preview',
    ]);
  });
});

describe('parseLearningFieldArgs: refusals', () => {
  it('refuses production in every form', () => {
    for (const argv of [
      ['run', '--plan', 'p', '--target', 'production'],
      ['run', '--plan', 'p', '--target=production', '--apply'],
      ['run', '--plan', 'p', '--target', 'local', '--confirm-production', 'x'],
      ['check', '--production', '--plan', 'p', '--target', 'local'],
    ]) {
      expect(errors(argv)).toEqual([
        'Production is not supported by this script (no target, no switch). An apply to production needs the Go of the owner and the rollout (KFBM_ROLLOUT_APPROVED) and is not planned.',
      ]);
    }
  });

  it('refuses a wrong command, unknown arguments, missing and repeated values', () => {
    expect(errors([])).toEqual([
      'The first argument must be plan, check or run',
    ]);
    expect(errors(['apply'])).toEqual([
      'The first argument must be plan, check or run',
    ]);
    expect(
      errors(['check', '--plan', 'p', '--target', 'local', '--wat'])
    ).toEqual(['Unknown argument: --wat']);
    expect(errors(['check', '--plan', '--target', 'local'])).toContain(
      '--plan needs a value'
    );
    expect(
      errors(['check', '--plan', 'a', '--plan', 'b', '--target', 'local'])
    ).toEqual(['--plan is given twice']);
    expect(errors(['check', '--plan', 'p', '--target', 'staging'])).toEqual([
      '--target must be local or preview',
    ]);
    expect(
      errors(['check', '--plan', 'p', '--target', 'local', '--apply=1'])
    ).toEqual(['Unknown argument: --apply=1']);
  });

  it('explains that this script has no author', () => {
    expect(
      errors(['run', '--plan', 'p', '--target', 'local', '--created-by', 'x'])
    ).toEqual([
      '--created-by is not used here (learning fields have no author column)',
    ]);
  });
});
