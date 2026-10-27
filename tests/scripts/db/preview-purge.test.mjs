// Static checks of the purge script that empties public_preview before a rebuild
// (no database). The behaviour on a filled schema is covered by
// preview-rebuild-db.test.mjs (needs a local throwaway Postgres).
//
// Background: the first rebuild runs on an empty schema, the second one met
// "view lernfelder does not exist". The script listed the views and tables once
// and then dropped them one by one; dropping a table with CASCADE removed the
// view that depends on it, and the later "drop view" for that name failed.
import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  LEDGER,
  buildSetupScript,
  purgeSql,
} from '../../../scripts/db/preview-migrate.mjs';

const sql = purgeSql();

/** Every statement text that starts with "drop " up to the end of its string literal. */
function dropStatements(text) {
  return [...text.matchAll(/\bdrop\s[^']*/gi)].map(m => m[0]);
}

test('every drop statement of the purge is guarded with IF EXISTS', () => {
  const drops = dropStatements(sql);
  assert.ok(drops.length >= 6, `expected several drop statements: ${drops}`);
  for (const d of drops) {
    assert.ok(/\bif exists\b/i.test(d), `drop without IF EXISTS: ${d}`);
  }
});

test('the ledger is dropped with IF EXISTS after the leftover check', () => {
  const ledger = sql.indexOf(`drop table if exists ${LEDGER}`);
  assert.ok(ledger > 0);
  assert.ok(sql.indexOf('objects remain in') < ledger);
});

/** Position of the loop that selects the given relkind list from pg_class. */
function loopAt(kinds) {
  const at = sql.indexOf(`c.relkind in (${kinds})`);
  assert.ok(at > 0, `no loop over relkind ${kinds}`);
  return at;
}

test('views and materialized views are dropped before foreign tables and tables', () => {
  const views = loopAt("'v', 'm'");
  const foreign = loopAt("'f'");
  const tables = loopAt("'r', 'p'");
  assert.ok(views < foreign, 'views before foreign tables');
  assert.ok(foreign < tables, 'foreign tables before tables');
  assert.ok(tables < sql.indexOf("c.relkind = 'S'"), 'tables before sequences');
  assert.ok(tables < sql.indexOf('from pg_proc p'), 'tables before functions');
});

test('each object is looked up again by oid and relkind right before its drop', () => {
  // The lists are read once; an earlier CASCADE may already have removed an entry
  const guards = sql.match(/relkind = z\.relkind/g) ?? [];
  assert.ok(
    guards.length >= 3,
    'views, foreign tables and tables are re-checked'
  );
  assert.ok(/oid = z\.oid/.test(sql));
});

test('the drop command comes from the relkind, never from the name', () => {
  assert.ok(
    /case z\.relkind when 'm' then 'materialized view' else 'view' end/.test(
      sql
    )
  );
  assert.ok(sql.includes('drop foreign table if exists'));
  assert.ok(sql.includes('drop table if exists %I.%I cascade'));
  assert.ok(sql.includes('drop sequence if exists'));
  // no name based decision for lernfelder or any other catalog name
  assert.ok(!/lernfeld|use_case_enabler/i.test(sql));
});

test('routines are looked up again and dropped by a schema qualified name', () => {
  // a function can vanish through an earlier CASCADE; an unqualified name would then
  // resolve to a function of the same signature in public (it is on the search path)
  assert.ok(/where p\.oid = z\.oid/.test(sql));
  assert.ok(/format\('%I\.%I\(%s\)', n\.nspname, p\.proname/.test(sql));
  assert.ok(!/regprocedure::text as signature/.test(sql));
  assert.ok(sql.includes("then '*'"), 'zero argument aggregate');
});

test('members of a type or an extension are left to their owner', () => {
  // the constructor functions of a range type cannot be dropped on their own
  const guards = sql.match(/d\.deptype in \('i', 'e'\)/g) ?? [];
  assert.equal(guards.length, 2, 'routine loop and leftover check');
});

test('standalone composite types are dropped too', () => {
  // they own a pg_class row (relkind c) and were skipped by the type loop before
  assert.ok(/t\.typtype in \([^)]*'c'/.test(sql));
  assert.ok(/c\.relkind <> 'c'/.test(sql));
});

test('multirange types are left to their range type', () => {
  // dropping a multirange type directly fails, it goes away with the range type
  assert.ok(!/typtype in \([^)]*'m'/.test(sql));
});

test('the purge stops with a clear error when something is left over', () => {
  assert.ok(sql.includes('Rebuild aborted: objects remain in'));
});

test('CASCADE only appears on drops that are covered by the foreign object check', () => {
  const dependentCheck = sql.indexOf('Rebuild aborted: these objects outside');
  assert.ok(dependentCheck > 0);
  assert.ok(
    sql.indexOf('cascade') > dependentCheck,
    'check runs before the first cascade'
  );
  assert.ok(!/drop schema/i.test(sql));
});

test('the purge never names a schema other than public_preview and the ledger schema', () => {
  assert.ok(
    !/\b(auth|storage|cron|realtime|supabase_migrations|extensions)\./.test(sql)
  );
  assert.ok(!/'public'/.test(sql));
  assert.ok(!/\bpublic\./.test(sql));
});

test('the rebuild script starts with the purge and ends with the post clone file', () => {
  const script = buildSetupScript({
    baseline: [],
    localByVersion: new Map(),
    dumpSql: 'create table public_preview.t (id int);',
    postClone: '-- post clone',
  });
  assert.ok(script.startsWith(purgeSql()));
  assert.ok(script.trimEnd().endsWith('-- post clone'));
});
