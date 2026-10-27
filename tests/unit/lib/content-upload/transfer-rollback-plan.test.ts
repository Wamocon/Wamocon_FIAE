/**
 * @jest-environment node
 */
import { describe, expect, it } from '@jest/globals';

import type { Queryable } from '@/lib/content-import/apply/pg-db';
import { TABLES } from '@/lib/content-import/apply/tables';
import {
  DEPENDENTS,
  planRollback,
  rollbackAnswer,
} from '@/lib/content-upload/transfer/rollback';

const RUN = 'cccccccc-0000-4000-8000-000000000001';
const APPLY = 'dddddddd-0000-4000-8000-000000000001';
const U = (n: number) =>
  `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, '0')}`;
const STARTED = new Date('2026-10-27T08:00:00.123Z');

interface Script {
  apply?: Record<string, unknown> | null;
  rows?: Array<Record<string, unknown>>;
  later?: number;
  /** count by "<table>.<column>" for the dependents and active checks */
  counts?: Record<string, number>;
  storage?: string[];
  /** A table that does not exist, or any other error, by child table */
  errors?: Record<string, { code: string }>;
}

function scripted(script: Script) {
  const calls: Array<{ text: string; values: unknown[] }> = [];
  const q: Queryable = {
    async query(text, values) {
      const sql = text.replace(/\s+/g, ' ').trim();
      calls.push({ text: sql, values: values ?? [] });
      if (/^select id, run_id, started_at/.test(sql)) {
        return {
          rows:
            script.apply === null
              ? []
              : [
                  script.apply ?? {
                    id: APPLY,
                    run_id: RUN,
                    started_at: STARTED,
                    rolled_back: false,
                  },
                ],
        };
      }
      if (sql.startsWith('select table_name, row_id, action, before')) {
        return { rows: script.rows ?? [] };
      }
      if (sql.includes('from content_upload_applied_rows lr')) {
        return { rows: [{ n: script.later ?? 0 }] };
      }
      if (sql.startsWith('select storage_path from content_documents')) {
        return { rows: (script.storage ?? []).map(p => ({ storage_path: p })) };
      }
      const count =
        /^select count\(\*\)::int as n from (\w+) where (?:id = any\(\$1::uuid\[\]\) and (\w+) = true|(\w+) = any)/.exec(
          sql
        );
      if (count) {
        const table = count[1];
        const column = count[2] ?? count[3];
        const error = script.errors?.[table];
        if (error) throw Object.assign(new Error('x'), error);
        return { rows: [{ n: script.counts?.[`${table}.${column}`] ?? 0 }] };
      }
      throw new Error(`unexpected query: ${sql}`);
    },
  };
  return { q, calls };
}

const insertRow = (table: string, n: number) => ({
  table_name: table,
  row_id: U(n),
  action: 'insert',
  before: null,
});

