// FIAE global quizzes of the Word delivery (06-01-26 LFA\FIAE\Komponenten\<nn>_...\Global_Quiz\Global_Quiz.docx) into the Preview.
// The Preview has 22 global quizzes, one per subject area (§ 4 ...), the delivery has one file per component.
// A file is matched to the quiz of its subject area and compared with it question by question (the first
// 60 letters of the question, then the options and the right answer):
//   same     every question is there with the same options and right answer: nothing to do
//   replace  the whole file was read and differs: the questions and options of the quiz are replaced
//   patch    some questions of the file could not be read clearly (no right answer marked, two marks, a
//            broken option): only the readable ones are used, a question that exists gets the options and
//            the right answer of the file, a new one is added, every other question of the quiz stays
//   blocked  test answers exist on a question that would change: nothing is written
// A file that does not belong to a quiz of the Preview is left out and reported: files 14, 18 and 22 are
// identical copies of 03, 08 and 11 for the second year (the Preview has one quiz for both years), file 09
// holds questions of the network and storage enablers (FR-726 to FR-731), file 13 is empty.
// No quiz is created or deleted. The old questions of every changed quiz go into the report for the rollback.
// Only the Preview exists as a target.
//
// Commands:
//   plan     <source> --target preview [--files 03,07] [--out plan.json]   read only
//   run      <source> --target preview [--apply --confirm-host <db host>] [--files ...] [--out report.json]
//            Without --apply it only plans. With --apply every quiz is written in one transaction.
//   rollback <report.json> --target preview [--apply --confirm-host <db host>]
//
// Connection: DB_CONNECTION_STRING (role app_preview_migrator) from the environment. The script prints
// no key and no connection string.

import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import {
  docxParagraphs,
  norm,
  parseGlobalQuiz,
  stemKey,
} from './fiae-global-quiz-parse.mjs';
import {
  openVerifiedClient,
  prepareConnection,
  redact,
} from './kfbm-session.mjs';

const S = 'public_preview';

/** File number -> start of the title of the quiz in the Preview. */
export const QUIZ_OF_FILE = {
  '01': 'Planen, Vorbereiten und Durchführen',
  '02': 'Informieren und Beraten',
  '03': 'Beurteilen marktgängiger',
  '04': 'Entwickeln, Erstellen und Betreuen',
  '05': 'Durchführen von qualitätssichernden',
  '06': 'Maßnahmen zur IT-Sicherheit und zum Datenschutz',
  '07': 'Erbringen der Leistungen',
  '08': 'Betreiben von IT-Systemen',
  10: 'Konzipieren und Umsetzen von Softwareanwendungen',
  11: 'Sicherstellen der Qualität',
  12: 'Vernetztes Zusammenarbeiten',
  15: 'Entwickeln von IT-Lösungen (Vertiefung)',
  16: 'Durchführen von QS-Maßnahmen (Vertiefung)',
  17: 'IT-Sicherheit & Datenschutz (Vertiefung)',
  19: 'Inbetriebnehmen von Speicherlösungen',
  20: 'Programmieren von Softwarelösungen (Vertiefung)',
  21: 'Konzipieren von Softwareanwendungen (Vertiefung)',
  23: 'Berufsbildung',
  24: 'Aufbau und Organisation',
  25: 'Sicherheit und Gesundheitsschutz',
  26: 'Umweltschutz',
};

/** Files that are not imported, with the reason. */
export const LEFT_OUT = {
  '09': 'questions come from the enablers FR-726 to FR-731 (network, storage), not from Programmieren: wrong subject in the delivery',
  13: 'the file is missing in the delivery',
  14: 'identical copy of file 03 (the Preview has one quiz for both years)',
  18: 'identical copy of file 08 (the Preview has one quiz for both years)',
  22: 'identical copy of file 11 (the Preview has one quiz for both years)',
};

export function parseArgs(argv) {
  const out = {
    command: null,
    source: null,
    target: null,
    apply: false,
    confirmHost: null,
    files: null,
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
    else if (a === '--files') {
      const v = value(i++, a);
      out.files = v ? v.split(',').map(x => x.trim().padStart(2, '0')) : null;
    } else if (a.startsWith('--')) out.errors.push(`Unknown option ${a}.`);
    else rest.push(a);
  }
  [out.command, out.source] = rest;
  if (!['plan', 'run', 'rollback'].includes(out.command))
    out.errors.push('The command is plan, run or rollback.');
  if (!out.source)
    out.errors.push('The source folder (or the report file) is missing.');
  if (out.target !== 'preview')
    out.errors.push(
      'Every run needs --target preview. Production is not possible.'
    );
  if (out.apply && out.command === 'plan')
    out.errors.push('--apply belongs to run and rollback.');
  return out;
}

