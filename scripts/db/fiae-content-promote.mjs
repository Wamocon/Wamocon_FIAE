// FIAE content from the Preview (public_preview) to Production (public), by id.
//
// Why a script of its own: the content sync (content-sync.mjs) only inserts rows and finds them by
// title keys, which are not unique in Production for FIAE. It does not replace a document and it
// never changes a quiz. The FIAE delivery of 30.10.2026 replaced documents, quizzes and scenario
// parts in the Preview. The rows of the Preview have the ids of Production (the Preview was copied
// from it), so the rows can be matched by id.
//
// What it does, only for rows of the FIAE catalog whose parent (enabler, use case) exists in public:
//   documents  a row with the same id gets the new file data (title, file name and size, storage url
//              and path, page count, order, visibility). A row that is not there is inserted.
//   quizzes    for every enabler and level (LOW, MEDIUM, HIGH) the questions of the Preview are
//              compared with those of Production (question text and right answers).
//                 same           nothing
//                 no quiz        the quiz is inserted with its questions and options and linked
//                                (inactive, as every new content in Production, see the release
//                                document, section 8)
//                 different      the questions of the quiz are replaced IN PLACE, but only when no
//                                trainee has a submission on it and no other enabler shares it.
//                                Otherwise the quiz is left as it is and listed as a conflict:
//                                replacing its questions would delete the answers of the trainees.
// What it never does: delete a document or a quiz, change an activation state, touch users, progress,
// submissions or the HAI index (the index of Production is rebuilt separately).
//
// Default is a DRY RUN: everything runs in a transaction that is rolled back and the numbers are
// printed. A real run needs --apply, --confirm-host and the environment variable
// FIAE_PROMOTE_APPROVED=yes, and happens only with the go of the owner for the rollout.
//
// Commands:
//   run      --target public [--apply --confirm-host <db host>] [--out report.json]
//   rollback <report.json> --target public [--apply --confirm-host <db host>]
//
// Order in the rollout: after the migrations of the catalog model (the quizzes need training_catalog_id) and
// before the activation of the content.
//
// Connection: DB_CONNECTION_STRING (a role that may write public) from the environment.

import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

const SRC = 'public_preview';
const DST = 'public';
const LEVELS = ['LOW', 'MEDIUM', 'HIGH'];

export const norm = s =>
  String(s ?? '')
    .toLowerCase()
    .replace(/[^0-9a-zäöüß]+/g, '');

/** The part of a question text that identifies it: without the topic line, 60 letters. */
export const stemKey = text =>
  norm(String(text ?? '').split('\n\n').slice(-1)[0]).slice(0, 60);

/** Questions as { key, right[] } from rows. */
export function describeQuestions(questions, optionsOf) {
  return questions.map(q => ({
    key: stemKey(q.question_text),
    right: (optionsOf.get(q.id) ?? [])
      .filter(o => o.is_correct)
      .map(o => norm(o.option_text))
      .sort(),
  }));
}

/** Same questions (in any order) with the same right answers. */
export function sameQuiz(a, b) {
  if (a.length !== b.length) return false;
  const used = new Set();
  for (const x of a) {
    const i = b.findIndex(
      (y, j) =>
        !used.has(j) &&
        y.key === x.key &&
        y.right.length === x.right.length &&
        y.right.every((r, k) => r === x.right[k])
    );
    if (i < 0) return false;
    used.add(i);
  }
  return true;
}

/**
 * What happens to one quiz slot (enabler and level).
 * target: null (no quiz there) or { quizId, questions, shared, submissions }.
 */
export function decideQuiz(sourceQuestions, target) {
  if (!target) return 'insert';
  if (sameQuiz(sourceQuestions, target.questions)) return 'same';
  if (target.shared) return 'conflict-shared';
  if (target.submissions > 0) return 'conflict-submissions';
  return 'replace';
}

