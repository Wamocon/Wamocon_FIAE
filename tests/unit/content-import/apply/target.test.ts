import {
  parseConnectionString,
  checkConfirmHost,
  checkTargetFacts,
  checkTargetHost,
  connectionHost,
  isLoopbackHost,
  parseApplyArgs,
} from '@/lib/content-import/apply/target';

const PROFILE = '11111111-2222-4333-8444-555555555555';
const ok = (argv: string[]) => {
  const result = parseApplyArgs(argv);
  if (!result.ok) throw new Error(result.errors.join('; '));
  return result.args;
};
const errors = (argv: string[]) => {
  const result = parseApplyArgs(argv);
  return result.ok ? [] : result.errors;
};

describe('parseApplyArgs', () => {
  it('needs a command', () => {
    expect(errors([])).toHaveLength(1);
    expect(errors(['apply'])[0]).toMatch(/plan, check or run/);
  });

  it('plan takes a source folder and writes nothing else', () => {
    const args = ok([
      'plan',
      'C:/src/Komponente',
      '--out',
      'plan.json',
      '--components',
      'k1,K6.2',
      '--hydrate',
      '--timeout',
      '30',
    ]);
    expect(args).toMatchObject({
      command: 'plan',
      source: 'C:/src/Komponente',
      out: 'plan.json',
      components: ['K1', 'K6.2'],
      hydrate: true,
      timeoutSeconds: 30,
      target: null,
      apply: false,
    });
    expect(errors(['plan'])[0]).toMatch(/source folder/);
    expect(errors(['plan', 'x', '--target', 'local'])).toContain(
      '--target belongs to check and run'
    );
  });

  it('check and run need a target and a profile', () => {
    for (const command of ['check', 'run']) {
      expect(errors([command, '--plan', 'p.json']).join(' ')).toMatch(
        /--target local\|preview is required/
      );
      expect(
        errors([command, '--plan', 'p.json', '--target', 'local']).join(' ')
      ).toMatch(/--created-by/);
      expect(
        errors([
          command,
          '--plan',
          'p.json',
          '--target',
          'local',
          '--created-by',
          'nobody',
        ]).join(' ')
      ).toMatch(/uuid/);
    }
  });

  it('is a dry run by default and a real run only with --apply', () => {
    const dry = ok([
      'run',
      '--plan',
      'p.json',
      '--target',
      'local',
      '--created-by',
      PROFILE,
    ]);
    expect(dry.apply).toBe(false);
    expect(dry.updateExisting).toBe(false);
    const real = ok([
      'run',
      '--plan',
      'p.json',
      '--target',
      'local',
      '--created-by',
      PROFILE.toUpperCase(),
      '--apply',
      '--update-existing',
    ]);
    expect(real.apply).toBe(true);
    expect(real.updateExisting).toBe(true);
    expect(real.createdBy).toBe(PROFILE);
  });

  it('refuses production in every spelling, with every switch', () => {
    const base = ['run', '--plan', 'p.json', '--created-by', PROFILE];
    for (const target of ['production', 'Production', 'prod-production']) {
      expect(errors([...base, '--target', target]).join(' ')).toMatch(
        /Production is not supported/
      );
    }
    expect(
      errors([...base, '--target=production', '--apply']).join(' ')
    ).toMatch(/Production is not supported/);
    expect(
      errors([
        ...base,
        '--target',
        'local',
        '--confirm-production',
        'db.example.com',
      ]).join(' ')
    ).toMatch(/Production is not supported/);
    expect(
      errors([...base, '--target', 'local', '--production']).join(' ')
    ).toMatch(/Production is not supported/);
    expect(errors([...base, '--target', 'staging']).join(' ')).toMatch(
      /local or preview/
    );
  });

  it('keeps the writing switches away from plan and check', () => {
    const base = ['check', '--plan', 'p.json', '--target', 'local'];
    const withProfile = [...base, '--created-by', PROFILE];
    expect(errors([...withProfile, '--apply'])).toContain(
      '--apply belongs to run'
    );
    expect(errors([...withProfile, '--update-existing'])).toContain(
      '--update-existing belongs to run'
    );
    expect(errors(['plan', 'x', '--apply'])).toContain(
      '--apply belongs to run'
    );
  });

  it('wants the source folder or a plan file, not both and not none', () => {
    const tail = ['--target', 'local', '--created-by', PROFILE];
    expect(errors(['check', ...tail]).join(' ')).toMatch(/source folder or/);
    expect(
      errors(['check', 'src', '--plan', 'p.json', ...tail]).join(' ')
    ).toMatch(/not both/);
    expect(ok(['check', 'src', ...tail]).source).toBe('src');
  });

  it('a real run in the Preview names the host of the connection', () => {
    const base = [
      'run',
      '--plan',
      'p.json',
      '--target',
      'preview',
      '--created-by',
      PROFILE,
      '--apply',
    ];
    expect(errors(base).join(' ')).toMatch(/--confirm-host/);
    const args = ok([...base, '--confirm-host', 'DB.Example.com']);
    expect(args.confirmHost).toBe('db.example.com');
    // the confirmation is only for a real run in the Preview
    expect(
      errors([
        'run',
        '--plan',
        'p.json',
        '--target',
        'preview',
        '--created-by',
        PROFILE,
        '--confirm-host',
        'x',
      ]).join(' ')
    ).toMatch(/only belongs to/);
    expect(
      errors([
        'run',
        '--plan',
        'p.json',
        '--target',
        'local',
        '--created-by',
        PROFILE,
        '--apply',
        '--confirm-host',
        'x',
      ]).join(' ')
    ).toMatch(/only belongs to/);
  });

  it('rejects unknown arguments, repeated and empty values and bad component codes', () => {
    expect(errors(['plan', 'x', '--bogus'])).toContain(
      'Unknown argument: --bogus'
    );
    expect(errors(['plan', 'x', '--out', 'a', '--out', 'b'])).toContain(
      '--out is given twice'
    );
    expect(errors(['plan', 'x', '--out'])).toContain('--out needs a value');
    expect(errors(['plan', 'x', '--components', 'K1,banana'])[0]).toMatch(
      /invalid component/
    );
    expect(errors(['plan', 'x', '--timeout', '0'])[0]).toMatch(/seconds/);
    expect(errors(['plan', 'a', 'b'])[0]).toMatch(/Only one source folder/);
  });
});

