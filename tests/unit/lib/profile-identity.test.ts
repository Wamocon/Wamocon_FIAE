/**
 * @jest-environment node
 */
import { describe, it, expect, jest } from '@jest/globals';
import { getTableName, is, type SQL } from 'drizzle-orm';
import { getTableConfig, PgDialect, PgTable } from 'drizzle-orm/pg-core';
import * as schema from '@/db/migrations/schemas/schema';
import { mergeProfileReferences } from '@/lib/profile-identity';

// The merge of a pre-created profile into the profile of the first login
// (/api/auth/sync-profile). The executor is a recorder, so these tests pin the
// statements, their order and their parameters. What the statements do to real
// rows is covered by the smoke test against the local database (see the pull
// request), because a mock ignores every WHERE clause.

const FIAE = '00000000-0000-4000-8000-000000000001';
const OLD_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const NEW_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';

const dialect = new PgDialect();

type Rendered = { sql: string; params: unknown[] };

function render(query: SQL): Rendered {
  const { sql, params } = dialect.sqlToQuery(query);
  return { sql: sql.replace(/\s+/g, ' ').trim(), params };
}

async function runMerge(from = OLD_ID, to = NEW_ID): Promise<Rendered[]> {
  const statements: Rendered[] = [];
  await mergeProfileReferences(
    {
      execute: async query => {
        statements.push(render(query));
        return [];
      },
    },
    from,
    to
  );
  return statements;
}

const isEnrollmentDelete = (s: Rendered) =>
  s.sql.startsWith('DELETE FROM "trainee_enrollments"');
const isEnrollmentUpdate = (s: Rendered) =>
  s.sql.startsWith('UPDATE "trainee_enrollments"');