export function parseArgs(argv) {
  const out = {
    command: null,
    source: null,
    target: null,
    apply: false,
    confirmHost: null,
    out: null,
    errors: [],
  };
  const rest = [];
  const value = (i, name) => {
    const v = argv[i + 1];
    if (v === undefined || v.startsWith('--')) {
      out.errors.push(`${name} needs a value.`);
      return null;
    }
    return v;
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--apply') out.apply = true;
    else if (a === '--target') out.target = value(i++, a);
    else if (a === '--confirm-host') out.confirmHost = value(i++, a);
    else if (a === '--out') out.out = value(i++, a);
    else if (a.startsWith('--')) out.errors.push(`Unknown option ${a}.`);
    else rest.push(a);
  }
  [out.command, out.source] = rest;
  if (!['run', 'rollback'].includes(out.command))
    out.errors.push('The command is run or rollback.');
  if (out.command === 'rollback' && !out.source)
    out.errors.push('The report file is missing.');
  if (out.target !== 'public')
    out.errors.push('Every run needs --target public.');
  if (out.apply && !out.confirmHost)
    out.errors.push('A real run needs --confirm-host.');
  return out;
}

const column = (rows, key) => rows.map(r => r[key]);

/**
 * The whole promotion inside the transaction the caller has opened. Returns the report.
 * It writes (the caller decides commit or rollback).
 */
