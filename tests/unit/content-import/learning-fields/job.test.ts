import { runLearningFieldJob } from '@/lib/content-import/learning-fields/job';
import { buildLearningFieldPlan } from '@/lib/content-import/learning-fields/plan';
import type { Queryable } from '@/lib/content-import/apply/pg-db';

import { sampleIndex, sampleSheet } from './fixtures';

const CATALOG = '00000000-0000-4000-8000-000000000002';
const plan = () =>
  buildLearningFieldPlan(sampleSheet(), sampleIndex(), {
    now: new Date('2026-10-27T10:00:00Z'),
  });

const ENABLERS = ['K1-a', 'K1-b', 'K6.1-a', 'K6.2-d', 'K24.1-a'];

interface FakeOptions {
  catalog?: boolean;
  enablers?: boolean;
  lock?: boolean;
  failOn?: RegExp;
}

/** A connection that records every statement and answers like a database with enablers only. */
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
    if (t.includes('pg_try_advisory_xact_lock')) {
      return { rows: [{ locked: this.options.lock !== false }] };
    }
    if (/^select .* from enablers where/.test(t)) {
      return {
        rows:
          this.options.enablers === false
            ? []
            : ENABLERS.map((code, i) => ({
                id: `00000000-0000-4000-a000-${String(i + 1).padStart(12, '0')}`,
                code,
                training_catalog_id: CATALOG,
              })),
      };
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

describe('runLearningFieldJob', () => {
  it('check reads in a read-only transaction and always rolls back', async () => {
    const client = new FakeClient();
    const report = await runLearningFieldJob(client, plan(), {
      mode: 'check',
      updateExisting: true,
    });
    expect(report.wrote).toBe(false);
    expect(report.tables.training_catalog_learning_fields.insert).toBe(13);
    expect(client.sql[0]).toBe(
      'begin isolation level repeatable read read only'
    );
    expect(client.sql[1]).toBe("set local lock_timeout = '5s'");
    expect(client.sql[2]).toBe("set local statement_timeout = '60s'");
    expect(client.sql[3]).toBe('set local row_security = off');
    expect(client.sql.at(-1)).toBe('rollback');
    expect(client.sql.some(s => /^(insert|update)/.test(s))).toBe(false);
    expect(client.sql.some(s => s.includes('advisory'))).toBe(false);
  });

  it('a dry run executes the writes and rolls back, it never commits', async () => {
    const client = new FakeClient();
    const report = await runLearningFieldJob(client, plan(), {
      mode: 'dry-run',
      updateExisting: false,
    });
    expect(report.wrote).toBe(true);
    expect(client.sql[0]).toBe(
      'begin isolation level repeatable read read write'
    );
    expect(client.sql.some(s => s.includes('pg_try_advisory_xact_lock'))).toBe(
      true
    );
    expect(
      client.sql.some(s =>
        s.startsWith('insert into training_catalog_learning_fields')
      )
    ).toBe(true);
    expect(
      client.sql.some(s =>
        s.startsWith('insert into training_catalog_content_mappings')
      )
    ).toBe(true);
    expect(client.sql.at(-1)).toBe('rollback');
    expect(client.sql).not.toContain('commit');
  });

  it('a real run commits at the end and only then', async () => {
    const client = new FakeClient();
    await runLearningFieldJob(client, plan(), {
      mode: 'apply',
      updateExisting: false,
    });
    expect(client.sql.at(-1)).toBe('commit');
    expect(client.sql.filter(s => s === 'commit')).toHaveLength(1);
    expect(client.sql).not.toContain('rollback');
  });

  it('writes only the two learning field tables, with the catalog and no delete', async () => {
    const client = new FakeClient();
    await runLearningFieldJob(client, plan(), {
      mode: 'apply',
      updateExisting: false,
    });
    const writes = client.sql.filter(s =>
      /^(insert|update|delete|truncate|drop|alter)/.test(s)
    );
    expect(writes.length).toBeGreaterThan(0);
    for (const statement of writes) {
      expect(statement).toMatch(
        /^insert into (training_catalog_learning_fields|training_catalog_content_mappings) /
      );
    }
    const fields = client.statements.find(s =>
      s.text.includes('insert into training_catalog_learning_fields')
    );
    expect(fields?.values).toContain(CATALOG);
    // the columns of the mapping insert name the catalog of the learning field
    const mapping = client.sql.find(s =>
      s.startsWith('insert into training_catalog_content_mappings')
    );
    expect(mapping).toContain(
      '(learning_field_id, enabler_id, training_catalog_id)'
    );
  });

  it('an error while writing rolls back and does not commit', async () => {
    const client = new FakeClient({
      failOn: /^insert into training_catalog_content_mappings/,
    });
    await expect(
      runLearningFieldJob(client, plan(), {
        mode: 'apply',
        updateExisting: false,
      })
    ).rejects.toThrow('simulated failure');
    expect(client.sql.at(-1)).toBe('rollback');
    expect(client.sql).not.toContain('commit');
  });

  it('stops without a write when another import holds the lock', async () => {
    const client = new FakeClient({ lock: false });
    await expect(
      runLearningFieldJob(client, plan(), {
        mode: 'apply',
        updateExisting: false,
      })
    ).rejects.toMatchObject({ code: 'LOCKED' });
    expect(client.sql.some(s => s.startsWith('insert'))).toBe(false);
    expect(client.sql.at(-1)).toBe('rollback');
  });

  it('stops when the catalog or its enablers are missing', async () => {
    const noCatalog = new FakeClient({ catalog: false });
    await expect(
      runLearningFieldJob(noCatalog, plan(), {
        mode: 'apply',
        updateExisting: false,
      })
    ).rejects.toMatchObject({ code: 'CATALOG_MISSING' });
    expect(noCatalog.sql.at(-1)).toBe('rollback');

    const noEnablers = new FakeClient({ enablers: false });
    await expect(
      runLearningFieldJob(noEnablers, plan(), {
        mode: 'apply',
        updateExisting: false,
      })
    ).rejects.toMatchObject({ code: 'NO_ENABLERS' });
    expect(noEnablers.sql.some(s => s.startsWith('insert'))).toBe(false);
    expect(noEnablers.sql).not.toContain('commit');
  });
});
