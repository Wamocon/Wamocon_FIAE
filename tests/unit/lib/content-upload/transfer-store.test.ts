/**
 * @jest-environment node
 */
import { describe, expect, it, jest } from '@jest/globals';

import type { Queryable } from '@/lib/content-import/apply/pg-db';
import {
  PgProtocolWriter,
  PgTransferStore,
  queryableOfPool,
  type ApplyRecord,
} from '@/lib/content-upload/transfer/store';

type Call = { text: string; values: unknown[] };

function fake(
  answer: (
    call: Call
  ) => Record<string, unknown>[] | { rows: any[]; rowCount?: number } = () => []
): Queryable & { calls: Call[] } {
  const calls: Call[] = [];
  return {
    calls,
    async query(text, values) {
      const call = { text, values: values ?? [] };
      calls.push(call);
      const result = answer(call);
      return Array.isArray(result)
        ? { rows: result, rowCount: result.length }
        : {
            rows: result.rows,
            rowCount: result.rowCount ?? result.rows.length,
          };
    },
  };
}

const RUN = 'cccccccc-0000-4000-8000-000000000001';
const squash = (text: string) => text.replace(/\s+/g, ' ').trim();

describe('the gate', () => {
  it('is one conditional update of the status, the version and, for an apply, the hash', async () => {
    const q = fake(() => [{ id: RUN }]);
    const store = new PgTransferStore(q);
    expect(
      await store.beginApplying(RUN, { version: 4, requireHash: 'h' })
    ).toBe(true);
    expect(q.calls).toHaveLength(1);
    const sql = squash(q.calls[0].text);
    expect(sql).toContain(
      "update content_upload_runs set status = 'applying', updated_at = now()"
    );
    expect(sql).toContain(
      "where id = $1 and status = 'review' and decisions_version = $2 and last_dry_run_hash = $3 returning id"
    );
    expect(q.calls[0].values).toEqual([RUN, 4, 'h']);
  });

  it('leaves the hash condition out for a dry run, and says false when no row changed', async () => {
    const q = fake(() => []);
    const store = new PgTransferStore(q);
    expect(
      await store.beginApplying(RUN, { version: 1, requireHash: null })
    ).toBe(false);
    expect(squash(q.calls[0].text)).not.toContain('last_dry_run_hash');
    expect(q.calls[0].values).toEqual([RUN, 1]);
  });

  it('ends the applying only from applying and stores the hash (or clears it)', async () => {
    const q = fake(() => [{ id: RUN }]);
    const store = new PgTransferStore(q);
    expect(await store.endApplying(RUN, null)).toBe(true);
    expect(squash(q.calls[0].text)).toContain(
      "set status = 'review', last_dry_run_hash = $2, updated_at = now() where id = $1 and status = 'applying'"
    );
    expect(q.calls[0].values).toEqual([RUN, null]);
    const none = new PgTransferStore(fake(() => []));
    expect(await none.endApplying(RUN, 'x')).toBe(false);
  });

  it('gives back only a run that has been applying for the given minutes', async () => {
    const q = fake(() => [{ id: RUN }]);
    expect(await new PgTransferStore(q).releaseStale(RUN, 15)).toBe(true);
    const sql = squash(q.calls[0].text);
    expect(sql).toContain(
      "where id = $1 and status = 'applying' and updated_at < now() - make_interval(mins => $2::int)"
    );
    expect(sql).toContain('last_dry_run_hash = null');
    expect(q.calls[0].values).toEqual([RUN, 15]);
  });
});

