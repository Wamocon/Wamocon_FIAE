/**
 * @jest-environment node
 */
import { describe, it, expect } from '@jest/globals';
import {
  ChunkPlan,
  checkTargetAgainstConnection,
  connectionHost,
  isLoopbackHost,
  parseReindexArgs,
  type ReindexOptions,
} from '@/lib/hai/reindexArgs';

// Argument and target protection of scripts/reindex-gemini.ts: pure functions,
// no database access.

function parse(...argv: string[]) {
  return parseReindexArgs(argv);
}

function ok(...argv: string[]): ReindexOptions {
  const parsed = parse(...argv);
  if (!parsed.ok) throw new Error(parsed.errors.join('; '));
  return parsed.options;
}

function errors(...argv: string[]): string[] {
  const parsed = parse(...argv);
  if (parsed.ok) throw new Error('expected errors');
  return parsed.errors;
}

describe('parseReindexArgs: dry run is the default', () => {
  it('is a dry run without --apply', () => {
    const options = ok('--target', 'local');
    expect(options.apply).toBe(false);
    expect(options.catalogCode).toBeNull();
    expect(options.purge).toBe(false);
  });

  it('writes only with --apply', () => {
    expect(ok('--target', 'preview', '--apply').apply).toBe(true);
  });

  it('does not accept --apply together with --dry-run', () => {
    expect(errors('--target', 'local', '--apply', '--dry-run')).toEqual([
      '--apply and --dry-run exclude each other',
    ]);
    expect(ok('--target', 'local', '--dry-run').apply).toBe(false);
  });
});

describe('parseReindexArgs: --target', () => {
  it('is required for every run', () => {
    expect(errors()).toEqual(['--target preview|production|local is required']);
    expect(errors('--apply')[0]).toMatch(/--target/);
  });

  it('accepts preview, local and production (with its confirmation)', () => {
    expect(ok('--target', 'preview').target).toBe('preview');
    expect(ok('--target=local').target).toBe('local');
    expect(
      ok('--target', 'production', '--confirm-production', 'db.example.co')
        .target
    ).toBe('production');
  });

  it('refuses any other target and a missing value', () => {
    expect(errors('--target', 'staging')).toEqual([
      '--target must be preview, production or local',
    ]);
    expect(errors('--target')).toEqual(['--target needs a value']);
    expect(errors('--target', '--apply')).toEqual(['--target needs a value']);
  });

  it('refuses production without --confirm-production', () => {
    expect(errors('--target', 'production', '--apply')).toEqual([
      'Production is refused without --confirm-production <host> (and an approved rollout gate)',
    ]);
  });

  it('refuses --confirm-production for another target', () => {
    expect(errors('--target', 'preview', '--confirm-production', 'x')).toEqual([
      '--confirm-production only belongs to --target production',
    ]);
    expect(errors('--confirm-production', 'x')).toContain(
      '--confirm-production only belongs to --target production'
    );
  });
});

describe('parseReindexArgs: --catalog and the purges', () => {
  it('reads the catalog code in upper case', () => {
    expect(ok('--target', 'local', '--catalog', 'kfbm').catalogCode).toBe(
      'KFBM'
    );
    expect(ok('--target', 'local', '--catalog=FIAE').catalogCode).toBe('FIAE');
  });

  it('refuses a missing or malformed catalog code', () => {
    expect(errors('--target', 'local', '--catalog')).toEqual([
      '--catalog needs a value',
    ]);
    expect(errors('--target', 'local', '--catalog', 'a b; drop')).toEqual([
      '--catalog needs a catalog code such as FIAE or KFBM',
    ]);
  });

  it('allows --purge only together with --catalog', () => {
    const message = '--purge and --purge-stale are only allowed with --catalog';
    expect(errors('--target', 'local', '--purge', '--apply')).toEqual([
      message,
    ]);
    expect(errors('--target', 'local', '--purge-stale')).toEqual([message]);
    const options = ok(
      '--target',
      'local',
      '--catalog',
      'KFBM',
      '--purge',
      '--apply'
    );
    expect(options.purge).toBe(true);
    expect(options.catalogCode).toBe('KFBM');
    expect(
      ok('--target', 'local', '--catalog', 'KFBM', '--purge-stale').purgeStale
    ).toBe(true);
  });

  it('keeps the other flags', () => {
    const options = ok('--target', 'local', '--force', '--pdfs-only');
    expect(options.force).toBe(true);
    expect(options.pdfsOnly).toBe(true);
  });

  it('refuses --purge together with --pdfs-only', () => {
    expect(
      errors('--target', 'local', '--catalog', 'KFBM', '--purge', '--pdfs-only')
    ).toEqual(['--purge cannot be combined with --pdfs-only']);
  });

  it('refuses a value option that is given twice', () => {
    expect(errors('--target', 'local', '--target', 'production')).toEqual([
      '--target is given twice',
    ]);
    expect(
      errors('--target', 'local', '--catalog', 'FIAE', '--catalog', 'KFBM')
    ).toEqual(['--catalog is given twice']);
  });

  it('refuses unknown arguments (a typo must not start a run)', () => {
    expect(errors('--target', 'local', '--aply')).toEqual([
      'Unknown argument: --aply',
    ]);
    expect(errors('--target', 'local', 'purge')).toEqual([
      'Unknown argument: purge',
    ]);
    expect(errors('--target', 'local', '--apply=yes')).toEqual([
      'Unknown argument: --apply=yes',
    ]);
  });
});

