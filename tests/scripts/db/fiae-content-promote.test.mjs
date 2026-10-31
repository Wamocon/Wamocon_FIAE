// Tests for scripts/db/fiae-content-promote.mjs (FIAE content from public_preview to public by id).
//
// The pure parts run everywhere. The part against a database runs only when PROMOTE_TEST_URL points to a
// LOCAL throwaway Postgres (a docker container, superuser). The test creates its own database with
// synthetic schemas public and public_preview, drops it at the end and refuses every host except
// localhost. It never reads a secret and never touches a Supabase project:
//
//   docker run -d --name promote-test -e POSTGRES_PASSWORD=pw -p 54349:5432 postgres:17-alpine
//   PROMOTE_TEST_URL=postgresql://postgres:pw@127.0.0.1:54349/postgres \
//     node --test tests/scripts/db/fiae-content-promote.test.mjs
//   docker rm -f promote-test
import assert from 'node:assert/strict';
import { after, before, describe, test } from 'node:test';

import {
  decideQuiz,
  describeQuestions,
  main,
  parseArgs,
  promote,
  rollbackReport,
  sameQuiz,
  stemKey,
} from '../../../scripts/db/fiae-content-promote.mjs';

const q = (text, right) => ({ key: stemKey(text), right });

test('the same questions in any order with the same right answers are the same quiz', () => {
  const a = [q('Welche Rollen?', ['x']), q('Was ist Scrum?', ['y'])];
  assert.equal(sameQuiz(a, [a[1], a[0]]), true);
  assert.equal(sameQuiz(a, [a[0]]), false);
  assert.equal(sameQuiz(a, [a[0], q('Was ist Scrum?', ['z'])]), false);
});

test('a quiz is replaced in place only when nobody shares it and split when it is shared, never with answers', () => {
  const src = [q('Frage eins', ['a'])];
  const other = [q('Frage zwei', ['b'])];
  assert.equal(decideQuiz(src, null), 'insert');
  assert.equal(
    decideQuiz(src, { questions: src, shared: true, submissions: 3 }),
    'same'
  );
  assert.equal(
    decideQuiz(src, { questions: other, shared: false, submissions: 0 }),
    'replace'
  );
  assert.equal(
    decideQuiz(src, { questions: other, shared: false, submissions: 2 }),
    'conflict-submissions'
  );
  assert.equal(
    decideQuiz(src, { questions: other, shared: true, submissions: 0 }),
    'split'
  );
  assert.equal(
    decideQuiz(src, { questions: other, shared: true, submissions: 1 }),
    'conflict-submissions'
  );
});

test('the question key ignores the topic line and the layout', () => {
  assert.equal(
    stemKey('**Scrum**\n\nWelche drei Rollen definiert Scrum?'),
    stemKey('Welche  drei Rollen definiert Scrum')
  );
  const optionsOf = new Map([
    [
      'q1',
      [
        { option_text: 'Team', is_correct: false },
        { option_text: 'Product Owner', is_correct: true },
      ],
    ],
  ]);
  assert.deepEqual(
    describeQuestions([{ id: 'q1', question_text: 'Frage?' }], optionsOf)[0]
      .right,
    ['productowner']
  );
});

test('a real run needs the target, the host and the approval', async () => {
  assert.deepEqual(parseArgs(['run', '--target', 'public']).errors, []);
  assert.ok(parseArgs(['run', '--target', 'preview']).errors.length);
  assert.ok(parseArgs(['run', '--target', 'public', '--apply']).errors.length);
  assert.ok(parseArgs(['rollback', '--target', 'public']).errors.length);
  const quiet = console.error;
  console.error = () => {};
  try {
    const env = { DB_CONNECTION_STRING: 'postgresql://u:p@db.example.test/x' };
    const apply = ['run', '--target', 'public', '--apply', '--confirm-host'];
    assert.equal(await main([...apply, 'db.example.test'], env), 1);
    assert.equal(
      await main([...apply, 'other.test'], {
        ...env,
        FIAE_PROMOTE_APPROVED: 'yes',
      }),
      1
    );
  } finally {
    console.error = quiet;
  }
});

