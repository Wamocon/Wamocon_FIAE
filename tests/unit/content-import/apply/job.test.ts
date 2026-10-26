import { ImportAbort } from '@/lib/content-import/apply/db';
import { runJob } from '@/lib/content-import/apply/job';
import { buildImportPlan } from '@/lib/content-import/apply/plan';
import { PgDb, withTransaction } from '@/lib/content-import/apply/pg-db';
import type { Queryable } from '@/lib/content-import/apply/pg-db';
import type { ImportPlan } from '@/lib/content-import/apply/types';

import { loadDecisions, sampleTree } from './fixtures';

const CREATOR = '99999999-0000-4000-8000-000000000001';
const CATALOG = '00000000-0000-4000-8000-000000000002';
const plan = (): ImportPlan =>
  buildImportPlan(sampleTree(), loadDecisions(), {
    now: new Date('2026-10-26T12:00:00Z'),
  });

interface FakeOptions {
  catalog?: boolean;
  profile?: boolean;
  lock?: boolean;
  failOn?: RegExp;
}

/** A connection that records every statement and answers like an empty database. */
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

const input = (mode: 'check' | 'dry-run' | 'apply') => ({
  mode,
  createdBy: CREATOR,
  updateExisting: false,
  activate: false,
  scenarioSolutions: true,
});

describe('runJob', () => {
  it('check reads in a read-only transaction and always rolls back', async () => {
    const client = new FakeClient();
    const report = await runJob(client, plan(), input('check'));
    expect(report.wrote).toBe(false);
    expect(report.tables.quizzes.insert).toBe(23);
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
    const report = await runJob(client, plan(), input('dry-run'));
    expect(report.wrote).toBe(true);
    expect(client.sql[0]).toBe(
      'begin isolation level repeatable read read write'
    );
    expect(client.sql.some(s => s.includes('pg_try_advisory_xact_lock'))).toBe(
      true
    );
    expect(client.sql.some(s => s.startsWith('insert into options'))).toBe(
      true
    );
    expect(client.sql.at(-1)).toBe('rollback');
    expect(client.sql).not.toContain('commit');
  });

  it('a real run commits at the end and only then', async () => {
    const client = new FakeClient();
    await runJob(client, plan(), input('apply'));
    expect(client.sql.at(-1)).toBe('commit');
    expect(client.sql.filter(s => s === 'commit')).toHaveLength(1);
    expect(client.sql).not.toContain('rollback');
  });

  it('an error while writing rolls back and does not commit', async () => {
    const client = new FakeClient({ failOn: /^insert into options/ });
    await expect(runJob(client, plan(), input('apply'))).rejects.toThrow(
      'simulated failure'
    );
    expect(client.sql.at(-1)).toBe('rollback');
    expect(client.sql).not.toContain('commit');
  });

  it('stops without a write when another import holds the lock', async () => {
    const client = new FakeClient({ lock: false });
    await expect(runJob(client, plan(), input('apply'))).rejects.toMatchObject({
      code: 'LOCKED',
    });
    expect(client.sql.some(s => s.startsWith('insert'))).toBe(false);
    expect(client.sql.at(-1)).toBe('rollback');
  });

  it('stops without a write when the catalog is missing or the profile unknown', async () => {
    const noCatalog = new FakeClient({ catalog: false });
    await expect(
      runJob(noCatalog, plan(), input('apply'))
    ).rejects.toMatchObject({
      code: 'CATALOG_MISSING',
    });
    expect(noCatalog.sql.some(s => s.startsWith('insert'))).toBe(false);
    expect(noCatalog.sql).not.toContain('commit');

    const noProfile = new FakeClient({ profile: false });
    await expect(
      runJob(noProfile, plan(), input('apply'))
    ).rejects.toBeInstanceOf(ImportAbort);
    expect(noProfile.sql.some(s => s.startsWith('insert'))).toBe(false);
  });

  it('sends no delete, truncate, drop, alter or DDL, in any mode', async () => {
    for (const mode of ['check', 'dry-run', 'apply'] as const) {
      const client = new FakeClient();
      await runJob(client, plan(), input(mode));
      for (const text of client.sql) {
        expect(text).not.toMatch(
          /\b(delete|truncate|drop|alter|grant|revoke|create)\b/i
        );
      }
    }
  });

  it('puts every value into parameters, none into the SQL text', async () => {
    const client = new FakeClient();
    await runJob(client, plan(), input('apply'));
    const allSql = client.sql.join('\n');
    for (const secret of [
      'ZETA',
      'OMEGA',
      'SIGMA',
      'Erfundene Frage',
      'Erfundener Lehrtext',
      CREATOR,
    ]) {
      expect(allSql).not.toContain(secret);
    }
    // the solution does reach the database, through the parameters
    const params = JSON.stringify(client.statements.map(s => s.values));
    expect(params).toContain('ZETA');
  });

  it('writes only the tables of the import and splits large inserts', async () => {
    const client = new FakeClient();
    await runJob(client, plan(), input('apply'));
    const tables = new Set(
      client.sql
        .map(s => /^insert into (\w+)/.exec(s)?.[1])
        .filter((t): t is string => Boolean(t))
    );
    expect([...tables].sort()).toEqual(
      [
        'content_documents',
        'courses',
        'enabler_quiz_links',
        'enablers',
        'options',
        'questions',
        'quizzes',
        'training_components',
      ].sort()
    );
    const optionStatements = client.statements.filter(s =>
      s.text.trim().startsWith('insert into options')
    );
    // 1120 options of 5 columns: three statements of at most 500 rows
    expect(optionStatements).toHaveLength(3);
    for (const statement of optionStatements) {
      expect(statement.values.length / 5).toBeLessThanOrEqual(500);
    }
  });
});