describe('connectionHost and isLoopbackHost', () => {
  it('reads the host of a connection string', () => {
    expect(connectionHost('postgresql://u:p@127.0.0.1:54329/postgres')).toBe(
      '127.0.0.1'
    );
    expect(connectionHost('postgres://u:p@db.example.co:5432/x')).toBe(
      'db.example.co'
    );
    expect(connectionHost('not a url')).toBeNull();
  });

  it('knows the loopback hosts', () => {
    for (const host of ['localhost', '127.0.0.1', '::1', '[::1]']) {
      expect(isLoopbackHost(host)).toBe(true);
    }
    expect(isLoopbackHost('db.example.co')).toBe(false);
    expect(isLoopbackHost(null)).toBe(false);
  });
});

describe('checkTargetAgainstConnection', () => {
  const local = {
    host: '127.0.0.1',
    currentSchema: 'public',
    currentUser: 'postgres',
  };
  const preview = {
    host: 'db.example.co',
    currentSchema: 'public_preview',
    currentUser: 'app_preview_migrator',
  };
  const production = {
    host: 'db.example.co',
    currentSchema: 'public',
    currentUser: 'postgres',
  };

  it('accepts a target that fits the connection', () => {
    expect(
      checkTargetAgainstConnection(
        { target: 'local', confirmProductionHost: null },
        local,
        {}
      )
    ).toEqual([]);
    expect(
      checkTargetAgainstConnection(
        { target: 'preview', confirmProductionHost: null },
        preview,
        {}
      )
    ).toEqual([]);
    expect(
      checkTargetAgainstConnection(
        { target: 'production', confirmProductionHost: 'db.example.co' },
        production,
        { KFBM_ROLLOUT_APPROVED: 'true' }
      )
    ).toEqual([]);
  });

  it('refuses --target local on a remote host', () => {
    const problems = checkTargetAgainstConnection(
      { target: 'local', confirmProductionHost: null },
      production,
      {}
    );
    expect(problems.join(' ')).toMatch(/loopback host/);
  });

  it('refuses --target preview on the public schema or with a production role', () => {
    const onPublic = checkTargetAgainstConnection(
      { target: 'preview', confirmProductionHost: null },
      production,
      {}
    );
    expect(onPublic.join(' ')).toMatch(/schema public_preview/);
    expect(onPublic.join(' ')).toMatch(/Preview role/);
  });

  it('refuses --target production for a Preview connection', () => {
    const problems = checkTargetAgainstConnection(
      { target: 'production', confirmProductionHost: 'db.example.co' },
      preview,
      { KFBM_ROLLOUT_APPROVED: 'true' }
    );
    expect(problems.join(' ')).toMatch(/schema public/);
    expect(problems.join(' ')).toMatch(/is a Preview role/);
  });

  it('refuses production on a loopback host', () => {
    expect(
      checkTargetAgainstConnection(
        { target: 'production', confirmProductionHost: 'db.example.co' },
        local,
        { KFBM_ROLLOUT_APPROVED: 'true' }
      ).join(' ')
    ).toMatch(/not production/);
  });

  it('refuses production while the rollout gate is not suspended', () => {
    for (const value of [undefined, '', 'TRUE', 'yes', 'false', '1']) {
      const problems = checkTargetAgainstConnection(
        { target: 'production', confirmProductionHost: 'db.example.co' },
        production,
        { KFBM_ROLLOUT_APPROVED: value }
      );
      expect(problems.join(' ')).toMatch(/rollout gate is not suspended/);
    }
  });

  it('refuses production when the confirmed host is not the host of the run', () => {
    expect(
      checkTargetAgainstConnection(
        { target: 'production', confirmProductionHost: 'other.example.co' },
        production,
        { KFBM_ROLLOUT_APPROVED: 'true' }
      ).join(' ')
    ).toMatch(/must name the host of the connection \(db\.example\.co\)/);
  });

  it('refuses production without the confirmation flag', () => {
    expect(
      checkTargetAgainstConnection(
        { target: 'production', confirmProductionHost: null },
        production,
        { KFBM_ROLLOUT_APPROVED: 'true' }
      ).join(' ')
    ).toMatch(/--confirm-production/);
  });

  it('refuses when the facts of the connection are unknown', () => {
    expect(
      checkTargetAgainstConnection(
        { target: 'local', confirmProductionHost: null },
        { host: null, currentSchema: null, currentUser: null },
        {}
      ).length
    ).toBeGreaterThan(0);
    expect(
      checkTargetAgainstConnection(
        { target: null, confirmProductionHost: null },
        local,
        {}
      )
    ).toEqual(['--target is missing.']);
  });
});