const ADMIN_URL = process.env.PROMOTE_TEST_URL;
const LOCAL = new Set(['localhost', '127.0.0.1', '::1', '[::1]']);

describe(
  'against a local Postgres',
  { skip: ADMIN_URL ? false : 'PROMOTE_TEST_URL is not set' },
  () => {
    let admin;
    let db;
    let dbName;
    let dbUrl;
    let report;
    const id = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

    const ddl = schema => `
      create schema if not exists ${schema};
      create type ${schema}.content_document_type as enum ('THEORY','EXERCISE','TRAINER_SOLUTION','TRAINEE_QUESTION');
      create type ${schema}.document_visibility as enum ('ALL','TRAINER_ONLY');
      create type ${schema}.quiz_type as enum ('LESSON','GLOBAL');
      create type ${schema}.question_type as enum ('MCQ','TEXT');
      create type ${schema}.quiz_difficulty as enum ('LOW','MEDIUM','HIGH');
      create table ${schema}.training_catalogs (id uuid primary key, code text);
      create table ${schema}.courses (id uuid primary key, training_catalog_id uuid);
      create table ${schema}.enablers (id uuid primary key, course_id uuid);
      create table ${schema}.use_cases (id uuid primary key, course_id uuid);
      create table ${schema}.content_documents (id uuid primary key, enabler_id uuid, use_case_id uuid, course_id uuid,
        title text, document_type ${schema}.content_document_type, file_name text, file_size int, mime_type text,
        storage_url text, storage_path text, order_index int, uploaded_by_id uuid, visibility ${schema}.document_visibility,
        page_count int, updated_at timestamptz);
      create table ${schema}.quizzes (id uuid primary key default gen_random_uuid(), title text, quiz_type ${schema}.quiz_type not null,
        created_by_id uuid not null, training_catalog_id uuid not null, is_active boolean default ${schema === 'public' ? 'false' : 'true'});
      create table ${schema}.questions (id uuid primary key default gen_random_uuid(), quiz_id uuid references ${schema}.quizzes(id) on delete cascade,
        question_text text, order_index int, question_type ${schema}.question_type not null default 'MCQ', expected_answer text);
      create table ${schema}.options (id uuid primary key default gen_random_uuid(), question_id uuid references ${schema}.questions(id) on delete cascade,
        option_text text, is_correct boolean not null, explanation text, order_index int);
      create table ${schema}.enabler_quiz_links (id uuid primary key default gen_random_uuid(), enabler_id uuid, quiz_id uuid references ${schema}.quizzes(id) on delete cascade,
        difficulty ${schema}.quiz_difficulty not null);
      create table ${schema}.quiz_submissions (id uuid primary key default gen_random_uuid(), quiz_id uuid references ${schema}.quizzes(id) on delete cascade);
    `;

    const addQuiz = async (schema, quizId, enablerIds, level, questions) => {
      await db.query(
        `insert into ${schema}.quizzes (id, title, quiz_type, created_by_id, training_catalog_id) values ($1, $2, 'LESSON', $3, $4)`,
        [quizId, `quiz ${level}`, id(900), id(800)]
      );
      for (const e of enablerIds)
        await db.query(
          `insert into ${schema}.enabler_quiz_links (enabler_id, quiz_id, difficulty) values ($1, $2, $3::${schema}.quiz_difficulty)`,
          [e, quizId, level]
        );
      let n = 0;
      for (const [text, right] of questions) {
        const qid = (
          await db.query(
            `insert into ${schema}.questions (quiz_id, question_text, order_index) values ($1, $2, $3) returning id`,
            [quizId, text, n++]
          )
        ).rows[0].id;
        await db.query(
          `insert into ${schema}.options (question_id, option_text, is_correct, order_index) values ($1, $2, true, 0), ($1, 'falsch', false, 1)`,
          [qid, right]
        );
      }
    };
    const addDoc = (schema, docId, enablerId, file) =>
      db.query(
        `insert into ${schema}.content_documents (id, enabler_id, course_id, title, document_type, file_name, file_size, mime_type,
           storage_url, storage_path, order_index, visibility, page_count)
         values ($1, $2, $3, 'Lehrtext', 'THEORY', $4, 10, 'application/pdf', $5, $6, 0, 'ALL', 3)`,
        [docId, enablerId, id(10), file, `https://x/${file}`, `p/${file}`]
      );
    const count = async (sql, p) => Number((await db.query(sql, p)).rows[0].n);
    const text = async quizId =>
      (
        await db.query(
          `select question_text from public.questions where quiz_id = $1 order by order_index`,
          [quizId]
        )
      ).rows.map(r => r.question_text);

    before(async () => {
      const url = new URL(ADMIN_URL);
      assert.ok(LOCAL.has(url.hostname), 'the test runs only against localhost');
      const pg = (await import('pg')).default;
      admin = new pg.Client({ connectionString: ADMIN_URL });
      await admin.connect();
      dbName = `promote_${Date.now()}`;
      await admin.query(`create database ${dbName}`);
      url.pathname = `/${dbName}`;
      dbUrl = url.toString();
      db = new pg.Client({ connectionString: dbUrl });
      await db.connect();
      await db.query(ddl('public'));
      await db.query(ddl('public_preview'));
      for (const s of ['public', 'public_preview']) {
        await db.query(`insert into ${s}.training_catalogs values ($1, 'FIAE')`, [id(800)]);
        await db.query(`insert into ${s}.courses values ($1, $2)`, [id(10), id(800)]);
        for (const e of [1, 2, 3])
          await db.query(`insert into ${s}.enablers values ($1, $2)`, [id(e), id(10)]);
      }
      // an enabler only the Preview knows
      await db.query(`insert into public_preview.enablers values ($1, $2)`, [id(4), id(10)]);
      // documents of enabler 1: changed file, same file, new row; enabler 4 has no parent in public
      await addDoc('public', id(101), id(1), 'alt.pdf');
      await addDoc('public_preview', id(101), id(1), 'neu.pdf');
      await addDoc('public', id(102), id(1), 'gleich.pdf');
      await addDoc('public_preview', id(102), id(1), 'gleich.pdf');
      await addDoc('public_preview', id(103), id(1), 'nur-preview.pdf');
      await addDoc('public_preview', id(104), id(4), 'ohne-eltern.pdf');
      // quizzes of enabler 1: LOW same, MEDIUM different (replaced), HIGH missing in public (inserted)
      await addQuiz('public', id(201), [id(1)], 'LOW', [['Frage A', 'a']]);
      await addQuiz('public_preview', id(201), [id(1)], 'LOW', [['Frage A', 'a']]);
      await addQuiz('public', id(202), [id(1)], 'MEDIUM', [['Alt B', 'b']]);
      await addQuiz('public_preview', id(202), [id(1)], 'MEDIUM', [['Neu B', 'b'], ['Neu C', 'c']]);
      await addQuiz('public_preview', id(203), [id(1)], 'HIGH', [['Frage D', 'd']]);
      // enabler 2: different but answered (conflict); enablers 2 and 3 share a quiz (conflict)
      await addQuiz('public', id(204), [id(2)], 'LOW', [['Alt E', 'e']]);
      await addQuiz('public_preview', id(204), [id(2)], 'LOW', [['Neu E', 'e']]);
      await db.query(`insert into public.quiz_submissions (quiz_id) values ($1)`, [id(204)]);
      await addQuiz('public', id(205), [id(2), id(3)], 'MEDIUM', [['Alt F', 'f']]);
      await db.query(`update public.quizzes set is_active = true where id = $1`, [id(205)]);
      await addQuiz('public_preview', id(205), [id(2), id(3)], 'MEDIUM', [['Neu F', 'f']]);
    });

    after(async () => {
      await db?.end().catch(() => undefined);
      if (admin) {
        await admin
          .query(`drop database if exists ${dbName} with (force)`)
          .catch(() => undefined);
        await admin.end().catch(() => undefined);
      }
    });

    test('a dry run reports the numbers and writes nothing', async () => {
      const quiet = console.log;
      console.log = () => {};
      try {
        assert.equal(
          await main(['run', '--target', 'public'], { DB_CONNECTION_STRING: dbUrl }),
          0
        );
      } finally {
        console.log = quiet;
      }
      assert.equal(await count(`select count(*) n from public.content_documents`), 2);
      assert.equal(await count(`select count(*) n from public.quizzes`), 4);
      assert.deepEqual(await text(id(202)), ['Alt B']);
    });

    test('the promotion replaces, inserts, splits shared quizzes and lists the quizzes with answers', async () => {
      await db.query('begin');
      report = await promote(db);
      await db.query('commit');
      assert.deepEqual(
        {
          unchanged: report.documents.unchanged,
          updated: report.documents.updated.length,
          inserted: report.documents.inserted.length,
          noParent: report.documents.skippedNoParent,
        },
        { unchanged: 1, updated: 1, inserted: 1, noParent: 0 }
      );
      assert.equal(report.quizzes.same, 1);
      assert.equal(report.quizzes.replaced.length, 1);
      assert.equal(report.quizzes.inserted.length, 1);
      assert.deepEqual(report.quizzes.conflicts.map(c => c.why), ['submissions']);
      // the quiz of enablers 2 and 3 was shared: both get ONE new quiz, as active as the old one, the old one stays
      assert.equal(report.quizzes.split.length, 1);
      assert.equal(report.quizzes.split[0].links.length, 2);
      const newQuiz = report.quizzes.split[0].quiz;
      assert.deepEqual(await text(newQuiz), ['Neu F']);
      assert.equal(
        (await db.query(`select is_active from public.quizzes where id = $1`, [newQuiz])).rows[0].is_active,
        true
      );
      assert.equal(await count(`select count(*) n from public.enabler_quiz_links where quiz_id = $1`, [newQuiz]), 2);
      assert.equal(await count(`select count(*) n from public.enabler_quiz_links where quiz_id = $1`, [id(205)]), 0);
      assert.equal(
        (await db.query(`select file_name from public.content_documents where id = $1`, [id(101)])).rows[0].file_name,
        'neu.pdf'
      );
      assert.equal(await count(`select count(*) n from public.content_documents where enabler_id = $1`, [id(4)]), 0);
      assert.deepEqual(await text(id(202)), ['Neu B', 'Neu C']);
      assert.equal(
        (await db.query(`select is_active from public.quizzes where id = $1`, [id(203)])).rows[0].is_active,
        false
      );
      assert.deepEqual(await text(id(204)), ['Alt E']);
      assert.equal(await count(`select count(*) n from public.quiz_submissions where quiz_id = $1`, [id(204)]), 1);
      assert.deepEqual(await text(id(205)), ['Alt F']);
    });

    test('a second run finds nothing to do except the conflicts', async () => {
      await db.query('begin');
      const again = await promote(db);
      await db.query('rollback');
      assert.equal(again.documents.updated.length + again.documents.inserted.length, 0);
      assert.equal(again.quizzes.replaced.length + again.quizzes.inserted.length, 0);
      assert.equal(again.quizzes.conflicts.length, 1);
      assert.equal(again.quizzes.split.length, 0);
    });

    test('the report turns the promotion back', async () => {
      await db.query('begin');
      await rollbackReport(db, JSON.parse(JSON.stringify(report)));
      await db.query('commit');
      assert.equal(
        (await db.query(`select file_name from public.content_documents where id = $1`, [id(101)])).rows[0].file_name,
        'alt.pdf'
      );
      assert.equal(await count(`select count(*) n from public.content_documents`), 2);
      assert.equal(await count(`select count(*) n from public.quizzes where id = $1`, [id(203)]), 0);
      assert.equal(await count(`select count(*) n from public.enabler_quiz_links where quiz_id = $1`, [id(205)]), 2);
      assert.equal(await count(`select count(*) n from public.quizzes`), 4);
      assert.deepEqual(await text(id(202)), ['Alt B']);
    });
  }
);
