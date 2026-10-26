// Loads the TypeScript modules of the apply step (src/lib/content-import/apply)
// for scripts/import/kfbm-apply.mjs. Node strips the types while loading them.
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
const [decisions, plan, target, job, db] = await Promise.all([
  load('decisions'),
  load('plan'),
  load('target'),
  load('job'),
  load('db'),
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