describe('reading', () => {
  it('maps the run with its catalog', async () => {
    const updated = new Date('2026-10-27T08:00:00Z');
    const store = new PgTransferStore(
      fake(() => [
        {
          id: RUN,
          status: 'review',
          decisions_version: '3',
          last_dry_run_hash: null,
          created_by_id: 'u',
          training_catalog_id: 'c',
          catalog_code: 'KFBM',
          updated_at: updated,
        },
      ])
    );
    expect(await store.getRunState(RUN)).toEqual({
      id: RUN,
      status: 'review',
      decisionsVersion: 3,
      lastDryRunHash: null,
      createdById: 'u',
      catalogId: 'c',
      catalogCode: 'KFBM',
      updatedAt: updated,
    });
    expect(await new PgTransferStore(fake()).getRunState(RUN)).toBeNull();
  });

  it('reads a time that comes as text', async () => {
    const store = new PgTransferStore(
      fake(() => [
        {
          id: RUN,
          status: 'review',
          decisions_version: 1,
          last_dry_run_hash: 'h',
          created_by_id: 'u',
          training_catalog_id: 'c',
          catalog_code: 'KFBM',
          updated_at: '2026-10-27T08:00:00.000Z',
        },
      ])
    );
    expect((await store.getRunState(RUN))?.updatedAt.toISOString()).toBe(
      '2026-10-27T08:00:00.000Z'
    );
  });

  it('loads the files of the run with the current decision of the SAME run, and nothing else', async () => {
    const q = fake(() => [
      {
        id: 'f1',
        rel_path: 'a/b.docx',
        file_name: 'b.docx',
        ext: 'docx',
        size_bytes: '1234',
        sha256: 'a'.repeat(64),
        client_mtime_ms: '1700000000000',
        created_ms: '1800000000000',
        storage_path: 'upload/r/f1.docx',
        status: 'decided',
        dup_key: 'quiz:1a:low',
        object_deleted: false,
        decision_id: 'd1',
        action: 'accept',
        doc_type: 'quiz',
        component_code: 'K1',
        enabler_code: 'K1-a',
        quiz_level: 'low',
        dup_choice: null,
        decisions_version: '2',
      },
      {
        id: 'f2',
        rel_path: 'x.docx',
        file_name: 'x.docx',
        ext: 'docx',
        size_bytes: 5,
        sha256: 'b'.repeat(64),
        client_mtime_ms: null,
        created_ms: '1800000000000',
        storage_path: 'upload/r/f2.docx',
        status: 'applied',
        dup_key: null,
        object_deleted: true,
        decision_id: 'd2',
        action: 'reject',
        doc_type: null,
        component_code: null,
        enabler_code: null,
        quiz_level: null,
        dup_choice: 'skip',
        decisions_version: 2,
      },
    ]);
    const files = await new PgTransferStore(q).loadFiles(RUN);
    const sql = squash(q.calls[0].text);
    expect(sql).toContain(
      'd.file_id = f.id and d.run_id = f.run_id and d.is_current'
    );
    expect(sql).toContain('where f.run_id = $1');
    expect(sql).toContain(
      "f.status in ('proposed_rules', 'unclear', 'proposed_ki', 'decided', 'applied')"
    );
    expect(q.calls[0].values).toEqual([RUN]);
    expect(files[0]).toMatchObject({
      id: 'f1',
      sizeBytes: 1234,
      mtimeMs: 1700000000000,
      dupKey: 'quiz:1a:low',
      objectDeleted: false,
      decision: {
        action: 'accept',
        docType: 'quiz',
        quizLevel: 'low',
        dupChoice: null,
        decisionsVersion: 2,
      },
    });
    // without the time of the browser the time of the announcement counts
    expect(files[1]).toMatchObject({
      mtimeMs: 1800000000000,
      objectDeleted: true,
      decision: { action: 'reject', dupChoice: 'skip', docType: null },
    });
  });

  it('loads the components of the catalog', async () => {
    const q = fake(() => [
      {
        code: 'K1',
        title: 'Eins',
        description: '§ 4',
        kind: 'pflicht',
        phase: 1,
      },
      {
        code: 'K10',
        title: 'Zehn',
        description: null,
        kind: 'wahl',
        phase: null,
      },
    ]);
    expect(await new PgTransferStore(q).loadComponents('cat')).toEqual([
      {
        code: 'K1',
        title: 'Eins',
        reference: '§ 4',
        kind: 'pflicht',
        phase: 1,
      },
      {
        code: 'K10',
        title: 'Zehn',
        reference: null,
        kind: 'wahl',
        phase: null,
      },
    ]);
    expect(q.calls[0].values).toEqual(['cat']);
    expect(squash(q.calls[0].text)).toContain('training_catalog_id = $1');
  });
});

