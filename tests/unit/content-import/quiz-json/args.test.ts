import { parseApplyArgs } from '@/lib/content-import/apply/target';
import { parseUseCaseArgs } from '@/lib/content-import/use-cases/args';

const PROFILE = '11111111-2222-4333-8444-555555555555';
const ok = (argv: string[]) => {
  const result = parseApplyArgs(argv, { quizJson: true });
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.args;
};
const errors = (argv: string[]) => {
  const result = parseApplyArgs(argv, { quizJson: true });
  return result.ok ? [] : result.errors;
};

describe('quiz JSON options of the apply script', () => {
  it('plan works with a JSON file alone, with both files and with the Word tree', () => {
    expect(
      ok([
        'plan',
        '--quizzes-json',
        'a.json',
        '--global-quizzes-json',
        'g.json',
      ])
    ).toMatchObject({
      command: 'plan',
      source: null,
      quizzesJson: 'a.json',
      globalQuizzesJson: 'g.json',
      preferJsonQuizzes: false,
    });
    expect(ok(['plan', 'Komponente', '--quizzes-json=a.json'])).toMatchObject({
      source: 'Komponente',
      quizzesJson: 'a.json',
      globalQuizzesJson: null,
    });
    expect(
      ok([
        'plan',
        'Komponente',
        '--quizzes-json',
        'a.json',
        '--prefer-json-quizzes',
      ]).preferJsonQuizzes
    ).toBe(true);
    expect(errors(['plan'])[0]).toMatch(/source folder or a quiz JSON/);
  });

  it('check and run take the JSON files instead of the folder or the plan', () => {
    const tail = ['--target', 'local', '--created-by', PROFILE];
    for (const command of ['check', 'run']) {
      expect(
        ok([command, '--quizzes-json', 'a.json', ...tail]).quizzesJson
      ).toBe('a.json');
      expect(errors([command, ...tail]).join(' ')).toMatch(/quiz JSON file/);
      expect(
        errors([
          command,
          '--plan',
          'p.json',
          '--quizzes-json',
          'a.json',
          ...tail,
        ]).join(' ')
      ).toMatch(/either --plan or the quiz JSON/);
    }
  });

  it('the files must be .json files and the switch needs both sources', () => {
    expect(errors(['plan', '--quizzes-json', 'a.txt'])).toContain(
      '--quizzes-json must name a .json file'
    );
    expect(errors(['plan', '--global-quizzes-json', 'g'])).toContain(
      '--global-quizzes-json must name a .json file'
    );
    expect(
      errors(['plan', '--quizzes-json', 'a.json', '--prefer-json-quizzes'])
    ).toContain(
      '--prefer-json-quizzes needs the source folder and a quiz JSON file'
    );
    expect(errors(['plan', 'Komponente', '--prefer-json-quizzes'])).toContain(
      '--prefer-json-quizzes needs the source folder and a quiz JSON file'
    );
  });

  it('--hydrate and --no-attributes need the folder', () => {
    expect(errors(['plan', '--quizzes-json', 'a.json', '--hydrate'])).toContain(
      '--hydrate only works together with the source folder'
    );
  });

  it('production stays refused', () => {
    expect(
      errors([
        'run',
        '--quizzes-json',
        'a.json',
        '--target',
        'production',
        '--created-by',
        PROFILE,
      ]).join(' ')
    ).toMatch(/Production is not supported/);
  });
});

describe('check-quizzes', () => {
  it('needs a JSON file and takes nothing of the database run', () => {
    expect(
      ok(['check-quizzes', '--global-quizzes-json', 'g.json'])
    ).toMatchObject({
      command: 'check-quizzes',
      target: null,
      globalQuizzesJson: 'g.json',
    });
    expect(
      ok(['check-quizzes', '--quizzes-json', 'a.json', '--report-out', 'r.md'])
        .reportOut
    ).toBe('r.md');
    expect(errors(['check-quizzes'])[0]).toMatch(/needs --quizzes-json/);
    const bad = errors([
      'check-quizzes',
      'Komponente',
      '--quizzes-json',
      'a.json',
      '--target',
      'local',
      '--apply',
      '--created-by',
      PROFILE,
      '--plan',
      'p.json',
    ]).join(' | ');
    for (const part of [
      'takes no source folder',
      '--target does not belong to check-quizzes',
      '--apply does not belong to check-quizzes',
      '--created-by does not belong to check-quizzes',
      '--plan does not belong to check-quizzes',
    ]) {
      expect(bad).toContain(part);
    }
  });
});

describe('the other import scripts do not get the options', () => {
  it('the default parse refuses the command and the options', () => {
    const plain = parseApplyArgs(['check-quizzes', '--quizzes-json', 'a.json']);
    expect(plain.ok).toBe(false);
    const option = parseApplyArgs(['plan', 'x', '--quizzes-json', 'a.json']);
    expect(option.ok ? [] : option.errors).toContain(
      'Unknown argument: --quizzes-json'
    );
    const flag = parseApplyArgs(['plan', 'x', '--prefer-json-quizzes']);
    expect(flag.ok ? [] : flag.errors).toContain(
      'Unknown argument: --prefer-json-quizzes'
    );
    const useCases = parseUseCaseArgs([
      'plan',
      'x',
      '--quizzes-json',
      'a.json',
    ]);
    expect(useCases.ok).toBe(false);
    const plainArgs = parseApplyArgs(['plan', 'x']);
    expect(plainArgs.ok && plainArgs.args).toMatchObject({
      quizzesJson: null,
      globalQuizzesJson: null,
      preferJsonQuizzes: false,
    });
  });
});

describe('--extend-quizzes', () => {
  const tail = ['--target', 'local', '--created-by', PROFILE];
  it('is a switch of check and run, off by default', () => {
    for (const command of ['check', 'run']) {
      expect(ok([command, '--plan', 'p.json', ...tail]).extendQuizzes).toBe(
        false
      );
      expect(
        ok([command, '--plan', 'p.json', '--extend-quizzes', ...tail])
          .extendQuizzes
      ).toBe(true);
    }
    expect(errors(['plan', 'x', '--extend-quizzes'])).toContain(
      '--extend-quizzes belongs to check and run'
    );
    expect(
      errors(['check-quizzes', '--quizzes-json', 'a.json', '--extend-quizzes'])
    ).toContain('--extend-quizzes belongs to check and run');
  });

  it('does not exist in the other import scripts', () => {
    const plain = parseApplyArgs([
      'run',
      '--plan',
      'p.json',
      '--extend-quizzes',
      ...tail,
    ]);
    expect(plain.ok ? [] : plain.errors).toContain(
      'Unknown argument: --extend-quizzes'
    );
  });
});