describe('mergeProfileReferences', () => {
  it.each([
    ['no source id', '', NEW_ID],
    ['no target id', OLD_ID, ''],
    ['the same id twice', OLD_ID, OLD_ID],
  ])('does nothing for %s', async (_name, from, to) => {
    expect(await runMerge(from, to)).toEqual([]);
  });

  it('hands the enrollment of the pre-created profile to the new profile', async () => {
    const statements = await runMerge();
    const update = statements.find(isEnrollmentUpdate);

    expect(update).toBeDefined();
    expect(update!.sql).toContain('SET "trainee_id" = $1');
    expect(update!.sql).toContain('WHERE "trainee_id" = $2');
    // The first parameter is the new profile, the second the old one
    expect(update!.params.slice(0, 2)).toEqual([NEW_ID, OLD_ID]);
  });

  it('moves the row itself, so the elective choices stay attached to it', async () => {
    const statements = await runMerge();
    const update = statements.find(isEnrollmentUpdate)!;

    // Only trainee_id changes. The choices point at (id, training_catalog_id)
    // of the enrollment, so they follow without a statement of their own, and
    // no row of trainee_elective_choices is written or deleted here.
    expect(update.sql).not.toMatch(/SET "(?!trainee_id")/);
    expect(update.sql).not.toContain('"id"');
    expect(update.sql).not.toContain('"training_catalog_id" =');
    expect(
      statements.filter(s => s.sql.includes('trainee_elective_choices'))
    ).toEqual([]);
  });

  it('does not move the enrollment while the new profile keeps its own', async () => {
    const statements = await runMerge();
    const update = statements.find(isEnrollmentUpdate)!;

    // The unique index allows one row per trainee. The move only runs when the
    // new profile has no enrollment (left) after the delete below.
    expect(update.sql).toMatch(
      /AND NOT EXISTS \( SELECT 1 FROM "trainee_enrollments" keep_row WHERE keep_row\."trainee_id" = \$3 \)$/
    );
    expect(update.params[2]).toBe(NEW_ID);
  });

  it('lets the enrollment of the pre-created profile replace the one of the new profile', async () => {
    const statements = await runMerge();
    const remove = statements.find(isEnrollmentDelete);

    expect(remove).toBeDefined();
    // Rows of the NEW profile are deleted, if the OLD profile has one
    expect(remove!.sql).toContain('new_row."trainee_id" = $1');
    expect(remove!.sql).toContain('old_row."trainee_id" = $2');
    expect(remove!.params.slice(0, 2)).toEqual([NEW_ID, OLD_ID]);
  });

  it('spares a deliberate occupation of the new profile against the default FIAE', async () => {
    const statements = await runMerge();
    const remove = statements.find(isEnrollmentDelete)!;

    // The old enrollment wins when it is not FIAE (an administrator moved the
    // trainee away from the default), or when the row of the new profile is
    // FIAE itself (the default is the weaker statement, same catalog or not).
    // An old FIAE row never replaces a new row of another catalog.
    expect(remove.sql).toMatch(
      /AND \( old_row\."training_catalog_id" <> \$3 OR new_row\."training_catalog_id" = \$4 \)/
    );
    expect(remove.params).toEqual([NEW_ID, OLD_ID, FIAE, FIAE]);
  });

  it('decides about the enrollment before it moves anything', async () => {
    const statements = await runMerge();
    const enrollmentStatements = statements.filter(
      s => isEnrollmentDelete(s) || isEnrollmentUpdate(s)
    );

    expect(enrollmentStatements.map(s => s.sql.split(' ')[0])).toEqual([
      'DELETE',
      'UPDATE',
    ]);
    expect(statements.indexOf(enrollmentStatements[0])).toBeLessThan(
      statements.indexOf(enrollmentStatements[1])
    );
  });

  it('resolves the conflicts of the other tables before it moves any row', async () => {
    const statements = await runMerge();
    const firstUpdate = statements.findIndex(s => s.sql.startsWith('UPDATE'));
    const lastDelete = statements.reduce(
      (last, s, i) => (s.sql.startsWith('DELETE') ? i : last),
      -1
    );

    // Every DELETE (conflicts and the enrollment) runs before any UPDATE
    expect(lastDelete).toBeGreaterThanOrEqual(0);
    expect(lastDelete).toBeLessThan(firstUpdate);
    expect(
      statements.some(s => s.sql.startsWith('DELETE FROM "course_members"'))
    ).toBe(true);
  });

  it('sends every statement through the executor, one query each', async () => {
    const execute = jest.fn(async (_query: SQL) => []);
    await mergeProfileReferences({ execute }, OLD_ID, NEW_ID);
    expect(execute.mock.calls.length).toBeGreaterThan(0);
    for (const [query] of execute.mock.calls) {
      expect(render(query).sql).not.toContain(';');
    }
  });

  it('stops at the first failing statement and passes the error on', async () => {
    const seen: string[] = [];
    const failure = new Error('boom');
    await expect(
      mergeProfileReferences(
        {
          execute: async query => {
            const rendered = render(query);
            seen.push(rendered.sql);
            if (isEnrollmentUpdate(rendered)) throw failure;
            return [];
          },
        },
        OLD_ID,
        NEW_ID
      )
    ).rejects.toBe(failure);

    // The route runs this inside a transaction: the error rolls everything
    // back, so the old profile and its enrollment are still there.
    expect(seen[seen.length - 1]).toMatch(/^UPDATE "trainee_enrollments"/);
    expect(seen.filter(s => s.startsWith('UPDATE')).length).toBe(1);
  });

  it('covers every foreign key to profiles of the schema', async () => {
    const statements = await runMerge();
    const handled = new Set(
      statements
        .map(s => /^UPDATE "(\w+)" SET "(\w+)"/.exec(s.sql))
        .filter((m): m is RegExpExecArray => m !== null)
        .map(m => `${m[1]}.${m[2]}`)
    );

    const references: string[] = [];
    for (const value of Object.values(schema)) {
      if (!is(value, PgTable)) continue;
      const config = getTableConfig(value);
      for (const foreignKey of config.foreignKeys) {
        const reference = foreignKey.reference();
        if (getTableName(reference.foreignTable) !== 'profiles') continue;
        for (const column of reference.columns) {
          references.push(`${config.name}.${column.name}`);
        }
      }
    }

    // A table of schema.ts that points at profiles must be added to the merge,
    // or its rows are lost with the old profile (foreign keys that only exist
    // in a migration are not seen here).
    expect(references).toContain('trainee_enrollments.trainee_id');
    expect(references.filter(r => !handled.has(r))).toEqual([]);
  });
});
