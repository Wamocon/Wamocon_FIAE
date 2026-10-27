// Loads the TypeScript modules of the use case import
// (src/lib/content-import/use-cases) for scripts/import/kfbm-use-cases.mjs. Node
// strips the types while loading them. The hook of kfbm-apply-modules.mjs
// (imported first) adds the file extension to the relative imports.
//
// No network, no database in here: it only loads code.

import { ImportAbort, parseDecisions } from './kfbm-apply-modules.mjs';

const load = name =>
  import(
    new URL(
      `../../src/lib/content-import/use-cases/${name}.ts`,
      import.meta.url
    ).href
  );
const [args, plan, report, job] = await Promise.all([
  load('args'),
  load('plan'),
  load('report'),
  load('job'),
]);

export { ImportAbort, parseDecisions };
export const { parseUseCaseArgs } = args;
export const {
  buildUseCasePlan,
  renderUseCaseSummary,
  selectUseCaseFiles,
  countUseCasePlan,
  validateUseCasePlan,
} = plan;
export const { renderUseCaseRunReport } = report;
export const { runUseCaseJob } = job;
