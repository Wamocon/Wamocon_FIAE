// Loads the TypeScript modules of the apply step (src/lib/content-import/apply)
// and of the quiz JSON source (src/lib/content-import/quiz-json) for
// scripts/import/kfbm-apply.mjs. Node strips the types while loading them.
// The modules import each other without a file extension, the hook in
// ts-resolve-hook.mjs adds it (and names the format, so Node does not warn). Must be imported before anything else loads these modules.
//
// No network, no database in here: it only loads code.

import { register } from 'node:module';

register('./ts-resolve-hook.mjs', import.meta.url);

const load = name =>
  import(
    new URL(`../../src/lib/content-import/apply/${name}.ts`, import.meta.url)
      .href
  );
const loadQuizJson = name =>
  import(
    new URL(
      `../../src/lib/content-import/quiz-json/${name}.ts`,
      import.meta.url
    ).href
  );
const [decisions, plan, target, job, db, quizRead, quizMerge, quizReport] =
  await Promise.all([
    load('decisions'),
    load('plan'),
    load('target'),
    load('job'),
    load('db'),
    loadQuizJson('read'),
    loadQuizJson('merge'),
    loadQuizJson('report'),
  ]);

export const { parseDecisions } = decisions;
export const {
  buildImportPlan,
  planCounts,
  renderPlanSummary,
  selectFiles,
  validatePlan,
} = plan;
export const {
  checkConfirmHost,
  checkTargetFacts,
  checkTargetHost,
  connectionHost,
  isLoopbackHost,
  parseApplyArgs,
  parseConnectionString,
} = target;
export const { runJob } = job;
export const { ImportAbort } = db;
export const { readGlobalQuizzes, readLessonQuizzes } = quizRead;
export const { mergeQuizSources } = quizMerge;
export const { renderQuizJsonReport, summarizeQuizJson } = quizReport;
export const { renderLengthChanges } = await import(
  new URL('../../src/lib/content-import/descriptions.ts', import.meta.url).href
);