describe('planRollback', () => {
  it('returns null when the run has no apply that was written', async () => {
    const { q } = scripted({ apply: null });
    expect(await planRollback(q, { runId: RUN })).toBeNull();
  });

  it('takes the newest apply that is not rolled back, or the one named, and only of this run', async () => {
    const latest = scripted({});
    await planRollback(latest.q, { runId: RUN });
    const sql = latest.calls[0].text;
    expect(sql).toContain("mode = 'apply' and status = 'ok'");
    expect(sql).toContain("coalesce(counts ->> 'rolledBack', '') <> 'true'");
    expect(sql).toContain('order by finished_at desc, id desc limit 1');
    expect(latest.calls[0].values).toEqual([RUN]);
    const named = scripted({});
    await planRollback(named.q, { runId: RUN, applyId: APPLY });
    expect(named.calls[0].text).toContain('where id = $1 and run_id = $2');
    expect(named.calls[0].values).toEqual([APPLY, RUN]);
  });

  it('reads the rows with the values from before, as an object or as text', async () => {
    const { q } = scripted({
      rows: [
        insertRow('quizzes', 1),
        {
          table_name: 'enablers',
          row_id: U(2),
          action: 'update',
          before: { title: 'a' },
        },
        {
          table_name: 'enablers',
          row_id: U(3),
          action: 'update',
          before: '{"title":"b"}',
        },
      ],
    });
    const plan = await planRollback(q, { runId: RUN });
    expect(plan?.startedAt).toEqual(STARTED);
    expect(plan?.rows).toEqual([
      { table: 'quizzes', rowId: U(1), action: 'insert', before: null },
      {
        table: 'enablers',
        rowId: U(2),
        action: 'update',
        before: { title: 'a' },
      },
      {
        table: 'enablers',
        rowId: U(3),
        action: 'update',
        before: { title: 'b' },
      },
    ]);
    expect(plan?.blockers).toEqual([]);
  });

  it('keeps the time of the apply to the millisecond when it comes as text', async () => {
    const { q } = scripted({
      apply: {
        id: APPLY,
        run_id: RUN,
        started_at: '2026-10-27T08:00:00.123Z',
        rolled_back: false,
      },
    });
    expect((await planRollback(q, { runId: RUN }))?.startedAt).toEqual(STARTED);
  });

  it('blocks for an apply that was rolled back already, and for a later apply', async () => {
    const done = await planRollback(
      scripted({
        apply: {
          id: APPLY,
          run_id: RUN,
          started_at: STARTED,
          rolled_back: true,
        },
      }).q,
      { runId: RUN, applyId: APPLY }
    );
    expect(done?.blockers.map(b => b.code)).toEqual(['ALREADY_ROLLED_BACK']);
    const later = await planRollback(scripted({ later: 4 }).q, { runId: RUN });
    expect(later?.blockers).toEqual([
      expect.objectContaining({ code: 'LATER_APPLY', detail: { rows: 4 } }),
    ]);
  });

  it('blocks for active or published rows, by table and column, and counts only', async () => {
    const { q } = scripted({
      rows: [
        insertRow('courses', 1),
        insertRow('quizzes', 2),
        insertRow('enablers', 3),
      ],
      counts: {
        'courses.is_active': 1,
        'courses.is_published': 1,
        'quizzes.is_active': 2,
      },
    });
    const plan = await planRollback(q, { runId: RUN });
    expect(plan?.blockers).toEqual([
      expect.objectContaining({
        code: 'ACTIVATED_CONTENT',
        detail: {
          'courses.is_active': 1,
          'courses.is_published': 1,
          'quizzes.is_active': 2,
        },
      }),
    ]);
  });

  it('blocks for data of learners that the cascade would take along', async () => {
    const { q } = scripted({
      rows: [insertRow('quizzes', 1), insertRow('use_cases', 2)],
      counts: {
        'quiz_submissions.quiz_id': 3,
        'use_case_submissions.use_case_id': 1,
      },
    });
    const plan = await planRollback(q, { runId: RUN });
    expect(plan?.blockers).toEqual([
      expect.objectContaining({
        code: 'DEPENDENT_DATA',
        detail: {
          'quiz_submissions.quiz_id': 3,
          'use_case_submissions.use_case_id': 1,
        },
      }),
    ]);
  });

  it('asks only for the ids of rows that the apply INSERTED, never an updated row', async () => {
    const { q, calls } = scripted({
      rows: [
        {
          table_name: 'quizzes',
          row_id: U(1),
          action: 'update',
          before: { title: 'x' },
        },
      ],
    });
    await planRollback(q, { runId: RUN });
    expect(calls.some(c => c.text.includes('quiz_submissions'))).toBe(false);
  });

  it('works through long lists in chunks', async () => {
    const rows = Array.from({ length: 4500 }, (_, i) =>
      insertRow('options', i + 1)
    );
    const { q, calls } = scripted({ rows });
    await planRollback(q, { runId: RUN });
    const options = calls.filter(c => c.text.includes('selected_option_id'));
    expect(options).toHaveLength(3);
    expect((options[0].values[0] as string[]).length).toBe(2000);
  });

  it('knows a table that does not exist, and passes every other error on', async () => {
    const rows = [insertRow('quizzes', 1)];
    const missing = scripted({
      rows,
      // tables of learners that do not exist here (the tables of the import always exist)
      errors: Object.fromEntries(
        DEPENDENTS.filter(([, child]) => !(child in TABLES)).map(
          ([, child]) => [child, { code: '42P01' }]
        )
      ),
    });
    expect((await planRollback(missing.q, { runId: RUN }))?.blockers).toEqual(
      []
    );
    const broken = scripted({
      rows,
      errors: { quiz_submissions: { code: '57014' } },
    });
    await expect(planRollback(broken.q, { runId: RUN })).rejects.toMatchObject({
      code: '57014',
    });
  });

  it('lists the paths of copies in the document bucket', async () => {
    const { q } = scripted({
      rows: [insertRow('content_documents', 1)],
      storage: ['u/2_b.pdf', 'u/1_a.pdf'],
    });
    expect((await planRollback(q, { runId: RUN }))?.objectPaths).toEqual([
      'u/1_a.pdf',
      'u/2_b.pdf',
    ]);
  });
});

describe('rollbackAnswer', () => {
  it('gives the text, the counts and the notes', async () => {
    const { q } = scripted({
      rows: [insertRow('quizzes', 1), insertRow('questions', 2)],
    });
    const answer = await rollbackAnswer(
      q,
      { runId: RUN },
      new Date('2026-10-27T09:00:00Z')
    );
    expect(answer).toMatchObject({
      applyId: APPLY,
      startedAt: '2026-10-27T08:00:00.123Z',
      blockers: [],
      deletes: { quizzes: 1, questions: 1 },
      restores: {},
      objectPaths: [],
    });
    expect(answer?.sql).toContain('text made 2026-10-27T09:00:00.000Z');
    expect(answer?.notes).toEqual([expect.stringContaining('hai_embeddings')]);
  });

  it('gives no text and no counts when something stands in the way', async () => {
    const { q } = scripted({ rows: [insertRow('quizzes', 1)], later: 1 });
    const answer = await rollbackAnswer(q, { runId: RUN });
    expect(answer).toMatchObject({ sql: null, deletes: {}, restores: {} });
    expect(answer?.blockers.map(b => b.code)).toEqual(['LATER_APPLY']);
  });

  it('names the copies in the bucket in the notes', async () => {
    const { q } = scripted({
      rows: [insertRow('content_documents', 1)],
      storage: ['u/1_a.pdf'],
    });
    const answer = await rollbackAnswer(q, { runId: RUN });
    expect(answer?.notes).toHaveLength(2);
    expect(answer?.objectPaths).toEqual(['u/1_a.pdf']);
    expect(answer?.sql).toContain('bucket content: u/1_a.pdf');
  });

  it('gives null for a run without an apply', async () => {
    expect(
      await rollbackAnswer(scripted({ apply: null }).q, { runId: RUN })
    ).toBeNull();
  });
});