describe('ChunkPlan (dry run count)', () => {
  it('counts per type, catalog and visibility, sorted', () => {
    const plan = new ChunkPlan();
    plan.add('quiz', 'KFBM', 'trainer', 3);
    plan.add('quiz', 'KFBM', 'all', 2);
    plan.add('quiz', 'KFBM', 'all', 4);
    plan.add('course', null, 'all', 1);
    plan.add('course', 'FIAE', 'all', 0);
    expect(plan.rows()).toEqual([
      {
        sourceType: 'course',
        catalog: '(no catalog)',
        visibility: 'all',
        unit: 'chunks',
        chunks: 1,
        chars: 0,
        pages: 0,
      },
      {
        sourceType: 'quiz',
        catalog: 'KFBM',
        visibility: 'all',
        unit: 'chunks',
        chunks: 6,
        chars: 0,
        pages: 0,
      },
      {
        sourceType: 'quiz',
        catalog: 'KFBM',
        visibility: 'trainer',
        unit: 'chunks',
        chunks: 3,
        chars: 0,
        pages: 0,
      },
    ]);
    expect(plan.total()).toBe(10);
  });

  it('adds up the characters and pages that a dry run measured', () => {
    const plan = new ChunkPlan();
    plan.add('enabler', 'KFBM', 'all', 2, { chars: 900 });
    plan.add('enabler', 'KFBM', 'all', 1, { chars: 450 });
    plan.add('document (PDF files, not chunks)', 'KFBM', 'all', 3, {
      unit: 'files',
      pages: 12,
    });
    const [pdf, enabler] = plan.rows();
    expect(plan.total()).toBe(3);
    expect(plan.totalFiles()).toBe(3);
    expect(pdf).toMatchObject({ unit: 'files', chunks: 3, pages: 12 });
    expect(enabler).toMatchObject({ unit: 'chunks', chunks: 3, chars: 1350 });
  });

  it('keeps chunks and files apart for the same type, catalog and visibility', () => {
    const plan = new ChunkPlan();
    plan.add('document', 'KFBM', 'all', 4, { chars: 1000 });
    plan.add('document', 'KFBM', 'all', 2, { unit: 'files', pages: 5 });
    expect(plan.rows()).toHaveLength(2);
  });

  it('ignores negative or non finite measures', () => {
    const plan = new ChunkPlan();
    plan.add('quiz', 'KFBM', 'all', 1, { chars: -5, pages: Number.NaN });
    expect(plan.rows()[0]).toMatchObject({ chars: 0, pages: 0 });
  });
});