describe('connection checks', () => {
  const facts = (
    over: Partial<Parameters<typeof checkTargetFacts>[1]> = {}
  ) => ({
    host: '127.0.0.1',
    currentSchema: 'public',
    resolvedSchema: 'public',
    currentUser: 'postgres',
    ...over,
  });

  it('reads the host and recognizes loopback', () => {
    expect(connectionHost('postgresql://u:secret@Example.COM:5432/db')).toBe(
      'example.com'
    );
    expect(connectionHost('not a url')).toBeNull();
    for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    expect(isLoopbackHost('db.example.com')).toBe(false);
    expect(isLoopbackHost(null)).toBe(false);
  });

  it('local accepts a loopback host with the schema public only', () => {
    expect(checkTargetFacts('local', facts())).toEqual([]);
    expect(checkTargetHost('local', 'db.example.com')[0]).toMatch(
      /needs a loopback host/
    );
    expect(
      checkTargetFacts('local', facts({ host: 'db.example.com' }))[0]
    ).toMatch(/needs a loopback host/);
    expect(
      checkTargetFacts('local', facts({ currentSchema: 'public_preview' }))[0]
    ).toMatch(/expects the schema public/);
    expect(
      checkTargetFacts('local', facts({ resolvedSchema: 'public_preview' }))[0]
    ).toMatch(/resolve to the schema public_preview/);
  });

  it('preview needs the Preview schema, a Preview role and a hosted database', () => {
    const preview = facts({
      host: 'aws-0-eu.pooler.example.com',
      currentSchema: 'public_preview',
      resolvedSchema: 'public_preview',
      currentUser: 'app_preview',
    });
    expect(checkTargetFacts('preview', preview)).toEqual([]);
    expect(
      checkTargetFacts('preview', {
        ...preview,
        currentUser: 'app_preview_migrator',
      })
    ).toEqual([]);
    expect(
      checkTargetFacts('preview', { ...preview, currentUser: 'postgres' })[0]
    ).toMatch(/Preview role/);
    expect(
      checkTargetFacts('preview', { ...preview, resolvedSchema: 'public' })[0]
    ).toMatch(/resolve to the schema public/);
    expect(checkTargetHost('preview', '127.0.0.1')[0]).toMatch(/loopback host/);
  });

  it('refuses a hosted connection to the schema public as production', () => {
    const production = facts({
      host: 'db.example.com',
      currentSchema: 'public',
      resolvedSchema: 'public',
      currentUser: 'postgres',
    });
    const problems = checkTargetFacts('preview', production);
    expect(problems.join(' ')).toMatch(/looks like production/);
    // with a Preview role name as well, the schema still stops it
    expect(
      checkTargetFacts('preview', {
        ...production,
        currentUser: 'app_preview',
      }).join(' ')
    ).toMatch(/looks like production/);
    expect(checkTargetFacts('local', production)[0]).toMatch(/loopback/);
  });

  it('stops on unknown facts and on a missing target', () => {
    expect(checkTargetFacts('local', facts({ currentUser: null }))[0]).toMatch(
      /unknown/
    );
    expect(checkTargetFacts('local', facts({ host: null }))[0]).toMatch(
      /cannot be read/
    );
    expect(checkTargetHost(null, '127.0.0.1')[0]).toMatch(/required/);
  });

  it('a real run in the Preview must name the host', () => {
    expect(
      checkConfirmHost(
        { apply: true, target: 'preview', confirmHost: 'a.example.com' },
        'b.example.com'
      )[0]
    ).toMatch(/must name the host/);
    expect(
      checkConfirmHost(
        { apply: true, target: 'preview', confirmHost: 'a.example.com' },
        'a.example.com'
      )
    ).toEqual([]);
    expect(
      checkConfirmHost(
        { apply: false, target: 'preview', confirmHost: null },
        'a'
      )
    ).toEqual([]);
    expect(
      checkConfirmHost(
        { apply: true, target: 'local', confirmHost: null },
        '127.0.0.1'
      )
    ).toEqual([]);
  });
});