export async function promote(client) {
  const q = async (sql, p) => (await client.query(sql, p)).rows;
  const report = {
    documents: { unchanged: 0, updated: [], inserted: [], skippedNoParent: 0 },
    quizzes: { same: 0, replaced: [], inserted: [], conflicts: [] },
  };

  const srcEnablers = column(
    await q(
      `select e.id from ${SRC}.enablers e join ${SRC}.courses c on c.id = e.course_id
         join ${SRC}.training_catalogs k on k.id = c.training_catalog_id where k.code = 'FIAE'`
    ),
    'id'
  );
  const srcUseCases = column(
    await q(
      `select u.id from ${SRC}.use_cases u join ${SRC}.courses c on c.id = u.course_id
         join ${SRC}.training_catalogs k on k.id = c.training_catalog_id where k.code = 'FIAE'`
    ),
    'id'
  );
  const enablers = new Map(
    (
      await q(
        `select id, course_id from ${DST}.enablers where id = any($1::uuid[])`,
        [srcEnablers]
      )
    ).map(r => [r.id, r.course_id])
  );
  const useCases = new Map(
    (
      await q(
        `select id, course_id from ${DST}.use_cases where id = any($1::uuid[])`,
        [srcUseCases]
      )
    ).map(r => [r.id, r.course_id])
  );

  // ---- documents
  const docs = await q(
    `select id, enabler_id, use_case_id, title, document_type::text dt, file_name, file_size, mime_type,
            storage_url, storage_path, order_index, visibility::text vis, page_count
       from ${SRC}.content_documents
      where enabler_id = any($1::uuid[]) or use_case_id = any($2::uuid[])`,
    [[...enablers.keys()], [...useCases.keys()]]
  );
  const have = new Map(
    (
      await q(
        `select id, title, file_name, file_size, storage_url, storage_path, page_count, order_index
           from ${DST}.content_documents where id = any($1::uuid[])`,
        [docs.map(d => d.id)]
      )
    ).map(r => [r.id, r])
  );
  const uploaderNullable =
    (
      await q(
        `select is_nullable from information_schema.columns
          where table_schema = 'public' and table_name = 'content_documents' and column_name = 'uploaded_by_id'`
      )
    )[0]?.is_nullable !== 'NO';
  const fallbackUploader = uploaderNullable
    ? null
    : ((
        await q(
          `select uploaded_by_id from ${DST}.content_documents where uploaded_by_id is not null limit 1`
        )
      )[0]?.uploaded_by_id ?? null);
  for (const d of docs) {
    const t = have.get(d.id);
    if (t) {
      const same =
        t.title === d.title &&
        t.file_name === d.file_name &&
        t.storage_path === d.storage_path &&
        t.storage_url === d.storage_url &&
        t.page_count === d.page_count;
      if (same) {
        report.documents.unchanged++;
        continue;
      }
      await client.query(
        `update ${DST}.content_documents
            set title = $2, file_name = $3, file_size = $4, mime_type = $5, storage_url = $6, storage_path = $7,
                order_index = $8, visibility = $9::text::${DST}.document_visibility, page_count = $10, updated_at = now()
          where id = $1`,
        [d.id, d.title, d.file_name, d.file_size, d.mime_type, d.storage_url, d.storage_path, d.order_index, d.vis, d.page_count]
      );
      report.documents.updated.push({
        id: d.id,
        old: {
          title: t.title,
          file_name: t.file_name,
          file_size: t.file_size,
          storage_url: t.storage_url,
          storage_path: t.storage_path,
          page_count: t.page_count,
          order_index: t.order_index,
        },
      });
    } else {
      const courseId = d.enabler_id
        ? enablers.get(d.enabler_id)
        : useCases.get(d.use_case_id);
      if (!courseId) {
        report.documents.skippedNoParent++;
        continue;
      }
      await client.query(
        `insert into ${DST}.content_documents
           (id, enabler_id, use_case_id, course_id, title, document_type, file_name, file_size, mime_type,
            storage_url, storage_path, order_index, uploaded_by_id, visibility, page_count)
         values ($1, $2, $3, $4, $5, $6::text::${DST}.content_document_type, $7, $8, $9, $10, $11, $12, $13,
                 $14::text::${DST}.document_visibility, $15)`,
        [d.id, d.enabler_id, d.use_case_id, courseId, d.title, d.dt, d.file_name, d.file_size, d.mime_type,
         d.storage_url, d.storage_path, d.order_index, fallbackUploader, d.vis, d.page_count]
      );
      report.documents.inserted.push(d.id);
    }
  }

  // ---- quizzes
  const srcLinks = await q(
    `select enabler_id, quiz_id, difficulty::text d from ${SRC}.enabler_quiz_links where enabler_id = any($1::uuid[])`,
    [[...enablers.keys()]]
  );
  const srcQuizIds = [...new Set(srcLinks.map(l => l.quiz_id))];
  const loadQuestions = async (schema, ids) => {
    const qs = await q(
      `select id, quiz_id, question_text, order_index, question_type::text qt, expected_answer
         from ${schema}.questions where quiz_id = any($1::uuid[]) order by quiz_id, order_index`,
      [ids]
    );
    const os = await q(
      `select question_id, option_text, is_correct, explanation, order_index
         from ${schema}.options where question_id = any($1::uuid[]) order by question_id, order_index`,
      [qs.map(x => x.id)]
    );
    const optionsOf = new Map();
    for (const o of os)
      (optionsOf.get(o.question_id) ?? optionsOf.set(o.question_id, []).get(o.question_id)).push(o);
    const byQuiz = new Map();
    for (const x of qs)
      (byQuiz.get(x.quiz_id) ?? byQuiz.set(x.quiz_id, []).get(x.quiz_id)).push(x);
    return { byQuiz, optionsOf };
  };
  const src = await loadQuestions(SRC, srcQuizIds);
  const srcQuizzes = new Map(
    (
      await q(
        `select id, title, quiz_type::text qt from ${SRC}.quizzes where id = any($1::uuid[])`,
        [srcQuizIds]
      )
    ).map(r => [r.id, r])
  );
  const dstLinks = await q(
    `select id, enabler_id, quiz_id, difficulty::text d from ${DST}.enabler_quiz_links where enabler_id = any($1::uuid[])`,
    [[...enablers.keys()]]
  );
  const dstQuizIds = [...new Set(dstLinks.map(l => l.quiz_id))];
  const dst = await loadQuestions(DST, dstQuizIds);
  const sharing = new Map(
    (
      await q(
        `select quiz_id, count(*)::int n from ${DST}.enabler_quiz_links where quiz_id = any($1::uuid[]) group by 1`,
        [dstQuizIds]
      )
    ).map(r => [r.quiz_id, r.n])
  );
  const withSubmissions = new Set(
    column(
      await q(
        `select distinct quiz_id from ${DST}.quiz_submissions where quiz_id = any($1::uuid[])`,
        [dstQuizIds]
      ),
      'quiz_id'
    )
  );
  const creator =
    (
      await q(
        `select created_by_id from ${DST}.quizzes where id = any($1::uuid[]) and created_by_id is not null limit 1`,
        [dstQuizIds]
      )
    )[0]?.created_by_id ?? null;
  const catalogId =
    (
      await q(
        `select training_catalog_id from ${DST}.courses
          where id = any($1::uuid[]) and training_catalog_id is not null limit 1`,
        [[...new Set([...enablers.values()])]]
      )
    )[0]?.training_catalog_id ?? null;

  const writeQuestions = async (quizId, sourceQuizId) => {
    for (const x of src.byQuiz.get(sourceQuizId) ?? []) {
      const qid = (
        await client.query(
          `insert into ${DST}.questions (quiz_id, question_text, order_index, question_type, expected_answer)
           values ($1, $2, $3, $4::text::${DST}.question_type, $5) returning id`,
          [quizId, x.question_text, x.order_index, x.qt, x.expected_answer]
        )
      ).rows[0].id;
      for (const o of src.optionsOf.get(x.id) ?? [])
        await client.query(
          `insert into ${DST}.options (question_id, option_text, is_correct, explanation, order_index)
           values ($1, $2, $3, $4, $5)`,
          [qid, o.option_text, o.is_correct, o.explanation, o.order_index]
        );
    }
  };

  for (const l of srcLinks) {
    if (!LEVELS.includes(l.d)) continue;
    const sourceQuestions = describeQuestions(
      src.byQuiz.get(l.quiz_id) ?? [],
      src.optionsOf
    );
    const link =
      dstLinks.find(x => x.enabler_id === l.enabler_id && x.d === l.d) ?? null;
    const target = link
      ? {
          quizId: link.quiz_id,
          questions: describeQuestions(dst.byQuiz.get(link.quiz_id) ?? [], dst.optionsOf),
          shared: (sharing.get(link.quiz_id) ?? 0) > 1,
          submissions: withSubmissions.has(link.quiz_id) ? 1 : 0,
        }
      : null;
    const what = decideQuiz(sourceQuestions, target);
    if (what === 'same') report.quizzes.same++;
    else if (what.startsWith('conflict'))
      report.quizzes.conflicts.push({
        enabler: l.enabler_id,
        level: l.d,
        quiz: target.quizId,
        why: what.slice('conflict-'.length),
      });
    else if (what === 'replace') {
      const old = (dst.byQuiz.get(target.quizId) ?? []).map(x => ({
        question_text: x.question_text,
        order_index: x.order_index,
        qt: x.qt,
        expected_answer: x.expected_answer,
        options: (dst.optionsOf.get(x.id) ?? []).map(o => ({
          option_text: o.option_text,
          is_correct: o.is_correct,
          explanation: o.explanation,
          order_index: o.order_index,
        })),
      }));
      await client.query(`delete from ${DST}.questions where quiz_id = $1`, [target.quizId]);
      await writeQuestions(target.quizId, l.quiz_id);
      report.quizzes.replaced.push({ enabler: l.enabler_id, level: l.d, quiz: target.quizId, old });
    } else {
      // a new quiz: with the id it has in the Preview when that is free. It is inactive (default).
      // created_by_id and training_catalog_id must not be empty: they come from the existing FIAE quizzes
      if (!creator || !catalogId)
        throw new Error('no creator or catalog found for a new quiz: run the migrations of the rollout first');
      const sq = srcQuizzes.get(l.quiz_id);
      const free = (await q(`select 1 from ${DST}.quizzes where id = $1`, [l.quiz_id])).length === 0;
      const quizId = free
        ? (
            await client.query(
              `insert into ${DST}.quizzes (id, title, quiz_type, created_by_id, training_catalog_id)
               values ($1, $2, $3::text::${DST}.quiz_type, $4, $5) returning id`,
              [l.quiz_id, sq.title, sq.qt, creator, catalogId]
            )
          ).rows[0].id
        : (
            await client.query(
              `insert into ${DST}.quizzes (title, quiz_type, created_by_id, training_catalog_id)
               values ($1, $2::text::${DST}.quiz_type, $3, $4) returning id`,
              [sq.title, sq.qt, creator, catalogId]
            )
          ).rows[0].id;
      await client.query(
        `insert into ${DST}.enabler_quiz_links (enabler_id, quiz_id, difficulty)
         values ($1, $2, $3::text::${DST}.quiz_difficulty)`,
        [l.enabler_id, quizId, l.d]
      );
      await writeQuestions(quizId, l.quiz_id);
      report.quizzes.inserted.push({ enabler: l.enabler_id, level: l.d, quiz: quizId });
    }
  }
  return report;
}