describe('PgDb guards', () => {
  const db = () => new PgDb(new FakeClient());

  it('refuses a table, a column or an update outside the allowlist', async () => {
    await expect(db().select('profiles' as any)).rejects.toThrow(
      /not part of the import/
    );
    await expect(db().select('quizzes', { nope: 'x' })).rejects.toThrow(
      /not allowed/
    );
    await expect(
      db().insert('quizzes', [{ code: 'x', is_admin: true }])
    ).rejects.toThrow(/not allowed/);
    await expect(
      db().update('quizzes', 'id-1', { is_active: true })
    ).rejects.toThrow(/not allowed/);
    await expect(
      db().update('courses', 'id-1', { created_by_id: CREATOR })
    ).rejects.toThrow(/not allowed/);
    await expect(
      db().insert('options', [
        { option_text: 'a' },
        { option_text: 'b', is_correct: true },
      ])
    ).rejects.toThrow(/same columns/);
  });

  it('does not offer a delete', () => {
    const names = Object.getOwnPropertyNames(PgDb.prototype);
    expect(names.filter(n => /delete|remove|truncate|drop/i.test(n))).toEqual(
      []
    );
  });

  it('refreshes updated_at on an update of a table that has it', async () => {
    const client = new FakeClient();
    await new PgDb(client).update('enablers', 'id-1', { title: 'x' });
    expect(client.sql[0]).toBe(
      'update enablers set title = $1, updated_at = now() where id = $2'
    );
    const other = new FakeClient();
    await new PgDb(other).update('options', 'id-1', { option_text: 'x' });
    expect(other.sql[0]).toBe(
      'update options set option_text = $1 where id = $2'
    );
  });

  it('an update that does not change exactly one row is an error', async () => {
    const client: Queryable = {
      query: async () => ({ rows: [], rowCount: 0 }),
    };
    await expect(
      new PgDb(client).update('enablers', 'id-1', { title: 'x' })
    ).rejects.toThrow(/expected 1/);
  });

  it('withTransaction rolls back when the work throws and rethrows', async () => {
    const client = new FakeClient();
    await expect(
      withTransaction(client, { mode: 'write', finish: 'commit' }, async () => {
        throw new Error('boom');
      })
    ).rejects.toThrow('boom');
    expect(client.sql.at(-1)).toBe('rollback');
    expect(client.sql).not.toContain('commit');
  });
});