/** The text a question is compared by (an older import put the topic in front, separated by a blank line). */
export const keyOf = text => stemKey(String(text).split('\n\n').slice(-1)[0]);

const setOf = list => [...new Set(list.map(norm))].sort().join('\u0001');

/** Same options and same right answer(s)? */
export function sameQuestion(fileQ, existing) {
  return (
    setOf(fileQ.options.map(o => o.text)) ===
      setOf(existing.options.map(o => o.text)) &&
    setOf(fileQ.options.filter(o => o.correct).map(o => o.text)) ===
      setOf(existing.options.filter(o => o.correct).map(o => o.text))
  );
}

/**
 * What to do with one quiz. `questions` are the readable questions of the file, `issues` what could not be
 * read, `existing` the questions of the quiz ({ id, text, options: [{ text, correct }] }).
 */
export function planQuiz(questions, issues, existing) {
  const used = new Set();
  const pairs = questions.map(q => {
    const k = keyOf(q.text);
    const candidates = existing
      .map((e, i) => ({ e, i }))
      .filter(x => !used.has(x.i) && keyOf(x.e.text) === k);
    const hit = candidates.find(x => sameQuestion(q, x.e)) ?? candidates[0];
    if (hit) used.add(hit.i);
    return { q, hit: hit ? hit.e : null };
  });
  const changed = pairs.filter(p => p.hit && !sameQuestion(p.q, p.hit));
  const added = pairs.filter(p => !p.hit);
  const missing = existing.length - used.size;
  if (issues.length === 0) {
    if (!changed.length && !added.length && !missing)
      return { status: 'same', changed: 0, added: 0, missing: 0 };
    return {
      status: 'replace',
      changed: changed.length,
      added: added.length,
      missing,
    };
  }
  if (!changed.length && !added.length)
    return { status: 'same', changed: 0, added: 0, missing };
  return {
    status: 'patch',
    changed: changed.map(p => ({ id: p.hit.id, q: p.q })),
    added: added.map(p => p.q),
    missing,
  };
}

const sourceFolder = (root, nr) => {
  const dir = readdirSync(root, { withFileTypes: true }).find(
    d => d.isDirectory() && d.name.startsWith(`${nr}_`)
  );
  return dir
    ? path.join(root, dir.name, 'Global_Quiz', 'Global_Quiz.docx')
    : null;
};

export async function main(argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.errors.length) {
    args.errors.forEach(e => console.error(`Error: ${e}`));
    return 2;
  }
  if (args.command === 'rollback' && !args.apply) {
    const r = JSON.parse(readFileSync(args.source, 'utf8'));
    console.log(
      `Rollback plan: ${r.changed.length} quizzes get their old questions. Nothing written (no --apply).`
    );
    return 0;
  }
  const prepared = prepareConnection(
    { target: args.target, apply: args.apply, confirmHost: args.confirmHost },
    env
  );
  if (!prepared.ok) {
    prepared.messages.forEach(m => console.error(m));
    return prepared.status;
  }
  const opened = await openVerifiedClient(
    prepared,
    args,
    'fiae-global-quizzes'
  );
  if (!opened.ok) {
    opened.messages.forEach(m =>
      console.error(redact(m, prepared.connectionString))
    );
    return opened.status;
  }
  const { client } = opened;
  opened.notes?.forEach(n => console.log(n));
  let code = 0;
  try {
    code =
      args.command === 'rollback'
        ? await rollback(args, client)
        : await execute(args, client);
  } catch (error) {
    console.error(
      `Failed: ${redact(error?.message ?? error, prepared.connectionString)}`
    );
    code = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
  return code;
}