describe('the protocol writer', () => {
  const record: ApplyRecord = {
    runId: RUN,
    mode: 'apply',
    startedById: 'u',
    decisionsVersion: 2,
    decisionsHash: 'h',
    updateExisting: true,
    status: 'ok',
    counts: { tables: {} },
    conflicts: [{ table: 'quizzes', key: 'k', reason: 'r' }],
    startedAt: new Date('2026-10-27T08:00:00.123Z'),
  };

  it('writes the apply with the schema of the connection and the JSON as text', async () => {
    const q = fake(() => [{ id: 'apply-1' }]);
    expect(await new PgProtocolWriter(q).insertApply(record)).toBe('apply-1');
    const sql = squash(q.calls[0].text);
    expect(sql).toContain('current_schema()');
    expect(sql).toContain('$8::text::jsonb, $9::text::jsonb, $10::timestamptz');
    expect(q.calls[0].values).toEqual([
      RUN,
      'apply',
      'u',
      2,
      'h',
      true,
      'ok',
      '{"tables":{}}',
      '[{"table":"quizzes","key":"k","reason":"r"}]',
      '2026-10-27T08:00:00.123Z',
    ]);
  });

  it('writes the rows in statements of at most 1000 rows, with the values from before as text', async () => {
    const q = fake();
    const rows = Array.from({ length: 2500 }, (_, i) => ({
      table: 'options' as const,
      rowId: `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`,
      action: i === 0 ? ('update' as const) : ('insert' as const),
      before: i === 0 ? { explanation: 'x' } : null,
      fileId: i % 2 === 0 ? 'ffffffff-0000-4000-8000-000000000001' : null,
    }));
    await new PgProtocolWriter(q).insertAppliedRows('apply-1', rows);
    expect(q.calls).toHaveLength(3);
    expect(q.calls[0].values).toHaveLength(1 + 1000 * 5);
    expect(q.calls[2].values).toHaveLength(1 + 500 * 5);
    expect(q.calls[0].values.slice(0, 6)).toEqual([
      'apply-1',
      'options',
      rows[0].rowId,
      'update',
      '{"explanation":"x"}',
      'ffffffff-0000-4000-8000-000000000001',
    ]);
    expect(q.calls[0].values[10]).toBeNull();
    expect(squash(q.calls[0].text)).toContain(
      '($1, $2, $3::uuid, $4, $5::text::jsonb, $6::uuid)'
    );
    // an empty list is no statement
    const none = fake();
    await new PgProtocolWriter(none).insertAppliedRows('a', []);
    expect(none.calls).toEqual([]);
  });

  it('marks only decided files of the run as applied, and nothing for an empty list', async () => {
    const q = fake(() => ({ rows: [], rowCount: 3 }));
    const writer = new PgProtocolWriter(q);
    expect(await writer.markFilesApplied(RUN, [])).toBe(0);
    expect(q.calls).toEqual([]);
    expect(await writer.markFilesApplied(RUN, ['a', 'b', 'c'])).toBe(3);
    const sql = squash(q.calls[0].text);
    expect(sql).toContain(
      "where run_id = $1 and id = any($2::uuid[]) and status = 'decided'"
    );
    expect(q.calls[0].values).toEqual([RUN, ['a', 'b', 'c']]);
  });

  it('finishes the run only from applying, sets the purge date and clears the hash', async () => {
    const q = fake(() => [{ id: RUN }]);
    expect(await new PgProtocolWriter(q).finishRunApplied(RUN, 30)).toBe(true);
    const sql = squash(q.calls[0].text);
    expect(sql).toContain(
      "set status = 'applied', finished_at = now(), purge_after = now() + make_interval(days => $2::int), last_dry_run_hash = null"
    );
    expect(sql).toContain("where id = $1 and status = 'applying'");
    expect(q.calls[0].values).toEqual([RUN, 30]);
    expect(await new PgProtocolWriter(fake()).finishRunApplied(RUN, 30)).toBe(
      false
    );
  });

  it('the store writes an attempt outside of a transaction, and gives the writer a connection of the transaction', async () => {
    const pool = fake(() => [{ id: 'attempt' }]);
    const tx = fake(() => [{ id: 'in-tx' }]);
    const store = new PgTransferStore(pool);
    expect(await store.recordAttempt(record)).toBe('attempt');
    expect(pool.calls).toHaveLength(1);
    expect(await store.protocol(tx).insertApply(record)).toBe('in-tx');
    expect(tx.calls).toHaveLength(1);
    expect(pool.calls).toHaveLength(1);
  });
});

describe('queryableOfPool', () => {
  it('sends the text and the values as they are and gives rows and the count', async () => {
    const unsafe = jest.fn(async () => Object.assign([{ a: 1 }], { count: 1 }));
    const q = queryableOfPool({ unsafe: unsafe as any });
    expect(await q.query('select 1', [2])).toEqual({
      rows: [{ a: 1 }],
      rowCount: 1,
    });
    expect(unsafe).toHaveBeenCalledWith('select 1', [2]);
    await q.query('select 2');
    expect(unsafe).toHaveBeenLastCalledWith('select 2', []);
    const plain = queryableOfPool({ unsafe: async () => [] as any });
    expect(await plain.query('x')).toEqual({ rows: [], rowCount: null });
  });
});
