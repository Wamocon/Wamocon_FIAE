/**
 * @jest-environment node
 */
import { describe, it, expect, jest, afterEach } from '@jest/globals';
import {
  LEVEL_CYCLE,
  PROGRESS_TABLES,
  REPORT_WEEKS,
  checkTarget,
  clearProgress,
  hostOf,
  levelFor,
  loadTrainees,
  parseArgs,
  seedTrainee,
  traineeFolder,
  type Db,
  type Trainee,
} from '../../../scripts/preview/lib/test-progress';
import {
  listTraineeFiles,
  removeTraineeFiles,
} from '../../../scripts/preview/lib/submission-files';

/** A database that records every statement; `route` answers by the text of the query. */
function fakeDb(
  route: (query: string, params?: any[]) => any = () => undefined
) {
  const calls: { query: string; params?: any[] }[] = [];
  const db: Db = {
    unsafe: async (query: string, params?: any[]) => {
      calls.push({ query, params });
      return route(query, params) ?? Object.assign([], { count: 0 });
    },
  };
  return { db, calls };
}

const parse = (argv: string[], command: 'seed' | 'reset' = 'seed') =>
  parseArgs(argv, command);

describe('arguments of the test progress scripts', () => {
  it('needs --target preview and refuses anything else', () => {
    expect(parse([]).ok).toBe(false);
    expect(parse(['--target', 'production']).ok).toBe(false);
    expect(parse(['--target', 'local']).ok).toBe(false);
    expect(parse(['--target', 'preview']).ok).toBe(true);
  });

  it('is a dry run unless --apply is given', () => {
    const r = parse(['--target', 'preview']);
    expect(r.ok && r.options.apply).toBe(false);
    const a = parse(['--target', 'preview', '--apply']);
    expect(a.ok && a.options.apply).toBe(true);
  });

  it('refuses an unknown option, so a typo does not run with defaults', () => {
    expect(parse(['--target', 'preview', '--aply']).ok).toBe(false);
  });

  it('keeps --clear-only and --keep-files for the reset script', () => {
    expect(parse(['--target', 'preview', '--clear-only']).ok).toBe(false);
    expect(parse(['--target', 'preview', '--keep-files']).ok).toBe(false);
    const r = parse(
      ['--target', 'preview', '--clear-only', '--keep-files'],
      'reset'
    );
    expect(r.ok && r.options.clearOnly && r.options.keepFiles).toBe(true);
  });

  it('takes the accounts in lower case and a default connection variable', () => {
    const r = parse(['--target', 'preview', '--email', 'A@x.de, b@x.de']);
    expect(r.ok && r.options.emails).toEqual(['a@x.de', 'b@x.de']);
    expect(r.ok && r.options.dbUrlEnv).toBe('PREVIEW_IMPORT_DB_URL');
  });

  it('takes a level for the chosen accounts and refuses it without accounts or with a wrong name', () => {
    const r = parse([
      '--target',
      'preview',
      '--email',
      'a@x.de',
      '--level',
      'weit',
    ]);
    expect(r.ok && r.options.level).toBe('weit');
    expect(parse(['--target', 'preview', '--email', 'a@x.de']).ok && true).toBe(
      true
    );
    expect(parse(['--target', 'preview', '--level', 'weit']).ok).toBe(false);
    expect(
      parse(['--target', 'preview', '--email', 'a@x.de', '--level', 'riesig'])
        .ok
    ).toBe(false);
    expect(
      parse(['--target', 'preview', '--email', 'a@x.de', '--level']).ok
    ).toBe(false);
  });

  it('refuses a value that is missing or no variable name', () => {
    expect(parse(['--target', 'preview', '--email']).ok).toBe(false);
    expect(parse(['--target', 'preview', '--confirm-host']).ok).toBe(false);
    expect(parse(['--target', 'preview', '--db-url-env', 'a b']).ok).toBe(
      false
    );
  });
});

describe('the target of a run', () => {
  const options = { apply: false, confirmHost: null };

  it('accepts only the migration role of the Preview', () => {
    expect(
      checkTarget({ role: 'app_preview_migrator', dbHost: 'h', options })
    ).toBeNull();
    expect(
      checkTarget({ role: 'app_preview_migrator.abcdef', dbHost: 'h', options })
    ).toBeNull();
    for (const role of [
      'postgres',
      'app_preview',
      'app_previewX',
      'authenticator',
    ]) {
      expect(checkTarget({ role, dbHost: 'h', options })).not.toBeNull();
    }
  });

  it('wants the host of the connection for a real run', () => {
    const role = 'app_preview_migrator';
    expect(
      checkTarget({
        role,
        dbHost: 'h',
        options: { apply: true, confirmHost: null },
      })
    ).not.toBeNull();
    expect(
      checkTarget({
        role,
        dbHost: 'h',
        options: { apply: true, confirmHost: 'other' },
      })
    ).not.toBeNull();
    expect(
      checkTarget({
        role,
        dbHost: 'h',
        options: { apply: true, confirmHost: 'h' },
      })
    ).toBeNull();
  });

  it('reads the host from the connection string', () => {
    expect(hostOf('postgresql://u:p@db.example.com:5432/postgres')).toBe(
      'db.example.com'
    );
    expect(hostOf('not a url')).toBeNull();
  });
});

