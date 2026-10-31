// FIAE quizzes of the Word delivery (06-01-26 LFA\FIAE\Komponenten\...\Enablers\<enabler>\Quiz) into the Preview.
// Every enabler folder holds three files (light, medium, hard). They are compared with the quizzes the
// Preview already has for that enabler (LOW, MEDIUM, HIGH): same questions and same right answers means
// nothing to do. An enabler with a changed or missing quiz gets all three quizzes from the delivery: a quiz
// that exists keeps its row and its link (its questions and options are replaced, answers of test
// submissions on the old questions go with them), a quiz that is missing is created and linked. A quiz that
// several enablers share is never changed for one of them: that enabler gets a quiz of its own.
// An enabler is left out and reported when one of its files has a question that cannot be read clearly.
// Only the Preview exists as a target. Global quizzes and component 22 are not part of this script.
//
// Commands:
//   plan     <source> --target preview [--components 01,02] [--out plan.json]   read only
//   run      <source> --target preview [--apply --confirm-host <db host>] [--components ...] [--created-by <uuid>] [--out report.json]
//            Without --apply it only plans. With --apply every enabler is written in one transaction.
//   rollback <report.json> --target preview [--apply --confirm-host <db host>]
//            Writes the old questions of replaced quizzes back and removes the quizzes that were created.
//
// Connection: DB_CONNECTION_STRING (role app_preview_migrator) from the environment. The script prints
// no key and no connection string.

import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';

import { mapComponents, matchEnablers, readSource } from './fiae-documents.mjs';
import { docxLines, norm, parseQuizLines, stemKey } from './fiae-quiz-parse.mjs';
import {
  openVerifiedClient,
  prepareConnection,
  redact,
} from './kfbm-session.mjs';

const DEFERRED = new Set(['22']);
const LEVELS = { light: 'LOW', medium: 'MEDIUM', hard: 'HIGH' };
const ORDER = ['LOW', 'MEDIUM', 'HIGH'];
const S = 'public_preview';

export function parseArgs(argv) {
  const out = {
    command: null,
    source: null,
    target: null,
    apply: false,
    confirmHost: null,
    components: null,
    createdBy: null,
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
    else if (a === '--created-by') out.createdBy = value(i++, a);
    else if (a === '--out') out.out = value(i++, a);
    else if (a === '--components') {
      const v = value(i++, a);
      out.components = v ? v.split(',').map(x => x.trim().padStart(2, '0')) : null;
    } else if (a.startsWith('--')) out.errors.push(`Unknown option ${a}.`);
    else rest.push(a);
  }
  [out.command, out.source] = rest;
  if (!['plan', 'run', 'rollback'].includes(out.command))
    out.errors.push('The command is plan, run or rollback.');
  if (!out.source) out.errors.push('The source folder (or the report file) is missing.');
  if (out.target !== 'preview')
    out.errors.push('Every run needs --target preview. Production is not possible.');
  if (out.apply && out.command === 'plan')
    out.errors.push('--apply belongs to run and rollback.');
  return out;
}

/** Same questions and the same right answers as the quiz the Preview has? */
export function sameQuiz(parsed, existing) {
  if (!existing || parsed.length !== existing.length) return false;
  const used = new Set();
  for (const q of parsed) {
    const n = norm(q.text);
    const idx = existing.findIndex((e, i) => !used.has(i) && e.key && n.includes(e.key));
    if (idx < 0) return false;
    used.add(idx);
    const right = q.options.filter(o => o.correct).map(o => norm(o.text));
    const was = existing[idx].right;
    if (right.length !== was.length || !right.every(r => was.includes(r))) return false;
  }
  return true;
}

const listDir = p => {
  try {
    return readdirSync(p, { withFileTypes: true });
  } catch {
    return [];
  }
};