describe('parseConnectionString', () => {
  it('reads the fields and decodes the password', () => {
    const result = parseConnectionString(
      'postgresql://app:p%40ss%3Aword@Example.COM:6543/postgres?sslmode=require'
    );
    expect(result).toEqual({
      ok: true,
      connection: {
        host: 'example.com',
        port: 6543,
        user: 'app',
        password: 'p@ss:word',
        database: 'postgres',
        sslmode: 'require',
      },
    });
  });

  it('refuses every parameter that could change the host or the role', () => {
    for (const query of [
      'host=remote.example.invalid',
      'hostaddr=10.0.0.1',
      'options=-c%20search_path%3Dpublic',
      'user=postgres',
      'port=1',
      'dbname=x',
      'sslmode=disable&host=remote.example.invalid',
    ]) {
      const result = parseConnectionString(
        `postgresql://u:p@localhost:5432/postgres?${query}`
      );
      expect(result.ok).toBe(false);
    }
  });

  it('refuses a string with several hosts, no host, a wrong scheme or an unknown sslmode', () => {
    for (const bad of [
      'postgresql://u:p@a.example.com,b.example.com/db',
      'postgresql:///db',
      'mysql://u:p@localhost/db',
      'not a url',
      'postgresql://u:p@localhost/db?sslmode=maybe',
    ]) {
      expect(parseConnectionString(bad).ok).toBe(false);
    }
  });
});

describe('more connection facts', () => {
  const facts = {
    host: '127.0.0.1',
    currentSchema: 'public',
    resolvedSchema: 'public',
    currentUser: 'postgres',
  };

  it('local refuses a database that carries the Preview schemas or roles', () => {
    expect(
      checkTargetFacts('local', { ...facts, hasPreviewMarkers: true })[0]
    ).toMatch(/Preview schemas or roles/);
    expect(
      checkTargetFacts('local', { ...facts, hasPreviewMarkers: false })
    ).toEqual([]);
  });

  it('refuses a switched role', () => {
    expect(
      checkTargetFacts('local', { ...facts, sessionUser: 'someone' })[0]
    ).toMatch(/role was switched/);
  });
});

describe('--scenario-solutions', () => {
  const base = ['run', '--plan', 'p.json', '--created-by', PROFILE];
  it('is allowed for local, refused for the Preview and for plan', () => {
    expect(
      ok([...base, '--target', 'local', '--scenario-solutions'])
        .scenarioSolutions
    ).toBe(true);
    expect(ok([...base, '--target', 'local']).scenarioSolutions).toBe(false);
    expect(
      errors([...base, '--target', 'preview', '--scenario-solutions']).join(' ')
    ).toMatch(/not allowed for the Preview/);
    expect(errors(['plan', 'x', '--scenario-solutions'])).toContain(
      '--scenario-solutions belongs to check and run'
    );
  });
});
