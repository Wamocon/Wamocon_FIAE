import { ImportAbort } from '@/lib/content-import/apply/db';
import type { Queryable } from '@/lib/content-import/apply/pg-db';
import { buildUseCasePlan } from '@/lib/content-import/use-cases/plan';
import { runUseCaseJob } from '@/lib/content-import/use-cases/job';
import type { UseCasePlan } from '@/lib/content-import/use-cases/types';

import { loadDecisions, sampleTree } from './fixtures';

const CREATOR = '99999999-0000-4000-8000-000000000001';
const CATALOG = '00000000-0000-4000-8000-000000000002';
const plan = (): UseCasePlan =>
  buildUseCasePlan(sampleTree(), loadDecisions(), {
    now: new Date('2026-10-27T12:00:00Z'),
  });

const COURSES = ['K1', 'K6.1', 'K6.2', 'K10', 'K20'];
const ENABLERS = ['K1-a', 'K1-b', 'K6.1-a', 'K6.2-d', 'K10-a', 'K20-a'];

interface FakeOptions {
  catalog?: boolean;
  profile?: boolean;
  lock?: boolean;
  enablers?: boolean;
  failOn?: RegExp;
}

/** A connection that records every statement and answers like a target after the content import. */
class FakeClient implements Queryable {
  statements: Array<{ text: string; values: unknown[] }> = [];
  private counter = 0;
  private readonly options: FakeOptions;

  constructor(options: FakeOptions = {}) {
    this.options = options;
  }

  get sql() {
    return this.statements.map(s => s.text.trim().replace(/\s+/g, ' '));
  }

  async query(text: string, values: unknown[] = []) {
    this.statements.push({ text, values });
    const t = text.trim().replace(/\s+/g, ' ').toLowerCase();
    if (this.options.failOn?.test(t)) throw new Error('simulated failure');
    if (t.startsWith('select id, code, is_active from training_catalogs')) {
      return {
        rows:
          this.options.catalog === false
            ? []
            : [{ id: CATALOG, code: values[0], is_active: true }],
      };
    }
    if (t.startsWith('select id, role::text as role from profiles')) {
      return {
        rows:
          this.options.profile === false
            ? []
            : [{ id: values[0], role: 'SUPER_ADMIN' }],
      };
    }
    if (t.includes('pg_try_advisory_xact_lock')) {
      return { rows: [{ locked: this.options.lock !== false }] };
    }
    if (t.startsWith('select ') && t.includes(' from courses ')) {
      return {
        rows: COURSES.map((code, i) => ({ id: `course-${i}`, code })),
      };
    }
    if (t.startsWith('select ') && t.includes(' from enablers ')) {
      return {
        rows:
          this.options.enablers === false
            ? []
            : ENABLERS.map((code, i) => ({
                id: `enabler-${i}`,
                code,
                course_id: `course-${COURSES.indexOf(code.split('-')[0])}`,
              })),
      };
    }
    if (t.startsWith('select ')) return { rows: [] };
    const insert = /^insert into (\w+) \(([^)]*)\) values/.exec(t);
    if (insert) {
      const columns = insert[2].split(',').map(c => c.trim());
      const rows: Record<string, unknown>[] = [];
      for (let i = 0; i < values.length; i += columns.length) {
        this.counter += 1;
        rows.push({
          id: `00000000-0000-4000-9000-${String(this.counter).padStart(12, '0')}`,
          ...Object.fromEntries(columns.map((c, j) => [c, values[i + j]])),
        });
      }
      return { rows };
    }
    if (t.startsWith('update ')) return { rows: [], rowCount: 1 };
    return { rows: [] };
  }
}

const input = (mode: 'check' | 'dry-run' | 'apply', solutions = false) => ({
  mode,
  target: 'local' as const,
  createdBy: CREATOR,
  updateExisting: false,
  activate: false,
  solutions,
});