async function loadQuizzes(client) {
  const q = async (sql, p) => (await client.query(sql, p)).rows;
  const quizzes = await q(
    `select z.id, z.title from ${S}.quizzes z join ${S}.training_catalogs t on t.id = z.training_catalog_id
     where t.code = 'FIAE' and z.quiz_type::text = 'GLOBAL'`
  );
  const ids = quizzes.map(z => z.id);
  const questions = await q(
    `select id, quiz_id, question_text, order_index, question_type::text question_type, expected_answer
     from ${S}.questions where quiz_id = any($1::uuid[]) order by quiz_id, order_index`,
    [ids]
  );
  const options = await q(
    `select question_id, option_text, is_correct, explanation, order_index
     from ${S}.options where question_id = any($1::uuid[]) order by question_id, order_index`,
    [questions.map(x => x.id)]
  );
  const optsOf = new Map();
  for (const o of options)
    (
      optsOf.get(o.question_id) ??
      optsOf.set(o.question_id, []).get(o.question_id)
    ).push(o);
  for (const z of quizzes)
    z.questions = questions
      .filter(x => x.quiz_id === z.id)
      .map(x => ({
        id: x.id,
        text: x.question_text,
        order_index: x.order_index,
        question_type: x.question_type,
        expected_answer: x.expected_answer,
        options: (optsOf.get(x.id) ?? []).map(o => ({
          text: o.option_text,
          option_text: o.option_text,
          correct: o.is_correct,
          is_correct: o.is_correct,
          explanation: o.explanation,
          order_index: o.order_index,
        })),
      }));
  return quizzes;
}

async function insertQuestion(client, quizId, text, order, options) {
  const qid = (
    await client.query(
      `insert into ${S}.questions (quiz_id, question_text, order_index, question_type) values ($1, $2, $3, 'MCQ') returning id`,
      [quizId, text, order]
    )
  ).rows[0].id;
  let k = 0;
  for (const o of options)
    await client.query(
      `insert into ${S}.options (question_id, option_text, is_correct, explanation, order_index) values ($1, $2, $3, $4, $5)`,
      [qid, o.text, o.correct, o.explanation, k++]
    );
}