describe('levels', () => {
  it('hands out the cycle by position and starts again after the end', () => {
    expect(LEVEL_CYCLE.map((_, i) => levelFor(i))).toEqual([...LEVEL_CYCLE]);
    expect(levelFor(LEVEL_CYCLE.length)).toBe(LEVEL_CYCLE[0]);
  });

  it('keeps the level of an account when only some accounts are chosen', async () => {
    const rows = [
      { id: 'a', email: 'a@x.de', organization_id: 'o' },
      { id: 'b', email: 'b@x.de', organization_id: 'o' },
      { id: 'c', email: 'c@x.de', organization_id: 'o' },
    ];
    const all = await loadTrainees(fakeDb(() => rows).db, []);
    const only = await loadTrainees(fakeDb(() => rows).db, ['c@x.de']);
    expect(only).toHaveLength(1);
    expect(only[0].level).toBe(all[2].level);
    expect(only[0].level).toBe(levelFor(2));
  });

  it('gives the chosen accounts the level that was asked for', async () => {
    const rows = [
      { id: 'a', email: 'a@x.de', organization_id: 'o' },
      { id: 'b', email: 'b@x.de', organization_id: 'o' },
    ];
    const set = await loadTrainees(fakeDb(() => rows).db, ['b@x.de'], 'weit');
    expect(set).toHaveLength(1);
    expect(set[0].level).toBe('weit');
    const unchanged = await loadTrainees(fakeDb(() => rows).db, ['b@x.de']);
    expect(unchanged[0].level).toBe(levelFor(1));
  });
});

describe('the reset', () => {
  it('empties the progress tables of the chosen trainees only', async () => {
    const { db, calls } = fakeDb();
    await clearProgress(db, ['t1', 't2']);
    expect(calls).toHaveLength(PROGRESS_TABLES.length);
    for (const call of calls) {
      expect(call.query).toMatch(
        /^delete from public_preview\.[a-z_]+ where (trainee_id|user_id) = any\(\$1::uuid\[\]\)$/
      );
      expect(call.params).toEqual([['t1', 't2']]);
    }
  });

  it('does nothing without trainees', async () => {
    const { db, calls } = fakeDb();
    expect(await clearProgress(db, [])).toEqual({});
    expect(calls).toHaveLength(0);
  });

  it('keeps the setup of the accounts', () => {
    const names = PROGRESS_TABLES.map(t => t.table);
    for (const kept of [
      'profiles',
      'trainee_enrollments',
      'course_members',
      'quiz_assignments',
      'ausbildung_blocks',
      'school_exams',
      'activity_log',
    ]) {
      expect(names).not.toContain(kept);
    }
    expect(new Set(names).size).toBe(names.length);
  });
});