describe('runUseCaseJob', () => {
  it('check reads in a read-only transaction and always rolls back', async () => {
    const client = new FakeClient();
    const report = await runUseCaseJob(client, plan(), input('check'));
    expect(report.wrote).toBe(false);
    expect(report.tables.use_cases.insert).toBe(6);
    expect(client.sql[0]).toBe(
      'begin isolation level repeatable read read only'
    );
    expect(client.sql[1]).toBe("set local lock_timeout = '5s'");
    expect(client.sql[2]).toBe("set local statement_timeout = '60s'");
    expect(client.sql[3]).toBe('set local row_security = off');
    expect(client.sql.at(-1)).toBe('rollback');
    expect(client.sql.some(s => s.startsWith('insert'))).toBe(false);
    expect(client.sql.some(s => s.includes('advisory'))).toBe(false);
  });

  it('a dry run executes the writes and rolls back, it never commits', async () => {
    const client = new FakeClient();
    const report = await runUseCaseJob(client, plan(), input('dry-run'));
    expect(report.wrote).toBe(true);
    expect(client.sql[0]).toBe(
      'begin isolation level repeatable read read write'
    );
    expect(client.sql.some(s => s.includes('pg_try_advisory_xact_lock'))).toBe(
      true
    );
    expect(client.sql.some(s => s.startsWith('insert into use_cases'))).toBe(
      true
    );
    expect(client.sql.at(-1)).toBe('rollback');
    expect(client.sql).not.toContain('commit');
  });

  it('a real run commits at the end and only then', async () => {
    const client = new FakeClient();
    await runUseCaseJob(client, plan(), input('apply'));
    expect(client.sql.at(-1)).toBe('commit');
    expect(client.sql.filter(s => s === 'commit')).toHaveLength(1);
    expect(client.sql).not.toContain('rollback');
  });

  it('an error while writing rolls back and does not commit', async () => {
    const client = new FakeClient({ failOn: /^insert into content_documents/ });
    await expect(runUseCaseJob(client, plan(), input('apply'))).rejects.toThrow(
      'simulated failure'
    );
    expect(client.sql.at(-1)).toBe('rollback');
    expect(client.sql).not.toContain('commit');
  });

  it('stops without a write when another import holds the lock', async () => {
    const client = new FakeClient({ lock: false });
    await expect(
      runUseCaseJob(client, plan(), input('apply'))
    ).rejects.toMatchObject({ code: 'LOCKED' });
    expect(client.sql.some(s => s.startsWith('insert'))).toBe(false);
    expect(client.sql.at(-1)).toBe('rollback');
  });

  it('stops without a write when the catalog, the profile or the enablers are missing', async () => {
    for (const [patch, code] of [
      [{ catalog: false }, 'CATALOG_MISSING'],
      [{ profile: false }, 'CREATOR_MISSING'],
      [{ enablers: false }, 'NO_ENABLERS'],
    ] as const) {
      const client = new FakeClient(patch);
      const error = await runUseCaseJob(client, plan(), input('apply')).catch(
        e => e
      );
      expect(error).toBeInstanceOf(ImportAbort);
      expect(error.code).toBe(code);
      expect(client.sql.some(s => s.startsWith('insert'))).toBe(false);
      expect(client.sql).not.toContain('commit');
    }
  });

  it('sends no delete, truncate, drop, alter or DDL, in any mode', async () => {
    for (const mode of ['check', 'dry-run', 'apply'] as const) {
      const client = new FakeClient();
      await runUseCaseJob(client, plan(), input(mode, true));
      for (const text of client.sql) {
        expect(text).not.toMatch(
          /\b(delete|truncate|drop|alter|grant|revoke|create)\b/i
        );
      }
    }
  });

  it('puts every value into parameters, none into the SQL text', async () => {
    const client = new FakeClient();
    await runUseCaseJob(client, plan(), input('apply', true));
    const allSql = client.sql.join('\n');
    for (const secret of ['OMEGA', 'ZETA', 'Erfundene Firma', CREATOR]) {
      expect(allSql).not.toContain(secret);
    }
    // the solution reaches the database through the parameters, with the switch only
    const params = JSON.stringify(client.statements.map(s => s.values));
    expect(params).toContain('OMEGA');
  });

  it('without the switch no parameter holds a solution', async () => {
    const client = new FakeClient();
    await runUseCaseJob(client, plan(), input('apply', false));
    const params = JSON.stringify(client.statements.map(s => s.values));
    expect(params).not.toContain('OMEGA');
    expect(params).not.toContain('ZETA');
    expect(params).not.toContain('TRAINER_SOLUTION');
  });

  it('refuses the solutions for any target but local, before the first statement', async () => {
    for (const mode of ['check', 'dry-run', 'apply'] as const) {
      const client = new FakeClient();
      await expect(
        runUseCaseJob(client, plan(), {
          ...input(mode, true),
          target: 'preview',
        })
      ).rejects.toMatchObject({ code: 'SOLUTIONS_NOT_LOCAL' });
      expect(client.statements).toEqual([]);
    }
    // a Preview run without the switch is fine
    await expect(
      runUseCaseJob(new FakeClient(), plan(), {
        ...input('check'),
        target: 'preview',
      })
    ).resolves.toBeDefined();
  });

  it('writes only use_cases and content_documents', async () => {
    const client = new FakeClient();
    await runUseCaseJob(client, plan(), input('apply', true));
    const tables = new Set(
      client.sql
        .map(s => /^insert into (\w+)/.exec(s)?.[1])
        .filter((t): t is string => Boolean(t))
    );
    expect([...tables].sort()).toEqual(['content_documents', 'use_cases']);
  });
});