async function execute(args, client) {
  if (!existsSync(args.source)) {
    console.error(`Refused: ${args.source} does not exist.`);
    return 1;
  }
  const quizzes = await loadQuizzes(client);
  const plan = [];
  const gaps = [];
  for (const [nr, why] of Object.entries(LEFT_OUT))
    if (!args.files || args.files.includes(nr.padStart(2, '0')))
      gaps.push({ file: nr, why });
  for (const [nr, label] of Object.entries(QUIZ_OF_FILE)) {
    const key = String(nr).padStart(2, '0');
    if (args.files && !args.files.includes(key)) continue;
    const file = sourceFolder(args.source, key);
    if (!file || !existsSync(file)) {
      gaps.push({ file: key, why: 'no Global_Quiz.docx in the folder' });
      continue;
    }
    const quiz = quizzes.find(z => norm(z.title).startsWith(norm(label)));
    if (!quiz) {
      gaps.push({ file: key, why: `no quiz "${label}" in the Preview` });
      continue;
    }
    const read = parseGlobalQuiz(await docxParagraphs(readFileSync(file)));
    const result = planQuiz(read.questions, read.issues, quiz.questions);
    plan.push({
      file: key,
      label,
      quiz,
      read,
      result,
    });
  }
  const count = s => plan.filter(p => p.result.status === s).length;
  console.log(
    `Files read: ${plan.length}; unchanged ${count('same')}; replace ${count('replace')}; patch ${count('patch')}; left out ${gaps.length}`
  );
  for (const p of plan) {
    const r = p.result;
    const detail =
      r.status === 'replace'
        ? `${p.read.questions.length} questions instead of ${p.quiz.questions.length} (changed ${r.changed}, new ${r.added}, only in the Preview ${r.missing})`
        : r.status === 'patch'
          ? `answers changed ${r.changed.length}, questions added ${r.added.length}, left as they are ${r.missing}`
          : '';
    const issues = p.read.issues.length
      ? `; not readable: ${p.read.issues.length} (${[...new Set(p.read.issues.map(i => i.code))].join(', ')})`
      : '';
    console.log(
      `  - ${p.file} ${p.label.slice(0, 40)}: ${r.status} ${detail}${issues}`
    );
  }
  for (const g of gaps) console.log(`  - left out ${g.file}: ${g.why}`);

  const summary = {
    plan: plan.map(p => ({
      file: p.file,
      quiz: p.quiz.title,
      status: p.result.status,
      readable: p.read.questions.length,
      was: p.quiz.questions.length,
      issues: p.read.issues,
    })),
    gaps,
  };
  if (args.command === 'plan' || !args.apply) {
    if (args.out) writeFileSync(args.out, JSON.stringify(summary, null, 1));
    console.log(
      args.command === 'plan' ? 'Plan only.' : 'Dry run: nothing written.'
    );
    return 0;
  }

  const report = { changed: [], blocked: [], gaps };
  let failed = 0;
  for (const p of plan.filter(
    x => x.result.status === 'replace' || x.result.status === 'patch'
  )) {
    const quizId = p.quiz.id;
    try {
      await client.query('begin');
      const touched =
        p.result.status === 'replace'
          ? p.quiz.questions.map(x => x.id)
          : p.result.changed.map(c => c.id);
      const answers = touched.length
        ? (
            await client.query(
              `select count(*)::int n from ${S}.quiz_submission_answers where question_id = any($1::uuid[])`,
              [touched]
            )
          ).rows[0].n
        : 0;
      if (answers > 0) {
        await client.query('rollback');
        report.blocked.push({ file: p.file, quizId, answers });
        console.error(
          `Quiz ${p.file} left as it was: ${answers} test answers on questions that would change.`
        );
        continue;
      }
      report.changed.push({
        file: p.file,
        quizId,
        status: p.result.status,
        old: p.quiz.questions.map(x => ({
          question_text: x.text,
          order_index: x.order_index,
          question_type: x.question_type,
          expected_answer: x.expected_answer,
          options: x.options.map(o => ({
            option_text: o.option_text,
            is_correct: o.is_correct,
            explanation: o.explanation,
            order_index: o.order_index,
          })),
        })),
      });
      if (p.result.status === 'replace') {
        await client.query(`delete from ${S}.questions where quiz_id = $1`, [
          quizId,
        ]);
        let n = 0;
        for (const qu of p.read.questions)
          await insertQuestion(client, quizId, qu.text, n++, qu.options);
      } else {
        for (const c of p.result.changed) {
          await client.query(
            `update ${S}.questions set question_text = $1 where id = $2`,
            [c.q.text, c.id]
          );
          await client.query(
            `delete from ${S}.options where question_id = $1`,
            [c.id]
          );
          let k = 0;
          for (const o of c.q.options)
            await client.query(
              `insert into ${S}.options (question_id, option_text, is_correct, explanation, order_index) values ($1, $2, $3, $4, $5)`,
              [c.id, o.text, o.correct, o.explanation, k++]
            );
        }
        let n = Math.max(-1, ...p.quiz.questions.map(x => x.order_index)) + 1;
        for (const qu of p.result.added)
          await insertQuestion(client, quizId, qu.text, n++, qu.options);
      }
      await client.query(
        `update ${S}.quizzes set updated_at = now() where id = $1`,
        [quizId]
      );
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      failed++;
      report.changed = report.changed.filter(c => c.quizId !== quizId);
      console.error(
        `Quiz ${p.file} failed and was left as it was: ${err?.message}`
      );
    }
  }
  console.log(
    `Done: ${report.changed.length} quizzes changed, ${report.blocked.length} blocked, ${failed} failed.`
  );
  if (args.out) writeFileSync(args.out, JSON.stringify(report));
  return failed ? 1 : 0;
}

async function rollback(args, client) {
  const r = JSON.parse(readFileSync(args.source, 'utf8'));
  await client.query('begin');
  try {
    for (const x of r.changed) {
      await client.query(`delete from ${S}.questions where quiz_id = $1`, [
        x.quizId,
      ]);
      for (const qu of x.old) {
        const qid = (
          await client.query(
            `insert into ${S}.questions (quiz_id, question_text, order_index, question_type, expected_answer) values ($1, $2, $3, $4::${S}.question_type, $5) returning id`,
            [
              x.quizId,
              qu.question_text,
              qu.order_index,
              qu.question_type,
              qu.expected_answer,
            ]
          )
        ).rows[0].id;
        for (const o of qu.options)
          await client.query(
            `insert into ${S}.options (question_id, option_text, is_correct, explanation, order_index) values ($1, $2, $3, $4, $5)`,
            [qid, o.option_text, o.is_correct, o.explanation, o.order_index]
          );
      }
    }
    await client.query('commit');
  } catch (e) {
    await client.query('rollback').catch(() => undefined);
    throw e;
  }
  console.log(
    `Rolled back: ${r.changed.length} quizzes got their old questions.`
  );
  return 0;
}

if (
  process.argv[1] &&
  path.basename(process.argv[1]) === 'fiae-global-quizzes.mjs'
) {
  main(process.argv.slice(2)).then(code => process.exit(code));
}