describe('the seed', () => {
  const trainee: Trainee = {
    id: 't1',
    email: 'a@x.de',
    organization_id: 'org1',
    level: 'bereit',
  };
  const cands = [
    { use_case_id: 'u1', k: 1 },
    { use_case_id: 'u2', k: 2 },
    { use_case_id: 'u3', k: 3 },
  ];

  /** What the database knows: how many hand-ins exist, which weeks have a report. */
  const world = (
    opts: {
      useCases?: number;
      enablers?: number;
      weeksWithReport?: number[];
    } = {}
  ) =>
    fakeDb((query, params) => {
      if (query.includes('insert into public_preview.quiz_submissions')) {
        return Object.assign([], { count: 5 });
      }
      if (
        query.includes('count(*) as n from public_preview.use_case_submissions')
      ) {
        return [{ n: String(opts.useCases ?? 0) }];
      }
      if (
        query.includes('count(*) as n from public_preview.enabler_submissions')
      ) {
        return [{ n: String(opts.enablers ?? 0) }];
      }
      if (query.includes('select use_case_id, k')) return cands;
      if (query.includes('select enabler_id, k')) {
        return [{ enabler_id: 'e1', k: 1 }];
      }
      if (query.includes('select 1 from public_preview.activity_reports')) {
        return (opts.weeksWithReport ?? []).includes(params![1])
          ? [{ x: 1 }]
          : [];
      }
      if (query.includes('insert into public_preview.activity_reports')) {
        return [{ id: 'r1' }];
      }
      return undefined;
    });

  it('names the schema in every statement and never touches public', async () => {
    const { db, calls } = world();
    await seedTrainee(db, trainee, 'trainer1');
    expect(calls.length).toBeGreaterThan(8);
    for (const { query } of calls) {
      expect(query).toContain('public_preview.');
      expect(query.replace(/public_preview\./g, '')).not.toMatch(/public\./);
    }
  });

  it('gives the three states in order and a reviewer only to the decided ones', async () => {
    const { db, calls } = world();
    await seedTrainee(db, trainee, 'trainer1');
    const inserts = calls.filter(c =>
      c.query.includes('insert into public_preview.use_case_submissions')
    );
    expect(inserts.map(c => c.params![3])).toEqual([
      'PENDING',
      'REJECTED',
      'APPROVED',
    ]);
    expect(inserts.map(c => c.params![5])).toEqual([
      null,
      'trainer1',
      'trainer1',
    ]);
    expect(inserts[0].params![4]).toBeNull();
  });

  it('adds no hand-ins to a trainee who has three or more already', async () => {
    const { db, calls } = world({ useCases: 4, enablers: 3 });
    const s = await seedTrainee(db, trainee, null);
    expect(s.useCase).toBe(0);
    expect(s.enabler).toBe(0);
    for (const table of ['use_case_submissions', 'enabler_submissions']) {
      expect(
        calls.some(c => c.query.includes(`insert into public_preview.${table}`))
      ).toBe(false);
    }
  });

  it('is repeatable: a second run on a seeded trainee writes nothing', async () => {
    const { db, calls } = fakeDb((query, params) => {
      if (query.includes('count(*) as n')) return [{ n: '3' }];
      if (query.includes('select 1 from public_preview.activity_reports')) {
        return [{ x: 1 }];
      }
      return undefined;
    });
    const s = await seedTrainee(db, trainee, 'trainer1');
    expect(s).toMatchObject({ quiz: 0, useCase: 0, enabler: 0, reports: 0 });
    expect(
      calls.filter(
        c =>
          /^\s*insert into/.test(c.query) ||
          (c.query.includes('with ') && c.query.includes('insert into'))
      )
    ).toHaveLength(1); // only the quiz statement, which skips what exists by itself
  });

  it('creates a report only for a week that has none', async () => {
    const { db, calls } = world({ weeksWithReport: [41, 42] });
    const s = await seedTrainee(db, trainee, 'trainer1');
    expect(s.reports).toBe(1);
    const inserts = calls.filter(c =>
      c.query.includes('insert into public_preview.activity_reports')
    );
    expect(inserts).toHaveLength(1);
    expect(inserts[0].params![1]).toBe(REPORT_WEEKS[2][0]);
    expect(inserts[0].params![3]).toBe('DRAFT');
  });
});

describe('uploaded files', () => {
  afterEach(() => jest.restoreAllMocks());

  it('builds the folder under the Preview prefix', () => {
    expect(traineeFolder('org', 'tr')).toBe('preview/org/tr');
  });

  it('refuses to remove a path outside of the folder of the trainee', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch');
    const access = { url: 'https://s.example', key: 'k' };
    await expect(
      removeTraineeFiles(access, 'org', 'tr', [
        'preview/org/other/uc/file/a.pdf',
      ])
    ).rejects.toThrow('outside');
    await expect(
      removeTraineeFiles(access, 'org', 'tr', ['org/tr/uc/file/a.pdf'])
    ).rejects.toThrow('outside');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('walks the folders and returns only objects', async () => {
    const tree: Record<string, { name: string; id: string | null }[]> = {
      'preview/org/tr': [{ name: 'uc1', id: null }],
      'preview/org/tr/uc1': [
        { name: 'file', id: null },
        { name: 'incoming', id: null },
      ],
      'preview/org/tr/uc1/file': [{ name: '1_a.pdf', id: 'x' }],
      'preview/org/tr/uc1/incoming': [],
    };
    jest.spyOn(globalThis, 'fetch').mockImplementation((async (
      _u: unknown,
      init: { body: string }
    ) => {
      const prefix = JSON.parse(init.body).prefix as string;
      return {
        ok: true,
        status: 200,
        json: async () => tree[prefix] ?? [],
      } as Response;
    }) as any);
    const files = await listTraineeFiles(
      { url: 'https://s.example', key: 'k' },
      'org',
      'tr'
    );
    expect(files).toEqual(['preview/org/tr/uc1/file/1_a.pdf']);
  });
});