async function readEnablerQuizzes(dir) {
  const files = {};
  const problems = [];
  for (const f of listDir(dir)) {
    if (!f.isFile() || !/\.docx$/i.test(f.name)) continue;
    const m = /_(light|medium|hard)\.docx$/i.exec(f.name);
    if (!m) {
      problems.push({ file: f.name, code: 'LEVEL_NOT_IN_NAME' });
      continue;
    }
    const level = LEVELS[m[1].toLowerCase()];
    if (files[level]) {
      problems.push({ file: f.name, code: 'LEVEL_TWICE' });
      continue;
    }
    let parsed;
    try {
      parsed = parseQuizLines(await docxLines(readFileSync(path.join(dir, f.name))));
    } catch (e) {
      problems.push({ file: f.name, code: 'UNREADABLE' });
      continue;
    }
    files[level] = { file: f.name, questions: parsed.questions, issues: parsed.issues };
  }
  for (const l of ORDER) if (!files[l]) problems.push({ file: l, code: 'LEVEL_MISSING' });
  return { files, problems };
}

export async function main(argv, env = process.env) {
  const args = parseArgs(argv);
  if (args.errors.length) {
    args.errors.forEach(e => console.error(`Error: ${e}`));
    return 2;
  }
  if (args.command === 'rollback' && !args.apply) {
    const r = JSON.parse(readFileSync(args.source, 'utf8'));
    console.log(`Rollback plan: ${r.replaced.length} quizzes get their old questions, ${r.created.length} created quizzes are removed. Nothing written (no --apply).`);
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
  const opened = await openVerifiedClient(prepared, args, 'fiae-quizzes');
  if (!opened.ok) {
    opened.messages.forEach(m => console.error(redact(m, prepared.connectionString)));
    return opened.status;
  }
  const { client } = opened;
  opened.notes?.forEach(n => console.log(n));
  let code = 0;
  try {
    code = args.command === 'rollback' ? await rollback(args, client) : await execute(args, client);
  } catch (error) {
    console.error(`Failed: ${redact(error?.message ?? error, prepared.connectionString)}`);
    code = 1;
  } finally {
    await client.end().catch(() => undefined);
  }
  return code;
}

async function execute(args, client) {
  const q = async (sql, p) => (await client.query(sql, p)).rows;
  const everything = readSource(args.source);
  const source = everything.filter(
    c => !DEFERRED.has(c.key) && (!args.components || args.components.includes(c.key))
  );
  const courses = await q(
    `select c.id, c.title from ${S}.courses c join ${S}.training_catalogs t on t.id = c.training_catalog_id where t.code = 'FIAE'`
  );
  const { map, problems } = mapComponents(everything, courses);
  if (problems.length) {
    problems.forEach(p => console.error(`Refused: ${p}`));
    return 1;
  }
  const courseIds = [...new Set([...map.values()].map(c => c.id))];
  const dbEnablers = await q(
    `select id, course_id, title from ${S}.enablers where course_id = any($1::uuid[]) order by order_index, title`,
    [courseIds]
  );
  const links = await q(
    `select l.id link_id, l.enabler_id, l.quiz_id, l.difficulty::text d from ${S}.enabler_quiz_links l where l.enabler_id = any($1::uuid[])`,
    [dbEnablers.map(e => e.id)]
  );
  const quizIds = links.map(l => l.quiz_id);
  const questions = await q(
    `select id, quiz_id, question_text, order_index, question_type::text question_type, expected_answer from ${S}.questions where quiz_id = any($1::uuid[]) order by quiz_id, order_index`,
    [quizIds]
  );
  const options = await q(
    `select question_id, option_text, is_correct, explanation, order_index from ${S}.options where question_id = any($1::uuid[]) order by question_id, order_index`,
    [questions.map(x => x.id)]
  );
  const catalog = (await q(`select id from ${S}.training_catalogs where code = 'FIAE'`))[0];
  const creator =
    args.createdBy ??
    (await q(`select created_by_id from ${S}.quizzes where id = any($1::uuid[]) and created_by_id is not null limit 1`, [quizIds]))[0]?.created_by_id;
  const optsOf = new Map();
  for (const o of options) (optsOf.get(o.question_id) ?? optsOf.set(o.question_id, []).get(o.question_id)).push(o);
  const existingOf = new Map(); // quiz id -> [{ key, right }]
  const questionsOf = new Map();
  for (const x of questions) {
    (questionsOf.get(x.quiz_id) ?? questionsOf.set(x.quiz_id, []).get(x.quiz_id)).push(x);
  }
  for (const [quizId, qs] of questionsOf)
    existingOf.set(
      quizId,
      qs.map(x => ({
        key: stemKey(x.question_text),
        right: (optsOf.get(x.id) ?? []).filter(o => o.is_correct).map(o => norm(o.option_text)),
      }))
    );

  const plan = { enablers: [], counts: { same: 0, write: 0, blocked: 0, noEnabler: 0 }, gaps: { noEnabler: [] } };
  for (const comp of source) {
    const course = map.get(comp.nr);
    const enablers = dbEnablers.filter(e => e.course_id === course.id);
    const matched = matchEnablers(comp.enablers, enablers);
    for (let i = 0; i < comp.enablers.length; i++) {
      const fe = comp.enablers[i];
      const hit = matched.get(i);
      const label = `${comp.key}/${fe.key}`;
      if (!hit) {
        plan.counts.noEnabler++;
        plan.gaps.noEnabler.push(`${label} ${fe.folder}`);
        continue;
      }
      const read = await readEnablerQuizzes(path.join(comp.dir, 'Enablers', fe.folder, 'Quiz'));
      const levels = {};
      const issues = [...read.problems];
      for (const l of ORDER) {
        const f = read.files[l];
        if (!f) continue;
        f.issues.forEach(x => issues.push({ file: f.file, ...x }));
        const link = links.find(x => x.enabler_id === hit.e.id && x.d === l) ?? null;
        levels[l] = {
          file: f.file,
          questions: f.questions,
          link,
          same: link ? sameQuiz(f.questions, existingOf.get(link.quiz_id)) : false,
        };
      }
      const allSame = ORDER.every(l => levels[l]?.same);
      const status = issues.length ? 'blocked' : allSame ? 'same' : 'write';
      plan.counts[status]++;
      plan.enablers.push({
        label,
        enablerId: hit.e.id,
        enablerTitle: hit.e.title,
        key: fe.key,
        status,
        issues,
        levels,
      });
    }
  }
  const write = plan.enablers.filter(e => e.status === 'write');
  const created = write.reduce((n, e) => n + ORDER.filter(l => !e.levels[l].link).length, 0);
  console.log(
    `Enablers read: ${plan.enablers.length}; unchanged ${plan.counts.same}; to write ${plan.counts.write} (quizzes created: ${created}); left out because a question is not clear: ${plan.counts.blocked}; no enabler in the Preview: ${plan.counts.noEnabler}`
  );
  for (const e of plan.enablers.filter(x => x.status === 'blocked'))
    console.log(`  - blocked ${e.label} ${e.enablerTitle.slice(0, 50)}: ${[...new Set(e.issues.map(i => `${i.file ?? ''} ${i.code}${i.question ? ' q' + i.question : ''}`))].slice(0, 4).join('; ')}`);
  plan.gaps.noEnabler.forEach(x => console.log(`  - no enabler: ${x}`));
  const summary = {
    counts: plan.counts,
    created,
    write: write.map(e => ({
      label: e.label,
      levels: Object.fromEntries(ORDER.map(l => [l, { questions: e.levels[l].questions.length, was: e.levels[l].link ? (existingOf.get(e.levels[l].link.quiz_id) ?? []).length : null }])),
    })),
    blocked: plan.enablers.filter(x => x.status === 'blocked').map(e => ({ label: e.label, issues: e.issues })),
    noEnabler: plan.gaps.noEnabler,
  };
  if (args.command === 'plan' || !args.apply) {
    if (args.out) writeFileSync(args.out, JSON.stringify(summary, null, 1));
    console.log(args.command === 'plan' ? 'Plan only.' : 'Dry run: nothing written.');
    return 0;
  }
  if (!creator) {
    console.error('Refused: no profile for created_by (use --created-by).');
    return 1;
  }
  const report = { replaced: [], created: [], skipped: summary.blocked, counts: plan.counts };
  let failed = 0;
  for (const e of write) {
    try {
      await client.query('begin');
      for (const l of ORDER) {
        const lv = e.levels[l];
        let quizId = lv.link?.quiz_id;
        // a quiz that several enablers share (a Vertiefung course copies the enablers of its base course)
        // is not changed for one of them: that enabler gets a quiz of its own and its link is moved
        const shared = quizId
          ? (await client.query(`select count(*)::int n from ${S}.enabler_quiz_links where quiz_id = $1`, [quizId])).rows[0].n > 1
          : false;
        if (quizId && !shared) {
          const old = (questionsOf.get(quizId) ?? []).map(x => ({
            question_text: x.question_text,
            order_index: x.order_index,
            question_type: x.question_type,
            expected_answer: x.expected_answer,
            options: (optsOf.get(x.id) ?? []).map(o => ({ option_text: o.option_text, is_correct: o.is_correct, explanation: o.explanation, order_index: o.order_index })),
          }));
          const answers = (await client.query(
            `select count(*)::int n from ${S}.quiz_submission_answers a join ${S}.questions q on q.id = a.question_id where q.quiz_id = $1`,
            [quizId]
          )).rows[0].n;
          await client.query(`delete from ${S}.questions where quiz_id = $1`, [quizId]);
          await client.query(`update ${S}.quizzes set updated_at = now(), is_active = true where id = $1`, [quizId]);
          report.replaced.push({ label: e.label, level: l, quizId, old, answersRemoved: answers });
        } else {
          const title = `${e.key}_${e.enablerTitle} - ${l}`.slice(0, 250);
          quizId = (await client.query(
            `insert into ${S}.quizzes (title, quiz_type, created_by_id, is_active, training_catalog_id) values ($1, 'LESSON', $2, true, $3) returning id`,
            [title, creator, catalog.id]
          )).rows[0].id;
          if (shared) {
            await client.query(`update ${S}.enabler_quiz_links set quiz_id = $1 where id = $2`, [quizId, lv.link.link_id]);
            report.created.push({ label: e.label, level: l, quizId, relinkedFrom: lv.link.quiz_id, linkId: lv.link.link_id });
          } else {
            await client.query(`insert into ${S}.enabler_quiz_links (enabler_id, quiz_id, difficulty) values ($1, $2, $3)`, [e.enablerId, quizId, l]);
            report.created.push({ label: e.label, level: l, quizId });
          }
        }
        let n = 0;
        for (const qu of lv.questions) {
          const qid = (await client.query(
            `insert into ${S}.questions (quiz_id, question_text, order_index, question_type) values ($1, $2, $3, 'MCQ') returning id`,
            [quizId, qu.text, n++]
          )).rows[0].id;
          let k = 0;
          for (const o of qu.options)
            await client.query(
              `insert into ${S}.options (question_id, option_text, is_correct, explanation, order_index) values ($1, $2, $3, $4, $5)`,
              [qid, o.text, o.correct, o.explanation, k++]
            );
        }
      }
      await client.query('commit');
    } catch (err) {
      await client.query('rollback').catch(() => undefined);
      failed++;
      console.error(`Enabler ${e.label} failed and was left as it was: ${err?.message}`);
    }
  }
  console.log(`Done: ${report.replaced.length} quizzes replaced, ${report.created.length} created, enablers failed ${failed}.`);
  if (args.out) writeFileSync(args.out, JSON.stringify(report));
  return failed ? 1 : 0;
}

async function rollback(args, client) {
  const r = JSON.parse(readFileSync(args.source, 'utf8'));
  await client.query('begin');
  try {
    for (const c of r.created) {
      if (c.relinkedFrom)
        await client.query(`update ${S}.enabler_quiz_links set quiz_id = $1 where id = $2`, [c.relinkedFrom, c.linkId]);
      await client.query(`delete from ${S}.quizzes where id = $1`, [c.quizId]);
    }
    for (const x of r.replaced) {
      await client.query(`delete from ${S}.questions where quiz_id = $1`, [x.quizId]);
      for (const qu of x.old) {
        const qid = (await client.query(
          `insert into ${S}.questions (quiz_id, question_text, order_index, question_type, expected_answer) values ($1, $2, $3, $4::${S}.question_type, $5) returning id`,
          [x.quizId, qu.question_text, qu.order_index, qu.question_type, qu.expected_answer]
        )).rows[0].id;
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
  console.log(`Rolled back: ${r.replaced.length} quizzes got their old questions, ${r.created.length} created quizzes removed.`);
  return 0;
}

if (process.argv[1] && path.basename(process.argv[1]) === 'fiae-quizzes.mjs') {
  main(process.argv.slice(2)).then(code => process.exit(code));
}