export function summary(report) {
  const d = report.documents;
  const z = report.quizzes;
  return [
    `Documents: unchanged ${d.unchanged}, updated ${d.updated.length}, inserted ${d.inserted.length}, skipped without parent ${d.skippedNoParent}`,
    `Quizzes: same ${z.same}, replaced ${z.replaced.length}, inserted ${z.inserted.length} (inactive), conflicts ${z.conflicts.length}`,
    ...z.conflicts
      .slice(0, 20)
      .map(c => `  conflict ${c.level} of enabler ${c.enabler}: ${c.why}`),
  ];
}

/** Writes the old values of a report back and removes what the report inserted. */
export async function rollbackReport(client, r) {
  for (const x of r.documents.updated)
    await client.query(
      `update ${DST}.content_documents set title = $2, file_name = $3, file_size = $4, storage_url = $5,
              storage_path = $6, page_count = $7, order_index = $8 where id = $1`,
      [x.id, x.old.title, x.old.file_name, x.old.file_size, x.old.storage_url, x.old.storage_path, x.old.page_count, x.old.order_index]
    );
  for (const id of r.documents.inserted)
    await client.query(`delete from ${DST}.content_documents where id = $1`, [id]);
  for (const x of r.quizzes.replaced) {
    await client.query(`delete from ${DST}.questions where quiz_id = $1`, [x.quiz]);
    for (const qu of x.old) {
      const qid = (
        await client.query(
          `insert into ${DST}.questions (quiz_id, question_text, order_index, question_type, expected_answer)
           values ($1, $2, $3, $4::text::${DST}.question_type, $5) returning id`,
          [x.quiz, qu.question_text, qu.order_index, qu.qt, qu.expected_answer]
        )
      ).rows[0].id;
      for (const o of qu.options)
        await client.query(
          `insert into ${DST}.options (question_id, option_text, is_correct, explanation, order_index)
           values ($1, $2, $3, $4, $5)`,
          [qid, o.option_text, o.is_correct, o.explanation, o.order_index]
        );
    }
  }
  for (const x of r.quizzes.inserted) {
    await client.query(`delete from ${DST}.enabler_quiz_links where quiz_id = $1`, [x.quiz]);
    await client.query(`delete from ${DST}.quizzes where id = $1`, [x.quiz]);
  }
}

