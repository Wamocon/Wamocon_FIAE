// Loads the TypeScript modules of the learning field import
// (src/lib/content-import/learning-fields) for
// scripts/import/kfbm-learning-fields.mjs. Node strips the types while loading
// them. The hook of kfbm-apply-modules.mjs (imported first) adds the file
// extension to the relative imports.
//
// No network, no database in here: it only loads code.

import {
  ImportAbort,
  parseDecisions,
  selectFiles,
} from './kfbm-apply-modules.mjs';

const load = name =>
  import(
    new URL(
      `../../src/lib/content-import/learning-fields/${name}.ts`,
      import.meta.url
    ).href
  );
const [args, indexSource, mappingSheet, plan, report, titles, xlsx, job] =
  await Promise.all([
    load('args'),
    load('index-source'),
    load('mapping-sheet'),
    load('plan'),
    load('report'),
    load('titles'),
    load('xlsx-sheet'),
    load('job'),
  ]);

export { ImportAbort, parseDecisions, selectFiles };
export const { parseLearningFieldArgs } = args;
export const { importIndexFromFiles, importIndexFromPlan } = indexSource;
export const { parseMappingSheet } = mappingSheet;
export const {
  buildLearningFieldPlan,
  renderLearningFieldSummary,
  validateLearningFieldPlan,
} = plan;
export const { renderLearningFieldRunReport } = report;
export const { titlesFromJson, titlesFromSourceCsv } = titles;
export const { readXlsxRows } = xlsx;
export const { runLearningFieldJob } = job;