export async function main(argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.errors.length) {
    args.errors.forEach(e => console.error(`Error: ${e}`));
    return 2;
  }
  if (!env.DB_CONNECTION_STRING) {
    console.error('Error: DB_CONNECTION_STRING is not set.');
    return 2;
  }
  if (args.apply && env.FIAE_PROMOTE_APPROVED !== 'yes') {
    console.error('Refused: a real run needs FIAE_PROMOTE_APPROVED=yes (the go of the owner).');
    return 1;
  }
  let host;
  try {
    host = new URL(env.DB_CONNECTION_STRING).hostname;
  } catch {
    console.error('Refused: DB_CONNECTION_STRING is not an address.');
    return 1;
  }
  if (args.apply && host !== args.confirmHost) {
    console.error('Refused: --confirm-host does not match the host of the connection.');
    return 1;
  }
  const pg = (await import('pg')).default;
  const local = host === 'localhost' || host === '127.0.0.1';
  const client = new pg.Client({
    connectionString: env.DB_CONNECTION_STRING,
    ssl: local ? false : { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    await client.query('begin');
    if (args.command === 'rollback') {
      const r = JSON.parse(readFileSync(args.source, 'utf8'));
      await rollbackReport(client, r);
      console.log(
        `Report undone: ${r.documents.updated.length} documents restored, ${r.documents.inserted.length} removed, ${r.quizzes.replaced.length} quizzes restored, ${r.quizzes.inserted.length} removed.`
      );
    } else {
      const report = await promote(client);
      summary(report).forEach(l => console.log(l));
      if (args.out) writeFileSync(args.out, JSON.stringify(report, null, 1));
    }
    if (args.apply) {
      await client.query('commit');
      console.log('Applied.');
    } else {
      await client.query('rollback');
      console.log('Dry run: the transaction was rolled back, nothing was written.');
    }
    return 0;
  } catch (error) {
    await client.query('rollback').catch(() => undefined);
    console.error(
      `Failed, nothing was written: ${String(error?.message ?? error).replace(env.DB_CONNECTION_STRING, '<connection>')}`
    );
    return 1;
  } finally {
    await client.end().catch(() => undefined);
  }
}

if (
  process.argv[1] &&
  path.basename(process.argv[1]) === 'fiae-content-promote.mjs'
) {
  main(process.argv.slice(2)).then(code => process.exit(code));
}
